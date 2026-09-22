import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { listTranslationJobs, getTranslationJob, createTranslationJob, approveTranslationJob, claimTranslationJob, finishTranslationJob } from '@/db/translation-jobs';
import { fingerprint } from '@/app/automation/model';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { TranslationError, translationConfiguration, requireTranslationConfig, validateTranslationSource, prepareTranslationReview, executeTranslation, type TranslationJob, type TranslationSecrets } from '@/app/automation/translation';

type Context = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const configuration = () => translationConfiguration(env as TranslationSecrets);
const unavailable = () => json({ error: '번역 요청 저장소에 연결하지 못했습니다. 실행 이력을 확인한 뒤 진행해주세요.' }, 503);
const conflict = () => json({ error: '상품·콘텐츠·설정 또는 승인 상태가 변경되었습니다. 새 검토 요청을 만들어주세요.', code: 'TRANSLATION_CONFLICT' }, 409);

export async function GET(_request: Request, context: Context) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({ error: '운영 인증 연결 후 사용할 수 있습니다.' }, 503);
  try {
    const owner = await getWorkspaceOwnerId(); const { id } = await context.params;
    if (!await findProduct(owner, id)) return json({ error: '상품을 찾을 수 없습니다.' }, 404);
    return json({ jobs: await listTranslationJobs(owner, id), configuration: configuration() });
  } catch { return unavailable(); }
}

async function input(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new TranslationError('INVALID_ORIGIN', '같은 사이트에서 요청해주세요.');
  const body = await readBoundedJson(request, 96 * 1024);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TranslationError('INVALID_REQUEST', '요청 객체가 필요합니다.');
  return body as Record<string, unknown>;
}

export async function POST(request: Request, context: Context) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({ error: '운영 인증 연결 후 사용할 수 있습니다.' }, 503);
  let body: Record<string, unknown>;
  try { body = await input(request); }
  catch (error) { return json({ error: error instanceof Error ? error.message : '요청을 확인해주세요.' }, error instanceof RequestBodyError ? error.status : 400); }
  try {
    const owner = await getWorkspaceOwnerId(); const { id } = await context.params;
    const product = await findProduct(owner, id); if (!product) return json({ error: '상품을 찾을 수 없습니다.' }, 404);
    const config = requireTranslationConfig(env as TranslationSecrets);
    if (body.action === 'prepare') {
      if (Object.keys(body).some(key => !['action', 'source', 'expectedVersion', 'idempotencyKey'].includes(key)) || typeof body.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.idempotencyKey)) throw new TranslationError('INVALID_REQUEST', '번역 검토 요청 항목과 중복 방지 키를 확인해주세요.');
      if (body.expectedVersion !== product.updated_at) return conflict();
      const source = validateTranslationSource(body.source);
      const content = await readProductContent(owner, id);
      const review = await prepareTranslationReview(source, config);
      const job: TranslationJob = { id: crypto.randomUUID(), productId: id, productVersion: product.updated_at, contentRevision: content.revision,
        status: 'prepared', review, result: null, error: null, createdAt: new Date().toISOString(), approvedAt: null, startedAt: null, finishedAt: null };
      const requestFingerprint = await fingerprint({ source, productVersion: job.productVersion, contentRevision: job.contentRevision, model: config.model, maxOutputTokens: config.maxOutputTokens });
      const saved = await createTranslationJob(owner, job, body.idempotencyKey, requestFingerprint);
      if (!saved || saved.conflict) return conflict();
      return json({ job: saved.job, replayed: saved.replayed, configuration: configuration() }, saved.replayed ? 200 : 201);
    }
    if (!['approve', 'execute'].includes(String(body.action)) || typeof body.jobId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.jobId)) throw new TranslationError('INVALID_REQUEST', '작업과 요청 종류를 확인해주세요.');
    const allowed = body.action === 'approve' ? ['action', 'jobId', 'reviewFingerprint', 'confirmPaid'] : ['action', 'jobId'];
    if (Object.keys(body).some(key => !allowed.includes(key))) throw new TranslationError('INVALID_REQUEST', '클라이언트가 모델이나 결과를 지정할 수 없습니다.');
    const existing = await getTranslationJob(owner, id, body.jobId);
    if (!existing) return json({ error: '번역 요청을 찾을 수 없습니다.' }, 404);
    if (existing.review.model !== config.model || existing.review.maxOutputTokens !== config.maxOutputTokens) return conflict();
    if (body.action === 'approve') {
      if (body.confirmPaid !== true || body.reviewFingerprint !== existing.review.fingerprint) return json({ error: '검토한 원문과 모델의 유료 호출 승인이 필요합니다.', code: 'PAID_APPROVAL_REQUIRED' }, 400);
      if (existing.status === 'approved') return json({ job: existing, replayed: true });
      const approved = await approveTranslationJob(owner, id, existing.id, existing.review.fingerprint, new Date().toISOString());
      return approved ? json({ job: approved }) : conflict();
    }
    if (['completed', 'failed', 'uncertain'].includes(existing.status)) return json({ job: existing, replayed: true });
    if (existing.status === 'running') return json({ job: existing, replayed: true, message: '이미 실행 중이거나 결과 확인이 필요합니다. 중복 호출하지 않았습니다.' }, 202);
    if (existing.status !== 'approved') return json({ error: '먼저 검토한 유료 요청을 승인해주세요.', code: 'PAID_APPROVAL_REQUIRED' }, 409);
    const claim = crypto.randomUUID();
    const claimed = await claimTranslationJob(owner, id, existing.id, existing.review.fingerprint, claim, new Date().toISOString());
    if (!claimed) {
      const current = await getTranslationJob(owner, id, existing.id);
      if (current && current.status !== 'approved') return json({ job: current, replayed: true }, current.status === 'running' ? 202 : 200);
      return conflict();
    }
    let result = null; let executionError: TranslationJob['error'] = null;
    try { result = await executeTranslation(claimed.review, config); }
    catch (error) { executionError = error instanceof TranslationError ? { code: error.code, message: error.message, mayHaveBeenCharged: error.mayHaveBeenCharged } : { code: 'PROVIDER_OUTCOME_UNCERTAIN', message: '실행 결과를 확인할 수 없습니다. 자동 재시도하지 않습니다.', mayHaveBeenCharged: true }; }
    try {
      const finished = await finishTranslationJob(owner, id, claimed.id, claim, result, executionError, new Date().toISOString());
      return finished ? json({ job: finished }) : json({ error: '호출 후 결과 저장 상태가 불확실합니다. 다시 유료 요청을 만들기 전에 실행 이력을 확인해주세요.', code: 'RESULT_PERSISTENCE_UNCERTAIN' }, 503);
    } catch { return json({ error: '호출 후 결과 저장에 실패했습니다. 비용이 발생했을 수 있으며 중복 호출을 차단했습니다.', code: 'RESULT_PERSISTENCE_UNCERTAIN' }, 503); }
  } catch (error) {
    if (error instanceof TranslationError) return json({ error: error.message, code: error.code, configuration: configuration() }, error.code === 'TRANSLATION_NOT_CONFIGURED' ? 503 : 400);
    return unavailable();
  }
}
