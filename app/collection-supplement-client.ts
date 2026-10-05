import type { BrowserProductCapture } from '@/app/browser-product-bridge';
import { validateCollectionReceiptResponse } from '@/app/collection-receipt-response';
import { recommendCollectionImages, validateCollectionCapacity } from '@/app/collection-capacity';
import { runCollectionImport } from '@/app/collection-import';

type Transport = { fetcher: typeof fetch; signal: AbortSignal; captureFromBrowser: (url: string, signal: AbortSignal) => Promise<BrowserProductCapture> };
export async function captureCollectionSupplement(jobId: string, offerId: string, sourceUrl: string, options: Transport & { expectedProductVersion?: string }) {
  const fetcher=options.fetcher;
  const capture=await options.captureFromBrowser(sourceUrl,options.signal);
  if(options.signal.aborted)throw Error('작업을 취소했습니다.');
  const response=await fetcher(`/api/collection-jobs/${encodeURIComponent(jobId)}/source-supplement`,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({capture,...(options.expectedProductVersion?{expectedProductVersion:options.expectedProductVersion}:{})}),signal:options.signal});
  const body=await response.json() as {error?:string};
  if(!response.ok)throw Error(body.error||'상세 원문 보완을 확인하지 못했습니다.');
  const result=validateCollectionReceiptResponse(body,jobId,offerId);
  if(!result||result.provider!=='chrome-public-mobile-supplement-v1')throw Error('상품의 보완 원문을 확인하지 못했습니다.');
  return result;
}

/** Explicit source repair stores originals and prepares editable image roles.
 * Existing SEO/label/option/price edits are never regenerated. */
export async function completeCollectionSupplement(input:{jobId:string;offerId:string;sourceUrl:string;productId:string;productVersion:string;provider:string},
  options:Transport & { onProgress:(message:string)=>void }) {
  const fetcher=options.fetcher,base=`/api/collection-jobs/${encodeURIComponent(input.jobId)}`;
  let source;
  if(input.provider==='chrome-public-mobile-supplement-v1'){
    const response=await fetcher(base+'/result',{cache:'no-store',signal:options.signal});
    if(!response.ok)throw Error('보완 원문을 다시 읽지 못했습니다.');
    source=validateCollectionReceiptResponse(await response.json(),input.jobId,input.offerId);
  }else{
    options.onProgress('현재 Chrome에서 상세 이미지·상품 속성을 확인하는 중');
    source=await captureCollectionSupplement(input.jobId,input.offerId,input.sourceUrl,{...options,expectedProductVersion:input.productVersion});
  }
  if(!source||source.provider!=='chrome-public-mobile-supplement-v1')throw Error('상품의 보완 원문을 확인하지 못했습니다.');
  if(options.signal.aborted)return;
  const response=await fetcher(base+'/capacity',{cache:'no-store',signal:options.signal});
  const capacity=await response.json() as {capacity?:unknown;error?:string};
  if(!response.ok)throw Error(capacity.error||'원본 이미지 저장 여유를 확인하지 못했습니다.');
  const indices=recommendCollectionImages(source,validateCollectionCapacity(capacity.capacity,source.images.length),'all',1);
  const outcome=await runCollectionImport(input.jobId,source.images.length,{assignToStage:false,imageBatchSize:3,imageIndices:indices,continueOnImageError:true,
    fetcher:(url,init)=>fetcher(url,{...init,signal:options.signal}),shouldStop:()=>options.signal.aborted,
    onProgress:progress=>options.onProgress(`보완 원본 이미지 ${progress.completedImages}/${progress.totalImages}개 저장 확인 중`)});
  if(options.signal.aborted)return;
  if(outcome.productId!==input.productId)throw Error('원본에 연결된 상품이 달라 작업을 중단했습니다.');
  const currentResponse=await fetcher(`/api/products/${encodeURIComponent(input.productId)}/translation-source`,{cache:'no-store',signal:options.signal});
  const current=await currentResponse.json() as {productId?:string;jobId?:string;productVersion?:string};
  if(!currentResponse.ok||current.productId!==input.productId||current.jobId!==input.jobId||typeof current.productVersion!=='string')throw Error('보완한 상품의 최신 상태를 확인하지 못했습니다.');
  const draftResponse=await fetcher(`/api/products/${encodeURIComponent(input.productId)}/work-draft`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedVersion:current.productVersion}),signal:options.signal});
  const draft=await draftResponse.json() as {productId?:string;error?:string};
  if(!draftResponse.ok||draft.productId!==input.productId)throw Error(draft.error||'보완 이미지 초안 연결을 확인하지 못했습니다.');
  if(outcome.status!=='completed')throw Error(outcome.error||'일부 원본 이미지를 저장하지 못했습니다. 보완 원문은 보존되어 재시도할 수 있습니다.');
  const omitted=source.images.length-indices.length;
  return `상세 원문·상품 속성과 원본 이미지 연결을 보완했습니다. 기존 가격과 수정값은 유지했습니다.${omitted?` 저장 여유·제외 설정에 따라 이미지 ${omitted}개는 연결하지 않았습니다.`:''} 각 단계에서 원문을 검토해주세요.`;
}
