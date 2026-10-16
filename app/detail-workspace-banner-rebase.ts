import { DetailWorkspaceError, detailWorkspaceDigest, detailWorkspaceExpectedView, detailWorkspaceFileKeys, generateDetailWorkspaceHtml,
  validateDetailWorkspaceDocument, validateDetailWorkspaceRecord, validateDetailWorkspaceRoles,
  validateDetailWorkspaceExpectedView,
  type DetailWorkspaceDocument, type DetailWorkspaceExpectedView, type DetailWorkspaceFile, type DetailWorkspaceRecord, type DetailWorkspaceRoles } from '@/app/detail-workspace';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { labelUploadDigest } from '@/app/label-upload-key';

export type DetailWorkspaceBannerRebasePreview = {
  format: 'detail-workspace-banner-rebase-v1'; view: QuotationFieldsView; workspace: DetailWorkspaceRecord; roles: DetailWorkspaceRoles;
  document: DetailWorkspaceDocument; files: DetailWorkspaceFile[]; requestId: string;
};
export type DetailWorkspaceBannerRebaseInput = {
  optionId: string; expectedRevision: number; expectedDigest: string; expectedView: DetailWorkspaceExpectedView; requestId: string;
};
const invalid = (): never => { throw new DetailWorkspaceError('상세 배너 갱신의 저장 구성과 현재 상품·회사·사진 증거를 확인해주세요.'); };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function detailWorkspaceBannerRebaseRequestId(productId: string, optionId: string, expectedRevision: number, expectedDigest: string,
  expectedView: DetailWorkspaceExpectedView, roles: DetailWorkspaceRoles, document: DetailWorkspaceDocument, files: DetailWorkspaceFile[]): Promise<string> {
  if (![productId, optionId].every(value => /^[A-Za-z0-9_-]{1,80}$/u.test(value)) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !/^[a-f0-9]{64}$/u.test(expectedDigest)) return invalid();
  detailWorkspaceFileKeys(document);
  return labelUploadDigest(new TextEncoder().encode(JSON.stringify({ format: 'detail-workspace-banner-rebase-v1', productId, optionId,
    expectedRevision, expectedDigest, expectedView: validateDetailWorkspaceExpectedView(expectedView), roles: { top: [...roles.top], bottom: [...roles.bottom] },
    document, files: files.map(file => ({ key: file.key, sha256: file.sha256, bytes: file.bytes, width: file.width, height: file.height })) })));
}

/** Replace only protected setting rows. Every body row remains byte-for-byte
 * identical and in its saved relative order, including its original reference. */
export function buildDetailWorkspaceBannerDocument(workspace: DetailWorkspaceRecord, roles: DetailWorkspaceRoles): DetailWorkspaceDocument {
  if (!workspace || !Number.isSafeInteger(workspace.revision) || workspace.revision < 1) return invalid();
  detailWorkspaceFileKeys(workspace.document);
  if (!roles || !Array.isArray(roles.top) || !Array.isArray(roles.bottom) || Object.keys(roles).length !== 2
    || new Set([...roles.top, ...roles.bottom]).size !== roles.top.length + roles.bottom.length) return invalid();
  const bodies = workspace.document.photos.filter(photo => photo.role === 'body').map(photo => ({ ...photo })), used = new Set(bodies.map(photo => photo.id));
  if (bodies.some(photo => roles.top.includes(photo.key) || roles.bottom.includes(photo.key)))
    throw new DetailWorkspaceError('새 배너 사진이 보관한 본문 사진과 겹칩니다. 기본설정에서 다른 배너 사진을 선택한 뒤 다시 검토해주세요.');
  const rows = (role: 'top' | 'bottom') => roles[role].map((key, index) => {
    const previous = workspace.document.photos.find(photo => photo.role === role && photo.key === key);
    let id = previous?.id ?? `banner-rebase-${workspace.revision + 1}-${role}-${index}`, suffix = 0;
    while (used.has(id)) id = `banner-rebase-${workspace.revision + 1}-${role}-${index}-${++suffix}`;
    used.add(id); return { id, originKey: key, key, role };
  });
  const photos = [...rows('top'), ...bodies, ...rows('bottom')], imageMargin = workspace.document.imageMargin;
  return { format: 'detail-workspace-v1', photos, imageMargin, generatedHtml: generateDetailWorkspaceHtml(photos, imageMargin) };
}

/** Both API and client reconstruct the same review. Actual file reads remain
 * server/client boundary work; the hash binds their exact ordered proofs. */
export async function createDetailWorkspaceBannerPreview(view: QuotationFieldsView, workspace: DetailWorkspaceRecord, roles: DetailWorkspaceRoles, files: DetailWorkspaceFile[]): Promise<DetailWorkspaceBannerRebasePreview> {
  const owner = view.imageKeys[0]?.split('/')[0] ?? workspace.files[0]?.key.split('/')[0] ?? 'empty-workspace',
    saved = validateDetailWorkspaceRecord(workspace, owner, workspace.productId, workspace.optionId, view.categoryContext, workspace.company), { digest, ...body } = saved;
  if (await detailWorkspaceDigest(body) !== digest || view.resolved.rows.filter(row => row.optionId === saved.optionId).length !== 1) return invalid();
  const currentRoles = validateDetailWorkspaceRoles(roles, owner, view.imageKeys), document = buildDetailWorkspaceBannerDocument(saved, currentRoles);
  validateDetailWorkspaceDocument(document, owner, view.imageKeys, undefined, currentRoles, saved.document.photos);
  const candidate = validateDetailWorkspaceRecord({ ...saved, document, files }, owner, saved.productId, saved.optionId, view.categoryContext, saved.company), expectedView = detailWorkspaceExpectedView(view);
  if (!same(candidate.document, document)) return invalid();
  const requestId = await detailWorkspaceBannerRebaseRequestId(saved.productId, saved.optionId, saved.revision, saved.digest, expectedView, currentRoles, document, candidate.files);
  return { format: 'detail-workspace-banner-rebase-v1', view: structuredClone(view), workspace: saved, roles: currentRoles, document, files: candidate.files, requestId };
}
