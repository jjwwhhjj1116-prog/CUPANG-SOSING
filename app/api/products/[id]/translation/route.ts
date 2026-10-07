import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { listTranslationJobs, getTranslationJob, createTranslationJob, approveTranslationJob, claimTranslationJob, finishTranslationJob, findIntakeTranslation, findIntakeOptionsTranslation, refreshUnstartedIntake, findOptionsRetryTranslation, createOptionsRetryTranslation, hasUnsettledTranslation } from '@/db/translation-jobs';
import { fingerprint } from '@/app/automation/model';
import { optionsRetryProof } from '@/app/options-translation-retry';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { TranslationError, translationDestination, translationConfiguration, requireTranslationConfig, validateTranslationSource, prepareTranslationReview, executeTranslation, type TranslationJob, type TranslationSecrets } from '@/app/automation/translation';

type Context = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const configuration = () => translationConfiguration(env as TranslationSecrets);
const unavailable = () => json({ error: '번역 요청 저장소에 연결하지 못했습니다. 실행 이력을 확인한 뒤 진행해주세요.' }, 503);
const conflict = () => json({ error: '상품·콘텐츠·설정 또는 승인 상태가 변경되었습니다. 새 검토 요청을 만들어주세요.', code: 'TRANSLATION_CONFLICT' }, 409);

export async function GET(request: Request, context: Context) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({ error: '운영 인증 연결 후 사용할 수 있습니다.' }, 503);
  try {
    const owner = await getWorkspaceOwnerId(); const { id } = await context.params;
    const product = await findProduct(owner, id);
    if (!product) return json({ error: '상품을 찾을 수 없습니다.' }, 404);
    const retryKey = new URL(request.url).searchParams.get('retryKey');
    if (retryKey !== null) {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(retryKey)) return json({ error: '옵션 재시도 키를 확인해주세요.' }, 400);
      const job = await findOptionsRetryTranslation(owner, id, retryKey);
      if (job && optionsRetryProof(job)?.retryKey !== retryKey) return conflict();
      return json({ productId: id, productVersion: product.updated_at, retryKey, job, configuration: configuration() });
    }
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
    if (body.action === 'prepare-options-retry') {
      if (Object.keys(body).some(key => !['action','expectedVersion','retryKey'].includes(key))
        || typeof body.retryKey !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.retryKey))
        throw new TranslationError('INVALID_REQUEST', '옵션 재시도와 중복 방지 키를 확인해주세요.');
      if (config.provider !== 'google-free' || config.model !== 'google-translate-gtx' || body.expectedVersion !== product.updated_at) return conflict();
      const [initial, existing] = await Promise.all([findIntakeTranslation(owner,id), findOptionsRetryTranslation(owner,id,body.retryKey)]);
      if (existing) {
        const proof = optionsRetryProof(existing);
        const content = await readProductContent(owner,id);
        if (proof?.retryKey !== body.retryKey || existing.productVersion !== product.updated_at || existing.contentRevision !== content.revision
          || existing.review.destination !== translationDestination(config) || existing.review.model !== config.model || existing.review.maxOutputTokens !== config.maxOutputTokens) return conflict();
        return json({ job: existing, replayed: true, optionsOnly: true, configuration: configuration() });
      }
      const terminalFailure = initial?.status === 'failed' && initial.result === null && initial.review.destination === 'Google 번역'
        && initial.review.model === 'google-translate-gtx' && initial.error?.mayHaveBeenCharged === false
        && initial.startedAt && Number.isFinite(Date.parse(initial.startedAt)) && initial.finishedAt && Number.isFinite(Date.parse(initial.finishedAt));
      if (!(initial?.status === 'completed' && initial.result || terminalFailure) || await hasUnsettledTranslation(owner,id))
        return json({ error: '이전 번역이 실행 중이거나 결과 확인이 필요합니다. 저장된 작업을 확인한 뒤 재시도해주세요.', code: 'TRANSLATION_CONFLICT' },409);
      const { findProductCollection } = await import('@/db/collection-products');
      const { readCollectionResult } = await import('@/db/collection-results');
      const { findCollectionJob } = await import('@/db/collection-jobs');
      const { readProductOptions } = await import('@/db/product-options');
      const { parseCollectionRequest } = await import('@/app/sourcing');
      const { collectedSeoSource } = await import('@/app/collected-seo-source');
      const link = await findProductCollection(owner,id); if (!link) return conflict();
      const [receipt,collection,options,content,recoveryJobs] = await Promise.all([
        readCollectionResult(owner,link.job_id),findCollectionJob(owner,link.job_id),readProductOptions(owner,id),readProductContent(owner,id),listTranslationJobs(owner,id),
      ]);
      if (!receipt || !collection || options.productId !== id || parseCollectionRequest({urls:[product.source_url]})[0].offerId !== receipt.result.offerId) return conflict();
      if (initial && !recoveryJobs.some(job => job.id === initial.id)) recoveryJobs.push(initial);
      const {source,remainingOptions} = collectedSeoSource(receipt.result,collection,options,true,recoveryJobs);
      if (!source.attributes.length) return json({done:true,productId:id,productVersion:product.updated_at});
      const optionsRetry = { retryKey: body.retryKey, optionRevision: options.revision, scope: 'options' as const };
      const prepared = await prepareTranslationReview(source,config);
      const paidNotice='저장된 원문에 연결된 미번역 옵션값만 사용자 지정 Google 번역 주소로 한 묶음씩 보냅니다. 상품명·설명·카테고리·참고 메모·옵션 ID는 보내지 않습니다. API 키나 유료 AI는 사용하지 않으며 실패 후 자동 재시도하지 않습니다.';
      const review = {...prepared, paidNotice, optionsRetry, fingerprint: await fingerprint({review:prepared.fingerprint,optionsRetry,paidNotice})};
      const value:TranslationJob = { id:crypto.randomUUID(), productId:id, productVersion:product.updated_at, contentRevision:content.revision,
        status:'prepared',review,result:null,error:null,createdAt:new Date().toISOString(),approvedAt:null,startedAt:null,finishedAt:null };
      const requestFingerprint = await fingerprint({source,productVersion:value.productVersion,contentRevision:value.contentRevision,optionsRetry,
        destination:translationDestination(config),model:config.model,maxOutputTokens:config.maxOutputTokens});
      const saved = await createOptionsRetryTranslation(owner,value,body.retryKey,requestFingerprint,options.revision);
      if (!saved || saved.conflict) return conflict();
      return json({job:saved.job,replayed:saved.replayed,optionsOnly:true,remainingOptions,configuration:configuration()},saved.replayed?200:201);
    }
    if (body.action === 'prepare-collected' || body.action === 'prepare-intake-options') {
      const optionsOnly = body.action === 'prepare-intake-options';
      if (Object.keys(body).some(key => !(optionsOnly ? ['action','expectedVersion'] : ['action','intake']).includes(key)) || (body.intake !== undefined && body.intake !== true)) throw new TranslationError('INVALID_REQUEST', '저장된 수집 원문만 사용할 수 있습니다.');
      const autoDraft = (body.intake === true || optionsOnly) && ['workers-ai','google-free'].includes(config.provider??'');
      let staleUnstarted: TranslationJob | null = null;
      let initialIntake: TranslationJob | null = null;
      if(optionsOnly){
        initialIntake=await findIntakeTranslation(owner,id);
        if(!autoDraft || body.expectedVersion!==product.updated_at || initialIntake?.status!=='completed')return conflict();
      }
      if(autoDraft && !optionsOnly){
        const prior=await findIntakeTranslation(owner,id);
        const expiredUnstarted = prior && ['prepared','approved'].includes(prior.status) &&
          Date.parse(prior.review.expiresAt) <= Date.now() && prior.productVersion === product.updated_at;
        if(prior && ['prepared','approved'].includes(prior.status) && !prior.startedAt && !prior.result && !prior.error && prior.productVersion!==product.updated_at)staleUnstarted=prior;
        if(prior && !expiredUnstarted && !staleUnstarted){
          // The completed canonical result remains reusable after an unrelated
          // edit. Apply recomputes a selective plan against current revisions.
          const resumeCompleted=prior.status==='completed' && !!prior.result;
          return json({job:prior,replayed:true,autoDraft:resumeCompleted||prior.productVersion===product.updated_at,intakePreserved:!resumeCompleted&&prior.productVersion!==product.updated_at,
            ...(resumeCompleted?{applyVersion:product.updated_at}:{}),productVersion:product.updated_at,configuration:configuration()});
        }
      }
      const { findProductCollection } = await import('@/db/collection-products');
      const { readCollectionResult } = await import('@/db/collection-results');
      const { findCollectionJob } = await import('@/db/collection-jobs');
      const { readProductOptions } = await import('@/db/product-options');
      const { parseCollectionRequest } = await import('@/app/sourcing');
      const { collectedSeoSource } = await import('@/app/collected-seo-source');
      const link = await findProductCollection(owner, id);
      if (!link) return json({ error: '상품에 연결된 수집 원문이 없습니다.' }, 409);
      const [receipt, collection, options, content] = await Promise.all([
        readCollectionResult(owner, link.job_id), findCollectionJob(owner, link.job_id), readProductOptions(owner, id), readProductContent(owner, id),
      ]);
      if (!receipt || !collection || options.productId !== id || parseCollectionRequest({ urls: [product.source_url] })[0].offerId !== receipt.result.offerId) return conflict();
      // The owner/product-scoped history can prove an untouched v5 Chinese
      // copy. The existing detector still excludes manual values and blanks;
      // a Chinese original alone is never permission to replace saved text.
      const recoveryJobs = await listTranslationJobs(owner, id);
      // The canonical source-bound result can predate the bounded latest-20
      // history. Include that single verified proof without loading all jobs.
      if (initialIntake && !recoveryJobs.some(job => job.id === initialIntake!.id)) recoveryJobs.push(initialIntake);
      const { source, remainingOptions } = collectedSeoSource(receipt.result, collection, options, optionsOnly, recoveryJobs);
      if(optionsOnly && !source.attributes.length)return json({done:true,productId:id,productVersion:product.updated_at});
      const optionsFingerprint = optionsOnly ? await fingerprint(source.attributes) : null;
      if(optionsFingerprint){
        const completed=await findIntakeOptionsTranslation(owner,id,optionsFingerprint);
        if(completed?.status==='completed' && completed.result){
          if(JSON.stringify(completed.review.source)!==JSON.stringify(source)
            || completed.review.destination!==translationDestination(config) || completed.review.model!==config.model
            || completed.review.maxOutputTokens!==config.maxOutputTokens)return conflict();
          return json({job:completed,replayed:true,remainingOptions,autoDraft,optionsOnly:true,applyVersion:product.updated_at,configuration:configuration()});
        }
      }
      const requestFingerprint = await fingerprint({ source, productVersion: product.updated_at, contentRevision: content.revision, destination: translationDestination(config), model: config.model, maxOutputTokens: config.maxOutputTokens });
      const previous = recoveryJobs.find(item => item.productVersion === product.updated_at && item.contentRevision === content.revision &&
        item.review.destination === translationDestination(config) && item.review.model === config.model && item.review.maxOutputTokens === config.maxOutputTokens && JSON.stringify(item.review.source) === JSON.stringify(source) &&
        (!['prepared', 'approved'].includes(item.status) || Date.parse(item.review.expiresAt) > Date.now()));
      if (previous && !autoDraft) return json({ job: previous, replayed: true, remainingOptions, configuration: configuration() });
      const review = await prepareTranslationReview(source, config);
      const job: TranslationJob = { id: crypto.randomUUID(), productId: id, productVersion: product.updated_at, contentRevision: content.revision,
        status: 'prepared', review, result: null, error: null, createdAt: new Date().toISOString(), approvedAt: null, startedAt: null, finishedAt: null };
      // Reopening/retrying the same source does not create another paid job.
      const saved = staleUnstarted ? await refreshUnstartedIntake(owner,staleUnstarted,job,requestFingerprint)
        : await createTranslationJob(owner, job, optionsOnly ? `intake-options-${optionsFingerprint}` : autoDraft ? 'intake-auto-v1' : `collected-${requestFingerprint}-${Math.floor(Date.now() / 900000)}`, requestFingerprint);
      if (!saved || saved.conflict) return conflict();
      return json({ job: saved.job, replayed: saved.replayed, remainingOptions, autoDraft, optionsOnly, configuration: configuration() }, saved.replayed ? 200 : 201);
    }
    if (body.action === 'prepare') {
      if (Object.keys(body).some(key => !['action', 'source', 'expectedVersion', 'idempotencyKey'].includes(key)) || typeof body.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.idempotencyKey)) throw new TranslationError('INVALID_REQUEST', '번역 검토 요청 항목과 중복 방지 키를 확인해주세요.');
      if (body.expectedVersion !== product.updated_at) return conflict();
      const source = validateTranslationSource(body.source);
      const content = await readProductContent(owner, id);
      const review = await prepareTranslationReview(source, config);
      const job: TranslationJob = { id: crypto.randomUUID(), productId: id, productVersion: product.updated_at, contentRevision: content.revision,
        status: 'prepared', review, result: null, error: null, createdAt: new Date().toISOString(), approvedAt: null, startedAt: null, finishedAt: null };
      const requestFingerprint = await fingerprint({ source, productVersion: job.productVersion, contentRevision: job.contentRevision, destination: translationDestination(config), model: config.model, maxOutputTokens: config.maxOutputTokens });
      const saved = await createTranslationJob(owner, job, body.idempotencyKey, requestFingerprint);
      if (!saved || saved.conflict) return conflict();
      return json({ job: saved.job, replayed: saved.replayed, configuration: configuration() }, saved.replayed ? 200 : 201);
    }
    if (!['approve', 'execute'].includes(String(body.action)) || typeof body.jobId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.jobId)) throw new TranslationError('INVALID_REQUEST', '작업과 요청 종류를 확인해주세요.');
    const allowed = body.action === 'approve' ? ['action', 'jobId', 'reviewFingerprint', 'confirmPaid'] : ['action', 'jobId'];
    if (Object.keys(body).some(key => !allowed.includes(key))) throw new TranslationError('INVALID_REQUEST', '클라이언트가 모델이나 결과를 지정할 수 없습니다.');
    const existing = await getTranslationJob(owner, id, body.jobId);
    if (!existing) return json({ error: '번역 요청을 찾을 수 없습니다.' }, 404);
    if (existing.review.destination !== translationDestination(config) || existing.review.model !== config.model || existing.review.maxOutputTokens !== config.maxOutputTokens) return conflict();
    if (body.action === 'approve') {
      if (body.confirmPaid !== true || body.reviewFingerprint !== existing.review.fingerprint) return json({ error: '검토한 원문과 모델의 생성 요청 승인이 필요합니다.', code: 'PAID_APPROVAL_REQUIRED' }, 400);
      if (existing.status === 'approved') return json({ job: existing, replayed: true });
      const approved = await approveTranslationJob(owner, id, existing.id, existing.review.fingerprint, new Date().toISOString(),optionsRetryProof(existing)?.optionRevision);
      return approved ? json({ job: approved }) : conflict();
    }
    if (['completed', 'failed', 'uncertain'].includes(existing.status)) return json({ job: existing, replayed: true });
    if (existing.status === 'running') return json({ job: existing, replayed: true, message: '이미 실행 중이거나 결과 확인이 필요합니다. 중복 호출하지 않았습니다.' }, 202);
    if (existing.status !== 'approved') return json({ error: '먼저 검토한 생성 요청을 승인해주세요.', code: 'PAID_APPROVAL_REQUIRED' }, 409);
    const claim = crypto.randomUUID();
    const claimed = await claimTranslationJob(owner, id, existing.id, existing.review.fingerprint, claim, new Date().toISOString(),optionsRetryProof(existing)?.optionRevision);
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
      return finished ? json({ job: finished }) : json({ error: '호출 후 결과 저장 상태가 불확실합니다. 다시 생성 요청을 만들기 전에 실행 이력을 확인해주세요.', code: 'RESULT_PERSISTENCE_UNCERTAIN' }, 503);
    } catch { return json({ error: '호출 후 결과 저장에 실패했습니다. 비용이 발생했을 수 있으며 중복 호출을 차단했습니다.', code: 'RESULT_PERSISTENCE_UNCERTAIN' }, 503); }
  } catch (error) {
    if (error instanceof TranslationError) return json({ error: error.message, code: error.code, configuration: configuration() }, error.code === 'TRANSLATION_NOT_CONFIGURED' ? 503 : 400);
    return unavailable();
  }
}
