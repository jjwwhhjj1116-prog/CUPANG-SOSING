import { collectionRequestWithRetry } from '@/app/collection-retry';
import { validateCollectionCapacity, collectionSelectionFits } from '@/app/collection-capacity';
export type CollectionImportProgress = {stage:'product'|'images';completedImages:number;totalImages:number};
export type CollectionImportOutcome = {status:'completed'|'stopped'|'failed';productId:string|null;completedImages:number;error?:string};
export function collectionImageSelection(totalImages:number,imageIndices?:readonly number[]):number[]{
 if(!Number.isInteger(totalImages)||totalImages<0||totalImages>200)throw new Error('수집 이미지 수를 확인해주세요.');
 const indices=imageIndices?[...imageIndices]:Array.from({length:totalImages},(_,index)=>index);
 if(indices.length>50||new Set(indices).size!==indices.length||indices.some(index=>!Number.isInteger(index)||index<0||index>=totalImages))throw new Error('원본 이미지 번호를 중복 없이 최대 50개 선택해주세요.');
 return indices.sort((a,b)=>a-b);
}
/** Uses retry-safe server endpoints. Stop is cooperative: finish an in-flight write before stopping. */
export async function runCollectionImport(jobId:string,totalImages:number,options:{retryAttempts?:number;retryWait?:(milliseconds:number)=>Promise<void>;onRetry?:(attempt:number)=>void;imageIndices?:readonly number[];fetcher?:typeof fetch;shouldStop?:()=>boolean;onProgress?:(progress:CollectionImportProgress)=>void}={}):Promise<CollectionImportOutcome>{
 if(!jobId||!Number.isInteger(totalImages)||totalImages<0||totalImages>200)throw new Error('수집 요청과 이미지 수를 확인해주세요.');
 const indices=collectionImageSelection(totalImages,options.imageIndices);
 const selectedTotal=indices.length;
 const fetcher=options.fetcher??fetch;
 if(options.retryAttempts!==undefined&&(!Number.isInteger(options.retryAttempts)||options.retryAttempts<1||options.retryAttempts>3))throw new Error('재시도 횟수는 1~3회여야 합니다.');
 const request=(url:string,init:RequestInit)=>collectionRequestWithRetry(url,init,{fetcher,attempts:options.retryAttempts,wait:options.retryWait,shouldStop:options.shouldStop,onRetry:options.onRetry});
 const base=`/api/collection-jobs/${encodeURIComponent(jobId)}`;
 let productId:string|null=null;let completedImages=0;let activeImageIndex:number|null=null;
 const stopped=()=>options.shouldStop?.()??false;
 try{
  if(stopped())return {status:'stopped',productId,completedImages};
  if(selectedTotal>0){
   const capacityResponse=await request(base+'/capacity',{cache:'no-store'});
   const capacityBody=await capacityResponse.json() as {capacity?:unknown;error?:string};
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
  for(const index of indices){
   if(stopped())return {status:'stopped',productId,completedImages};
   activeImageIndex=index;
   options.onProgress?.({stage:'images',completedImages,totalImages:selectedTotal});
   const imageResponse=await request(`${base}/images`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({index})});
   const image=await imageResponse.json() as {error?:string;key?:string};
   if(!imageResponse.ok)throw new Error(image.error||'이미지 저장에 실패했습니다.');
   if(!image.key)throw new Error('이미지 저장 결과를 확인하지 못했습니다. 다시 실행해주세요.');
   completedImages++;
   options.onProgress?.({stage:'images',completedImages,totalImages:selectedTotal});
  }
  return {status:'completed',productId,completedImages};
 }catch(error){return {status:stopped()?'stopped':'failed',productId,completedImages,error:(activeImageIndex===null?'':`원본 ${activeImageIndex+1}번 이미지: `)+(error instanceof Error?error.message:'저장 결과를 확인하지 못했습니다.')};}
}
