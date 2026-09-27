import { parseCollectionRequest } from '@/app/sourcing';
import { COLLECTION_RESULT_LIMIT, validateCollectionResult } from '@/app/collection-result';
import { parse, type DefaultTreeAdapterMap } from 'parse5';

const MAX_HTML = 2 * 1024 * 1024;
type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const list = (value: unknown): unknown[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const hasType = (value: RecordValue, type: string) => list(value['@type']).some(item => item === type || item === `https://schema.org/${type}` || item === `http://schema.org/${type}`);
const required = (value: unknown, label: string): string => { if(typeof value !== 'string' || !value.trim())throw Error(`${label}을 상품 페이지에서 확인하지 못했습니다.`); return value; };
function number(value: unknown): number { return typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN; }
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
 const matches = nodes.filter(node => (hasType(node,'Product') || hasType(node,'ProductGroup')) && list(node.url).some(url => {
  try{return parseCollectionRequest({urls:[url]})[0].offerId===source.offerId;}catch{return false;}
 }));
 if(matches.length!==1)throw Error('이 URL의 상품·옵션 정보를 페이지에서 명확히 확인하지 못했습니다. 로그인 또는 페이지 수집 연결이 필요합니다.');
 const product=matches[0];
 // Preserve explicitly published product facts for the downstream SEO review.
 // Variant-specific facts must not become common facts for every SKU.
 const attributes = product.additionalProperty === undefined ? undefined : list(product.additionalProperty).map(entry => {
  const property = object(entry);
  if (!hasType(property, 'PropertyValue')) throw Error('상품 속성 형식을 확인하지 못했습니다.');
  const name = required(property.name, '상품 속성명');
  const scalar = property.value;
  if (!(typeof scalar === 'string' || typeof scalar === 'boolean' || typeof scalar === 'number' && Number.isFinite(scalar))) throw Error('상품 속성 값을 확인하지 못했습니다.');
  const value = required(String(scalar), '상품 속성 값');
  const unit = property.unitText !== undefined ? required(property.unitText, '상품 속성 단위')
   : property.unitCode !== undefined ? required(property.unitCode, '상품 속성 단위 코드') : '';
  return {name, value: unit ? `${value} ${unit}` : value};
 });
 const variants=product.hasVariant===undefined?[product]:list(product.hasVariant).map(object);
 if(!variants.length||variants.length>200)throw Error('옵션 1~200개를 확인해야 합니다.');
 const images: {url:string;role:'main'|'additional'|'detail'}[]=[];
 const addImages=(value:unknown)=>list(value).map(item=>{
  const url=required(typeof item==='string'?item:object(item).contentUrl??object(item).url,'이미지 주소');
  let index=images.findIndex(image=>image.url===url);
  if(index<0){index=images.length;images.push({url,role:index===0?'main':'additional'});}
  return index;
 });
 addImages(product.image);
 const options=variants.map(variant=>{
  const offers=list(variant.offers).map(object);
  if(offers.length!==1||!hasType(offers[0],'Offer'))throw Error('옵션별 단일 원가를 확인하지 못했습니다. 가격 범위는 원가로 사용하지 않습니다.');
  const offer=offers[0];if(offer.priceCurrency!=='CNY')throw Error('옵션 원가의 CNY 통화를 확인하지 못했습니다.');
  const minimumOrder=number(object(offer.eligibleQuantity).minValue);
  if(!Number.isSafeInteger(minimumOrder)||minimumOrder<1)throw Error('최소 주문 수량을 확인하지 못했습니다.');
  // Keep the seller's stated quantity, including zero. Availability labels and
  // ranges are not counts; weight/volume inventory cannot become piece stock.
  const inventory=object(offer.inventoryLevel);
  const countUnit=inventory.unitCode===undefined && inventory.unitText===undefined;
  let stock:number|null=null;
  if(hasType(inventory,'QuantitativeValue') && countUnit && inventory.value!==undefined
    && inventory.minValue===undefined && inventory.maxValue===undefined){
   stock=number(inventory.value);
   if(!Number.isSafeInteger(stock)||stock<0)throw Error('옵션 재고 수량은 0 이상 정수여야 합니다.');
  }
  const indices=addImages(variant.image);
  return {sku:required(variant.sku??offer.sku,'SKU'),name:required(variant.name,'옵션명'),unitPriceCny:number(offer.price),minimumOrder,stock,
   ...(indices.length?{imageIndex:indices[0]}:{}),...(typeof variant.color==='string'?{color:variant.color}:{}),...(typeof variant.size==='string'?{size:variant.size}:{})};
 });
 const result=validateCollectionResult({schemaVersion:1,sourceUrl:source.sourceUrl,provider:'public-product-jsonld-v1',collectedAt:new Date(now).toISOString(),
  title:required(product.name,'상품명'),description:typeof product.description==='string'?product.description:'',options,images,...(attributes !== undefined ? {attributes} : {})},source.offerId,now);
 if(new TextEncoder().encode(JSON.stringify(result)).byteLength>COLLECTION_RESULT_LIMIT)throw Error('수집 결과 크기가 한도를 초과했습니다.');
 return result;
}

export async function collectPublicProduct(sourceUrl:string, options:{fetcher?:typeof fetch;signal?:AbortSignal}={}) {
 const source=parseCollectionRequest({urls:[sourceUrl]})[0];
 const controller=new AbortController();const stop=()=>controller.abort();
 options.signal?.addEventListener('abort',stop,{once:true});
 const timeout=setTimeout(stop,15000);
 try{
  if(options.signal?.aborted)controller.abort();
  const response=await (options.fetcher??fetch)(source.sourceUrl,{redirect:'manual',credentials:'omit',signal:controller.signal,headers:{accept:'text/html'},cache:'no-store'});
  if(!response.ok)throw Error('상품 페이지를 읽지 못했습니다. 로그인·접근 제한 또는 일시적 오류를 확인해주세요.');
  if(!response.headers.get('content-type')?.toLowerCase().includes('text/html'))throw Error('상품 페이지 HTML 응답이 아닙니다.');
  const reader=response.body?.getReader();if(!reader)throw Error('상품 페이지 내용이 없습니다.');
  const charset=response.headers.get('content-type')?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]??'utf-8';
  const decoder=new TextDecoder(charset,{fatal:true});let html='',size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_HTML){await reader.cancel();throw Error('상품 페이지 크기가 수집 한도를 초과했습니다.');}html+=decoder.decode(value,{stream:true});}html+=decoder.decode();}finally{reader.releaseLock();}
  return parsePublicProduct(html,source.sourceUrl);
 }finally{controller.abort();clearTimeout(timeout);options.signal?.removeEventListener('abort',stop);}
}
