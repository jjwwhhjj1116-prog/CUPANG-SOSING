import { env } from 'cloudflare:workers';
import { readOwnedSplitSnapshot, splitSnapshotPredicate } from '@/db/product-option-splits';
import { stableQuotationFieldsView } from '@/app/quotation-fields-snapshot';
import { DetailWorkspaceError, DETAIL_WORKSPACE_BODY_LIMIT, detailWorkspaceDigest, detailWorkspaceExpectedView, detailWorkspaceFileKeys, detailWorkspaceRequestId, detailWorkspaceScope,
  validateDetailWorkspaceDocument, validateDetailWorkspaceRecord, validateDetailWorkspaceRoles,
  type DetailWorkspaceFile, type DetailWorkspaceInput, type DetailWorkspaceRecord, type DetailWorkspaceView } from '@/app/detail-workspace';
import { isOwnedImageKey, imageFileType, MAX_IMAGE_BYTES } from '@/app/image-files';
import { imageDisplayDimensions } from '@/app/image-dimensions';
import { labelUploadDigest } from '@/app/label-upload-key';
import { readBoundedStream } from '@/app/request-body';
import type { SupplierHubCompany } from '@/app/supplier-hub-company';

export const detailWorkspacesSchema = `CREATE TABLE IF NOT EXISTS product_detail_workspaces (
 owner_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id), category_scope TEXT NOT NULL, option_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision > 0), request_id TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,product_id,category_scope,option_id), CHECK(length(CAST(payload AS BLOB))<=524288)
)`;
type Identity = { email: string; role: string };
type Row = { revision: number; request_id: string; payload: string; updated_at: string };
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
    member = raw.member[0], state = raw.quotation[0] ? JSON.parse(raw.quotation[0].payload as string) : { revision: 0, updatedAt: null, overrides: { common: {}, options: {} } };
  if (raw.member.length !== 1 || member.status !== 'approved' || typeof member.email !== 'string' || member.email.trim().toLowerCase() !== identity.email.trim().toLowerCase()
    || member.role !== identity.role || member.company_code !== company.code || member.company_name !== company.name) throw new DetailWorkspaceError('승인된 회사 회원 정보를 다시 확인해주세요.', 403);
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
function stored(value: Row | null, owner: string, id: string, optionId: string, current: Awaited<ReturnType<typeof snapshot>>, company: SupplierHubCompany): DetailWorkspaceRecord | null {
  if (!value) return null;
  let body: unknown; try { body = JSON.parse(value.payload); } catch { throw conflict('저장한 작업공간 자료를 읽지 못했습니다.'); }
  const result = validateDetailWorkspaceRecord(body, owner, id, optionId, current.view.categoryContext, company);
  validateDetailWorkspaceDocument(result.document, owner, current.view.imageKeys, undefined, current.roles);
  if (result.revision !== value.revision || result.requestId !== value.request_id || result.updatedAt !== value.updated_at) throw conflict();
  return result;
}
async function fileProofs(owner: string, document: DetailWorkspaceRecord['document'], signal: AbortSignal): Promise<DetailWorkspaceFile[]> {
  if (!env.FILES) throw new DetailWorkspaceError('이미지 저장소를 확인해주세요.', 503);
  const result: DetailWorkspaceFile[] = []; let total = 0;
  for (const key of detailWorkspaceFileKeys(document)) {
    signal.throwIfAborted(); if (!isOwnedImageKey(owner, key)) throw conflict();
    const object = await env.FILES.get(key);
    if (!object || object.size < 1 || object.size > MAX_IMAGE_BYTES) throw conflict('작업공간 사진과 원본의 저장 파일을 확인해주세요.');
    total += object.size; if (total > 30 * 1024 * 1024) throw new DetailWorkspaceError('작업공간 원본과 현재 사진의 전체 크기는30MiB 이내여야 합니다.', 413);
    const bytes = await readBoundedStream(object.body, MAX_IMAGE_BYTES);
    if (bytes.length !== object.size) throw new DetailWorkspaceError('작업공간 사진을 끝까지 읽지 못했습니다.', 503);
    let dimensions; try { imageFileType(bytes); dimensions = imageDisplayDimensions(bytes); } catch { throw conflict('작업공간 사진의 실제 파일과 크기를 확인해주세요.'); }
    if (!dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 16000 || dimensions.height > 16000 || dimensions.width * dimensions.height > 40000000) throw new DetailWorkspaceError('작업공간 사진 크기를 확인해주세요.', 415);
    result.push({ key, sha256: await labelUploadDigest(bytes), bytes: bytes.length, width: dimensions.width, height: dimensions.height });
  }
  return result;
}
async function verifyRecord(record: DetailWorkspaceRecord, owner: string, signal: AbortSignal) {
  const { digest, ...value } = record;
  if (await detailWorkspaceDigest(value) !== digest || !same(await fileProofs(owner, record.document, signal), record.files)) throw conflict('작업공간 원본·현재 사진이나 저장 증거가 변경되었습니다.');
}
async function confirm(db: D1Database, owner: string, company: SupplierHubCompany, identity: Identity, id: string, profileId: string | null, optionId: string, before: Awaited<ReturnType<typeof snapshot>>) {
  const after = await snapshot(db, owner, company, identity, id, profileId, optionId);
  if (after.saved.payload !== before.saved.payload || !same(after.previous, before.previous) || !same(after.view, before.view) || !same(after.roles, before.roles)) throw conflict();
}
export async function readDetailWorkspace(owner: string, company: SupplierHubCompany, identity: Identity, id: string, profileId: string | null, optionId: string, signal: AbortSignal): Promise<DetailWorkspaceView> {
  const db = await database(owner, id, profileId), before = await snapshot(db, owner, company, identity, id, profileId, optionId), workspace = stored(before.previous, owner, id, optionId, before, company);
  if (workspace) await verifyRecord(workspace, owner, signal);
  await confirm(db, owner, company, identity, id, profileId, optionId, before);
  return { view: before.view, workspace, roles: before.roles };
}
export async function saveDetailWorkspace(owner: string, company: SupplierHubCompany, identity: Identity, id: string, profileId: string | null, input: DetailWorkspaceInput, signal: AbortSignal): Promise<DetailWorkspaceView> {
  const db = await database(owner, id, profileId), before = await snapshot(db, owner, company, identity, id, profileId, input.optionId), old = stored(before.previous, owner, id, input.optionId, before, company);
  if (input.requestId !== await detailWorkspaceRequestId(id, input.optionId, input.expectedRevision, input.expectedView, input.document)) throw new DetailWorkspaceError('작업공간 요청 번호와 검토한 문서가 다릅니다.', 400);
  if (old) await verifyRecord(old, owner, signal);
  if (old?.requestId === input.requestId) {
    if (old.revision !== input.expectedRevision + 1 || !same(old.document, validateDetailWorkspaceDocument(input.document, owner, before.view.imageKeys))) throw conflict('같은 요청 번호의 저장 문서가 다릅니다.');
    await confirm(db, owner, company, identity, id, profileId, input.optionId, before);
    return { view: before.view, workspace: old, roles: before.roles };
  }
  if (input.expectedRevision !== (old?.revision ?? 0) || !same(detailWorkspaceExpectedView(before.view), input.expectedView)) throw conflict();
  const document = validateDetailWorkspaceDocument(input.document, owner, before.view.imageKeys, old?.document ?? null, before.roles), files = await fileProofs(owner, document, signal),
    value: Omit<DetailWorkspaceRecord, 'digest'> = { format: 'detail-workspace-record-v1', productId: id, optionId: input.optionId, context: before.view.categoryContext,
      company, revision: input.expectedRevision + 1, updatedAt: new Date(Math.max(Date.now(), old ? Date.parse(old.updatedAt) + 1 : 0)).toISOString(), requestId: input.requestId, document, files },
    workspace: DetailWorkspaceRecord = { ...value, digest: await detailWorkspaceDigest(value) };
  const payload = JSON.stringify(workspace);
  if (new TextEncoder().encode(payload).length > DETAIL_WORKSPACE_BODY_LIMIT) throw new DetailWorkspaceError('저장한 작업공간은512KiB 이내여야 합니다.', 413);
  await confirm(db, owner, company, identity, id, profileId, input.optionId, before); signal.throwIfAborted();
  const guard = splitSnapshotPredicate(owner, id, before.view.categoryContext.profileId, before.saved.payload), previous = before.previous;
  const result = await db.prepare(`INSERT INTO product_detail_workspaces(owner_id,product_id,category_scope,option_id,revision,request_id,payload,updated_at)
    SELECT ?,?,?,?,?,?,?,? WHERE ${guard.sql}
    AND ((?=0 AND NOT EXISTS(SELECT 1 FROM product_detail_workspaces WHERE owner_id=? AND product_id=? AND category_scope=? AND option_id=?))
      OR EXISTS(SELECT 1 FROM product_detail_workspaces WHERE owner_id=? AND product_id=? AND category_scope=? AND option_id=? AND revision=? AND payload=? AND request_id=? AND updated_at=?))
    ON CONFLICT(owner_id,product_id,category_scope,option_id) DO UPDATE SET revision=excluded.revision,request_id=excluded.request_id,payload=excluded.payload,updated_at=excluded.updated_at
      WHERE product_detail_workspaces.revision=? AND product_detail_workspaces.payload=? AND product_detail_workspaces.request_id=? AND product_detail_workspaces.updated_at=?
    RETURNING revision,request_id,payload,updated_at`).bind(owner, id, before.scope, input.optionId, workspace.revision, workspace.requestId, payload, workspace.updatedAt,
    ...guard.args, input.expectedRevision, owner, id, before.scope, input.optionId, owner, id, before.scope, input.optionId,
    input.expectedRevision, previous?.payload ?? '', previous?.request_id ?? '', previous?.updated_at ?? '',
    input.expectedRevision, previous?.payload ?? '', previous?.request_id ?? '', previous?.updated_at ?? '').first<Row>();
  if (!result) throw conflict();
  if (result.payload !== payload || result.revision !== workspace.revision || result.request_id !== workspace.requestId) throw new DetailWorkspaceError('작업공간 저장 응답을 확인하지 못했습니다. 다시 저장하지 말고 조회로 확인해주세요.', 503);
  const after = await readDetailWorkspace(owner, company, identity, id, profileId, input.optionId, signal);
  if (!same(after.workspace, workspace)) throw new DetailWorkspaceError('작업공간 저장 결과를 확인하지 못했습니다. 조회로 먼저 확인해주세요.', 503);
  return after;
}
