import type { TranslationJob } from '@/app/automation/translation';
import { runReviewedTranslation } from '@/app/reviewed-translation';

/** User-started intake produces editable content; never submits to Supplier Hub. */
export async function prepareIntakeSeo(productId: string, fetcher: typeof fetch, signal: AbortSignal) {
  if (signal.aborted) return '';
  let generating = false;
  try {
    const base = `/api/products/${encodeURIComponent(productId)}`;
    const response = await fetcher(`${base}/translation`, {
      method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'prepare-collected', intake: true }),
    });
    const body = await response.json() as { job?: TranslationJob; error?: string; remainingOptions?: number; autoDraft?: boolean; intakePreserved?: boolean };
    if (signal.aborted) return '';
    if (!response.ok || body.job?.productId !== productId) return `상품은 저장됐지만 SEO 요청 준비는 완료되지 않았습니다. ${body.error ?? 'SEO 단계에서 다시 확인해주세요.'}`;
    if(body.intakePreserved)return '기존 SEO 생성 이력과 저장된 수정값을 유지했습니다. 추가 생성 요청하지 않았습니다.';
    const remainder=body.remainingOptions ? ` 남은 옵션 번역 항목 ${body.remainingOptions}개는 원문에 보존됩니다.` : '';
    if(!body.autoDraft || body.job.review?.destination !== 'Cloudflare Workers AI')return `수집 원문·카테고리·옵션으로 SEO 요청을 준비했습니다.${remainder}`;
    generating=true;
    let job=body.job;
    if(job.status==='prepared'||job.status==='approved'){
      const executed=await runReviewedTranslation(productId,job,{signal,fetcher,onJob:()=>{}});
      if(!executed||signal.aborted)return '';
      job=executed.job;
    }
    if(job.status!=='completed'||!job.result)return `상품은 저장됐지만 SEO 초안은 아직 반영되지 않았습니다. ${job.error?.message ?? (job.status==='running'?'생성 중입니다. 작업 상태를 다시 확인해주세요.':'생성 결과를 확인해주세요.')}`;
    const send=async(action:'preview'|'apply',fingerprint?:string)=>{
      const response=await fetcher(`${base}/translation-apply`,{method:'POST',signal,headers:{'content-type':'application/json'},body:JSON.stringify({action,jobId:job.id,expectedVersion:job.productVersion,...(fingerprint?{fingerprint}:{})})});
      const value=await response.json() as {error?:string;productId?:string;productVersion?:string;preview?:unknown[];fingerprint?:string;applied?:number};
      if(!response.ok)throw Error(value.error||'SEO 초안 반영 상태를 확인해주세요.');
      return value;
    };
    const preview=await send('preview');if(signal.aborted)return '';
    if(preview.productId!==productId||preview.productVersion!==job.productVersion||!Array.isArray(preview.preview)||typeof preview.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(preview.fingerprint))throw Error('초안 반영 대상이 일치하지 않습니다.');
    if(!preview.preview.length)return `SEO 생성 결과를 보존했습니다. 직접 수정한 항목은 유지했습니다.${remainder}`;
    const saved=await send('apply',preview.fingerprint);if(signal.aborted)return '';
    if(saved.productId!==productId||!Number.isInteger(saved.applied)||(saved.applied??0)<1)throw Error('초안 저장 결과를 확인해주세요.');
    return `SEO·옵션 초안을 생성해 반영했습니다. 내용을 확인하고 수정해주세요.${remainder}`;
  } catch (error) {
    return signal.aborted ? '' : generating ? `상품과 생성 이력은 보존했습니다. ${error instanceof Error?error.message:'SEO 생성·반영 상태를 확인해주세요.'} 자동 재요청하지 않았습니다.` : '상품은 저장됐지만 SEO 요청 준비 상태를 확인하지 못했습니다. SEO 단계에서 확인해주세요.';
  }
}
