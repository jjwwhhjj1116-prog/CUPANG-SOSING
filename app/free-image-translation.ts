export const FREE_IMAGE_ROLES=['main','additional','detailTop','detail','detailBottom'] as const;
export type FreeImageRole=typeof FREE_IMAGE_ROLES[number];
export type FreeImageSource={productId:string;productVersion:string;contentRevision:number;sourceKey:string;sourceSha256:string;role:FreeImageRole;width:number;height:number};
export type ImageTextRegion={id:string;text:string};
export type ImageTextTranslation={id:string;original:string;translated:string|null;issue:string|null};
export const MAX_OCR_PIXELS=12000000;
export const MAX_OCR_REGIONS=100;
export const MAX_OCR_TEXT=20000;
export function validFreeImageRole(value:unknown):value is FreeImageRole{return typeof value==='string'&&FREE_IMAGE_ROLES.some(role=>role===value);}
export function validateFreeImageSource(value:unknown):FreeImageSource{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('이미지 원본 정보를 확인해주세요.');
 const source=value as Record<string,unknown>;
 if(Object.keys(source).some(key=>!['productId','productVersion','contentRevision','sourceKey','sourceSha256','role','width','height'].includes(key))
  ||typeof source.productId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(source.productId)
  ||typeof source.productVersion!=='string'||!Number.isFinite(Date.parse(source.productVersion))
  ||!Number.isSafeInteger(source.contentRevision)||(source.contentRevision as number)<0
  ||typeof source.sourceKey!=='string'||!source.sourceKey||source.sourceKey.length>512
  ||typeof source.sourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(source.sourceSha256)||!validFreeImageRole(source.role)
  ||![source.width,source.height].every(n=>Number.isSafeInteger(n)&&(n as number)>0&&(n as number)<=16000)
  ||(source.width as number)*(source.height as number)>MAX_OCR_PIXELS)throw Error('이미지 원본·역할·저장 버전을 확인해주세요.');
 return source as FreeImageSource;
}
export function validateImageTextRegions(value:unknown):ImageTextRegion[]{
 if(!Array.isArray(value)||!value.length||value.length>MAX_OCR_REGIONS)throw Error('번역할 문구는 1~100개 영역으로 선택해주세요.');
 let total=0;const ids=new Set<string>();
 const regions=value.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(key=>!['id','text'].includes(key))
   ||typeof row.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(row.id)||ids.has(row.id)
   ||typeof row.text!=='string'||!row.text.trim()||row.text.length>5000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(row.text))throw Error('문구의 식별자와 원문을 확인해주세요.');
  ids.add(row.id);total+=row.text.length;return{id:row.id,text:row.text};
 });
 if(total>MAX_OCR_TEXT)throw Error('한 번에 번역할 문구는 총 20,000자 이내로 선택해주세요.');
 return regions;
}
