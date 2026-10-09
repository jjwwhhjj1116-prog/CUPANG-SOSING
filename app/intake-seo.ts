import { GOOGLE_TEXT_MODEL, translationAttributeCoverage, type TranslationJob } from '@/app/automation/translation';
import { runReviewedTranslation } from '@/app/reviewed-translation';
import { awaitIntakeTranslation } from '@/app/intake-translation-result';

/** User-started intake produces editable content; never submits to Supplier Hub. */
export async function prepareIntakeSeo(productId: string, fetcher: typeof fetch, signal: AbortSignal, onCompleted: () => void = () => {}, onReviewRequired: () => void = () => {}, onManualReady: () => void = () => {}) {
  if (signal.aborted) return '';
  let generating = false;
  // Keep source-review warnings visible at the entry point as well as in the
  // saved job history. Summarizing here never changes the provider's result.
  const warnings = new Set<string>();
  const rememberWarnings = (job: TranslationJob) => {
    if (job.productId !== productId || job.status !== 'completed' || !Array.isArray(job.result?.draft?.warnings)) return;
    for (const value of job.result.draft.warnings) {
      if (typeof value === 'string' && value.trim()) warnings.add(value.replace(/\s+/gu, ' ').trim());
    }
  };
  const withWarnings = (message: string) => {
    if (!warnings.size) return message;
    const summary = [...warnings].slice(0, 3).map(value => {
      const characters = Array.from(value);
      return characters.length > 200 ? characters.slice(0, 199).join('') + '…' : value;
    }).join(' / ');
    return `${message} AI 검토 알림 ${warnings.size}개: ${summary}${warnings.size > 3 ? ` 외 ${warnings.size - 3}개.` : ''} 전체 내용은 1단계 SEO 생성 이력에서 확인해주세요.`;
  };
  const failedGoogleDraft = (job: TranslationJob): string | null => {
    // Only an acknowledged terminal Google failure can leave a manual source
    // draft ready. Unknown execution/persistence and apply conflicts stay errors.
    if (job.productId !== productId || job.status !== 'failed' || job.result !== null
      || job.review?.destination !== 'Google 번역' || job.review.model !== GOOGLE_TEXT_MODEL
      || job.review.instructionsVersion !== 'sourceflow-translation-v6'
      || !job.error?.code || !job.error.message || job.error.mayHaveBeenCharged !== false
      || !job.startedAt || !Number.isFinite(Date.parse(job.startedAt))
      || !job.finishedAt || !Number.isFinite(Date.parse(job.finishedAt))) return null;
    onManualReady();
    return withWarnings(`원문 초안 저장 · 번역 미완료. ${job.error.message} 원문과 직접 수정한 값은 유지됩니다. 1~7단계에서 바로 확인·수정해주세요.`);
  };
  try {
    const base = `/api/products/${encodeURIComponent(productId)}`;
    let next: Record<string,unknown> = {action:'prepare-collected',intake:true};
    let appliedAny=false;
    for(let batch=0;batch<14;batch++){
    const response = await fetcher(`${base}/translation`, {
      method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(next),
    });
    const body = await response.json() as { job?: TranslationJob; error?: string; remainingOptions?: number; autoDraft?: boolean; intakePreserved?: boolean; intakeSourceChanged?:boolean; productVersion?:string; productId?:string; done?:boolean; optionsOnly?:boolean; applyVersion?:string };
    if (signal.aborted) return '';
    if(response.ok && body.done === true && next.action==='prepare-intake-options' && typeof next.expectedVersion==='string'
      && body.productId===productId && body.productVersion===next.expectedVersion){
      onCompleted();
      return withWarnings(appliedAny?'SEO·옵션 초안을 생성해 반영했습니다. 내용을 확인하고 수정해주세요.':'저장된 SEO·옵션값을 유지했습니다. 추가로 반영할 항목이 없습니다.');
    }
    if (!response.ok || body.job?.productId !== productId) return withWarnings(`상품은 저장됐지만 SEO 요청 준비는 완료되지 않았습니다. ${body.error ?? 'SEO 단계에서 다시 확인해주세요.'}`);
    rememberWarnings(body.job);
    if(body.intakeSourceChanged===true&&body.autoDraft===false&&body.job.status==='completed'&&body.job.result){
      onReviewRequired();
      return withWarnings('검토 필요 · 저장된 상품 원문이 기존 SEO 초안의 원문과 달라졌습니다. 기존 번역 이력과 수정값은 유지했습니다. 1단계에서 새 원문 전체로 번역 요청을 준비하고 검토해주세요. 자동으로 번역을 실행하거나 이전 결과를 다시 반영하지 않았습니다.');
    }
    // A failed canonical job can predate manual edits. Reuse its saved failure
    // without attempting another options request or changing current content.
    const previousFailure = failedGoogleDraft(body.job);
    if (previousFailure !== null) return previousFailure;
    if(body.intakePreserved){
      if(!body.productVersion)throw Error('현재 상품 버전을 확인하지 못했습니다.');
      next={action:'prepare-intake-options',expectedVersion:body.productVersion};continue;
    }
    const remainder=body.remainingOptions ? ` 남은 옵션 번역 항목 ${body.remainingOptions}개는 원문에 보존됩니다.` : '';
    if(!body.autoDraft || !['Cloudflare Workers AI','Google 번역'].includes(body.job.review?.destination))return withWarnings(`수집 원문·카테고리·옵션으로 SEO 요청을 준비했습니다.${remainder}`);
    generating=true;
    let job=body.job;
    if(job.status==='prepared'||job.status==='approved'){
      const executed=await runReviewedTranslation(productId,job,{signal,fetcher,onJob:()=>{}});
      if(!executed||signal.aborted)return '';
      job=executed.job;
    }
    if(job.status==='running')job=await awaitIntakeTranslation(job,fetcher,signal);
    if(signal.aborted)return '';
    const executedFailure = failedGoogleDraft(job);
    if(executedFailure !== null)return executedFailure;
    if(job.status!=='completed'||!job.result)return withWarnings(`상품은 저장됐지만 SEO 초안은 아직 반영되지 않았습니다. ${job.error?.message ?? (job.status==='running'?'생성 중입니다. 작업 상태를 다시 확인해주세요.':'생성 결과를 확인해주세요.')}`);
    rememberWarnings(job);
    const coverage=job.review.instructionsVersion==='sourceflow-translation-v6'?translationAttributeCoverage(job.review.source,job.result.draft):null;
    const stoppedStatus=job.result.googleStoppedHttpStatus;
    // Only typed evidence from this acknowledged Google result stops later
    // automatic batches. Warning text and older results are not state flags.
    const serviceStopped=job.review.destination==='Google 번역'&&job.review.model===GOOGLE_TEXT_MODEL
      &&job.review.instructionsVersion==='sourceflow-translation-v6'&&job.result.model===GOOGLE_TEXT_MODEL
      &&Number.isInteger(stoppedStatus)&&(stoppedStatus===429||(stoppedStatus??0)>=500&&(stoppedStatus??0)<=599);
    const partial=!!coverage?.missingSourceIndexes.length||serviceStopped;
    const reviewRequired=()=>{
      onReviewRequired();
      const missing=coverage?.missingSourceIndexes.length??0;
      const reason=serviceStopped?`Google 번역 HTTP ${stoppedStatus} 응답으로 남은 자동 요청을 중단했습니다.${missing?` 속성·옵션 번역 ${missing}개가 누락됐습니다.`:''}`
        :`생성 결과에서 속성·옵션 번역 ${missing}개가 누락됐습니다.`;
      return withWarnings(`검토 필요 · 상품 초안을 저장했습니다. ${reason} 미완료 항목은 번역 완료로 처리하지 않았으며 원문과 직접 수정한 값은 유지합니다. 1~7단계에서 확인·수정해주세요.${remainder}`);
    };
    const applyVersion=body.applyVersion??job.productVersion;
    const send=async(action:'preview'|'apply',fingerprint?:string)=>{
      const response=await fetcher(`${base}/translation-apply`,{method:'POST',signal,headers:{'content-type':'application/json'},body:JSON.stringify({action,jobId:job.id,expectedVersion:applyVersion,...(body.optionsOnly?{scope:'options'}:{}),...(fingerprint?{fingerprint}:{})})});
      const value=await response.json() as {error?:string;productId?:string;productVersion?:string;preview?:unknown[];fingerprint?:string;applied?:number};
      if(!response.ok)throw Error(value.error||'SEO 초안 반영 상태를 확인해주세요.');
      return value;
    };
    const preview=await send('preview');if(signal.aborted)return '';
    if(preview.productId!==productId||preview.productVersion!==applyVersion||!Array.isArray(preview.preview)||typeof preview.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(preview.fingerprint))throw Error('초안 반영 대상이 일치하지 않습니다.');
    if(!preview.preview.length){
      // A completed partial response remains reusable, but is not evidence that
      // every option is translated. A verified no-op also preserves manual edits.
      if(partial)return reviewRequired();
      // An unchanged SEO result does not mean untranslated options are done.
      // Advance without writing, retaining the version checked by preview.
      if(!body.optionsOnly){next={action:'prepare-intake-options',expectedVersion:applyVersion};continue;}
      return withWarnings(`SEO 생성 결과를 보존했습니다. 반영할 추가 항목이 없어 자동 처리를 멈췄습니다.${remainder}`);
    }
    const saved=await send('apply',preview.fingerprint);if(signal.aborted)return '';
    if(saved.productId!==productId||typeof saved.productVersion!=='string'||!Number.isFinite(Date.parse(saved.productVersion))||!Number.isInteger(saved.applied)||(saved.applied??0)<1)throw Error('초안 저장 결과를 확인해주세요.');
    if(partial)return reviewRequired();
    appliedAny=true;next={action:'prepare-intake-options',expectedVersion:saved.productVersion};
    }
    return withWarnings('SEO·옵션 초안을 일부 반영했습니다. 남은 옵션은 SEO 단계에서 확인해주세요.');
  } catch (error) {
    return signal.aborted ? '' : withWarnings(generating ? `상품과 생성 이력은 보존했습니다. ${error instanceof Error?error.message:'SEO 생성·반영 상태를 확인해주세요.'} 자동 재요청하지 않았습니다.` : '상품은 저장됐지만 SEO 요청 준비 상태를 확인하지 못했습니다. SEO 단계에서 확인해주세요.');
  }
}

/** Message text is never evidence that all pending draft fields were saved. */
export async function prepareIntakeSeoOutcome(productId: string, fetcher: typeof fetch, signal: AbortSignal) {
  let completed = false, reviewRequired = false, manualReady = false;
  const message = await prepareIntakeSeo(productId, fetcher, signal, () => { completed = true; }, () => { reviewRequired = true; }, () => { manualReady = true; });
  return { completed, reviewRequired, manualReady, message };
}
