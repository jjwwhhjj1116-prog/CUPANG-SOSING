export type CollectionImportProgress = {stage:'product'|'images';completedImages:number;totalImages:number};
export type CollectionImportOutcome = {status:'completed'|'stopped'|'failed';productId:string|null;completedImages:number;error?:string};
/** Uses retry-safe server endpoints. Stop is cooperative: finish an in-flight write before stopping. */
export async function runCollectionImport(jobId:string,totalImages:number,options:{fetcher?:typeof fetch;shouldStop?:()=>boolean;onProgress?:(progress:CollectionImportProgress)=>void}={}):Promise<CollectionImportOutcome>{
 if(!jobId||!Number.isInteger(totalImages)||totalImages<0||totalImages>200)throw new Error('수집 요청과 이미지 수를 확인해주세요.');
 const fetcher=options.fetcher??fetch;const base=`/api/collection-jobs/${encodeURIComponent(jobId)}`;
 let productId:string|null=null;let completedImages=0;
 const stopped=()=>options.shouldStop?.()??false;
 try{
  if(stopped())return {status:'stopped',productId,completedImages};
  options.onProgress?.({stage:'product',completedImages,totalImages});
  const response=await fetcher(`${base}/product`,{method:'POST'});
  const body=await response.json() as {error?:string;productId?:string};
  if(!response.ok)throw new Error(body.error||'상품 반영에 실패했습니다.');
  if(!body.productId)throw new Error('상품 반영 결과를 확인하지 못했습니다. 다시 실행해주세요.');
  productId=body.productId;
  for(let index=0;index<totalImages;index++){
   if(stopped())return {status:'stopped',productId,completedImages};
   options.onProgress?.({stage:'images',completedImages,totalImages});
   const imageResponse=await fetcher(`${base}/images`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({index})});
   const image=await imageResponse.json() as {error?:string;key?:string};
   if(!imageResponse.ok)throw new Error(image.error||'이미지 저장에 실패했습니다.');
   if(!image.key)throw new Error('이미지 저장 결과를 확인하지 못했습니다. 다시 실행해주세요.');
   completedImages++;
   options.onProgress?.({stage:'images',completedImages,totalImages});
  }
  return {status:'completed',productId,completedImages};
 }catch(error){return {status:'failed',productId,completedImages,error:error instanceof Error?error.message:'저장 결과를 확인하지 못했습니다.'};}
}
