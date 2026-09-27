import { parseCollectionRequest } from '@/app/sourcing';

/** Official query transport; credentials must belong to this deployment.
 * No credentials from Couplus or a browser session are copied or read. */
export type AlibabaProductCredentials = {appKey:string;appSecret:string;accessToken:string};
export class AlibabaProductError extends Error {
  constructor(public code:string,message:string){super(message);this.name='AlibabaProductError';}
}
export async function queryAlibabaProduct(sourceUrl:string,credentials:AlibabaProductCredentials,options:{fetcher?:typeof fetch;signal?:AbortSignal}={}) : Promise<{offerId:string;payload:unknown}> {
 const {offerId}=parseCollectionRequest({urls:[sourceUrl]})[0];
 if(!/^\d{1,30}$/.test(credentials.appKey)||![credentials.appSecret,credentials.accessToken].every(value=>typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\r\n]/.test(value)))throw new AlibabaProductError('API_CREDENTIALS_MISSING','1688 상품조회 API 인증 설정이 필요합니다.');
 const path=`param2/1/com.alibaba.fenxiao.crossborder/product.search.queryProductDetail/${credentials.appKey}`;
 const params:Record<string,string>={access_token:credentials.accessToken,offerDetailParam:JSON.stringify({offerId,country:'en',outMemberId:'1'})};
 const encoder=new TextEncoder();
 const key=await crypto.subtle.importKey('raw',encoder.encode(credentials.appSecret),{name:'HMAC',hash:'SHA-1'},false,['sign']);
 const signed=await crypto.subtle.sign('HMAC',key,encoder.encode(path+Object.keys(params).sort().map(name=>name+params[name]).join('')));
 params._aop_signature=Array.from(new Uint8Array(signed),byte=>byte.toString(16).padStart(2,'0')).join('').toUpperCase();
 const url=`https://gw.open.1688.com/openapi/${path}?${new URLSearchParams(params)}`;
 const controller=new AbortController(),stop=()=>controller.abort();
 options.signal?.addEventListener('abort',stop,{once:true});
 const timer=setTimeout(stop,20000);
 try {
  if(options.signal?.aborted)controller.abort();
  const response=await (options.fetcher??fetch)(url,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{accept:'application/json'}});
  if(!response.ok)throw new AlibabaProductError('API_REQUEST_FAILED',`1688 상품조회 요청이 실패했습니다 (HTTP ${response.status}).`);
  const reader=response.body?.getReader();if(!reader)throw new AlibabaProductError('API_EMPTY_RESPONSE','상품조회 응답이 없습니다.');
  const decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4*1024*1024){await reader.cancel();throw new AlibabaProductError('API_RESPONSE_TOO_LARGE','상품조회 응답이 4MB를 초과했습니다.');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
  let payload:unknown;try{payload=JSON.parse(text);}catch{throw new AlibabaProductError('API_INVALID_RESPONSE','상품조회 응답이 JSON 형식이 아닙니다.');}
  const envelope=payload as {result?:{success?:unknown;result?:unknown}}|null;
  if(!envelope||typeof envelope!=='object'||envelope.result?.success!==true||!envelope.result.result||typeof envelope.result.result!=='object'||Array.isArray(envelope.result.result))throw new AlibabaProductError('API_PRODUCT_UNAVAILABLE','상품조회 API가 정상 상품 데이터를 반환하지 않았습니다. API 접근 권한과 상품번호를 확인해주세요.');
  // Return the complete source. SKU/price/attribute mapping requires a verified
  // response fixture; a successful HTTP response alone must never create a draft.
  return {offerId,payload};
 }catch(error){
  if(error instanceof AlibabaProductError)throw error;
  // Network exceptions can contain the signed URL and token. Never surface them.
  throw new AlibabaProductError(controller.signal.aborted?'API_REQUEST_ABORTED':'API_NETWORK_ERROR',controller.signal.aborted?'상품조회가 취소되었거나 응답 시간이 초과되었습니다.':'상품조회 서버에 연결하지 못했습니다.');
 }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',stop);controller.abort();}
}
