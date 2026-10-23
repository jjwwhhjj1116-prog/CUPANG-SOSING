import {readLegalDocuments,readNativeLegalBinding,LEGAL_DOCUMENT_LIMIT,LEGAL_DOCUMENT_TOTAL_LIMIT} from '@/app/legal-documents';
import {supplierHubCompany,type SupplierHubCompany} from '@/app/supplier-hub-company';
import type {NativeLegalBinding,NativeLegalContext,NativeLegalIssue,NativeLegalType} from '@/app/native-legal-binding';

export const NATIVE_LEGAL_ATTACHMENT_PLAN_FORMAT='yoofam-native-legal-attachment-plan-v1';
/** Retained SR upload batch order. These are bucket names, not applicability. */
export const NATIVE_LEGAL_BUCKET_ORDER:readonly NativeLegalType[]=['import_type','certificate','additional','categoryCert','adCert','msds'];
export type NativeLegalAttachmentIdentity={ownerId:string;productId:string;company:SupplierHubCompany;categoryId:string;categoryPath:string[];schemaSha256:string;
 sourceFingerprint:string;inputFingerprint:string;source:{productVersion:string;contentRevision:number;optionRevision:number;quotationRevision:number;profileId:string|null;profileRevision:number|null};
 members:{optionId:string;optionLabel:string;documentIndex:number}[]};
export type NativeLegalAttachmentFile={key:string;originalName:string;transportName:string;type:'pdf';contentType:'application/pdf';byteLength:number;sha256:string;
 nativeType:NativeLegalType;binding:NativeLegalBinding;targetId:string;downloadPath:string};
export type NativeLegalAttachmentPlan={format:typeof NATIVE_LEGAL_ATTACHMENT_PLAN_FORMAT;identity:NativeLegalAttachmentIdentity|null;identityDigest:string|null;
 applicability:'required'|'not-applicable'|'unconfirmed';targets:{id:string;binding:NativeLegalBinding}[];files:NativeLegalAttachmentFile[];groups:{nativeType:NativeLegalType;fileKeys:string[]}[];
 issues:NativeLegalIssue[];metadataValid:boolean;planSha256:string|null;registered:false;remoteWrites:false;submissionReady:false;transportReady:false;bytesVerified:false};
const HASH=/^[a-f0-9]{64}$/,ID=/^\w[\w-]{0,99}$/;
const own=(value:unknown,required:readonly string[],optional:readonly string[]=[]):value is Record<string,unknown>=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
 return required.every(key=>Object.hasOwn(descriptors,key))&&keys.every(key=>typeof key==='string'&&[...required,...optional].includes(key)&&Object.hasOwn(descriptors[key],'value'));
};
const dense=(value:unknown,max:number):value is unknown[]=>Array.isArray(value)&&value.length<=max&&Reflect.ownKeys(value).length===value.length+1
 &&Object.keys(value).every((key,index)=>key===String(index))&&Object.values(Object.getOwnPropertyDescriptors(value)).every(field=>Object.hasOwn(field,'value'));
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const revision=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;

/** Stable metadata encoding only. Never executes getters/toJSON or reads bytes. */
export function nativeLegalAttachmentCanonical(value:unknown):string{
 let nodes=0;const seen=new Set<object>();
 const visit=(item:unknown,depth:number):string=>{
  if(++nodes>30000||depth>25)throw Error('서류 준비 메타데이터가 처리 범위를 초과했습니다.');
  if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return JSON.stringify(item);
  if(!item||typeof item!=='object'||seen.has(item))throw Error('서류 준비 메타데이터의 JSON 형식을 확인해주세요.');
  const descriptors=Object.getOwnPropertyDescriptors(item),keys=Reflect.ownKeys(descriptors);
  if(keys.some(key=>typeof key!=='string')||Object.values(descriptors).some(field=>!Object.hasOwn(field,'value')))throw Error('서류 준비 메타데이터의 값 형식을 확인해주세요.');
  seen.add(item);let result:string;
  if(Array.isArray(item)){
   if(!dense(item,2000))throw Error('서류 준비 메타데이터의 배열을 확인해주세요.');
   result='['+Array.from({length:item.length},(_,index)=>visit(descriptors[String(index)].value,depth+1)).join(',')+']';
  }else{
   const prototype=Object.getPrototypeOf(item);
   if(prototype!==null&&Object.getPrototypeOf(prototype)!==null)throw Error('서류 준비 메타데이터의 객체를 확인해주세요.');
   if(keys.some(key=>typeof key==='string'&&(!descriptors[key].enumerable||['__proto__','prototype','constructor'].includes(key))))throw Error('서류 준비 메타데이터의 항목을 확인해주세요.');
   result='{'+(keys as string[]).sort().map(key=>JSON.stringify(key)+':'+visit(descriptors[key].value,depth+1)).join(',')+'}';
  }
  seen.delete(item);return result;
 };
 const result=visit(value,0);if(new TextEncoder().encode(result).byteLength>1024*1024)throw Error('서류 준비 메타데이터가 너무 큽니다.');return result;
}
const same=(left:unknown,right:unknown)=>nativeLegalAttachmentCanonical(left)===nativeLegalAttachmentCanonical(right);
const digest=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(nativeLegalAttachmentCanonical(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
function identityValid(value:unknown):value is NativeLegalAttachmentIdentity{
 if(!own(value,['ownerId','productId','company','categoryId','categoryPath','schemaSha256','sourceFingerprint','inputFingerprint','source','members'])
  ||typeof value.ownerId!=='string'||!ID.test(value.ownerId)||typeof value.productId!=='string'||!ID.test(value.productId)
  ||!own(value.company,['code','name'])||!supplierHubCompany(value.company.code,value.company.name)||!same(value.company,supplierHubCompany(value.company.code,value.company.name))
  ||typeof value.categoryId!=='string'||!/^[1-9]\d{0,19}$/.test(value.categoryId)||!dense(value.categoryPath,20)||!value.categoryPath.length||value.categoryPath.some(segment=>!text(segment,500))
  ||!['schemaSha256','sourceFingerprint','inputFingerprint'].every(key=>typeof value[key]==='string'&&HASH.test(value[key] as string)))return false;
 const source=value.source;
 if(!own(source,['productVersion','contentRevision','optionRevision','quotationRevision','profileId','profileRevision'])||!text(source.productVersion,64)||!Number.isFinite(Date.parse(source.productVersion))
  ||!['contentRevision','optionRevision','quotationRevision'].every(key=>revision(source[key])))return false;
 // An implicit captured-category ID has no stored profile revision. Keep that
 // null: sourceFingerprint binds its exact captured payload without inventing
 // a profile clock. A missing ID likewise cannot have a profile revision.
 if(source.profileId===null?source.profileRevision!==null:typeof source.profileId!=='string'||!ID.test(source.profileId)||source.profileRevision!==null&&!revision(source.profileRevision))return false;
 return dense(value.members,200)&&value.members.length>0&&value.members.every((member,index)=>own(member,['optionId','optionLabel','documentIndex'])
  &&typeof member.optionId==='string'&&ID.test(member.optionId)&&text(member.optionLabel,2000)&&member.documentIndex===index)
  &&new Set(value.members.map(member=>(member as {optionId:string}).optionId)).size===value.members.length;
}
function safeFilename(value:string){return text(value,180)&&/\.pdf$/i.test(value)&&!/[\\/<>:"|?*\u202a-\u202e\u2066-\u2069]/.test(value)&&!/[. ]$/.test(value)&&value!=='.'&&value!=='..';}

/** Pure server preparation. The caller supplies freshly compiled context and
 * exact saved-source identity. A metadata digest is not byte verification,
 * an upload capability, a native document ID, or a registration receipt. */
export async function buildNativeLegalAttachmentPlan(input:{context:NativeLegalContext;identity:unknown;applicability:'required'|'not-applicable'|'unconfirmed'}):Promise<NativeLegalAttachmentPlan>{
 const plan:NativeLegalAttachmentPlan={format:NATIVE_LEGAL_ATTACHMENT_PLAN_FORMAT,identity:null,identityDigest:null,applicability:'unconfirmed',targets:[],files:[],groups:[],issues:[],metadataValid:false,
  planSha256:null,registered:false,remoteWrites:false,submissionReady:false,transportReady:false,bytesVerified:false};
 const add=(code:string,message:string,key?:string)=>plan.issues.push({code,message,...(key?{key}:{})});
 try{
  // Snapshot inert JSON before using any values. All returned records are
  // detached, so a transport alias never renames a saved original.
  const raw=JSON.parse(nativeLegalAttachmentCanonical(input)) as typeof input;
  if(!own(raw,['context','identity','applicability'])||!identityValid(raw.identity))throw Error('현재 서류 준비의 회원·회사·상품·저장 버전을 확인해주세요.');
  const identity=raw.identity;plan.identity=identity;
  if(!['required','not-applicable','unconfirmed'].includes(raw.applicability))throw Error('원본 서류의 실제 해당 여부를 확인해주세요.');
  plan.applicability=raw.applicability;
  const context=raw.context;
  if(!own(context,['schemaSha256','categoryId','company','targets','issues','files','registered','remoteWrites','submissionReady'])||context.registered!==false||context.remoteWrites!==false||context.submissionReady!==false
   ||context.schemaSha256!==identity.schemaSha256||context.categoryId!==identity.categoryId||!same(context.company,identity.company)
   ||!dense(context.targets,405)||!dense(context.issues,500)||!dense(context.files,10))throw Error('현재 검증된 카테고리·서류 연결 문맥이 필요합니다.');
  if(raw.applicability==='unconfirmed')add('NATIVE_LEGAL_APPLICABILITY_UNCONFIRMED','실제 상품의 서류 해당 여부를 직접 확인해주세요.');
  if(context.issues.length)add('NATIVE_LEGAL_CONTEXT_ISSUES','현재 원본 서류의 누락·미연결·저장값 문제를 먼저 해결해주세요.');
  if(plan.issues.length)return plan;
  if(raw.applicability==='required'&&!context.files.length){add('NATIVE_LEGAL_FILE_MISSING','제출할 PDF 원본이 없습니다.');return plan;}
  if(raw.applicability==='not-applicable'&&context.files.length){add('NATIVE_LEGAL_APPLICABILITY_CONFLICT','서류 해당없음과 첨부 원본이 함께 있어 제출 계획을 만들지 않았습니다.');return plan;}
  const originals=readLegalDocuments({applicability:raw.applicability,files:context.files},identity.ownerId,identity.productId).files;
  const targets=context.targets.map(target=>{
   if(!own(target,['id','label','binding'])||!text(target.id,200)||!text(target.label,2000))throw Error('서버가 확인한 서류 제출 항목이 필요합니다.');
   const binding=readNativeLegalBinding(target.binding);
   if(binding.categoryId!==identity.categoryId||binding.schemaSha256!==identity.schemaSha256||target.id!==(binding.nativeType==='certificate'?'certificate:'+binding.certificate!.fieldId:'bucket:'+binding.nativeType))throw Error('서류 제출 항목의 현재 양식·행 연결이 다릅니다.');
   return {id:target.id,binding};
  });
  if(new Set(targets.map(target=>target.id)).size!==targets.length||new Set(targets.map(target=>nativeLegalAttachmentCanonical(target.binding))).size!==targets.length)throw Error('현재 서류 제출 항목이 중복되어 있습니다.');
  const files:NativeLegalAttachmentFile[]=[],used=new Set<string>(),usedTargets=new Set<string>();let total=0;
  for(const file of originals){
   if(file.type!=='pdf'||!safeFilename(file.name)||file.byteLength>LEGAL_DOCUMENT_LIMIT||!file.nativeBinding){add('NATIVE_LEGAL_ORIGINAL_UNCONFIRMED','현재 항목에 명시 연결한 안전한 PDF 원본만 준비할 수 있습니다.',file.key);continue;}
   const binding=readNativeLegalBinding(file.nativeBinding),matches=targets.filter(target=>same(target.binding,binding));
   if(matches.length!==1){add('NATIVE_LEGAL_STALE_BINDING','원본 서류의 양식·인증 행·저장값 연결이 현재 제출 항목과 다릅니다.',file.key);continue;}
   // The native widget checks filename.includes('cert{row}-'), not startsWith.
   // An original containing any reserved row marker could match a second row
   // after prefixing. Reject it rather than rename the saved original.
   if(binding.nativeType==='certificate'&&/cert\d+-/i.test(file.name)){add('NATIVE_LEGAL_RESERVED_CERTIFICATE_NAME','인증서 원본명에 예약된 cert숫자- 형식이 있어 인증 행을 구분할 수 없습니다. 원본 파일명을 확인해 다시 첨부해주세요.',file.key);continue;}
   // SR source [4044583,4045319), SHA 6fc9c0fa…abe11, uses
   // `cert{schema row index}-`; no option/member/upload index is involved.
   const target=matches[0],transportName=binding.nativeType==='certificate'?`cert${binding.certificate!.schemaIndex}-${file.name}`:file.name;
   // Avoid ambiguous multipart names even on receivers that normalize Unicode
   // or filename case. Original display/storage names remain untouched.
   const collision=binding.nativeType+':'+transportName.normalize('NFC').toLocaleLowerCase('en-US');
   if(used.has(collision)){add('NATIVE_LEGAL_TRANSPORT_NAME_COLLISION','같은 서류 영역의 전송 파일명이 중복됩니다.',file.key);continue;}
   if(usedTargets.has(target.id)){add('NATIVE_LEGAL_DUPLICATE_TARGET','공유 제출 항목에 연결할 원본 한 개를 명시적으로 선택해주세요.',file.key);continue;}
   used.add(collision);usedTargets.add(target.id);total+=file.byteLength;
   files.push({key:file.key,originalName:file.name,transportName,type:'pdf',contentType:'application/pdf',byteLength:file.byteLength,sha256:file.sha256,nativeType:binding.nativeType,binding,targetId:target.id,
    downloadPath:`/api/products/${encodeURIComponent(identity.productId)}/legal-documents?key=${encodeURIComponent(file.key)}`});
  }
  if(total>LEGAL_DOCUMENT_TOTAL_LIMIT)add('NATIVE_LEGAL_TOTAL_LIMIT','원본 PDF 합계는 8MB 이하여야 합니다.');
  if(plan.issues.length)return plan;
  plan.targets=targets;plan.files=files;plan.groups=NATIVE_LEGAL_BUCKET_ORDER.filter(nativeType=>files.some(file=>file.nativeType===nativeType)).map(nativeType=>({nativeType,fileKeys:files.filter(file=>file.nativeType===nativeType).map(file=>file.key)}));
  plan.metadataValid=true;plan.identityDigest=await digest(plan.identity);
  const {planSha256:omitted,...manifest}=plan;void omitted;plan.planSha256=await digest(manifest);return plan;
 }catch(error){
  plan.targets=[];plan.files=[];plan.groups=[];plan.metadataValid=false;plan.identityDigest=null;plan.planSha256=null;
  add('NATIVE_LEGAL_PLAN_INVALID',error instanceof Error?error.message:'현재 원본 서류의 제출 메타데이터를 확인해주세요.');return plan;
 }
}
