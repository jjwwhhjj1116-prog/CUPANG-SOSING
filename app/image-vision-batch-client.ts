import {FreeImageVisionError,type FreeImageVisionAttempt} from '@/app/free-image-vision-error';
import {freeImageSourceIdentity,type FreeImageSource} from '@/app/free-image-translation';
import {IMAGE_TEXT_PRESERVATION_POLICY,parseImageTextVisionResult,type ImageTextVisionResult} from '@/app/image-text-vision';
import type {FreeImageLoaded} from '@/app/free-image-translation-client';

export type ImageVisionBatchStatus={format:'yoofam-image-vision-batch-v1';attempt:FreeImageVisionAttempt|null;status:'running'|'completed'|'failed'|'uncertain'|'not-found';result:ImageTextVisionResult|null;failure:string|null;execution:{requests:0|1};readOnly:boolean};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const canonical=(value:unknown)=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const invalid=()=>Error('이미지 Vision 작업 응답의 원본·요청 연결을 확인하지 못했습니다. 새 추론으로 대체하지 않습니다.');
const endpoint=(productId:string)=>`/api/products/${encodeURIComponent(productId)}/image-text`;
function validatedAttempt(value:unknown):FreeImageVisionAttempt{
 if(!object(value)||!['configuration,inspectionPolicy,requestId,source,sourceLanguage,transport','configuration,requestId,source,sourceLanguage,transport'].includes(Object.keys(value).sort().join(','))||value.transport!=='workers-ai-batch-v1')throw invalid();
 try{return new FreeImageVisionError('원래 이미지 작업','IMAGE_VISION_STATUS',true,value as FreeImageVisionAttempt).attempt;}catch{throw invalid();}
}
function assertImageScope(attempt:FreeImageVisionAttempt,source:FreeImageSource,language:'zh'|'en'|undefined,configuration:FreeImageVisionAttempt['configuration']|undefined){
 const original=attempt.source;
 if(original.productId!==source.productId||original.sourceKey!==source.sourceKey||original.sourceSha256!==source.sourceSha256||original.width!==source.width||original.height!==source.height
  ||attempt.sourceLanguage!==language||!same(attempt.configuration,configuration)||attempt.inspectionPolicy!==IMAGE_TEXT_PRESERVATION_POLICY)throw invalid();
}
export function parseImageVisionBatchStatus(value:unknown,expected:{attempt?:FreeImageVisionAttempt;source?:FreeImageSource;language?:'zh'|'en';configuration?:FreeImageVisionAttempt['configuration']},readOnly:boolean,allowSubmission=false):ImageVisionBatchStatus{
 if(!object(value)||Object.keys(value).sort().join(',')!=='attempt,execution,failure,format,readOnly,result,status'||value.format!=='yoofam-image-vision-batch-v1'||value.readOnly!==readOnly
  ||!['running','completed','failed','uncertain','not-found'].includes(String(value.status))||!object(value.execution)||Object.keys(value.execution).join(',')!=='requests'
  ||!(value.execution.requests===0||allowSubmission&&value.execution.requests===1)||!(value.failure===null||typeof value.failure==='string'&&/^[A-Z_]{1,32}$/.test(value.failure)))throw invalid();
 const attempt=value.attempt===null?null:validatedAttempt(value.attempt);
 if(value.status==='not-found'){if(attempt||value.result!==null||value.failure!==null||value.execution.requests!==0)throw invalid();}
 else if(!attempt)throw invalid();
 if(attempt&&expected.attempt&&(!same(attempt,expected.attempt)))throw invalid();
 if(attempt&&expected.source)assertImageScope(attempt,expected.source,expected.language,expected.configuration);
 const result=value.result===null?null:attempt?parseImageTextVisionResult(value.result,attempt.source.width,attempt.source.height):null;
 if(value.status==='completed'?(!result||value.failure!==null||result.inspection?.policy!==attempt?.inspectionPolicy):value.result!==null)throw invalid();
 return{format:'yoofam-image-vision-batch-v1',attempt,status:value.status as ImageVisionBatchStatus['status'],result,failure:value.failure as string|null,execution:{requests:value.execution.requests as 0|1},readOnly};
}
async function reply(response:Response){
 let body:unknown;try{body=await response.json();}catch{throw invalid();}
 if(!response.ok)throw Error(object(body)&&typeof body.error==='string'&&body.error.length<=2000?body.error:'원래 이미지 Vision 작업을 확인하지 못했습니다.');
 return body;
}
export async function readImageVisionBatch(attempt:FreeImageVisionAttempt,signal:AbortSignal,fetcher:typeof fetch=fetch){
 const exact=validatedAttempt(attempt);signal.throwIfAborted();
 const body=await reply(await fetcher(`${endpoint(exact.source.productId)}?${new URLSearchParams({visionBatchRequestId:exact.requestId})}`,{method:'GET',signal,cache:'no-store',credentials:'same-origin',redirect:'error'}));
 signal.throwIfAborted();return parseImageVisionBatchStatus(body,{attempt:exact},true);
}
export async function pollImageVisionBatch(attempt:FreeImageVisionAttempt,signal:AbortSignal,fetcher:typeof fetch=fetch){
 const exact=validatedAttempt(attempt);signal.throwIfAborted();
 const body=await reply(await fetcher(endpoint(exact.source.productId),{method:'POST',signal,cache:'no-store',credentials:'same-origin',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({action:'vision-batch-poll',requestId:exact.requestId})}));
 signal.throwIfAborted();return parseImageVisionBatchStatus(body,{attempt:exact},false);
}
function pause(signal:AbortSignal){return new Promise<void>((resolve,reject)=>{
 signal.throwIfAborted();const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};
 const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},2000);signal.addEventListener('abort',abort,{once:true});
});}
/** Discover before creating. Only one submission may occur; every subsequent
 * request retrieves its saved provider job, including after a page reload. */
export async function runImageVisionBatch(image:FreeImageLoaded,sourceLanguage:'zh'|'en',signal:AbortSignal,onProgress:(message:string)=>void){
 const fetcher=image.visionFetcher??fetch,configuration=structuredClone(image.visionConfiguration!),source=structuredClone(image.source),initialSource=freeImageSourceIdentity(source);
 const current=()=>{signal.throwIfAborted();if(freeImageSourceIdentity(image.source)!==initialSource||!same(image.visionConfiguration,configuration))throw invalid();};
 let status:ImageVisionBatchStatus,attempt:FreeImageVisionAttempt|undefined=image.visionPending?.attempt,requests:0|1=0;
 if(attempt){assertImageScope(attempt,source,sourceLanguage,configuration);if(image.visionRequestId&&image.visionRequestId!==attempt.requestId)throw invalid();}
 if(image.visionRequestId){
  attempt??={requestId:image.visionRequestId,source,sourceLanguage,configuration,inspectionPolicy:IMAGE_TEXT_PRESERVATION_POLICY,transport:'workers-ai-batch-v1'};
  status=await readImageVisionBatch(attempt,signal,fetcher);
 }else{
  const query=new URLSearchParams({visionBatchSource:JSON.stringify(source),sourceLanguage,inspectionPolicy:IMAGE_TEXT_PRESERVATION_POLICY}),url=`${endpoint(source.productId)}?${query}`;
  if(url.length>12000)throw Error('원래 이미지 작업 조회 주소가 너무 길어 새 추론을 요청하지 않았습니다.');
  status=parseImageVisionBatchStatus(await reply(await fetcher(url,{method:'GET',signal,cache:'no-store',credentials:'same-origin',redirect:'error'})),{source,language:sourceLanguage,configuration},true);current();
  if(status.attempt)attempt=status.attempt;
 }
 if(attempt)image.visionRequestId=attempt.requestId;
 if(status.status==='not-found'&&!image.visionRequestId){
  current();attempt={requestId:crypto.randomUUID(),source,sourceLanguage,configuration,inspectionPolicy:IMAGE_TEXT_PRESERVATION_POLICY,transport:'workers-ai-batch-v1'};image.visionRequestId=attempt.requestId;
  try{
   onProgress('Qwen 이미지 번역 작업을 등록하고 있습니다.');
   current();const response=await fetcher(endpoint(source.productId),{method:'POST',signal,cache:'no-store',credentials:'same-origin',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({action:'vision-batch',...attempt})});
   const body:unknown=await response.json();signal.throwIfAborted();
   if(!response.ok){
    if(object(body)&&Object.keys(body).sort().join(',')==='code,error,uncertain'&&body.uncertain===false&&typeof body.error==='string'&&body.error.length<=2000
     &&(response.status===429&&body.code==='IMAGE_VISION_CAPACITY'||response.status===409&&body.code==='IMAGE_VISION_NOT_ADMITTED')){
     delete image.visionRequestId;
     throw new FreeImageVisionError(body.error,body.code,false,attempt);
    }
    throw invalid();
   }
   status=parseImageVisionBatchStatus(body,{attempt},false,true);requests=status.execution.requests;
  }catch(cause){
   if(cause instanceof FreeImageVisionError&&!cause.uncertain)throw cause;
   image.visionPending=new FreeImageVisionError('번역 작업의 접수 응답을 확인하지 못했습니다. 원래 작업만 조회하고 새 추론을 보내지 않습니다.','IMAGE_VISION_ACK_MISSING',true,attempt);throw image.visionPending;
  }
 }
 if(!attempt)throw invalid();
 try{
  if(status.status==='not-found')throw Error('원래 이미지 작업 기록을 확인하지 못했습니다. 새 추론을 보내지 않습니다.');
  if(status.status==='uncertain')status=await pollImageVisionBatch(attempt,signal,fetcher);
  for(let checks=0;status.status==='running'&&checks<60;checks++){
   current();if(checks)await pause(signal);
   onProgress(`Qwen 번역 작업 결과 확인 중 · ${checks+1}회`);
   status=await pollImageVisionBatch(attempt,signal,fetcher);
  }
  if(status.status==='failed')throw new FreeImageVisionError('원래 이미지 번역 작업의 실패를 확인했습니다. 원본을 유지했습니다.','IMAGE_VISION_'+(status.failure??'PROVIDER'),false,attempt);
  if(status.status!=='completed'||!status.result)throw Error('번역 작업은 서버에 보관되어 있습니다. 원래 작업의 결과만 이어서 확인해주세요.');
  current();
  delete image.visionPending;return{attempt,result:status.result,requests,cached:requests===0};
 }catch(cause){
  if(cause instanceof FreeImageVisionError&&!cause.uncertain)throw cause;
  image.visionPending=new FreeImageVisionError(cause instanceof Error?cause.message:'원래 이미지 번역 결과를 확인하지 못했습니다.','IMAGE_VISION_RESPONSE_UNCONFIRMED',true,attempt);throw image.visionPending;
 }
}
