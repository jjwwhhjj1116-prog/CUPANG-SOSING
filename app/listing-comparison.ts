import {applyOperationsCommand,OperationsError} from '@/app/operations/engine';
import type {OperationsDocument,OperationsScope,Values} from '@/app/operations/types';

export type ListingCandidate={offerId:string;sourceUrl:string;title:string;thumbnail:string;displayPrice:string};
export type ListingComparisonInput={expectedOwnerId:string;expectedCompany:{code:string;name:string};batchId:string;captureId:string;listingUrl:string;items:ListingCandidate[]};
export type ListingComparisonReceipt={format:'yoofam-listing-comparison-receipt-v1';captureId:string;batchId:string;ownerId:string;company:{code:string;name:string};stored:true;revision:number;storedCount:number;existingCount:number;itemOfferIds:string[];payloadSha256:string;recordedAt:string};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const object=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const literal=(v:unknown,max:number,empty=false):v is string=>typeof v==='string'&&v.length<=max&&(empty||v.trim().length>0)&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);
const fail=(message='담을 검색 목록과 선택한 상품을 확인해주세요.'):never=>{throw new OperationsError(message,400,'LISTING_CANDIDATES_INVALID');};
export function parseListingComparison(value:unknown):ListingComparisonInput{
 if(!exact(value,['expectedOwnerId','expectedCompany','batchId','captureId','listingUrl','items'])||!literal(value.expectedOwnerId,100)||!exact(value.expectedCompany,['code','name'])
  ||!literal(value.expectedCompany.code,30)||!literal(value.expectedCompany.name,100)||typeof value.batchId!=='string'||typeof value.captureId!=='string'||!UUID.test(value.batchId)||!UUID.test(value.captureId)
  ||!literal(value.listingUrl,6000)||!Array.isArray(value.items)||value.items.length<1||value.items.length>60||Object.keys(value.items).length!==value.items.length)return fail();
 let listing:URL;try{listing=new URL(value.listingUrl);}catch{return fail();}
 if(listing.protocol!=='https:'||listing.hostname!=='s.1688.com'||listing.pathname!=='/selloffer/offer_search.htm'||listing.port||listing.username||listing.password)fail();
 const seen=new Set<string>(),items=value.items.map(raw=>{
  if(!exact(raw,['offerId','sourceUrl','title','thumbnail','displayPrice'])||typeof raw.offerId!=='string'||!/^[1-9]\d{0,19}$/.test(raw.offerId)||seen.has(raw.offerId)
    ||raw.sourceUrl!=='https://detail.1688.com/offer/'+raw.offerId+'.html'||!literal(raw.title,500)||!literal(raw.thumbnail,2048,true)||!literal(raw.displayPrice,120,true))return fail();
  if(raw.thumbnail){let image:URL;try{image=new URL(raw.thumbnail);}catch{return fail();}if(image.protocol!=='https:'||image.port||image.username||image.password||image.hash||!/(?:^|\.)(?:alicdn\.com|1688\.com)$/.test(image.hostname))fail();}
  seen.add(raw.offerId);return{offerId:raw.offerId,sourceUrl:raw.sourceUrl,title:raw.title,thumbnail:raw.thumbnail,displayPrice:raw.displayPrice};
 });
 return{expectedOwnerId:value.expectedOwnerId,expectedCompany:{code:value.expectedCompany.code,name:value.expectedCompany.name},batchId:String(value.batchId),captureId:String(value.captureId),listingUrl:value.listingUrl,items};
}
export function listingCanonical(value:unknown):string{return value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(listingCanonical).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+listingCanonical((value as Record<string,unknown>)[k])).join(',')+'}';}
export async function listingComparisonDigest(input:ListingComparisonInput){
 const payload=listingCanonical({batchId:input.batchId,captureId:input.captureId,listingUrl:input.listingUrl,items:input.items});
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload));
 return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
}
const markerId=(input:ListingComparisonInput)=>'listing-capture:'+input.captureId;
function receiptValid(value:unknown,input:ListingComparisonInput,scope:OperationsScope,hash:string,currentRevision:number):value is ListingComparisonReceipt{
 if(!exact(value,['format','captureId','batchId','ownerId','company','stored','revision','storedCount','existingCount','itemOfferIds','payloadSha256','recordedAt']))return false;
 return value.format==='yoofam-listing-comparison-receipt-v1'&&value.captureId===input.captureId&&value.batchId===input.batchId&&value.ownerId===scope.ownerId
  &&exact(value.company,['code','name'])&&value.company.code===scope.companyCode&&value.company.name===scope.companyName&&value.stored===true
  &&Number.isSafeInteger(value.revision)&&Number(value.revision)>0&&Number(value.revision)<=currentRevision&&Number.isSafeInteger(value.storedCount)&&Number(value.storedCount)>=0
  &&Number.isSafeInteger(value.existingCount)&&Number(value.existingCount)>=0&&Number(value.storedCount)+Number(value.existingCount)===input.items.length
  &&listingCanonical(value.itemOfferIds)===listingCanonical(input.items.map(item=>item.offerId))&&value.payloadSha256===hash
  &&typeof value.recordedAt==='string'&&Number.isFinite(Date.parse(value.recordedAt))&&Date.parse(value.recordedAt)<=Date.now()+5000;
}
export function storedListingReceipt(document:OperationsDocument,input:ListingComparisonInput,scope:OperationsScope,hash:string,revision:number){
 const marker=document.records.jobs.find(row=>row.id===markerId(input));if(!marker)return null;
 if(marker.values.kind!=='1688-listing-batch'||marker.values.status!=='completed'||marker.values.payloadSha256!==hash||typeof marker.values.receiptJson!=='string')throw new OperationsError('같은 담기 요청번호의 원문이 다르거나 저장 기록을 확인하지 못했습니다.',409,'LISTING_CAPTURE_CONFLICT');
 let receipt:unknown;try{receipt=JSON.parse(marker.values.receiptJson);}catch{throw new OperationsError('담기 저장 기록을 읽지 못했습니다.',503);}
 if(!receiptValid(receipt,input,scope,hash,revision))throw new OperationsError('담기 저장 영수증이 원래 요청과 다릅니다.',409,'LISTING_CAPTURE_CONFLICT');return receipt;
}
export function prepareListingComparison(document:OperationsDocument,input:ListingComparisonInput,scope:OperationsScope,hash:string,revision:number,now=new Date().toISOString()){
 const existing=new Set(document.records.sourcingCandidates.map(row=>String(row.values.offerId??''))),rows:Values[]=[];
 for(const item of input.items){if(existing.has(item.offerId))continue;const id='listing-offer:'+item.offerId;
  if(document.records.sourcingCandidates.some(row=>row.id===id))throw new OperationsError('기존 후보의 식별값과 겹칩니다. 기존 자료는 변경하지 않았습니다.',409);
  rows.push({id,offerId:item.offerId,name:item.title,url:item.sourceUrl,image:item.thumbnail,displayPrice:item.displayPrice,status:'미검토',source:'1688-listing-card',listingUrl:input.listingUrl,sourceCaptureId:input.captureId,sourceBatchId:input.batchId,capturedAt:now});}
 const receipt:ListingComparisonReceipt={format:'yoofam-listing-comparison-receipt-v1',captureId:input.captureId,batchId:input.batchId,ownerId:scope.ownerId,company:{code:scope.companyCode,name:scope.companyName},stored:true,revision:revision+1,storedCount:rows.length,existingCount:input.items.length-rows.length,itemOfferIds:input.items.map(item=>item.offerId),payloadSha256:hash,recordedAt:now};
 let next=rows.length?applyOperationsCommand(document,{type:'import',dataset:'sourcingCandidates',rows},now):document;
 next=applyOperationsCommand(next,{type:'upsert',dataset:'jobs',id:markerId(input),values:{kind:'1688-listing-batch',status:'completed',resultVerified:true,completedAt:now,payloadSha256:hash,captureId:input.captureId,sourceBatchId:input.batchId,receiptJson:JSON.stringify(receipt),source:'1688-listing-card'}},now);
 return{document:next,receipt};
}
