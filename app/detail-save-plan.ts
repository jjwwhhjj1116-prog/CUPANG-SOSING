import { applyQuotationChanges, validateQuotationChanges, type QuotationChange, type QuotationFieldsView } from '@/app/quotation-schema';
import { optionImageTargets } from '@/app/quotation-image-targets';
import { OPTION_LIMIT } from '@/app/product-options';
import { MAX_IMAGE_BYTES, isOwnedImageKey, PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-files';
import { exactPrimaryQuotationTarget } from '@/app/quotation-seo-targets';
import type { DetailSaveEditorSnapshot } from '@/app/detail-editor-composition';
import type { DetailWorkspaceRecord } from '@/app/detail-workspace';
import { labelUploadDigest } from '@/app/label-upload-key';

export const DETAIL_SAVE_TEXT_POLICY = 'couplus-detail-alt-v1' as const;
export type DetailSaveTextPolicy = typeof DETAIL_SAVE_TEXT_POLICY;
export const DETAIL_SAVE_EDITOR_POLICY = 'ordered-inputs-html-v1' as const;
export const DETAIL_SAVE_PUBLICATION_POLICY = 'shared-body-pixels-v1' as const;
export const DETAIL_PUBLICATION_CURRENT_POLICY = 'automatic-stage5-v1' as const;
export type DetailPublicationCurrentProof = { policy: typeof DETAIL_PUBLICATION_CURRENT_POLICY; basisSha256: string; fieldsSha256: string };
export type DetailSavePublishedBodyImage={sourceKey:string;key:string;sha256:string;width:number;height:number};
export function detailSavePublishedBodyImages(workspace:DetailWorkspaceRecord,owner:string):DetailSavePublishedBodyImage[]{
  const seen=new Set<string>();return workspace.document.photos.flatMap(photo=>{
    if(photo.role!=='body'||seen.has(photo.key))return[];seen.add(photo.key);const file=workspace.files.find(file=>file.key===photo.key);
    if(!file||!isOwnedImageKey(owner,photo.key))throw Error('발행할 본문 사진의 원본 증거를 확인해주세요.');
    return[{sourceKey:photo.key,key:photo.key.startsWith(`${owner}/free-image-`)?`${owner}/published-detail-${file.sha256}.png`:photo.key,sha256:file.sha256,width:file.width,height:file.height}];
  });
}
export type DetailSaveEditorPolicy = typeof DETAIL_SAVE_EDITOR_POLICY;
export type DetailSaveWorkspaceProof = { revision: number; digest: string };
/** Keep the all-option raw-row predicate within the existing 2MiB snapshot bound. */
export const DETAIL_SAVE_PEER_SNAPSHOT_LIMIT = 2 * 1024 * 1024;
export type DetailSavePeers = { optionId: string; workspace: DetailSaveWorkspaceProof | null }[];
export function validateDetailSavePeers(value: unknown, optionIds: readonly string[]): DetailSavePeers {
  if (!Array.isArray(value) || value.length !== optionIds.length || !value.length || value.length > OPTION_LIMIT) throw Error('모든 실제 옵션의 상세 구성 연결을 확인해주세요.');
  return value.map((row, index) => {
    const workspace = row?.workspace;
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== 2 || !Object.hasOwn(row, 'optionId') || !Object.hasOwn(row, 'workspace')
      || row.optionId !== optionIds[index] || workspace !== null && (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)
        || Object.keys(workspace).length !== 2 || !Object.hasOwn(workspace, 'revision') || !Object.hasOwn(workspace, 'digest')
        || !Number.isSafeInteger(workspace.revision) || workspace.revision < 1 || typeof workspace.digest !== 'string' || !/^[a-f0-9]{64}$/u.test(workspace.digest)))
      throw Error('모든 실제 옵션의 상세 구성 연결을 확인해주세요.');
    return { optionId: row.optionId, workspace: workspace === null ? null : { revision: workspace.revision, digest: workspace.digest } };
  });
}
export const detailSavePeerDigest = (peers: DetailSavePeers) => labelUploadDigest(new TextEncoder().encode(JSON.stringify(peers)));

export type DetailSaveReceipt = {
  uploadId: string; key: string; sha256: string; bytes: number; revision: number; beforeRevision: number;
  sourceOptionId: string; categoryId: string | null; optionIds: string[];
  textPolicy?: DetailSaveTextPolicy; textCommonFilled?: boolean;
  editorPolicy?: DetailSaveEditorPolicy; editorSha256?: string;
  workspace?: DetailSaveWorkspaceProof;
  peerDigest?: string;
  publicationPolicy?:typeof DETAIL_SAVE_PUBLICATION_POLICY;publishedBodyImages?:DetailSavePublishedBodyImage[];peerAfterDigest?:string;
  currentStage5?: DetailPublicationCurrentProof;
};
export type DetailSaveSource = { key: string; sha256: string; width: number; height: number };
export type DetailSaveBackup = {
  receipt: DetailSaveReceipt; before: QuotationChange[]; sources: DetailSaveSource[];
  beforeProductVersion: string; beforeInputFingerprint: string; updatedAt: string;
  editor?: DetailSaveEditorSnapshot;
  workspace?: DetailWorkspaceRecord;
  peerPublication?:{before:DetailSavePeers;after:DetailSavePeers};
};

export function detailSaveOptionIds(view: QuotationFieldsView): string[] {
  const ids = view.resolved.rows.flatMap(row => row.optionId === null ? [] : [row.optionId]);
  if (!ids.length || ids.length > OPTION_LIMIT || new Set(ids).size !== ids.length || ids.some(id => !/^[A-Za-z0-9_-]{1,80}$/.test(id)))
    throw Error('상세 이미지를 저장할 실제 옵션 목록을 확인해주세요.');
  return ids;
}
/** Preserve raw absence/blank and every option's own detail fields across later unrelated saves. */
export async function detailPublicationFieldsDigest(view: QuotationFieldsView, overrides = view.overrides): Promise<string> {
  const targets = optionImageTargets(view.resolved.schema.fields), alt = exactPrimaryQuotationTarget(view.resolved.schema.fields, 'altText'),
    keys = [...targets.detailImages.linked, ...targets.detailHtml.linked, ...alt.linked],
    layer = (value: Record<string, string>) => keys.map(key => [key, Object.hasOwn(value, key) ? value[key] : null]);
  return labelUploadDigest(new TextEncoder().encode(JSON.stringify({ policy: DETAIL_PUBLICATION_CURRENT_POLICY, keys,
    common: layer(overrides.common), options: detailSaveOptionIds(view).map(optionId => [optionId, layer(overrides.options[optionId] ?? {})]) })));
}
/** An explicit stage-five save replaces the two final fields in the common
 * layer and every real option, including options currently excluded from export. */
export function detailSaveCommonAltText(view: QuotationFieldsView): string {
  const target = exactPrimaryQuotationTarget(view.resolved.schema.fields, 'altText');
  const rows = view.resolved.rows.filter(row => row.optionId === null);
  const value = rows[0]?.fields[target.primary]?.value;
  if (rows.length !== 1 || typeof value !== 'string') throw Error('공통 견적서의 대체 텍스트를 확인해주세요.');
  return value;
}
/** Keep saved description truthiness and append only the saved translated option
 * name. The snapshot supplies the final SEO title, or source title if absent. */
export function detailSaveAltChanges(view: QuotationFieldsView, fillCommon = !detailSaveCommonAltText(view)): QuotationChange[] {
  const ids = detailSaveOptionIds(view), basis = view.detailSaveTextBasis;
  if (!basis || Object.keys(basis).length !== 4 || basis.policy !== DETAIL_SAVE_TEXT_POLICY
    || typeof basis.productName !== 'string' || basis.productName.length > 20000 || typeof basis.metaDescription !== 'string' || basis.metaDescription.length > 20000
    || !basis.optionNames || typeof basis.optionNames !== 'object' || Array.isArray(basis.optionNames) || Object.keys(basis.optionNames).length !== ids.length
    || ids.some(id => !Object.hasOwn(basis.optionNames, id) || typeof basis.optionNames[id] !== 'string' || basis.optionNames[id].length > 5000))
    throw Error('대체 텍스트 원천을 최신 저장본에서 다시 확인해주세요.');
  const target = exactPrimaryQuotationTarget(view.resolved.schema.fields, 'altText');
  const base = basis.metaDescription || `${basis.productName} 상세 설명`;
  return [...(fillCommon ? [null] : []), ...ids].flatMap(optionId => target.linked.map(fieldKey => ({ fieldKey, optionId,
    value: optionId !== null && basis.optionNames[optionId] ? `${base} - ${basis.optionNames[optionId]}` : base })));
}
export function detailSaveChanges(view: QuotationFieldsView, key: string, textPolicy?: DetailSaveTextPolicy, fillCommon?: boolean): QuotationChange[] {
  if (textPolicy !== undefined && textPolicy !== DETAIL_SAVE_TEXT_POLICY || fillCommon !== undefined && (textPolicy === undefined || typeof fillCommon !== 'boolean'))
    throw Error('상세 저장의 대체 텍스트 적용 규칙을 확인해주세요.');
  const optionIds = detailSaveOptionIds(view), targets = optionImageTargets(view.resolved.schema.fields);
  const changes: QuotationChange[] = [null, ...optionIds].flatMap(optionId => [
    ...targets.detailImages.linked.map(fieldKey => ({ optionId, fieldKey, value: key })),
    ...targets.detailHtml.linked.map(fieldKey => ({ optionId, fieldKey, value: '' })),
  ]);
  if (textPolicy) changes.push(...detailSaveAltChanges(view, fillCommon));
  const context = { schema: view.resolved.schema, optionIds, ownedImageKeys: [...new Set([...view.imageKeys, key])], overrides: view.overrides };
  return validateQuotationChanges(changes, context);
}
/** Preserve only fields this command overwrites; null records an absent own
 * property, which is different from an intentionally saved empty string. */
export function detailSaveManualBackup(view: QuotationFieldsView, changes: readonly QuotationChange[]): QuotationChange[] {
  return changes.map(({ optionId, fieldKey }) => {
    const layer = optionId === null ? view.overrides.common : view.overrides.options[optionId];
    return { optionId, fieldKey, value: layer && Object.hasOwn(layer, fieldKey) ? layer[fieldKey] : null };
  });
}
export function detailSaveReceiptMatches(view: QuotationFieldsView, receipt: DetailSaveReceipt): boolean {
  try {
    if (!receipt || !/^[a-f0-9]{64}$/.test(receipt.uploadId) || !/^[a-f0-9]{64}$/.test(receipt.sha256)
      || !Number.isSafeInteger(receipt.bytes) || receipt.bytes < 1 || receipt.bytes > MAX_IMAGE_BYTES
      || !Number.isSafeInteger(receipt.beforeRevision) || receipt.beforeRevision < 0 || receipt.revision !== receipt.beforeRevision + 1
      || receipt.revision !== view.revision || receipt.categoryId !== view.categoryContext.categoryId
      || JSON.stringify(receipt.optionIds) !== JSON.stringify(detailSaveOptionIds(view)) || !receipt.optionIds.includes(receipt.sourceOptionId)
      || !view.imageKeys.includes(receipt.key) || view.updatedAt !== view.productVersion) return false;
    if (receipt.textPolicy === undefined ? receipt.textCommonFilled !== undefined : receipt.textPolicy !== DETAIL_SAVE_TEXT_POLICY || typeof receipt.textCommonFilled !== 'boolean') return false;
    if (receipt.editorPolicy === undefined ? receipt.editorSha256 !== undefined : receipt.editorPolicy !== DETAIL_SAVE_EDITOR_POLICY || typeof receipt.editorSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.editorSha256)) return false;
    if (receipt.workspace !== undefined && (!receipt.workspace || typeof receipt.workspace !== 'object' || Array.isArray(receipt.workspace)
      || Object.keys(receipt.workspace).length !== 2 || !Number.isSafeInteger(receipt.workspace.revision) || receipt.workspace.revision < 1
      || typeof receipt.workspace.digest !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.workspace.digest)
      || receipt.textPolicy !== DETAIL_SAVE_TEXT_POLICY || receipt.editorPolicy !== DETAIL_SAVE_EDITOR_POLICY)) return false;
    if (receipt.peerDigest !== undefined && (!receipt.workspace || typeof receipt.peerDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(receipt.peerDigest))) return false;
    if (receipt.currentStage5 !== undefined && (!receipt.currentStage5 || Object.keys(receipt.currentStage5).sort().join(',') !== 'basisSha256,fieldsSha256,policy'
      || receipt.publicationPolicy !== DETAIL_SAVE_PUBLICATION_POLICY || receipt.currentStage5.policy !== DETAIL_PUBLICATION_CURRENT_POLICY
      || !/^[a-f0-9]{64}$/u.test(receipt.currentStage5.basisSha256) || !/^[a-f0-9]{64}$/u.test(receipt.currentStage5.fieldsSha256))) return false;
    if(receipt.publicationPolicy!==undefined||receipt.publishedBodyImages!==undefined||receipt.peerAfterDigest!==undefined){
      const images=receipt.publishedBodyImages,owner=receipt.key.split('/')[0];
      if(receipt.publicationPolicy!==DETAIL_SAVE_PUBLICATION_POLICY||!receipt.workspace||!receipt.peerDigest||typeof receipt.peerAfterDigest!=='string'||!/^[a-f0-9]{64}$/u.test(receipt.peerAfterDigest)
        ||!Array.isArray(images)||!images.length||images.length>PRODUCT_IMAGE_POOL_LIMIT||new Set(images.map(image=>image.sourceKey)).size!==images.length
        ||images.some(image=>!image||Object.keys(image).sort().join(',')!=='height,key,sha256,sourceKey,width'||!isOwnedImageKey(owner,image.sourceKey)||!isOwnedImageKey(owner,image.key)||!/^[a-f0-9]{64}$/u.test(image.sha256)
          ||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<1||image.height<1||!view.imageKeys.includes(image.key)
          ||image.key!==(image.sourceKey.startsWith(`${owner}/free-image-`)?`${owner}/published-detail-${image.sha256}.png`:image.sourceKey)))return false;
    }
    const changes = detailSaveChanges(view, receipt.key, receipt.textPolicy, receipt.textCommonFilled), expected = applyQuotationChanges(view.overrides, changes);
    if (JSON.stringify(expected) !== JSON.stringify(view.overrides)) return false;
    return view.resolved.rows.every(row => changes.filter(change => change.optionId === row.optionId
      || change.optionId === null && !changes.some(specific => specific.optionId === row.optionId && specific.fieldKey === change.fieldKey))
      .every(change => row.fields[change.fieldKey]?.value === change.value));
  } catch { return false; }
}
