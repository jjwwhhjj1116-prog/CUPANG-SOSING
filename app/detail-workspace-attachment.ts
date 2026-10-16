import type { DetailWorkspaceView } from '@/app/detail-workspace';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-pool-limit';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const changed = (): never => { throw Error('작업 사진의 상품 연결 기준이 바뀌었습니다. 견적서를 유지하고 최신 구성을 확인해주세요.'); };
export function detailWorkspaceAttachedKeys(saved: DetailWorkspaceView): string[] {
  if (!saved.workspace) return changed();
  const keys = [...new Set([...saved.view.imageKeys, ...saved.workspace.document.photos.map(photo => photo.key)])];
  if (keys.length > PRODUCT_IMAGE_POOL_LIMIT) throw Error('편집 결과를 추가하면 상품 이미지 한도를 넘습니다. 기존 파일을 자동으로 삭제하지 않았습니다.');
  return keys;
}
function unchangedQuotation(view: QuotationFieldsView) {
  return Object.fromEntries(Object.entries(view).filter(([key]) => !['productVersion', 'imageKeys', 'inputFingerprint'].includes(key)));
}
/** Attachment is an explicit pool-only action. It never substitutes a quote
 * write for the existing read-only local-draft adoption action. */
export function verifyDetailWorkspaceAttachment(before: DetailWorkspaceView, after: DetailWorkspaceView): void {
  const keys = detailWorkspaceAttachedKeys(before);
  if (!same(before.workspace, after.workspace) || !same(before.roles, after.roles)
    || !same(unchangedQuotation(before.view), unchangedQuotation(after.view)) || !same(after.view.imageKeys, keys)
    || !/^[a-f0-9]{64}$/u.test(after.view.inputFingerprint) || !Number.isFinite(Date.parse(after.view.productVersion))
    || Date.parse(after.view.productVersion) < Date.parse(before.view.productVersion)
    || keys.length !== before.view.imageKeys.length && Date.parse(after.view.productVersion) <= Date.parse(before.view.productVersion)) return changed();
}
