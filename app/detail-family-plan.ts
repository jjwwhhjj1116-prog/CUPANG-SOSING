import { DETAIL_SAVE_TEXT_POLICY, detailSaveChanges, detailSaveManualBackup, detailSaveOptionIds } from '@/app/detail-save-plan';
import { PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-pool-limit';
import { isOwnedImageKey, MAX_IMAGE_BYTES } from '@/app/image-files';
import { optionImageTargets } from '@/app/quotation-image-targets';
import { quotationScope, scopedQuotationOverrides } from '@/app/quotation-scopes';
import { applyQuotationChanges, type QuotationChange, type QuotationFieldsView } from '@/app/quotation-schema';
import type { QuotationFieldsState } from '@/db/quotation-fields';

export type DetailFamilySource = { productId: string; categoryId: string; key: string; sha256: string; bytes: number; uploadId: string; receiptRevision: number };
export type DetailFamilySnapshot = { productId: string; view: QuotationFieldsView; state: QuotationFieldsState };
export type DetailFamilyTargetPlan = { quotation: QuotationFieldsState; imageKeys: string[]; changes: QuotationChange[]; before: QuotationChange[] };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/u.test(value)
  && !['__proto__', 'prototype', 'constructor'].includes(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const invalid = (message = '상세 저장본과 현재 상품·카테고리의 연결을 다시 확인해주세요.'): never => { throw Error(message); };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
function integratedKey(key: unknown, uploadId: unknown): key is string {
  if (typeof key !== 'string' || !hash(uploadId)) return false;
  const slash = key.indexOf('/');
  return slash > 0 && isOwnedImageKey(key.slice(0, slash), key) && key.slice(slash + 1) === `quotation-label-${uploadId}.png`;
}
function snapshot(input: DetailFamilySnapshot) {
  if (!input || !safeId(input.productId) || !record(input.state) || !record(input.view)) return invalid();
  const { view, state } = input, categoryId = view.categoryContext?.categoryId;
  if (state.schemaVersion !== 1 || state.productId !== input.productId || !Number.isSafeInteger(state.revision) || state.revision < 0
    || state.revision >= Number.MAX_SAFE_INTEGER || state.revision !== view.revision || state.updatedAt !== view.updatedAt
    || typeof categoryId !== 'string' || !categoryId || view.resolved?.schema?.status !== 'observed' || view.resolved.schema.categoryId !== categoryId
    || !Array.isArray(view.resolved.rows) || !Array.isArray(view.imageKeys) || view.imageKeys.length > PRODUCT_IMAGE_POOL_LIMIT
    || view.imageKeys.some(key => typeof key !== 'string') || new Set(view.imageKeys).size !== view.imageKeys.length) return invalid();
  const scope = quotationScope(categoryId), optionIds = detailSaveOptionIds(view);
  if (optionIds.some(id => !safeId(id)) || view.resolved.rows.length !== optionIds.length + 1
    || view.resolved.rows.filter(row => row.optionId === null).length !== 1 || !same(scopedQuotationOverrides(state, categoryId), view.overrides)) return invalid();
  const targets = optionImageTargets(view.resolved.schema.fields), fields = [...targets.detailImages.fields, ...targets.detailHtml.fields];
  if (fields.some(field => field.readOnly) || view.resolved.rows.some(row => !record(row.fields)
    || fields.some(field => !record(row.fields[field.id]) || typeof row.fields[field.id].value !== 'string'))) return invalid();
  return { categoryId, scope, optionIds, targets };
}
function validateSource(source: DetailFamilySource) {
  if (!source || !safeId(source.productId) || typeof source.categoryId !== 'string' || !source.categoryId || !hash(source.sha256)
    || !hash(source.uploadId) || !integratedKey(source.key, source.uploadId) || !Number.isSafeInteger(source.bytes) || source.bytes < 1 || source.bytes > MAX_IMAGE_BYTES
    || !Number.isSafeInteger(source.receiptRevision) || source.receiptRevision < 1) return invalid('저장된 통합 상세 이미지의 원본 증거를 확인해주세요.');
  quotationScope(source.categoryId);
}

/** Metadata and final quote fields only. PNG bytes, dimensions, owner/company,
 * family membership and snapshot CAS are verified separately by the backend. */
export function detailFamilySource(input: DetailFamilySnapshot): DetailFamilySource {
  const { categoryId, scope, optionIds, targets } = snapshot(input), { state, view } = input;
  const key = view.resolved.rows.find(row => row.optionId === null)!.fields[targets.detailImages.primary].value;
  if (!key || !view.imageKeys.includes(key)) return invalid('공통·모든 옵션에 저장한 하나의 통합 상세 이미지를 먼저 확인해주세요.');
  const history = state.detailSaveBackups?.[scope];
  if (!Array.isArray(history)) return invalid('현재 카테고리에 검증 가능한 상세 저장 이력이 없습니다. 상세 저장을 먼저 완료해주세요.');
  const backup = [...history].reverse().find(item => item?.receipt?.key === key), receipt = backup?.receipt;
  if (!receipt || receipt.categoryId !== categoryId || !Number.isSafeInteger(receipt.beforeRevision) || receipt.beforeRevision < 0
    || receipt.revision !== receipt.beforeRevision + 1 || receipt.revision > view.revision || !Array.isArray(receipt.optionIds)
    || !receipt.optionIds.length || receipt.optionIds.length > 200 || receipt.optionIds.some(id => !safeId(id)) || new Set(receipt.optionIds).size !== receipt.optionIds.length
    || !safeId(receipt.sourceOptionId) || !receipt.optionIds.includes(receipt.sourceOptionId) || optionIds.some(id => !receipt.optionIds.includes(id))
    || (receipt.textPolicy === undefined ? receipt.textCommonFilled !== undefined : receipt.textPolicy !== DETAIL_SAVE_TEXT_POLICY || typeof receipt.textCommonFilled !== 'boolean'))
    return invalid('상세 저장 이력의 카테고리·옵션·버전이 현재 저장본과 맞지 않습니다.');
  const source: DetailFamilySource = { productId: input.productId, categoryId, key: receipt.key, sha256: receipt.sha256, bytes: receipt.bytes,
    uploadId: receipt.uploadId, receiptRevision: receipt.revision };
  validateSource(source);
  const changes = detailSaveChanges(view, key);
  if (changes.some(change => view.resolved.rows.find(row => row.optionId === change.optionId)?.fields[change.fieldKey]?.value !== change.value))
    return invalid('공통·모든 옵션의 통합 상세 이미지와 빈 HTML이 일치해야 합니다. 상세 저장본을 다시 확인해주세요.');
  return source;
}

/** Copy the final integrated quote image into this target's current category
 * only. ALT, source content, other scopes and historical receipts stay intact. */
export function detailFamilyTargetPlan(input: DetailFamilySnapshot, source: DetailFamilySource, now: string): DetailFamilyTargetPlan {
  validateSource(source);
  const { categoryId, scope } = snapshot(input), { view, state } = input;
  if (source.productId === input.productId || source.categoryId !== categoryId) return invalid('원본과 다른 가족 상품의 같은 카테고리를 선택해주세요.');
  if (typeof now !== 'string' || !Number.isFinite(Date.parse(now)) || !Number.isFinite(Date.parse(view.productVersion))
    || Date.parse(now) <= Date.parse(view.productVersion)) return invalid('대상 상품의 저장 시각보다 새로운 적용 시각을 확인해주세요.');
  const imageKeys = [...view.imageKeys];
  if (!imageKeys.includes(source.key)) {
    if (imageKeys.length >= PRODUCT_IMAGE_POOL_LIMIT) return invalid('대상 상품의 이미지 보관 공간이 부족합니다. 기존 원본은 유지했습니다.');
    imageKeys.push(source.key);
  }
  const changes = detailSaveChanges(view, source.key), before = detailSaveManualBackup(view, changes), overrides = applyQuotationChanges(view.overrides, changes);
  const quotation: QuotationFieldsState = { ...structuredClone(state), revision: state.revision + 1, updatedAt: now,
    categoryOverrides: { ...structuredClone(state.categoryOverrides ?? {}), [scope]: overrides } };
  return { quotation, imageKeys, changes, before };
}
