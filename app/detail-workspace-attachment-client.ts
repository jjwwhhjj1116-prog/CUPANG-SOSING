import { detailWorkspaceExpectedView, type DetailWorkspaceView } from '@/app/detail-workspace';
import { validateDetailWorkspaceReply, type DetailWorkspaceSelection } from '@/app/detail-workspace-client';
import { detailWorkspaceAttachedKeys, verifyDetailWorkspaceAttachment } from '@/app/detail-workspace-attachment';

export type DetailWorkspaceAttachmentAttempt = { identity?: string; pending?: boolean; completed?: DetailWorkspaceView; retryReady?: boolean; superseded?: boolean };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const changed = () => Error('사진 연결 결과를 확정하지 못했습니다. 같은 구성을 유지하고 조회로 먼저 확인해주세요.');
const endpoint = (selection: DetailWorkspaceSelection, attach: boolean) => `/api/products/${encodeURIComponent(selection.productId)}/detail-workspace${attach ? '/attach' : ''}?${new URLSearchParams({
  ...(!attach ? { optionId: selection.optionId } : {}), ...(selection.profileId ? { profileId: selection.profileId } : {}) })}`;
async function bind(selection: DetailWorkspaceSelection, saved: DetailWorkspaceView, attempt: DetailWorkspaceAttachmentAttempt) {
  await validateDetailWorkspaceReply(selection, saved);
  if (!saved.workspace || detailWorkspaceAttachedKeys(saved).length === saved.view.imageKeys.length) throw changed();
  const identity = JSON.stringify({ selection, saved });
  if (attempt.identity !== undefined && attempt.identity !== identity || attempt.identity === undefined && (attempt.pending || attempt.completed || attempt.retryReady || attempt.superseded)) throw changed();
  attempt.identity = identity;
}
async function reply(selection: DetailWorkspaceSelection, saved: DetailWorkspaceView, value: unknown) {
  if (!value || typeof value !== 'object' || !('view' in value) || !value.view || typeof value.view !== 'object') throw changed();
  const current = await validateDetailWorkspaceReply({ ...selection, view: value.view as DetailWorkspaceView['view'] }, value);
  verifyDetailWorkspaceAttachment(saved, current); return current;
}
export async function attachDetailWorkspaceFiles(selection: DetailWorkspaceSelection, saved: DetailWorkspaceView, attempt: DetailWorkspaceAttachmentAttempt,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<DetailWorkspaceView> {
  const bound = attempt.identity !== undefined; await bind(selection, saved, attempt); signal.throwIfAborted();
  if (attempt.pending || attempt.completed || attempt.superseded || bound && !attempt.retryReady) throw changed();
  attempt.pending = true; attempt.retryReady = false;
  const response = await fetcher(endpoint(selection, true), { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    optionId: selection.optionId, expectedView: detailWorkspaceExpectedView(selection.view), revision: saved.workspace!.revision, digest: saved.workspace!.digest }) });
  const body: unknown = await response.json(); signal.throwIfAborted();
  if (!response.ok) {
    if ([400, 401, 403, 404, 409, 413, 422].includes(response.status)) attempt.pending = false;
    throw Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : changed().message);
  }
  const current = await reply(selection, saved, body); signal.throwIfAborted(); attempt.pending = false; attempt.completed = current; return current;
}
export async function recoverDetailWorkspaceFiles(selection: DetailWorkspaceSelection, saved: DetailWorkspaceView, attempt: DetailWorkspaceAttachmentAttempt,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<{ attached: boolean; reply: DetailWorkspaceView }> {
  await bind(selection, saved, attempt); signal.throwIfAborted(); if (attempt.superseded) throw changed();
  const response = await fetcher(endpoint(selection, false), { signal, cache: 'no-store' }), body: unknown = await response.json(); signal.throwIfAborted();
  if (!response.ok) throw changed();
  if (!attempt.completed && same(body, saved)) {
    attempt.pending = false; attempt.retryReady = true; return { attached: false, reply: saved };
  }
  const current = await reply(selection, saved, body);
  if (attempt.completed && !same(attempt.completed, current)) throw changed();
  signal.throwIfAborted(); attempt.pending = false; attempt.retryReady = false; attempt.completed = current; return { attached: true, reply: current };
}
/** Explicitly leave an old uncertain receipt and read the current state. This
 * does not prove which request attached the files, nor that other quote edits
 * were unchanged. A superseded receipt can never dispatch its old write again. */
export async function readLatestDetailWorkspaceAfterAttachment(selection: DetailWorkspaceSelection, saved: DetailWorkspaceView, attempt: DetailWorkspaceAttachmentAttempt,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<DetailWorkspaceView> {
  await bind(selection, saved, attempt); signal.throwIfAborted();
  const response = await fetcher(endpoint(selection, false), { signal, cache: 'no-store' }), body: unknown = await response.json(); signal.throwIfAborted();
  if (!response.ok || !body || typeof body !== 'object' || !('view' in body) || !body.view || typeof body.view !== 'object') throw changed();
  const current = await validateDetailWorkspaceReply({ ...selection, view: body.view as DetailWorkspaceView['view'] }, body);
  if (!same(current.view.categoryContext, saved.view.categoryContext) || !current.workspace || !saved.workspace
    || !same(current.workspace.company, saved.workspace.company) || current.workspace.revision < saved.workspace.revision) throw changed();
  signal.throwIfAborted(); attempt.pending = false; attempt.retryReady = false; attempt.superseded = true; return current;
}
