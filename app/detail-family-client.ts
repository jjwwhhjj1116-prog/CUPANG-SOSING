import type { DetailFamilyCatalog, DetailFamilyPreview, DetailFamilyReceipt } from '@/app/detail-family-apply';
import { supplierHubCompany } from '@/app/supplier-hub-company';
import { MAX_IMAGE_BYTES, isOwnedImageKey } from '@/app/image-files';

export type DetailFamilyInput = { productId: string; profileId?: string; catalog: DetailFamilyCatalog; targetIds: string[]; requestId: string };
export type DetailFamilyAttempt = { identity?: string; pending?: boolean; receipt?: DetailFamilyReceipt };
export type DetailFamilyResult = { receipt: DetailFamilyReceipt; current: boolean };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const safe = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) && !['__proto__','constructor','prototype'].includes(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const time = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const number = (value: unknown) => value === null || typeof value === 'string' && /^\d{12}$/.test(value);
const invalid = (): never => { throw Error('분할 상품 상세 적용 자료가 검토한 원본·회사·대상과 다릅니다. 다시 저장하지 말고 결과를 확인해주세요.'); };
const path = (productId: string, profileId?: string) => `/api/products/${encodeURIComponent(productId)}/detail-family${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`;
function validImage(value: unknown): boolean {
  return record(value) && typeof value.key === 'string' && value.key.length <= 512 && isOwnedImageKey(value.key.split('/')[0], value.key) && hash(value.sha256)
    && integer(value.bytes, MAX_IMAGE_BYTES) && value.bytes > 0 && value.width === 800 && integer(value.height, 16000) && value.height > 0;
}
export function validateDetailFamilyCatalog(productId: string, value: unknown): DetailFamilyCatalog {
  if (!record(value) || value.format !== 'detail-family-catalog-v1' || value.sourceProductId !== productId || !time(value.sourceVersion) || !hash(value.inputFingerprint)
    || !record(value.company) || !supplierHubCompany(value.company.code, value.company.name) || value.familyId !== null && !uuid(value.familyId)
    || typeof value.sourceReady !== 'boolean' || value.reason !== null && typeof value.reason !== 'string' || value.image !== null && !validImage(value.image)
    || value.sourceReady && (!value.familyId || !validImage(value.image)) || !Array.isArray(value.targets) || value.targets.length > 200) return invalid();
  const ids = new Set<string>();
  for (const target of value.targets) {
    if (!record(target) || !safe(target.productId) || target.productId === productId || ids.has(target.productId) || typeof target.title !== 'string' || target.title.length > 500
      || !number(target.registrationNumber) || !integer(target.optionCount, 200) || typeof target.eligible !== 'boolean'
      || target.reason !== null && typeof target.reason !== 'string') return invalid();
    ids.add(target.productId);
  }
  return value as DetailFamilyCatalog;
}
export function createDetailFamilyInput(productId: string, profileId: string | undefined, catalog: DetailFamilyCatalog, targetIds: readonly string[], requestId = crypto.randomUUID()): DetailFamilyInput {
  validateDetailFamilyCatalog(productId, catalog);
  if (!catalog.sourceReady || !catalog.image || !catalog.familyId) throw Error(catalog.reason || '원본 상세 이미지를 먼저 공통·전체 옵션에 저장해주세요.');
  if (!uuid(requestId) || !Array.isArray(targetIds) || !targetIds.length || targetIds.length > 19 || new Set(targetIds).size !== targetIds.length
    || targetIds.some(id => !catalog.targets.some(target => target.productId === id && target.eligible))) throw Error('적용할 분할 상품을 1~19개 선택해주세요.');
  return { productId, profileId, catalog, targetIds: [...targetIds], requestId };
}
export function validateDetailFamilyPreview(input: DetailFamilyInput, value: unknown): DetailFamilyPreview {
  const catalog = validateDetailFamilyCatalog(input.productId, input.catalog);
  if (!record(value) || value.format !== 'detail-family-preview-v1' || value.requestId !== input.requestId || !hash(value.fingerprint)
    || value.sourceProductId !== input.productId || value.sourceVersion !== catalog.sourceVersion || !same(value.company, catalog.company)
    || value.familyId !== catalog.familyId || value.key !== catalog.image?.key || value.sha256 !== catalog.image?.sha256 || value.bytes !== catalog.image?.bytes
    || !Array.isArray(value.targets) || value.targets.length !== input.targetIds.length) return invalid();
  value.targets.forEach((target: unknown, index: number) => {
    const listed = catalog.targets.find(item => item.productId === input.targetIds[index]);
    if (!record(target) || !listed?.eligible || target.productId !== listed.productId || target.title !== listed.title || target.registrationNumber !== listed.registrationNumber
      || !time(target.beforeVersion) || !integer(target.revision) || !Array.isArray(target.optionIds) || !target.optionIds.length || target.optionIds.length > 200
      || target.optionIds.length !== listed.optionCount || new Set(target.optionIds).size !== target.optionIds.length || target.optionIds.some(id => !safe(id))) return invalid();
  });
  return value as DetailFamilyPreview;
}
export function validateDetailFamilyReceipt(input: DetailFamilyInput, preview: DetailFamilyPreview, value: unknown): DetailFamilyReceipt {
  if (!record(value) || value.format !== 'detail-family-receipt-v1' || !time(value.committedAt) || value.fingerprint !== preview.fingerprint || !Array.isArray(value.targets)) return invalid();
  validateDetailFamilyPreview(input, { ...value, format: 'detail-family-preview-v1' });
  value.targets.forEach((target: unknown, index: number) => {
    const prior = preview.targets[index];
    if (!record(target) || target.beforeVersion !== prior.beforeVersion || target.revision !== prior.revision || !same(target.optionIds, prior.optionIds)
      || target.savedRevision !== prior.revision + 1 || !time(target.savedVersion) || Date.parse(target.savedVersion) <= Date.parse(prior.beforeVersion)
      || target.savedVersion !== value.committedAt) return invalid();
  });
  return value as DetailFamilyReceipt;
}
const body = (input: DetailFamilyInput, action: 'preview' | 'commit', previewFingerprint?: string) => ({ action, requestId: input.requestId,
  expectedInputFingerprint: input.catalog.inputFingerprint, targetIds: input.targetIds, ...(previewFingerprint ? { previewFingerprint } : {}) });
function bind(input: DetailFamilyInput, preview: DetailFamilyPreview, attempt: DetailFamilyAttempt) {
  validateDetailFamilyPreview(input, preview); const identity = JSON.stringify([input, preview]);
  if (attempt.identity !== undefined && attempt.identity !== identity || attempt.identity === undefined && (attempt.pending || attempt.receipt)) return invalid();
  attempt.identity = identity;
}
export function restoredDetailFamilyAttempt(input: DetailFamilyInput, preview: DetailFamilyPreview): DetailFamilyAttempt {
  validateDetailFamilyPreview(input, preview); return { identity: JSON.stringify([input, preview]), pending: true };
}
async function json(response: Response) { const value: unknown = await response.json(); if (!record(value)) return invalid(); return value; }
export async function readDetailFamilyCatalog(productId: string, profileId: string | undefined, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  signal.throwIfAborted(); const response = await fetcher(path(productId, profileId), { signal, cache: 'no-store' }); const value = await json(response); signal.throwIfAborted();
  if (!response.ok) throw Error(typeof value.error === 'string' ? value.error : '분할 상품 목록을 조회하지 못했습니다.'); return validateDetailFamilyCatalog(productId, value);
}
export async function previewDetailFamily(input: DetailFamilyInput, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  signal.throwIfAborted(); const response = await fetcher(path(input.productId, input.profileId), { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body(input, 'preview')) });
  const value = await json(response); signal.throwIfAborted(); if (!response.ok) throw Error(typeof value.error === 'string' ? value.error : '상세 적용 미리보기 확인 실패'); return validateDetailFamilyPreview(input, value);
}
export async function commitDetailFamily(input: DetailFamilyInput, preview: DetailFamilyPreview, attempt: DetailFamilyAttempt, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<DetailFamilyResult> {
  bind(input, preview, attempt); if (attempt.pending || attempt.receipt) throw Error('이전 상세 적용의 저장 결과를 먼저 확인해주세요.');
  signal.throwIfAborted(); attempt.pending = true;
  const response = await fetcher(path(input.productId, input.profileId), { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body(input, 'commit', preview.fingerprint)) });
  const value = await json(response); signal.throwIfAborted(); if (!response.ok) throw Error(typeof value.error === 'string' ? value.error : '상세 적용 완료 여부를 확인하지 못했습니다.');
  if (typeof value.current !== 'boolean') return invalid(); const receipt = validateDetailFamilyReceipt(input, preview, value.receipt);
  attempt.receipt = receipt; attempt.pending = false; return { receipt, current: value.current };
}
/** A missing ACK is resolved by reads only, including across a reload. */
export async function recoverDetailFamily(input: DetailFamilyInput, preview: DetailFamilyPreview, attempt: DetailFamilyAttempt, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<DetailFamilyResult | null> {
  bind(input, preview, attempt); signal.throwIfAborted(); const endpoint = path(input.productId, input.profileId);
  const response = await fetcher(`${endpoint}${endpoint.includes('?') ? '&' : '?'}requestId=${encodeURIComponent(input.requestId)}`, { signal, cache: 'no-store' });
  const value = await json(response); signal.throwIfAborted();
  if (response.status === 404 && value.code === 'DETAIL_FAMILY_NOT_FOUND' && value.receipt === null && value.current === false && !attempt.receipt) { attempt.pending = false; return null; }
  if (!response.ok) throw Error(typeof value.error === 'string' ? value.error : '상세 적용 결과 확인을 유지합니다. 다시 저장하지 마세요.');
  if (typeof value.current !== 'boolean') return invalid(); const receipt = validateDetailFamilyReceipt(input, preview, value.receipt);
  if (attempt.receipt && !same(attempt.receipt, receipt)) return invalid(); attempt.receipt = receipt; attempt.pending = false;
  return { receipt, current: value.current };
}
