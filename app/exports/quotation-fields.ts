import { categoryFields, type CategoryField } from '@/app/category-profiles';
import { savedTextOrFallback } from '@/app/product-content';
import { quotationSections, type ResolvedQuotation } from '@/app/quotation-schema';
import { quotationCsv } from '@/app/pricing';
import { optionSourceCostCny } from '@/app/product-options';
import type { BundleAsset } from '@/app/exports/review-bundle';
import type { QuotationRowData } from '@/app/exports/quotation-data';
import type { QuotationExportSource } from '@/app/exports/quotation-source';
import { ExportSizeError, utf8ByteLength } from '@/app/exports/zip';

const MAX_QUOTATION_TEXT_BYTES = 6 * 1024 * 1024;
function ensureFieldBudget(document: { rows: unknown[] }, tables: (string | number)[][][]) {
  // A common 150k-character HTML override can expand 200 times. Count each
  // bounded row first so JSON/CSV never materialize a hundred-megabyte string.
  let bytes = utf8ByteLength(JSON.stringify({ ...document, rows: [] }));
  const add = (length: number) => {
    bytes += length;
    if (bytes > MAX_QUOTATION_TEXT_BYTES) throw new ExportSizeError('견적 항목 파일 합계가 6MB를 초과합니다. 포함 옵션 수나 반복되는 상세 HTML을 줄인 뒤 다시 내려받아주세요.');
  };
  add(0);
  for (const row of document.rows) add(utf8ByteLength(JSON.stringify(row)) + 1);
  for (const table of tables) for (const row of table) add(utf8ByteLength(quotationCsv([row])) + 2);
}

// Older saved Excel mappings must point to the same final cells as the editor.
const aliases: Partial<Record<CategoryField, string>> = { boxQuantity: 'boxSkuQuantity', detailImage: 'detailImages', label: 'labelImages',
  material: 'noticeMaterial', countryOfOrigin: 'noticeCountryOfOrigin', serviceContact: 'noticeServiceContact' };
const imageKeys = (value: string) => value.split('\n').map(key => key.trim()).filter(Boolean);
export function quotationAttachmentKeys(saved: QuotationExportSource, resolved: ResolvedQuotation) {
  const imageFields = resolved.schema.fields.filter(field => field.type === 'images');
  return [...new Set([
    ...Object.values(saved.content.assets).flatMap(field => field.value),
    ...saved.options.rows.filter(row => row.included && row.imageKey).map(row => row.imageKey!),
    ...resolved.rows.filter(row => row.included).flatMap(row => imageFields.flatMap(field => imageKeys(row.fields[field.id].value))),
  ])];
}

/** Uses the resolver's one price calculation and final manual overrides. */
export function resolvedQuotationRows(saved: QuotationExportSource, resolved: ResolvedQuotation, assets: BundleAsset[]): QuotationRowData[] {
  const included = resolved.rows.filter(row => row.included);
  if (!included.length) throw new Error('견적서에 포함할 옵션을 한 개 이상 선택해주세요.');
  return included.map(row => {
    const option = row.optionId === null ? null : saved.options.rows.find(option => option.id === row.optionId);
    if (row.optionId !== null && (!option || option.unitCostCny === null)) throw new Error('포함 옵션의 원가와 구성 수량을 확인해주세요.');
    const data: QuotationRowData = {
      sourceUrl: saved.product.source_url, sourcePriceCny: option ? optionSourceCostCny(option.unitCostCny!, option.unitsPerPack) : saved.product.source_price_cny,
      ...(option ? { skuName: option.translatedName || option.originalName, skuId: option.supplierSku } : {}),
      importer: savedTextOrFallback(saved.content.label.importer, saved.settings.importer),
      serviceContact: savedTextOrFallback(saved.content.label.contact, saved.settings.serviceContact),
      material: saved.content.label.material.value, countryOfOrigin: saved.content.label.countryOfOrigin.value,
    };
    for (const field of resolved.schema.fields) {
      const cell = row.fields[field.id]; let value: string | number = cell.value;
      if (field.type === 'images') value = imageKeys(cell.value).map(key => {
        const asset = assets.find(asset => asset.key === key); if (!asset) throw new Error('견적서에 연결한 이미지 파일이 누락되었습니다.'); return asset.name.split('/').at(-1)!;
      }).join('\n');
      else if (field.type === 'number' && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value))) value = Number(value);
      if (Object.hasOwn(categoryFields, field.id)) data[field.id as Exclude<CategoryField, 'constant'>] = value;
    }
    for (const [legacy, current] of Object.entries(aliases)) {
      if (Object.hasOwn(row.fields, current)) data[legacy as Exclude<CategoryField, 'constant'>] = data[current as Exclude<CategoryField, 'constant'>];
    }
    return data;
  });
}

export function quotationFieldFiles(saved: QuotationExportSource, resolved: ResolvedQuotation, assets: BundleAsset[], inputFingerprint: string) {
  const fileByKey = new Map(assets.map(asset => [asset.key, asset.name]));
  const fields = new Map(resolved.schema.fields.map(field => [field.id, field]));
  const mapped = new Set(saved.profile?.mappings.filter(mapping => mapping.field !== 'constant').map(mapping => aliases[mapping.field] ?? mapping.field) ?? []);
  const warnings: string[] = [...resolved.issues];
  const overrides: (string | number)[][] = [['범위', '옵션 ID', '현재 옵션명', '견적 포함', '구역 ID', '구역', '필드 ID', '필드명', '수동 수정값', '현재 스키마', 'Excel 열 연결']];
  for (const [optionId, values] of [[null, saved.state.overrides.common], ...Object.entries(saved.state.overrides.options)] as [string | null, Record<string, string>][]) {
    const option = optionId === null ? null : saved.options.rows.find(option => option.id === optionId);
    for (const [key, value] of Object.entries(values)) {
      const field = fields.get(key); const active = Boolean(field && (optionId === null || option));
      overrides.push([optionId === null ? 'common' : 'option', optionId ?? '', option?.translatedName || option?.originalName || '', optionId === null ? '공통값' : option?.included ? '포함' : option ? '제외' : '삭제된 옵션', field?.section ?? '', field ? quotationSections[field.section] : '', key, field?.label ?? key, value, active ? '포함' : '현재 비활성', mapped.has(key) && active ? '연결' : '미연결']);
      if (!active) warnings.push(`보존된 수동값 ${optionId ?? '공통'}/${key}: 현재 카테고리 또는 옵션에 해당하지 않아 overrides 파일에 보존했습니다.`);
      else if (saved.profile && !mapped.has(key)) warnings.push(`수동값 ${optionId ?? '공통'}/${field!.label}: Excel 열 미연결. quotation-fields.json/CSV에 보존했습니다.`);
    }
  }
  const rows: (string | number)[][] = [['옵션 ID', '옵션명', '구역 ID', '구역', '필드 ID', '필드명', '최종값', '출처', '검토 필요', '확인 사항']];
  for (const row of resolved.rows.filter(row => row.included)) {
    for (const field of resolved.schema.fields) {
      const cell = row.fields[field.id];
      const value = field.type === 'images' ? imageKeys(cell.value).map(key => {
        const file = fileByKey.get(key); if (!file) throw new Error('견적서에 연결한 이미지 파일이 누락되었습니다.'); return file;
      }).join('\n') : cell.value;
      rows.push([row.optionId ?? '', row.optionLabel, field.section, quotationSections[field.section], field.id, field.label, value, cell.source, cell.needsReview ? '필요' : '', cell.issues.join(' / ')]);
    }
  }
  const document = { format: 'sourceflow-quotation-fields-v1', productId: saved.product.id, productVersion: saved.product.updated_at,
    contentRevision: saved.content.revision, optionRevision: saved.options.revision, quotationRevision: saved.state.revision,
    profileRevision: saved.profile?.revision ?? null, categoryContext: saved.categoryContext, inputFingerprint, submissionReady: false,
    schema: resolved.schema, rows: resolved.rows.filter(row => row.included),
    excludedOptions: resolved.rows.filter(row => row.optionId !== null && !row.included).map(row => ({ optionId: row.optionId, optionLabel: row.optionLabel })),
    overrides: saved.state.overrides, assets: Object.fromEntries(fileByKey),
    uploadFilenames: Object.fromEntries(assets.map(asset => [asset.key, asset.name.split('/').at(-1)!])),
    warnings: [...new Set(warnings), 'Excel 이미지 셀은 압축 해제한 이미지 파일명과 일치시켰습니다. 실제 Hub 양식과 접수 조건은 별도 확인이 필요합니다.'] };
  ensureFieldBudget(document, [rows, overrides]);
  return { warnings: document.warnings, files: [
    { name: 'quotation-fields.json', data: JSON.stringify(document) },
    { name: 'quotation-fields.csv', data: quotationCsv(rows) },
    { name: 'quotation-overrides.csv', data: quotationCsv(overrides) },
  ] };
}
