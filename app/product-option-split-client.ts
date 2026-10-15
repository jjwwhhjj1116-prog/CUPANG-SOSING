import { OPTION_SPLIT_GROUP_LIMIT, type ProductOptionSplitGroup } from '@/app/product-option-split-plan';
import type { ProductOptionSplitPreview, ProductOptionSplitReceipt } from '@/app/product-option-split';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { supplierHubCompany } from '@/app/supplier-hub-company';

export type ProductOptionSplitDraft = { label: string; optionIds: string[] };
export type ProductOptionSplitInput = {
  productId: string; profileId?: string; sourceVersion: string; expectedInputFingerprint: string;
  requestId: string; groups: ProductOptionSplitGroup[];
  revisions: { content: number; options: number; quotation: number };
};
export type ProductOptionSplitAttempt = { identity?: string; pending?: boolean; receipt?: ProductOptionSplitReceipt };
export type ProductOptionSplitResult = { receipt: ProductOptionSplitReceipt; current: boolean };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const time = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const invalid = (): never => { throw Error('상품 분할 응답이 검토한 상품·옵션과 일치하지 않습니다. 다시 저장하지 말고 저장 결과를 확인해주세요.'); };
const endpoint = (input: ProductOptionSplitInput) => `/api/products/${encodeURIComponent(input.productId)}/option-splits${input.profileId ? `?profileId=${encodeURIComponent(input.profileId)}` : ''}`;
const body = (input: ProductOptionSplitInput, action: 'preview' | 'commit', previewFingerprint?: string) => ({ action, requestId: input.requestId,
  expectedInputFingerprint: input.expectedInputFingerprint, groups: input.groups, ...(previewFingerprint ? { previewFingerprint } : {}) });

/** IDs are allocated once for an explicit, complete partition. Opening a panel
 * or editing assignments does not persist products or infer existing siblings. */
export function createProductOptionSplitInput(productId: string, profileId: string | undefined, view: QuotationFieldsView,
  drafts: readonly ProductOptionSplitDraft[], allocate: () => string = () => crypto.randomUUID()): ProductOptionSplitInput {
  const ids = view.resolved.rows.flatMap(row => row.optionId === null ? [] : [row.optionId]);
  if (ids.length < 2 || ids.length > 200 || new Set(ids).size !== ids.length || !hash(view.inputFingerprint) || !time(view.productVersion))
    throw Error('원본 옵션 2~200개와 저장 버전을 다시 확인해주세요.');
  if (!Array.isArray(drafts) || drafts.length < 2 || drafts.length > OPTION_SPLIT_GROUP_LIMIT) throw Error(`분할 그룹은 2~${OPTION_SPLIT_GROUP_LIMIT}개로 구성해주세요.`);
  const used = new Set<string>([productId, ...ids]), assigned = new Set<string>();
  const fresh = () => { const value = allocate(); if (!uuid(value) || used.has(value)) throw Error('새 상품·옵션 식별자를 만들지 못했습니다. 미리보기를 다시 만들어주세요.'); used.add(value); return value; };
  const groups = drafts.map((draft, index) => {
    if (!draft || typeof draft.label !== 'string' || !draft.label.trim() || draft.label.length > 120 || !Array.isArray(draft.optionIds) || !draft.optionIds.length)
      throw Error('비어 있는 그룹이 없어야 하며, 그룹 이름은 1~120자입니다.');
    for (const id of draft.optionIds) { if (!ids.includes(id) || assigned.has(id)) throw Error('각 원본 옵션을 한 그룹에만 배정해주세요.'); assigned.add(id); }
    // Keep original row order even when assignments were changed repeatedly.
    const optionIds = ids.filter(id => draft.optionIds.includes(id));
    return { label: draft.label, productId: index === 0 ? productId : fresh(), optionIds,
      optionIdMap: Object.fromEntries(optionIds.map(id => [id, index === 0 ? id : fresh()])) };
  });
  if (assigned.size !== ids.length) throw Error('견적 제외 옵션을 포함한 모든 원본 옵션을 그룹에 배정해주세요.');
  return { productId, profileId, sourceVersion: view.productVersion, expectedInputFingerprint: view.inputFingerprint, requestId: fresh(), groups,
    revisions: { content: view.contentRevision, options: view.optionRevision, quotation: view.revision } };
}

export function validateProductOptionSplitPreview(input: ProductOptionSplitInput, value: unknown): ProductOptionSplitPreview {
  if (!record(value) || value.format !== 'product-option-split-preview-v1' || value.requestId !== input.requestId
    || value.sourceProductId !== input.productId || value.sourceVersion !== input.sourceVersion || !hash(value.fingerprint)
    || !record(value.company) || !supplierHubCompany(value.company.code, value.company.name)
    || !Array.isArray(value.warnings) || value.warnings.some(warning => typeof warning !== 'string')
    || !Array.isArray(value.groups) || value.groups.length !== input.groups.length) return invalid();
  value.groups.forEach((group: unknown, index: number) => {
    const requested = input.groups[index];
    if (!record(group) || group.productId !== requested.productId || group.label !== requested.label || group.retainsSource !== (index === 0)
      || typeof group.title !== 'string' || !group.title || group.title.length > 500 || typeof group.seoTitle !== 'string' || group.seoTitle.length > 500 || !same(group.sourceOptionIds, requested.optionIds)
      || !same(group.optionIds, requested.optionIds.map(id => requested.optionIdMap[id]))) return invalid();
  });
  return value as ProductOptionSplitPreview;
}
export function validateProductOptionSplitReceipt(input: ProductOptionSplitInput, preview: ProductOptionSplitPreview, value: unknown): ProductOptionSplitReceipt {
  if (!record(value) || value.format !== 'product-option-split-receipt-v1' || !uuid(value.familyId) || !time(value.committedAt)
    || value.fingerprint !== preview.fingerprint || !Array.isArray(value.groups)) return invalid();
  validateProductOptionSplitPreview(input, { ...value, format: 'product-option-split-preview-v1' });
  if (!same(value.company, preview.company) || !same(value.warnings, preview.warnings)) return invalid();
  const jobs = new Set<string>(), numbers = new Set<string>();
  value.groups.forEach((group: unknown, index: number) => {
    if (!record(group) || group.title !== preview.groups[index].title || group.seoTitle !== preview.groups[index].seoTitle || (!uuid(group.jobId) && index !== 0) || typeof group.jobId !== 'string' || !group.jobId || jobs.has(group.jobId)
      || !time(group.productVersion) || Date.parse(group.productVersion) <= Date.parse(input.sourceVersion)
      || !Number.isSafeInteger(group.labelsRevision) || Number(group.labelsRevision) < 1
      || group.contentRevision !== (index === 0 ? input.revisions.content + 1 : 1)
      || group.optionsRevision !== (index === 0 ? input.revisions.options + 1 : 1)
      || group.quotationRevision !== (index === 0 ? input.revisions.quotation + 1 : 1)
      || group.registrationNumber !== null && (typeof group.registrationNumber !== 'string' || !/^\d{12}$/.test(group.registrationNumber) || numbers.has(group.registrationNumber))
      || index > 0 && group.registrationNumber === null) return invalid();
    if (group.registrationNumber !== null) numbers.add(group.registrationNumber as string);
    jobs.add(group.jobId);
  });
  return value as ProductOptionSplitReceipt;
}
function bind(input: ProductOptionSplitInput, preview: ProductOptionSplitPreview, attempt: ProductOptionSplitAttempt) {
  validateProductOptionSplitPreview(input, preview);
  const identity = JSON.stringify([input, preview]);
  if (attempt.identity !== undefined && attempt.identity !== identity || attempt.identity === undefined && (attempt.pending || attempt.receipt)) return invalid();
  attempt.identity = identity;
}
export function restoredProductOptionSplitAttempt(input: ProductOptionSplitInput, preview: ProductOptionSplitPreview): ProductOptionSplitAttempt {
  validateProductOptionSplitPreview(input, preview);
  return { identity: JSON.stringify([input, preview]), pending: true };
}
async function readResponse(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (!record(value)) return invalid();
  return value;
}
export async function previewProductOptionSplit(input: ProductOptionSplitInput, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  signal.throwIfAborted();
  const response = await fetcher(endpoint(input), { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body(input, 'preview')) });
  const value = await readResponse(response); signal.throwIfAborted();
  if (!response.ok) throw Error(typeof value.error === 'string' ? value.error : '분할 미리보기를 만들지 못했습니다.');
  return validateProductOptionSplitPreview(input, value);
}
/** Once dispatched, an uncertain write is never automatically repeated. */
export async function commitProductOptionSplit(input: ProductOptionSplitInput, preview: ProductOptionSplitPreview, attempt: ProductOptionSplitAttempt,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<ProductOptionSplitResult> {
  bind(input, preview, attempt);
  if (attempt.pending || attempt.receipt) throw Error('이전 분할 저장 결과를 먼저 확인해주세요.');
  signal.throwIfAborted(); attempt.pending = true;
  const response = await fetcher(endpoint(input), { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body(input, 'commit', preview.fingerprint)) });
  const value = await readResponse(response); signal.throwIfAborted();
  if (!response.ok) throw Error(typeof value.error === 'string' ? value.error : '분할 저장 결과를 확인하지 못했습니다.');
  if (typeof value.current !== 'boolean') return invalid();
  const receipt = validateProductOptionSplitReceipt(input, preview, value.receipt);
  attempt.receipt = receipt; attempt.pending = false;
  return { receipt, current: value.current };
}
/** Receipt lookup is read-only even after later edits; historical success must
 * not replace newer editor state or silently retry the original partition. */
export async function recoverProductOptionSplit(input: ProductOptionSplitInput, preview: ProductOptionSplitPreview, attempt: ProductOptionSplitAttempt,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<ProductOptionSplitResult | null> {
  bind(input, preview, attempt); signal.throwIfAborted();
  const path = endpoint(input), response = await fetcher(`${path}${path.includes('?') ? '&' : '?'}requestId=${encodeURIComponent(input.requestId)}`, { signal, cache: 'no-store' });
  const value = await readResponse(response); signal.throwIfAborted();
  if (response.status === 404 && value.code === 'OPTION_SPLIT_NOT_FOUND' && value.receipt === null && value.current === false && !attempt.receipt) {
    attempt.pending = false; return null;
  }
  if (!response.ok) throw Error(typeof value.error === 'string' ? value.error : '분할 저장 결과를 읽지 못했습니다. 다시 저장하지 않고 확인을 유지합니다.');
  if (typeof value.current !== 'boolean') return invalid();
  const receipt = validateProductOptionSplitReceipt(input, preview, value.receipt);
  if (attempt.receipt && !same(receipt, attempt.receipt)) return invalid();
  attempt.receipt = receipt; attempt.pending = false;
  return { receipt, current: value.current };
}
