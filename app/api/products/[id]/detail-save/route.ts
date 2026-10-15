import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { approvedSupplierHubCompany } from '@/app/supplier-hub-company';
import { stableQuotationFieldsView, QuotationFieldsSnapshotError } from '@/app/quotation-fields-snapshot';
import { attachQuotationDetailSave, detailSaveHistoryScope, readQuotationFields, QuotationDetailSaveLimitError } from '@/db/quotation-fields';
import { applyQuotationChanges } from '@/app/quotation-schema';
import { detailSaveChanges, detailSaveManualBackup, detailSaveOptionIds, detailSaveReceiptMatches, type DetailSaveReceipt, type DetailSaveSource } from '@/app/detail-save-plan';
import { optionImageTargets, quotationImageKeys } from '@/app/quotation-image-targets';
import { labelUploadDigest, labelUploadKey } from '@/app/label-upload-key';
import { imageFileType, isOwnedImageKey, MAX_IMAGE_BYTES, PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-files';
import { imageDisplayDimensions } from '@/app/image-dimensions';
import { inspectImage } from '@/app/automation/image-edit';
import { readBoundedJson, readBoundedStream, RequestBodyError } from '@/app/request-body';
import { PublicDetailError } from '@/app/quotation-public-detail';

type Context = { params: Promise<{ id: string }> };
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'cache-control': 'no-store' } });
const conflict = () => new QuotationFieldsSnapshotError('상세 저장 원천이 변경되었습니다. 미리보기와 입력을 보존한 채 최신 자료를 다시 확인해주세요.', 409, 'DETAIL_SAVE_CONFLICT');
function failure(error: unknown) {
  if (error instanceof QuotationFieldsSnapshotError) return json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
  if (error instanceof RequestBodyError || error instanceof PublicDetailError) return json({ error: error.message }, error.status);
  if (error instanceof QuotationDetailSaveLimitError) return json({ error: error.message, code: 'DETAIL_SAVE_BACKUP_LIMIT' }, 413);
  return json({ error: '상세 이미지 저장 결과를 확인하지 못했습니다. 기존 자료와 미리보기는 보존했습니다.' }, 503);
}
function selection(request: Request, recover: boolean) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !['profileId', ...(recover ? ['uploadId'] : [])].includes(key) || params.getAll(key).length !== 1))
    throw new QuotationFieldsSnapshotError('상세 저장 조회 범위를 확인해주세요.', 400);
  const profileId = params.get('profileId');
  if (profileId !== null && !/^[A-Za-z0-9_-]{1,100}$/.test(profileId)) throw new QuotationFieldsSnapshotError('카테고리 프로필을 확인해주세요.', 400);
  const uploadId = params.get('uploadId');
  if (recover && !/^[a-f0-9]{64}$/.test(uploadId ?? '')) throw new QuotationFieldsSnapshotError('저장 결과 번호를 확인해주세요.', 400);
  return { profileId, uploadId };
}
async function identity(context: Context) {
  const user = await getChatGPTUser(), owner = await getWorkspaceOwnerId(), { id } = await context.params;
  const company = approvedSupplierHubCompany(user?.membership);
  if (!user?.verifiedAccess || user.userId !== owner || !company || !user.membership) throw new QuotationFieldsSnapshotError('승인된 회사 계정으로 로그인 후 상세 이미지를 저장해주세요.', 403);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new QuotationFieldsSnapshotError('상품 번호를 확인해주세요.', 400);
  return { owner, id, member: { email: user.membership.email, role: user.membership.role, companyCode: company.code, companyName: company.name } };
}
function dimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 16000 || height > 16000 || width * height > 40000000)
    throw new QuotationFieldsSnapshotError('상세 이미지 처리 크기를 초과했습니다. 원본을 나누거나 줄여주세요.', 413);
}
async function imageBytes(owner: string, key: string) {
  if (!env.FILES) throw new QuotationFieldsSnapshotError('이미지 저장소가 연결되지 않았습니다.', 503);
  if (!isOwnedImageKey(owner, key)) throw new QuotationFieldsSnapshotError('현재 계정의 이미지가 아닙니다.', 400);
  const object = await env.FILES.get(key);
  if (!object || object.size < 1 || object.size > MAX_IMAGE_BYTES) throw new QuotationFieldsSnapshotError('저장한 이미지 파일을 확인해주세요.', 409);
  const bytes = await readBoundedStream(object.body, MAX_IMAGE_BYTES);
  if (bytes.length !== object.size) throw new QuotationFieldsSnapshotError('이미지 파일을 끝까지 읽지 못했습니다.', 503);
  return { object, bytes };
}
async function uploadedPng(owner: string, receipt: Pick<DetailSaveReceipt, 'uploadId' | 'key' | 'sha256' | 'bytes'>) {
  if (receipt.key !== labelUploadKey(owner, receipt.uploadId)) throw conflict();
  const result = await imageBytes(owner, receipt.key), { object, bytes } = result;
  if (object.httpMetadata?.contentType !== 'image/png' || object.customMetadata?.labelUploadId !== receipt.uploadId
    || object.customMetadata?.labelBlobSha256 !== receipt.sha256 || bytes.length !== receipt.bytes || await labelUploadDigest(bytes) !== receipt.sha256) throw conflict();
  let metadata;
  try { metadata = inspectImage(bytes); } catch { throw new QuotationFieldsSnapshotError('저장한 파일이 유효한 PNG가 아닙니다.', 415); }
  if (metadata.mime !== 'image/png' || metadata.width !== 800) throw new QuotationFieldsSnapshotError('검토한 상세 PNG의 형식과 800px 너비를 확인해주세요.', 415);
  dimensions(metadata.width, metadata.height); return metadata;
}
export async function GET(request: Request, context: Context) {
  try {
    const { profileId, uploadId } = selection(request, true), { owner, id } = await identity(context);
    const saved = await stableQuotationFieldsView(owner, id, profileId), state = await readQuotationFields(owner, id);
    if (state.revision !== saved.view.revision) throw conflict();
    const history = state.detailSaveBackups?.[detailSaveHistoryScope(saved.view.categoryContext.categoryId)] ?? [];
    const backup = history.find(entry => entry.receipt.uploadId === uploadId);
    if (!backup) {
      if (Object.values(state.detailSaveBackups ?? {}).some(entries => entries.some(entry => entry.receipt.uploadId === uploadId))) throw conflict();
      return json({ applied: false, quotation: saved.view });
    }
    if (!detailSaveReceiptMatches(saved.view, backup.receipt)) throw conflict();
    await uploadedPng(owner, backup.receipt);
    const confirmed = await stableQuotationFieldsView(owner, id, profileId);
    if (JSON.stringify(confirmed.view) !== JSON.stringify(saved.view)) throw conflict();
    return json({ applied: true, quotation: confirmed.view, receipt: backup.receipt });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new QuotationFieldsSnapshotError('같은 사이트에서 상세 이미지를 저장해주세요.', 400);
    const { profileId } = selection(request, false), { owner, id, member } = await identity(context);
    const body = await readBoundedJson(request, 8192) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 6
      || Object.keys(body).some(key => !['expectedRevision', 'expectedInputFingerprint', 'sourceOptionId', 'uploadId', 'sha256', 'bytes'].includes(key))
      || !Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0
      || typeof body.expectedInputFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedInputFingerprint)
      || typeof body.sourceOptionId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(body.sourceOptionId)
      || typeof body.uploadId !== 'string' || !/^[a-f0-9]{64}$/.test(body.uploadId) || typeof body.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.sha256)
      || !Number.isSafeInteger(body.bytes) || (body.bytes as number) < 1 || (body.bytes as number) > MAX_IMAGE_BYTES)
      throw new QuotationFieldsSnapshotError('검토한 PNG와 상세 저장 버전을 확인해주세요.', 400);
    const saved = await stableQuotationFieldsView(owner, id, profileId), view = saved.view;
    const previous = await readQuotationFields(owner, id);
    if (previous.revision !== view.revision) throw conflict();
    const scope = detailSaveHistoryScope(view.categoryContext.categoryId), history = previous.detailSaveBackups?.[scope] ?? [];
    const existing = history.find(entry => entry.receipt.uploadId === body.uploadId);
    if (existing) {
      const receipt = existing.receipt;
      if (existing.beforeInputFingerprint !== body.expectedInputFingerprint || receipt.beforeRevision !== body.expectedRevision
        || receipt.sourceOptionId !== body.sourceOptionId || receipt.sha256 !== body.sha256 || receipt.bytes !== body.bytes
        || !detailSaveReceiptMatches(view, receipt)) throw conflict();
      await uploadedPng(owner, receipt);
      const quotation = (await stableQuotationFieldsView(owner, id, profileId)).view;
      if (JSON.stringify(quotation) !== JSON.stringify(view)) throw conflict();
      return json({ quotation, receipt });
    }
    if (Object.values(previous.detailSaveBackups ?? {}).some(entries => entries.some(entry => entry.receipt.uploadId === body.uploadId))) throw conflict();
    if (view.revision !== body.expectedRevision || view.inputFingerprint !== body.expectedInputFingerprint) throw conflict();
    const optionIds = detailSaveOptionIds(view);
    if (JSON.stringify(optionIds) !== JSON.stringify(saved.options.rows.map(row => row.id)) || !optionIds.includes(body.sourceOptionId)) throw conflict();
    const key = labelUploadKey(owner, body.uploadId);
    if (view.imageKeys.length >= PRODUCT_IMAGE_POOL_LIMIT || view.imageKeys.includes(key)) throw new QuotationFieldsSnapshotError('새 상세 PNG를 보존할 이미지 공간이나 저장 번호를 확인해주세요.', 409);
    const receipt: DetailSaveReceipt = { uploadId: body.uploadId, key, sha256: body.sha256, bytes: body.bytes as number,
      revision: view.revision + 1, beforeRevision: view.revision, sourceOptionId: body.sourceOptionId, categoryId: view.categoryContext.categoryId, optionIds };
    const output = await uploadedPng(owner, receipt), target = optionImageTargets(view.resolved.schema.fields).detailImages;
    const row = view.resolved.rows.find(row => row.optionId === body.sourceOptionId), value = row?.fields[target.primary]?.value;
    if (typeof value !== 'string' || target.fields.some(field => field.readOnly) || target.linked.some(field => row?.fields[field]?.value !== value)) throw conflict();
    const keys = quotationImageKeys(value);
    if (!keys.length || keys.length > PRODUCT_IMAGE_POOL_LIMIT || keys.some(key => !view.imageKeys.includes(key))) throw conflict();
    const sources: DetailSaveSource[] = []; let totalBytes = 0, height = 0;
    for (const sourceKey of keys) {
      request.signal.throwIfAborted();
      const { bytes } = await imageBytes(owner, sourceKey); totalBytes += bytes.length;
      if (totalBytes > 30 * 1024 * 1024) throw new QuotationFieldsSnapshotError('상세 원본 전체 크기는 30MB 이내여야 합니다.', 413);
      let size;
      try { imageFileType(bytes); size = imageDisplayDimensions(bytes); } catch { throw conflict(); }
      if (!size) throw new QuotationFieldsSnapshotError('상세 원본의 실제 크기를 확인하지 못했습니다.', 415);
      dimensions(size.width, size.height); height += Math.max(1, Math.round(size.height * 800 / size.width)); dimensions(800, height);
      sources.push({ key: sourceKey, sha256: await labelUploadDigest(bytes), width: size.width, height: size.height });
    }
    if (height !== output.height || await labelUploadDigest(new TextEncoder().encode(JSON.stringify({ kind: 'detail-composite-v1', productId: id,
      optionId: body.sourceOptionId, category: view.categoryContext, fingerprint: view.inputFingerprint, sources, width: 800, height, sha256: body.sha256 }))) !== body.uploadId) throw conflict();
    const changes = detailSaveChanges(view, key), overrides = applyQuotationChanges(view.overrides, changes);
    request.signal.throwIfAborted();
    const stored = await attachQuotationDetailSave(owner, id, overrides, view.revision, saved.source, view.categoryContext.categoryId, [...view.imageKeys, key], {
      expectedOverrides: view.overrides, member,
      backup: { receipt, before: detailSaveManualBackup(view, changes), sources, beforeProductVersion: view.productVersion, beforeInputFingerprint: view.inputFingerprint },
    });
    if (!stored) throw conflict();
    const quotation = (await stableQuotationFieldsView(owner, id, profileId)).view;
    if (!detailSaveReceiptMatches(quotation, receipt)) throw conflict();
    return json({ quotation, receipt });
  } catch (error) { return failure(error); }
}
