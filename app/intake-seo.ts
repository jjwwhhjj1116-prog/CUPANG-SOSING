import type { TranslationJob } from '@/app/automation/translation';
import { runReviewedTranslation } from '@/app/reviewed-translation';
import { awaitIntakeTranslation } from '@/app/intake-translation-result';

/** User-started intake produces editable content; never submits to Supplier Hub. */
export async function prepareIntakeSeo(productId: string, fetcher: typeof fetch, signal: AbortSignal) {
  if (signal.aborted) return '';
  let generating = false;
  try {
    const base = `/api/products/${encodeURIComponent(productId)}`;
    let next: Record<string,unknown> = {action:'prepare-collected',intake:true};
    let appliedAny=false;
    for(let batch=0;batch<14;batch++){
    const response = await fetcher(`${base}/translation`, {
      method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(next),
    });
    const body = await response.json() as { job?: TranslationJob; error?: string; remainingOptions?: number; autoDraft?: boolean; intakePreserved?: boolean; productVersion?:string; productId?:string; done?:boolean; optionsOnly?:boolean };
    if (signal.aborted) return '';
    if(response.ok && body.done && body.productId===productId && body.productVersion===next.expectedVersion)return appliedAny?'SEO·옵션 초안을 생성해 반영했습니다. 내용을 확인하고 수정해주세요.':'저장된 SEO·옵션값을 유지했습니다. 추가로 반영할 항목이 없습니다.';
    if (!response.ok || body.job?.productId !== productId) return `상품은 저장됐지만 SEO 요청 준비는 완료되지 않았습니다. ${body.error ?? 'SEO 단계에서 다시 확인해주세요.'}`;
    if(body.intakePreserved){
      if(!body.productVersion)throw Error('현재 상품 버전을 확인하지 못했습니다.');
      next={action:'prepare-intake-options',expectedVersion:body.productVersion};continue;
    }
    const remainder=body.remainingOptions ? ` 남은 옵션 번역 항목 ${body.remainingOptions}개는 원문에 보존됩니다.` : '';
    if(!body.autoDraft || body.job.review?.destination !== 'Cloudflare Workers AI')return `수집 원문·카테고리·옵션으로 SEO 요청을 준비했습니다.${remainder}`;
    generating=true;
    let job=body.job;
    if(job.status==='prepared'||job.status==='approved'){
      const executed=await runReviewedTranslation(productId,job,{signal,fetcher,onJob:()=>{}});
      if(!executed||signal.aborted)return '';
      job=executed.job;
    }
    if(job.status==='running')job=await awaitIntakeTranslation(job,fetcher,signal);
    if(signal.aborted)return '';
    if(job.status!=='completed'||!job.result)return `상품은 저장됐지만 SEO 초안은 아직 반영되지 않았습니다. ${job.error?.message ?? (job.status==='running'?'생성 중입니다. 작업 상태를 다시 확인해주세요.':'생성 결과를 확인해주세요.')}`;
    const send=async(action:'preview'|'apply',fingerprint?:string)=>{
      const response=await fetcher(`${base}/translation-apply`,{method:'POST',signal,headers:{'content-type':'application/json'},body:JSON.stringify({action,jobId:job.id,expectedVersion:job.productVersion,...(body.optionsOnly?{scope:'options'}:{}),...(fingerprint?{fingerprint}:{})})});
      const value=await response.json() as {error?:string;productId?:string;productVersion?:string;preview?:unknown[];fingerprint?:string;applied?:number};
      if(!response.ok)throw Error(value.error||'SEO 초안 반영 상태를 확인해주세요.');
      return value;
    };
    const preview=await send('preview');if(signal.aborted)return '';
    if(preview.productId!==productId||preview.productVersion!==job.productVersion||!Array.isArray(preview.preview)||typeof preview.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(preview.fingerprint))throw Error('초안 반영 대상이 일치하지 않습니다.');
    if(!preview.preview.length){
      // An unchanged SEO result does not mean untranslated options are done.
      // Advance without writing, retaining the version checked by preview.
      if(!body.optionsOnly){next={action:'prepare-intake-options',expectedVersion:job.productVersion};continue;}
      return `SEO 생성 결과를 보존했습니다. 반영할 추가 항목이 없어 자동 처리를 멈췄습니다.${remainder}`;
    }
    const saved=await send('apply',preview.fingerprint);if(signal.aborted)return '';
    if(saved.productId!==productId||typeof saved.productVersion!=='string'||!Number.isFinite(Date.parse(saved.productVersion))||!Number.isInteger(saved.applied)||(saved.applied??0)<1)throw Error('초안 저장 결과를 확인해주세요.');
    appliedAny=true;next={action:'prepare-intake-options',expectedVersion:saved.productVersion};
    }
    return 'SEO·옵션 초안을 일부 반영했습니다. 남은 옵션은 SEO 단계에서 확인해주세요.';
  } catch (error) {
    return signal.aborted ? '' : generating ? `상품과 생성 이력은 보존했습니다. ${error instanceof Error?error.message:'SEO 생성·반영 상태를 확인해주세요.'} 자동 재요청하지 않았습니다.` : '상품은 저장됐지만 SEO 요청 준비 상태를 확인하지 못했습니다. SEO 단계에서 확인해주세요.';
  }
}
