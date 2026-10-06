import type { ProductContent } from '@/app/product-content';
import type { ProductOptions } from '@/app/product-options';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { exactPrimaryQuotationTarget } from '@/app/quotation-seo-targets';
import type { DocumentImagePlan } from '@/app/document-image';

export const productLabelFields = [
  { key: 'productName', label: '제품명' }, { key: 'manufacturer', label: '제조원' },
  { key: 'importer', label: '수입 및 판매원' }, { key: 'countryOfOrigin', label: '제조국' },
  { key: 'netContents', label: '내용량' }, { key: 'material', label: '원료명 및 성분명(재질)' },
  { key: 'productType', label: '상품 유형' }, { key: 'precautions', label: '사용 시 주의사항' },
  { key: 'usageStandard', label: '사용 기준' },
] as const;
export type ProductLabelKey = (typeof productLabelFields)[number]['key'];
export type ProductLabelValues = Record<ProductLabelKey, string>;
export type ProductLabelDraft = Partial<Record<ProductLabelKey, string | null>>;
export type ProductLabelSource = 'manual-option' | 'manual-common' | 'content' | 'quotation' | 'settings' | 'empty';
export type ProductLabelOverrides = { common: Partial<ProductLabelValues>; options: Record<string, Partial<ProductLabelValues>> };
export type ProductLabelChange = { optionId: string | null; fieldKey: ProductLabelKey; value: string | null };
export type ProductLabelsState = { schemaVersion: 1; productId: string; revision: number; overrides: ProductLabelOverrides; updatedAt: string | null };
export type ProductLabelRow = { optionId: string | null; optionLabel: string; included: boolean; values: ProductLabelValues; automatic: ProductLabelValues; sources: Record<ProductLabelKey, ProductLabelSource> };
export type ProductLabelsView = {
  productId: string; revision: number; inputFingerprint: string; productVersion: string;
  contentRevision: number; optionRevision: number; quotationRevision: number; quotationInputFingerprint: string;
  categoryContext: QuotationFieldsView['categoryContext']; imageKeys: string[];
  overrides: ProductLabelOverrides; rows: ProductLabelRow[]; updatedAt: string | null;
};
export const PRODUCT_LABEL_BODY_LIMIT = 96 * 1024;
export const PRODUCT_LABEL_STORAGE_LIMIT = 512 * 1024;
const keySet = new Set<string>(productLabelFields.map(field => field.key));
const safeOption = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const textIssues = (value: unknown) => typeof value !== 'string' ? ['일반 텍스트를 입력해주세요.']
  : [...(value.length > 2000 ? ['항목마다 2,000자 이하로 입력해주세요.'] : []), ...(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value) ? ['제어문자를 제거해주세요.'] : [])];
export const emptyProductLabelOverrides = (): ProductLabelOverrides => ({ common: {}, options: {} });

export function validateProductLabelOverrides(value: unknown): ProductLabelOverrides {
  if (!record(value) || Object.keys(value).some(key => !['common', 'options'].includes(key)) || !record(value.common) || !record(value.options)
    || Object.keys(value.options).length > 200) throw Error('표시사항 저장 형식을 확인해주세요.');
  function values(input: Record<string, unknown>): Partial<ProductLabelValues> {
    if (Object.keys(input).some(key => !keySet.has(key))) throw Error('등록된 표시사항 항목만 저장할 수 있습니다.');
    for (const item of Object.values(input)) if (textIssues(item).length) throw Error('표시사항은 항목마다 2,000자 이하의 일반 텍스트여야 합니다.');
    return { ...input } as Partial<ProductLabelValues>;
  }
  const options: ProductLabelOverrides['options'] = {};
  for (const [id, input] of Object.entries(value.options)) {
    if (!safeOption(id) || !record(input)) throw Error('표시사항에 연결된 옵션을 확인해주세요.');
    Object.defineProperty(options, id, { value: values(input), enumerable: true, writable: true, configurable: true });
  }
  return { common: values(value.common), options };
}

export function validateProductLabelChanges(value: unknown, optionIds: readonly string[]): ProductLabelChange[] {
  if (!Array.isArray(value) || !value.length || value.length > 200) throw Error('표시사항 변경 항목은 1~200개여야 합니다.');
  const seen = new Set<string>();
  return value.map(input => {
    if (!record(input) || Object.keys(input).some(key => !['optionId', 'fieldKey', 'value'].includes(key))
      || !keySet.has(String(input.fieldKey)) || typeof input.fieldKey !== 'string'
      || input.optionId !== null && (!safeOption(input.optionId) || !optionIds.includes(input.optionId))
      || input.value !== null && textIssues(input.value).length) throw Error('이 상품의 옵션과 등록된 표시사항 항목·일반 텍스트를 확인해주세요.');
    const identity = JSON.stringify([input.optionId, input.fieldKey]);
    if (seen.has(identity)) throw Error('동일한 표시사항 변경이 중복됐습니다.'); seen.add(identity);
    return { optionId: input.optionId as string | null, fieldKey: input.fieldKey as ProductLabelKey, value: input.value as string | null };
  });
}

export function applyProductLabelChanges(current: ProductLabelOverrides, changes: readonly ProductLabelChange[]): ProductLabelOverrides {
  const next = validateProductLabelOverrides(current);
  const checked = validateProductLabelChanges(changes, changes.flatMap(change => typeof change?.optionId === 'string' ? [change.optionId] : []));
  for (const change of checked) {
    const values = change.optionId === null ? next.common : Object.hasOwn(next.options, change.optionId) ? next.options[change.optionId]
      : Object.defineProperty(next.options, change.optionId, { value: {}, enumerable: true, writable: true, configurable: true })[change.optionId];
    if (change.value === null) delete values[change.fieldKey]; else values[change.fieldKey] = change.value;
    if (change.optionId !== null && !Object.keys(values).length) delete next.options[change.optionId];
  }
  return next;
}

/** Nine product-label sources stay separate from category legal notice wires.
 * Explicit saved blanks are facts about the draft, not a request to invent a
 * country, material, count, product type or age standard. */
export function resolveProductLabels(input: { productId: string; state: ProductLabelsState; content: ProductContent; options: ProductOptions; quotation: QuotationFieldsView; settings: { manufacturer?: string; importer?: string; handlingPrecautions?: string } }): ProductLabelRow[] {
  const target = exactPrimaryQuotationTarget(input.quotation.resolved.schema.fields, 'title');
  if (input.content.productId !== input.productId || input.options.productId !== input.productId || input.state.productId !== input.productId) throw Error('표시사항의 상품 자료가 일치하지 않습니다.');
  return input.quotation.resolved.rows.map(row => {
    if (row.optionId !== null && !input.options.rows.some(option => option.id === row.optionId)) throw Error('표시사항에 연결된 옵션이 삭제되었습니다.');
    const automatic = {} as ProductLabelValues, sources = {} as Record<ProductLabelKey, ProductLabelSource>;
    for (const { key } of productLabelFields) {
      const field = input.content.label[key], stored = field?.value ?? '';
      if (key === 'productName' && (input.content.labelProductNameLinked === true || field?.provenance !== 'manual')) {
        const title = row.fields[target.primary]?.value;
        if (typeof title !== 'string') throw Error('선택 옵션의 저장된 SEO 상품명을 확인하지 못했습니다.');
        automatic[key] = title; sources[key] = title ? 'quotation' : 'empty';
      } else if (field?.provenance === 'manual' || stored) {
        automatic[key] = stored; sources[key] = 'content';
      } else {
        const setting = key === 'manufacturer' ? input.settings.manufacturer : key === 'importer' ? input.settings.importer : key === 'precautions' ? input.settings.handlingPrecautions : undefined;
        automatic[key] = typeof setting === 'string' ? setting : ''; sources[key] = automatic[key] ? 'settings' : 'empty';
      }
    }
    const values = { ...automatic };
    for (const { key } of productLabelFields) {
      const specific = row.optionId === null || !Object.hasOwn(input.state.overrides.options, row.optionId) ? undefined : input.state.overrides.options[row.optionId];
      if (specific && Object.hasOwn(specific, key)) { values[key] = specific[key]!; sources[key] = 'manual-option'; }
      else if (Object.hasOwn(input.state.overrides.common, key)) { values[key] = input.state.overrides.common[key]!; sources[key] = 'manual-common'; }
    }
    return { optionId: row.optionId, optionLabel: row.optionLabel, included: row.included, values, automatic, sources };
  });
}

export function productLabelPlan(view: ProductLabelsView, optionId: string | null): DocumentImagePlan & { format: 'product-label' } {
  verifyProductLabelsView(view, optionId);
  const row = view.rows.find(row => row.optionId === optionId)!;
  if (optionId !== null && !row.included) throw Error('견적에 포함된 옵션을 선택해주세요.');
  if (!Object.values(row.values).some(value => value.trim())) throw Error('표시사항을 한 항목 이상 저장한 뒤 이미지를 만들어주세요.');
  return { format: 'product-label', title: '', subtitle: '', width: 800, columnWidths: [240, 480], headers: [],
    rows: productLabelFields.map(field => [field.label, row.values[field.key]]), footer: '' };
}

export function verifyProductLabelsView(view: ProductLabelsView, optionId: string | null, profileId?: string) {
  const category = view?.categoryContext;
  if (!view || typeof view.productId !== 'string' || !/^\w[\w-]{0,99}$/.test(view.productId) || !Number.isSafeInteger(view.revision) || view.revision < 0
    || !Number.isFinite(Date.parse(view.productVersion)) || !/^[a-f0-9]{64}$/.test(view.inputFingerprint)
    || !/^[a-f0-9]{64}$/.test(view.quotationInputFingerprint) || ![view.contentRevision, view.optionRevision, view.quotationRevision].every(value => Number.isSafeInteger(value) && value >= 0)
    || !Array.isArray(view.imageKeys) || view.imageKeys.length > 50 || new Set(view.imageKeys).size !== view.imageKeys.length
    || view.imageKeys.some(key => typeof key !== 'string' || !key || key.length > 512 || /[\u0000-\u001f\u007f]/u.test(key))
    || !category || !['profile', 'collection', 'unknown'].includes(category.source) || !/^\d{1,20}$/.test(category.categoryId ?? '')
    || category.profileId !== null && (typeof category.profileId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(category.profileId))
    || !Array.isArray(category.categoryPath) || !category.categoryPath.length || category.categoryPath.length > 20
    || category.categoryPath.some(part => typeof part !== 'string' || !part.trim() || textIssues(part).length)
    || profileId && category.profileId !== profileId || view.updatedAt !== null && !Number.isFinite(Date.parse(view.updatedAt))
    || !Array.isArray(view.rows) || !view.rows.length || view.rows.length > 201 || view.rows.some(row => !record(row)) || view.rows.filter(row => row.optionId === null).length !== 1
    || view.rows.filter(row => row.optionId === optionId).length !== 1 || new Set(view.rows.map(row => row.optionId)).size !== view.rows.length)
    throw Error('선택한 상품·옵션의 표시사항 저장본을 확인하지 못했습니다.');
  validateProductLabelOverrides(view.overrides);
  for (const row of view.rows) {
    if (row.optionId !== null && !safeOption(row.optionId) || textIssues(row.optionLabel).length || typeof row.included !== 'boolean'
      || !record(row.values) || !record(row.automatic) || !record(row.sources)
      || [row.values, row.automatic, row.sources].some(values => Object.keys(values).some(key => !keySet.has(key)))
      || productLabelFields.some(({ key }) => textIssues(row.values[key]).length || textIssues(row.automatic[key]).length
        || !['manual-option', 'manual-common', 'content', 'quotation', 'settings', 'empty'].includes(row.sources[key]))) throw Error('저장된 표시사항 값과 원천을 확인하지 못했습니다.');
    for (const { key } of productLabelFields) {
      const specific = row.optionId === null || !Object.hasOwn(view.overrides.options, row.optionId) ? undefined : view.overrides.options[row.optionId];
      const own = specific && Object.hasOwn(specific, key), common = Object.hasOwn(view.overrides.common, key);
      const value = own ? specific![key] : common ? view.overrides.common[key] : row.automatic[key];
      const source = own ? 'manual-option' : common ? 'manual-common' : null;
      if (row.values[key] !== value || (source ? row.sources[key] !== source : row.sources[key].startsWith('manual-')))
        throw Error('저장된 표시사항의 옵션·공통·자동값 연결을 확인하지 못했습니다.');
    }
  }
}

export function productLabelValue(view: ProductLabelsView, optionId: string | null, key: ProductLabelKey, draft: ProductLabelDraft = {}) {
  const row = view.rows.find(row => row.optionId === optionId); if (!row) throw Error('선택 옵션을 확인해주세요.');
  if (!Object.hasOwn(draft, key)) return row.values[key];
  const value = draft[key]; if (value !== null && value !== undefined) return value;
  return optionId !== null && Object.hasOwn(view.overrides.common, key) ? view.overrides.common[key]! : row.automatic[key];
}
export function productLabelChanges(view: ProductLabelsView, optionId: string | null, draft: ProductLabelDraft): ProductLabelChange[] {
  verifyProductLabelsView(view, optionId);
  return validateProductLabelChanges(Object.keys(draft).map(key => ({ optionId, fieldKey: key, value: draft[key as ProductLabelKey] })), view.rows.flatMap(row => row.optionId ? [row.optionId] : []));
}
export function productLabelDraftIssues(view: ProductLabelsView, optionId: string | null, draft: ProductLabelDraft) {
  return Object.keys(draft).flatMap(key => !keySet.has(key) ? ['등록된 표시사항 항목을 선택해주세요.'] : textIssues(productLabelValue(view, optionId, key as ProductLabelKey, draft)));
}
export function verifyProductLabelSave(before: ProductLabelsView, saved: ProductLabelsView, optionId: string | null, draft: ProductLabelDraft) {
  verifyProductLabelsView(saved, optionId);
  const changes = productLabelChanges(before, optionId, draft);
  if (saved.productId !== before.productId || saved.revision !== before.revision + 1 || saved.updatedAt !== saved.productVersion
    || Date.parse(saved.productVersion) <= Date.parse(before.productVersion) || saved.contentRevision !== before.contentRevision
    || saved.optionRevision !== before.optionRevision || saved.quotationRevision !== before.quotationRevision
    || !same(saved.imageKeys, before.imageKeys) || !same(saved.categoryContext, before.categoryContext)
    || !same(saved.rows.map(row => [row.optionId, row.optionLabel, row.included, row.automatic]), before.rows.map(row => [row.optionId, row.optionLabel, row.included, row.automatic]))
    || !same(saved.overrides, applyProductLabelChanges(before.overrides, changes))) throw Error('표시사항 저장 버전과 선택 옵션 저장값을 확인하지 못했습니다. 입력은 유지했습니다.');
  const row = saved.rows.find(row => row.optionId === optionId)!;
  if (changes.some(change => row.values[change.fieldKey] !== (change.value === null ? productLabelValue(saved, optionId, change.fieldKey, { [change.fieldKey]: null }) : change.value))) throw Error('저장 응답의 표시사항이 요청한 값과 다릅니다.');
}
export function verifyProductLabelRefresh(before: ProductLabelsView, latest: ProductLabelsView, optionId: string | null, draft: ProductLabelDraft) {
  verifyProductLabelsView(latest, optionId);
  if (latest.productId !== before.productId || latest.revision < before.revision || Date.parse(latest.productVersion) < Date.parse(before.productVersion)
    || !same(latest.categoryContext, before.categoryContext)) throw Error('옵션 또는 카테고리가 변경되었습니다. 입력은 유지했습니다.');
  for (const key of Object.keys(draft) as ProductLabelKey[]) {
    const old = (optionId === null ? before.overrides.common : Object.hasOwn(before.overrides.options, optionId) ? before.overrides.options[optionId] : undefined)?.[key] ?? null;
    const current = (optionId === null ? latest.overrides.common : Object.hasOwn(latest.overrides.options, optionId) ? latest.overrides.options[optionId] : undefined)?.[key] ?? null;
    if (old !== current && current !== draft[key]) throw Error('선택 옵션 표시사항에 다른 저장값이 있습니다. 입력을 보관한 뒤 저장본과 비교해주세요.');
  }
  if (Object.keys(draft).length) productLabelChanges(latest, optionId, draft);
}
