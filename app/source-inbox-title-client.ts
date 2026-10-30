import type {SourceInboxItem} from '@/app/source-inbox';
import {sourceArchiveReference,sameSourceArchiveReference} from '@/app/source-inbox-archive-client';
import {sourceInboxDisplayTitle,validCollectedKoreanTitle,type SourceInboxTitlePreparation} from '@/app/source-inbox-title';
export async function prepareSourceInboxDisplayTitle(item:SourceInboxItem,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<Pick<SourceInboxItem,'displayTitle'|'titlePreparation'>>{
 const reference=sourceArchiveReference(item,item.ownerId,item.company);if(!reference)throw Error('선택한 수집본의 상품명을 확인해주세요.');
 const response=await fetcher('/api/source-inbox/title',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:reference.ownerId,expectedCompany:reference.company,id:reference.id,expectedFingerprint:reference.fingerprint,expectedRevision:reference.revision,expectedSourceUrl:reference.sourceUrl})});
 const body=await response.json() as {error?:string;titlePreparation?:SourceInboxTitlePreparation;displayTitle?:string}&typeof reference;
 if(signal.aborted)throw Error('상품명 준비를 취소했습니다.');if(!response.ok)throw Error(body?.error||'수집 상품명을 준비하지 못했습니다.');
 const value=body.titlePreparation;
 if(!body||!sameSourceArchiveReference(reference,body)||!value||value.format!=='yoofam-collected-title-v1'||value.fingerprint!==item.fingerprint||value.revision!==item.revision||value.sourceTitle!==item.snapshot.title
  ||!['pending','running','completed','failed'].includes(value.state)||typeof value.brand!=='string'||value.brand.length>500||typeof value.message!=='string'||value.message.length>500||typeof value.retryable!=='boolean'||!Number.isSafeInteger(value.attempts)||value.attempts<0||value.attempts>2
  ||value.state==='completed'&&!validCollectedKoreanTitle(value.translatedTitle)||value.state!=='completed'&&value.translatedTitle!==null||body.displayTitle!==sourceInboxDisplayTitle({...item,titlePreparation:value}))throw Error('선택한 수집본의 상품명 준비 결과가 일치하지 않습니다.');
 return {displayTitle:body.displayTitle,titlePreparation:value};
}
