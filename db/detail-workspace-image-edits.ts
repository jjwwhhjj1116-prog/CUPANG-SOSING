import { env } from 'cloudflare:workers';
import { readDetailWorkspaceImageSeal, confirmDetailWorkspaceImageSeal, applyDetailWorkspaceImageSeal, type DetailWorkspaceImageSeal } from '@/db/detail-workspaces';
import { DetailWorkspaceError, detailWorkspaceExpectedView, detailWorkspaceRequestId } from '@/app/detail-workspace';
import { freeImageSourceIdentity, validateFreeImageSource, type FreeImageSource } from '@/app/free-image-translation';
import { validateFreeImageEditDocument, type FreeImageEditDocument } from '@/app/free-image-edit-document';
import { freeImageEditDigest, freeImageEditOutputKey, prepareFreeImageEditRecord, readFreeImageEditRecord, storeFreeImageEditRecord } from '@/app/free-image-edit-record';
import { inspectImage } from '@/app/automation/image-edit';
import { MAX_IMAGE_BYTES, isOwnedImageKey } from '@/app/image-files';
import { readBoundedStream } from '@/app/request-body';
import type { FreeImageCrop } from '@/app/free-image-crop';
import { validateFreeImageCrop } from '@/app/free-image-crop';
import type { SupplierHubCompany } from '@/app/supplier-hub-company';

export type WorkspaceImageIdentity = { owner: string; company: SupplierHubCompany; identity: { email: string; role: string }; id: string };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const changed = () => new DetailWorkspaceError('상세 작업공간의 사진·원본·회사 또는 저장 기준이 변경되었습니다. 현재 미리보기를 보존하고 결과를 확인해주세요.');
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
async function binding(seal: DetailWorkspaceImageSeal, target: Pick<NonNullable<FreeImageSource['workspaceTarget']>, 'revision' | 'digest' | 'photoId'>) {
  return freeImageEditDigest(new TextEncoder().encode(JSON.stringify({ source: seal.before.saved.payload, context: seal.before.view.categoryContext,
    company: seal.company, optionId: seal.optionId, photoId: target.photoId, revision: target.revision, digest: target.digest })));
}
async function image(key: string) {
  if (!env.FILES) throw new DetailWorkspaceError('이미지 저장소를 확인해주세요.', 503);
  const object = await env.FILES.get(key); if (!object || object.size < 1 || object.size > MAX_IMAGE_BYTES) throw changed();
  const bytes = await readBoundedStream(object.body, MAX_IMAGE_BYTES);
  let dimensions; try { dimensions = inspectImage(bytes); } catch { throw new DetailWorkspaceError('PNG·JPEG·WebP 정지 이미지를 선택해주세요.', 415); }
  if (bytes.length !== object.size || dimensions.width * dimensions.height > 12000000) throw changed();
  return { bytes, dimensions, sha256: await freeImageEditDigest(bytes) };
}
function target(source: FreeImageSource, auth: WorkspaceImageIdentity) {
  const value = validateFreeImageSource(source).workspaceTarget;
  if (!value || source.productId !== auth.id || source.quotationTarget || source.optionImages || source.role !== 'detail' || !isOwnedImageKey(auth.owner, source.sourceKey)) throw changed();
  return value;
}
export async function readWorkspaceImageSource(auth: WorkspaceImageIdentity, profileId: string | null, optionId: string, photoId: string, signal: AbortSignal) {
  const seal = await readDetailWorkspaceImageSeal(auth.owner, auth.company, auth.identity, auth.id, profileId, optionId, signal),
    photo = seal.workspace.document.photos.find(photo => photo.id === photoId);
  if (!photo || photo.role !== 'body') throw changed();
  let sourceKey = photo.key, editorSource: FreeImageSource['editorSource'], editDocument: FreeImageEditDocument | undefined;
  if (photo.key.startsWith(`${auth.owner}/free-image-workspace-`)) {
    if (!env.FILES) throw changed();
    const saved = await readFreeImageEditRecord(env.FILES, auth.owner, auth.id, photo.key), prior = saved.record.source.workspaceTarget;
    if (!prior || prior.optionId !== optionId || prior.photoId !== photoId || prior.profileId !== profileId
      || !same(saved.record.context, seal.before.view.categoryContext) || !same(saved.record.company, auth.company)) throw changed();
    sourceKey = saved.record.source.sourceKey; editDocument = saved.record.document;
    editorSource = { resultKey: photo.key, resultSha256: saved.record.result.sha256, documentSha256: saved.documentSha256 };
  }
  if (!seal.before.view.imageKeys.includes(sourceKey) || !isOwnedImageKey(auth.owner, sourceKey)) throw changed();
  const base = await image(sourceKey), scope = { kind: 'detail-workspace' as const, profileId, optionId, photoId, revision: seal.workspace.revision, digest: seal.workspace.digest },
    source = validateFreeImageSource({ productId: auth.id, productVersion: seal.before.view.productVersion, contentRevision: seal.before.view.contentRevision,
      sourceKey, sourceSha256: base.sha256, role: 'detail', width: base.dimensions.width, height: base.dimensions.height,
      workspaceTarget: { ...scope, bindingSha256: await binding(seal, scope) }, ...(editorSource ? { editorSource } : {}) });
  if (editorSource) {
    const saved = await readFreeImageEditRecord(env.FILES, auth.owner, auth.id, editorSource.resultKey);
    if (base.sha256 !== saved.record.source.sourceSha256 || source.width !== saved.record.source.width || source.height !== saved.record.source.height) throw changed();
  }
  await confirmDetailWorkspaceImageSeal(seal, signal);
  return { seal, source, ...(editDocument ? { editDocument } : {}) };
}
async function fresh(auth: WorkspaceImageIdentity, source: FreeImageSource, signal: AbortSignal) {
  const selected = target(source, auth), current = await readWorkspaceImageSource(auth, selected.profileId, selected.optionId, selected.photoId, signal);
  if (freeImageSourceIdentity(current.source) !== freeImageSourceIdentity(source)) throw changed(); return current;
}
export function workspaceImageDocument(source: FreeImageSource, value: unknown, cropValue?: unknown) {
  let document: FreeImageEditDocument, crop: FreeImageCrop | undefined;
  try {
    document = validateFreeImageEditDocument(value, source); crop = cropValue === undefined ? undefined : validateFreeImageCrop(cropValue, source);
    if (!same(document.crop, crop)) throw changed();
  } catch { throw new DetailWorkspaceError('미리보기와 같은 편집 문서·자르기 영역을 확인해주세요.', 400); }
  return { document, crop };
}
async function output(auth: WorkspaceImageIdentity, source: FreeImageSource, document: FreeImageEditDocument, sha256: string, bytes: number) {
  const result = await freeImageEditOutputKey(source, document, sha256);
  if (!env.FILES) throw changed();
  const object = await env.FILES.get(result.key); if (!object) return { ...result, saved: false as const };
  const saved = await readFreeImageEditRecord(env.FILES, auth.owner, auth.id, result.key);
  if (freeImageSourceIdentity(saved.record.source) !== freeImageSourceIdentity(source) || !same(saved.record.document, document)
    || saved.record.result.sha256 !== sha256 || saved.record.result.bytes !== bytes) throw changed();
  return { ...result, saved: true as const };
}
async function replay(auth: WorkspaceImageIdentity, source: FreeImageSource, document: FreeImageEditDocument, sha256: string, bytes: number, signal: AbortSignal) {
  const selected = target(source, auth), stored = await output(auth, source, document, sha256, bytes);
  if (!stored.saved) return null;
  const seal = await readDetailWorkspaceImageSeal(auth.owner, auth.company, auth.identity, auth.id, selected.profileId, selected.optionId, signal), record = seal.workspace,
    photo = record.document.photos.find(photo => photo.id === selected.photoId);
  if (record.revision !== selected.revision + 1 || !photo || photo.role !== 'body' || photo.key !== stored.key) return null;
  if (seal.before.view.productVersion !== source.productVersion || seal.before.view.contentRevision !== source.contentRevision
    || await binding(seal, selected) !== selected.bindingSha256 || record.requestId !== await detailWorkspaceRequestId(auth.id, selected.optionId, selected.revision, detailWorkspaceExpectedView(seal.before.view), record.document)) throw changed();
  const base = await image(source.sourceKey); if (base.sha256 !== source.sourceSha256 || base.dimensions.width !== source.width || base.dimensions.height !== source.height) throw changed();
  await confirmDetailWorkspaceImageSeal(seal, signal);
  return { source, key: stored.key, applied: true as const, workspace: record, view: seal.before.view, roles: seal.before.roles,
    editDocumentSha256: stored.documentSha256, replayed: true as const, ...(document.crop ? { crop: document.crop } : {}) };
}
export async function recoverWorkspaceImage(auth: WorkspaceImageIdentity, source: FreeImageSource, document: FreeImageEditDocument, sha256: string, bytes: number, signal: AbortSignal) {
  if (!hash(sha256) || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_IMAGE_BYTES) throw new DetailWorkspaceError('PNG 결과의 크기와 확인 번호를 확인해주세요.', 400);
  const acknowledged = await replay(auth, source, document, sha256, bytes, signal); if (acknowledged) return acknowledged;
  await fresh(auth, source, signal); const saved = await output(auth, source, document, sha256, bytes);
  return { source, key: saved.key, applied: false as const, editDocumentSha256: saved.documentSha256, ...(document.crop ? { crop: document.crop } : {}) };
}
export async function applyWorkspaceImage(auth: WorkspaceImageIdentity, source: FreeImageSource, document: FreeImageEditDocument, bytes: Uint8Array, signal: AbortSignal) {
  target(source, auth); if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new DetailWorkspaceError('PNG 한 장은10MiB 이하여야 합니다.', 413);
  let dimensions; try { dimensions = inspectImage(bytes); } catch { throw new DetailWorkspaceError('유효한 PNG 결과를 전달해주세요.', 415); }
  if (dimensions.mime !== 'image/png' || dimensions.width !== (document.crop?.width ?? document.width) || dimensions.height !== (document.crop?.height ?? document.height)) throw new DetailWorkspaceError('PNG와 편집 문서의 실제 크기가 다릅니다.', 400);
  const sha256 = await freeImageEditDigest(bytes), acknowledged = await replay(auth, source, document, sha256, bytes.length, signal); if (acknowledged) return acknowledged;
  const current = await fresh(auth, source, signal), stored = await output(auth, source, document, sha256, bytes.length);
  if (!env.FILES) throw changed();
  const prepared = await prepareFreeImageEditRecord(source, document, current.seal.before.view.categoryContext, auth.company,
    { key: stored.key, sha256, bytes: bytes.length, width: dimensions.width, height: dimensions.height });
  await storeFreeImageEditRecord(env.FILES, prepared);
  if (!stored.saved) {
    try {
      await env.FILES.put(stored.key, bytes, { onlyIf: new Headers({ 'if-none-match': '*' }), httpMetadata: { contentType: 'image/png' }, customMetadata: {
        freeImageOutputSha256: sha256, freeImageEditDocumentSha256: prepared.documentSha256, freeImageEditRecordSha256: prepared.recordSha256,
        freeImageSourceSha256: await freeImageEditDigest(new TextEncoder().encode(freeImageSourceIdentity(source))),
        imageValidation: 'header-v1', dimensionValidation: 'header-v1', imageWidth: String(dimensions.width), imageHeight: String(dimensions.height),
      } });
    } catch (error) { if (!(await output(auth, source, document, sha256, bytes.length)).saved) throw error; }
  }
  if (!(await output(auth, source, document, sha256, bytes.length)).saved) throw new DetailWorkspaceError('PNG 저장 결과를 확인하지 못했습니다.', 503);
  const confirmed = await fresh(auth, source, signal);
  try {
    await applyDetailWorkspaceImageSeal(confirmed.seal, source, stored.key, signal);
  } catch (error) {
    try { const recovered = await replay(auth, source, document, sha256, bytes.length, signal); if (recovered) return recovered; }
    catch (recoveryError) { if (error instanceof DetailWorkspaceError && error.status === 503) throw error; throw recoveryError; }
    throw error;
  }
  let saved;
  try { saved = await replay(auth, source, document, sha256, bytes.length, signal); }
  catch { throw new DetailWorkspaceError('사진 보관 후 완료 응답을 확인하지 못했습니다. 같은 미리보기로 결과를 먼저 조회해주세요.', 503); }
  if (!saved) throw new DetailWorkspaceError('보관 결과를 확인하지 못했습니다. 같은 미리보기로 조회해주세요.', 503);
  const { replayed: omitted, ...reply } = saved; void omitted; return reply;
}
export async function confirmWorkspaceImageSource(auth: WorkspaceImageIdentity, source: FreeImageSource, signal: AbortSignal) { return fresh(auth, source, signal); }
