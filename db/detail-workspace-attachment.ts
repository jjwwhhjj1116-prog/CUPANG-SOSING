import { readDetailWorkspace } from '@/db/detail-workspaces';
import { readOwnedSplitSnapshot, splitSnapshotPredicate } from '@/db/product-option-splits';
import { DetailWorkspaceError, detailWorkspaceExpectedView, detailWorkspaceScope, validateDetailWorkspaceRecord,
  type DetailWorkspaceExpectedView, type DetailWorkspaceView } from '@/app/detail-workspace';
import { detailWorkspaceAttachedKeys, verifyDetailWorkspaceAttachment } from '@/app/detail-workspace-attachment';
import type { SupplierHubCompany } from '@/app/supplier-hub-company';

export type DetailWorkspaceAttachmentInput = { optionId: string; expectedView: DetailWorkspaceExpectedView; revision: number; digest: string };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const changed = () => new DetailWorkspaceError('상세 편집 구성이나 상품 연결 기준이 바뀌었습니다. 현재 작업을 유지하고 다시 확인해주세요.');
/** Append only the currently reviewed workspace results. The one guarded UPDATE
 * changes the private candidate pool and product clock, never quote fields. */
export async function attachDetailWorkspaceFiles(owner: string, company: SupplierHubCompany, identity: { email: string; role: string },
  productId: string, profileId: string | null, input: DetailWorkspaceAttachmentInput, signal: AbortSignal): Promise<DetailWorkspaceView> {
  signal.throwIfAborted();
  const before = await readDetailWorkspace(owner, company, identity, productId, profileId, input.optionId, signal), record = before.workspace;
  if (!record || record.revision !== input.revision || record.digest !== input.digest
    || !same(before.view.categoryContext, input.expectedView.categoryContext)) throw changed();
  let keys: string[];
  try { keys = detailWorkspaceAttachedKeys(before); }
  catch (error) { throw new DetailWorkspaceError(error instanceof Error ? error.message : '상품 이미지 용량을 확인해주세요.', 413); }
  // A repeated request can observe the already attached keys without repeating
  // a write. The client still compares every unchanged quotation field.
  if (same(keys, before.view.imageKeys)) return before;
  if (!same(detailWorkspaceExpectedView(before.view), input.expectedView)) throw changed();
  const saved = await readOwnedSplitSnapshot(owner, productId, before.view.categoryContext.profileId), raw = saved.raw,
    member = raw.member[0], product = raw.products[0], scope = await detailWorkspaceScope(before.view.categoryContext);
  if (raw.removed || raw.busy || raw.products.length !== 1 || raw.member.length !== 1 || member.status !== 'approved'
    || member.email !== identity.email || member.role !== identity.role || member.company_code !== company.code || member.company_name !== company.name
    || product.updated_at !== before.view.productVersion || typeof product.image_keys !== 'string'
    || !same(JSON.parse(product.image_keys), before.view.imageKeys)) throw changed();
  const previous = await saved.db.prepare('SELECT payload,request_id,updated_at FROM product_detail_workspaces WHERE owner_id=? AND product_id=? AND category_scope=? AND option_id=?')
    .bind(owner, productId, scope, input.optionId).first<{ payload: string; request_id: string; updated_at: string }>();
  if (!previous || !same(validateDetailWorkspaceRecord(JSON.parse(previous.payload), owner, productId, input.optionId, before.view.categoryContext, company), record)) throw changed();
  // Re-read actual sealed result/base bytes and paired source rows immediately
  // before the SQL predicate. No client-owned extra file list is accepted.
  if (!same(await readDetailWorkspace(owner, company, identity, productId, profileId, input.optionId, signal), before)
    || (await readOwnedSplitSnapshot(owner, productId, before.view.categoryContext.profileId, saved.db)).payload !== saved.payload) throw changed();
  signal.throwIfAborted();
  const now = new Date(Math.max(Date.now(), Date.parse(before.view.productVersion) + 1)).toISOString(),
    guard = splitSnapshotPredicate(owner, productId, before.view.categoryContext.profileId, saved.payload), payload = JSON.stringify(keys);
  const result = await saved.db.prepare(`UPDATE products SET image_keys=?,updated_at=? WHERE id=? AND owner_id=? AND ${guard.sql}
    AND EXISTS(SELECT 1 FROM product_detail_workspaces WHERE owner_id=? AND product_id=? AND category_scope=? AND option_id=? AND revision=? AND payload=? AND request_id=? AND updated_at=?)
    RETURNING id,image_keys,updated_at`).bind(payload, now, productId, owner, ...guard.args, owner, productId, scope, input.optionId, record.revision, previous.payload, previous.request_id, previous.updated_at)
    .first<{ id: string; image_keys: string; updated_at: string }>();
  if (!result) throw changed();
  try {
    if (result.id !== productId || result.image_keys !== payload || result.updated_at !== now) throw changed();
    const after = await readDetailWorkspace(owner, company, identity, productId, profileId, input.optionId, signal);
    verifyDetailWorkspaceAttachment(before, after);
    if (after.view.productVersion !== now) throw changed();
    return after;
  } catch {
    throw new DetailWorkspaceError('사진 연결 요청의 완료 여부를 읽기로 확인해주세요. 같은 요청을 자동 반복하지 않았습니다.', 503);
  }
}
