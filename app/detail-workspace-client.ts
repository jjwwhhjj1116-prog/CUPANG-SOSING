import type { QuotationFieldsView } from '@/app/quotation-schema';
import { detailWorkspaceDigest, detailWorkspaceExpectedView, detailWorkspaceRequestId, validateDetailWorkspaceDocument, validateDetailWorkspaceRecord, validateDetailWorkspaceRoles,
  type DetailWorkspaceDocument, type DetailWorkspaceRecord, type DetailWorkspaceView } from '@/app/detail-workspace';
import { isOwnedImageKey, MAX_IMAGE_BYTES } from '@/app/image-files';
import { PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-pool-limit';
import { imageDisplayDimensions } from '@/app/image-dimensions';
import { readBoundedStream } from '@/app/request-body';
import { labelUploadDigest } from '@/app/label-upload-key';

export type DetailWorkspaceSelection = { productId: string; optionId: string; profileId?: string; view: QuotationFieldsView };
export type DetailWorkspaceSaveInput = { selection: DetailWorkspaceSelection; before: DetailWorkspaceView; document: DetailWorkspaceDocument; expectedRevision: number; requestId: string };
export type DetailWorkspaceAttempt = { identity?: string; pending?: boolean; retryReady?: boolean; notApplied?: boolean; completed?: DetailWorkspaceRecord };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const safe = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/u.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const changed = () => Error('상세 편집 구성의 상품·옵션·저장 기준이 바뀌었습니다. 현재 작업을 유지하고 저장 결과를 확인해주세요.');
const endpoint = (input: DetailWorkspaceSelection, read = true) => {
  const query = new URLSearchParams({ ...(read ? { optionId: input.optionId } : {}), ...(input.profileId ? { profileId: input.profileId } : {}) });
  return `/api/products/${encodeURIComponent(input.productId)}/detail-workspace${query.size ? `?${query}` : ''}`;
};
function selection(input: DetailWorkspaceSelection) {
  const view = input?.view;
  if (!safe(input?.productId) || !safe(input?.optionId) || input.profileId !== undefined && !safe(input.profileId)
    || !view || !view.categoryContext?.categoryId || input.profileId && input.profileId !== view.categoryContext.profileId
    || !Number.isFinite(Date.parse(view.productVersion)) || !/^[a-f0-9]{64}$/u.test(view.inputFingerprint)
    || [view.revision, view.optionRevision, view.contentRevision].some(value => !Number.isSafeInteger(value) || value < 0)
    || !Array.isArray(view.imageKeys) || view.imageKeys.length > PRODUCT_IMAGE_POOL_LIMIT || new Set(view.imageKeys).size !== view.imageKeys.length
    || view.resolved?.rows.filter(row => row.optionId === input.optionId).length !== 1) throw changed();
  const owner = view.imageKeys[0]?.split('/')[0];
  if (!owner || view.imageKeys.some(key => !isOwnedImageKey(owner, key))) throw changed();
  return owner;
}
export async function validateDetailWorkspaceReply(input: DetailWorkspaceSelection, value: unknown): Promise<DetailWorkspaceView> {
  const owner = selection(input);
  if (!object(value) || Object.keys(value).length !== 3 || !same(value.view, input.view) || !object(value.roles)
    || Object.keys(value.roles).length !== 2 || !Array.isArray(value.roles.top) || !Array.isArray(value.roles.bottom)) throw changed();
  const roles = validateDetailWorkspaceRoles(value.roles, owner, input.view.imageKeys);
  if (value.workspace === null) return structuredClone(value) as DetailWorkspaceView;
  if (!object(value.workspace)) throw changed();
  const record = validateDetailWorkspaceRecord(value.workspace, owner, input.productId, input.optionId, input.view.categoryContext, value.workspace.company as DetailWorkspaceRecord['company']);
  const { digest, ...body } = record;
  if (record.files.some(file => !input.view.imageKeys.includes(file.key)) || digest !== await detailWorkspaceDigest(body)) throw changed();
  return { view: input.view, workspace: record, roles };
}
export async function readDetailWorkspace(input: DetailWorkspaceSelection, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<DetailWorkspaceView> {
  selection(input); signal.throwIfAborted();
  const response = await fetcher(endpoint(input), { signal, cache: 'no-store' }), body: unknown = await response.json(); signal.throwIfAborted();
  if (!response.ok) throw Error(object(body) && typeof body.error === 'string' ? body.error : '상세 편집 구성을 읽지 못했습니다. 현재 작업은 유지됩니다.');
  const reply = await validateDetailWorkspaceReply(input, body); signal.throwIfAborted(); return reply;
}
export async function createDetailWorkspaceSave(input: DetailWorkspaceSelection, before: DetailWorkspaceView, value: unknown): Promise<DetailWorkspaceSaveInput> {
  const owner = selection(input), saved = await validateDetailWorkspaceReply(input, before);
  const document = validateDetailWorkspaceDocument(value, owner, input.view.imageKeys, saved.workspace?.document ?? null, saved.roles), expectedRevision = saved.workspace?.revision ?? 0;
  const requestId = await detailWorkspaceRequestId(input.productId, input.optionId, expectedRevision, detailWorkspaceExpectedView(input.view), document);
  return { selection: structuredClone(input), before: saved, document, expectedRevision, requestId };
}
async function bind(input: DetailWorkspaceSaveInput, attempt: DetailWorkspaceAttempt) {
  const rebuilt = await createDetailWorkspaceSave(input.selection, input.before, input.document);
  if (!same(rebuilt, input)) throw changed();
  const identity = JSON.stringify(input);
  if (attempt.identity !== undefined && attempt.identity !== identity || attempt.identity === undefined && (attempt.pending || attempt.retryReady || attempt.notApplied || attempt.completed)) throw changed();
  attempt.identity = identity;
}
export async function restoredDetailWorkspaceAttempt(input: DetailWorkspaceSaveInput): Promise<DetailWorkspaceAttempt> {
  const attempt: DetailWorkspaceAttempt = {}; await bind(input, attempt); attempt.pending = true; return attempt;
}
function receipt(input: DetailWorkspaceSaveInput, reply: DetailWorkspaceView) {
  const record = reply.workspace;
  if (!record || record.requestId !== input.requestId || record.revision !== input.expectedRevision + 1 || !same(record.document, input.document)
    || input.before.workspace && !same(record.company, input.before.workspace.company)) throw changed();
  return record;
}
/** A dispatched write is never repeated to resolve an unknown acknowledgement. */
export async function saveDetailWorkspace(input: DetailWorkspaceSaveInput, attempt: DetailWorkspaceAttempt, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<DetailWorkspaceView> {
  const bound = attempt.identity !== undefined; await bind(input, attempt); signal.throwIfAborted();
  if (attempt.pending || attempt.completed || bound && !attempt.retryReady) throw Error('이전 편집 구성의 보관 결과를 먼저 확인해주세요.');
  attempt.pending = true; attempt.retryReady = false; attempt.notApplied = false;
  const response = await fetcher(endpoint(input.selection, false), { method: 'PUT', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    optionId: input.selection.optionId, expectedRevision: input.expectedRevision, expectedView: detailWorkspaceExpectedView(input.selection.view), requestId: input.requestId, document: input.document }) });
  const body: unknown = await response.json(); signal.throwIfAborted();
  if (!response.ok) {
    if ([400, 401, 403, 404, 409, 413, 422].includes(response.status)) attempt.pending = false;
    throw Error(object(body) && typeof body.error === 'string' ? body.error : '편집 구성 보관 완료 여부를 확인하지 못했습니다. 결과를 확인해주세요.');
  }
  const reply = await validateDetailWorkspaceReply(input.selection, body), completed = receipt(input, reply); signal.throwIfAborted();
  attempt.completed = completed; attempt.pending = false; return reply;
}
export async function recoverDetailWorkspace(input: DetailWorkspaceSaveInput, attempt: DetailWorkspaceAttempt, signal: AbortSignal, fetcher: typeof fetch = fetch, current: DetailWorkspaceSelection = input.selection): Promise<DetailWorkspaceView> {
  await bind(input, attempt); selection(current);
  if (current.productId !== input.selection.productId || current.optionId !== input.selection.optionId || (current.profileId ?? '') !== (input.selection.profileId ?? '')
    || !same(current.view.categoryContext, input.selection.view.categoryContext)) throw changed();
  signal.throwIfAborted(); const reply = await readDetailWorkspace(current, signal, fetcher);
  if (!attempt.completed && same(reply.workspace, input.before.workspace)) {
    attempt.pending = false; attempt.retryReady = same(reply.view, input.selection.view); attempt.notApplied = !attempt.retryReady; return reply;
  }
  const completed = receipt(input, reply);
  if (attempt.completed && !same(attempt.completed, completed)) throw changed(); signal.throwIfAborted();
  attempt.completed = completed; attempt.pending = false; attempt.retryReady = false; attempt.notApplied = false; return reply;
}
/** Explicit read-only rebasing is available only after a GET proved that the
 * old workspace is still unchanged. The caller must obtain a new save click. */
export async function prepareDetailWorkspaceRebase(input: DetailWorkspaceSaveInput, attempt: DetailWorkspaceAttempt, current: DetailWorkspaceSelection, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<DetailWorkspaceSaveInput> {
  await bind(input, attempt); selection(current);
  if (!attempt.notApplied || attempt.pending || attempt.completed || current.productId !== input.selection.productId || current.optionId !== input.selection.optionId
    || (current.profileId ?? '') !== (input.selection.profileId ?? '') || !same(current.view.categoryContext, input.selection.view.categoryContext)) throw changed();
  const reply = await readDetailWorkspace(current, signal, fetcher); if (!same(reply.workspace, input.before.workspace)) throw changed();
  const prepared = await createDetailWorkspaceSave(current, reply, input.document); signal.throwIfAborted(); return prepared;
}
/** Confirm the saved record, actual owned bytes and the same current quote before
 * returning photo positions for a local draft. No quotation write is performed. */
export async function prepareDetailWorkspaceAdoption(input: DetailWorkspaceSelection, saved: DetailWorkspaceView, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<string[]> {
  await validateDetailWorkspaceReply(input, saved); if (!saved.workspace) throw changed();
  const before = await readDetailWorkspace(input, signal, fetcher); if (!same(before, saved)) throw changed();
  let total = 0;
  for (const file of saved.workspace.files) {
    signal.throwIfAborted(); const response = await fetcher(`/api/files/${file.key.split('/').map(encodeURIComponent).join('/')}`, { signal, cache: 'no-store' });
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw changed();
    const bytes = await readBoundedStream(response.body, MAX_IMAGE_BYTES); total += bytes.length; signal.throwIfAborted();
    const dimensions = imageDisplayDimensions(bytes);
    if (total > 30 * 1024 * 1024 || bytes.length !== file.bytes || await labelUploadDigest(bytes) !== file.sha256 || dimensions?.width !== file.width || dimensions.height !== file.height) throw changed();
  }
  if (!same(await readDetailWorkspace(input, signal, fetcher), saved)) throw changed(); signal.throwIfAborted();
  return saved.workspace.document.photos.map(photo => photo.key);
}
