import { parseCollectionRequest } from '@/app/sourcing';
import { collectionSourceGaps } from '@/app/collection-source-gaps';
import { validateAlibabaSourcePriceBasis, type AlibabaSourcePriceBasis } from '@/app/alibaba-source-pricing';
import { validateAlibabaOfferDefault, type AlibabaOfferDefault } from '@/app/alibaba-offer-default';
import {validateCollectionSourceGallery,type CollectionSourceGallery} from '@/app/collection-gallery';
import {validatePageOptionIdentity,type PageOptionIdentity} from '@/app/page-option-identity';

export const COLLECTION_RESULT_LIMIT = 512 * 1024;
/** Derived from the server-validated source contract; persists with receipts. */
export function collectionSourceWarnings(result: Pick<CollectionResult, 'description' | 'images' | 'attributes'> & Partial<Pick<CollectionResult,'options'|'pageOptionIdentity'>>): string[] {
  const gaps = collectionSourceGaps(result);
  return [...(gaps.length ? [`상품 원문을 가져왔습니다. ${gaps.map(gap => gap.label).join('·')}은 수집 원문에 없어 직접 확인·입력해야 합니다.`] : []),
    ...(result.options?.some(option=>option.minimumOrder===null)?['공급자 최소 주문 수량은 미확인으로 보관했습니다. 가격 설정에서 원문을 확인해 입력하세요. 판매 단위·납품 수량으로 대체하지 않습니다.']:[]),
    ...(result.pageOptionIdentity&&result.options?.some(option=>option.sku==='')?['공급자 SKU는 미확인 공란으로 보관했습니다. 옵션 원문 키로 초안을 구분하며 공급자 코드나 서플라이허브 SKU를 만들지 않습니다. 옵션 이미지는 원본 목록에서 확인해 선택하세요.']:[])];
}
export type CollectionResult = {
  schemaVersion: 1; sourceUrl: string; offerId: string; provider: string; collectedAt: string;
  title: string; description: string;
  attributes?: { name: string; value: string }[];
  priceBasis?: AlibabaSourcePriceBasis;
  offerDefault?: AlibabaOfferDefault;
  sourceGallery?: CollectionSourceGallery;
  pageOptionIdentity?: PageOptionIdentity;
  options: { sku: string; name: string; unitPriceCny: number; minimumOrder: number | null; stock: number | null; imageIndex?: number; color?: string; size?: string;packaging?:{source:'package-table';weightG?:number;widthMm?:number;lengthMm?:number;heightMm?:number} }[];
  images: { url: string; role: 'main' | 'additional' | 'detail' }[];
};
function record(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('수집 결과 객체를 확인해주세요.');
  const result=value as Record<string,unknown>;
  if(Object.keys(result).some(key=>!keys.includes(key)))throw new Error('수집 결과에 지원하지 않는 항목이 있습니다.');
  return result;
}
function text(value: unknown, max: number, required=true) {
  if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)||(required&&!value.trim()))throw new Error('수집 텍스트의 길이와 내용을 확인해주세요.');
  return value.trim();
}
function optionPackaging(value:unknown):NonNullable<CollectionResult['options'][number]['packaging']>{
 const row=record(value,['source','weightG','widthMm','lengthMm','heightMm']);
 if(row.source!=='package-table'||!['weightG','widthMm','lengthMm','heightMm'].some(key=>Object.hasOwn(row,key)))throw Error('옵션 포장 표 원문의 기준을 확인해주세요.');
 for(const key of ['weightG','widthMm','lengthMm','heightMm'])if(Object.hasOwn(row,key)&&(!Number.isSafeInteger(row[key])||(row[key] as number)<=0||(row[key] as number)>(key==='weightG'?1e9:1e6)))throw Error('수집한 포장 무게·치수는 명시된 g·mm 단위의 양수 정수여야 합니다.');
 return {...row} as NonNullable<CollectionResult['options'][number]['packaging']>;
}
export function validateCollectionResult(input: unknown, expectedOfferId: string, now=Date.now()): CollectionResult {
  const body=record(input,['schemaVersion','sourceUrl','provider','collectedAt','title','description','options','images','attributes','priceBasis','offerDefault','sourceGallery','pageOptionIdentity']);
  if(body.schemaVersion!==1)throw new Error('지원하지 않는 수집 결과 버전입니다.');
  const source=parseCollectionRequest({urls:[body.sourceUrl]})[0];
  if(source.offerId!==expectedOfferId)throw new Error('요청한 상품번호와 수집 결과가 다릅니다.');
  const timestamp=text(body.collectedAt,40);
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(timestamp)||!Number.isFinite(Date.parse(timestamp))||Date.parse(timestamp)>now+300000)throw new Error('수집 시각은 UTC 시각이어야 하며 미래일 수 없습니다.');
  if(!Array.isArray(body.options)||body.options.length<1||body.options.length>200)throw new Error('실제 옵션 1~200개가 필요합니다.');
  const skus=new Set<string>();
  const hasOfferDefault=Object.hasOwn(body,'offerDefault');
  const provider=text(body.provider,100);
  const pageOptionIdentity=Object.hasOwn(body,'pageOptionIdentity')?validatePageOptionIdentity(body.pageOptionIdentity,provider,source.offerId,body.options.length,hasOfferDefault,Object.hasOwn(body,'priceBasis')):undefined;
  const options=body.options.map(value=>{
    const row=record(value,['sku','name','unitPriceCny','minimumOrder','stock','imageIndex','color','size','packaging']);
    if(hasOfferDefault&&row.sku!=='')throw new Error('기본 옵션을 실제 공급자 SKU로 바꿀 수 없습니다.');
    const sku=text(row.sku,200,!hasOfferDefault&&!pageOptionIdentity);if(sku!==''&&skus.has(sku)||sku===''&&!pageOptionIdentity&&skus.has(sku))throw new Error('중복 SKU가 있습니다.');skus.add(sku);
    if(typeof row.unitPriceCny!=='number'||!Number.isFinite(row.unitPriceCny)||row.unitPriceCny<=0||row.unitPriceCny>100000000)throw new Error('옵션 원가는 양수 CNY 숫자여야 합니다.');
    if(row.minimumOrder!==null&&(!Number.isSafeInteger(row.minimumOrder)||(row.minimumOrder as number)<1))throw new Error('최소 주문 수량은 미확인 null 또는 양수 정수여야 합니다.');
    if(row.stock!==null&&(!Number.isSafeInteger(row.stock)||(row.stock as number)<0))throw new Error('재고 미확인은 null, 확인된 재고는 0 이상 정수여야 합니다.');
    if(row.imageIndex!==undefined&&(!Number.isInteger(row.imageIndex)||!Array.isArray(body.images)||(row.imageIndex as number)<0||(row.imageIndex as number)>=body.images.length))throw new Error('옵션 이미지 번호는 수집 이미지 목록의 0부터 시작하는 번호여야 합니다.');
    return {sku,name:text(row.name,500),unitPriceCny:row.unitPriceCny,minimumOrder:row.minimumOrder as number|null,stock:row.stock as number|null,...(row.imageIndex!==undefined?{imageIndex:row.imageIndex as number}:{}),
      ...(row.color!==undefined?{color:text(row.color,200,false)}:{}), ...(row.size!==undefined?{size:text(row.size,200,false)}:{}),...(Object.hasOwn(row,'packaging')?{packaging:optionPackaging(row.packaging)}:{})};
  });
  if(!Array.isArray(body.images)||body.images.length>200)throw new Error('이미지 주소는 200개 이하여야 합니다.');
  const seen=new Set<string>();let mainCount=0;
  const images=body.images.map(value=>{
    const row=record(value,['url','role']);const url=new URL(text(row.url,2048));
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!(url.hostname==='alicdn.com'||url.hostname.endsWith('.alicdn.com')))throw new Error('이미지는 HTTPS Alibaba CDN 주소만 허용합니다.');
    if(!['main','additional','detail'].includes(String(row.role)))throw new Error('이미지 역할을 확인해주세요.');
    const assignment=`${row.role}:${url.href}`;
    if(seen.has(assignment))throw new Error('같은 배치에 중복 이미지 주소가 있습니다.');seen.add(assignment);
    if(row.role==='main'&&++mainCount>1)throw new Error('대표 이미지는 한 장만 지정해주세요.');
    return {url:url.href,role:row.role as 'main'|'additional'|'detail'};
  });
  let attributes: CollectionResult['attributes'];
  if (body.attributes !== undefined) {
    if (!Array.isArray(body.attributes) || body.attributes.length > 50) throw new Error('상품 속성 원문은 최대 50개입니다.');
    attributes = body.attributes.map(value => { const pair = record(value, ['name', 'value']); return { name: text(pair.name, 190), value: text(pair.value, 1000) }; });
  }
  const title=text(body.title,500);
  const offerDefault=hasOfferDefault?validateAlibabaOfferDefault(body.offerDefault,provider,source.offerId,title,options,images,Object.hasOwn(body,'priceBasis')):undefined;
  const priceBasis=body.priceBasis!==undefined?validateAlibabaSourcePriceBasis(body.priceBasis,provider,options):undefined;
  const sourceGallery=Object.hasOwn(body,'sourceGallery')?validateCollectionSourceGallery(body.sourceGallery,provider,images):undefined;
  return {schemaVersion:1,sourceUrl:source.sourceUrl,offerId:source.offerId,provider,collectedAt:new Date(timestamp).toISOString(),title,description:text(body.description,20000,false),options,images,...(attributes !== undefined ? { attributes } : {}),...(priceBasis!==undefined?{priceBasis}:{}),...(offerDefault?{offerDefault}:{}),...(sourceGallery?{sourceGallery}:{}),...(pageOptionIdentity?{pageOptionIdentity}:{})};
}
