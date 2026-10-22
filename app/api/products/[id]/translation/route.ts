import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { listTranslationJobs, getTranslationJob, createTranslationJob, approveTranslationJob, claimTranslationJob, finishTranslationJob, findIntakeTranslation, findIntakeOptionsTranslation, refreshUnstartedIntake, findOptionsRetryTranslation, createOptionsRetryTranslation, hasUnsettledTranslation,findSeoRetryTranslation,createSeoRetryTranslation,readSeoRetrySource,readWorkersRecoverySource,findWorkersRecoveryTranslation,createWorkersRecoveryTranslation } from '@/db/translation-jobs';
import { fingerprint } from '@/app/automation/model';
import { optionsRetryProof } from '@/app/options-translation-retry';
import { intakeOptionsReviewProof } from '@/app/intake-options-translation';
import {seoRetryReviewProof} from '@/app/seo-translation-retry';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {CollectionCompanyError,verifyCapturedCollectionCompany} from '@/app/collection-company';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { TranslationError, translationDestination, translationConfiguration, requireTranslationConfig, validateTranslationSource, prepareTranslationReview, executeTranslation, type TranslationJob, type TranslationSecrets } from '@/app/automation/translation';
import { google429RecoveryCandidate, workersRecoveryConfiguration, requireWorkersRecoveryConfig, workersRecoveryReviewProof, WORKERS_RECOVERY_MAX_INPUT_CHARACTERS, WORKERS_RECOVERY_VERSION } from '@/app/workers-translation-recovery';
import {WORKERS_M2M_MODEL,WORKERS_M2M_STRATEGY,planWorkersM2mTranslation,WorkersM2mError} from '@/app/automation/workers-m2m-translation';

type Context = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const configuration = () => translationConfiguration(env as TranslationSecrets);
const recoveryConfiguration = () => workersRecoveryConfiguration(env as TranslationSecrets);
const unavailable = () => json({ error: '번역 요청 저장소에 연결하지 못했습니다. 실행 이력을 확인한 뒤 진행해주세요.' }, 503);
const conflict = () => json({ error: '상품·콘텐츠·설정 또는 승인 상태가 변경되었습니다. 새 검토 요청을 만들어주세요.', code: 'TRANSLATION_CONFLICT' }, 409);
async function seoCompany(owner:string){const user=await getChatGPTUser();return user?.verifiedAccess&&user.userId===owner?approvedSupplierHubCompany(user.membership):null;}
async function verifyTranslationCompany(owner:string,productId:string){
  const {findProductCollection}=await import('@/db/collection-products');
  const link=await findProductCollection(owner,productId);
  // Manual legacy products have no collection company to infer from today's
  // login. A linked product instead keeps its exact captured context.
  if(!link)return true;
  const {findCollectionJob}=await import('@/db/collection-jobs');
  const collection=await findCollectionJob(owner,link.job_id);
  if(!collection||collection.product_id!==productId)return false;
  verifyCapturedCollectionCompany(collection.context,await seoCompany(owner));
  return true;
}

export async function GET(request: Request, context: Context) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({ error: '운영 인증 연결 후 사용할 수 있습니다.' }, 503);
  try {
    const owner = await getWorkspaceOwnerId(); const { id } = await context.params;
    const product = await findProduct(owner, id);
    if (!product) return json({ error: '상품을 찾을 수 없습니다.' }, 404);
    const retryKey = new URL(request.url).searchParams.get('retryKey');
    const seoRetryKey=new URL(request.url).searchParams.get('seoRetryKey');
    if(retryKey!==null&&seoRetryKey!==null)return json({error:'재시도 범위는 하나만 선택해주세요.'},400);
    if(seoRetryKey!==null){
      if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(seoRetryKey))return json({error:'SEO 재시도 키를 확인해주세요.'},400);
      const company=await seoCompany(owner);if(!company)return json({error:'승인된 회원 회사정보가 필요합니다.'},403);
      if(!await findProduct(owner,id,true))return json({error:'현재 상품을 찾을 수 없습니다.'},404);
      const job=await findSeoRetryTranslation(owner,id,seoRetryKey),proof=job?seoRetryReviewProof(job.review):null;
      if(job&&(!proof||proof.retryKey!==seoRetryKey||proof.company.code!==company.code||proof.company.name!==company.name))return conflict();
      let sourceCurrent:boolean|null=null;
      if(job&&proof){
        try{const {readProductOptions}=await import('@/db/product-options');const [source,options,content]=await Promise.all([readSeoRetrySource(owner,id,product.source_url,company),readProductOptions(owner,id),readProductContent(owner,id)]);
          sourceCurrent=source.sourceFingerprint===proof.sourceFingerprint&&JSON.stringify(source.source)===JSON.stringify(job.review.source)
            &&options.revision===proof.optionRevision&&content.revision===job.contentRevision&&product.updated_at===job.productVersion;
        }catch{sourceCurrent=false;}
      }
      return json({productId:id,productVersion:product.updated_at,retryKey:seoRetryKey,job,sourceCurrent,configuration:configuration()});
    }
    if (retryKey !== null) {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(retryKey)) return json({ error: '옵션 재시도 키를 확인해주세요.' }, 400);
      const job = await findOptionsRetryTranslation(owner, id, retryKey);
      if (job && optionsRetryProof(job)?.retryKey !== retryKey) return conflict();
      return json({ productId: id, productVersion: product.updated_at, retryKey, job, configuration: configuration() });
    }
    return json({ jobs: await listTranslationJobs(owner, id), configuration: configuration(), workersRecovery: recoveryConfiguration() });
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
    // Check before preparing/replaying a job, approving/claiming it or sending
    // any source text to Google/AI. GET history stays read-only and unchanged.
    if(!await verifyTranslationCompany(owner,id))return conflict();
    const requestedJob=['approve','execute'].includes(String(body.action))&&typeof body.jobId==='string'&&/^[a-f0-9-]{36}$/.test(body.jobId)
      ? await getTranslationJob(owner,id,body.jobId) : null;
    const requestedProof=requestedJob?workersRecoveryReviewProof(requestedJob.review):null;
    let config = ['prepare-collected-workers','prepare-collected-m2m'].includes(String(body.action))||requestedProof
      ? requireWorkersRecoveryConfig(env as TranslationSecrets,requestedProof??undefined,body.action==='prepare-collected-workers') : requireTranslationConfig(env as TranslationSecrets);
    if(body.action==='prepare-collected-workers'||body.action==='prepare-collected-m2m'){
      const strategy=body.action==='prepare-collected-m2m'?WORKERS_M2M_STRATEGY:undefined;
      if(Object.keys(body).some(key=>!['action','expectedVersion','idempotencyKey','failedJobId'].includes(key))
        ||typeof body.idempotencyKey!=='string'||!(/^[a-zA-Z0-9_-]{8,100}$/).test(body.idempotencyKey)
        ||typeof body.failedJobId!=='string'||!(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/).test(body.failedJobId))
        throw new TranslationError('INVALID_REQUEST','별도 초안의 실패 이력과 중복 방지 키를 확인해주세요.');
      if(body.expectedVersion!==product.updated_at||!await findProduct(owner,id,true))return conflict();
      const company=await seoCompany(owner);if(!company)return json({error:'승인된 회원 회사정보가 필요합니다.'},403);
      const [failed,previous,captured,content]=await Promise.all([getTranslationJob(owner,id,body.failedJobId),findWorkersRecoveryTranslation(owner,id,body.failedJobId,strategy),
        readWorkersRecoverySource(owner,id,product.source_url,company),readProductContent(owner,id)]);
      const {intakeSupplierSourceMatches}=await import('@/app/intake-supplier-source');
      if(!google429RecoveryCandidate(failed)||!intakeSupplierSourceMatches(failed!.review.source,captured.receipt,captured.collection))return conflict();
      if(JSON.stringify(captured.source).length>WORKERS_RECOVERY_MAX_INPUT_CHARACTERS)
        throw new TranslationError('WORKERS_RECOVERY_SOURCE_TOO_LARGE','무료 별도 초안의 원문 길이 한도를 넘었습니다. 저장 원문과 기존 번역 이력은 유지했습니다.');
      if(previous){const proof=workersRecoveryReviewProof(previous.review);
        if(!proof||proof.strategy!==strategy||proof.failedJobId!==body.failedJobId||proof.company.code!==company.code||proof.company.name!==company.name
          ||proof.sourceFingerprint!==captured.sourceFingerprint||proof.optionRevision!==captured.optionRevision
          ||previous.productVersion!==product.updated_at||previous.contentRevision!==content.revision||JSON.stringify(previous.review.source)!==JSON.stringify(captured.source))return conflict();
        const expiredUnstarted=['prepared','approved'].includes(previous.status)&&Date.parse(previous.review.expiresAt)<=Date.now()
          &&!previous.startedAt&&!previous.result&&!previous.error;
        if(!expiredUnstarted)return json({job:previous,replayed:true,configuration:configuration(),workersRecovery:recoveryConfiguration(),workersRecoveryReview:true});
      }
      if(await hasUnsettledTranslation(owner,id))return conflict();
      const maxCalls=strategy?planWorkersM2mTranslation(captured.source).requests.length:0;if(strategy&&maxCalls<1)throw new TranslationError('M2M_NOT_REQUIRED','별도 호출이 필요한 저장 원문이 없습니다. 현재 상품의 한국어 입력을 확인해주세요.');
      const workersRecovery:NonNullable<TranslationJob['review']['workersRecovery']>={...(strategy?{strategy,maxCalls}:{version:WORKERS_RECOVERY_VERSION}),model:config.model,failedJobId:body.failedJobId,scope:'collected',optionRevision:captured.optionRevision,sourceFingerprint:captured.sourceFingerprint,company};
      const prepared=await prepareTranslationReview(captured.source,config);
      const paidNotice=strategy?`저장된 상품명·옵션·선택된 속성 텍스트를 Cloudflare M2M100 전용 모델로 중국어(zh)→한국어(ko) 번역합니다. 최대 ${maxCalls}회 호출하며 각각 견적 AI와 공유하는 일일 40회 무료 요청 한도에서 차감합니다. 원문 식별자·카테고리·참고 메모는 모델에 보내지 않습니다. 길이·호출 한도 밖 항목은 원문에 보존하고 검토 화면에서 알립니다. Google 기본 번역과 이전 실패 이력은 유지하며 무료 한도·오류·시간초과 이후 자동 재시도나 다른 모델 전환을 하지 않습니다. 결과는 직접 검토한 항목만 적용하세요.`:'저장된 이 상품의 수집 원문과 미번역 옵션을 Cloudflare Workers AI에 별도로 1회 전송합니다. 확인된 Workers Free 설정에서 견적 AI와 공유하는 일일 40회 한도를 사용하며 출력은 2,048토큰으로 제한합니다. Google 기본 번역과 실패 이력은 유지합니다. 무료 한도·오류·시간초과 이후 자동 재시도나 다른 유료 서비스 전환은 하지 않습니다. 결과는 검토한 항목만 적용하세요.';
      const review={...prepared,paidNotice,workersRecovery,fingerprint:await fingerprint({review:prepared.fingerprint,workersRecovery,paidNotice})};
      const value:TranslationJob={id:crypto.randomUUID(),productId:id,productVersion:product.updated_at,contentRevision:content.revision,status:'prepared',review,result:null,error:null,
        createdAt:new Date().toISOString(),approvedAt:null,startedAt:null,finishedAt:null};
      const requestFingerprint=await fingerprint({source:captured.source,productVersion:value.productVersion,contentRevision:value.contentRevision,workersRecovery,model:config.model,maxOutputTokens:config.maxOutputTokens});
      const saved=await createWorkersRecoveryTranslation(owner,value,body.failedJobId,requestFingerprint,captured.optionRevision,captured.guard,strategy);
      if(!saved||saved.conflict)return conflict();
      return json({job:saved.job,replayed:saved.replayed,configuration:configuration(),workersRecovery:recoveryConfiguration(),workersRecoveryReview:true},saved.replayed?200:201);
    }
    if(body.action==='prepare-seo-retry'){
      if(Object.keys(body).some(key=>!['action','expectedVersion','retryKey'].includes(key))||typeof body.retryKey!=='string'
        ||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.retryKey))throw new TranslationError('INVALID_REQUEST','SEO 재시도 범위와 중복 방지 키를 확인해주세요.');
      if(config.provider!=='google-free'||config.model!=='google-translate-gtx'||body.expectedVersion!==product.updated_at||!await findProduct(owner,id,true))return conflict();
      const company=await seoCompany(owner);if(!company)return json({error:'승인된 회원 회사정보가 필요합니다.'},403);
      const {readProductOptions}=await import('@/db/product-options');
      const [captured,options,content,previous]=await Promise.all([readSeoRetrySource(owner,id,product.source_url,company),readProductOptions(owner,id),readProductContent(owner,id),findSeoRetryTranslation(owner,id,body.retryKey)]);
      if(previous){const proof=seoRetryReviewProof(previous.review);
        if(!proof||proof.retryKey!==body.retryKey||proof.sourceFingerprint!==captured.sourceFingerprint||proof.optionRevision!==options.revision
          ||previous.productVersion!==product.updated_at||previous.contentRevision!==content.revision||JSON.stringify(previous.review.source)!==JSON.stringify(captured.source)
          ||previous.review.destination!==translationDestination(config)||previous.review.model!==config.model||previous.review.maxOutputTokens!==config.maxOutputTokens)return conflict();
        return json({job:previous,replayed:true,configuration:configuration()});
      }
      if(await hasUnsettledTranslation(owner,id))return conflict();
      const seoRetry={retryKey:body.retryKey,scope:'seo' as const,optionRevision:options.revision,sourceFingerprint:captured.sourceFingerprint,company};
      const prepared=await prepareTranslationReview(captured.source,config),paidNotice='현재 상품에 저장된 수집 상품명·설명 텍스트만 사용자 지정 Google 번역 주소로 보냅니다. 옵션값·카테고리·참고 메모는 보내지 않습니다. 새 SEO 초안은 검토 후 원하는 항목만 적용하며 기존 입력은 자동으로 저장하지 않습니다.';
      const review={...prepared,paidNotice,seoRetry,fingerprint:await fingerprint({review:prepared.fingerprint,seoRetry,paidNotice})};
      const value:TranslationJob={id:crypto.randomUUID(),productId:id,productVersion:product.updated_at,contentRevision:content.revision,status:'prepared',review,result:null,error:null,createdAt:new Date().toISOString(),approvedAt:null,startedAt:null,finishedAt:null};
      const requestFingerprint=await fingerprint({source:captured.source,productVersion:value.productVersion,contentRevision:value.contentRevision,seoRetry,model:config.model,maxOutputTokens:config.maxOutputTokens});
      const saved=await createSeoRetryTranslation(owner,value,body.retryKey,requestFingerprint,options.revision,captured.guard);
      if(!saved||saved.conflict)return conflict();return json({job:saved.job,replayed:saved.replayed,configuration:configuration()},saved.replayed?200:201);
    }
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
          if(resumeCompleted){
            const {findProductCollection}=await import('@/db/collection-products');
            const {readCollectionResult}=await import('@/db/collection-results');
            const {findCollectionJob}=await import('@/db/collection-jobs');
            const {parseCollectionRequest}=await import('@/app/sourcing');
            const {intakeSupplierSourceMatches}=await import('@/app/intake-supplier-source');
            const link=await findProductCollection(owner,id);if(!link)return conflict();
            const [receipt,collection]=await Promise.all([readCollectionResult(owner,link.job_id),findCollectionJob(owner,link.job_id)]);
            if(!receipt||!collection||parseCollectionRequest({urls:[product.source_url]})[0].offerId!==receipt.result.offerId)return conflict();
            if(!intakeSupplierSourceMatches(prior.review.source,receipt.result,collection))
              return json({job:prior,replayed:true,intakeSourceChanged:true,autoDraft:false,productVersion:product.updated_at,configuration:configuration()});
          }
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
      const previous = recoveryJobs.find(item => !Object.hasOwn(item.review,'optionsRetry') && item.productVersion === product.updated_at && item.contentRevision === content.revision &&
        item.review.destination === translationDestination(config) && item.review.model === config.model && item.review.maxOutputTokens === config.maxOutputTokens && JSON.stringify(item.review.source) === JSON.stringify(source) &&
        (!['prepared', 'approved'].includes(item.status) || Date.parse(item.review.expiresAt) > Date.now()));
      if (previous && !autoDraft) return json({ job: previous, replayed: true, remainingOptions, configuration: configuration() });
      const prepared = await prepareTranslationReview(source, config);
      const intakeOptions = optionsOnly && config.provider === 'google-free'
        ? { initialJobId: initialIntake!.id, optionRevision: options.revision, scope: 'options' as const } : null;
      const paidNotice = '저장된 최초 SEO 초안을 유지하고 수집 원문에 연결된 미번역 옵션값만 사용자 지정 Google 번역 주소로 보냅니다. 상품명·설명은 검토 문맥으로만 보존하며 번역에 전송하지 않습니다. 참고 메모·카테고리·옵션 ID도 보내지 않습니다. API 키나 유료 AI는 사용하지 않으며 실패 후 자동 재시도하지 않습니다.';
      const review = intakeOptions ? { ...prepared, paidNotice, intakeOptions,
        fingerprint: await fingerprint({ review: prepared.fingerprint, intakeOptions, paidNotice }) } : prepared;
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
    const existing = requestedJob??await getTranslationJob(owner, id, body.jobId);
    if (!existing) return json({ error: '번역 요청을 찾을 수 없습니다.' }, 404);
    const workersProof=workersRecoveryReviewProof(existing.review);
    if(workersProof)config=requireWorkersRecoveryConfig(env as TranslationSecrets,workersProof);
    if (existing.review.destination !== translationDestination(config) || existing.review.model !== config.model || existing.review.maxOutputTokens !== config.maxOutputTokens) return conflict();
    let intakeProof;
    try { intakeProof = intakeOptionsReviewProof(existing.review); }
    catch { return conflict(); }
    if (intakeProof && (body.action === 'approve' || ['prepared','approved'].includes(existing.status))) {
      const { findProductCollection } = await import('@/db/collection-products');
      const { readCollectionResult } = await import('@/db/collection-results');
      const { findCollectionJob } = await import('@/db/collection-jobs');
      const { readProductOptions } = await import('@/db/product-options');
      const { collectedSeoSource } = await import('@/app/collected-seo-source');
      const link = await findProductCollection(owner,id); if (!link) return conflict();
      const [initial, batch, receipt, collection, options, content, recoveryJobs] = await Promise.all([
        findIntakeTranslation(owner,id), findIntakeOptionsTranslation(owner,id,await fingerprint(existing.review.source.attributes)),
        readCollectionResult(owner,link.job_id), findCollectionJob(owner,link.job_id), readProductOptions(owner,id),
        readProductContent(owner,id), listTranslationJobs(owner,id),
      ]);
      if (!initial || initial.id !== intakeProof.initialJobId || initial.id === existing.id || initial.status !== 'completed' || !initial.result
        || batch?.id !== existing.id || !receipt || !collection || options.productId !== id || options.revision !== intakeProof.optionRevision
        || existing.productVersion !== product.updated_at || existing.contentRevision !== content.revision
        || initial.result.model !== initial.review.model
        || ![initial.result.draft?.title,initial.result.draft?.description].some(value => typeof value === 'string' && value.trim())
        || ['intakeOptions','optionsRetry','seoRetry'].some(key => Object.hasOwn(initial.review,key))) return conflict();
      const contextSource = (source: typeof existing.review.source) => ({ title: source.title, description: source.description,
        reference: source.reference, category: source.category, guidance: source.guidance });
      if (JSON.stringify(contextSource(initial.review.source)) !== JSON.stringify(contextSource(existing.review.source))) return conflict();
      if (!recoveryJobs.some(job => job.id === initial.id)) recoveryJobs.push(initial);
      const current = collectedSeoSource(receipt.result,collection,options,true,recoveryJobs).source;
      if (JSON.stringify(current) !== JSON.stringify(existing.review.source)) return conflict();
    }
    const seoProof=seoRetryReviewProof(existing.review);
    let seoSource;
    if(workersProof){
      const company=await seoCompany(owner);if(!company||company.code!==workersProof.company.code||company.name!==workersProof.company.name)return conflict();
      const [captured,failed,content]=await Promise.all([readWorkersRecoverySource(owner,id,product.source_url,company),getTranslationJob(owner,id,workersProof.failedJobId),readProductContent(owner,id)]);
      const {intakeSupplierSourceMatches}=await import('@/app/intake-supplier-source');
      if(!google429RecoveryCandidate(failed)||!intakeSupplierSourceMatches(failed!.review.source,captured.receipt,captured.collection)
        ||captured.sourceFingerprint!==workersProof.sourceFingerprint||JSON.stringify(captured.source)!==JSON.stringify(existing.review.source)
        ||captured.optionRevision!==workersProof.optionRevision||content.revision!==existing.contentRevision||product.updated_at!==existing.productVersion)return conflict();
      seoSource=captured.guard;
    }
    if(seoProof){
      const company=await seoCompany(owner);if(!company||company.code!==seoProof.company.code||company.name!==seoProof.company.name)return conflict();
      const {readProductOptions}=await import('@/db/product-options');
      const [captured,options,content]=await Promise.all([readSeoRetrySource(owner,id,product.source_url,company),readProductOptions(owner,id),readProductContent(owner,id)]);
      if(captured.sourceFingerprint!==seoProof.sourceFingerprint||JSON.stringify(captured.source)!==JSON.stringify(existing.review.source)||options.revision!==seoProof.optionRevision
        ||content.revision!==existing.contentRevision||product.updated_at!==existing.productVersion)return conflict();seoSource=captured.guard;
    }
    if (body.action === 'approve') {
      if (body.confirmPaid !== true || body.reviewFingerprint !== existing.review.fingerprint) return json({ error: '검토한 원문과 모델의 생성 요청 승인이 필요합니다.', code: 'PAID_APPROVAL_REQUIRED' }, 400);
      if (existing.status === 'approved') return json({ job: existing, replayed: true });
      const approved = await approveTranslationJob(owner, id, existing.id, existing.review.fingerprint, new Date().toISOString(),workersProof?.optionRevision??seoProof?.optionRevision??optionsRetryProof(existing)?.optionRevision??intakeProof?.optionRevision,seoSource);
      return approved ? json({ job: approved }) : conflict();
    }
    if (['completed', 'failed', 'uncertain'].includes(existing.status)) return json({ job: existing, replayed: true });
    if (existing.status === 'running') return json({ job: existing, replayed: true, message: '이미 실행 중이거나 결과 확인이 필요합니다. 중복 호출하지 않았습니다.' }, 202);
    if (existing.status !== 'approved') return json({ error: '먼저 검토한 생성 요청을 승인해주세요.', code: 'PAID_APPROVAL_REQUIRED' }, 409);
    const claim = crypto.randomUUID();
    const claimed = await claimTranslationJob(owner, id, existing.id, existing.review.fingerprint, claim, new Date().toISOString(),workersProof?.optionRevision??seoProof?.optionRevision??optionsRetryProof(existing)?.optionRevision??intakeProof?.optionRevision,seoSource);
    if (!claimed) {
      const current = await getTranslationJob(owner, id, existing.id);
      if (current && current.status !== 'approved') return json({ job: current, replayed: true }, current.status === 'running' ? 202 : 200);
      return conflict();
    }
    let result = null; let executionError: TranslationJob['error'] = null;
    try {
      if(workersProof){
        const company=await seoCompany(owner),current=await findProduct(owner,id,true);
        if(!company||company.code!==workersProof.company.code||company.name!==workersProof.company.name||!current||current.updated_at!==claimed.productVersion)
          throw new TranslationError('WORKERS_RECOVERY_SOURCE_CHANGED','초안 실행 직전 승인 회사 또는 상품이 변경되었습니다. 원문을 전송하지 않았습니다.');
        const [captured,content]=await Promise.all([readWorkersRecoverySource(owner,id,current.source_url,company),readProductContent(owner,id)]);
        if(captured.sourceFingerprint!==workersProof.sourceFingerprint||captured.optionRevision!==workersProof.optionRevision
          ||content.revision!==claimed.contentRevision||JSON.stringify(captured.source)!==JSON.stringify(claimed.review.source))
          throw new TranslationError('WORKERS_RECOVERY_SOURCE_CHANGED','초안 실행 직전 수집 원문 또는 옵션이 변경되었습니다. 원문을 전송하지 않았습니다.');
        const {reserveQuotationAiRequest}=await import('@/db/quotation-ai-jobs');
        if(!workersProof.strategy&&!await reserveQuotationAiRequest())throw new TranslationError('WORKERS_RECOVERY_LIMIT','오늘의 무료 AI 공유 요청 한도에 도달했습니다. 원문과 기존 이력을 유지하고 자동 재시도하지 않았습니다.');
      }
      // Quota reservation is asynchronous. Recheck the exact actor and tuple
      // inside the actual send boundary, rather than trusting the earlier claim.
      const binding=config.ai,m2mPlan=workersProof?.strategy===WORKERS_M2M_STRATEGY?planWorkersM2mTranslation(claimed.review.source):null;let bindingCalls=0;
      const executionConfig=workersProof ? {...config,ai:{run:async(model:string,providerInput:Record<string,unknown>)=>{
        try{
          requireWorkersRecoveryConfig(env as TranslationSecrets,workersProof);
          if(m2mPlan){
            if(model!==WORKERS_M2M_MODEL||bindingCalls>=Number(workersProof.maxCalls)||Object.keys(providerInput).sort().join(',')!=='source_lang,target_lang,text'||providerInput.source_lang!=='zh'||providerInput.target_lang!=='ko'||providerInput.text!==m2mPlan.requests[bindingCalls])throw new TranslationError('INVALID_WORKERS_RECOVERY','검토한 전용 번역의 텍스트·언어·호출 순서와 다릅니다. 원문을 전송하지 않았습니다.');
            const {reserveQuotationAiRequest}=await import('@/db/quotation-ai-jobs');
            if(!await reserveQuotationAiRequest())throw new TranslationError('WORKERS_RECOVERY_LIMIT','오늘의 무료 AI 공유 요청 한도에 도달해 남은 전용 번역 요청을 중단했습니다. 자동 재시도하지 않았습니다.');
            bindingCalls++;
          }
          const [user,current,currentOwner]=await Promise.all([getChatGPTUser(),findProduct(owner,id,true),getWorkspaceOwnerId()]);
          const company=user?.verifiedAccess&&user.userId===owner&&user.membership?.id===owner&&['admin','member'].includes(user.membership.role)
            ? approvedSupplierHubCompany(user.membership) : null;
          if(currentOwner!==owner||!company||company.code!==workersProof.company.code||company.name!==workersProof.company.name
            ||!current||current.updated_at!==claimed.productVersion||!binding||model!==config.model)
            throw new TranslationError('WORKERS_RECOVERY_SOURCE_CHANGED','원문 전송 직전 회원·회사·상품 연결이 변경되었습니다. 원문을 전송하지 않았습니다.');
          const [captured,content]=await Promise.all([readWorkersRecoverySource(owner,id,current.source_url,company),readProductContent(owner,id)]);
          if(captured.sourceFingerprint!==workersProof.sourceFingerprint||captured.optionRevision!==workersProof.optionRevision
            ||content.revision!==claimed.contentRevision||JSON.stringify(captured.source)!==JSON.stringify(claimed.review.source))
            throw new TranslationError('WORKERS_RECOVERY_SOURCE_CHANGED','원문 전송 직전 수집 원문 또는 옵션이 변경되었습니다. 원문을 전송하지 않았습니다.');
          const latestOwner=await getWorkspaceOwnerId();
          const latestUser=await getChatGPTUser();
          const latestCompany=latestUser?.verifiedAccess&&latestUser.userId===owner&&latestUser.membership?.id===owner
            &&latestUser.membership.email===user!.membership!.email&&latestUser.membership.role===user!.membership!.role
            ? approvedSupplierHubCompany(latestUser.membership):null;
          if(latestOwner!==owner||!latestCompany||latestCompany.code!==company.code||latestCompany.name!==company.name
            ||Date.now()-Date.parse(claimed.startedAt??claimed.createdAt)>=55000)
            throw new TranslationError('WORKERS_RECOVERY_SOURCE_CHANGED','최종 원문 확인 중 회원·회사 연결이 변경되었거나 확인 시간이 지났습니다. 원문을 전송하지 않았습니다.');
          requireWorkersRecoveryConfig(env as TranslationSecrets,workersProof);
        }catch(error){
          if(error instanceof TranslationError)throw error;
          throw new TranslationError('WORKERS_RECOVERY_SOURCE_CHANGED','원문 전송 직전 현재 연결을 확인하지 못했습니다. 원문을 전송하지 않았습니다.');
        }
        return binding!.run(model,providerInput);
      }}} : config;
      result = await executeTranslation(claimed.review, executionConfig);
    }
    catch (error) { executionError = error instanceof TranslationError ? { code: error.code, message: error.message, mayHaveBeenCharged: error.mayHaveBeenCharged } : { code: 'PROVIDER_OUTCOME_UNCERTAIN', message: '실행 결과를 확인할 수 없습니다. 자동 재시도하지 않습니다.', mayHaveBeenCharged: true }; }
    try {
      const finished = await finishTranslationJob(owner, id, claimed.id, claim, result, executionError, new Date().toISOString());
      return finished ? json({ job: finished }) : json({ error: '호출 후 결과 저장 상태가 불확실합니다. 다시 생성 요청을 만들기 전에 실행 이력을 확인해주세요.', code: 'RESULT_PERSISTENCE_UNCERTAIN' }, 503);
    } catch { return json({ error: '호출 후 결과 저장에 실패했습니다. 비용이 발생했을 수 있으며 중복 호출을 차단했습니다.', code: 'RESULT_PERSISTENCE_UNCERTAIN' }, 503); }
  } catch (error) {
    if (error instanceof CollectionCompanyError) return json({ error: error.message, code: error.code },409);
    if (error instanceof TranslationError||error instanceof WorkersM2mError) return json({ error: error.message, code: error.code, configuration: configuration(),workersRecovery:recoveryConfiguration() }, ['TRANSLATION_NOT_CONFIGURED','WORKERS_RECOVERY_NOT_CONFIGURED'].includes(error.code) ? 503 : 400);
    return unavailable();
  }
}
