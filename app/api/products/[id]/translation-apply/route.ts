import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { readProductOptions } from '@/db/product-options';
import { getTranslationJob, findIntakeTranslation, findIntakeOptionsTranslation, listTranslationJobs,readSeoRetrySource } from '@/db/translation-jobs';
import { saveIntegratedTranslation } from '@/db/translation-adoption';
import { integratedTranslationPlan, applyIntegratedOptions } from '@/app/translation-integrated-adoption';
import { applyContentPatch } from '@/app/product-content';
import { applySeoDocumentTitlePolicy } from '@/app/seo-title-document';
import { fingerprint } from '@/app/automation/model';
import { readBoundedJson } from '@/app/request-body';
import { readTranslationCategorySource } from '@/db/translation-category-source';
import { getAttributeRules } from '@/db/quotation-attribute-rules';
import { applyIntakeAttributeRules } from '@/app/intake-attribute-rules';
import { savedRegistrationSettings } from '@/app/workspace-settings';
import {capturedAttributeCategory,attributeCategorySchema} from '@/app/quotation-attribute-schema';
import { intakeTranslationReplayContent, intakeTranslationReplayJob } from '@/app/intake-translation-replay';
import { collectionSourceReference, parseCollectionRequest } from '@/app/sourcing';
import { optionsRetryProof, optionsRetryApplicationFingerprint } from '@/app/options-translation-retry';
import { intakeOptionsReviewProof } from '@/app/intake-options-translation';
import {seoRetryReviewProof} from '@/app/seo-translation-retry';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {GOOGLE_TEXT_MODEL,WORKERS_TEXT_MODEL} from '@/app/automation/translation';
import {intakeSupplierSourceMatches} from '@/app/intake-supplier-source';
import { applyInitialIntakeSeoGuidance, initialIntakeSeoGuidancePending, applySeoGuidanceComposition, validateSeoGuidanceComposition, type SeoGuidanceComposition } from '@/app/seo-guidance-composition';
import { verifyCapturedCollectionCompany } from '@/app/collection-company';

type Context = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: Request, context: Context) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({ error: '운영 인증 연결이 필요합니다.' }, 503);
  let body: Record<string, unknown>;
  let seoComposition: SeoGuidanceComposition | undefined;
  try {
    if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) throw Error('같은 사이트에서 요청해주세요.');
    const value = await readBoundedJson(request, 16 * 1024);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('요청 객체가 필요합니다.');
    body = value as Record<string, unknown>;
    if (Object.keys(body).some(key => !['action','jobId','expectedVersion','fingerprint','scope','seoComposition'].includes(key)) || !['preview','apply'].includes(String(body.action))
      || (body.scope !== undefined && body.scope !== 'all' && body.scope !== 'options')
      || typeof body.jobId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.jobId) || typeof body.expectedVersion !== 'string'
      || (body.action === 'apply' && (typeof body.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.fingerprint)))) throw Error('검토 요청과 저장 지문을 확인해주세요.');
    if (body.seoComposition !== undefined) {
      if (body.scope === 'options') throw Error('옵션 전용 적용에는 SEO 구성안을 사용할 수 없습니다.');
      seoComposition = validateSeoGuidanceComposition(body.seoComposition);
    }
  } catch (error) { return json({ error: error instanceof Error ? error.message : '잘못된 요청입니다.' }, 400); }
  try {
    const owner = await getWorkspaceOwnerId(), { id } = await context.params;
    const product = await findProduct(owner, id);
    if (!product) return json({ error: '상품을 찾을 수 없습니다.' }, 404);
    if (product.updated_at !== body.expectedVersion) return json({ error: '상품이 변경되었습니다. 최신 상품에서 다시 검토해주세요.' }, 409);
    const [content, options, job] = await Promise.all([readProductContent(owner, id), readProductOptions(owner, id), getTranslationJob(owner, id, body.jobId as string)]);
    if (!job) return json({ error: '번역 결과를 찾을 수 없습니다.' }, 404);
    const scope = body.scope === 'options' ? 'options' : 'all';
    try {
      const intakeProof = intakeOptionsReviewProof(job.review);
      if (intakeProof && (scope !== 'options' || job.productVersion === product.updated_at && intakeProof.optionRevision !== options.revision))
        return json({ error: '자동 옵션 번역은 검토한 미번역 옵션에만 적용할 수 있습니다. 현재 옵션을 다시 확인해주세요.' },409);
    } catch { return json({ error: '자동 옵션 번역 원문 연결을 확인하지 못했습니다.' },409); }
    let seoSource;
    try{
      const seoProof=seoRetryReviewProof(job.review);
      if(seoProof){
        const user=await getChatGPTUser(),company=user?.verifiedAccess&&user.userId===owner?approvedSupplierHubCompany(user.membership):null;
        if(scope!=='all'||!company||company.code!==seoProof.company.code||company.name!==seoProof.company.name||options.revision!==seoProof.optionRevision)throw Error('SEO 재시도의 승인 회사·옵션 버전·적용 범위가 다릅니다.');
        const captured=await readSeoRetrySource(owner,id,product.source_url,company);
        if(captured.sourceFingerprint!==seoProof.sourceFingerprint||JSON.stringify(captured.source)!==JSON.stringify(job.review.source))throw Error('SEO 재시도 이후 수집 원문 또는 카테고리가 변경되었습니다.');
        seoSource=captured.guard;
      }
    }catch(error){return json({error:error instanceof Error?error.message:'SEO 재시도 원문을 확인하지 못했습니다.'},409);}
    let retryProof;
    try { retryProof = optionsRetryProof(job); }
    catch { return json({error:'옵션 재시도 원문 연결을 확인하지 못했습니다.'},409); }
    if (retryProof && (scope !== 'options' || retryProof.optionRevision !== options.revision))
      return json({error:'이 재시도는 검토한 미번역 옵션에만 적용할 수 있습니다. 현재 옵션을 다시 확인해주세요.'},409);
    let categorySource;
    try {
      if (job.review.source.category) categorySource = await readTranslationCategorySource(owner, id, product.source_url, job.review.source.category.id);
    } catch (error) { return json({ error: error instanceof Error ? error.message : '상품 카테고리를 확인하지 못했습니다.' }, 409); }
    let plan;
    let canonicalIntake=false;
    let intakeSeoGuidance: {jobId:string;contentRevision:number;needsReview:boolean;warnings:string[]} | undefined;
    let pendingGuidance: ReturnType<typeof applyInitialIntakeSeoGuidance>['pendingFields'] | undefined;
    try {
      if(seoComposition){
        // An ordinary/manual review may omit category metadata; an existing
        // captured company must still be checked and guarded with the save.
        if(!categorySource){
          let offerId:string|null=null;try{offerId=parseCollectionRequest({urls:[product.source_url]})[0].offerId;}catch{ /* Legacy non-1688 manual product. */ }
          if(offerId){const {readQuotationCollectionSource}=await import('@/db/quotation-fields');categorySource={offerId,snapshot:await readQuotationCollectionSource(owner,offerId,id)};}
        }
        if(categorySource?.snapshot?.linked){
          const user=await getChatGPTUser(),company=user?.verifiedAccess&&user.userId===owner?approvedSupplierHubCompany(user.membership):null;
          verifyCapturedCollectionCompany(JSON.parse(categorySource.snapshot.payload),company);
        }
      }
      // A completed canonical intake job can outlive source supplementation.
      // Check its current receipt even when product/content clocks still match;
      // then carry this exact effective payload into the atomic save guard.
      // Independent manual jobs and options-only plans keep their own scopes.
      if(scope==='all'&&categorySource?.snapshot?.linked){
        const initial=await findIntakeTranslation(owner,id);
        if(initial?.id===job.id){
          const user=await getChatGPTUser(),company=user?.verifiedAccess&&user.userId===owner?approvedSupplierHubCompany(user.membership):null;
          if(!company)throw Error('현재 승인된 회사와 수집 원문을 확인한 뒤 번역 요청을 다시 준비해주세요.');
          const {findCollectionJob}=await import('@/db/collection-jobs');
          const current=await readSeoRetrySource(owner,id,product.source_url,company),collection=await findCollectionJob(owner,current.guard.jobId);
          if(!collection||collection.updated_at!==current.guard.jobUpdatedAt||JSON.stringify(collection.context)!==current.guard.contextPayload
            ||!intakeSupplierSourceMatches(job.review.source,JSON.parse(current.guard.resultPayload),collection))
            throw Error('수집 원문이 변경되었습니다. 기존 번역 이력과 수정값은 유지합니다. 새 원문으로 번역 요청을 다시 준비하고 검토해주세요.');
          seoSource=current.guard;
          canonicalIntake=true;
        }
      }
      let applicationJob=job;
      let intakeReplay=false;
      // Content saves can advance their revision within the same product clock
      // tick. Both guards must use the canonical, source-bound replay path.
      if(job.productVersion!==product.updated_at || job.contentRevision!==content.revision){
        const initial=await findIntakeTranslation(owner,id);
        const optionBatch=scope==='options' && initial?.id!==job.id
          ? await findIntakeOptionsTranslation(owner,id,await fingerprint(job.review.source.attributes)) : null;
        if((initial?.id!==job.id && optionBatch?.id!==job.id) || job.status!=='completed' || !job.result)throw Error('생성 이후 콘텐츠가 변경되었습니다. 저장된 결과를 다시 검토해주세요.');
        intakeReplay=initial?.id===job.id && job.contentRevision!==content.revision;
        if (intakeReplay && (!categorySource?.snapshot?.linked || job.review.source.reference !== collectionSourceReference(categorySource.snapshot.id, product.source_url)
          || JSON.stringify(job.review.source.category?.path) !== JSON.stringify(JSON.parse(categorySource.snapshot.payload).category.categoryPath))) throw Error('생성 원문과 현재 상품의 수집 연결이 다릅니다. 저장된 결과를 다시 검토해주세요.');
        // A canonical intake result can fill untouched source fields while
        // retaining later edits. Option bindings still require exact originals.
        applicationJob=intakeTranslationReplayJob({...job,productVersion:product.updated_at,contentRevision:content.revision}, options);
      }
      // Use the immutable intake settings, not settings changed after collection.
      const capturedSettings = categorySource?.snapshot?.linked ? JSON.parse(categorySource.snapshot.payload)?.settings : null;
      const hiddenAttributes = typeof capturedSettings?.hiddenAttributes === 'boolean' ? capturedSettings.hiddenAttributes : undefined;
      const intakeBrand = capturedSettings ? savedRegistrationSettings(capturedSettings).brand.split(',')[0].trim() : undefined;
      const optionRecoveryJobs = job.review.instructionsVersion==='sourceflow-translation-v6' ? await listTranslationJobs(owner,id) : [];
      if (optionRecoveryJobs.length === 20) {
        // listTranslationJobs is intentionally bounded. An older canonical
        // intake proof must remain available to the exact-copy detector;
        // current option source/provenance checks still decide each adoption.
        const canonical = await findIntakeTranslation(owner,id);
        if (canonical && !optionRecoveryJobs.some(value => value.id === canonical.id)) optionRecoveryJobs.push(canonical);
      }
      const planningContent=intakeReplay ? intakeTranslationReplayContent(content,job) : content;
      plan = integratedTranslationPlan(planningContent, options, applicationJob, product.updated_at, scope, hiddenAttributes, intakeBrand,
        intakeReplay && !!content.categoryAttributes,optionRecoveryJobs);
      if (seoComposition) plan = applySeoGuidanceComposition(plan,content,applicationJob,seoComposition);
      else if(canonicalIntake&&job.review.source.guidance&&job.status==='completed'&&job.result
        &&job.review.destination==='Google 번역'&&job.review.model===GOOGLE_TEXT_MODEL&&job.result.model===GOOGLE_TEXT_MODEL
        &&job.review.instructionsVersion==='sourceflow-translation-v6'
        &&!['optionsRetry','intakeOptions','seoRetry'].some(key=>Object.hasOwn(job.review,key))){
        // The source CAS above proves this exact company, intake context and
        // receipt. Owner-written SEO stays separate from provider/supplier facts.
        const composed=applyInitialIntakeSeoGuidance(plan,planningContent,applicationJob,{brand:intakeBrand??'',...job.review.source.guidance});
        plan=composed.plan;plan.skipped.push(...composed.warnings);
        pendingGuidance=composed.pendingFields;
        intakeSeoGuidance={jobId:job.id,contentRevision:content.revision,needsReview:composed.warnings.length>0,warnings:composed.warnings};
      }
    }
    catch (error) { return json({ error: error instanceof Error ? error.message : '번역 연결을 확인해주세요.' }, 409); }
    let attributeRules;
    if (plan.categoryAttributes) {
      const savedRules = await getAttributeRules(owner, plan.categoryAttributes.categoryId);
      attributeRules = { categoryId: plan.categoryAttributes.categoryId, payload: savedRules ? JSON.stringify(savedRules.rules) : null };
      if (attributeRules.payload) {
        try {
          const applied = applyIntakeAttributeRules(plan.categoryAttributes, attributeRules.payload,
            attributeCategorySchema(plan.categoryAttributes.categoryId,capturedAttributeCategory(plan.categoryAttributes.categoryId,categorySource)));
          plan.categoryAttributes = applied.snapshot; plan.skipped.push(...applied.skipped);
          plan.preview.push(...applied.preview);
        } catch (error) { return json({ error: error instanceof Error ? error.message : '카테고리 연결 규칙을 확인해주세요.' }, 409); }
      }
    }
    const digest = await fingerprint({ productId: id, productVersion: product.updated_at, imageKeys: product.image_keys, content, options, job, plan, scope, categorySource: categorySource ?? null, seoSource:seoSource??null,
      ...(seoComposition ? {seoComposition} : {}) });
    const optionsRetry = retryProof ? {applicationFingerprint:await optionsRetryApplicationFingerprint(job,
      applyContentPatch(content,plan.patch??{},'options-retry-application'),applyIntegratedOptions(options,plan,'options-retry-application'),'options-retry-application')} : null;
    let intakeSeoCoverage;
    if(scope==='all'&&job.status==='completed'&&job.result&&job.result.model===job.review.model
      &&(job.review.destination==='Google 번역'&&job.review.model===GOOGLE_TEXT_MODEL
        ||job.review.destination==='Cloudflare Workers AI'&&job.review.model===WORKERS_TEXT_MODEL)
      &&job.review.instructionsVersion==='sourceflow-translation-v6'
      &&!Object.hasOwn(job.review,'optionsRetry')&&!Object.hasOwn(job.review,'intakeOptions')&&!Object.hasOwn(job.review,'seoRetry')
      &&job.review.source.description.trim()&&!job.result.draft.description.trim()){
      const initial=await findIntakeTranslation(owner,id);
      if(initial?.id===job.id)intakeSeoCoverage={jobId:job.id,contentRevision:content.revision,missingDescription:content.seo.description.provenance!=='manual'};
    }
    const preview = { scope, productId: id, productVersion: product.updated_at, contentRevision: content.revision, optionRevision: options.revision, fingerprint: digest, preview: plan.preview, skipped: plan.skipped,
      ...(intakeSeoCoverage?{intakeSeoCoverage}:{}),
      ...(intakeSeoGuidance?{intakeSeoGuidance}:{}),
      ...(optionsRetry?{optionsRetry}:{}) };
    if (body.action === 'preview') return json(preview);
    if (body.fingerprint !== digest) return json({ error: '검토 이후 자료가 변경되었습니다. 통합 미리보기를 다시 확인해주세요.' }, 409);
    if (!plan.preview.length) return json({ error: '새로 적용할 번역 항목이 없습니다.' }, 409);
    const now = new Date(Math.max(Date.now(), Date.parse(product.updated_at) + 1)).toISOString();
    const nextContent = applyContentPatch(content, plan.patch ?? {}, now), nextOptions = applyIntegratedOptions(options, plan, now);
    // Reviewed stage-one composition and the exact source-bound first intake
    // share the SEO writer. Other translation and unchanged SEO keep their basis.
    if (seoComposition || canonicalIntake) applySeoDocumentTitlePolicy(nextContent, plan.patch?.seo);
    if (plan.categoryAttributes) nextContent.categoryAttributes = plan.categoryAttributes;
    if(pendingGuidance&&Object.keys(pendingGuidance).length)nextContent.intakeSeoGuidancePending=initialIntakeSeoGuidancePending(nextContent,job,pendingGuidance);
    const saved = await saveIntegratedTranslation(owner, nextContent, nextOptions, { productVersion: product.updated_at, imageKeys: product.image_keys,
      contentRevision: content.revision, optionRevision: options.revision, jobId: job.id, jobProductVersion:job.productVersion, jobContentRevision:job.contentRevision, categorySource, attributeRules,seoSource });
    return saved ? json({ scope, productId: id, productVersion: now, contentRevision: nextContent.revision, optionRevision: nextOptions.revision, applied: plan.preview.length })
      : json({ error: '저장 중 자료가 변경되었습니다. 아무 항목도 함께 저장하지 않았습니다. 다시 검토해주세요.' }, 409);
  } catch { return json({ error: '통합 저장 상태를 확인하지 못했습니다. 저장본을 조회한 뒤 다시 검토해주세요. 자동 재저장하지 않았습니다.' }, 503); }
}
