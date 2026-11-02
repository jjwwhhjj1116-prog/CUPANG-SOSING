import { generateDetailWorkspaceHtml, validateDetailWorkspaceDocument, type DetailWorkspaceDocument, type DetailWorkspacePhoto, type DetailWorkspaceView } from '@/app/detail-workspace';
import { isOwnedImageKey, PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-files';

const unavailable = () => Error('수집한 상세 사진의 원본 순서와 상단·하단 구성을 확인하지 못했습니다. 통합 상세 이미지나 다른 사진으로 대체하지 않았습니다.');
const quotationImageSelectionIssue = '이 상품에 저장된 이미지 참조만 중복 없이 선택해주세요.';

/** The editable photo sequence is independent of the final quotation attachment.
 * Automatic detailImages is compiled from content's exact detail roles before
 * manual quotation overrides; a saved workspace remains authoritative. */
export function initialDetailWorkspaceDocument(reply: DetailWorkspaceView, optionId: string, createId: () => string = () => crypto.randomUUID()): DetailWorkspaceDocument {
  if (reply.workspace) return structuredClone(reply.workspace.document);
  const { view, roles } = reply, definitions = view.automatic.schema.fields.filter(field => field.id === 'detailImages');
  const rows = view.automatic.rows.filter(row => row.optionId === optionId);
  if (definitions.length !== 1 || definitions[0].type !== 'images' || rows.length !== 1) throw unavailable();
  const cell = rows[0].fields.detailImages;
  if (!cell || !['content', 'empty'].includes(cell.source) || typeof cell.value !== 'string') throw unavailable();
  const keys = cell.value === '' ? [] : cell.value.split('\n'), owner = view.imageKeys[0]?.split('/')[0];
  if (!owner || keys.length > PRODUCT_IMAGE_POOL_LIMIT || new Set(keys).size !== keys.length
    || keys.some(key => key.trim() !== key || !isOwnedImageKey(owner, key) || !view.imageKeys.includes(key))) throw unavailable();
  // This diagnostic also covers invalid references. Exempt only the final
  // attachment count after independently proving every original key above;
  // filtered sources and all other validation failures still stop seeding.
  const exceedsAttachmentCount = keys.length > (definitions[0].maxItems ?? 30);
  if ((cell.validationIssues ?? cell.issues).some(issue => !exceedsAttachmentCount || issue !== quotationImageSelectionIssue)) throw unavailable();
  const photos: DetailWorkspacePhoto[] = keys.map(key => ({ id: createId(), originKey: key, key,
    role: roles.top.includes(key) ? 'top' : roles.bottom.includes(key) ? 'bottom' : 'body' }));
  const document: DetailWorkspaceDocument = { format: 'detail-workspace-v1', photos, imageMargin: 0, generatedHtml: generateDetailWorkspaceHtml(photos, 0) };
  return validateDetailWorkspaceDocument(document, owner, view.imageKeys, null, roles);
}
