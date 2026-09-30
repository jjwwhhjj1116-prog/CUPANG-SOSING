import { collectionRequestWithRetry } from '@/app/collection-retry';
import { validateCollectionCapacity, collectionSelectionFits } from '@/app/collection-capacity';
import { importCollectionImageBatches } from '@/app/collection-import-batch';
export type CollectionImportProgress = {stage:'product'|'images';completedImages:number;totalImages:number};
export type CollectionImportOutcome = {status:'completed'|'stopped'|'failed';productId:string|null;completedImages:number;error?:string;warnings?:string[];failedImageIndices?:number[];capacityUnavailable?:boolean};
export function collectionImageSelection(totalImages:number,imageIndices?:readonly number[]):number[]{
 if(!Number.isInteger(totalImages)||totalImages<0||totalImages>200)throw new Error('수집 이미지 수를 확인해주세요.');
 const indices=imageIndices?[...imageIndices]:Array.from({length:totalImages},(_,index)=>index);
 if(indices.length>50||new Set(indices).size!==indices.length||indices.some(index=>!Number.isInteger(index)||index<0||index>=totalImages))throw new Error('원본 이미지 번호를 중복 없이 최대 50개 선택해주세요.');
 return indices.sort((a,b)=>a-b);
}
/** Uses retry-safe server endpoints. Stop is cooperative: finish an in-flight write before stopping. */
export async function runCollectionImport(jobId:string,totalImages:number,options:{imageBatchSize?:3;assignToStage?:boolean;onProductSaved?:(productId:string)=>Promise<void>;continueOnImageError?:boolean;retryAttempts?:number;retryWait?:(milliseconds:number)=>Promise<void>;onRetry?:(attempt:number)=>void;imageIndices?:readonly number[];fetcher?:typeof fetch;shouldStop?:()=>boolean;onProgress?:(progress:CollectionImportProgress)=>void}={}):Promise<CollectionImportOutcome>{
 if(!jobId||!Number.isInteger(totalImages)||totalImages<0||totalImages>200)throw new Error('수집 요청과 이미지 수를 확인해주세요.');
 const indices=collectionImageSelection(totalImages,options.imageIndices);
 const selectedTotal=indices.length;
 const fetcher=options.fetcher??fetch;
 if(options.imageBatchSize!==undefined&&(options.imageBatchSize!==3||options.assignToStage!==false))throw new Error('묶음 저장은 원본 이미지 자료함에만 사용할 수 있습니다.');
 if(options.retryAttempts!==undefined&&(!Number.isInteger(options.retryAttempts)||options.retryAttempts<1||options.retryAttempts>3))throw new Error('재시도 횟수는 1~3회여야 합니다.');
 const request=(url:string,init:RequestInit)=>collectionRequestWithRetry(url,init,{fetcher,attempts:options.retryAttempts,wait:options.retryWait,shouldStop:options.shouldStop,onRetry:options.onRetry});
 const base=`/api/collection-jobs/${encodeURIComponent(jobId)}`;
 let productId:string|null=null;let completedImages=0;let activeImageIndex:number|null=null;
 const warnings:string[]=[];const failedImageIndices:number[]=[];
 const stopped=()=>options.shouldStop?.()??false;
 try{
  if(stopped())return {status:'stopped',productId,completedImages};
  if(selectedTotal>0){
   let capacityResponse: Response;
   try { capacityResponse=await request(base+'/capacity',{cache:'no-store'}); }
   catch (error) {
    if(stopped())return {status:'stopped',productId,completedImages};
    return {status:'failed',productId,completedImages,capacityUnavailable:true,error:error instanceof Error?error.message:'이미지 저장 여유 조회 실패'};
   }
   if([429,502,503,504].includes(capacityResponse.status)){
    try{await capacityResponse.body?.cancel();}catch{/* The failed response has no product data. */}
    return {status:stopped()?'stopped':'failed',productId,completedImages,capacityUnavailable:true,error:'이미지 저장 여유를 일시적으로 확인하지 못했습니다.'};
   }
   let capacityBody: {capacity?:unknown;error?:string};
   try { capacityBody=await capacityResponse.json(); }
   catch {
    if(!capacityResponse.ok)throw new Error('이미지 저장 여유 조회 실패');
    return {status:stopped()?'stopped':'failed',productId,completedImages,capacityUnavailable:true,error:'이미지 저장 여유 응답을 읽지 못했습니다.'};
   }
   if(!capacityResponse.ok)throw new Error(capacityBody.error||'이미지 저장 여유 조회 실패');
   const capacity=validateCollectionCapacity(capacityBody.capacity,totalImages);
   if(indices.some(index=>capacity.blockedIndices?.includes(index)))throw new Error('상품에서 제외한 원본 이미지가 선택되어 있습니다. 수신 결과를 다시 조회하고 해당 이미지 선택을 해제해주세요.');
   if(!collectionSelectionFits(capacity,indices))throw new Error('공통 이미지·기존 파일을 포함하면 50개를 초과합니다. 수신 결과를 다시 조회하고 이미지 선택을 줄여주세요.');
  }
  if(stopped())return {status:'stopped',productId,completedImages};
  options.onProgress?.({stage:'product',completedImages,totalImages:selectedTotal});
  const response=await request(`${base}/product`,{method:'POST'});
  const body=await response.json() as {error?:string;productId?:string};
  if(!response.ok)throw new Error(body.error||'상품 반영에 실패했습니다.');
  if(!body.productId)throw new Error('상품 반영 결과를 확인하지 못했습니다. 다시 실행해주세요.');
  productId=body.productId;
  await options.onProductSaved?.(productId);
  if(options.imageBatchSize===3)return importCollectionImageBatches(base,productId,indices,{request,shouldStop:stopped,continueOnImageError:options.continueOnImageError,onProgress:options.onProgress});
  for(const index of indices){
   if(stopped())return {status:'stopped',productId,completedImages,...(failedImageIndices.length?{failedImageIndices}:{}),...(warnings.length?{warnings}: {})};
   activeImageIndex=index;
   options.onProgress?.({stage:'images',completedImages,totalImages:selectedTotal});
   let imageResponse: Response;
   try {
    imageResponse=await request(`${base}/images`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({index,...(options.assignToStage===false?{assignToStage:false}:{})})});
   } catch (error) {
    // A lost acknowledgement may follow a successful write. Keep this index
    // unconfirmed, but let independent images finish in batch mode. A retry
    // reuses the server's idempotent image endpoint instead of duplicating it.
    if(!options.continueOnImageError || stopped())throw error;
    failedImageIndices.push(index);
    warnings.push(`원본 ${index+1}번 이미지 저장 응답을 확인하지 못했습니다. 재시도 시 저장 여부를 다시 확인합니다.`);
    continue;
   }
   let image: {error?:string;key?:string;warnings?:unknown;code?:string};
   try { image=await imageResponse.json(); }
   catch (error) {
    // fetch() resolves at headers: a successful write can still lose its body.
    // Keep this image unconfirmed, as with a lost response before headers.
    // HTTP failures and explicit cancellation must remain terminal.
    if(!imageResponse.ok || !options.continueOnImageError || stopped())throw error;
    failedImageIndices.push(index);
    warnings.push(`원본 ${index+1}번 이미지 저장 응답을 읽지 못했습니다. 재시도 시 저장 여부를 다시 확인합니다.`);
    continue;
   }
   if(!imageResponse.ok){
    if(options.continueOnImageError && imageResponse.status===502 && image.code==='IMAGE_DOWNLOAD_FAILED' && !stopped()){
     failedImageIndices.push(index);warnings.push(`원본 ${index+1}번 이미지 다운로드 실패 · 다른 이미지는 계속 저장합니다.`);continue;
    }
    throw new Error(image.error||'이미지 저장에 실패했습니다.');
   }
   if(!image.key)throw new Error('이미지 저장 결과를 확인하지 못했습니다. 다시 실행해주세요.');
   completedImages++;
   if(Array.isArray(image.warnings))for(const warning of image.warnings){if(typeof warning==='string'&&warning.trim())warnings.push(`원본 ${index+1}번: ${warning}`);}
   options.onProgress?.({stage:'images',completedImages,totalImages:selectedTotal});
  }
  if(failedImageIndices.length)return {status:'failed',productId,completedImages,failedImageIndices,warnings,error:`원본 ${failedImageIndices.map(index=>index+1).join(', ')}번 이미지 저장을 완료하지 못했습니다. 저장된 이미지는 재시도 시 재사용합니다.`};
  return {status:'completed',productId,completedImages,...(warnings.length?{warnings}: {})};
 }catch(error){return {status:stopped()?'stopped':'failed',productId,completedImages,...(failedImageIndices.length?{failedImageIndices}:{}),...(warnings.length?{warnings}: {}),error:(activeImageIndex===null?'':`원본 ${activeImageIndex+1}번 이미지: `)+(error instanceof Error?error.message:'저장 결과를 확인하지 못했습니다.')};}
}
