import { renderDetailImageSequence, type DetailComposite } from '@/app/detail-image-composite';
import { readDetailWorkspace, validateDetailWorkspaceReply, type DetailWorkspaceSelection } from '@/app/detail-workspace-client';
import type { DetailWorkspaceRecord, DetailWorkspaceView } from '@/app/detail-workspace';
import { applyDetailSave, recoverDetailSave, type DetailSaveAttempt } from '@/app/detail-save-client';
import { DETAIL_SAVE_EDITOR_POLICY } from '@/app/detail-save-plan';
import { labelUploadDigest } from '@/app/label-upload-key';
import { PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-pool-limit';
import type { QuotationFieldsView } from '@/app/quotation-schema';

export type DetailWorkspaceComposite = DetailComposite & { workspace: DetailWorkspaceRecord };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const changed = () => Error('보관한 상세 구성이나 견적 저장 기준이 변경되었습니다. 미리보기와 작업 구성을 유지하고 최신 상태를 확인해주세요.');
const endpoint = (input: DetailWorkspaceSelection) => `/api/products/${encodeURIComponent(input.productId)}/quotation-fields${input.profileId ? `?profileId=${encodeURIComponent(input.profileId)}` : ''}`;
const options = (input: DetailWorkspaceComposite) => ({ editorPolicy: DETAIL_SAVE_EDITOR_POLICY, workspace: input.workspace });

/** Real current workspace pixels, read twice and rendered using the final
 * 800px full-bleed convention. Editor-only generated HTML/margins are retained. */
export async function prepareDetailWorkspaceComposite(selection: DetailWorkspaceSelection, saved: DetailWorkspaceView,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<DetailWorkspaceComposite> {
  signal.throwIfAborted(); const before = await validateDetailWorkspaceReply(selection, saved), record = before.workspace;
  if (!record || !record.document.photos.length) throw Error('사진이 있는 상세 편집 구성을 먼저 보관해주세요.');
  if (!same(await readDetailWorkspace(selection, signal, fetcher), before)) throw changed();
  const keys = record.document.photos.map(photo => photo.key);
  const missing = [...new Set(keys.filter(key => !selection.view.imageKeys.includes(key)))];
  if (selection.view.imageKeys.length + missing.length + 1 > PRODUCT_IMAGE_POOL_LIMIT)
    throw Error('현재 사진과 최종 이미지를 함께 보존할 상품 이미지 공간이 부족합니다. 기존 파일은 유지됩니다.');
  const rendered = await renderDetailImageSequence(selection, keys, signal, fetcher, 'png', true);
  for (const source of rendered.sources) {
    const proof = record.files.find(file => file.key === source.key);
    if (!proof || proof.sha256 !== source.sha256 || proof.width !== source.width || proof.height !== source.height) throw changed();
  }
  if (!same(await readDetailWorkspace(selection, signal, fetcher), before)) throw changed();
  const sha256 = await labelUploadDigest(rendered.bytes), workspace = { revision: record.revision, digest: record.digest };
  const uploadId = await labelUploadDigest(new TextEncoder().encode(JSON.stringify({ kind: 'workspace-detail-composite-v1',
    productId: selection.productId, optionId: selection.optionId, category: selection.view.categoryContext,
    fingerprint: selection.view.inputFingerprint, workspace, sources: rendered.sources, width: 800, height: rendered.height, sha256 })));
  signal.throwIfAborted();
  return { ...selection, keys, sources: rendered.sources, output: rendered.output, width: 800, height: rendered.height,
    sha256, uploadId, workspace: structuredClone(record) };
}
async function verifyPrepared(input: DetailWorkspaceComposite, signal: AbortSignal, fetcher: typeof fetch) {
  const saved = await readDetailWorkspace(input, signal, fetcher);
  if (!same(saved.workspace, input.workspace) || !same(input.keys, input.workspace.document.photos.map(photo => photo.key))
    || input.sources.length !== input.keys.length || input.sources.some((source, index) => source.key !== input.keys[index])) throw changed();
  for (const source of input.sources) {
    const file = input.workspace.files.find(file => file.key === source.key);
    if (!file || file.sha256 !== source.sha256 || file.width !== source.width || file.height !== source.height) throw changed();
  }
}
export async function applyDetailWorkspaceComposite(input: DetailWorkspaceComposite, attempt: DetailSaveAttempt,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<QuotationFieldsView> {
  if (!attempt.pending && !attempt.completed) await verifyPrepared(input, signal, fetcher);
  return applyDetailSave(input, attempt, signal, fetcher, options(input));
}
/** Reads only. A lost acknowledgement never repeats the upload or save. */
export async function recoverDetailWorkspaceComposite(input: DetailWorkspaceComposite, attempt: DetailSaveAttempt,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<'ready' | 'completed'> {
  return recoverDetailSave(input, attempt, signal, fetcher, options(input));
}
/** Explicit escape from a superseded preview. It does not establish whether
 * the previous attempt committed and never issues a mutation. */
export async function readLatestDetailWorkspaceComposite(selection: DetailWorkspaceSelection, signal: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<DetailWorkspaceView> {
  signal.throwIfAborted(); const response = await fetcher(endpoint(selection), { signal, cache: 'no-store' });
  const body = await response.json() as QuotationFieldsView & { error?: string }; signal.throwIfAborted();
  if (!response.ok) throw Error(body.error || '최신 견적 저장 기준을 읽지 못했습니다.');
  if (!same(body.categoryContext, selection.view.categoryContext)) throw changed();
  return readDetailWorkspace({ ...selection, view: body }, signal, fetcher);
}
