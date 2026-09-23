import { imageFileType, MAX_IMAGE_BYTES, isOwnedImageKey } from '@/app/image-files';
import { readBoundedStream } from '@/app/request-body';
import type { ProductContent } from '@/app/product-content';
import type { ProductOptions } from '@/app/product-options';

/** Only the receipt's exact supplier SKU may receive an original image. */
export function attachCollectedOptionImage(current:ProductOptions,skus:readonly string[],key:string,now:string):ProductOptions {
 const next=structuredClone(current);const selected=new Set(skus);let changed=false;
 for(const row of next.rows){
  if(!selected.has(row.supplierSku)||row.provenance.supplierSku!=='collected'||row.provenance.imageKey!=='unverified'||row.imageKey)continue;
  row.imageKey=key;row.provenance.imageKey='collected';row.updatedAt=now;changed=true;
 }
 if(changed){next.revision++;next.updatedAt=now;}
 return next;
}

export async function downloadCollectionImage(source:string,owner:string,fetcher:typeof fetch=fetch){
 const url=new URL(source);
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!(url.hostname==='alicdn.com'||url.hostname.endsWith('.alicdn.com')))throw new Error('허용된 Alibaba 이미지 주소가 아닙니다.');
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetcher(url.href,{redirect:'manual',credentials:'omit',signal:controller.signal});
  if(!response.ok){await response.body?.cancel();throw new Error('이미지 응답 오류 또는 이동 응답입니다.');}
  if(Number(response.headers.get('content-length'))>MAX_IMAGE_BYTES){await response.body?.cancel();throw new Error('이미지는 10MB 이하여야 합니다.');}
  const bytes=await readBoundedStream(response.body,MAX_IMAGE_BYTES);const actual=imageFileType(bytes);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.buffer as ArrayBuffer))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const key=`${owner}/collected-${digest}.${actual.extension}`;
  if(!isOwnedImageKey(owner,key))throw new Error('이미지 소유자를 확인해주세요.');
  return {bytes,key,...actual};
 }finally{clearTimeout(timer);}
}

export function attachCollectedImage(current:ProductContent,keys:string[],key:string,role:'main'|'additional'|'detail',now:string){
 if(!keys.includes(key)&&keys.length>=50)throw new Error('상품 이미지 50개 제한입니다. 이미지를 정리해주세요.');
 const next=structuredClone(current);const target=next.assets[role];
 // Manual selections (including deliberately empty ones) and translated/generated work survive imports.
 const editable=target.provenance==='unverified'||target.provenance==='collected';
 if(editable&&!target.value.includes(key)&&target.value.length<(role==='main'?1:30)){
  next.assets[role]={value:[...target.value,key],provenance:'collected',updatedAt:now};
 }
 next.revision=current.revision+1;next.updatedAt=now;
 return {content:next,keys:[...new Set([...keys,key])],assigned:next.assets[role].value.includes(key)};
}
