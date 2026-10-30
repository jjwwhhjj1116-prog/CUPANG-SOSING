import {env} from 'cloudflare:workers';
import type {SourceInboxItem} from '@/app/source-inbox';
import {sourceHasManualTitle,validCollectedKoreanTitle,validCollectedTitleTranslation} from '@/app/source-inbox-title';
import {claimSourceInboxTitle,finishSourceInboxTitle,reusableSourceInboxTitle,type SourceTitleMember,type SourceTitleWork} from '@/db/source-inbox-titles';
import {sourceTitleProvider,translateConfiguredSourceTitle,verifyLiteralSourceTitle,SourceTitleProviderError,type SourceTitleEnvironment} from '@/app/source-inbox-title-provider';
import {translateGoogleFree,type GoogleFreeTranslationFailure} from '@/app/automation/google-free-translation';
export class SourceTitlePreparationConflict extends Error{}

/** Collection POST background and the UI recovery endpoint share one durable
 * claim. Configured providers never silently fall back to another provider. */
export async function prepareCollectedSourceTitle(item:SourceInboxItem,member:SourceTitleMember,signal:AbortSignal=new AbortController().signal):Promise<SourceTitleWork>{
 if(sourceHasManualTitle(item))return {claimed:false,row:undefined,run:undefined};
 const configured=sourceTitleProvider(env as SourceTitleEnvironment),work=await claimSourceInboxTitle(item,member,configured);
 if(!work.claimed||!work.row||sourceHasManualTitle(item))return work;
 let translated:string|null=null,failure:GoogleFreeTranslationFailure|undefined,message:string|null=null,uncertain=false;
 try{
  if(validCollectedKoreanTitle(item.snapshot.title))translated=item.snapshot.title.trim();
  else{
   const cached=await reusableSourceInboxTitle(item,configured.signature);
   if(cached)translated=verifyLiteralSourceTitle(item.snapshot.title,{translatedText:cached});
   else if(configured.provider==='workers-ai')translated=await translateConfiguredSourceTitle(item.snapshot.title,env as SourceTitleEnvironment,signal);
   else if(configured.provider==='google-free'){
    const result=await translateGoogleFree(item.snapshot.title,{targetLanguage:'ko',maxCharacters:500,timeoutSeconds:8,signal,onFailure:value=>{failure=value;}});
    if(validCollectedTitleTranslation(item.snapshot.title,result?.translatedText))translated=verifyLiteralSourceTitle(item.snapshot.title,{translatedText:result!.translatedText});
   }
  }
 }catch(error){uncertain=configured.provider==='workers-ai'&&(!(error instanceof SourceTitleProviderError)||error.uncertain);message=error instanceof SourceTitleProviderError?error.message:'상품명 번역 결과를 확인하지 못했습니다. 원문은 보존됩니다.';}
 const retryable=configured.provider==='google-free'&&!translated&&work.row.attempts<2&&!!failure&&['network','timeout'].includes(failure.reason);
 if(!translated&&!message)message=failure?.reason==='http'&&failure.status===429?'상품명 번역 요청이 제한되었습니다. 원문을 보존했습니다.':'상품명 번역을 완료하지 못했습니다. 원문을 보존했습니다.';
 const saved=await finishSourceInboxTitle(item,member,work,translated,message,retryable,uncertain);if(!saved)throw new SourceTitlePreparationConflict('상품명 준비 중 수집본 또는 회원이 변경되었습니다. 원문은 보존됩니다.');return saved;
}
