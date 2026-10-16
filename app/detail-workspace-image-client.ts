import { validateFreeImageSource, validateImageTextRegions, type FreeImageSource, type FreeImageWorkspaceTarget, type ImageTextRegion } from '@/app/free-image-translation';
import { expectedFreeImageOutputKey, FreeImageApplyError, readFreeImageSourcePixels, readFreeImageTranslationReply, sameFreeImageSource,
  type FreeImageLoaded, type FreeImageRendered } from '@/app/free-image-translation-client';
import { validateFreeImageEditDocument } from '@/app/free-image-edit-document';
import { validateDetailWorkspaceReply, type DetailWorkspaceSelection } from '@/app/detail-workspace-client';
import { detailWorkspaceExpectedView, detailWorkspaceRequestId, generateDetailWorkspaceHtml, type DetailWorkspaceView } from '@/app/detail-workspace';
import { isOwnedImageKey, MAX_IMAGE_BYTES } from '@/app/image-files';
import { labelUploadDigest } from '@/app/label-upload-key';

export type FreeImageWorkspaceRequest = Omit<FreeImageWorkspaceTarget, 'bindingSha256'>;
export type DetailWorkspaceEditorContext = { selection: DetailWorkspaceSelection; saved: DetailWorkspaceView; target: FreeImageWorkspaceRequest };
export type DetailWorkspaceImageReply = { source: FreeImageSource; key: string; applied: true; editDocumentSha256: string; replayed?: boolean } & DetailWorkspaceView;
export type DetailWorkspaceImageRecovery = DetailWorkspaceImageReply | { source: FreeImageSource; key: string; applied: false; editDocumentSha256: string };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const invalid = (uncertain = false): never => { throw new FreeImageApplyError('작업 사진의 구성·원본·편집 문서 연결이 바뀌었습니다. 현재 편집을 유지하고 보관 결과를 확인해주세요.', uncertain); };
const endpoint = (productId: string) => `/api/products/${encodeURIComponent(productId)}/workspace-image-text`;
export function sameFreeImageWorkspaceRequest(actual: FreeImageWorkspaceTarget | FreeImageWorkspaceRequest | null | undefined, expected: FreeImageWorkspaceRequest | null | undefined): boolean {
  if (!actual || !expected) return !actual && !expected;
  return actual.kind === expected.kind && actual.profileId === expected.profileId && actual.optionId === expected.optionId && actual.photoId === expected.photoId
    && actual.revision === expected.revision && actual.digest === expected.digest;
}
async function context(value: DetailWorkspaceEditorContext) {
  const saved = await validateDetailWorkspaceReply(value.selection, value.saved), target = value.target, record = saved.workspace;
  if (!record || !target || Object.keys(target).length !== 6 || target.kind !== 'detail-workspace' || target.profileId !== (value.selection.profileId ?? null)
    || target.optionId !== value.selection.optionId || target.revision !== record.revision || target.digest !== record.digest) return invalid();
  const photos = record.document.photos.filter(photo => photo.id === target.photoId); if (photos.length !== 1 || photos[0].role !== 'body') return invalid();
  return { saved, record, photo: photos[0] };
}
function sourceMatches(source: FreeImageSource, value: DetailWorkspaceEditorContext, key: string) {
  return source.workspaceTarget && sameFreeImageWorkspaceRequest(source.workspaceTarget, value.target) && !source.quotationTarget && !source.optionImages
    && source.role === 'detail' && source.productId === value.selection.productId && source.productVersion === value.selection.view.productVersion
    && source.contentRevision === value.selection.view.contentRevision && (source.editorSource?.resultKey ?? source.sourceKey) === key;
}
export async function readDetailWorkspaceImage(value: DetailWorkspaceEditorContext, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<FreeImageLoaded> {
  const { photo } = await context(value); signal.throwIfAborted();
  const query = new URLSearchParams({ optionId: value.target.optionId, photoId: value.target.photoId, ...(value.target.profileId ? { profileId: value.target.profileId } : {}) });
  const response = await fetcher(`${endpoint(value.selection.productId)}?${query}`, { signal, cache: 'no-store' }), body: unknown = await response.json(); signal.throwIfAborted();
  if (!response.ok) throw Error(object(body) && typeof body.error === 'string' ? body.error : '작업 사진 편집 원본을 읽지 못했습니다.');
  if (!object(body) || Object.keys(body).some(key => !['source', 'editDocument'].includes(key))) return invalid();
  const source = validateFreeImageSource(body.source);
  const owner = value.selection.view.imageKeys[0]?.split('/')[0], proof = value.saved.workspace!.files.find(file => file.key === photo.key);
  if (!owner || !isOwnedImageKey(owner, source.sourceKey) || !proof || !sourceMatches(source, value, photo.key) || !!source.editorSource !== (body.editDocument !== undefined)
    || source.editorSource?.anchorPolicy !== undefined || (source.editorSource?.resultSha256 ?? source.sourceSha256) !== proof.sha256) return invalid();
  const document = body.editDocument === undefined ? undefined : validateFreeImageEditDocument(body.editDocument, source);
  return readFreeImageSourcePixels(source, signal, fetcher, document);
}
async function rendered(image: FreeImageRendered, value: DetailWorkspaceEditorContext) {
  const { saved, record, photo } = await context(value), source = validateFreeImageSource(image.source), owner = source.sourceKey.split('/')[0];
  if (!sourceMatches(source, value, photo.key) || !isOwnedImageKey(owner, source.sourceKey) || !image.editDocument || image.optionImageIds?.length
    || image.output.type !== 'image/png' || !image.output.size || image.output.size > MAX_IMAGE_BYTES) return invalid();
  const document = validateFreeImageEditDocument(image.editDocument, source), editDocumentSha256 = await labelUploadDigest(new TextEncoder().encode(JSON.stringify(document)));
  if (!same(document.crop, image.crop) || image.width !== (document.crop?.width ?? document.width) || image.height !== (document.crop?.height ?? document.height)) return invalid();
  const key = await expectedFreeImageOutputKey(image), sha256 = await labelUploadDigest(new Uint8Array(await image.output.arrayBuffer()));
  return { saved, record, photo, document, editDocumentSha256, key, sha256 };
}
async function applied(body: unknown, image: FreeImageRendered, value: DetailWorkspaceEditorContext): Promise<DetailWorkspaceImageReply> {
  const prepared = await rendered(image, value);
  if (!object(body) || Object.keys(body).some(key => !['source', 'key', 'applied', 'workspace', 'view', 'roles', 'editDocumentSha256', 'replayed', 'crop'].includes(key))
    || body.applied !== true || body.key !== prepared.key || body.editDocumentSha256 !== prepared.editDocumentSha256 || !sameFreeImageSource(body.source, image.source)
    || !same(body.crop, image.crop) || body.replayed !== undefined && typeof body.replayed !== 'boolean') return invalid(true);
  const reply = await validateDetailWorkspaceReply(value.selection, { view: body.view, workspace: body.workspace, roles: body.roles }), record = reply.workspace;
  const photos = prepared.record.document.photos.map(photo => photo.id === prepared.photo.id ? { ...photo, key: prepared.key } : photo);
  const expected = { ...prepared.record.document, photos, generatedHtml: generateDetailWorkspaceHtml(photos, prepared.record.document.imageMargin) };
  const requestId = await detailWorkspaceRequestId(value.selection.productId, value.selection.optionId, prepared.record.revision, detailWorkspaceExpectedView(value.selection.view), expected);
  if (!record || record.revision !== prepared.record.revision + 1 || record.requestId !== requestId || !same(record.company, prepared.record.company) || !same(record.document, expected) || !same(reply.roles, prepared.saved.roles)) return invalid(true);
  const file = record.files.find(file => file.key === prepared.key);
  if (!file || file.sha256 !== prepared.sha256 || file.bytes !== image.output.size || file.width !== image.width || file.height !== image.height
    || record.files.some(file => file.key !== prepared.key && !prepared.record.files.some(previous => same(previous, file)))) return invalid(true);
  return { ...reply, source: image.source, key: prepared.key, applied: true, editDocumentSha256: prepared.editDocumentSha256, ...(body.replayed === undefined ? {} : { replayed: body.replayed }) };
}
export async function applyDetailWorkspaceImage(image: FreeImageRendered, value: DetailWorkspaceEditorContext, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<DetailWorkspaceImageReply> {
  const prepared = await rendered(image, value); signal.throwIfAborted();
  const form = new FormData(); form.set('action', 'apply'); form.set('source', JSON.stringify(image.source)); form.set('file', image.output, 'workspace-image.png');
  form.set('editDocument', JSON.stringify(prepared.document)); if (image.crop) form.set('crop', JSON.stringify(image.crop));
  try {
    const response = await fetcher(endpoint(image.source.productId), { method: 'POST', body: form, signal }), body: unknown = await response.json(); signal.throwIfAborted();
    if (!response.ok) throw new FreeImageApplyError(object(body) && typeof body.error === 'string' ? body.error : '작업 사진 보관 결과를 확인하지 못했습니다.', ![400, 403, 404, 409, 413, 415].includes(response.status));
    const reply = await applied(body, image, value); signal.throwIfAborted(); return reply;
  } catch (cause) { if (cause instanceof FreeImageApplyError) throw cause; throw new FreeImageApplyError('작업 사진 보관 완료 여부를 확인하지 못했습니다. 같은 미리보기의 결과를 확인해주세요.', true); }
}
export async function recoverDetailWorkspaceImage(image: FreeImageRendered, value: DetailWorkspaceEditorContext, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<DetailWorkspaceImageRecovery> {
  const prepared = await rendered(image, value); signal.throwIfAborted();
  const response = await fetcher(endpoint(image.source.productId), { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'recover', source: image.source,
    outputSha256: prepared.sha256, outputBytes: image.output.size, editDocument: prepared.document, ...(image.crop ? { crop: image.crop } : {}) }) }), body: unknown = await response.json(); signal.throwIfAborted();
  if (!response.ok) throw new FreeImageApplyError(object(body) && typeof body.error === 'string' ? body.error : '작업 사진 보관 결과를 확인하지 못했습니다.', true);
  if (object(body) && body.applied === true) return applied(body, image, value);
  if (!object(body) || Object.keys(body).some(key => !['source', 'key', 'applied', 'editDocumentSha256', 'crop'].includes(key)) || body.applied !== false
    || !sameFreeImageSource(body.source, image.source) || body.key !== prepared.key || body.editDocumentSha256 !== prepared.editDocumentSha256 || !same(body.crop, image.crop)) return invalid(true);
  return { source: image.source, key: prepared.key, applied: false, editDocumentSha256: prepared.editDocumentSha256 };
}
export async function translateDetailWorkspaceImage(source: FreeImageSource, sourceLanguage: 'zh' | 'en', regions: readonly ImageTextRegion[], signal: AbortSignal, fetcher: typeof fetch = fetch) {
  validateFreeImageSource(source); if (!source.workspaceTarget || source.quotationTarget || source.optionImages || !['zh', 'en'].includes(sourceLanguage)) return invalid();
  const requested = validateImageTextRegions(regions); signal.throwIfAborted();
  const response = await fetcher(endpoint(source.productId), { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'translate', source, sourceLanguage, regions: requested }) }), body: unknown = await response.json(); signal.throwIfAborted();
  if (!response.ok) throw Error(object(body) && typeof body.error === 'string' ? body.error : '작업 사진 문구 번역을 완료하지 못했습니다.');
  return readFreeImageTranslationReply(body, source, requested);
}
/** Explicitly reopen the latest server composition without classifying an old
 * image write as applied or unapplied, and without repeating that write. */
export async function readLatestDetailWorkspaceForEditor(value: DetailWorkspaceEditorContext, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<DetailWorkspaceView> {
  const { record } = await context(value); signal.throwIfAborted();
  const query = new URLSearchParams({ optionId: value.selection.optionId, ...(value.selection.profileId ? { profileId: value.selection.profileId } : {}) });
  const response = await fetcher(`/api/products/${encodeURIComponent(value.selection.productId)}/detail-workspace?${query}`, { signal, cache: 'no-store' }), body: unknown = await response.json(); signal.throwIfAborted();
  if (!response.ok || !object(body) || !object(body.view)) return invalid(true);
  const latest = await validateDetailWorkspaceReply({ ...value.selection, view: body.view as DetailWorkspaceView['view'] }, body); signal.throwIfAborted();
  if (!latest.workspace || latest.workspace.revision < record.revision || !same(latest.workspace.context, record.context) || !same(latest.workspace.company, record.company)) return invalid(true);
  return latest;
}
