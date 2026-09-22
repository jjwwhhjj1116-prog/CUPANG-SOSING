import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct, getSettings } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { productImageKeys } from '@/app/product-content';
import { isOwnedImageKey } from '@/app/image-files';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { fingerprint } from '@/app/automation/model';
import { ImageEditError, imageConfiguration, imageProcessingSettings, requireImageConfig, validateImageEditInput, imageMetadata, imageByteLimit, prepareImageReview, executeImageEdit, type ImageSecrets, type ImageEditJob, type ImageEditResult } from '@/app/automation/image-edit';
import { listImageJobs, getImageJob, createImageJob, approveImageJob, claimImageJob, finishImageFailure, finishImageSuccess, attachImageResult } from '@/db/image-jobs';

type Context = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const conflict = () => json({ error: '상품·원본·콘텐츠·승인 상태가 변경되었습니다. 저장 상태를 새로고침한 뒤 다시 검토해주세요.', code: 'IMAGE_JOB_CONFLICT' }, 409);
const configuration = () => imageConfiguration(env as ImageSecrets);
async function savedImageSettings(owner: string) {
  const stored = await getSettings(owner);
  const settings = imageProcessingSettings(stored ? JSON.parse(stored.payload) : {});
  return { settings, settingsFingerprint: await fingerprint(settings) };
}
const settingsConflict = () => json({ error: '저장된 이미지 처리 설정이 검토 당시와 다릅니다. 설정을 새로고침한 뒤 새 요청을 검토·승인해주세요.', code: 'IMAGE_SETTINGS_CHANGED' }, 409);
async function sourceFile(key: string) {
  if (!env.FILES) throw new ImageEditError('IMAGE_STORAGE_UNAVAILABLE', '이미지 저장소 FILES가 연결되지 않았습니다.');
  const object = await env.FILES.get(key); if (!object) throw new ImageEditError('SOURCE_IMAGE_MISSING', '저장된 원본 이미지가 없습니다.');
  if (object.size > imageByteLimit) throw new ImageEditError('IMAGE_SIZE_LIMIT', '이미지 한 장은 10MB 이하여야 합니다.');
  const bytes = new Uint8Array(await object.arrayBuffer());
  return { bytes, metadata: await imageMetadata(bytes, object.httpMetadata?.contentType) };
}
async function requestBody(request: Request) {
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) throw new ImageEditError('INVALID_REQUEST', '같은 사이트의 JSON 요청이 필요합니다.');
  const body = await readBoundedJson(request, 32 * 1024);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ImageEditError('INVALID_REQUEST', '요청 객체가 필요합니다.');
  return body as Record<string, unknown>;
}
export async function GET(_request: Request, context: Context) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({ error: '운영 인증 연결 후 사용할 수 있습니다.' }, 503);
  try { const owner = await getWorkspaceOwnerId(); const { id } = await context.params;
    if (!await findProduct(owner, id)) return json({ error: '상품을 찾을 수 없습니다.' }, 404);
    const [jobs, settings] = await Promise.all([listImageJobs(owner, id), savedImageSettings(owner)]);
    return json({ jobs, configuration: configuration(), ...settings });
  } catch { return json({ error: '이미지 실행 이력을 불러오지 못했습니다.' }, 503); }
}
export async function POST(request: Request, context: Context) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({ error: '운영 인증 연결 후 사용할 수 있습니다.' }, 503);
  let body: Record<string, unknown>; try { body = await requestBody(request); } catch (error) { return json({ error: error instanceof Error ? error.message : '요청을 확인해주세요.' }, error instanceof RequestBodyError ? error.status : 400); }
  try {
    const owner = await getWorkspaceOwnerId(); const { id } = await context.params;
    const product = await findProduct(owner, id); if (!product) return json({ error: '상품을 찾을 수 없습니다.' }, 404);
    const keys = productImageKeys(product.image_keys);
    if (body.action === 'prepare') {
      const config = requireImageConfig(env as ImageSecrets);
      const allowed = ['action', 'expectedVersion', 'sourceKey', 'prompt', 'purpose', 'size', 'quality', 'idempotencyKey'];
      if (Object.keys(body).some(key => !allowed.includes(key)) || typeof body.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.idempotencyKey)) throw new ImageEditError('INVALID_REQUEST', '검토 요청과 중복 방지 키를 확인해주세요.');
      if (body.expectedVersion !== product.updated_at) return conflict();
      if (keys.length >= 50) throw new ImageEditError('IMAGE_LIMIT', '상품 이미지 50개 제한입니다. 이미지를 정리한 뒤 생성해주세요.');
      const input = validateImageEditInput(body, owner, keys);
      if (!isOwnedImageKey(owner, input.sourceKey)) throw new ImageEditError('IMAGE_NOT_OWNED', '이미지 저장 경로를 확인해주세요.');
      const original = await sourceFile(input.sourceKey);
      const content = await readProductContent(owner, id); const settings = await savedImageSettings(owner);
      const review = await prepareImageReview(input, original.metadata, config.model, settings.settings);
      const job: ImageEditJob = { id: crypto.randomUUID(), productId: id, productVersion: product.updated_at, contentRevision: content.revision,
        status: 'prepared', review, result: null, error: null, createdAt: new Date().toISOString(), approvedAt: null, startedAt: null, finishedAt: null };
      const requestFingerprint = await fingerprint({ input, source: original.metadata, model: config.model, productVersion: job.productVersion, contentRevision: job.contentRevision, settingsSnapshot: review.settingsSnapshot, recipeVersion: review.recipeVersion });
      const saved = await createImageJob(owner, job, product.image_keys, body.idempotencyKey, requestFingerprint);
      return saved && !saved.conflict ? json({ job: saved.job, replayed: saved.replayed, configuration: configuration(), ...settings }, saved.replayed ? 200 : 201) : conflict();
    }
    if (!['approve', 'execute', 'attach'].includes(String(body.action)) || typeof body.jobId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.jobId)) throw new ImageEditError('INVALID_REQUEST', '이미지 작업을 확인해주세요.');
    const allowed = body.action === 'approve' ? ['action', 'jobId', 'reviewFingerprint', 'confirmPaid'] : body.action === 'attach' ? ['action', 'jobId', 'expectedVersion'] : ['action', 'jobId'];
    if (Object.keys(body).some(key => !allowed.includes(key))) throw new ImageEditError('INVALID_REQUEST', '브라우저에서 키·모델·결과를 지정할 수 없습니다.');
    const existing = await getImageJob(owner, id, body.jobId); if (!existing) return json({ error: '이미지 작업을 찾을 수 없습니다.' }, 404);
    if (body.action === 'attach') {
      if (existing.status !== 'completed' || !existing.result || body.expectedVersion !== product.updated_at) return conflict();
      if (!isOwnedImageKey(owner, existing.result.storageKey)) return conflict();
      const output = await sourceFile(existing.result.storageKey);
      if (output.metadata.sha256 !== existing.result.sha256) return conflict();
      const attached = await attachImageResult(owner, existing, product.updated_at, product.image_keys);
      return attached ? json({ job: attached }) : conflict();
    }
    if (body.action === 'execute' && ['completed', 'failed', 'uncertain'].includes(existing.status)) return json({ job: existing, replayed: true });
    if (body.action === 'execute' && existing.status === 'running') return json({ job: existing, replayed: true }, 202);
    const config = requireImageConfig(env as ImageSecrets);
    if (existing.review.model !== config.model) return conflict();
    const settings = await savedImageSettings(owner);
    if (existing.review.settingsFingerprint !== settings.settingsFingerprint || existing.review.recipeVersion !== 1) return settingsConflict();
    if (body.action === 'approve') {
      if (body.confirmPaid !== true || body.reviewFingerprint !== existing.review.fingerprint) return json({ error: '원본·모델·요청·크기·품질의 유료 실행 승인이 필요합니다.', code: 'PAID_APPROVAL_REQUIRED' }, 400);
      if (existing.status === 'approved') return json({ job: existing, replayed: true });
      const approved = await approveImageJob(owner, id, existing.id, existing.review.fingerprint, new Date().toISOString());
      return approved ? json({ job: approved }) : conflict();
    }
    if (existing.status !== 'approved') return json({ error: '검토 요청을 먼저 승인해주세요.', code: 'PAID_APPROVAL_REQUIRED' }, 409);
    if (!isOwnedImageKey(owner, existing.review.sourceKey) || !keys.includes(existing.review.sourceKey)) return conflict();
    const source = await sourceFile(existing.review.sourceKey);
    if (source.metadata.sha256 !== existing.review.source.sha256 || source.metadata.mime !== existing.review.source.mime) return conflict();
    const claim = crypto.randomUUID(); const claimed = await claimImageJob(owner, id, existing.id, existing.review.fingerprint, claim, new Date().toISOString());
    if (!claimed) { const current = await getImageJob(owner, id, existing.id); return current?.status === 'running' ? json({ job: current, replayed: true }, 202) : conflict(); }
    let generated;
    try { generated = await executeImageEdit(claimed.review, config, source.bytes); }
    catch (error) {
      const failure = error instanceof ImageEditError ? { code: error.code, message: error.message, mayHaveBeenCharged: error.mayHaveBeenCharged } : { code: 'PROVIDER_OUTCOME_UNCERTAIN', message: '실행 결과가 불확실합니다. 자동 재시도하지 않습니다.', mayHaveBeenCharged: true };
      const finished = await finishImageFailure(owner, id, claimed.id, claim, failure);
      return finished ? json({ job: finished }) : json({ error: '실패 상태 저장을 확인하지 못했습니다. 추가 유료 실행 전에 이력을 확인해주세요.' }, 503);
    }
    const outputKey = `${owner}/ai-${claimed.id}.png`;
    try {
      await env.FILES.put(outputKey, generated.bytes as ArrayBufferView, { httpMetadata: { contentType: 'image/png' }, customMetadata: { imageJobId: claimed.id, provenance: 'generated', sha256: generated.metadata.sha256 } });
      const result: ImageEditResult = { ...generated.metadata, storageKey: outputKey, model: claimed.review.model, purpose: claimed.review.purpose,
        generatedAt: generated.generatedAt, providerRequestId: generated.providerRequestId, usage: generated.usage, attached: false, assignedRole: false, provenance: 'generated', reviewRequired: true };
      const finished = await finishImageSuccess(owner, claimed, claim, result);
      return finished ? json({ job: finished }) : json({ error: '생성 후 결과 저장 상태가 불확실합니다. 중복 유료 요청을 만들지 말고 이력을 확인해주세요.', code: 'IMAGE_RESULT_PERSISTENCE_UNCERTAIN' }, 503);
    } catch { return json({ error: '유료 호출 후 이미지 또는 결과 저장에 실패했습니다. 이미 시작된 호출을 반복하지 않습니다.', code: 'IMAGE_RESULT_PERSISTENCE_UNCERTAIN' }, 503); }
  } catch (error) {
    if (error instanceof ImageEditError) return json({ error: error.message, code: error.code, configuration: configuration() }, error.code.includes('NOT_CONFIGURED') || error.code.includes('UNAVAILABLE') ? 503 : 400);
    return json({ error: '이미지 작업을 저장하지 못했습니다. 실행 이력을 확인한 뒤 다시 진행해주세요.' }, 503);
  }
}
