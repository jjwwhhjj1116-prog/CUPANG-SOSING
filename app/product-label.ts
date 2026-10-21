import { PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-pool-limit';
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
export type ProductLabelFixedKey = (typeof productLabelFields)[number]['key'];
export type ProductLabelKey = ProductLabelFixedKey | `custom_${string}`;
export type ProductLabelStructure = { id: ProductLabelKey; label: string; required: boolean }[];
export type ProductLabelValues = Record<ProductLabelKey, string>;
export type ProductLabelDraft = Partial<Record<ProductLabelKey, string | null>>;
export type ProductLabelSource = 'manual-option' | 'manual-common' | 'content' | 'quotation' | 'settings' | 'empty';
export type ProductLabelOverrides = { common: Partial<ProductLabelValues>; options: Record<string, Partial<ProductLabelValues>> };
export type ProductLabelChange = { optionId: string | null; fieldKey: ProductLabelKey; value: string | null };
export type ProductLabelsState = { schemaVersion: 1; productId: string; revision: number; overrides: ProductLabelOverrides; updatedAt: string | null; structure?: ProductLabelStructure; renderEpoch?: number };
export type ProductLabelRow = { optionId: string | null; optionLabel: string; included: boolean; values: ProductLabelValues; automatic: ProductLabelValues; sources: Record<ProductLabelKey, ProductLabelSource> };
export type ProductLabelsView = {
  productId: string; revision: number; inputFingerprint: string; productVersion: string;
  contentRevision: number; optionRevision: number; quotationRevision: number; quotationInputFingerprint: string;
  categoryContext: QuotationFieldsView['categoryContext']; imageKeys: string[];
  overrides: ProductLabelOverrides; rows: ProductLabelRow[]; updatedAt: string | null; structure?: ProductLabelStructure; renderEpoch?: number;
};
export const PRODUCT_LABEL_BODY_LIMIT = 96 * 1024;
export const PRODUCT_LABEL_STORAGE_LIMIT = 512 * 1024;
const keySet = new Set<string>(productLabelFields.map(field => field.key));
const labelKey = (value: unknown): value is ProductLabelKey => typeof value === 'string' && (keySet.has(value) || value.length <= 80 && /^custom_[A-Za-z0-9_-]+$/.test(value));
const safeOption = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const textIssues = (value: unknown) => typeof value !== 'string' ? ['일반 텍스트를 입력해주세요.']
  : [...(value.length > 2000 ? ['항목마다 2,000자 이하로 입력해주세요.'] : []), ...(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value) ? ['제어문자를 제거해주세요.'] : [])];
export const emptyProductLabelOverrides = (): ProductLabelOverrides => ({ common: {}, options: {} });

/** Absence is the unchanged legacy generation. Only a server rewrite advances
 * the positive epoch; ordinary value/structure saves must preserve it. */
export function validateProductLabelRenderEpoch(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw Error('표시사항 재작성 버전을 확인해주세요.');
  return value;
}

/** The default is intentionally absent from legacy storage and responses.
 * These getters also retain incomplete local headings while the user edits. */
export function productLabelStructure(source?: { structure?: ProductLabelStructure }): ProductLabelStructure {
  return source?.structure?.map(field => ({ ...field })) ?? productLabelFields.map(field => ({ id: field.key, label: field.label, required: field.key === 'productName' }));
}
/** Freeze the observed Couplus order only for a genuinely new product or an
 * explicit reviewed restore. An absent stored structure remains legacy. */
export function couplusProductLabelStructure(): ProductLabelStructure {
  const order: ProductLabelFixedKey[] = ['productName','importer','manufacturer','countryOfOrigin','netContents','material','productType','precautions','usageStandard'];
  return order.map(key => { const field = productLabelFields.find(field => field.key === key)!; return { id: key, label: field.label, required: key === 'productName' }; });
}
export function productLabelDefinitions(source?: { structure?: ProductLabelStructure }) {
  return productLabelStructure(source).map(field => ({ key: field.id, label: field.label, required: field.required }));
}
export function validateProductLabelStructure(value: unknown): ProductLabelStructure {
  if (!Array.isArray(value) || value.length < 1 || value.length > 39) throw Error('표시사항 항목은 제품명을 포함해 1~39개여야 합니다.');
  const seen = new Set<string>();
  const fields = value.map(field => {
    if (!record(field) || Object.keys(field).length !== 3 || !['id', 'label', 'required'].every(key => Object.hasOwn(field, key))
      || !labelKey(field.id) || seen.has(field.id) || typeof field.label !== 'string' || !field.label.trim() || field.label.trim().length > 80
      || /[\u0000-\u001f\u007f]/u.test(field.label) || field.required !== (field.id === 'productName')) throw Error('표시사항 항목의 ID·항목명·필수 여부를 확인해주세요. 항목명은 80자 이내여야 합니다.');
    seen.add(field.id);
    return { id: field.id, label: field.label.trim(), required: field.required as boolean };
  });
  if (!seen.has('productName')) throw Error('필수 제품명 항목은 삭제할 수 없습니다.');
  return fields;
}

export function validateProductLabelOverrides(value: unknown): ProductLabelOverrides {
  if (!record(value) || Object.keys(value).some(key => !['common', 'options'].includes(key)) || !record(value.common) || !record(value.options)
    || Object.keys(value.options).length > 200) throw Error('표시사항 저장 형식을 확인해주세요.');
  function values(input: Record<string, unknown>): Partial<ProductLabelValues> {
    // Removed fields remain archived so restoring their structure restores the
    // user's values. Only change validation uses the currently active IDs.
    if (Object.keys(input).some(key => !labelKey(key))) throw Error('등록된 표시사항 항목만 저장할 수 있습니다.');
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

export function validateProductLabelChanges(value: unknown, optionIds: readonly string[], structure?: ProductLabelStructure, allowEmpty = false): ProductLabelChange[] {
  if (!Array.isArray(value) || !value.length && !allowEmpty || value.length > 200) throw Error('표시사항 변경 항목은 1~200개여야 합니다.');
  const active = new Set((structure === undefined ? productLabelStructure() : validateProductLabelStructure(structure)).map(field => field.id));
  const seen = new Set<string>();
  return value.map(input => {
    if (!record(input) || Object.keys(input).some(key => !['optionId', 'fieldKey', 'value'].includes(key))
      || !labelKey(input.fieldKey) || !active.has(input.fieldKey)
      || input.optionId !== null && (!safeOption(input.optionId) || !optionIds.includes(input.optionId))
      || input.value !== null && textIssues(input.value).length) throw Error('이 상품의 옵션과 등록된 표시사항 항목·일반 텍스트를 확인해주세요.');
    const identity = JSON.stringify([input.optionId, input.fieldKey]);
    if (seen.has(identity)) throw Error('동일한 표시사항 변경이 중복됐습니다.'); seen.add(identity);
    return { optionId: input.optionId as string | null, fieldKey: input.fieldKey as ProductLabelKey, value: input.value as string | null };
  });
}

export function applyProductLabelChanges(current: ProductLabelOverrides, changes: readonly ProductLabelChange[], structure?: ProductLabelStructure): ProductLabelOverrides {
  const next = validateProductLabelOverrides(current);
  const checked = validateProductLabelChanges(changes, changes.flatMap(change => typeof change?.optionId === 'string' ? [change.optionId] : []), structure, true);
  for (const change of checked) {
    const values = change.optionId === null ? next.common : Object.hasOwn(next.options, change.optionId) ? next.options[change.optionId]
      : Object.defineProperty(next.options, change.optionId, { value: {}, enumerable: true, writable: true, configurable: true })[change.optionId];
    if (change.value === null) delete values[change.fieldKey]; else values[change.fieldKey] = change.value;
    if (change.optionId !== null && !Object.keys(values).length) delete next.options[change.optionId];
  }
  return next;
}

/** Product-label sources stay separate from category legal notice wires.
 * Explicit saved blanks are facts about the draft, not a request to invent a
 * country, material, count, product type or age standard. */
export function resolveProductLabels(input: { productId: string; state: ProductLabelsState; content: ProductContent; options: ProductOptions; quotation: QuotationFieldsView; settings: { manufacturer?: string; importer?: string; handlingPrecautions?: string } }): ProductLabelRow[] {
  const target = exactPrimaryQuotationTarget(input.quotation.resolved.schema.fields, 'title');
  if (input.content.productId !== input.productId || input.options.productId !== input.productId || input.state.productId !== input.productId) throw Error('표시사항의 상품 자료가 일치하지 않습니다.');
  if (Object.hasOwn(input.state, 'renderEpoch') && validateProductLabelRenderEpoch(input.state.renderEpoch) === undefined) throw Error('표시사항 재작성 버전을 확인해주세요.');
  const definitions = productLabelDefinitions({ structure: input.state.structure === undefined ? undefined : validateProductLabelStructure(input.state.structure) });
  return input.quotation.resolved.rows.map(row => {
    if (row.optionId !== null && !input.options.rows.some(option => option.id === row.optionId)) throw Error('표시사항에 연결된 옵션이 삭제되었습니다.');
    const automatic = {} as ProductLabelValues, sources = {} as Record<ProductLabelKey, ProductLabelSource>;
    for (const { key } of definitions) {
      const field = keySet.has(key) ? input.content.label[key as ProductLabelFixedKey] : undefined, stored = field?.value ?? '';
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
    for (const { key } of definitions) {
      const specific = row.optionId === null || !Object.hasOwn(input.state.overrides.options, row.optionId) ? undefined : input.state.overrides.options[row.optionId];
      if (specific && Object.hasOwn(specific, key)) { values[key] = specific[key]!; sources[key] = 'manual-option'; }
      else if (Object.hasOwn(input.state.overrides.common, key)) { values[key] = input.state.overrides.common[key]!; sources[key] = 'manual-common'; }
    }
    return { optionId: row.optionId, optionLabel: row.optionLabel, included: row.included, values, automatic, sources };
  });
}

export function productLabelPlan(view: ProductLabelsView, optionId: string | null, options: { includeEmpty?: boolean } = {}): DocumentImagePlan & { format: 'product-label' } {
  verifyProductLabelsView(view, optionId);
  const row = view.rows.find(row => row.optionId === optionId)!;
  if (optionId !== null && !row.included) throw Error('견적에 포함된 옵션을 선택해주세요.');
  // Couplus's renderer tests string truthiness: whitespace is printable data.
  // Keep all-empty drafts editable, but do not invent an empty PNG document.
  if (!Object.values(row.values).some(value => value !== '')) throw Error('표시사항을 한 항목 이상 저장한 뒤 이미지를 만들어주세요.');
  return { format: 'product-label', title: '', subtitle: '', width: 800, columnWidths: [240, 480], headers: [],
    rows: productLabelDefinitions(view).filter(field => options.includeEmpty === true || row.values[field.key] !== '').map(field => [field.label, row.values[field.key]]), footer: '' };
}

export function verifyProductLabelsView(view: ProductLabelsView, optionId: string | null, profileId?: string) {
  const category = view?.categoryContext;
  if (!view || typeof view.productId !== 'string' || !/^\w[\w-]{0,99}$/.test(view.productId) || !Number.isSafeInteger(view.revision) || view.revision < 0
    || !Number.isFinite(Date.parse(view.productVersion)) || !/^[a-f0-9]{64}$/.test(view.inputFingerprint)
    || !/^[a-f0-9]{64}$/.test(view.quotationInputFingerprint) || ![view.contentRevision, view.optionRevision, view.quotationRevision].every(value => Number.isSafeInteger(value) && value >= 0)
    || !Array.isArray(view.imageKeys) || view.imageKeys.length > PRODUCT_IMAGE_POOL_LIMIT || new Set(view.imageKeys).size !== view.imageKeys.length
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
  if (Object.hasOwn(view, 'renderEpoch') && validateProductLabelRenderEpoch(view.renderEpoch) === undefined) throw Error('표시사항 재작성 버전을 확인해주세요.');
  const structure = view.structure === undefined ? undefined : validateProductLabelStructure(view.structure);
  if (!same(structure, view.structure)) throw Error('표시사항 항목 구성이 정규화된 저장본과 다릅니다.');
  const definitions = productLabelDefinitions({ structure }), active = new Set(definitions.map(field => field.key));
  for (const row of view.rows) {
    if (row.optionId !== null && !safeOption(row.optionId) || textIssues(row.optionLabel).length || typeof row.included !== 'boolean'
      || !record(row.values) || !record(row.automatic) || !record(row.sources)
      || [row.values, row.automatic, row.sources].some(values => Object.keys(values).length !== active.size || Object.keys(values).some(key => !active.has(key as ProductLabelKey)))
      || definitions.some(({ key }) => textIssues(row.values[key]).length || textIssues(row.automatic[key]).length
        || !keySet.has(key) && row.automatic[key] !== ''
        || !['manual-option', 'manual-common', 'content', 'quotation', 'settings', 'empty'].includes(row.sources[key]))) throw Error('저장된 표시사항 값과 원천을 확인하지 못했습니다.');
    for (const { key } of definitions) {
      const specific = row.optionId === null || !Object.hasOwn(view.overrides.options, row.optionId) ? undefined : view.overrides.options[row.optionId];
      const own = specific && Object.hasOwn(specific, key), common = Object.hasOwn(view.overrides.common, key);
      const value = own ? specific![key] : common ? view.overrides.common[key] : row.automatic[key];
      const source = own ? 'manual-option' : common ? 'manual-common' : null;
      if (row.values[key] !== value || (source ? row.sources[key] !== source : row.sources[key].startsWith('manual-'))
        || !keySet.has(key) && !source && row.sources[key] !== 'empty')
        throw Error('저장된 표시사항의 옵션·공통·자동값 연결을 확인하지 못했습니다.');
    }
  }
}

export function productLabelValue(view: ProductLabelsView, optionId: string | null, key: ProductLabelKey, draft: ProductLabelDraft = {}) {
  const row = view.rows.find(row => row.optionId === optionId); if (!row) throw Error('선택 옵션을 확인해주세요.');
  if (!Object.hasOwn(draft, key)) {
    if (Object.hasOwn(row.values, key)) return row.values[key];
    const own = optionId !== null && Object.hasOwn(view.overrides.options, optionId) ? view.overrides.options[optionId] : undefined;
    return own && Object.hasOwn(own, key) ? own[key]! : view.overrides.common[key] ?? row.automatic[key] ?? '';
  }
  const value = draft[key]; if (value !== null && value !== undefined) return value;
  return optionId !== null && Object.hasOwn(view.overrides.common, key) ? view.overrides.common[key]! : row.automatic[key] ?? '';
}
export function productLabelChanges(view: ProductLabelsView, optionId: string | null, draft: ProductLabelDraft, structure?: ProductLabelStructure): ProductLabelChange[] {
  verifyProductLabelsView(view, optionId);
  return validateProductLabelChanges(Object.keys(draft).map(key => ({ optionId, fieldKey: key, value: draft[key as ProductLabelKey] })), view.rows.flatMap(row => row.optionId ? [row.optionId] : []), structure ?? view.structure, structure !== undefined);
}
export function productLabelDraftIssues(view: ProductLabelsView, optionId: string | null, draft: ProductLabelDraft, structure?: ProductLabelStructure) {
  try {
    const active = new Set(validateProductLabelStructure(structure ?? productLabelStructure(view)).map(field => field.id));
    return Object.keys(draft).flatMap(key => !active.has(key as ProductLabelKey) ? ['등록된 표시사항 항목을 선택해주세요.'] : textIssues(productLabelValue(view, optionId, key as ProductLabelKey, draft)));
  } catch (error) { return [error instanceof Error ? error.message : '표시사항 항목 구성을 확인해주세요.']; }
}
export function verifyProductLabelSave(before: ProductLabelsView, saved: ProductLabelsView, optionId: string | null, draft: ProductLabelDraft, structure?: ProductLabelStructure) {
  verifyProductLabelsView(saved, optionId);
  const changes = productLabelChanges(before, optionId, draft, structure);
  const expectedStructure = structure === undefined ? before.structure : validateProductLabelStructure(structure);
  if (saved.productId !== before.productId || saved.revision !== before.revision + 1 || saved.updatedAt !== saved.productVersion
    || Date.parse(saved.productVersion) <= Date.parse(before.productVersion) || saved.contentRevision !== before.contentRevision
    || saved.optionRevision !== before.optionRevision || saved.quotationRevision !== before.quotationRevision
    || !same(saved.imageKeys, before.imageKeys) || !same(saved.categoryContext, before.categoryContext) || !same(saved.structure, expectedStructure) || saved.renderEpoch !== before.renderEpoch
    || !same(saved.rows.map(row => [row.optionId, row.optionLabel, row.included]), before.rows.map(row => [row.optionId, row.optionLabel, row.included]))
    || saved.rows.some((row, index) => productLabelDefinitions(saved).some(({ key }) => Object.hasOwn(before.rows[index].automatic, key) && row.automatic[key] !== before.rows[index].automatic[key]))
    || !same(saved.overrides, applyProductLabelChanges(before.overrides, changes, expectedStructure))) throw Error('표시사항 저장 버전과 선택 옵션 저장값을 확인하지 못했습니다. 입력은 유지했습니다.');
  const row = saved.rows.find(row => row.optionId === optionId)!;
  if (changes.some(change => row.values[change.fieldKey] !== (change.value === null ? productLabelValue(saved, optionId, change.fieldKey, { [change.fieldKey]: null }) : change.value))) throw Error('저장 응답의 표시사항이 요청한 값과 다릅니다.');
}
export function verifyProductLabelRefresh(before: ProductLabelsView, latest: ProductLabelsView, optionId: string | null, draft: ProductLabelDraft, structure?: ProductLabelStructure, acceptStructureChange = false) {
  verifyProductLabelsView(latest, optionId);
  if (acceptStructureChange && (Object.keys(draft).length || structure !== undefined)) throw Error('작성 중인 표시사항을 보존하거나 취소한 뒤 최신 항목 구성을 불러와주세요.');
  if (latest.productId !== before.productId || latest.revision < before.revision || Date.parse(latest.productVersion) < Date.parse(before.productVersion)
    || !same(latest.categoryContext, before.categoryContext)
    || !acceptStructureChange && (latest.renderEpoch !== before.renderEpoch || !same(latest.structure, before.structure) && (structure === undefined || !same(latest.structure, validateProductLabelStructure(structure))))) throw Error('옵션 또는 카테고리·항목 구성·재작성 버전이 변경되었습니다. 입력은 유지했습니다.');
  for (const key of Object.keys(draft) as ProductLabelKey[]) {
    const old = (optionId === null ? before.overrides.common : Object.hasOwn(before.overrides.options, optionId) ? before.overrides.options[optionId] : undefined)?.[key] ?? null;
    const current = (optionId === null ? latest.overrides.common : Object.hasOwn(latest.overrides.options, optionId) ? latest.overrides.options[optionId] : undefined)?.[key] ?? null;
    if (old !== current && current !== draft[key]) throw Error('선택 옵션 표시사항에 다른 저장값이 있습니다. 입력을 보관한 뒤 저장본과 비교해주세요.');
  }
  if (Object.keys(draft).length || structure !== undefined) productLabelChanges(latest, optionId, draft, structure);
}
