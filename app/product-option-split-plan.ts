import type { ProductContent } from '@/app/product-content';
import type { ProductLabelsState, ProductLabelOverrides } from '@/app/product-label';
import type { ProductOptions } from '@/app/product-options';
import type { QuotationPackagingBasis, QuotationPackagingFact } from '@/app/quotation-packaging-basis';
import type { QuotationOverrides } from '@/app/quotation-schema';
import type { ProductRecord } from '@/db/queries';
import type { QuotationFieldsState } from '@/db/quotation-fields';

export const OPTION_SPLIT_GROUP_LIMIT = 20;
export type ProductOptionSplitGroup = { label: string; productId: string; optionIds: string[]; optionIdMap: Record<string, string> };
type SplitSource = { product: ProductRecord; content: ProductContent; options: ProductOptions; quotation: QuotationFieldsState; labels: ProductLabelsState };
type SplitPlannedGroup = { label: string; retainsSource: boolean; product: ProductRecord; content: ProductContent; options: ProductOptions;
  quotation: QuotationFieldsState; labels: ProductLabelsState; optionIdMap: Record<string, string>; sourceOptionIds: string[] };
type LabelScopes = ProductLabelsState & { categoryOverrides?: Record<string, ProductLabelOverrides> };
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/u.test(value)
  && !['__proto__', 'constructor', 'prototype'].includes(value);
const freshUuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const has = (value: object, key: string) => Object.hasOwn(value, key);
const invalid = (message: string): never => { throw Error(message); };

function mappedSubset<T>(values: Record<string, T>, ids: readonly string[], mapping: Record<string, string>): Record<string, T> {
  if (!record(values)) return invalid('옵션별 저장 자료를 읽지 못했습니다. 저장본을 다시 불러와주세요.');
  return Object.fromEntries(ids.filter(id => has(values, id)).map(id => [mapping[id], structuredClone(values[id])]));
}
function subsetOverrides<T extends { common: object; options: Record<string, object> }>(values: T, ids: readonly string[], mapping: Record<string, string>): T {
  if (!record(values) || !record(values.common) || !record(values.options)) return invalid('공통·옵션별 수정값을 읽지 못했습니다. 저장본을 다시 불러와주세요.');
  return { ...structuredClone(values), options: mappedSubset(values.options, ids, mapping) };
}
function subsetBasis(basis: QuotationPackagingBasis, ids: readonly string[], mapping: Record<string, string>): QuotationPackagingBasis {
  if (!record(basis) || !record(basis.common) || !record(basis.options)) return invalid('저장된 포장 확인 기준을 읽지 못했습니다. 저장본을 다시 불러와주세요.');
  const facts = (values: Record<string, QuotationPackagingFact>) => {
    if (!record(values)) return invalid('옵션별 포장 확인 기준을 읽지 못했습니다. 저장본을 다시 불러와주세요.');
    return Object.fromEntries(Object.entries(values).map(([key, fact]) => {
      if (!record(fact) || !record(fact.unitsPerPack)) return invalid('포장 구성 수량의 확인 기준을 읽지 못했습니다. 저장본을 다시 불러와주세요.');
      return [key, { ...structuredClone(fact), unitsPerPack: mappedSubset(fact.unitsPerPack, ids, mapping) }];
    }));
  };
  const selected = mappedSubset(basis.options, ids, mapping);
  return { ...structuredClone(basis), common: facts(basis.common), options: Object.fromEntries(Object.entries(selected).map(([id, values]) => [id, facts(values)])) };
}
function mapScopes<T, U>(scopes: Record<string, T>, apply: (value: T) => U): Record<string, U> {
  if (!record(scopes)) return invalid('카테고리별 저장 자료를 읽지 못했습니다. 저장본을 다시 불러와주세요.');
  return Object.fromEntries(Object.entries(scopes).map(([key, value]) => [key, apply(value)]));
}
function titleWithLabel(title: string, label: string): string {
  if (typeof title !== 'string') return invalid('저장된 상품명을 읽지 못했습니다. 저장본을 다시 불러와주세요.');
  const value = `${title}, ${label}`;
  if (value.length > 500) return invalid('분할 이름을 붙인 상품명은 500자 이하여야 합니다. 상품명이나 분할 이름을 줄여주세요.');
  return value;
}
function splitContent(source: ProductContent, productId: string, label: string, retainsSource: boolean, now: string): ProductContent {
  const content = structuredClone(source), title = source.seo.title, proof = source.seoTitleDocument;
  const validTitleProof = record(proof) && Object.keys(proof).length === 4 && proof.policy === 'couplus-seo-save-v1'
    && (title.value || title.provenance === 'manual') && proof.sourceTitle === title.value && proof.value === title.value
    && proof.sourceUpdatedAt === title.updatedAt && (proof.sourceUpdatedAt === null || typeof proof.sourceUpdatedAt === 'string' && Number.isFinite(Date.parse(proof.sourceUpdatedAt)));
  content.productId = productId; content.revision = retainsSource ? source.revision + 1 : 1; content.updatedAt = now;
  if (title.value) content.seo.title = { ...title, value: titleWithLabel(title.value, label), updatedAt: now };
  if (validTitleProof) content.seoTitleDocument = { policy: 'couplus-seo-save-v1', sourceTitle: content.seo.title.value,
    sourceUpdatedAt: content.seo.title.updatedAt, value: content.seo.title.value };
  else delete content.seoTitleDocument;
  const keywords = content.seo.keywords, document = content.seoKeywordDocument;
  if (document && (document.policy !== 'couplus-service-v1' || document.sourceUpdatedAt !== keywords.updatedAt || !Array.isArray(document.sourceKeywords)
    || document.sourceKeywords.length !== keywords.value.length || document.sourceKeywords.some((word, index) => word !== keywords.value[index]))) delete content.seoKeywordDocument;
  delete content.intakeSeoGuidancePending;
  if (!retainsSource) delete content.intakeKeywordSeed;
  return content;
}

/** A reviewed partition only: no AI classification, persistence, ID allocation,
 * source-lineage inference, or registration evidence is produced here. */
export function planProductOptionSplit(source: SplitSource, groups: readonly ProductOptionSplitGroup[], now: string): { sourceProductId: string; groups: SplitPlannedGroup[] } {
  if (!source || !record(source.product) || !safeId(source.product.id) || !record(source.options) || !Array.isArray(source.options.rows)
    || source.options.rows.length < 2 || source.options.rows.length > 200) return invalid('분할할 원본 옵션 2~200개를 저장본에서 다시 확인해주세요.');
  if (typeof now !== 'string' || !Number.isFinite(Date.parse(now))) return invalid('분할 저장 시각을 확인해주세요.');
  for (const state of [source.content, source.options, source.quotation, source.labels]) {
    if (!record(state) || state.productId !== source.product.id || !Number.isSafeInteger(state.revision) || state.revision < 0 || state.revision >= Number.MAX_SAFE_INTEGER)
      return invalid('원본 상품과 저장 자료의 ID·버전이 일치하지 않습니다. 저장본을 다시 불러와주세요.');
  }
  if (source.options.bundleSources !== undefined && (!record(source.options.bundleSources) || Object.keys(source.options.bundleSources).length > 0))
    return invalid('번들 원본 연결이나 삭제 이력이 있는 상품은 분할할 수 없습니다. 번들이 없는 상품에서 옵션을 나눠주세요.');
  if (source.content.legalDocuments !== undefined && (!record(source.content.legalDocuments) || !Array.isArray(source.content.legalDocuments.files) || source.content.legalDocuments.files.length > 0))
    return invalid('상품에 연결된 법적 첨부 원본은 새 상품으로 복사할 수 없습니다. 첨부가 없는 상품에서 분할해주세요.');
  if (!record(source.content.seo) || !record(source.content.seo.title) || typeof source.content.seo.title.value !== 'string'
    || !record(source.content.seo.keywords) || !Array.isArray(source.content.seo.keywords.value)) return invalid('저장된 SEO 자료를 다시 확인해주세요.');
  if (!Array.isArray(groups as unknown) || groups.length < 2 || groups.length > OPTION_SPLIT_GROUP_LIMIT)
    return invalid(`분할 그룹은 한 번에 2~${OPTION_SPLIT_GROUP_LIMIT}개여야 합니다.`);
  const originals = new Map(source.options.rows.map(row => [row?.id, row]));
  if (originals.size !== source.options.rows.length || source.options.rows.some(row => !row || !safeId(row.id) || row.id === source.product.id))
    return invalid('원본 옵션 ID가 잘못되었거나 중복되었습니다. 저장본을 다시 불러와주세요.');
  const assigned = new Set<string>(), identities = new Set<string>([source.product.id, ...originals.keys()]);
  for (const [index, group] of groups.entries()) {
    if (!record(group) || typeof group.label !== 'string' || !group.label.trim() || group.label.length > 120 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(group.label))
      return invalid('분할 이름은 공백만 있지 않은 120자 이내 텍스트로 입력해주세요.');
    if (!Array.isArray(group.optionIds) || group.optionIds.length < 1 || group.optionIds.length > 200 || !record(group.optionIdMap))
      return invalid('각 분할 그룹에 원본 옵션을 하나 이상 지정해주세요.');
    if (index === 0 ? group.productId !== source.product.id : !freshUuid(group.productId) || identities.has(group.productId))
      return invalid('첫 그룹은 원본 상품 ID를 유지하고, 나머지 그룹에는 중복되지 않는 새 UUID를 지정해주세요.');
    if (index > 0) identities.add(group.productId);
    if (Object.keys(group.optionIdMap).length !== group.optionIds.length || Object.keys(group.optionIdMap).some(id => !group.optionIds.includes(id)))
      return invalid('분할 그룹의 옵션 ID 연결을 정확히 확인해주세요.');
    for (const id of group.optionIds) {
      if (!safeId(id) || !originals.has(id) || assigned.has(id) || !has(group.optionIdMap, id))
        return invalid('제외 옵션을 포함한 모든 원본 옵션을 중복 없이 한 그룹에만 지정해주세요.');
      assigned.add(id);
      const nextId = group.optionIdMap[id];
      if (index === 0 ? nextId !== id : !freshUuid(nextId) || identities.has(nextId))
        return invalid('첫 그룹의 옵션 ID는 유지하고, 새 상품 옵션에는 중복되지 않는 새 UUID를 지정해주세요.');
      if (index > 0) identities.add(nextId);
    }
  }
  if (assigned.size !== originals.size) return invalid('제외 옵션을 포함한 모든 원본 옵션을 빠짐없이 한 번씩 지정해주세요.');

  return { sourceProductId: source.product.id, groups: groups.map((group, index): SplitPlannedGroup => {
    const retainsSource = index === 0, mapping = structuredClone(group.optionIdMap), ids = [...group.optionIds];
    const options = { ...structuredClone(source.options), productId: group.productId, revision: retainsSource ? source.options.revision + 1 : 1, updatedAt: now,
      rows: ids.map(id => ({ ...structuredClone(originals.get(id)!), id: mapping[id] })) };
    const product = { ...structuredClone(source.product), id: group.productId, title: titleWithLabel(source.product.title, group.label),
      options_count: options.rows.filter(row => row.included).length, quote_status: '대기', updated_at: now };
    if (!retainsSource) {
      delete product.registration_number; product.created_at = now; product.supplier_hub_status = '미전송'; product.registration_status = '수집완료';
    }
    const quotation = { ...structuredClone(source.quotation), productId: group.productId, revision: retainsSource ? source.quotation.revision + 1 : 1, updatedAt: now,
      overrides: subsetOverrides<QuotationOverrides>(source.quotation.overrides, ids, mapping) };
    if (source.quotation.categoryOverrides !== undefined) quotation.categoryOverrides = mapScopes(source.quotation.categoryOverrides, value => subsetOverrides(value, ids, mapping));
    if (source.quotation.packagingBasis !== undefined) quotation.packagingBasis = subsetBasis(source.quotation.packagingBasis, ids, mapping);
    if (source.quotation.categoryPackagingBasis !== undefined) quotation.categoryPackagingBasis = mapScopes(source.quotation.categoryPackagingBasis, value => subsetBasis(value, ids, mapping));
    if (!retainsSource) delete quotation.detailSaveBackups;
    const sourceLabels = source.labels as LabelScopes;
    const labels: LabelScopes = { ...structuredClone(sourceLabels), productId: group.productId, revision: retainsSource ? source.labels.revision + 1 : 1, updatedAt: now,
      overrides: subsetOverrides(source.labels.overrides, ids, mapping) };
    if (sourceLabels.categoryOverrides !== undefined) labels.categoryOverrides = mapScopes(sourceLabels.categoryOverrides, value => subsetOverrides(value, ids, mapping));
    return { label: group.label, retainsSource, product, content: splitContent(source.content, group.productId, group.label, retainsSource, now), options, quotation, labels,
      optionIdMap: mapping, sourceOptionIds: ids };
  }) };
}
