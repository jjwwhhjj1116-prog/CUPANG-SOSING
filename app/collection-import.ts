export type CollectionImportProgress = {stage:'product'|'images';completedImages:number;totalImages:number};
export type CollectionImportOutcome = {status:'completed'|'stopped'|'failed';productId:string|null;completedImages:number;error?:string};
/** Uses retry-safe server endpoints. Stop is cooperative: finish an in-flight write before stopping. */
export async function runCollectionImport(jobId:string,totalImages:number,options:{imageIndices?:readonly number[];fetcher?:typeof fetch;shouldStop?:()=>boolean;onProgress?:(progress:CollectionImportProgress)=>void}={}):Promise<CollectionImportOutcome>{
 if(!jobId||!Number.isInteger(totalImages)||totalImages<0||totalImages>200)throw new Error('수집 요청과 이미지 수를 확인해주세요.');
 const indices=options.imageIndices?[...options.imageIndices]:Array.from({length:totalImages},(_,index)=>index);
 if(indices.length>50||new Set(indices).size!==indices.length||indices.some(index=>!Number.isInteger(index)||index<0||index>=totalImages))throw new Error('원본 이미지 번호를 중복 없이 최대 50개 선택해주세요.');
 indices.sort((a,b)=>a-b);
 const selectedTotal=indices.length;
 const fetcher=options.fetcher??fetch;const base=`/api/collection-jobs/${encodeURIComponent(jobId)}`;
 let productId:string|null=null;let completedImages=0;let activeImageIndex:number|null=null;
 const stopped=()=>options.shouldStop?.()??false;
 try{
  if(stopped())return {status:'stopped',productId,completedImages};
  options.onProgress?.({stage:'product',completedImages,totalImages:selectedTotal});
  const response=await fetcher(`${base}/product`,{method:'POST'});
  const body=await response.json() as {error?:string;productId?:string};
  if(!response.ok)throw new Error(body.error||'상품 반영에 실패했습니다.');
  if(!body.productId)throw new Error('상품 반영 결과를 확인하지 못했습니다. 다시 실행해주세요.');
  productId=body.productId;
  for(const index of indices){
   if(stopped())return {status:'stopped',productId,completedImages};
   activeImageIndex=index;
   options.onProgress?.({stage:'images',completedImages,totalImages:selectedTotal});
   const imageResponse=await fetcher(`${base}/images`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({index})});
   const image=await imageResponse.json() as {error?:string;key?:string};
   if(!imageResponse.ok)throw new Error(image.error||'이미지 저장에 실패했습니다.');
   if(!image.key)throw new Error('이미지 저장 결과를 확인하지 못했습니다. 다시 실행해주세요.');
   completedImages++;
   options.onProgress?.({stage:'images',completedImages,totalImages:selectedTotal});
  }
  return {status:'completed',productId,completedImages};
 }catch(error){return {status:'failed',productId,completedImages,error:(activeImageIndex===null?'':`원본 ${activeImageIndex+1}번 이미지: `)+(error instanceof Error?error.message:'저장 결과를 확인하지 못했습니다.')};}
}
