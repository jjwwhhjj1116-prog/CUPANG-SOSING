import { parsePublicProduct } from '@/app/public-product-collector';

/** The extension supplies inert JSON-LD from the user's current Chrome
 * profile. All product facts still pass the same strict public parser. */
export function parseBrowserProductCapture(input:unknown,sourceUrl:string){
 const body=input&&typeof input==='object'&&!Array.isArray(input)?input as Record<string,unknown>:{};
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
