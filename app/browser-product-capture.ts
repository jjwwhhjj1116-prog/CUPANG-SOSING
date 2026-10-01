import { parsePublicProduct } from '@/app/public-product-collector';
import { parseAlibabaMobilePage, parseAlibabaMobileDescription, parseAlibabaMobileProduct, parseAlibabaPublicSkuProduct } from '@/app/alibaba-mobile-product';

/** The extension supplies inert JSON-LD from the user's current Chrome
 * profile. All product facts still pass the same strict public parser. */
export function parseBrowserProductCapture(input:unknown,sourceUrl:string){
 const body=input&&typeof input==='object'&&!Array.isArray(input)?input as Record<string,unknown>:{};
 if(body.format==='1688-public-sku-capture-v1'){
  if(body.sourceUrl!==sourceUrl||Object.keys(body).some(key=>!['format','sourceUrl','skuPayload','ok'].includes(key)))throw Error('1688 옵션 원문과 요청 URL이 일치하지 않습니다.');
  return {...parseAlibabaPublicSkuProduct(body.skuPayload,sourceUrl),provider:'chrome-public-sku-v1'};
 }
 if(body.format==='1688-public-mobile-capture-v1'){
  if(body.sourceUrl!==sourceUrl||Object.keys(body).some(key=>!['format','sourceUrl','mobileHtml','skuPayload','detailSource','ok'].includes(key)))throw Error('1688 모바일 원문과 요청 URL이 일치하지 않습니다.');
  if(typeof body.mobileHtml!=='string'||!body.mobileHtml.trim()||typeof body.detailSource!=='string'||!body.skuPayload||typeof body.skuPayload!=='object'||Array.isArray(body.skuPayload))throw Error('1688 모바일 상품 원문 형식을 확인하지 못했습니다.');
  for(const value of [body.mobileHtml,body.detailSource,JSON.stringify(body.skuPayload)])if(new TextEncoder().encode(value).byteLength>2*1024*1024)throw Error('1688 모바일 원문이 수집 한도를 초과했습니다.');
  const page=parseAlibabaMobilePage(body.mobileHtml,sourceUrl);
  if(Boolean(page.detailUrl)!==Boolean(body.detailSource.trim()))throw Error('1688 상세 원문이 상품 페이지의 상세 주소와 일치하지 않습니다.');
  return {...parseAlibabaMobileProduct(page,body.skuPayload,body.detailSource?parseAlibabaMobileDescription(body.detailSource):''),provider:'chrome-public-mobile-v1'};
 }
 if(body.format!==undefined)throw Error('지원하지 않는 상품 수집 원문 형식입니다.');
 if(body.sourceUrl!==sourceUrl||!Array.isArray(body.scripts)||body.scripts.length<1||body.scripts.length>30)throw Error('1688 상품 페이지 원문과 요청 URL이 일치하지 않습니다.');
 let total=0;
 const scripts=body.scripts.map(value=>{
  if(typeof value!=='string'||!value.trim())throw Error('1688 상품 구조화 데이터 형식을 확인하지 못했습니다.');
  total+=new TextEncoder().encode(value).byteLength;
  if(total>1500000)throw Error('1688 상품 구조화 데이터가 수집 한도를 초과했습니다.');
  let parsed:unknown;try{parsed=JSON.parse(value);}catch{throw Error('1688 상품 구조화 데이터가 올바른 JSON이 아닙니다.');}
  return `<script type="application/ld+json">${JSON.stringify(parsed).replace(/</g,'\\u003c')}</script>`;
 });
 return {...parsePublicProduct(scripts.join(''),sourceUrl),provider:'chrome-product-jsonld-v1'};
}
