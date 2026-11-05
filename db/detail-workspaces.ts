import { env } from 'cloudflare:workers';
import { readOwnedSplitSnapshot, splitSnapshotPredicate } from '@/db/product-option-splits';
import { stableQuotationFieldsView } from '@/app/quotation-fields-snapshot';
import { DetailWorkspaceError, DETAIL_WORKSPACE_BODY_LIMIT, detailWorkspaceDigest, detailWorkspaceExpectedView, detailWorkspaceFileKeys, detailWorkspaceRequestId, detailWorkspaceScope, generateDetailWorkspaceHtml,
  validateDetailWorkspaceDocument, validateDetailWorkspaceRecord, validateDetailWorkspaceRoles,
  type DetailWorkspaceDocument, type DetailWorkspaceFile, type DetailWorkspaceInput, type DetailWorkspaceRecord, type DetailWorkspaceView } from '@/app/detail-workspace';
import { isOwnedImageKey, imageFileType, MAX_IMAGE_BYTES, PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-files';
import { imageDisplayDimensions } from '@/app/image-dimensions';
import { labelUploadDigest } from '@/app/label-upload-key';
import { readBoundedStream } from '@/app/request-body';
import type { SupplierHubCompany } from '@/app/supplier-hub-company';
import { readFreeImageEditRecord, FreeImageEditRecordError } from '@/app/free-image-edit-record';
import type { FreeImageSource } from '@/app/free-image-translation';
import { inspectImage } from '@/app/automation/image-edit';
import { buildDetailWorkspaceBannerDocument, createDetailWorkspaceBannerPreview, detailWorkspaceBannerRebaseRequestId, type DetailWorkspaceBannerRebaseInput } from '@/app/detail-workspace-banner-rebase';
import { detailSaveOptionIds, detailSavePeerDigest, detailSavePublishedBodyImages, DETAIL_SAVE_PEER_SNAPSHOT_LIMIT, DETAIL_PUBLICATION_CURRENT_POLICY, type DetailSavePeers, type DetailSavePublishedBodyImage } from '@/app/detail-save-plan';
import {initialDetailWorkspaceDocument} from '@/app/detail-workspace-seed';
import { savedRegistrationSettings } from '@/app/workspace-settings';

export const detailWorkspacesSchema = `CREATE TABLE IF NOT EXISTS product_detail_workspaces (
 owner_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id), category_scope TEXT NOT NULL, option_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision > 0), request_id TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,product_id,category_scope,option_id), CHECK(length(CAST(payload AS BLOB))<=524288)
)`;
type Identity = { email: string; role: string };
function verifyMember(members: readonly Record<string, unknown>[], company: SupplierHubCompany, identity: Identity) {
  const member = members[0];
  if (members.length !== 1 || member.status !== 'approved' || typeof member.email !== 'string' || member.email.trim().toLowerCase() !== identity.email.trim().toLowerCase()
    || member.role !== identity.role || member.company_code !== company.code || member.company_name !== company.name) throw new DetailWorkspaceError('승인된 회사 회원 정보를 다시 확인해주세요.', 403);
}
type Row = { revision: number; request_id: string; payload: string; updated_at: string };
export type DetailWorkspaceImageProofs = { files: Map<string, { metadata: string; file: DetailWorkspaceFile }> };
/** One operation only: actual bytes establish trust; later checks still inspect every upload version. */
export function createDetailWorkspaceImageProofs(): DetailWorkspaceImageProofs { return { files: new Map() }; }
function imageObjectProof(object: R2Object) {
  if (typeof object.version !== 'string' || !object.version.length || object.version.length > 512 || /[\u0000-\u0020\u007f]/u.test(object.version)) return null;
  return JSON.stringify({ key: object.key, version: object.version, size: object.size, etag: object.etag, uploaded: object.uploaded,
    httpMetadata: object.httpMetadata, customMetadata: object.customMetadata, checksums: object.checksums, storageClass: object.storageClass, ssecKeyMd5: object.ssecKeyMd5 });
}
const conflict = (message = '상세 작업공간이나 상품·옵션·카테고리·회원 기준이 변경되었습니다. 현재 입력을 보존하고 다시 확인해주세요.') => new DetailWorkspaceError(message);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
async function database(owner: string, id: string, profileId: string | null) {
  if (!env.DB) throw new DetailWorkspaceError('작업공간 저장소를 확인해주세요.', 503);
  const saved = await readOwnedSplitSnapshot(owner, id, profileId);
  await saved.db.prepare(detailWorkspacesSchema).run(); return saved.db;
}
async function row(db: D1Database, owner: string, id: string, scope: string, optionId: string): Promise<Row | null> {
  return db.prepare('SELECT revision,request_id,payload,updated_at FROM product_detail_workspaces WHERE owner_id=? AND product_id=? AND category_scope=? AND option_id=?')
    .bind(owner, id, scope, optionId).first<Row>();
}
async function snapshot(db: D1Database, owner: string, company: SupplierHubCompany, identity: Identity, id: string, profileId: string | null, optionId: string) {
  const { view } = await stableQuotationFieldsView(owner, id, profileId), saved = await readOwnedSplitSnapshot(owner, id, view.categoryContext.profileId, db), raw = saved.raw,
    state = raw.quotation[0] ? JSON.parse(raw.quotation[0].payload as string) : { revision: 0, updatedAt: null, overrides: { common: {}, options: {} } };
  verifyMember(raw.member, company, identity);
  if (raw.products.length !== 1 || raw.removed || raw.products[0].updated_at !== view.productVersion || !view.categoryContext.categoryId
    || raw.content.length !== 1 || raw.content[0].revision !== view.contentRevision || raw.options.length !== 1 || raw.options[0].revision !== view.optionRevision
    || state.revision !== view.revision || view.resolved.rows.filter(value => value.optionId === optionId).length !== 1) throw conflict();
  const content = JSON.parse(raw.content[0].payload as string), readRole = (role: 'detailTop' | 'detailBottom') => {
    const keys = content.assets?.[role]?.value; if (!Array.isArray(keys)) throw conflict('상세 상단·하단 이미지 역할을 새로 확인해주세요.');
    return [...new Set(keys.filter((key: unknown): key is string => isOwnedImageKey(owner, key) && view.imageKeys.includes(key)))];
  };
  const roles = validateDetailWorkspaceRoles({ top: readRole('detailTop'), bottom: readRole('detailBottom') }, owner, view.imageKeys), scope = await detailWorkspaceScope(view.categoryContext), previous = await row(db, owner, id, scope, optionId);
  const confirmed = await stableQuotationFieldsView(owner, id, profileId);
  if (!same(confirmed.view, view) || (await readOwnedSplitSnapshot(owner, id, view.categoryContext.profileId, db)).payload !== saved.payload) throw conflict();
  return { saved, view, roles, scope, previous };
}
function stored(value: Row | null, owner: string, id: string, optionId: string, current: Awaited<ReturnType<typeof snapshot>>, company: SupplierHubCompany, historicalBanners = false): DetailWorkspaceRecord | null {
  if (!value) return null;
  let body: unknown; try { body = JSON.parse(value.payload); } catch { throw conflict('저장한 작업공간 자료를 읽지 못했습니다.'); }
  const result = validateDetailWorkspaceRecord(body, owner, id, optionId, current.view.categoryContext, company);
  if (historicalBanners) {
    if (result.document.photos.some(photo => photo.role !== 'body' && photo.originKey !== photo.key)) throw conflict();
    const photos = result.document.photos.filter(photo => photo.role === 'body'), document = { ...result.document, photos, generatedHtml: generateDetailWorkspaceHtml(photos, result.document.imageMargin) };
    validateDetailWorkspaceDocument(document, owner, current.view.imageKeys, undefined, { top: [], bottom: [] }, photos);
  } else validateDetailWorkspaceDocument(result.document, owner, current.view.imageKeys, undefined, current.roles, result.document.photos);
  if (result.revision !== value.revision || result.requestId !== value.request_id || result.updatedAt !== value.updated_at) throw conflict();
  return result;
}
async function fileProofs(owner: string, document: DetailWorkspaceRecord['document'], signal: AbortSignal, proofs?: DetailWorkspaceImageProofs): Promise<DetailWorkspaceFile[]> {
  if (!env.FILES) throw new DetailWorkspaceError('이미지 저장소를 확인해주세요.', 503);
  const result: DetailWorkspaceFile[] = [], keys = detailWorkspaceFileKeys(document); let total = 0;
  // Only fully proven scans can widen: HEADs allocate no image buffers.
  const concurrency = proofs && keys.every(key => proofs.files.has(key)) ? 6 : 2;
  for (let offset = 0; offset < keys.length; offset += concurrency) {
    const batch = keys.slice(offset, offset + concurrency);
    const fetched = await Promise.allSettled(batch.map(async (key): Promise<{ file: DetailWorkspaceFile } | { object: R2ObjectBody | null }> => {
      signal.throwIfAborted(); if (!isOwnedImageKey(owner, key)) throw conflict();
      const verified = proofs?.files.get(key);
      if (verified) {
        const current = await env.FILES.head(key);
        if (!current || imageObjectProof(current) !== verified.metadata) throw conflict('작업공간 원본·현재 사진이나 저장 증거가 변경되었습니다.');
        return { file: verified.file };
      }
      return { object: await env.FILES.get(key) };
    }));
    let bodiesRead = false;
    try {
      signal.throwIfAborted();
      const objects = fetched.map(value => {
        if (value.status === 'rejected') throw value.reason;
        if ('file' in value.value) return value.value;
        if (!value.value.object || value.value.object.size < 1 || value.value.object.size > MAX_IMAGE_BYTES) throw conflict('작업공간 사진과 원본의 저장 파일을 확인해주세요.');
        return value.value;
      });
      // Reserve the whole batch before any body can allocate bytes.
      for (const value of objects) {
        total += 'file' in value ? value.file.bytes : value.object!.size; if (total > 30 * 1024 * 1024) throw new DetailWorkspaceError('작업공간 원본과 현재 사진의 전체 크기는30MiB 이내여야 합니다.', 413);
      }
      const loaded = await Promise.allSettled(objects.map(async (value, index) => {
        if ('file' in value) return value.file;
        const object = value.object!;
        const bytes = await readBoundedStream(object.body, MAX_IMAGE_BYTES);
        if (bytes.length !== object.size) throw new DetailWorkspaceError('작업공간 사진을 끝까지 읽지 못했습니다.', 503);
        let dimensions; try { imageFileType(bytes); dimensions = imageDisplayDimensions(bytes); } catch { throw conflict('작업공간 사진의 실제 파일과 크기를 확인해주세요.'); }
        if (!dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 16000 || dimensions.height > 16000 || dimensions.width * dimensions.height > 40000000) throw new DetailWorkspaceError('작업공간 사진 크기를 확인해주세요.', 415);
        const file = { key: batch[index], sha256: await labelUploadDigest(bytes), bytes: bytes.length, width: dimensions.width, height: dimensions.height }, metadata = imageObjectProof(object);
        if (metadata && proofs) proofs.files.set(file.key, { metadata, file });
        return file;
      }));
      bodiesRead = true;
      for (const value of loaded) {
        if (value.status === 'rejected') throw value.reason;
        result.push(value.value);
      }
    } finally {
      if (!bodiesRead) await Promise.allSettled(fetched.map(async value => {
        if (value.status === 'fulfilled' && 'object' in value.value) await value.value.object?.body.cancel();
      }));
    }
  }
  return result;
}
async function verifyRecord(record: DetailWorkspaceRecord, owner: string, imageKeys: readonly string[], signal: AbortSignal, historicalBanners = false, proofs?: DetailWorkspaceImageProofs) {
  const { digest, ...value } = record;
  if (await detailWorkspaceDigest(value) !== digest || !same(await fileProofs(owner, record.document, signal, proofs), record.files)) throw conflict('작업공간 원본·현재 사진이나 저장 증거가 변경되었습니다.');
  const checked = new Set<string>(); let total = record.files.reduce((sum, file) => sum + file.bytes, 0);
  for (const photo of record.document.photos.filter(photo => !imageKeys.includes(photo.key) || photo.key.startsWith(`${owner}/free-image-workspace-`))) {
    // An explicit rebase may inspect a removed old banner, never grant that
    // historical pool exception to a body source or a workspace-only result.
    if (historicalBanners && photo.role !== 'body' && photo.originKey === photo.key && !photo.key.startsWith(`${owner}/free-image-workspace-`)) continue;
    if (!env.FILES || photo.role !== 'body' || !photo.key.startsWith(`${owner}/free-image-workspace-${record.productId}-`)) throw conflict();
    let saved; try { saved = await readFreeImageEditRecord(env.FILES, owner, record.productId, photo.key); }
    catch (error) { if (error instanceof FreeImageEditRecordError && error.status === 503) throw new DetailWorkspaceError(error.message, 503); throw conflict('작업공간 사진의 편집 문서와 결과를 확인해주세요.'); }
    const target = saved.record.source.workspaceTarget;
    if (!target || target.revision >= record.revision || target.photoId !== photo.id || target.optionId !== record.optionId || target.profileId !== (record.context.source === 'profile' ? record.context.profileId : null)
      || !same(saved.record.context, record.context) || !same(saved.record.company, record.company) || !imageKeys.includes(saved.record.source.sourceKey)) throw conflict();
    const base = saved.record.source;
    if (!checked.has(base.sourceKey)) {
      checked.add(base.sourceKey); const object = await env.FILES.get(base.sourceKey);
      if (!object || object.size < 1 || object.size > MAX_IMAGE_BYTES) throw conflict();
      if (!record.files.some(file => file.key === base.sourceKey)) total += object.size;
      if (total > 30 * 1024 * 1024) throw conflict();
      const bytes = await readBoundedStream(object.body, MAX_IMAGE_BYTES); let dimensions;
      try { dimensions = inspectImage(bytes); } catch { throw conflict('편집한 사진의 실제 원본을 확인해주세요.'); }
      if (bytes.length !== object.size || await labelUploadDigest(bytes) !== base.sourceSha256 || dimensions.width !== base.width || dimensions.height !== base.height) throw conflict('편집한 사진의 실제 원본이 변경되었습니다.');
    }
  }
}
async function confirm(db: D1Database, owner: string, company: SupplierHubCompany, identity: Identity, id: string, profileId: string | null, optionId: string, before: Awaited<ReturnType<typeof snapshot>>) {
  const previous = await row(db, owner, id, before.scope, optionId);
  const { view } = await stableQuotationFieldsView(owner, id, profileId);
  const saved = await readOwnedSplitSnapshot(owner, id, before.view.categoryContext.profileId, db);
  verifyMember(saved.raw.member, company, identity);
  // Exact raw content equality also retains the already-validated banner roles.
  if (saved.payload !== before.saved.payload || !same(previous, before.previous) || !same(view, before.view)) throw conflict();
}
export async function readDetailWorkspace(owner: string, company: SupplierHubCompany, identity: Identity, id: string, profileId: string | null, optionId: string, signal: AbortSignal): Promise<DetailWorkspaceView> {
  const db = await database(owner, id, profileId), before = await snapshot(db, owner, company, identity, id, profileId, optionId), workspace = stored(before.previous, owner, id, optionId, before, company);
  if (workspace) await verifyRecord(workspace, owner, before.view.imageKeys, signal);
  await confirm(db, owner, company, identity, id, profileId, optionId, before);
  return { view: before.view, workspace, roles: before.roles };
}
export async function saveDetailWorkspace(owner: string, company: SupplierHubCompany, identity: Identity, id: string, profileId: string | null, input: DetailWorkspaceInput, signal: AbortSignal): Promise<DetailWorkspaceView> {
  const db = await database(owner, id, profileId), before = await snapshot(db, owner, company, identity, id, profileId, input.optionId), old = stored(before.previous, owner, id, input.optionId, before, company);
  if (input.requestId !== await detailWorkspaceRequestId(id, input.optionId, input.expectedRevision, input.expectedView, input.document)) throw new DetailWorkspaceError('작업공간 요청 번호와 검토한 문서가 다릅니다.', 400);
  if (old) await verifyRecord(old, owner, before.view.imageKeys, signal);
  if (old?.requestId === input.requestId) {
    if (old.revision !== input.expectedRevision + 1 || !same(old.document, validateDetailWorkspaceDocument(input.document, owner, before.view.imageKeys, undefined, before.roles, old.document.photos))) throw conflict('같은 요청 번호의 저장 문서가 다릅니다.');
    await confirm(db, owner, company, identity, id, profileId, input.optionId, before);
    return { view: before.view, workspace: old, roles: before.roles };
  }
  if (input.expectedRevision !== (old?.revision ?? 0) || !same(detailWorkspaceExpectedView(before.view), input.expectedView)) throw conflict();
  const document = validateDetailWorkspaceDocument(input.document, owner, before.view.imageKeys, old?.document ?? null, before.roles, old?.document.photos), files = await fileProofs(owner, document, signal),
    value: Omit<DetailWorkspaceRecord, 'digest'> = { format: 'detail-workspace-record-v1', productId: id, optionId: input.optionId, context: before.view.categoryContext,
      company, revision: input.expectedRevision + 1, updatedAt: new Date(Math.max(Date.now(), old ? Date.parse(old.updatedAt) + 1 : 0)).toISOString(), requestId: input.requestId, document, files },
    workspace: DetailWorkspaceRecord = { ...value, digest: await detailWorkspaceDigest(value) };
  return commitWorkspace(db, owner, company, identity, id, profileId, input.optionId, before, workspace, signal);
}
async function commitWorkspace(db: D1Database, owner: string, company: SupplierHubCompany, identity: Identity, id: string, profileId: string | null, optionId: string,
  before: Awaited<ReturnType<typeof snapshot>>, workspace: DetailWorkspaceRecord, signal: AbortSignal): Promise<DetailWorkspaceView> {
  const payload = JSON.stringify(workspace);
  if (new TextEncoder().encode(payload).length > DETAIL_WORKSPACE_BODY_LIMIT) throw new DetailWorkspaceError('저장한 작업공간은512KiB 이내여야 합니다.', 413);
  await verifyRecord(workspace, owner, before.view.imageKeys, signal);
  await confirm(db, owner, company, identity, id, profileId, optionId, before); signal.throwIfAborted();
  const guard = splitSnapshotPredicate(owner, id, before.view.categoryContext.profileId, before.saved.payload), previous = before.previous;
  let result: Row | null;
  try { result = await db.prepare(`INSERT INTO product_detail_workspaces(owner_id,product_id,category_scope,option_id,revision,request_id,payload,updated_at)
    SELECT ?,?,?,?,?,?,?,? WHERE ${guard.sql}
    AND ((?=0 AND NOT EXISTS(SELECT 1 FROM product_detail_workspaces WHERE owner_id=? AND product_id=? AND category_scope=? AND option_id=?))
      OR EXISTS(SELECT 1 FROM product_detail_workspaces WHERE owner_id=? AND product_id=? AND category_scope=? AND option_id=? AND revision=? AND payload=? AND request_id=? AND updated_at=?))
    ON CONFLICT(owner_id,product_id,category_scope,option_id) DO UPDATE SET revision=excluded.revision,request_id=excluded.request_id,payload=excluded.payload,updated_at=excluded.updated_at
      WHERE product_detail_workspaces.revision=? AND product_detail_workspaces.payload=? AND product_detail_workspaces.request_id=? AND product_detail_workspaces.updated_at=?
    RETURNING revision,request_id,payload,updated_at`).bind(owner, id, before.scope, optionId, workspace.revision, workspace.requestId, payload, workspace.updatedAt,
    ...guard.args, workspace.revision - 1, owner, id, before.scope, optionId, owner, id, before.scope, optionId,
    workspace.revision - 1, previous?.payload ?? '', previous?.request_id ?? '', previous?.updated_at ?? '',
    workspace.revision - 1, previous?.payload ?? '', previous?.request_id ?? '', previous?.updated_at ?? '').first<Row>(); }
  catch { throw new DetailWorkspaceError('작업공간 저장 완료 여부를 확인하지 못했습니다. 요청을 반복하지 말고 조회로 먼저 확인해주세요.', 503); }
  if (!result) throw conflict();
  if (result.payload !== payload || result.revision !== workspace.revision || result.request_id !== workspace.requestId) throw new DetailWorkspaceError('작업공간 저장 응답을 확인하지 못했습니다. 다시 저장하지 말고 조회로 확인해주세요.', 503);
  let after: DetailWorkspaceView;
  try { after = await readDetailWorkspace(owner, company, identity, id, profileId, optionId, signal); }
  catch { throw new DetailWorkspaceError('작업공간 저장 후 기준이 변경되어 완료 응답을 확인하지 못했습니다. 조회로 먼저 확인해주세요.', 503); }
  if (!same(after.workspace, workspace)) throw new DetailWorkspaceError('작업공간 저장 결과를 확인하지 못했습니다. 조회로 먼저 확인해주세요.', 503);
  return after;
}

async function bannerRebaseState(owner: string, company: SupplierHubCompany, identity: Identity, id: string, profileId: string | null, optionId: string, signal: AbortSignal) {
  const db = await database(owner, id, profileId), before = await snapshot(db, owner, company, identity, id, profileId, optionId), workspace = stored(before.previous, owner, id, optionId, before, company, true);
  if (!workspace) throw conflict('배너를 갱신할 상세 작업공간을 먼저 보관해주세요.');
  await verifyRecord(workspace, owner, before.view.imageKeys, signal, true);
  return { db, before, workspace };
}
async function bannerPreview(owner: string, state: Awaited<ReturnType<typeof bannerRebaseState>>, signal: AbortSignal) {
  const document = buildDetailWorkspaceBannerDocument(state.workspace, state.before.roles), files = await fileProofs(owner, document, signal),
    preview = await createDetailWorkspaceBannerPreview(state.before.view, state.workspace, state.before.roles, files), { digest: ignored, ...old } = state.workspace;
  void ignored;
  const candidate = { ...old, document: preview.document, files: preview.files }, record = { ...candidate, digest: await detailWorkspaceDigest(candidate) };
  await verifyRecord(record, owner, state.before.view.imageKeys, signal);
  return preview;
}
/** The ordinary reader stays strict. Only this explicit review can inspect
 * historically protected rows against a different current content role list. */
export async function readDetailWorkspaceBannerRebase(owner: string, company: SupplierHubCompany, identity: Identity, id: string, profileId: string | null, optionId: string, signal: AbortSignal) {
  const state = await bannerRebaseState(owner, company, identity, id, profileId, optionId, signal), preview = await bannerPreview(owner, state, signal);
  await confirm(state.db, owner, company, identity, id, profileId, optionId, state.before);
  return preview;
}
export async function saveDetailWorkspaceBannerRebase(owner: string, company: SupplierHubCompany, identity: Identity, id: string, profileId: string | null, input: DetailWorkspaceBannerRebaseInput, signal: AbortSignal): Promise<DetailWorkspaceView> {
  const state = await bannerRebaseState(owner, company, identity, id, profileId, input.optionId, signal), old = state.workspace;
  if (old.requestId === input.requestId) {
    const roles = { top: old.document.photos.filter(photo => photo.role === 'top').map(photo => photo.key), bottom: old.document.photos.filter(photo => photo.role === 'bottom').map(photo => photo.key) };
    if (old.revision !== input.expectedRevision + 1 || !same(old.context, input.expectedView.categoryContext)
      || await detailWorkspaceBannerRebaseRequestId(id, input.optionId, input.expectedRevision, input.expectedDigest, input.expectedView, roles, old.document, old.files) !== input.requestId) throw conflict();
    await confirm(state.db, owner, company, identity, id, profileId, input.optionId, state.before);
    return readDetailWorkspace(owner, company, identity, id, profileId, input.optionId, signal);
  }
  if (old.revision !== input.expectedRevision || old.digest !== input.expectedDigest || !same(detailWorkspaceExpectedView(state.before.view), input.expectedView)) throw conflict();
  const preview = await bannerPreview(owner, state, signal);
  if (preview.requestId !== input.requestId) throw conflict('배너 사진이나 검토 기준이 변경되었습니다. 새 미리보기를 확인해주세요.');
  if (same(preview.document, old.document)) throw conflict('보관한 배너가 이미 현재 설정과 같습니다. 작업공간을 변경하지 않았습니다.');
  const { digest: ignored, ...record } = old; void ignored;
  const value = { ...record, revision: old.revision + 1, updatedAt: new Date(Math.max(Date.now(), Date.parse(old.updatedAt) + 1)).toISOString(),
    requestId: input.requestId, document: preview.document, files: preview.files }, workspace = { ...value, digest: await detailWorkspaceDigest(value) };
  return commitWorkspace(state.db, owner, company, identity, id, profileId, input.optionId, state.before, workspace, signal);
}
/** Server-only captured source/raw-row seal. Never an HTTP response. */
export async function readDetailWorkspaceImageSeal(owner: string, company: SupplierHubCompany, identity: Identity, id: string, profileId: string | null, optionId: string, signal: AbortSignal, proofs?: DetailWorkspaceImageProofs) {
  const db = await database(owner, id, profileId), before = await snapshot(db, owner, company, identity, id, profileId, optionId), workspace = stored(before.previous, owner, id, optionId, before, company);
  if (!workspace) throw new DetailWorkspaceError('편집할 상세 구성을 먼저 보관해주세요.', 409);
  await verifyRecord(workspace, owner, before.view.imageKeys, signal, false, proofs); await confirm(db, owner, company, identity, id, profileId, optionId, before);
  return { db, before, workspace, owner, company, identity, id, profileId, optionId, proofs };
}
export type DetailWorkspaceImageSeal = Awaited<ReturnType<typeof readDetailWorkspaceImageSeal>>;
/** Stage six/quote clocks and label assets are outputs, not a new Stage five source. */
export async function detailWorkspacePublicationBasis(seal: DetailWorkspaceImageSeal): Promise<string> {
  const raw = seal.before.saved.raw, product = raw.products[0], content = JSON.parse(raw.content[0].payload as string),
    settings = savedRegistrationSettings(raw.settings[0] ? JSON.parse(raw.settings[0].payload as string) : null),
    imageSettings = Object.fromEntries((['translateImages', 'topImageEnabled', 'bottomImageEnabled', 'topImageKey', 'bottomImageKey', 'translationPrompt'] as const).map(key => [key, settings[key]]));
  return labelUploadDigest(new TextEncoder().encode(JSON.stringify({ policy: DETAIL_PUBLICATION_CURRENT_POLICY, ownerId: seal.owner, productId: seal.id,
    company: seal.company, member: seal.identity, context: seal.before.view.categoryContext,
    sourceUrl: product.source_url, productTitle: product.title,
    assets: ['detailTop', 'detail', 'detailBottom'].map(role => [role, content.assets[role]]),
    seo: content.seo, detail: content.detail, detailDescriptionLinked: content.detailDescriptionLinked,
    options: raw.options.map(row => row.payload), profile: raw.profile.map(row => row.payload), settings: imageSettings,
    collection: { links: raw.links, context: raw.context, result: raw.result, supplements: raw.supplements, images: raw.images, family: raw.family } })));
}
/** Reconstruct every affected option proof, then fence these exact rows and absences in the final quotation transaction. */
export async function detailWorkspacePeersGuard(seal: DetailWorkspaceImageSeal, expectedDigest: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const optionIds = detailSaveOptionIds(seal.before.view), args = [seal.owner, seal.id, seal.before.scope, JSON.stringify(optionIds)];
  const rows = `SELECT option_id,revision,request_id,payload,updated_at FROM product_detail_workspaces WHERE owner_id=? AND product_id=? AND category_scope=?
      AND option_id IN (SELECT value FROM json_each(?)) ORDER BY option_id`, encoded = `SELECT json_object('option_id',option_id,'revision',revision,'request_id',request_id,'payload',payload,'updated_at',updated_at) AS value FROM (${rows})`,
    size = 'SELECT coalesce(sum(length(CAST(value AS BLOB))+1),1)+1 AS bytes FROM reviewed';
  const bound = await seal.db.prepare(`WITH reviewed AS (${encoded}) ${size}`).bind(...args).first<{ bytes: number }>();
  if (!bound || bound.bytes > DETAIL_SAVE_PEER_SNAPSHOT_LIMIT) throw new DetailWorkspaceError('모든 옵션의 상세 구성 확인 자료는2MiB 이내여야 합니다. 기존 자료는 보존했습니다.', 413);
  // The same statement bounds a concurrent larger rowset before concatenating it.
  const sql = `WITH reviewed AS (${encoded}) SELECT CASE WHEN (${size})<=${DETAIL_SAVE_PEER_SNAPSHOT_LIMIT}
    THEN (SELECT json_group_array(json(value)) FROM reviewed) END`;
  const snapshot = await seal.db.prepare(`SELECT (${sql}) AS payload`).bind(...args).first<{ payload: string }>();
  if (!snapshot?.payload) throw conflict();
  const captured = JSON.parse(snapshot.payload) as (Row & { option_id: string })[], peers = [];
  for (const optionId of optionIds) {
    const row = captured.find(row => row.option_id === optionId), record = stored(row ?? null, seal.owner, seal.id, optionId, seal.before, seal.company);
    if (record) { const { digest, ...value } = record; if (await detailWorkspaceDigest(value) !== digest) throw conflict(); }
    peers.push({ optionId, workspace: record ? { revision: record.revision, digest: record.digest } : null });
  }
  if (await detailSavePeerDigest(peers) !== expectedDigest) throw conflict();
  signal.throwIfAborted();
  return { sql: `(${sql})=?`, args: [...args, snapshot.payload],proof:peers as DetailSavePeers,captured };
}
export type DetailWorkspacePeerPublication={images:DetailSavePublishedBodyImage[];before:DetailSavePeers;after:DetailSavePeers;
  rows:{optionId:string;previous:(Row&{option_id:string})|null;workspace:DetailWorkspaceRecord}[];afterGuard:{sql:string;args:(string|number|null)[]}};
/** Publish pixels as ordinary owned photos. The source keeps its option-bound edit layers. */
export async function prepareDetailWorkspacePeerPublication(seal:DetailWorkspaceImageSeal,expectedDigest:string,signal:AbortSignal):Promise<DetailWorkspacePeerPublication>{
  const guard=await detailWorkspacePeersGuard(seal,expectedDigest,signal),images=detailSavePublishedBodyImages(seal.workspace,seal.owner),baseline=structuredClone(seal.workspace.document);
  if(!images.length)throw conflict();
  for(const photo of baseline.photos.filter(photo=>photo.role==='body'&&photo.key.startsWith(`${seal.owner}/free-image-`))){
    if(!env.FILES)throw conflict();const saved=await readFreeImageEditRecord(env.FILES,seal.owner,seal.id,photo.key),source=saved.record.source,target=source.workspaceTarget??source.quotationTarget;
    const proof=seal.workspace.files.find(file=>file.key===photo.key);
    if(!target||source.productId!==seal.id||target.optionId!==seal.optionId||target.profileId!==seal.profileId||!same(saved.record.context,seal.before.view.categoryContext)||!same(saved.record.company,seal.company)
      ||saved.record.result.sha256!==proof?.sha256||!seal.before.view.imageKeys.includes(source.sourceKey))throw conflict();
    photo.key=source.sourceKey;
  }
  const semantic=(document:DetailWorkspaceDocument)=>({imageMargin:document.imageMargin,photos:document.photos.map(({role,originKey,key})=>({role,originKey,key}))});
  const aliases=new Map(images.map(image=>[image.sourceKey,image.key])),pool=[...new Set([...seal.before.view.imageKeys,...seal.workspace.document.photos.map(photo=>photo.key),...images.map(image=>image.key)])],rows:DetailWorkspacePeerPublication['rows']=[];
  if(pool.length+1>PRODUCT_IMAGE_POOL_LIMIT)throw new DetailWorkspaceError('발행한 본문과 최종 이미지를 보존할 상품 이미지 공간이 부족합니다.',413);
  const records=new Map<string,DetailWorkspaceRecord>();
  for(const optionId of detailSaveOptionIds(seal.before.view)){
    signal.throwIfAborted();const previous=guard.captured.find(row=>row.option_id===optionId)??null,old=stored(previous,seal.owner,seal.id,optionId,seal.before,seal.company);
    if(old)records.set(optionId,old);
    if(optionId===seal.optionId||!seal.before.view.resolved.rows.find(row=>row.optionId===optionId)?.included)continue;
    if(old)await verifyRecord(old,seal.owner,seal.before.view.imageKeys,signal);
    let serial=0;const original=old?.document??initialDetailWorkspaceDocument({view:seal.before.view,workspace:null,roles:seal.before.roles},optionId,()=>`published-photo-${++serial}`);
    if(!same(semantic(original),semantic(baseline)))throw conflict('다른 옵션의 직접 편집한 상세 구성을 유지했습니다. 공통 발행 범위를 다시 확인해주세요.');
    const photos=original.photos.map((photo,index)=>({...photo,key:photo.role==='body'?aliases.get(seal.workspace.document.photos[index].key)!:photo.key})),document={...original,photos,generatedHtml:generateDetailWorkspaceHtml(photos,original.imageMargin)};
    if(old&&same(document,old.document))continue;
    validateDetailWorkspaceDocument(document,seal.owner,pool,original,seal.before.roles,photos);
    const metadata=new Map([...(old?.files??[]),...seal.workspace.files,...images.map(image=>({...seal.workspace.files.find(file=>file.key===image.sourceKey)!,key:image.key}))].map(file=>[file.key,file]));
    const files=detailWorkspaceFileKeys(document).map(key=>{const file=metadata.get(key);if(!file)throw conflict();return file;}),value={format:'detail-workspace-record-v1' as const,productId:seal.id,optionId,context:seal.before.view.categoryContext,company:seal.company,
      revision:(old?.revision??0)+1,updatedAt:new Date(Math.max(Date.now(),old?Date.parse(old.updatedAt)+1:0)).toISOString(),requestId:await detailWorkspaceRequestId(seal.id,optionId,old?.revision??0,detailWorkspaceExpectedView(seal.before.view),document),document,files};
    const workspace={...value,digest:await detailWorkspaceDigest(value)};validateDetailWorkspaceRecord(workspace,seal.owner,seal.id,optionId,seal.before.view.categoryContext,seal.company);
    records.set(optionId,workspace);rows.push({optionId,previous,workspace});
  }
  const captured=guard.captured.map(row=>({...row}));for(const row of rows){const next={option_id:row.optionId,revision:row.workspace.revision,request_id:row.workspace.requestId,payload:JSON.stringify(row.workspace),updated_at:row.workspace.updatedAt},index=captured.findIndex(value=>value.option_id===row.optionId);if(index<0)captured.push(next);else captured[index]=next;}
  captured.sort((a,b)=>a.option_id<b.option_id?-1:a.option_id>b.option_id?1:0);const payload=JSON.stringify(captured);
  if(new TextEncoder().encode(payload).length>DETAIL_SAVE_PEER_SNAPSHOT_LIMIT)throw new DetailWorkspaceError('모든 옵션의 상세 구성 확인 자료는2MiB 이내여야 합니다.',413);
  const after=detailSaveOptionIds(seal.before.view).map(optionId=>{const record=records.get(optionId);return{optionId,workspace:record?{revision:record.revision,digest:record.digest}:null};});
  return{images,before:guard.proof,after,rows,afterGuard:{sql:guard.sql,args:[...guard.args.slice(0,-1),payload]}};
}
export async function verifyDetailWorkspacePublishedImages(owner:string,images:DetailSavePublishedBodyImage[],signal:AbortSignal){
  let total=0;const seen=new Set<string>();for(const image of images){if(seen.has(image.key))continue;seen.add(image.key);signal.throwIfAborted();if(!isOwnedImageKey(owner,image.key)||!env.FILES)throw conflict();
    const object=await env.FILES.get(image.key);if(!object||object.size<1||object.size>MAX_IMAGE_BYTES||(total+=object.size)>30*1024*1024)throw conflict();
    const bytes=await readBoundedStream(object.body,MAX_IMAGE_BYTES),size=imageDisplayDimensions(bytes);if(bytes.length!==object.size||await labelUploadDigest(bytes)!==image.sha256||size?.width!==image.width||size?.height!==image.height)throw conflict();
  }
}
export async function storeDetailWorkspacePublishedImages(seal:DetailWorkspaceImageSeal,images:DetailSavePublishedBodyImage[],signal:AbortSignal){
  const seen=new Set<string>();for(const image of images){if(image.key===image.sourceKey||seen.has(image.key))continue;seen.add(image.key);signal.throwIfAborted();if(!env.FILES||!isOwnedImageKey(seal.owner,image.sourceKey)||!isOwnedImageKey(seal.owner,image.key))throw conflict();
    const object=await env.FILES.get(image.sourceKey);if(!object||object.size<1||object.size>MAX_IMAGE_BYTES)throw conflict();const bytes=await readBoundedStream(object.body,MAX_IMAGE_BYTES),size=inspectImage(bytes);
    if(bytes.length!==object.size||size.mime!=='image/png'||size.width!==image.width||size.height!==image.height||await labelUploadDigest(bytes)!==image.sha256)throw conflict();
    if(!await env.FILES.get(image.key))await env.FILES.put(image.key,bytes,{onlyIf:new Headers({'if-none-match':'*'}),httpMetadata:{contentType:'image/png'}});
  }
  await verifyDetailWorkspacePublishedImages(seal.owner,images,signal);await confirmDetailWorkspaceImageSeal(seal,signal);
}
export async function confirmDetailWorkspaceImageSeal(seal: DetailWorkspaceImageSeal, signal: AbortSignal) {
  signal.throwIfAborted(); await verifyRecord(seal.workspace, seal.owner, seal.before.view.imageKeys, signal, false, seal.proofs);
  await confirm(seal.db, seal.owner, seal.company, seal.identity, seal.id, seal.profileId, seal.optionId, seal.before);
}
/** Only a verified owned image result can replace one saved body position. */
export async function applyDetailWorkspaceImageSeal(seal: DetailWorkspaceImageSeal, source: FreeImageSource, outputKey: string, signal: AbortSignal): Promise<DetailWorkspaceView> {
  const target = source.workspaceTarget, old = seal.workspace;
  if (!target || source.productId !== seal.id || target.optionId !== seal.optionId || target.profileId !== seal.profileId || target.revision !== old.revision || target.digest !== old.digest) throw conflict();
  const photo = old.document.photos.find(photo => photo.id === target.photoId);
  if (!photo || photo.role !== 'body' || photo.key !== (source.editorSource?.resultKey ?? source.sourceKey)) throw conflict();
  const photos = old.document.photos.map(photo => photo.id === target.photoId ? { ...photo, key: outputKey } : { ...photo }),
    document = { ...old.document, photos, generatedHtml: generateDetailWorkspaceHtml(photos, old.document.imageMargin) };
  validateDetailWorkspaceDocument(document, seal.owner, seal.before.view.imageKeys, old.document, seal.before.roles, photos);
  const files = await fileProofs(seal.owner, document, signal), value: Omit<DetailWorkspaceRecord, 'digest'> = {
    ...old, revision: old.revision + 1, updatedAt: new Date(Math.max(Date.now(), Date.parse(old.updatedAt) + 1)).toISOString(), document, files,
    requestId: await detailWorkspaceRequestId(seal.id, seal.optionId, old.revision, detailWorkspaceExpectedView(seal.before.view), document),
  };
  delete (value as Partial<DetailWorkspaceRecord>).digest;
  const workspace = { ...value, digest: await detailWorkspaceDigest(value) };
  return commitWorkspace(seal.db, seal.owner, seal.company, seal.identity, seal.id, seal.profileId, seal.optionId, seal.before, workspace, signal);
}
