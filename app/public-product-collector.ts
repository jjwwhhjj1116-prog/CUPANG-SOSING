import { parseCollectionRequest } from '@/app/sourcing';
import { COLLECTION_RESULT_LIMIT, validateCollectionResult } from '@/app/collection-result';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { parseAlibabaDescription } from '@/app/alibaba-description';
import { parseProductJsonLd } from '@/extensions/supplier-hub/product-jsonld.mjs';

const MAX_HTML = 2 * 1024 * 1024;
type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const list = (value: unknown): unknown[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
/** Only explicit public Product/Offer data is supported. Never infer SKU,
 * currency, quantity or option prices from a headline price range. */
export function parsePublicProduct(html: string, sourceUrl: string, now = Date.now()) {
 const source = parseCollectionRequest({urls:[sourceUrl]})[0];
 if(new TextEncoder().encode(html).byteLength>MAX_HTML)throw Error('상품 페이지 크기가 수집 한도를 초과했습니다.');
 const nodes: RecordValue[] = [];
 const pending: DefaultTreeAdapterMap['node'][] = [parse(html)];
 while(pending.length) {
  const element = pending.pop()!;
  if('childNodes' in element) for(const child of element.childNodes) pending.push(child);
  // Parse inert HTML only. Comments, textarea text and template contents are
  // not active metadata scripts; no seller script is executed.
  if(!('tagName' in element) || element.tagName!=='script'
    || element.namespaceURI!=='http://www.w3.org/1999/xhtml'
    || element.attrs.find(attribute=>attribute.name==='type')?.value.trim().toLowerCase()!=='application/ld+json')continue;
  const content=element.childNodes.map(child=>'value' in child?child.value:'').join('');
  let parsed: unknown;try{parsed=JSON.parse(content);}catch{continue;}
  for(const entry of list(parsed)){const node=object(entry);nodes.push(node,...list(node['@graph']).map(object));}
 }
 const product=parseProductJsonLd(nodes,source.sourceUrl);
 const {options,images,attributes}=product;
 // Append details after SKU images so their recorded image indices remain
 // stable. The same source may serve both gallery and detail roles.
 const description=parseAlibabaDescription(product.description);
 for(const url of description.images)if(!images.some(image=>image.url===url&&image.role==='detail'))images.push({url,role:'detail'});
 const result=validateCollectionResult({schemaVersion:1,sourceUrl:source.sourceUrl,provider:'public-product-jsonld-v1',collectedAt:new Date(now).toISOString(),
  title:product.title,description:description.text,options,images,...(attributes!==undefined?{attributes}:{})},source.offerId,now);
 if(new TextEncoder().encode(JSON.stringify(result)).byteLength>COLLECTION_RESULT_LIMIT)throw Error('수집 결과 크기가 한도를 초과했습니다.');
 return result;
}

export async function collectPublicProduct(sourceUrl:string, options:{fetcher?:typeof fetch;signal?:AbortSignal}={}) {
 const source=parseCollectionRequest({urls:[sourceUrl]})[0];
 const controller=new AbortController(),desktop=new AbortController(),mobile=new AbortController();
 let releaseMobile:()=>void=()=>{};
 const mobileGate=new Promise<void>(resolve=>{releaseMobile=resolve;});
 const startMobile=()=>{clearTimeout(hedge);releaseMobile();};
 const stop=()=>{controller.abort();desktop.abort();mobile.abort();startMobile();};
 const checkStopped=(signal:AbortSignal)=>{if(signal.aborted)throw Error('상품 수집을 취소했거나 응답 시간이 초과되었습니다.');};
 // Fast usable PC metadata needs only one request. A slow or failed PC source
 // must not consume the mobile source's entire deadline. Each branch still
 // validates the exact offer, SKU prices and bounded original data independently.
 const hedge=setTimeout(startMobile,750),timeout=setTimeout(stop,30000);
 options.signal?.addEventListener('abort',stop,{once:true});
 let accessError:Error|undefined;
 const desktopSource=async()=>{
  checkStopped(desktop.signal);
  const response=await (options.fetcher??fetch)(source.sourceUrl,{redirect:'manual',credentials:'omit',signal:desktop.signal,headers:{accept:'text/html'},cache:'no-store'});
  checkStopped(desktop.signal);
  if(response.status===401||response.status===403){
   accessError=Error('상품 페이지에서 인증·접근 확인이 필요합니다.');stop();
   void response.body?.cancel().catch(()=>{});throw accessError;
  }
  // Never follow a PC redirect or forward its cookies to the other source.
  if(!response.ok||!response.headers.get('content-type')?.toLowerCase().includes('text/html')){
   await response.body?.cancel();
   throw Error('상품 페이지에서 사용 가능한 HTML을 읽지 못했습니다.');
  }
  const reader=response.body?.getReader();if(!reader)throw Error('상품 페이지 내용이 없습니다.');
  const cancelReader=()=>{void reader.cancel().catch(()=>{});};
  desktop.signal.addEventListener('abort',cancelReader,{once:true});
  try{
   const charset=response.headers.get('content-type')?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]??'utf-8';
   const decoder=new TextDecoder(charset,{fatal:true});let html='',size=0;
   while(true){
    checkStopped(desktop.signal);
    const {done,value}=await reader.read();checkStopped(desktop.signal);if(done)break;
    size+=value.byteLength;if(size>MAX_HTML)throw Error('상품 페이지 크기가 수집 한도를 초과했습니다.');
    html+=decoder.decode(value,{stream:true});
   }
   html+=decoder.decode();checkStopped(desktop.signal);
   return parsePublicProduct(html,source.sourceUrl);
  }finally{
   desktop.signal.removeEventListener('abort',cancelReader);
   await reader.cancel().catch(()=>{});reader.releaseLock();
  }
 };
 const mobileSource=async()=>{
  await mobileGate;checkStopped(mobile.signal);
  const {collectAlibabaMobileProduct}=await import('@/app/alibaba-mobile-collector');
  checkStopped(mobile.signal);
  const result=await collectAlibabaMobileProduct(source.sourceUrl,{fetcher:options.fetcher,signal:mobile.signal});
  checkStopped(mobile.signal);return result;
 };
 try{
  if(options.signal?.aborted)stop();
  checkStopped(controller.signal);
  const result=await Promise.any([desktopSource().catch(error=>{startMobile();throw error;}),mobileSource()]);
  if(accessError)throw accessError;
  checkStopped(controller.signal);return result;
 }catch(error){
  if(accessError)throw accessError;
  checkStopped(controller.signal);
  const failures=(error as {errors?:unknown[]}).errors;
  throw failures?.[1] instanceof Error?failures[1]:Error('상품 원문과 옵션을 확인하지 못했습니다.');
 }finally{stop();clearTimeout(timeout);clearTimeout(hedge);options.signal?.removeEventListener('abort',stop);}
}
