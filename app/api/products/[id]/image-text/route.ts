import { NextResponse } from 'next/server';
import { env, waitUntil } from 'cloudflare:workers';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct, getSettings } from '@/db/queries';
import { savedRegistrationSettings } from '@/app/workspace-settings';
import {createImageTextStyle,parseImageTextStyle} from '@/app/image-text-vision';
import { readProductContent } from '@/db/product-content';
import { readProductOptions } from '@/db/product-options';
import { attachProductDocument } from '@/db/product-attachments';
import { applyProductImageTranslation } from '@/db/product-image-translation';
import { attachQuotationImageTranslation } from '@/db/quotation-fields';
import { stableQuotationFieldsView, QuotationFieldsSnapshotError } from '@/app/quotation-fields-snapshot';
import { exactPrimaryQuotationTarget } from '@/app/quotation-seo-targets';
import { quotationImageKeys } from '@/app/quotation-image-targets';
import { applyQuotationChanges, validateQuotationChanges } from '@/app/quotation-schema';
import { PublicDetailError } from '@/app/quotation-public-detail';
import { applyContentPatch, productImageKeys } from '@/app/product-content';
import { inspectImage } from '@/app/automation/image-edit';
import { translateImageRegions } from '@/app/automation/free-image-text';
import { isOwnedImageKey, MAX_IMAGE_BYTES, MAX_IMAGE_MULTIPART_BYTES, PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-files';
import { MAX_OCR_PIXELS, validFreeImageRole, validateFreeImageSource, validateImageTextRegions,
  freeImageSourceIdentity, freeImageApplyIdentity, freeImageRoleEditApplyIdentity, validateFreeImageOptionIds, type FreeImageSource, type FreeImageQuotationTarget } from '@/app/free-image-translation';
import { readBoundedBytes, readBoundedStream, RequestBodyError } from '@/app/request-body';
import { validateFreeImageCrop, type FreeImageCrop } from '@/app/free-image-crop';
import { freeImageEditOutputDimensions, validateFreeImageEditDocument, MAX_FREE_IMAGE_EDIT_BYTES, type FreeImageEditDocument } from '@/app/free-image-edit-document';
import { FreeImageEditRecordError, freeImageEditDigest, freeImageEditDocumentBytes, prepareFreeImageEditRecord, prepareFreeImageRoleEditRecord, readFreeImageEditRecord, storeFreeImageEditRecord, type PreparedFreeImageEditRecord } from '@/app/free-image-edit-record';
import { approvedSupplierHubCompany } from '@/app/supplier-hub-company';
import {imageTextRecoveryConfigured,imageTextRecoveryWithinLimit,recoverImageTextRegions,unavailableImageTextRecovery,ImageTextRecoveryError,type ImageTextRecoveryEnvironment} from '@/app/automation/workers-image-text-recovery';
import {imageVisionConfiguration,readImageVision,readStoredImageVisionResult,submitImageVisionBatch,pollImageVisionBatch,ImageVisionError,type ImageVisionEnvironment} from '@/app/automation/workers-image-vision';
import {IMAGE_TEXT_INSPECTION_POLICY,IMAGE_TEXT_PRESERVATION_POLICY,isImageTextInspectionPolicy,type ImageTextInspectionPolicy,parseImageTextVisionConfiguration} from '@/app/image-text-vision';
import {DetailWorkspaceError} from '@/app/detail-workspace';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import type {DetailWorkspaceImageProofs} from '@/db/detail-workspaces';
import type {FreeImageVisionAttempt} from '@/app/free-image-vision-error';
import type {ImageVisionBatchActor,ImageVisionBatchScope,ImageVisionBatchRow} from '@/db/image-vision-batches';

type Context = { params: Promise<{ id: string }> };
class ImageTextError extends Error {
  constructor(public status: 400 | 404 | 409 | 413 | 415 | 503, message: string) { super(message); }
}
class ImageTextStyleNotAdmitted extends ImageTextError {}
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
const changed = () => new ImageTextError(409, '번역 중 원본 이미지나 저장 내용이 변경되었습니다. 최신 이미지를 다시 불러와주세요.');
async function digest(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), byte => byte.toString(16).padStart(2, '0')).join('');
}
function collectedVisionAliases(owner: string, source: FreeImageSource, mime: string) {
  const extension = ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'} as Record<string,string>)[mime];
  if (!extension) return [source.sourceKey];
  const aliases = ['', 'main-', 'additional-', 'detail-'].map(role => `${owner}/collected-${role}${source.sourceSha256}.${extension}`);
  // Include historical aliases even when their role copy has since been removed.
  return aliases.includes(source.sourceKey) ? aliases : [source.sourceKey];
}
async function ownerId() {
  const user = await getChatGPTUser();
  if ((process.env.NODE_ENV === 'production' || (env as { YOOFAM_AUTH_ENABLED?: string }).YOOFAM_AUTH_ENABLED === 'true') && !user?.verifiedAccess) throw new ImageTextError(503, '로그인 후 이미지 문구를 번역할 수 있습니다.');
  return user?.userId ?? await getWorkspaceOwnerId();
}
async function state(owner: string, id: string) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new ImageTextError(400, '상품 번호를 확인해주세요.');
  const product = await findProduct(owner, id);
  if (!product) throw new ImageTextError(404, '상품을 찾을 수 없습니다.');
  return { product, content: await readProductContent(owner, id), keys: productImageKeys(product.image_keys) };
}
async function readImage(key: string) {
  if (!env.FILES) throw new ImageTextError(503, '이미지 저장소가 연결되지 않았습니다.');
  const object = await env.FILES.get(key);
  if (!object) throw new ImageTextError(409, '원본 이미지 파일을 다시 확인해주세요.');
  if (object.size < 1 || object.size > MAX_IMAGE_BYTES) throw new ImageTextError(413, '이미지 한 장은 10MB 이하여야 합니다.');
  const bytes = await readBoundedStream(object.body, MAX_IMAGE_BYTES);
  if (bytes.length !== object.size) throw new ImageTextError(503, '이미지 파일을 끝까지 읽지 못했습니다.');
  let dimensions;
  try { dimensions = inspectImage(bytes); }
  catch { throw new ImageTextError(415, 'PNG·JPEG·WebP 정지 이미지만 번역할 수 있습니다.'); }
  if (dimensions.width * dimensions.height > MAX_OCR_PIXELS) throw new ImageTextError(413, '이미지 번역은 1,200만 픽셀 이하에서 사용할 수 있습니다.');
  return { object, bytes, dimensions };
}
async function original(owner: string, id: string, sourceKey: string, role: FreeImageSource['role'], current: Awaited<ReturnType<typeof state>>, requireRole: boolean, includeOptions = false, quotationTarget?: FreeImageQuotationTarget, editorSource?: FreeImageSource['editorSource']) {
  if (!isOwnedImageKey(owner, sourceKey) || !current.keys.includes(sourceKey)) throw new ImageTextError(404, '이 상품에 저장된 본인 소유 이미지를 선택해주세요.');
  const options = role === 'main' && includeOptions ? await readProductOptions(owner, id) : null;
  const optionIds = options?.rows.filter(row => row.imageKey === sourceKey).map(row => row.id).sort() ?? [];
  const commonAssigned = current.content.assets[role].value.includes(sourceKey);
  if (requireRole && !commonAssigned && !(role === 'main' && options && optionIds.length)) throw new ImageTextError(409,
    '선택한 원본은 현재 이미지 역할에 연결되어 있지 않습니다. 해당 단계에서 사용할 사진을 먼저 선택·저장한 뒤 이미지 카드의 편집을 열어주세요.');
  const { bytes, dimensions } = await readImage(sourceKey);
  const source: FreeImageSource = { productId: id, productVersion: current.product.updated_at, contentRevision: current.content.revision,
    sourceKey, sourceSha256: await digest(bytes), role, width: dimensions.width, height: dimensions.height,
    ...(options ? { optionImages: { revision: options.revision, optionIds, ...(!commonAssigned ? { commonAssigned: false as const } : {}) } } : {}), ...(quotationTarget ? { quotationTarget } : {}), ...(editorSource ? { editorSource } : {}) };
  try { return validateFreeImageSource(source); }
  catch { throw new ImageTextError(409, '대표 이미지에 연결된 옵션 정보를 다시 확인해주세요.'); }
}
type QuotationSelection = Pick<FreeImageQuotationTarget, 'profileId' | 'optionId' | 'input' | 'fieldKey' | 'slotIndex'>;
type QuotationSnapshot = Awaited<ReturnType<typeof stableQuotationFieldsView>>;
async function quotationBinding(saved: QuotationSnapshot, input: FreeImageQuotationTarget['input'], outputKey?: string) {
  const guards = Object.fromEntries(Object.entries(saved.source).filter(([field]) => field !== 'productVersion' && field !== 'imageKeys'));
  return digest(new TextEncoder().encode(JSON.stringify({ target: exactPrimaryQuotationTarget(saved.view.resolved.schema.fields, input),
    categoryContext: saved.view.categoryContext, guards, imageKeys: saved.view.imageKeys.filter(key => key !== outputKey) })));
}
function quotationValue(source: FreeImageSource, key: string) {
  const target = source.quotationTarget!; let slot = -1;
  return target.value.split('\n').map(line => line.trim() && ++slot === target.slotIndex ? key : line).join('\n');
}
function quotationOverrides(saved: QuotationSnapshot, source: FreeImageSource, key: string) {
  const target = source.quotationTarget!, exact = exactPrimaryQuotationTarget(saved.view.resolved.schema.fields, target.input);
  const changes = validateQuotationChanges(exact.linked.map(fieldKey => ({ fieldKey, optionId: target.optionId, value: quotationValue(source, key) })),
    { schema: saved.view.resolved.schema, optionIds: saved.options.rows.map(row => row.id), ownedImageKeys: [...saved.view.imageKeys, key], overrides: saved.view.overrides });
  return applyQuotationChanges(saved.view.overrides, changes);
}
async function quotationOriginal(owner: string, id: string, sourceKey: string, role: FreeImageSource['role'], current: Awaited<ReturnType<typeof state>>, selection: QuotationSelection, readOnlyRecovery = false) {
  const saved = await stableQuotationFieldsView(owner, id, selection.profileId), view = saved.view;
  if (view.productVersion !== current.product.updated_at || view.contentRevision !== current.content.revision) throw changed();
  const target = exactPrimaryQuotationTarget(view.resolved.schema.fields, selection.input), rows = view.resolved.rows.filter(row => row.optionId === selection.optionId);
  if (selection.fieldKey !== target.primary || target.fields.some(field => field.readOnly) || rows.length !== 1) throw changed();
  const value = rows[0].fields[target.primary]?.value;
  if (typeof value !== 'string' || target.linked.some(id => rows[0].fields[id]?.value !== value) || quotationImageKeys(value)[selection.slotIndex] !== sourceKey) throw changed();
  if (selection.input === 'detailImages') {
    const protectedKeys = view.protectedDetailImageKeys;
    if (!Array.isArray(protectedKeys) || new Set(protectedKeys).size !== protectedKeys.length
      || protectedKeys.some(key => typeof key !== 'string' || !view.imageKeys.includes(key))) throw changed();
    if (protectedKeys.includes(sourceKey) && !readOnlyRecovery) throw new ImageTextError(409, '상단·하단 설정 이미지는 번역·편집하지 않고 유지합니다. 본문 이미지를 선택해주세요.');
  }
  return original(owner, id, sourceKey, role, current, false, false, { kind: 'quotation', ...selection, revision: view.revision, inputFingerprint: view.inputFingerprint,
    optionRevision: view.optionRevision, bindingSha256: await quotationBinding(saved, selection.input), value });
}
async function editorCompany(owner: string) {
  const user = await getChatGPTUser(), company = approvedSupplierHubCompany(user?.membership);
  if (!user?.verifiedAccess || user.userId !== owner || !company) throw new ImageTextError(409, '승인된 회사 계정에서 편집 문서를 확인해주세요.');
  return company;
}
async function reopenedSource(owner: string, id: string, resultKey: string, role: FreeImageSource['role'], current: Awaited<ReturnType<typeof state>>, selection: QuotationSelection, anchorPolicy?: 'current-target-v1', readOnlyRecovery = false) {
  const anchor = await quotationOriginal(owner, id, resultKey, role, current, selection, readOnlyRecovery);
  if (!env.FILES) throw new ImageTextError(503, '이미지 저장소가 연결되지 않았습니다.');
  const saved = await stableQuotationFieldsView(owner, id, selection.profileId), stored = await readFreeImageEditRecord(env.FILES, owner, id, resultKey), record = stored.record,
    previous = record.source.quotationTarget, company = await editorCompany(owner);
  const roleRecord = record.format === 'free-image-role-edit-record-v1', context = saved.view.categoryContext;
  const sameContext = roleRecord ? record.context.profileId === context.profileId && record.context.categoryId === context.categoryId
    && JSON.stringify(record.context.categoryPath) === JSON.stringify(context.categoryPath)
    && (record.context.source === context.source || record.context.source === 'collection' && context.source === 'profile' && context.profileId === selection.profileId)
    : JSON.stringify(record.context) === JSON.stringify(context);
  if (record.source.productId !== id || (roleRecord ? anchorPolicy !== 'current-target-v1' || record.source.role !== role
      : !previous || previous.profileId !== selection.profileId
        || !anchorPolicy && (record.source.role !== role || previous.optionId !== selection.optionId || previous.input !== selection.input || previous.fieldKey !== selection.fieldKey || previous.slotIndex !== selection.slotIndex))
    || !sameContext || JSON.stringify(record.company) !== JSON.stringify(company)
    || saved.view.productVersion !== current.product.updated_at || saved.view.contentRevision !== current.content.revision) throw changed();
  const source = await original(owner, id, record.source.sourceKey, role, current, false, false, anchor.quotationTarget,
    { resultKey, resultSha256: record.result.sha256, documentSha256: stored.documentSha256, ...(anchorPolicy ? { anchorPolicy } : {}) });
  if (source.sourceSha256 !== record.source.sourceSha256 || source.width !== record.source.width || source.height !== record.source.height) throw changed();
  return { source, editDocument: record.document };
}
type DraftSelection = { profileId: string | null; optionId: string | null };
async function draftBinding(saved: QuotationSnapshot, owner: string, outputKey?: string) {
  return digest(new TextEncoder().encode(JSON.stringify([await quotationBinding(saved, 'additionalImages', outputKey), await editorCompany(owner)])));
}
async function draftOriginal(owner: string, id: string, key: string, current: Awaited<ReturnType<typeof state>>, selection: DraftSelection) {
  const saved = await stableQuotationFieldsView(owner, id, selection.profileId), view = saved.view;
  const target = exactPrimaryQuotationTarget(view.resolved.schema.fields, 'additionalImages');
  if (view.productVersion !== current.product.updated_at || view.contentRevision !== current.content.revision || target.fields.some(field => field.readOnly)
    || selection.optionId !== null && view.resolved.rows.filter(row => row.optionId === selection.optionId).length !== 1) throw changed();
  const base = await original(owner, id, key, 'additional', current, false);
  return validateFreeImageSource({ ...base, additionalDraftTarget: { kind: 'additional-draft', ...selection, revision: view.revision,
    inputFingerprint: view.inputFingerprint, optionRevision: view.optionRevision, bindingSha256: await draftBinding(saved, owner) } });
}
async function reopenedDraftSource(owner: string, id: string, key: string, current: Awaited<ReturnType<typeof state>>, selection: DraftSelection) {
  const anchor = await draftOriginal(owner, id, key, current, selection);
  if (!env.FILES) throw changed();
  const stored = await readFreeImageEditRecord(env.FILES, owner, id, key), record = stored.record;
  const saved = await stableQuotationFieldsView(owner, id, selection.profileId), context = saved.view.categoryContext;
  const sameContext = JSON.stringify(record.context) === JSON.stringify(context)
    || record.format === 'free-image-role-edit-record-v1' && record.context.profileId === context.profileId && record.context.categoryId === context.categoryId
      && JSON.stringify(record.context.categoryPath) === JSON.stringify(context.categoryPath) && record.context.source === 'collection' && context.source === 'profile' && context.profileId === selection.profileId;
  // The current owned pool anchor authorizes this document, including legacy
  // role/quotation sidecars. Its original provenance remains immutable; no
  // historical quotation slot is claimed by the new draft source.
  if (!sameContext || JSON.stringify(record.company) !== JSON.stringify(await editorCompany(owner))
    || anchor.sourceSha256 !== record.result.sha256 || anchor.width !== record.result.width || anchor.height !== record.result.height) throw changed();
  const base = await original(owner, id, record.source.sourceKey, 'additional', current, false);
  if (base.sourceSha256 !== record.source.sourceSha256 || base.width !== record.source.width || base.height !== record.source.height) throw changed();
  return { source: validateFreeImageSource({ ...base, additionalDraftTarget: anchor.additionalDraftTarget,
    editorSource: { resultKey: key, resultSha256: record.result.sha256, documentSha256: stored.documentSha256, anchorPolicy: 'current-pool-v1' } }), editDocument: record.document };
}
async function draftReplay(owner: string, id: string, source: FreeImageSource, key: string, sha256: string, size: number, crop?: FreeImageCrop, editDocument?: FreeImageEditDocument) {
  const target = source.additionalDraftTarget!, current = await state(owner, id);
  if (!current.keys.includes(key)) return null;
  const saved = await stableQuotationFieldsView(owner, id, target.profileId), view = saved.view;
  if (view.revision !== target.revision || view.contentRevision !== source.contentRevision || view.optionRevision !== target.optionRevision
    || Date.parse(view.productVersion) <= Date.parse(source.productVersion) || await draftBinding(saved, owner, key) !== target.bindingSha256) return null;
  const observed = await original(owner, id, source.sourceKey, 'additional', current, false);
  if (observed.sourceSha256 !== source.sourceSha256 || observed.width !== source.width || observed.height !== source.height
    || !await storedOutput(key, source, [], sha256, size, crop, editDocument)) return null;
  return response({ source, key, productVersion: view.productVersion, contentRevision: view.contentRevision, applied: true, replayed: true,
    ...(crop ? { crop } : {}), ...(editDocument ? { editDocumentSha256: await freeImageEditDigest(freeImageEditDocumentBytes(editDocument)) } : {}) });
}
async function reopenedRoleSource(owner: string, id: string, resultKey: string, role: FreeImageSource['role'], current: Awaited<ReturnType<typeof state>>) {
  if (!['main', 'additional', 'detail'].includes(role) || !env.FILES) throw changed();
  const anchor = await original(owner, id, resultKey, role, current, true, true), stored = await readFreeImageEditRecord(env.FILES, owner, id, resultKey), record = stored.record;
  const snapshot = await stableQuotationFieldsView(owner, id, null);
  if (record.format !== 'free-image-role-edit-record-v1' || record.source.role !== role
    || JSON.stringify(record.context) !== JSON.stringify(snapshot.view.categoryContext) || JSON.stringify(record.company) !== JSON.stringify(await editorCompany(owner))
    || snapshot.view.productVersion !== current.product.updated_at || snapshot.view.contentRevision !== current.content.revision
    || anchor.sourceSha256 !== record.result.sha256 || anchor.width !== record.result.width || anchor.height !== record.result.height) throw changed();
  const base = await original(owner, id, record.source.sourceKey, role, current, false, false, undefined,
    { resultKey, resultSha256: record.result.sha256, documentSha256: stored.documentSha256, anchorPolicy: 'current-role-v1' });
  if (base.sourceSha256 !== record.source.sourceSha256 || base.width !== record.source.width || base.height !== record.source.height) throw changed();
  return { source: validateFreeImageSource({ ...base, ...(anchor.optionImages ? { optionImages: anchor.optionImages } : {}) }), editDocument: record.document };
}
async function freshSource(owner: string, id: string, source: FreeImageSource, readOnlyRecovery = false) {
  if (source.workspaceTarget) throw new ImageTextError(400, '작업 사진은 상세 작업공간의 번역·보관 동작을 사용해주세요.');
  if (source.productId !== id) throw new ImageTextError(400, '번역한 상품과 저장할 상품이 다릅니다.');
  const current = await state(owner, id);
  if (current.product.updated_at !== source.productVersion || current.content.revision !== source.contentRevision) throw changed();
  const observed = source.additionalDraftTarget ? source.editorSource ? (await reopenedDraftSource(owner, id, source.editorSource.resultKey, current, source.additionalDraftTarget)).source : await draftOriginal(owner, id, source.sourceKey, current, source.additionalDraftTarget)
    : source.editorSource?.anchorPolicy === 'current-role-v1' ? (await reopenedRoleSource(owner, id, source.editorSource.resultKey, source.role, current)).source
    : source.editorSource ? (await reopenedSource(owner, id, source.editorSource.resultKey, source.role, current, source.quotationTarget!, source.editorSource.anchorPolicy === 'current-target-v1' ? 'current-target-v1' : undefined, readOnlyRecovery)).source
    : source.quotationTarget ? await quotationOriginal(owner, id, source.sourceKey, source.role, current, source.quotationTarget, readOnlyRecovery)
    : await original(owner, id, source.sourceKey, source.role, current, true, source.optionImages !== undefined);
  if (freeImageSourceIdentity(observed) !== freeImageSourceIdentity(source)) throw changed();
  return current;
}
async function freshVisionSource(owner:string,id:string,source:FreeImageSource,company:SupplierHubCompany,member:{email:string;role:string},signal:AbortSignal,proofs?:DetailWorkspaceImageProofs){
  if(!source.workspaceTarget){await freshSource(owner,id,source);return;}
  const {confirmWorkspaceImageSource}=await import('@/db/detail-workspace-image-edits');
  await confirmWorkspaceImageSource({owner,company,identity:member,id},source,signal,proofs);
}
async function storedOutput(key: string, source: FreeImageSource, optionImageIds: string[], sha256: string, size: number, crop?: FreeImageCrop, editDocument?: FreeImageEditDocument) {
  if (!env.FILES) throw new ImageTextError(503, '이미지 저장소가 연결되지 않았습니다.');
  const object = await env.FILES.get(key);
  if (!object) return false;
  const identity = freeImageSourceIdentity(source), ids = JSON.stringify(optionImageIds), metadata = object.customMetadata;
  const [sourceSha256, optionIdsSha256, cropSha256] = await Promise.all([digest(new TextEncoder().encode(identity)), digest(new TextEncoder().encode(ids)), crop ? digest(new TextEncoder().encode(JSON.stringify(crop))) : undefined]);
  const hashedScope = metadata?.freeImageSourceSha256 === sourceSha256 && metadata?.freeImageOptionIdsSha256 === optionIdsSha256 && metadata?.freeImageCropSha256 === cropSha256;
  // Step 584 stored the short, common-only source proof as plain JSON. Keep
  // those deterministic retries readable, but never infer selected option
  // scope from missing metadata or downgrade a damaged hash-based record.
  const legacyScope = crop === undefined && !source.quotationTarget && optionImageIds.length === 0 && metadata?.freeImageSource === identity && (metadata.freeImageOptionIds ?? '[]') === '[]'
    && metadata.freeImageSourceSha256 === undefined && metadata.freeImageOptionIdsSha256 === undefined && metadata.freeImageCropSha256 === undefined;
  if (object.size !== size || object.size > MAX_IMAGE_BYTES || object.httpMetadata?.contentType !== 'image/png'
    || metadata?.freeImageOutputSha256 !== sha256 || !hashedScope && !legacyScope
    || source.quotationTarget && !/^[a-f0-9]{64}$/.test(metadata?.freeImageQuotationOverridesSha256 ?? '')) throw new ImageTextError(409, '같은 이미지 결과 번호에 다른 파일이 저장되어 있습니다.');
  const bytes = await readBoundedStream(object.body, MAX_IMAGE_BYTES);
  if (bytes.length !== size || await digest(bytes) !== sha256) throw new ImageTextError(409, '저장한 이미지 결과의 내용이 다릅니다.');
  if (crop) {
    let dimensions;
    try { dimensions = inspectImage(bytes); } catch { throw new ImageTextError(409, '저장한 잘라내기 결과가 유효한 PNG가 아닙니다.'); }
    const expected = editDocument ? freeImageEditOutputDimensions(editDocument) : crop;
    if (dimensions.mime !== 'image/png' || dimensions.width !== expected.width || dimensions.height !== expected.height
      || metadata?.imageWidth !== String(expected.width) || metadata?.imageHeight !== String(expected.height)) throw new ImageTextError(409, '저장한 잘라내기 결과의 실제 크기와 선택 영역이 다릅니다.');
  }
  if (editDocument) {
    const saved = await readFreeImageEditRecord(env.FILES, source.sourceKey.split('/')[0], source.productId, key);
    if (JSON.stringify(saved.record.document) !== JSON.stringify(editDocument) || freeImageSourceIdentity(saved.record.source) !== freeImageSourceIdentity(source)
      || saved.record.result.sha256 !== sha256 || saved.record.result.bytes !== size
      || saved.record.format === 'free-image-role-edit-record-v1' && JSON.stringify(saved.record.optionImageIds) !== ids) throw changed();
    if (saved.record.format === 'free-image-role-edit-record-v1') {
      const owner = source.sourceKey.split('/')[0], current = await stableQuotationFieldsView(owner, source.productId, source.additionalDraftTarget?.profileId ?? null);
      if (JSON.stringify(saved.record.context) !== JSON.stringify(current.view.categoryContext)
        || JSON.stringify(saved.record.company) !== JSON.stringify(await editorCompany(owner))) throw changed();
    }
  }
  return true;
}
async function replay(owner: string, id: string, source: FreeImageSource, optionImageIds: string[], key: string, sha256: string, size: number, crop?: FreeImageCrop, editDocument?: FreeImageEditDocument) {
  if (source.additionalDraftTarget) return draftReplay(owner, id, source, key, sha256, size, crop, editDocument);
  if (source.quotationTarget) return quotationReplay(owner, id, source, key, sha256, size, crop, editDocument);
  const current = await state(owner, id);
  const role = current.content.assets[source.role].value;
  const optionOnly = source.optionImages?.commonAssigned === false;
  const previousKey = source.editorSource?.resultKey ?? source.sourceKey;
  if (!current.keys.includes(key) || !optionOnly && (!role.includes(key) || role.includes(previousKey))) return null;
  if (optionOnly && (!optionImageIds.length || current.content.revision < source.contentRevision)) return null;
  const observed = await original(owner, id, source.sourceKey, source.role, current, false);
  if (observed.sourceSha256 !== source.sourceSha256 || observed.width !== source.width || observed.height !== source.height) return null;
  const options = optionImageIds.length ? await readProductOptions(owner, id) : null;
  if (options && (options.revision < source.optionImages!.revision + 1 || optionImageIds.some(id => options.rows.filter(row => row.id === id && row.imageKey === key).length !== 1))) return null;
  if (!await storedOutput(key, source, optionImageIds, sha256, size, crop, editDocument)) return null;
  return response({ source, key, productVersion: current.product.updated_at, contentRevision: current.content.revision, applied: true, replayed: true,
    ...(options ? { optionRevision: options.revision, optionImageIds } : {}), ...(crop ? { crop } : {}),
    ...(editDocument ? { editDocumentSha256: await freeImageEditDigest(freeImageEditDocumentBytes(editDocument)) } : {}) });
}
async function quotationReplay(owner: string, id: string, source: FreeImageSource, key: string, sha256: string, size: number, crop?: FreeImageCrop, editDocument?: FreeImageEditDocument) {
  const target = source.quotationTarget!, current = await state(owner, id);
  if (!current.keys.includes(key)) return null;
  const saved = await stableQuotationFieldsView(owner, id, target.profileId), view = saved.view;
  if (view.revision !== target.revision + 1 || view.productVersion !== view.updatedAt || Date.parse(view.productVersion) <= Date.parse(source.productVersion)
    || view.contentRevision !== source.contentRevision || view.optionRevision !== target.optionRevision || !view.imageKeys.includes(key)
    || await quotationBinding(saved, target.input, key) !== target.bindingSha256) return null;
  const exact = exactPrimaryQuotationTarget(view.resolved.schema.fields, target.input), rows = view.resolved.rows.filter(row => row.optionId === target.optionId), value = quotationValue(source, key);
  if (exact.primary !== target.fieldKey || rows.length !== 1 || exact.linked.some(id => rows[0].fields[id]?.value !== value || view.overrides.options[target.optionId]?.[id] !== value)) return null;
  const observed = await original(owner, id, source.sourceKey, source.role, current, false, false, source.quotationTarget, source.editorSource);
  if (observed.sourceSha256 !== source.sourceSha256 || observed.width !== source.width || observed.height !== source.height || !await storedOutput(key, source, [], sha256, size, crop, editDocument)) return null;
  const stored = await env.FILES.get(key), overrideHash = await digest(new TextEncoder().encode(JSON.stringify(view.overrides)));
  if (stored?.customMetadata?.freeImageQuotationOverridesSha256 !== overrideHash) throw changed();
  return response({ source, key, productVersion: view.productVersion, contentRevision: view.contentRevision, optionRevision: view.optionRevision,
    quotationRevision: view.revision, quotationInputFingerprint: view.inputFingerprint, applied: true, replayed: true, ...(crop ? { crop } : {}),
    ...(editDocument ? { editDocumentSha256: await freeImageEditDigest(freeImageEditDocumentBytes(editDocument)) } : {}) });
}
function selectedCrop(value: unknown, source: FreeImageSource) {
  if (value === undefined) return undefined;
  try { return validateFreeImageCrop(value, source); }
  catch (error) { throw new ImageTextError(400, error instanceof Error ? error.message : '잘라낼 원본 영역을 확인해주세요.'); }
}
function selectedEditDocument(value: unknown, source: FreeImageSource, crop?: FreeImageCrop) {
  if (value === undefined) { if (source.editorSource) throw new ImageTextError(400, '다시 연 편집 원본에는 편집 문서가 필요합니다.'); return; }
  if (source.workspaceTarget || !source.quotationTarget && !['main', 'additional', 'detail'].includes(source.role)) throw new ImageTextError(400, '대표·추가·본문 이미지의 편집 문서를 선택해주세요.');
  try {
    const document = validateFreeImageEditDocument(value, source);
    if (JSON.stringify(document.crop) !== JSON.stringify(crop)) throw Error('편집 문서와 PNG 잘라내기 영역이 다릅니다.');
    return document;
  } catch (error) { throw new ImageTextError(400, error instanceof Error ? error.message : '편집 문서를 확인해주세요.'); }
}
function selectedOptionIds(value: unknown, source: FreeImageSource) {
  try { return validateFreeImageOptionIds(source, value); }
  catch (error) { throw new ImageTextError(400, error instanceof Error ? error.message : '같은 원본 대표 이미지에 연결된 옵션만 선택해주세요.'); }
}
function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new ImageTextError(400, '같은 사이트의 이미지 편집 화면에서 요청해주세요.');
}
const visionRequestId=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
type BatchAttempt=FreeImageVisionAttempt&{transport:'workers-ai-batch-v1'};
async function batchActor(owner:string,productId:string,request:Request){
 const company=await editorCompany(owner),configuration=imageVisionConfiguration(env as ImageVisionEnvironment);
 const memberNow=async()=>{const user=await getChatGPTUser(),member=user?.membership;if(!user?.verifiedAccess||user.userId!==owner||member?.id!==owner||member.status!=='approved'||member.email!==user.email||JSON.stringify(approvedSupplierHubCompany(member))!==JSON.stringify(company))throw changed();return{email:member.email.toLowerCase().trim(),role:member.role};};
 const member=await memberNow(),actor={owner,productId,company,member,model:configuration.model};
 const assertActor=async()=>{request.signal.throwIfAborted();if(await ownerId()!==owner||JSON.stringify(await memberNow())!==JSON.stringify(member)||JSON.stringify(imageVisionConfiguration(env as ImageVisionEnvironment))!==JSON.stringify(configuration))throw changed();};
 return{actor,configuration,assertActor};
}
async function batchScope(attempt:BatchAttempt,actor:ImageVisionBatchActor):Promise<ImageVisionBatchScope>{
 const {source,configuration,sourceLanguage,inspectionPolicy,textStyle}=attempt;
 if(textStyle&&JSON.stringify(await createImageTextStyle({addCopyright:textStyle.copywriting,translationPrompt:textStyle.guidance}))!==JSON.stringify(parseImageTextStyle(textStyle)))throw changed();
 return{...actor,requestId:attempt.requestId,productVersion:source.productVersion,contentRevision:source.contentRevision,
  fingerprint:await digest(new TextEncoder().encode(JSON.stringify({source:freeImageSourceIdentity(source),company:actor.company,member:actor.member,configuration,language:sourceLanguage,...(inspectionPolicy?{inspectionPolicy}:{}),...(textStyle?{textStyle}:{})}))),
  ...(textStyle?{textStyle}:{}),sourceScope:await digest(new TextEncoder().encode(JSON.stringify([source.sourceKey,source.sourceSha256,actor.company,configuration.model,sourceLanguage,...(inspectionPolicy?[inspectionPolicy]:[])]))),
  ...(inspectionPolicy?{inspection:{sourceKey:source.sourceKey,sourceSha256:source.sourceSha256,width:source.width,height:source.height,sourceLanguage,configuration}}:{})};
}
async function parsedBatch(row:ImageVisionBatchRow|null,actor:ImageVisionBatchActor,configuration:ReturnType<typeof imageVisionConfiguration>){
 if(!row)return null;
 if(typeof row.attempt!=='string'||new TextEncoder().encode(row.attempt).length>48*1024)throw changed();
 let raw:unknown;try{raw=JSON.parse(row.attempt);}catch{throw changed();}
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw changed();
 const value=raw as Record<string,unknown>;
 if(!['configuration,requestId,source,sourceLanguage,transport','configuration,inspectionPolicy,requestId,source,sourceLanguage,transport'].includes(Object.keys(value).filter(key=>key!=='textStyle').sort().join(','))
  ||value.textStyle!==undefined&&(!parseImageTextStyle(value.textStyle)||((value.source as FreeImageSource)?.role!=='detail'))
  ||value.transport!=='workers-ai-batch-v1'||!visionRequestId(value.requestId)||value.requestId!==row.request_id||!['zh','en'].includes(String(value.sourceLanguage))
  ||value.inspectionPolicy!==undefined&&!isImageTextInspectionPolicy(value.inspectionPolicy))throw changed();
 const source=validateFreeImageSource(value.source),storedConfiguration=parseImageTextVisionConfiguration(value.configuration);
 if(!storedConfiguration||source.productId!==actor.productId||!isOwnedImageKey(actor.owner,source.sourceKey))throw changed();
 if(JSON.stringify(storedConfiguration)!==JSON.stringify(configuration))return null;
 const attempt={...value,source,configuration:storedConfiguration} as BatchAttempt,scope=await batchScope(attempt,actor);
 if(row.request_fingerprint!==scope.fingerprint||row.source_scope!==scope.sourceScope||!['running','completed','failed','uncertain'].includes(row.status)
  ||row.failure!==null&&!/^[A-Z_]{1,32}$/.test(row.failure)||row.provider_request_id!==null&&!/^[A-Za-z0-9_-]{1,200}$/.test(row.provider_request_id))throw changed();
 let result=null;
 if(row.status==='completed'){
  let stored:unknown;try{stored=JSON.parse(row.result??'null');}catch{throw new ImageVisionError('BLOCKS');}
  result=readStoredImageVisionResult(stored,source.width,source.height);
  if(attempt.inspectionPolicy&&result.inspection?.policy!==attempt.inspectionPolicy)throw new ImageVisionError('DECISION');
 }
 return{row,attempt,scope,result};
}
function batchReply(value:Awaited<ReturnType<typeof parsedBatch>>,requests:0|1,readOnly:boolean){
 return{format:'yoofam-image-vision-batch-v1',attempt:value?.attempt??null,status:value?.row.status??'not-found',result:value?.result??null,failure:value?.row.failure??null,execution:{requests},readOnly};
}
async function createVisionBatch(scope:ImageVisionBatchScope,attempt:BatchAttempt,image:{bytes:Uint8Array},request:Request,assertCurrent:()=>Promise<void>){
 const ledger=await import('@/db/image-vision-requests'),batches=await import('@/db/image-vision-batches'),configuration=attempt.configuration;
 const read=async()=>parsedBatch(await batches.readImageVisionBatch(scope,scope.requestId),scope,configuration);
 const {assertActor}=await batchActor(scope.owner,scope.productId,request),claimed=await ledger.claimImageVisionRequest(scope);
 if(!claimed.claimed){const existing=await read();await assertActor();if(existing&&existing.scope.fingerprint===scope.fingerprint)return response(batchReply(existing,0,false),existing.row.status==='running'?202:200);
  if(claimed.record?.request_fingerprint===scope.fingerprint)return response({error:'원래 이미지 Vision 요청은 접수됐지만 보관 응답을 아직 확인하지 못했습니다. 원래 요청만 조회하고 새 추론을 보내지 않습니다.',code:'IMAGE_VISION_ACK_MISSING',uncertain:true},409);
  return response({error:'같은 원본의 이미지 Vision 요청이 진행 중이거나 응답을 확인하지 못했습니다. 자동 재요청하지 않습니다.',code:'IMAGE_VISION_NOT_ADMITTED',uncertain:false},409);}
 let invoked=false;
 try{
  await batches.storeImageVisionBatch(scope,attempt);
  const completed=await ledger.completedImageVisionResult(scope);
  if(completed){let saved:unknown;try{saved=JSON.parse(completed.result??'null');}catch{throw new ImageVisionError('BLOCKS');}
   const result=readStoredImageVisionResult(saved,attempt.source.width,attempt.source.height);
   if(attempt.inspectionPolicy&&result.inspection?.policy!==attempt.inspectionPolicy)throw new ImageVisionError('DECISION');
   if(!attempt.inspectionPolicy||result.blocks.length||result.inspection){await assertCurrent();await ledger.finishImageVisionRequest(scope,{status:'completed',result,requests:0});await assertActor();return response(batchReply(await read(),0,false));}
  }
  await assertCurrent();invoked=true;
  const job=await submitImageVisionBatch(image.bytes,attempt.source,attempt.sourceLanguage,env as ImageVisionEnvironment,request.signal,attempt.inspectionPolicy,attempt.textStyle);
  await batches.saveImageVisionBatchProvider(scope,job.providerRequestId);
  await assertActor();return response(batchReply(await read(),1,false),202);
 }catch(error){
  const uncertain=invoked&&(!(error instanceof ImageVisionError)||error.uncertain),failure=error instanceof ImageVisionError?error.reason:invoked?'PROVIDER':'BEFORE_CALL';
  const beforeDispatch=error instanceof ImageVisionError&&!error.uncertain&&['INPUT','NOT_CONFIGURED','ABORTED'].includes(error.reason),requests=invoked&&!beforeDispatch?1:0;
  await ledger.finishImageVisionRequest(scope,{status:uncertain?'uncertain':'failed',failure,requests}).catch(()=>{/* The original claim continues fencing retries. */});
  if(uncertain)await batches.markImageVisionBatchUncertain(scope,failure).catch(()=>{/* Never submit again after a lost acknowledgement. */});
  await assertActor();const observed=await read();if(observed)return response(batchReply(observed,requests,false),uncertain?202:200);throw error;
 }
}
async function pollVisionBatch(owner:string,productId:string,request:Request,requestId:string){
 const {actor,configuration,assertActor}=await batchActor(owner,productId,request),batches=await import('@/db/image-vision-batches');
 const read=async()=>parsedBatch(await batches.readImageVisionBatch(actor,requestId),actor,configuration);
 let current=await read();await assertActor();
 if(!current||['completed','failed'].includes(current.row.status)||!current.row.provider_request_id)return response(batchReply(current,0,false));
 const ledger=await import('@/db/image-vision-requests'),{scope,attempt}=current;
 try{
  const observed=await pollImageVisionBatch(current.row.provider_request_id,attempt.source,env as ImageVisionEnvironment,request.signal,attempt.inspectionPolicy);
  await assertActor();
  if(observed.status==='completed'){
   const result=readStoredImageVisionResult(observed.result,attempt.source.width,attempt.source.height);
   if(attempt.inspectionPolicy&&result.inspection?.policy!==attempt.inspectionPolicy)throw new ImageVisionError('DECISION');
   await ledger.finishLateImageVisionRequest(scope,{status:'completed',result});
  }else if(observed.status==='failed')await ledger.finishLateImageVisionRequest(scope,{status:'failed',failure:observed.failure});
 }catch(error){
  const failure=error instanceof ImageVisionError?error.reason:'PROVIDER';
  await ledger.finishImageVisionRequest(scope,{status:'uncertain',failure,requests:1}).catch(()=>{/* An uncertain original is settled only by its saved provider job. */});
  await batches.markImageVisionBatchUncertain(scope,failure).catch(()=>{/* Preserve its provider ID and admission fence. */});
 }
 await assertActor();current=await read();await assertActor();return response(batchReply(current,0,false));
}
function fail(error: unknown) {
  if(error instanceof ImageTextStyleNotAdmitted)return response({error:error.message,code:'IMAGE_VISION_NOT_ADMITTED',uncertain:false},409);
  if(error instanceof ImageVisionError)return response({error:error.message,code:`IMAGE_VISION_${error.reason}`,uncertain:error.uncertain},error.reason==='NOT_CONFIGURED'?503:error.reason==='CAPACITY'?429:409);
  if (error instanceof FreeImageEditRecordError) return response({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
  if (error instanceof ImageTextError || error instanceof RequestBodyError) return response({ error: error.message }, error.status);
  if (error instanceof QuotationFieldsSnapshotError || error instanceof PublicDetailError || error instanceof DetailWorkspaceError) return response({ error: error.message }, error.status);
  return response({ error: '이미지 문구 처리 결과를 확인하지 못했습니다. 기존 이미지는 유지됩니다. 저장본을 확인한 뒤 다시 시도해주세요.' }, 503);
}
export async function GET(request: Request, context: Context) {
  try {
    const owner = await ownerId(), { id } = await context.params, params = new URL(request.url).searchParams;
    if(params.has('visionBatchRequestId')||params.has('visionBatchSource')){
      sameOrigin(request);
      const discovery=params.has('visionBatchSource'),allowed=discovery?['visionBatchSource','sourceLanguage','inspectionPolicy']:['visionBatchRequestId'];
      if(request.url.length>65536||[...params.keys()].some(key=>!allowed.includes(key)||params.getAll(key).length!==1)
        ||discovery&&(!['zh','en'].includes(params.get('sourceLanguage')??'')||params.has('inspectionPolicy')&&!isImageTextInspectionPolicy(params.get('inspectionPolicy')))
        ||!discovery&&!visionRequestId(params.get('visionBatchRequestId')))throw new ImageTextError(400,'조회할 원래 이미지 Vision 배치 요청을 확인해주세요.');
      const {actor,configuration,assertActor}=await batchActor(owner,id,request),batches=await import('@/db/image-vision-batches');
      let row:ImageVisionBatchRow|null;
      let selected:FreeImageSource|undefined;
      if(discovery){let raw:unknown;try{raw=JSON.parse(params.get('visionBatchSource')!);}catch{throw new ImageTextError(400,'원래 이미지 Vision 원본 정보를 확인해주세요.');}
        selected=validateFreeImageSource(raw);if(selected.productId!==id||!isOwnedImageKey(owner,selected.sourceKey))throw new ImageTextError(400,'이 상품의 본인 소유 Vision 기록만 조회할 수 있습니다.');
        const sourceScope=await digest(new TextEncoder().encode(JSON.stringify([selected.sourceKey,selected.sourceSha256,actor.company,configuration.model,params.get('sourceLanguage'),...(params.has('inspectionPolicy')?[params.get('inspectionPolicy')]:[])])));
        row=await batches.findPendingImageVisionBatch(actor,sourceScope);
      }else row=await batches.readImageVisionBatch(actor,params.get('visionBatchRequestId')!);
      const observed=await parsedBatch(row,actor,configuration);await assertActor();
      const matches=!selected||observed?.attempt.source.sourceKey===selected.sourceKey&&observed.attempt.source.sourceSha256===selected.sourceSha256&&observed.attempt.source.width===selected.width&&observed.attempt.source.height===selected.height;
      return response(batchReply(matches?observed:null,0,true));
    }
    if(params.has('visionRequestId')){
      sameOrigin(request);
      if(request.url.length>65536||[...params.keys()].some(key=>!['visionRequestId','source','sourceLanguage','inspectionPolicy'].includes(key)||params.getAll(key).length!==1)
        ||params.has('inspectionPolicy')&&!isImageTextInspectionPolicy(params.get('inspectionPolicy'))
        ||!['zh','en'].includes(params.get('sourceLanguage')??'')||!params.has('source')
        ||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.get('visionRequestId')??''))throw new ImageTextError(400,'조회할 원래 이미지 Vision 요청을 확인해주세요.');
      let raw:unknown;try{raw=JSON.parse(params.get('source')!);}catch{throw new ImageTextError(400,'원래 이미지 Vision 원본 정보를 확인해주세요.');}
      const source=validateFreeImageSource(raw),configuration=imageVisionConfiguration(env as ImageVisionEnvironment),sourceLanguage=params.get('sourceLanguage') as 'zh'|'en',company=await editorCompany(owner);
      // Observe the original request even after its workspace revision changes.
      if(source.productId!==id||!isOwnedImageKey(owner,source.sourceKey))throw new ImageTextError(400,'이 상품의 본인 소유 Vision 기록만 조회할 수 있습니다.');
      const memberNow=async()=>{const user=await getChatGPTUser(),member=user?.membership;if(!user?.verifiedAccess||user.userId!==owner||member?.id!==owner||member.status!=='approved'||member.email!==user.email||JSON.stringify(approvedSupplierHubCompany(member))!==JSON.stringify(company))throw changed();return{email:member.email.toLowerCase().trim(),role:member.role};};
      const member=await memberNow(),requestId=params.get('visionRequestId')!;
      const inspectionPolicy=params.has('inspectionPolicy')?params.get('inspectionPolicy') as ImageTextInspectionPolicy:undefined;
      const scope={owner,productId:id,requestId,company,member,model:configuration.model,productVersion:source.productVersion,contentRevision:source.contentRevision,
        fingerprint:await digest(new TextEncoder().encode(JSON.stringify({source:freeImageSourceIdentity(source),company,member,configuration,language:sourceLanguage,...(inspectionPolicy?{inspectionPolicy}:{})}))),
        sourceScope:await digest(new TextEncoder().encode(JSON.stringify([source.sourceKey,source.sourceSha256,company,configuration.model,sourceLanguage,...(inspectionPolicy?[inspectionPolicy]:[])])))};
      const {readImageVisionRequest}=await import('@/db/image-vision-requests'),record=await readImageVisionRequest(scope);
      request.signal.throwIfAborted();if(await ownerId()!==owner||JSON.stringify(await memberNow())!==JSON.stringify(member)||JSON.stringify(imageVisionConfiguration(env as ImageVisionEnvironment))!==JSON.stringify(configuration))throw changed();
      if(record&&(!['running','completed','failed','uncertain'].includes(record.status)||record.request_fingerprint!==scope.fingerprint
        ||record.failure!==null&&!/^[A-Z_]{1,32}$/.test(record.failure)))throw new ImageTextError(409,'원래 이미지 Vision 기록의 상태를 확인하지 못했습니다.');
      let result=null;
      if(record?.status==='completed'){
        let stored:unknown;try{stored=JSON.parse(record.result??'null');}catch{throw new ImageVisionError('BLOCKS');}
        result=readStoredImageVisionResult(stored,source.width,source.height);
        if(inspectionPolicy&&result.inspection?.policy!==inspectionPolicy)throw new ImageVisionError('DECISION');
      }
      return response({format:'yoofam-image-vision-status-v1',source,configuration,sourceLanguage,requestId,status:record?.status??'not-found',result,failure:record?.failure??null,execution:{requests:0},readOnly:true});
    }
    if (params.get('list') === 'sources') {
      if ([...params.keys()].some(key => !['list', 'role'].includes(key) || params.getAll(key).length !== 1)
        || !validFreeImageRole(params.get('role')) || params.get('role') === 'label') throw new ImageTextError(400, '조회할 이미지 역할을 선택해주세요.');
      const current = await state(owner, id), role = params.get('role') as FreeImageSource['role'];
      const options = role === 'main' ? await readProductOptions(owner, id) : null;
      const assigned = new Set([...current.content.assets[role].value, ...(options?.rows.flatMap(row => row.imageKey ? [row.imageKey] : []) ?? [])]);
      const keys = current.keys.filter(key => isOwnedImageKey(owner, key) && assigned.has(key));
      const latest = await state(owner, id);
      if (latest.product.updated_at !== current.product.updated_at || latest.content.revision !== current.content.revision
        || options && (await readProductOptions(owner, id)).revision !== options.revision) throw changed();
      return response({ productId: id, productVersion: current.product.updated_at, contentRevision: current.content.revision, role, keys });
    }
    const draft = params.get('target') === 'additional-draft';
    const quotation = params.get('target') === 'quotation';
    const allowed = draft ? ['sourceKey', 'role', 'target', 'profileId', 'optionId', 'editor'] : quotation ? ['sourceKey', 'role', 'target', 'profileId', 'optionId', 'fieldKey', 'slotIndex', 'editor'] : ['sourceKey', 'role', 'editor'];
    if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1) || params.getAll('sourceKey').length !== 1 || params.getAll('role').length !== 1
      || !validFreeImageRole(params.get('role')) || params.get('role') === 'label' && !quotation
      || params.has('editor') && !(draft ? ['saved-current-pool-v1'] : quotation ? ['saved', 'saved-current-target-v1'] : ['saved-current-role-v1']).includes(params.get('editor')!)) throw new ImageTextError(400, '원본 이미지와 역할을 선택해주세요.');
    const current = await state(owner, id), role = params.get('role') as FreeImageSource['role'];
    let selection: QuotationSelection | undefined;
    if (quotation) {
      const profileId = params.get('profileId'), optionId = params.get('optionId'), fieldKey = params.get('fieldKey'), slotIndex = params.get('slotIndex');
      if (!['main', 'additional', 'detail', 'label'].includes(role) || profileId !== null && !/^[A-Za-z0-9_-]{1,100}$/.test(profileId)
        || !optionId || !/^[A-Za-z0-9_-]{1,80}$/.test(optionId) || !fieldKey || !/^[A-Za-z0-9_-]{1,100}$/.test(fieldKey)
        || slotIndex === null || !/^(?:0|[1-9][0-9]?)$/.test(slotIndex) || Number(slotIndex) > 29 || role === 'main' && Number(slotIndex) !== 0) throw new ImageTextError(400, '최종 견적 이미지의 옵션과 선택 위치를 확인해주세요.');
      selection = { profileId, optionId, fieldKey, slotIndex: Number(slotIndex), input: role === 'main' ? 'mainImage' : role === 'additional' ? 'additionalImages' : role === 'label' ? 'labelImages' : 'detailImages' };
    }
    const draftSelection = { profileId: params.get('profileId'), optionId: params.get('optionId') };
    if (draft && (role !== 'additional' || draftSelection.profileId !== null && !/^[A-Za-z0-9_-]{1,100}$/.test(draftSelection.profileId) || draftSelection.optionId !== null && !/^[A-Za-z0-9_-]{1,80}$/.test(draftSelection.optionId))) throw changed();
    const editor = params.has('editor') ? draft ? await reopenedDraftSource(owner, id, params.get('sourceKey')!, current, draftSelection) : selection ? await reopenedSource(owner, id, params.get('sourceKey')!, role, current, selection,
      params.get('editor') === 'saved-current-target-v1' ? 'current-target-v1' : undefined)
      : await reopenedRoleSource(owner, id, params.get('sourceKey')!, role, current) : undefined;
    const source = editor?.source ?? (draft ? await draftOriginal(owner, id, params.get('sourceKey')!, current, draftSelection) : selection ? await quotationOriginal(owner, id, params.get('sourceKey')!, role, current, selection)
      : await original(owner, id, params.get('sourceKey')!, role, current, true, true));
    // Never return a snapshot whose source/version changed while R2 was read.
    await freshSource(owner, id, source);
    const configuration=imageVisionConfiguration(env as ImageVisionEnvironment);
    const {readImageNoTextReceipts}=await import('@/db/image-no-text-receipts');
    const noTextProof=(await readImageNoTextReceipts(owner,[current.product]))[id]?.find(proof=>proof.sourceKey===source.sourceKey&&proof.sourceSha256===source.sourceSha256&&proof.width===source.width&&proof.height===source.height&&proof.sourceLanguage==='zh');
    await freshSource(owner,id,source);
    return response({ source, visionConfiguration:configuration, visionTransport:'workers-ai-batch-v1', ...(noTextProof?noTextProof.reason==='product-markings-only'?{preservationProof:noTextProof}:{noTextProof}:{}), ...(editor ? { editDocument: editor.editDocument } : {}) });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const owner = await ownerId(), { id } = await context.params;
    sameOrigin(request);
    const type = request.headers.get('content-type') ?? '';
    if (type.split(';')[0].trim().toLowerCase() === 'application/json') {
      const bytes = await readBoundedBytes(request, 96 * 1024 + MAX_FREE_IMAGE_EDIT_BYTES);
      let body: unknown;
      try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { throw new RequestBodyError(bytes.length > 96 * 1024 ? 413 : 400, '올바른 크기의 JSON 객체가 필요합니다.'); }
      if (bytes.length > 96 * 1024 && (!body || typeof body !== 'object' || Array.isArray(body)
        || (body as Record<string, unknown>).action !== 'recover' || (body as Record<string, unknown>).editDocument === undefined)) throw new RequestBodyError(413, '편집 문서가 없는 요청은 96KiB 이하이어야 합니다.');
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ImageTextError(400, '번역할 문구를 확인해주세요.');
      const input = body as Record<string, unknown>;
      if(input.action==='vision-batch-poll'){
        if(request.headers.get('origin')!==new URL(request.url).origin||Object.keys(input).sort().join(',')!=='action,requestId'||!visionRequestId(input.requestId))throw new ImageTextError(400,'조회할 원래 이미지 Vision 배치 요청을 확인해주세요.');
        return await pollVisionBatch(owner,id,request,input.requestId);
      }
      if(input.action==='vision'||input.action==='vision-batch'){
        if(request.headers.get('origin')!==new URL(request.url).origin)throw new ImageTextError(400,'현재 서비스 화면에서 이미지 Vision을 실행해주세요.');
        const visionKeys=input.action==='vision-batch'?['action,configuration,requestId,source,sourceLanguage,transport','action,configuration,inspectionPolicy,requestId,source,sourceLanguage,transport']:['action,configuration,requestId,source,sourceLanguage','action,configuration,inspectionPolicy,requestId,source,sourceLanguage'];
        if(!visionKeys.includes(Object.keys(input).filter(key=>key!=='textStyle').sort().join(','))||input.textStyle!==undefined&&input.action!=='vision-batch'||input.action==='vision-batch'&&input.transport!=='workers-ai-batch-v1'
          ||input.inspectionPolicy!==undefined&&!isImageTextInspectionPolicy(input.inspectionPolicy)||typeof input.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)||!['zh','en'].includes(String(input.sourceLanguage)))throw new ImageTextError(400,'이미지 Vision 요청과 중복 방지 번호를 확인해주세요.');
        const inspectionPolicy=input.inspectionPolicy as ImageTextInspectionPolicy|undefined;
        const source=validateFreeImageSource(input.source),settings=env as ImageVisionEnvironment,configuration=imageVisionConfiguration(settings),expected=parseImageTextVisionConfiguration(input.configuration);
        if(!expected||JSON.stringify(expected)!==JSON.stringify(configuration))throw changed();
        if(!configuration.configured)throw new ImageVisionError('NOT_CONFIGURED');
        if(source.productId!==id||!isOwnedImageKey(owner,source.sourceKey))throw new ImageTextError(400,'이 상품의 본인 소유 원본만 Vision으로 읽을 수 있습니다.');
        const textStyle=input.textStyle===undefined?undefined:parseImageTextStyle(input.textStyle);
        const currentTextStyle=async()=>{const stored=await getSettings(owner);return createImageTextStyle(savedRegistrationSettings(stored?JSON.parse(stored.payload):null));};
        const assertTextStyle=async()=>{if(input.textStyle!==undefined&&(!textStyle||source.role!=='detail'||JSON.stringify(await currentTextStyle())!==JSON.stringify(textStyle)))throw new ImageTextStyleNotAdmitted(409,'저장된 본문 이미지 번역 지침이 변경되었습니다. 현재 설정으로 다시 확인해주세요.');};
        await assertTextStyle();
        const company=await editorCompany(owner);
        const currentMember=async()=>{const user=await getChatGPTUser(),member=user?.membership;if(!user?.verifiedAccess||user.userId!==owner||member?.id!==owner||member.status!=='approved'||member.email!==user.email||JSON.stringify(approvedSupplierHubCompany(member))!==JSON.stringify(company))throw changed();return{email:member.email.toLowerCase().trim(),role:member.role};};
        const member=await currentMember(),proofs=source.workspaceTarget?(await import('@/db/detail-workspaces')).createDetailWorkspaceImageProofs():undefined;
        const assertCurrent=async()=>{request.signal.throwIfAborted();await assertTextStyle();if(await ownerId()!==owner||JSON.stringify(await currentMember())!==JSON.stringify(member)||JSON.stringify(imageVisionConfiguration(settings))!==JSON.stringify(configuration))throw changed();await freshVisionSource(owner,id,source,company,member,request.signal,proofs);request.signal.throwIfAborted();if(await ownerId()!==owner||JSON.stringify(await currentMember())!==JSON.stringify(member)||JSON.stringify(imageVisionConfiguration(settings))!==JSON.stringify(configuration))throw changed();};
        await assertCurrent();
        const image=await readImage(source.sourceKey);
        if(await digest(image.bytes)!==source.sourceSha256||image.dimensions.width!==source.width||image.dimensions.height!==source.height)throw changed();
        await assertCurrent();
        const sourceKeys=collectedVisionAliases(owner,source,image.dimensions.mime);
        const scope={owner,productId:id,requestId:input.requestId,company,member,model:configuration.model,productVersion:source.productVersion,contentRevision:source.contentRevision,
          fingerprint:await digest(new TextEncoder().encode(JSON.stringify({source:freeImageSourceIdentity(source),company,member,configuration,language:input.sourceLanguage,...(inspectionPolicy?{inspectionPolicy}:{}),...(textStyle?{textStyle}:{})}))),
          ...(textStyle?{textStyle}:{}),
          sourceScope:await digest(new TextEncoder().encode(JSON.stringify([source.sourceKey,source.sourceSha256,company,configuration.model,input.sourceLanguage,...(inspectionPolicy?[inspectionPolicy]:[])]))),
          legacySourceScope:await digest(new TextEncoder().encode(JSON.stringify([source.sourceKey,source.sourceSha256,company,configuration.model,input.sourceLanguage,...(inspectionPolicy?[]:[IMAGE_TEXT_INSPECTION_POLICY])]))),
          sourceScopes:await Promise.all(sourceKeys.flatMap(key=>[undefined,IMAGE_TEXT_INSPECTION_POLICY,IMAGE_TEXT_PRESERVATION_POLICY].map(policy=>digest(new TextEncoder().encode(JSON.stringify([key,source.sourceSha256,company,configuration.model,input.sourceLanguage,...(policy?[policy]:[])])))))),
          completedSourceScopes:await Promise.all(sourceKeys.map(key=>digest(new TextEncoder().encode(JSON.stringify([key,source.sourceSha256,company,configuration.model,input.sourceLanguage,...(inspectionPolicy?[inspectionPolicy]:[])]))))),
          ...(inspectionPolicy?{inspection:{sourceKey:source.sourceKey,sourceSha256:source.sourceSha256,width:source.width,height:source.height,sourceLanguage:input.sourceLanguage as 'zh'|'en',configuration}}:{})};
        if(input.action==='vision-batch')return await createVisionBatch(scope,{requestId:scope.requestId,source,sourceLanguage:input.sourceLanguage as 'zh'|'en',configuration,...(inspectionPolicy?{inspectionPolicy}:{}),...(textStyle?{textStyle}:{}),transport:'workers-ai-batch-v1'},image,request,assertCurrent);
        const {claimImageVisionRequest,finishImageVisionRequest,completedImageVisionResult,finishLateImageVisionRequest}=await import('@/db/image-vision-requests');
        const claimed=await claimImageVisionRequest(scope);
        if(!claimed.claimed){
          if(claimed.record?.request_fingerprint!==scope.fingerprint)return response({error:'같은 원본의 이미지 Vision 요청이 진행 중이거나 응답을 확인하지 못했습니다. 자동 재요청하지 않습니다.',code:'IMAGE_VISION_NOT_ADMITTED',uncertain:false},409);
          if(claimed.record.status!=='completed')throw new ImageTextError(409,'이 이미지 Vision 요청은 이미 실행됐거나 응답이 불명확합니다. 자동 재요청하지 않습니다.');
          let saved:unknown;try{saved=JSON.parse(claimed.record.result??'null');}catch{throw new ImageVisionError('BLOCKS');}
          const result=readStoredImageVisionResult(saved,source.width,source.height);
          if(inspectionPolicy&&result.inspection?.policy!==inspectionPolicy)throw new ImageVisionError('DECISION');
          await assertCurrent();return response({source,configuration,requestId:scope.requestId,result,replayed:true,execution:{requests:0,cached:true}});
        }
        let invoked=false;
        try{
          const completed=await completedImageVisionResult(scope);
          if(completed){
            let saved:unknown;try{saved=JSON.parse(completed.result??'null');}catch{throw new ImageVisionError('BLOCKS');}
            const result=readStoredImageVisionResult(saved,source.width,source.height);
          if(inspectionPolicy&&result.inspection?.policy!==inspectionPolicy)throw new ImageVisionError('DECISION');
            // Legacy empty output also meant unreadable text. It cannot prove
            // a no-op under the explicit inspection contract.
            if(!inspectionPolicy||result.blocks.length||result.inspection){
             await assertCurrent();await finishImageVisionRequest(scope,{status:'completed',result,requests:0});await assertCurrent();
             return response({source,configuration,requestId:scope.requestId,result,replayed:false,execution:{requests:0,cached:true}});
            }
          }
          await assertCurrent();invoked=true;
          const result=await readImageVision(image.bytes,source,input.sourceLanguage as 'zh'|'en',settings,request.signal,inspectionPolicy);
          await assertCurrent();
          await finishImageVisionRequest(scope,{status:'completed',result,requests:1});
          await assertCurrent();return response({source,configuration,requestId:scope.requestId,result,replayed:false,execution:{requests:1,cached:false}});
        }catch(error){
          // Create the foreground ledger write only once. The background
          // observer waits for it, so it cannot be overwritten by TIMEOUT.
          const finished=finishImageVisionRequest(scope,{status:error instanceof ImageVisionError?(error.uncertain?'uncertain':'failed'):invoked?'uncertain':'failed',failure:error instanceof ImageVisionError?error.reason:invoked?'CURRENT_CHANGED':'BEFORE_CALL',requests:invoked?1:0}).catch(()=>{/* A retained running row also fences retries. */});
          if(invoked&&error instanceof ImageVisionError&&error.lateResult&&typeof waitUntil==='function'){
            const original=error.lateResult;
            let admit:(accepted:boolean)=>void=()=>{};
            const admitted=new Promise<boolean>(resolve=>{admit=resolve;});
            const observation=(async()=>{
              if(!await admitted)return;
              await finished;
              try{const result=await original;await finishLateImageVisionRequest(scope,{status:'completed',result});}
              catch(late){
                // A transport rejection remains uncertain. Only a completed
                // but invalid provider result is a confirmed semantic failure.
                if(late instanceof ImageVisionError&&!late.uncertain)await finishLateImageVisionRequest(scope,{status:'failed',failure:late.reason});
              }
            })().catch(()=>{/* Keep the original fenced request if observation fails. */});
            try{waitUntil(observation);admit(true);}catch{admit(false);/* Keep uncertain when background support is unavailable. */}
          }
          await finished;
          throw error;
        }
      }
      if (input.action === 'recover') {
        if (Object.keys(input).some(key => !['action', 'source', 'outputSha256', 'outputBytes', 'crop', 'editDocument', 'optionImageIds'].includes(key)) || typeof input.outputSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.outputSha256)
          || !Number.isSafeInteger(input.outputBytes) || (input.outputBytes as number) < 1 || (input.outputBytes as number) > MAX_IMAGE_BYTES) throw new ImageTextError(400, '복구할 PNG 결과 번호와 크기를 확인해주세요.');
        let source: FreeImageSource;
        try { source = validateFreeImageSource(input.source); } catch { throw new ImageTextError(400, '복구할 원본 정보를 확인해주세요.'); }
        if (source.workspaceTarget || !source.quotationTarget && input.editDocument === undefined || source.productId !== id || !isOwnedImageKey(owner, source.sourceKey)) throw new ImageTextError(400, '이 상품의 편집 이미지 복구 범위를 확인해주세요.');
        const crop = selectedCrop(input.crop, source);
        const editDocument = selectedEditDocument(input.editDocument, source, crop), editDocumentSha256 = editDocument ? await freeImageEditDigest(freeImageEditDocumentBytes(editDocument)) : undefined;
        if (source.quotationTarget && input.optionImageIds !== undefined) throw new ImageTextError(400, '최종 견적 이미지 복구에는 개별 옵션 선택을 추가할 수 없습니다.');
        const ids = selectedOptionIds(input.optionImageIds ?? [], source);
        const identity = !source.quotationTarget && editDocumentSha256 ? freeImageRoleEditApplyIdentity(source, ids, crop, editDocumentSha256) : freeImageApplyIdentity(source, ids, crop, editDocumentSha256);
        const fingerprint = await digest(new TextEncoder().encode(identity)), key = `${owner}/free-image-${id}-${fingerprint}-${input.outputSha256}.png`;
        const recovered = await replay(owner, id, source, ids, key, input.outputSha256, input.outputBytes as number, crop, editDocument);
        if (recovered) return recovered;
        // Checking an old outcome is read-only. It must not mint a new edit
        // target or make a protected settings image eligible for another save.
        await freshSource(owner, id, source, true);
        await storedOutput(key, source, ids, input.outputSha256, input.outputBytes as number, crop, editDocument);
        return response({ source, key, applied: false, ...(crop ? { crop } : {}), ...(editDocumentSha256 ? { editDocumentSha256 } : {}) });
      }
      if (Object.keys(input).some(key => !['action', 'source', 'sourceLanguage', 'regions'].includes(key)) || input.action !== 'translate' || !['zh', 'en'].includes(String(input.sourceLanguage))) throw new ImageTextError(400, '이미지 문구 번역 요청을 확인해주세요.');
      let source: FreeImageSource, regions;
      try { source = validateFreeImageSource(input.source); regions = validateImageTextRegions(input.regions); }
      catch (error) { throw new ImageTextError(400, error instanceof Error ? error.message : '이미지 문구를 확인해주세요.'); }
      await freshSource(owner, id, source);
      const settings=env as ImageTextRecoveryEnvironment,company=imageTextRecoveryConfigured(settings)?await editorCompany(owner):null;
      const assertCurrent=async()=>{request.signal.throwIfAborted();if(await getWorkspaceOwnerId()!==owner||JSON.stringify(await editorCompany(owner))!==JSON.stringify(company))throw changed();await freshSource(owner,id,source);request.signal.throwIfAborted();if(await getWorkspaceOwnerId()!==owner||JSON.stringify(await editorCompany(owner))!==JSON.stringify(company))throw changed();};
      const translated = await translateImageRegions(regions, input.sourceLanguage as 'zh' | 'en', undefined, request.signal, company?async(rows,language,signal)=>{
        await assertCurrent();
        if(!imageTextRecoveryWithinLimit(rows))return unavailableImageTextRecovery(rows,'input-limit',0,'무료 AI 번역은 한 번에 30개 영역·5000자 이하입니다. 영역을 나누어 선택해주세요.');
        const {reserveQuotationAiRequest}=await import('@/db/quotation-ai-jobs');
        if(!await reserveQuotationAiRequest())return unavailableImageTextRecovery(rows,'limited',0,'오늘의 무료 AI 공유 요청 한도에 도달했습니다. 원문과 받은 결과를 유지했습니다.');
        await assertCurrent();
        try{const result=await recoverImageTextRegions(rows,language,settings,signal);await assertCurrent();return result;}
        catch(error){await assertCurrent();if(error instanceof ImageTextRecoveryError)return unavailableImageTextRecovery(rows,error.status,1,error.message);throw error;}
      }:undefined);
      await freshSource(owner, id, source);
      if(company)await assertCurrent();
      return response({ source, ...translated });
    }
    if (!/^multipart\/form-data(?:\s*;|$)/i.test(type)) throw new ImageTextError(400, '이미지 저장은 PNG 파일을 multipart 형식으로 요청해주세요.');
    const body = await readBoundedBytes(request, MAX_IMAGE_MULTIPART_BYTES + MAX_FREE_IMAGE_EDIT_BYTES);
    let form: FormData;
    try { form = await new Response(body.buffer as ArrayBuffer, { headers: { 'content-type': type } }).formData(); }
    catch { throw new ImageTextError(400, '이미지 파일 요청을 읽지 못했습니다.'); }
    if ([...form.keys()].some(key => !['action', 'source', 'file', 'optionImageIds', 'crop', 'editDocument'].includes(key)) || ['action', 'source', 'file'].some(key => form.getAll(key).length !== 1)
      || form.getAll('optionImageIds').length > 1
      || form.getAll('crop').length > 1
      || form.getAll('editDocument').length > 1
      || form.get('action') !== 'apply' || typeof form.get('source') !== 'string') throw new ImageTextError(400, 'PNG 결과 한 개와 원본 정보를 전달해주세요.');
    let source: FreeImageSource;
    try { const value = form.get('source') as string; if (value.length > 32768) throw Error('원본 정보가 너무 큽니다.'); source = validateFreeImageSource(JSON.parse(value)); }
    catch (error) { throw new ImageTextError(400, error instanceof Error ? error.message : '원본 정보를 확인해주세요.'); }
    if (source.productId !== id || !isOwnedImageKey(owner, source.sourceKey)) throw new ImageTextError(400, '상품·이미지 소유자를 확인해주세요.');
    let crop: FreeImageCrop | undefined;
    try {
      const value = form.get('crop');
      if (value !== null && (typeof value !== 'string' || value.length > 1024)) throw Error('잘라낼 영역의 입력 형식을 확인해주세요.');
      crop = selectedCrop(value === null ? undefined : JSON.parse(value as string), source);
    } catch (error) { if (error instanceof ImageTextError) throw error; throw new ImageTextError(400, '잘라낼 영역의 입력 형식을 확인해주세요.'); }
    let editDocument: FreeImageEditDocument | undefined;
    try {
      const value = form.get('editDocument');
      if (value !== null && (typeof value !== 'string' || new TextEncoder().encode(value).length > MAX_FREE_IMAGE_EDIT_BYTES)) throw Error('편집 문서 크기를 확인해주세요.');
      editDocument = selectedEditDocument(value === null ? undefined : JSON.parse(value as string), source, crop);
    } catch (error) { if (error instanceof ImageTextError) throw error; throw new ImageTextError(400, '편집 문서 형식을 확인해주세요.'); }
    if (source.workspaceTarget) throw changed();
    let optionImageIds: string[];
    try {
      const value = form.get('optionImageIds');
      if (value !== null && (typeof value !== 'string' || value.length > 20000)) throw new ImageTextError(400, '옵션 대표 이미지 선택을 확인해주세요.');
      optionImageIds = selectedOptionIds(value === null ? [] : JSON.parse(value as string), source);
    } catch (error) { if (error instanceof ImageTextError) throw error; throw new ImageTextError(400, '옵션 대표 이미지 선택 형식을 확인해주세요.'); }
    const optionOnly = source.optionImages?.commonAssigned === false;
    if (optionOnly && !optionImageIds.length) throw new ImageTextError(400, '옵션 전용 원본은 적용할 옵션 대표 이미지를 한 개 이상 선택해주세요.');
    const file = form.get('file');
    if (!(file instanceof File) || file.size < 1) throw new ImageTextError(400, '내용이 있는 PNG 결과 파일이 필요합니다.');
    if (file.size > MAX_IMAGE_BYTES) throw new ImageTextError(413, '이미지 한 장은 10MB 이하여야 합니다.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let dimensions;
    try { dimensions = inspectImage(bytes); } catch { throw new ImageTextError(415, '유효한 PNG 결과가 필요합니다.'); }
    if (dimensions.mime !== 'image/png' || file.type !== 'image/png') throw new ImageTextError(415, 'PNG 결과만 저장할 수 있습니다.');
    if (dimensions.width * dimensions.height > MAX_OCR_PIXELS) throw new ImageTextError(413, '번역 결과는 1,200만 픽셀 이하이어야 합니다.');
    const same = dimensions.width === source.width && dimensions.height === source.height;
    const rotated = dimensions.width === source.height && dimensions.height === source.width;
    const editedSize = editDocument ? freeImageEditOutputDimensions(editDocument) : crop;
    if (editedSize ? dimensions.width !== editedSize.width || dimensions.height !== editedSize.height : !same && !rotated) throw new ImageTextError(400, crop ? '잘라낸 PNG의 실제 크기가 선택 영역과 다릅니다.' : '번역 결과 크기가 원본 이미지와 다릅니다.');
    const editDocumentSha256 = editDocument ? await freeImageEditDigest(freeImageEditDocumentBytes(editDocument)) : undefined;
    const applyIdentity = !source.quotationTarget && editDocumentSha256 ? freeImageRoleEditApplyIdentity(source, optionImageIds, crop, editDocumentSha256) : freeImageApplyIdentity(source, optionImageIds, crop, editDocumentSha256);
    const sha256 = await digest(bytes), fingerprint = await digest(new TextEncoder().encode(applyIdentity));
    const key = `${owner}/free-image-${id}-${fingerprint}-${sha256}.png`;
    if (!isOwnedImageKey(owner, key)) throw new ImageTextError(400, '이미지 결과 저장 범위를 확인해주세요.');
    const recovered = await replay(owner, id, source, optionImageIds, key, sha256, bytes.length, crop, editDocument);
    if (recovered) return recovered;
    const current = await freshSource(owner, id, source);
    const quotation = source.quotationTarget ? await stableQuotationFieldsView(owner, id, source.quotationTarget.profileId) : null;
    if (quotation && (quotation.view.revision !== source.quotationTarget!.revision || quotation.view.inputFingerprint !== source.quotationTarget!.inputFingerprint)) throw changed();
    const options = optionImageIds.length ? await readProductOptions(owner, id) : null;
    const previousKey = source.editorSource?.resultKey ?? source.sourceKey;
    if (options && (options.revision !== source.optionImages!.revision || optionImageIds.some(id => options.rows.filter(row => row.id === id && row.imageKey === previousKey).length !== 1))) throw changed();
    const imageKeys = [...new Set([...current.keys, key])];
    if (imageKeys.length > PRODUCT_IMAGE_POOL_LIMIT) throw new ImageTextError(400, `원본을 보존하려면 상품 이미지 ${PRODUCT_IMAGE_POOL_LIMIT}개 한도에 여유가 필요합니다.`);
    if (!quotation && !optionOnly && Object.entries(current.content.assets).some(([role, field]) => role !== source.role && field.value.includes(key))) throw changed();
    const now = new Date(Math.max(Date.now(), Date.parse(source.productVersion) + 1)).toISOString();
    let next;
    try { next = quotation || source.additionalDraftTarget || optionOnly ? current.content : applyContentPatch(current.content, { assets: { [source.role]: current.content.assets[source.role].value.map(value => value === previousKey ? key : value) } }, now); }
    catch { throw new ImageTextError(409, '이미지 역할이 중복되어 있습니다. 원본 역할을 확인한 후 다시 적용해주세요.'); }
    const finalOverrides = quotation ? quotationOverrides(quotation, source, key) : null;
    const quotationOverridesSha256 = finalOverrides ? await digest(new TextEncoder().encode(JSON.stringify(finalOverrides))) : undefined;
    let editRecord: PreparedFreeImageEditRecord | undefined, roleSnapshot: QuotationSnapshot | undefined;
    if (editDocument) {
      const snapshot = quotation ?? (roleSnapshot = await stableQuotationFieldsView(owner, id, source.additionalDraftTarget?.profileId ?? null));
      if (!snapshot.view.categoryContext.categoryId || !env.FILES || snapshot.view.productVersion !== source.productVersion || snapshot.view.contentRevision !== source.contentRevision) throw changed();
      const company = await editorCompany(owner), result = { key, sha256, bytes: bytes.length, width: dimensions.width, height: dimensions.height };
      editRecord = quotation ? await prepareFreeImageEditRecord(source, editDocument, snapshot.view.categoryContext, company, result)
        : await prepareFreeImageRoleEditRecord(source, editDocument, optionImageIds, snapshot.view.categoryContext, company, result);
      await storeFreeImageEditRecord(env.FILES, editRecord);
    }
    if (!await storedOutput(key, source, optionImageIds, sha256, bytes.length, crop, editDocument)) {
      try {
        // Both arrays can contain 200 long IDs. Store their hashes rather than
        // full JSON so the complete record stays below R2's 8KB metadata limit.
        const [sourceSha256, optionIdsSha256, cropSha256] = await Promise.all([
          digest(new TextEncoder().encode(freeImageSourceIdentity(source))), digest(new TextEncoder().encode(JSON.stringify(optionImageIds))),
          crop ? digest(new TextEncoder().encode(JSON.stringify(crop))) : undefined,
        ]);
        const saved = await env.FILES.put(key, bytes, { onlyIf: new Headers({ 'if-none-match': '*' }), httpMetadata: { contentType: 'image/png' },
          customMetadata: { freeImageSourceSha256: sourceSha256, freeImageOptionIdsSha256: optionIdsSha256, freeImageOutputSha256: sha256,
            ...(editRecord ? { freeImageEditDocumentSha256: editRecord.documentSha256, freeImageEditRecordSha256: editRecord.recordSha256 } : {}),
            ...(cropSha256 ? { freeImageCropSha256: cropSha256 } : {}),
            ...(quotationOverridesSha256 ? { freeImageQuotationOverridesSha256: quotationOverridesSha256 } : {}),
            imageValidation: 'header-v1', dimensionValidation: 'header-v1', imageWidth: String(dimensions.width), imageHeight: String(dimensions.height) } });
        if (!saved && !await storedOutput(key, source, optionImageIds, sha256, bytes.length, crop, editDocument)) throw Error('Image upload was not confirmed.');
      } catch (error) {
        // A failed acknowledgement may follow a committed R2 put. Verify bytes
        // and metadata before continuing; never overwrite or delete that object.
        if (!await storedOutput(key, source, optionImageIds, sha256, bytes.length, crop, editDocument)) throw error;
      }
    }
    if (quotationOverridesSha256 && (await env.FILES.get(key))?.customMetadata?.freeImageQuotationOverridesSha256 !== quotationOverridesSha256) throw changed();
    await freshSource(owner, id, source);
    if (roleSnapshot) {
      const currentSnapshot = await stableQuotationFieldsView(owner, id, source.additionalDraftTarget?.profileId ?? null);
      if (JSON.stringify(currentSnapshot.source) !== JSON.stringify(roleSnapshot.source)
        || JSON.stringify(currentSnapshot.view.categoryContext) !== JSON.stringify(editRecord?.record.context)
        || JSON.stringify(await editorCompany(owner)) !== JSON.stringify(editRecord?.record.company)) throw changed();
    }
    // The DB guard checks both original keys and revisions atomically. An R2
    // object can remain unattached after a conflict and be reused safely later.
    try {
      if (quotation && finalOverrides) {
        const user = editDocument ? await getChatGPTUser() : undefined, company = editDocument ? approvedSupplierHubCompany(user?.membership) : undefined;
        if (editDocument && (!user?.verifiedAccess || user.userId !== owner || !user.membership || !company || JSON.stringify(company) !== JSON.stringify(editRecord?.record.company))) throw changed();
        const sealed = company && user?.membership ? { expectedOverrides: quotation.view.overrides, member: { email: user.membership.email, role: user.membership.role, companyCode: company.code, companyName: company.name } } : undefined;
        const saved = await attachQuotationImageTranslation(owner, id, finalOverrides, quotation.view.revision, quotation.source, quotation.view.categoryContext.categoryId, imageKeys, sealed);
        const committed = await replay(owner, id, source, [], key, sha256, bytes.length, crop, editDocument);
        if (committed) {
          if (!saved) return committed;
          const acknowledged: unknown = await committed.json();
          if (!acknowledged || typeof acknowledged !== 'object' || Array.isArray(acknowledged)
            || !('applied' in acknowledged) || acknowledged.applied !== true || !('key' in acknowledged) || acknowledged.key !== key)
            throw new ImageTextError(503, '최종 견적 이미지 저장 확인 응답을 읽지 못했습니다. 같은 PNG 미리보기로 저장 여부를 다시 확인해주세요.');
          return response(Object.fromEntries(Object.entries(acknowledged).filter(([field]) => field !== 'replayed')));
        }
        if (!saved) throw changed();
        throw new ImageTextError(503, '최종 견적 이미지 저장 결과를 확인하지 못했습니다. 같은 PNG 미리보기로 저장 여부를 다시 확인해주세요.');
      }
      const common = { productId: id, expectedVersion: source.productVersion, expectedContentRevision: source.contentRevision,
        previousImageKeys: current.product.image_keys, imageKeys, content: next, productVersion: now };
      const saved = options ? await applyProductImageTranslation(owner, { ...common, contentMutated: !optionOnly, options, optionImageIds, sourceKey: previousKey, outputKey: key })
        : await attachProductDocument(owner, { ...common, contentMutated: !source.additionalDraftTarget, ...(source.optionImages ? { expectedOptionRevision: source.optionImages.revision } : {}) });
      if (saved) return response({ source, key, productVersion: saved.productVersion, contentRevision: saved.content.revision, applied: true,
        ...(options ? { optionRevision: options.revision + 1, optionImageIds } : {}), ...(crop ? { crop } : {}), ...(editDocumentSha256 ? { editDocumentSha256 } : {}) });
      const committed = await replay(owner, id, source, optionImageIds, key, sha256, bytes.length, crop, editDocument);
      if (committed) return committed;
      throw changed();
    } catch (error) {
      const committed = await replay(owner, id, source, optionImageIds, key, sha256, bytes.length, crop, editDocument);
      if (committed) return committed;
      throw error;
    }
  } catch (error) { return fail(error); }
}
