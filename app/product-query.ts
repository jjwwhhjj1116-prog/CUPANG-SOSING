import {collectionProvider} from '@/app/collection-provider';
import {parseCollectionRequest} from '@/app/sourcing';
import {COLLECTION_RESULT_LIMIT,validateCollectionResult,type CollectionResult} from '@/app/collection-result';
import {collectPublicProduct} from '@/app/public-product-collector';
import {collectAlibabaProduct} from '@/app/alibaba-product-collector';

export class ProductQueryError extends Error {
  constructor(public code:string,message:string,public status=422){super(message);this.name='ProductQueryError';}
}

/** Public capabilities contain neither credentials nor a claim of live success. */
export function productQueryService(bindings:Record<string,unknown>){
  try{
    const provider=collectionProvider(bindings);
    return {format:'yoofam-product-query-service-v1' as const,provider:provider.kind,configured:true,liveVerified:false as const,queryPath:'/api/product-query' as const};
  }catch{
    return {format:'yoofam-product-query-service-v1' as const,provider:'unavailable' as const,configured:false,liveVerified:false as const,queryPath:'/api/product-query' as const};
  }
}

/** A category-independent query. It does not create a job/product, change any
 * existing source, or submit a quotation. Provider choice is deployment-only. */
export async function queryProductSource(sourceUrl:unknown,bindings:Record<string,unknown>,options:{signal?:AbortSignal;fetcher?:typeof fetch}={}){
  let source:ReturnType<typeof parseCollectionRequest>[number];
  try{source=parseCollectionRequest({urls:[sourceUrl]})[0];}
  catch{throw new ProductQueryError('INVALID_SOURCE_URL','1688 상품 상세 URL을 확인해주세요.',400);}
  let provider:ReturnType<typeof collectionProvider>;
  try{provider=collectionProvider(bindings);}
  catch{throw new ProductQueryError('SOURCE_CONFIGURATION_REQUIRED','1688 상품조회 API의 서버 설정을 확인해야 합니다.',503);}
  if(options.signal?.aborted)throw new ProductQueryError('SOURCE_QUERY_CANCELLED','상품조회를 취소했습니다.',409);
  let result:CollectionResult;
  try{
    result=provider.kind==='alibaba-api'
      ?await collectAlibabaProduct(source.sourceUrl,provider.credentials,options)
      :await collectPublicProduct(source.sourceUrl,options);
  }catch{
    if(options.signal?.aborted)throw new ProductQueryError('SOURCE_QUERY_CANCELLED','상품조회를 취소했습니다.',409);
    // Provider exceptions can carry signed URLs, headers or access tokens.
    throw new ProductQueryError(provider.kind==='alibaba-api'?'SOURCE_PROVIDER_FAILED':'SOURCE_NOT_COLLECTED',provider.kind==='alibaba-api'?'상품조회 API에서 유효한 상품 원문을 받지 못했습니다. 서버의 조회 권한과 상품번호를 확인해주세요.':'상품 페이지에서 유효한 원문을 받지 못했습니다. 현재 페이지 수집으로 가져온 원문과 서버 조회 결과를 구분해서 확인해주세요.');
  }
  if(options.signal?.aborted)throw new ProductQueryError('SOURCE_QUERY_CANCELLED','상품조회를 취소했습니다.',409);
  try{
    if(result.offerId!==source.offerId)throw Error('offer mismatch');
    const {offerId:derivedOfferId,...payload}=result;
    void derivedOfferId;
    const validated=validateCollectionResult(payload,source.offerId);
    if(new TextEncoder().encode(JSON.stringify(validated)).byteLength>COLLECTION_RESULT_LIMIT)throw Error('source too large');
    return {offerId:source.offerId,source:validated,provider:provider.kind,sourceStored:false as const,draftCreated:false as const};
  }catch{throw new ProductQueryError('SOURCE_RESULT_INVALID','상품번호·옵션·가격·이미지 원문을 확인하지 못했습니다. 초안을 만들지 않았습니다.');}
}
