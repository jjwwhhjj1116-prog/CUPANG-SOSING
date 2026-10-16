import type { QuotationFieldsView } from '@/app/quotation-schema';
import { detailWorkspaceDigest, detailWorkspaceExpectedView, validateDetailWorkspaceRecord, type DetailWorkspaceView } from '@/app/detail-workspace';
import { validateDetailWorkspaceReply, type DetailWorkspaceSelection } from '@/app/detail-workspace-client';
import { createDetailWorkspaceBannerPreview, type DetailWorkspaceBannerRebasePreview } from '@/app/detail-workspace-banner-rebase';

export type DetailWorkspaceBannerRebaseAttempt = { identity?: string; pending?: boolean; retryReady?: boolean;
  completed?: DetailWorkspaceView; superseded?: boolean };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const changed = () => Error('상하단 이미지·본문 구성이나 상품 저장 기준이 바뀌었습니다. 현재 자료를 유지하고 최신 구성을 먼저 확인해주세요.');
const endpoint = (input: DetailWorkspaceSelection, normal = false) => {
  const query = new URLSearchParams({ optionId: input.optionId, ...(input.profileId ? { profileId: input.profileId } : {}) });
  return `/api/products/${encodeURIComponent(input.productId)}/detail-workspace${normal ? '' : '/banner-rebase'}?${query}`;
};
const problem = (body: unknown) => object(body) && typeof body.error === 'string' ? body.error : '상하단 이미지 갱신 결과를 확인하지 못했습니다. 조회로 먼저 확인해주세요.';

export async function validateDetailWorkspaceBannerPreview(selection: DetailWorkspaceSelection, value: unknown): Promise<DetailWorkspaceBannerRebasePreview> {
  if (!object(value) || Object.keys(value).length !== 7 || !['format', 'view', 'workspace', 'roles', 'document', 'files', 'requestId'].every(key => Object.hasOwn(value, key))
    || !same(value.view, selection.view) || !object(value.workspace)) throw changed();
  const owner = selection.view.imageKeys[0]?.split('/')[0]; if (!owner) throw changed();
  const workspace = validateDetailWorkspaceRecord(value.workspace, owner, selection.productId, selection.optionId, selection.view.categoryContext,
    value.workspace.company as Parameters<typeof validateDetailWorkspaceRecord>[5]);
  const { digest, ...record } = workspace; if (await detailWorkspaceDigest(record) !== digest) throw changed();
  const rebuilt = await createDetailWorkspaceBannerPreview(selection.view, workspace,
    value.roles as DetailWorkspaceBannerRebasePreview['roles'], value.files as DetailWorkspaceBannerRebasePreview['files']);
  if (!same(rebuilt, value)) throw changed(); return rebuilt;
}
export async function readDetailWorkspaceBannerRebase(selection: DetailWorkspaceSelection, signal: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<DetailWorkspaceBannerRebasePreview> {
  signal.throwIfAborted(); const response = await fetcher(endpoint(selection), { signal, cache: 'no-store' });
  const body: unknown = await response.json(); signal.throwIfAborted(); if (!response.ok) throw Error(problem(body));
  const preview = await validateDetailWorkspaceBannerPreview(selection, body); signal.throwIfAborted(); return preview;
}
async function bind(selection: DetailWorkspaceSelection, preview: DetailWorkspaceBannerRebasePreview, attempt: DetailWorkspaceBannerRebaseAttempt) {
  if (attempt.superseded) throw changed(); await validateDetailWorkspaceBannerPreview(selection, preview);
  const identity = JSON.stringify([selection, preview]);
  if (attempt.identity !== undefined && attempt.identity !== identity || attempt.identity === undefined && (attempt.pending || attempt.retryReady || attempt.completed)) throw changed();
  attempt.identity = identity;
}
async function confirm(selection: DetailWorkspaceSelection, preview: DetailWorkspaceBannerRebasePreview, value: unknown): Promise<DetailWorkspaceView> {
  const reply = await validateDetailWorkspaceReply(selection, value), record = reply.workspace, before = preview.workspace;
  if (!record || !same(reply.roles, preview.roles) || record.revision !== before.revision + 1 || record.requestId !== preview.requestId
    || !same(record.document, preview.document) || !same(record.files, preview.files)
    || !same(record.company, before.company) || !same(record.context, before.context)
    || Date.parse(record.updatedAt) <= Date.parse(before.updatedAt)) throw changed();
  return reply;
}
/** Only the separately reviewed banner replacement is committed; no quotation,
 * content, pool or file write is sent by this client. */
export async function applyDetailWorkspaceBannerRebase(selection: DetailWorkspaceSelection, preview: DetailWorkspaceBannerRebasePreview,
  attempt: DetailWorkspaceBannerRebaseAttempt, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<DetailWorkspaceView> {
  await bind(selection, preview, attempt); signal.throwIfAborted();
  if (attempt.completed) {
    const response = await fetcher(endpoint(selection, true), { signal, cache: 'no-store' }), body: unknown = await response.json();
    signal.throwIfAborted(); if (!response.ok) throw Error(problem(body)); const current = await confirm(selection, preview, body);
    if (!same(current, attempt.completed)) throw changed(); return current;
  }
  if (attempt.pending || attempt.identity && !attempt.retryReady && attempt.pending !== undefined) throw Error('이전 상하단 갱신 결과를 먼저 조회해주세요.');
  if (!same(await readDetailWorkspaceBannerRebase(selection, signal, fetcher), preview)) throw changed();
  const query = new URLSearchParams(selection.profileId ? { profileId: selection.profileId } : {});
  const url = `/api/products/${encodeURIComponent(selection.productId)}/detail-workspace/banner-rebase${query.size ? `?${query}` : ''}`;
  attempt.pending = true; attempt.retryReady = false;
  const response = await fetcher(url, { method: 'PUT', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    optionId: selection.optionId, expectedRevision: preview.workspace.revision, expectedDigest: preview.workspace.digest,
    expectedView: detailWorkspaceExpectedView(selection.view), requestId: preview.requestId }) });
  const body: unknown = await response.json(); signal.throwIfAborted();
  if (!response.ok) { if ([400, 401, 403, 404, 409, 413, 415, 422].includes(response.status)) attempt.pending = false; throw Error(problem(body)); }
  const reply = await confirm(selection, preview, body); signal.throwIfAborted();
  attempt.completed = reply; attempt.pending = false; return reply;
}
/** A missing acknowledgement is resolved with reads only. An unchanged old
 * record prepares an explicit same-request retry, never an automatic PUT. */
export async function recoverDetailWorkspaceBannerRebase(selection: DetailWorkspaceSelection, preview: DetailWorkspaceBannerRebasePreview,
  attempt: DetailWorkspaceBannerRebaseAttempt, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<'ready' | 'completed'> {
  await bind(selection, preview, attempt); signal.throwIfAborted();
  if (!attempt.pending && !attempt.completed) return 'ready';
  const response = await fetcher(endpoint(selection, true), { signal, cache: 'no-store' });
  const body: unknown = await response.json(); signal.throwIfAborted();
  if (response.ok) {
    try {
      const reply = await confirm(selection, preview, body); signal.throwIfAborted();
      if (attempt.completed && !same(attempt.completed, reply)) throw changed();
      attempt.completed = reply; attempt.pending = false; attempt.retryReady = false; return 'completed';
    } catch { if (attempt.completed) throw changed(); }
  } else if (response.status !== 409) throw Error(problem(body));
  if (!same(await readDetailWorkspaceBannerRebase(selection, signal, fetcher), preview)) throw changed();
  attempt.pending = false; attempt.retryReady = true; return 'ready';
}
/** Explicitly abandons the old local confirmation attempt after reading a
 * fresh preview. It never establishes the outcome of that previous request. */
export async function readLatestDetailWorkspaceBannerRebase(selection: DetailWorkspaceSelection, attempt: DetailWorkspaceBannerRebaseAttempt | undefined,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<DetailWorkspaceBannerRebasePreview> {
  signal.throwIfAborted(); const url = `/api/products/${encodeURIComponent(selection.productId)}/quotation-fields${selection.profileId ? `?profileId=${encodeURIComponent(selection.profileId)}` : ''}`;
  const response = await fetcher(url, { signal, cache: 'no-store' }), view = await response.json() as QuotationFieldsView & { error?: string }; signal.throwIfAborted();
  if (!response.ok) throw Error(view.error || '최신 견적 저장 기준을 읽지 못했습니다.');
  if (!same(view.categoryContext, selection.view.categoryContext)) throw changed();
  const preview = await readDetailWorkspaceBannerRebase({ ...selection, view }, signal, fetcher); signal.throwIfAborted();
  if (attempt) { attempt.superseded = true; attempt.pending = false; attempt.retryReady = false; }
  return preview;
}
