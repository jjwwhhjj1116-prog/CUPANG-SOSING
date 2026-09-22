import type { ProductContent } from '@/app/product-content';
import type { ProductRecord } from '@/db/queries';
import { quotationCsv } from '@/app/pricing';
import { zipFiles } from '@/app/exports/zip';

export type BundleAsset = { key: string; name: string; data: Uint8Array };
const escape = (value: string) => value.replace(/[&<>"']/g, character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));
export function imageExtension(bytes: Uint8Array) {
  if(bytes.length>=8 && [137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))return 'png';
  if(bytes.length>=3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255)return 'jpg';
  const ascii=(start:number,end:number)=>String.fromCharCode(...bytes.slice(start,end));
  if(bytes.length>=12 && ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP')return 'webp';
  if(bytes.length>=6 && ['GIF87a','GIF89a'].includes(ascii(0,6)))return 'gif';
  if(bytes.length>=16 && ascii(4,8)==='ftyp') {
    const boxSize=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0);
    if(boxSize>=16 && boxSize<=bytes.length && boxSize<=1024) {
      const brands=[ascii(8,12)];for(let offset=16;offset+4<=boxSize;offset+=4)brands.push(ascii(offset,offset+4));
      if(brands.some(brand=>brand==='avif'||brand==='avis'))return 'avif';
    }
  }
  throw new Error('PNG/JPEG/WebP/GIF/AVIF 이미지 파일만 검토 패키지에 넣을 수 있습니다.');
}

export function createReviewBundle(product: ProductRecord, content: ProductContent, assets: BundleAsset[], extraFiles: {name:string;data:string|Uint8Array}[] = []) {
  const exportedAt=new Date().toISOString();
  const title=content.seo.title.value || product.title;
  const roleFiles=Object.fromEntries(Object.entries(content.assets).map(([role,field])=>[role,field.value.map(key=>{
    const asset=assets.find(item=>item.key===key);if(!asset)throw new Error('첨부 파일이 누락되었습니다.');return asset.name;
  })]));
  const missing:string[]=[];
  if(!content.seo.title.value.trim())missing.push('노출 상품명');
  if(!content.seo.description.value.trim())missing.push('상세 설명');
  if(!content.assets.main.value.length)missing.push('대표 이미지');
  if(!content.assets.detail.value.length)missing.push('상세 이미지');
  for(const key of ['productName','manufacturer','importer','countryOfOrigin','contact'] as const)if(!content.label[key].value.trim())missing.push('표시사항: '+key);
  missing.push('공식 Supplier Hub 카테고리/Excel 매핑','실상품 수집 증거','카테고리별 필수 서류 검토');
  const labelNames:Record<string,string>={productName:'품명',model:'모델',material:'재질',dimensions:'크기',manufacturer:'제조사',importer:'수입자',countryOfOrigin:'제조국',contact:'문의 연락처',certification:'인증 정보',precautions:'주의사항',qualityAssurance:'품질보증'};
  const labelLines=['검토용 표시사항 · 입력값 기준',...Object.entries(content.label).flatMap(([key,field])=>{
    const text=(labelNames[key]||key)+': '+(field.value || '[미입력]');
    return text.match(/.{1,45}/gu)??[text];
  })];
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="840" height="${70+labelLines.length*30}" viewBox="0 0 840 ${70+labelLines.length*30}"><rect width="100%" height="100%" fill="white"/><g font-family="sans-serif" font-size="18" fill="#111827">${labelLines.map((text,index)=>`<text x="24" y="${36+index*30}">${escape(text)}</text>`).join('')}</g></svg>`;
  const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><title>${escape(title)}</title><style>body{max-width:860px;margin:32px auto;padding:20px;font-family:sans-serif;line-height:1.7}img{max-width:100%;height:auto}.note{background:#fff2ce;padding:12px}pre{white-space:pre-wrap;font-family:inherit}</style><body><p class="note">내부 검토 자료 · 자동 번역/공식 견적서 검증을 의미하지 않습니다.</p><h1>${escape(title)}</h1><p>${escape(content.seo.keywords.value.join(', '))}</p><pre>${escape(content.seo.description.value)}</pre>${(roleFiles.detail||[]).map(name=>`<img src="${escape(name)}" alt="상세 이미지">`).join('')}</body></html>`;
  const manifest={format:'sourceflow-review-bundle-v1',productId:product.id,contentRevision:content.revision,productUpdatedAt:product.updated_at,exportedAt,submissionReady:false,missing,assets:roleFiles,pricePolicy:product.pricing_policy?JSON.parse(product.pricing_policy):null};
  return zipFiles([
    {name:'README.txt',data:'SourceFlow 내부 검토 패키지\nSupplier Hub 공식 Excel/등록 패키지가 아닙니다.\n원문 수집·자동 번역·필수 서류 검증 상태는 manifest.json을 확인하세요.\nlabel-review.svg는 사용자가 저장한 표시사항을 조판한 초안입니다.\n'},
    {name:'manifest.json',data:JSON.stringify(manifest,null,2)},
    {name:'content.json',data:JSON.stringify(content,null,2)},
    {name:'quotation-review.csv',data:quotationCsv([['문서','내부 검토용'],['상품명','원가 CNY','공급가 KRW','판매가 KRW','MSRP KRW','옵션 수'],[title,product.source_price_cny,product.supply_price,product.sale_price,product.msrp,product.options_count]])},
    {name:'detail-review.html',data:html},
    {name:'label-review.svg',data:svg},
    ...assets.map(asset=>({name:asset.name,data:asset.data})),
    ...extraFiles,
  ]);
}
