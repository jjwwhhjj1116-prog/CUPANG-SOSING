export const FREE_IMAGE_ROLES=['main','additional','detailTop','detail','detailBottom'] as const;
export type FreeImageRole=typeof FREE_IMAGE_ROLES[number];
export type FreeImageQuotationTarget={kind:'quotation';profileId:string|null;optionId:string;input:'mainImage'|'additionalImages'|'detailImages';fieldKey:string;slotIndex:number;
 revision:number;inputFingerprint:string;optionRevision:number;bindingSha256:string;value:string};
export type FreeImageSource={productId:string;productVersion:string;contentRevision:number;sourceKey:string;sourceSha256:string;role:FreeImageRole;width:number;height:number;
 optionImages?:{revision:number;optionIds:string[];commonAssigned?:false};quotationTarget?:FreeImageQuotationTarget};
export type ImageTextRegion={id:string;text:string};
export type ImageTextTranslation={id:string;original:string;translated:string|null;issue:string|null};
export const MAX_OCR_PIXELS=12000000;
export const MAX_OCR_REGIONS=100;
export const MAX_OCR_TEXT=20000;
export function validFreeImageRole(value:unknown):value is FreeImageRole{return typeof value==='string'&&FREE_IMAGE_ROLES.some(role=>role===value);}
export function validateFreeImageSource(value:unknown):FreeImageSource{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('이미지 원본 정보를 확인해주세요.');
 const source=value as Record<string,unknown>;
 if(Object.keys(source).some(key=>!['productId','productVersion','contentRevision','sourceKey','sourceSha256','role','width','height','optionImages','quotationTarget'].includes(key))
  ||typeof source.productId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(source.productId)
  ||typeof source.productVersion!=='string'||!Number.isFinite(Date.parse(source.productVersion))
  ||!Number.isSafeInteger(source.contentRevision)||(source.contentRevision as number)<0
  ||typeof source.sourceKey!=='string'||!source.sourceKey||source.sourceKey.length>512
  ||typeof source.sourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(source.sourceSha256)||!validFreeImageRole(source.role)
  ||![source.width,source.height].every(n=>Number.isSafeInteger(n)&&(n as number)>0&&(n as number)<=16000)
  ||(source.width as number)*(source.height as number)>MAX_OCR_PIXELS)throw Error('이미지 원본·역할·저장 버전을 확인해주세요.');
 if(source.optionImages!==undefined){
  const options=source.optionImages as Record<string,unknown>;
  if(source.role!=='main'||!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['revision','optionIds','commonAssigned'].includes(key))
   ||!Number.isSafeInteger(options.revision)||(options.revision as number)<0||!Array.isArray(options.optionIds)||options.optionIds.length>200
   ||options.optionIds.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(id))||new Set(options.optionIds).size!==options.optionIds.length
   ||JSON.stringify(options.optionIds)!==JSON.stringify([...options.optionIds].sort())
   ||options.commonAssigned!==undefined&&(options.commonAssigned!==false||options.optionIds.length===0))throw Error('대표 이미지의 옵션 연결과 저장 버전을 확인해주세요.');
 }
 if(source.quotationTarget!==undefined){
  const target=source.quotationTarget as Record<string,unknown>;
  if(!target||typeof target!=='object'||Array.isArray(target)||Object.keys(target).some(key=>!['kind','profileId','optionId','input','fieldKey','slotIndex','revision','inputFingerprint','optionRevision','bindingSha256','value'].includes(key))
   ||target.kind!=='quotation'||target.profileId!==null&&(typeof target.profileId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(target.profileId))
   ||typeof target.optionId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(target.optionId)||typeof target.fieldKey!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(target.fieldKey)
   ||!['mainImage','additionalImages','detailImages'].includes(String(target.input))||source.role!==(target.input==='mainImage'?'main':target.input==='additionalImages'?'additional':'detail')||source.optionImages!==undefined
   ||![target.slotIndex,target.revision,target.optionRevision].every(n=>Number.isSafeInteger(n)&&(n as number)>=0)||(target.slotIndex as number)>29
   ||![target.inputFingerprint,target.bindingSha256].every(hash=>typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash))
   ||typeof target.value!=='string'||target.value.length>16000||target.value.split('\n').map(key=>key.trim()).filter(Boolean)[target.slotIndex as number]!==source.sourceKey
   ||target.input==='mainImage'&&(target.slotIndex!==0||typeof target.value!=='string'||target.value.split('\n').map(key=>key.trim()).filter(Boolean).length!==1))
   throw Error('최종 견적 이미지의 옵션·선택 위치·항목 연결과 저장 버전을 확인해주세요.');
 }
 return source as FreeImageSource;
}
export function freeImageSourceIdentity(source:FreeImageSource){
 const target=source.quotationTarget;
 return JSON.stringify({productId:source.productId,productVersion:source.productVersion,contentRevision:source.contentRevision,
  sourceKey:source.sourceKey,sourceSha256:source.sourceSha256,role:source.role,width:source.width,height:source.height,
  ...(source.optionImages?{optionImages:{revision:source.optionImages.revision,optionIds:source.optionImages.optionIds,
   ...(source.optionImages.commonAssigned===false?{commonAssigned:false}:{})}}:{}),
  ...(target?{quotationTarget:{kind:target.kind,profileId:target.profileId,optionId:target.optionId,input:target.input,fieldKey:target.fieldKey,slotIndex:target.slotIndex,
   revision:target.revision,inputFingerprint:target.inputFingerprint,optionRevision:target.optionRevision,bindingSha256:target.bindingSha256,value:target.value}}:{})});
}
export function validateFreeImageOptionIds(source:FreeImageSource,value:unknown):string[]{
 if(!Array.isArray(value)||value.length>200||value.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(id))||new Set(value).size!==value.length
  ||source.quotationTarget&&value.length>0||value.some(id=>source.role!=='main'||!source.optionImages?.optionIds.includes(id)))throw Error('이 원본을 대표 이미지로 사용하는 옵션만 선택해주세요.');
 return [...value].sort() as string[];
}
export function freeImageApplyIdentity(source:FreeImageSource,optionImageIds:readonly string[]=[]){
 const ids=validateFreeImageOptionIds(source,[...optionImageIds]);
 if(source.optionImages?.commonAssigned===false&&!ids.length)throw Error('이 개별 사진을 반영할 옵션을 한 개 이상 선택해주세요. 공통 대표 이미지는 변경하지 않습니다.');
 return ids.length?JSON.stringify({source:freeImageSourceIdentity(source),optionImageIds:ids}):freeImageSourceIdentity(source);
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
