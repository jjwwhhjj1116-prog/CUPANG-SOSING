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
 const controller=new AbortController();const stop=()=>controller.abort();
 options.signal?.addEventListener('abort',stop,{once:true});
 const timeout=setTimeout(stop,30000);
 try{
  if(options.signal?.aborted)controller.abort();
  const response=await (options.fetcher??fetch)(source.sourceUrl,{redirect:'manual',credentials:'omit',signal:controller.signal,headers:{accept:'text/html'},cache:'no-store'});
  if(!response.ok)throw Error('상품 페이지를 읽지 못했습니다. 로그인·접근 제한 또는 일시적 오류를 확인해주세요.');
  if(!response.headers.get('content-type')?.toLowerCase().includes('text/html'))throw Error('상품 페이지 HTML 응답이 아닙니다.');
  const reader=response.body?.getReader();if(!reader)throw Error('상품 페이지 내용이 없습니다.');
  const charset=response.headers.get('content-type')?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]??'utf-8';
  const decoder=new TextDecoder(charset,{fatal:true});let html='',size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_HTML){await reader.cancel();throw Error('상품 페이지 크기가 수집 한도를 초과했습니다.');}html+=decoder.decode(value,{stream:true});}html+=decoder.decode();}finally{reader.releaseLock();}
  try { return parsePublicProduct(html,source.sourceUrl); }
  catch {
   if(controller.signal.aborted)throw Error('상품 수집을 취소했거나 응답 시간이 초과되었습니다.');
   // 1688's PC response may have no public JSON-LD. Its official mobile page
   // and anonymous SKU service provide the actual source, not guessed offers.
   const {collectAlibabaMobileProduct}=await import('@/app/alibaba-mobile-collector');
   return await collectAlibabaMobileProduct(source.sourceUrl,{fetcher:options.fetcher,signal:controller.signal});
  }
 }finally{controller.abort();clearTimeout(timeout);options.signal?.removeEventListener('abort',stop);}
}
