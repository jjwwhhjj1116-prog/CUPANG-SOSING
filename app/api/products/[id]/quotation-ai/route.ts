import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { approvedSupplierHubCompany } from '@/app/supplier-hub-company';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { readQuotationExportSource, quotationExportFingerprint, QuotationExportError } from '@/app/exports/quotation-source';
import { quotationSourcesCurrent, readQuotationFields } from '@/db/quotation-fields';
import { fingerprint } from '@/app/automation/model';
import { buildQuotationAiPlan, executeQuotationAi, QuotationAiError, QUOTATION_AI_MODEL } from '@/app/quotation-ai';
import { quotationAiProviderResponse, quotationAiProviderInput } from '@/app/quotation-ai-provider';
import { findQuotationAiJob, listQuotationAiJobs, createQuotationAiJob, claimQuotationAiJob, finishQuotationAiJob,
  closeUncertainQuotationAiJob, reserveQuotationAiRequest, type QuotationAiJob, type QuotationAiReview } from '@/db/quotation-ai-jobs';

type Context = { params: Promise<{ id: string }> };
type AiEnvironment = { AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  SOURCEFLOW_QUOTATION_AI_PROVIDER?: string; SOURCEFLOW_QUOTATION_AI_FREE_ONLY?: string };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const sourceChanged = () => json({ error: '상품·회사·카테고리 또는 견적 입력이 바뀌었습니다. 저장 후 AI 초안을 다시 확인해주세요.', code: 'QUOTATION_AI_SOURCE_CHANGED' }, 409);
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function configuration() {
  const settings = env as AiEnvironment;
  return { configured: settings.SOURCEFLOW_QUOTATION_AI_PROVIDER === 'workers-ai' && settings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY === 'true'
      && typeof settings.AI?.run === 'function', model: QUOTATION_AI_MODEL, provider: 'Cloudflare Workers AI', freeOnly: true,
    notice: '카테고리 양식과 저장된 상품정보로 검토할 AI 초안을 만듭니다. 직접 수정한 값은 유지하며 초안을 확인한 뒤 적용·저장하세요.' };
}
const publicJob = (job: QuotationAiJob) => ({ id: job.id, status: job.status, fingerprint: job.review.fingerprint,
  quotationRevision: job.review.quotationRevision, profileId: job.review.profileId, scope: job.review.scope, model: QUOTATION_AI_MODEL,
  result: job.result, error: job.error, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt, applied: false,
  canClose:job.status==='uncertain'||job.status==='running'&&Boolean(job.startedAt)&&Date.now()-Date.parse(job.startedAt!)>5*60_000 });
async function authorization() {
  const user = await getChatGPTUser(), owner = await getWorkspaceOwnerId(), company = approvedSupplierHubCompany(user?.membership);
  if (!user?.verifiedAccess || user.userId !== owner || user.membership?.id !== owner || !company || !['admin', 'member'].includes(user.membership.role))
    throw new QuotationExportError('승인된 회원으로 로그인해주세요.', 403);
  return { owner, company: { ...company }, member: { id: user.membership.id, email: user.membership.email, role: user.membership.role } };
}
async function currentAuthorization(expected: Awaited<ReturnType<typeof authorization>>) {
  const latest = await authorization();
  return latest.owner === expected.owner && JSON.stringify(latest.company) === JSON.stringify(expected.company)
    && JSON.stringify(latest.member) === JSON.stringify(expected.member);
}
function profile(value: unknown) {
  if (value === null || value === undefined) return null;
  if (!safeId(value)) throw new QuotationExportError('카테고리 프로필을 확인해주세요.', 400);
  return value;
}
async function readSource(auth: Awaited<ReturnType<typeof authorization>>, id: string, profileId: string | null) {
  const saved = await readQuotationExportSource(auth.owner, id, profileId);
  if (!saved.company || JSON.stringify(saved.company) !== JSON.stringify(auth.company) || !saved.hubSchema
    || !saved.categoryContext.categoryId || JSON.stringify(saved.hubSchema.company) !== JSON.stringify(auth.company))
    throw new QuotationExportError('현재 회사와 선택 카테고리의 상세 양식을 확인해주세요.', 409);
  return saved;
}
export async function GET(request: Request, context: Context) {
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => !['profileId', 'jobId'].includes(key)) || query.getAll('profileId').length > 1 || query.getAll('jobId').length > 1)
      return json({ error: 'AI 초안 조회 범위를 확인해주세요.' }, 400);
    const auth = await authorization(), { id } = await context.params, profileId = profile(query.get('profileId'));
    if (!safeId(id) || query.has('jobId') && !uuid(query.get('jobId'))) return json({ error: '상품·실행 식별값을 확인해주세요.' }, 400);
    const saved = await readSource(auth, id, profileId), currentFingerprint = await quotationExportFingerprint(saved, null);
    const jobs = query.has('jobId') ? [await findQuotationAiJob(auth.owner, id, query.get('jobId')!, true)].filter((job): job is QuotationAiJob => Boolean(job))
      : await listQuotationAiJobs(auth.owner, id);
    if (!await quotationSourcesCurrent(auth.owner, id, saved.source) || (await readQuotationFields(auth.owner, id)).revision !== saved.state.revision
      || !await currentAuthorization(auth)) return sourceChanged();
    return json({ configuration: configuration(), fingerprint: currentFingerprint, productId: id, productVersion: saved.product.updated_at,
      contentRevision: saved.content.revision, optionRevision: saved.options.revision, quotationRevision: saved.state.revision,
      profileId: saved.categoryContext.profileId,
      jobs: jobs.filter(job => JSON.stringify(job.review.company) === JSON.stringify(auth.company) && job.review.profileId === saved.categoryContext.profileId).map(publicJob) });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  let active: { auth: Awaited<ReturnType<typeof authorization>>; id: string; job: QuotationAiJob; token: string } | null = null;
  try {
    if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin)
      return json({ error: '같은 웹페이지에서 실행해주세요.' }, 403);
    const raw = await readBoundedJson(request, 16 * 1024);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return json({ error: 'AI 요청을 확인해주세요.' }, 400);
    const body = raw as Record<string, unknown>, auth = await authorization(), { id } = await context.params;
    if (!safeId(id)) return json({ error: '상품 식별값을 확인해주세요.' }, 400);
    if (body.action === 'close-uncertain') {
      if (Object.keys(body).some(key => !['action', 'jobId', 'confirmed'].includes(key)) || !uuid(body.jobId) || body.confirmed !== true)
        return json({ error: '완료 여부가 불확실한 이전 실행의 종료를 직접 확인해주세요.' }, 400);
      const job = await findQuotationAiJob(auth.owner, id, body.jobId, true);
      if (!job || JSON.stringify(job.review.company) !== JSON.stringify(auth.company) || !await currentAuthorization(auth)) return sourceChanged();
      const closed = await closeUncertainQuotationAiJob(auth.owner, id, job);
      return closed ? json({ job: publicJob(closed) }) : json({ error: '이 실행은 종료할 수 있는 불확실 상태가 아닙니다.' }, 409);
    }
    if (Object.keys(body).some(key => !['action', 'profileId', 'expectedFingerprint', 'expectedQuotationRevision', 'optionId', 'applyToAllOptions', 'idempotencyKey'].includes(key))
      || body.action !== 'generate' || !hash(body.expectedFingerprint) || !Number.isSafeInteger(body.expectedQuotationRevision)
      || !uuid(body.idempotencyKey) || typeof body.applyToAllOptions !== 'boolean' || body.optionId !== null && !safeId(body.optionId))
      return json({ error: 'AI 작성 범위와 현재 견적 확인값을 확인해주세요.' }, 400);
    if (!configuration().configured) return json({ error: '무료 견적 AI 서비스 설정을 확인해주세요.', code: 'QUOTATION_AI_NOT_CONFIGURED' }, 503);
    const profileId = profile(body.profileId), saved = await readSource(auth, id, profileId), currentFingerprint = await quotationExportFingerprint(saved, null);
    if (body.expectedFingerprint !== currentFingerprint || body.expectedQuotationRevision !== saved.state.revision) return sourceChanged();
    const scope = { optionId: body.optionId as string | null, applyToAllOptions: body.applyToAllOptions };
    const plan = buildQuotationAiPlan(saved, scope);
    const stablePlan = { ...plan, createdAt: null }; // Request time must not invalidate an idempotent retry.
    const requestFingerprint = await fingerprint({ owner: auth.owner, productId: id,
      company: auth.company, member: auth.member, profileId: saved.categoryContext.profileId, currentFingerprint, scope, plan: stablePlan, model: QUOTATION_AI_MODEL });
    const review: QuotationAiReview = { fingerprint: currentFingerprint, quotationRevision: saved.state.revision, profileId: saved.categoryContext.profileId,
      source: structuredClone(saved.source), company: auth.company, member: auth.member, scope, plan };
    const job = await createQuotationAiJob(auth.owner, id, body.idempotencyKey, requestFingerprint, review);
    if (!job || job.requestFingerprint !== requestFingerprint) return sourceChanged();
    if (job.status !== 'prepared') return json({ job: publicJob(job), reused: true });
    if (!await currentAuthorization(auth) || !await quotationSourcesCurrent(auth.owner, id, saved.source)) return sourceChanged();
    const claimed = await claimQuotationAiJob(auth.owner, id, job);
    if (!claimed) return json({ error: '다른 AI 작성이 진행 중이거나 자료가 변경됐습니다. 실행 결과를 먼저 확인해주세요.', code: 'QUOTATION_AI_BUSY' }, 409);
    active = { auth, id, job: claimed.job, token: claimed.claimToken };
    const provider = (env as AiEnvironment).AI!;
    const result = await executeQuotationAi(plan, { async run(model, input) {
      if (model !== QUOTATION_AI_MODEL || !configuration().configured || !await currentAuthorization(auth)
        || !await quotationSourcesCurrent(auth.owner, id, saved.source) || (await readQuotationFields(auth.owner, id)).revision !== saved.state.revision)
        throw new QuotationAiError('QUOTATION_AI_SOURCE_CHANGED', 'AI 작성 중 자료가 변경됐습니다. 새 저장값을 확인해주세요.');
      if (!await reserveQuotationAiRequest()) throw new QuotationAiError('QUOTATION_AI_LIMIT', '오늘의 견적 AI 요청 한도에 도달했습니다.');
      return quotationAiProviderResponse(await provider.run(model, quotationAiProviderInput(input)));
    } });
    const completed = await finishQuotationAiJob(auth.owner, id, job.id, claimed.claimToken, { status: 'completed', result });
    if (!completed) return json({ error: 'AI 실행 결과 저장을 확인하지 못했습니다. 새 요청 없이 실행 결과를 조회해주세요.', code: 'QUOTATION_AI_RESULT_UNCERTAIN' }, 503);
    const current = await readSource(auth, id, profileId);
    const applicable = await currentAuthorization(auth) && await quotationExportFingerprint(current, null) === currentFingerprint;
    return json({ job: publicJob(completed), sourceCurrent: applicable });
  } catch (error) {
    if (active) {
      const uncertain = !(error instanceof QuotationAiError) || Boolean(error.uncertain);
      const failure = { code: error instanceof QuotationAiError ? error.code : 'QUOTATION_AI_FAILED',
        message: error instanceof QuotationAiError ? error.message : 'AI 실행 결과를 확인하지 못했습니다. 실행 이력을 확인해주세요.', uncertain };
      try { await finishQuotationAiJob(active.auth.owner, active.id, active.job.id, active.token,
        { status: uncertain ? 'uncertain' : 'failed', error: failure }); } catch { /* A durable running record still prevents another call. */ }
    }
    return errorResponse(error);
  }
}
function errorResponse(error: unknown) {
  if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
  if (error instanceof QuotationExportError) return json({ error: error.message }, error.status);
  if (error instanceof QuotationAiError) return json({ error: error.message, code: error.code }, 409);
  return json({ error: '견적 AI 실행 이력을 확인하지 못했습니다. 새 요청 없이 다시 조회해주세요.' }, 503);
}
