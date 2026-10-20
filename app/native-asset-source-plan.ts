import {imageFileType,isOwnedImageKey,MAX_IMAGE_BYTES,PRODUCT_IMAGE_POOL_LIMIT} from '@/app/image-files';
import {supplierHubCompany} from '@/app/supplier-hub-company';
import type {BundleAsset} from '@/app/exports/review-bundle';
import type {projectSupplierHubSingleDocument} from '@/app/supplier-hub-single-projection';
import type {NativeLegalAttachmentIdentity,NativeLegalAttachmentPlan} from '@/app/native-legal-attachment-plan';
import type {HubWireField} from '@/app/supplier-hub-schema';
import type {SubmissionIssue} from '@/app/submission-review';

export const NATIVE_ASSET_SOURCE_PLAN_FORMAT='yoofam-native-asset-source-plan-v1';
type Projection=Awaited<ReturnType<typeof projectSupplierHubSingleDocument>>;
type Node=Record<string,unknown>;
type ImageType='MAIN'|'ADDITIONAL'|'SIZECHART'|'LABEL'|'DETAIL';
type StorageMetadata={size:number;httpMetadata?:{contentType?:string};customMetadata?:Record<string,string>};
export type NativeAssetSourceIssue={code:string;level:'error'|'review';message:string;optionId?:string|null;fieldId?:string;key?:string};
export type NativeAssetSourceImage={key:string;originalName:string;transportName:string;imageType:ImageType;contentType:'image/png'|'image/jpeg';byteLength:number;sha256:string;
 references:{optionId:string;documentIndex:number;wire:HubWireField;slotIndex:number}[]};
export type NativeAssetSourcePlan={format:typeof NATIVE_ASSET_SOURCE_PLAN_FORMAT;storageNameSemantics:'private-key-leaf';identity:NativeLegalAttachmentIdentity|null;identityDigest:string|null;
 images:NativeAssetSourceImage[];nativeLegalAttachmentPlan:NativeLegalAttachmentPlan|null;body:Projection['payload']|null;originalBodySha256:string|null;preparedBodySha256:string|null;
 sourcePlanSha256:string|null;issues:NativeAssetSourceIssue[];metadataValid:boolean;registered:false;remoteWrites:false;submissionReady:false;transportReady:false;bytesVerified:false};
const HASH=/^[a-f0-9]{64}$/,ID=/^\w[\w-]{0,99}$/;
const forbidden=new Set(['__proto__','prototype','constructor','authorization','cookie','setcookie','password','accesstoken','refreshtoken','clientsecret','apikey','secret','privatekey','credentials','sessiontoken']);
const object=(value:unknown):value is Node=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:unknown,keys:readonly string[]):value is Node=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const revision=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;

/** Bounded inert JSON only. The encoded body is independent of any public URL. */
export function nativeAssetSourceCanonical(value:unknown):string{
 let count=0;const seen=new Set<object>();
 const visit=(item:unknown,depth:number):string=>{
  if(++count>100000||depth>30)throw Error('원본 파일 계획이 처리 범위를 초과했습니다.');
  if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return JSON.stringify(item);
  if(!item||typeof item!=='object'||seen.has(item))throw Error('원본 파일 계획의 JSON 값을 확인해주세요.');
  const descriptors=Object.getOwnPropertyDescriptors(item),keys=Reflect.ownKeys(descriptors);
  if(keys.some(key=>typeof key!=='string')||Object.values(descriptors).some(field=>!Object.hasOwn(field,'value')))throw Error('원본 파일 계획은 저장된 일반 값만 사용할 수 있습니다.');
  seen.add(item);let result:string;
  if(Array.isArray(item)){
   if(keys.length!==item.length+1||Object.keys(item).length!==item.length||Object.keys(item).some((key,index)=>key!==String(index)))throw Error('원본 파일 배열의 순서를 확인해주세요.');
   result='['+Array.from({length:item.length},(_,index)=>visit(descriptors[String(index)].value,depth+1)).join(',')+']';
  }else{
   const prototype=Object.getPrototypeOf(item);
   if(prototype!==null&&Object.getPrototypeOf(prototype)!==null||keys.some(key=>typeof key==='string'&&(!descriptors[key].enumerable||forbidden.has(key.replace(/[-_]/g,'').toLowerCase()))))throw Error('원본 파일 계획의 객체 항목을 확인해주세요.');
   result='{'+(keys as string[]).sort().map(key=>JSON.stringify(key)+':'+visit(descriptors[key].value,depth+1)).join(',')+'}';
  }
  seen.delete(item);return result;
 };
 const result=visit(value,0);if(new TextEncoder().encode(result).length>6*1024*1024)throw Error('원본 파일 계획은 6MB 이하여야 합니다.');return result;
}
const copy=<T,>(value:T):T=>JSON.parse(nativeAssetSourceCanonical(value)) as T;
const same=(left:unknown,right:unknown)=>nativeAssetSourceCanonical(left)===nativeAssetSourceCanonical(right);
const sha=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))),byte=>byte.toString(16).padStart(2,'0')).join('');
const digest=(value:unknown)=>sha(new TextEncoder().encode(nativeAssetSourceCanonical(value)));
export async function nativeAssetSourcePlanSha256(plan:NativeAssetSourcePlan){const {sourcePlanSha256:omitted,...value}=plan;void omitted;return digest(value);}
function identityValid(value:unknown):value is NativeLegalAttachmentIdentity{
 if(!exact(value,['ownerId','productId','company','categoryId','categoryPath','schemaSha256','sourceFingerprint','inputFingerprint','source','members'])||!text(value.ownerId,100)||!ID.test(value.ownerId)||!text(value.productId,100)||!ID.test(value.productId)
  ||!exact(value.company,['code','name'])||!same(supplierHubCompany(value.company.code,value.company.name),value.company)||!text(value.categoryId,20)||!/^[1-9]\d*$/.test(value.categoryId)
  ||!Array.isArray(value.categoryPath)||!value.categoryPath.length||value.categoryPath.length>20||value.categoryPath.some(part=>!text(part,500))
  ||!['schemaSha256','sourceFingerprint','inputFingerprint'].every(key=>typeof value[key]==='string'&&HASH.test(value[key] as string)))return false;
 const source=value.source;
 if(!exact(source,['productVersion','contentRevision','optionRevision','quotationRevision','profileId','profileRevision'])||!text(source.productVersion,64)||!Number.isFinite(Date.parse(source.productVersion))||!['contentRevision','optionRevision','quotationRevision'].every(key=>revision(source[key]))
  ||(source.profileId===null?source.profileRevision!==null:!text(source.profileId,100)||!ID.test(source.profileId)||source.profileRevision!==null&&!revision(source.profileRevision)))return false;
 return Array.isArray(value.members)&&value.members.length>0&&value.members.length<=200&&value.members.every((row,index)=>exact(row,['optionId','optionLabel','documentIndex'])&&text(row.optionId,100)&&ID.test(row.optionId)&&text(row.optionLabel,2000)&&row.documentIndex===index)
  &&new Set(value.members.map(row=>(row as {optionId:string}).optionId)).size===value.members.length;
}
function imageType(wire:HubWireField|undefined):ImageType|null{
 if(!wire)return null;
 const bare=exact(wire,['path']);
 if(bare&&same(wire.path,['imagePage','images','mainImage']))return 'MAIN';
 if(bare&&same(wire.path,['imagePage','images','additionalImage']))return 'ADDITIONAL';
 if(bare&&same(wire.path,['imagePage','images','sizeChartImage']))return 'SIZECHART';
 if(bare&&same(wire.path,['imagePage','details','detailedImage']))return 'DETAIL';
 if(exact(wire,['path','nameKey','valueKey','name'])&&same(wire.path,['imagePage','images','labelImages'])&&wire.nameKey==='labelImageType'&&wire.valueKey==='labelImageFiles'&&wire.name==='제품 한글 표시사항 라벨 또는 도안 이미지')return 'LABEL';
 return null;
}
/** Safe read selection only. Invalid/unknown references are not read and still
 * become blocking issues in buildNativeAssetSourcePlan. Legacy public URL
 * selection can retain its original single size/label behavior independently. */
export function nativeAssetSourceImageKeys(input:{projection:Projection;owner:string;ownedKeys:readonly string[]}):string[]{
 try{
  const projection=copy(input.projection),owned=[...input.ownedKeys],members=projection.review.fields.filter(field=>same(field.path,['startPage','productName'])&&field.name===undefined).map(field=>field.optionId);
  if(!ID.test(input.owner)||owned.length>PRODUCT_IMAGE_POOL_LIMIT||new Set(owned).size!==owned.length||owned.some(key=>!isOwnedImageKey(input.owner,key))||new Set(members).size!==members.length)return [];
  const keys=new Set<string>();
  for(const reference of projection.review.unresolvedImages){const type=imageType(reference.wire);
   if(!type||!members.includes(reference.optionId)||!reference.keys.length||reference.keys.length>30||type==='MAIN'&&reference.keys.length!==1||new Set(reference.keys).size!==reference.keys.length
    ||reference.savedValue!==reference.keys.join('\n')||reference.keys.some(key=>!isOwnedImageKey(input.owner,key)||!owned.includes(key)))continue;
   reference.keys.forEach(key=>keys.add(key));
  }
  return [...keys];
 }catch{return [];}
}
function assign(document:Node,wire:HubWireField,value:string){
 let node:unknown=document;
 for(const key of wire.path.slice(0,wire.name===undefined?-1:undefined)){
  if(!object(node)||!Object.hasOwn(node,key))throw Error('원본 이미지의 현재 문서 경로가 없습니다.');node=node[key];
 }
 if(wire.name!==undefined){
  if(!Array.isArray(node)||!wire.nameKey||!wire.valueKey)throw Error('이미지 이름 배열을 확인해주세요.');
  const targets=node.filter((row):row is Node=>object(row)&&row[wire.nameKey!]===wire.name);if(targets.length!==1)throw Error('이미지 이름 배열의 정확한 항목을 확인해주세요.');targets[0][wire.valueKey]=value;
 }else{if(!object(node))throw Error('이미지 저장 항목을 확인해주세요.');node[wire.path.at(-1)!]=value;}
}
const filename=(value:string)=>text(value,180)&&!/[\\/<>:"|?*%,#\u202a-\u202e\u2066-\u2069]/.test(value)&&!/[. ]$/.test(value);

/** Actual owned private bytes -> filename-native body sidecar. No public image
 * secret, publication, native target ID, remote write or agreement is created.
 * SR SHA6fc9c0fa... uses File.name on these exact wires, and comma joins the
 * additional/size/label/detail names. This plan does not replace legacy payload. */
export async function buildNativeAssetSourcePlan(input:{identity:unknown;projection:Projection;ownedKeys:readonly string[];assets:readonly BundleAsset[];
 metadata:ReadonlyMap<string,StorageMetadata|null>;nativeLegalAttachmentPlan:NativeLegalAttachmentPlan;sourceIssues?:readonly SubmissionIssue[]}):Promise<NativeAssetSourcePlan>{
 const plan:NativeAssetSourcePlan={format:NATIVE_ASSET_SOURCE_PLAN_FORMAT,storageNameSemantics:'private-key-leaf',identity:null,identityDigest:null,images:[],nativeLegalAttachmentPlan:null,body:null,
  originalBodySha256:null,preparedBodySha256:null,sourcePlanSha256:null,issues:[],metadataValid:false,registered:false,remoteWrites:false,submissionReady:false,transportReady:false,bytesVerified:false};
 const add=(code:string,message:string,key?:string)=>plan.issues.push({code,level:'error',message,...(key?{key}:{})});
 try{
  const identity=copy(input.identity),projection=copy(input.projection),legal=copy(input.nativeLegalAttachmentPlan),owned=[...input.ownedKeys];
  if(!identityValid(identity))throw Error('현재 회사·상품·포함 옵션과 저장 원천을 확인해주세요.');plan.identity=identity;
  if(projection.format!=='yoofam-supplier-hub-single-document-preview-v1'||!same(projection.company,identity.company)||projection.schemaSha256!==identity.schemaSha256||projection.payload.docId!==null||projection.payload.scope!=='Retail_Categorized_Single'
   ||projection.payload.displayCategoryCode!==identity.categoryId||projection.payload.jsonDocument.length!==identity.members.length||projection.registered!==false||projection.remoteWrites!==false||projection.submissionReady!==false)throw Error('현재 원문 양식·회사·포함 문서의 연결을 확인해주세요.');
  const rows=projection.review.fields.filter(field=>same(field.path,['startPage','productName'])&&field.name===undefined);
  if(rows.length!==identity.members.length||rows.some((row,index)=>row.optionId!==identity.members[index].optionId)||new Set(rows.map(row=>row.optionId)).size!==rows.length)throw Error('원문 문서와 포함 옵션 순서가 다릅니다.');
  if(owned.length>PRODUCT_IMAGE_POOL_LIMIT||new Set(owned).size!==owned.length||owned.some(key=>!isOwnedImageKey(identity.ownerId,key)))throw Error('현재 상품 소유 이미지 목록을 확인해주세요.');
  if(input.assets.length>PRODUCT_IMAGE_POOL_LIMIT||new Set(input.assets.map(asset=>asset.key)).size!==input.assets.length)throw Error('이미지 원본 읽기 목록이 중복되어 있습니다.');
  if(!same(legal.identity,identity)||legal.registered!==false||legal.remoteWrites!==false||legal.submissionReady!==false||legal.transportReady!==false||legal.bytesVerified!==false||!legal.metadataValid||legal.issues.length||!legal.planSha256){
   add('NATIVE_ASSET_LEGAL_UNCONFIRMED','현재 서류 해당 여부·원본·카테고리 연결을 먼저 확인해주세요.');
  }else{
   const {planSha256:omitted,...manifest}=legal;void omitted;
   if(await digest(manifest)!==legal.planSha256||await digest(identity)!==legal.identityDigest)throw Error('원본 서류 계획의 저장 원천 해시가 다릅니다.');
   if(legal.applicability==='required'&&legal.files.length)plan.nativeLegalAttachmentPlan=legal;
   else if(legal.applicability!=='not-applicable'||legal.files.length)throw Error('현재 서류 해당 여부와 원본 구성이 다릅니다.');
  }
  const body=copy(projection.payload),byKey=new Map(input.assets.map(asset=>[asset.key,asset])),files=new Map<string,NativeAssetSourceImage>(),byteProofs=new Map<string,{bytes:Uint8Array;sha256:string;contentType:'image/png'|'image/jpeg'}>();
  for(const document of body.jsonDocument){const page=document.imagePage as Node|undefined,details=page?.details as Node|undefined;if(typeof details?.htmlProductDetailContent==='string'&&/<img\b/i.test(details.htmlProductDetailContent))add('NATIVE_ASSET_HTML_IMAGES_UNVERIFIED','HTML 안 이미지의 원본 업로드·참조 계약은 아직 확인되지 않았습니다. 저장 HTML은 변경하지 않았습니다.');}
  const resolved=new Set<string>(),usedWires=new Set<string>(),transportNames=new Set<string>();let total=0;
  for(const reference of projection.review.unresolvedImages){
   const type=imageType(reference.wire),member=identity.members.find(row=>row.optionId===reference.optionId),wire=reference.wire;
   if(!type||!wire||!member){add('NATIVE_ASSET_WIRE_UNCONFIRMED','이미지의 카테고리 항목·포함 옵션 연결을 확인해주세요.');continue;}
   if(!reference.keys.length||reference.keys.length>30||type==='MAIN'&&reference.keys.length!==1||new Set(reference.keys).size!==reference.keys.length||reference.keys.some(key=>!isOwnedImageKey(identity.ownerId,key)||!owned.includes(key))
    ||reference.savedValue!==reference.keys.join('\n')){add('NATIVE_ASSET_KEYS','현재 상품에 연결된 이미지 원본 순서를 확인해주세요.');continue;}
   const wireId=member.optionId+'\0'+nativeAssetSourceCanonical(wire);if(usedWires.has(wireId))throw Error('같은 옵션의 이미지 항목이 중복되어 있습니다.');usedWires.add(wireId);
   const names:string[]=[];
   for(const [slotIndex,key]of reference.keys.entries()){
    let proof=byteProofs.get(key);const asset=byKey.get(key),metadata=input.metadata.get(key);
    if(!proof){
     if(!asset||!metadata||!Number.isSafeInteger(metadata.size)||metadata.size!==asset.data.byteLength||!asset.data.byteLength||asset.data.byteLength>MAX_IMAGE_BYTES)throw Error('선택한 실제 이미지 파일·크기를 확인해주세요.');
     const bytes=new Uint8Array(asset.data),actual=imageFileType(bytes);
     if(actual.contentType!=='image/png'&&actual.contentType!=='image/jpeg'){add('NATIVE_ASSET_IMAGE_FORMAT','네이티브 업로드는 현재 PNG·JPEG 원본만 확인했습니다. 원본 파일을 자동 변환하지 않았습니다.',key);continue;}
     if(metadata.httpMetadata?.contentType!==undefined&&metadata.httpMetadata.contentType!==actual.contentType)throw Error('저장 이미지 형식과 실제 원본 형식이 다릅니다.');
     const sha256=await sha(bytes);
     if(asset.sha256!==sha256||['sha256','labelBlobSha256','freeImageOutputSha256'].some(name=>metadata.customMetadata?.[name]!==undefined&&metadata.customMetadata[name]!==sha256))throw Error('이미지 원본의 저장 해시가 다릅니다.');
     total+=bytes.length;if(total>20*1024*1024)throw Error('원본 이미지 합계는 20MB 이하여야 합니다.');
     proof={bytes,sha256,contentType:actual.contentType};byteProofs.set(key,proof);
    }
    const fileId=type+'\0'+key;let file=files.get(fileId);
    if(!file){
     const originalName=key.slice(identity.ownerId.length+1),extension=proof.contentType==='image/png'?'png':'jpg',keyHash=await digest(key),transportName=`${type.toLowerCase()}-${proof.sha256}-${keyHash.slice(0,16)}.${extension}`;
     if(!filename(originalName)||!filename(transportName)||transportName.length>100||!new RegExp(proof.contentType==='image/png'?'\\.png$':'\\.jpe?g$','i').test(originalName))throw Error('원본의 실제 저장 파일명·형식을 확인해주세요.');
     if(transportNames.has(transportName))throw Error('전송 이미지 파일명이 중복되어 있습니다.');transportNames.add(transportName);
     file={key,originalName,transportName,imageType:type,contentType:proof.contentType,byteLength:proof.bytes.length,sha256:proof.sha256,references:[]};files.set(fileId,file);
     if(files.size>150)throw Error('전송 이미지 파일 계획은 최대 150개입니다.');
    }
    file.references.push({optionId:member.optionId,documentIndex:member.documentIndex,wire:copy(wire),slotIndex});names.push(file.transportName);
   }
   if(names.length!==reference.keys.length)continue;
   assign(body.jsonDocument[member.documentIndex] as Node,wire,names.join(','));resolved.add(member.optionId+'\0'+reference.fieldId);
  }
  const pricePaths:Record<string,string[]>={supplyPrice:['productPage','commonAttributes','purchasePrice'],salePrice:['productPage','commonAttributes','coupangSalePrice'],msrp:['productPage','commonAttributes','msrp']};
  for(const issue of projection.review.issues){
   if(issue.code==='IMAGE_UNRESOLVED'&&resolved.has(issue.optionId+'\0'+issue.fieldId))continue;
   // Preserve the existing exact summary/primary equivalence rule. No price or
   // manual blank is repaired by choosing a native filename transport.
   if(issue.code==='UNBOUND_SAVED_FIELD'&&issue.fieldId&&Object.hasOwn(pricePaths,issue.fieldId)){
    const summary=projection.review.fields.filter(field=>field.optionId===issue.optionId&&field.fieldId===issue.fieldId&&field.path.length===0),primary=projection.review.fields.filter(field=>field.optionId===issue.optionId&&field.name===undefined&&same(field.path,pricePaths[issue.fieldId!]));
    let value:unknown=body.jsonDocument[identity.members.findIndex(row=>row.optionId===issue.optionId)];for(const key of pricePaths[issue.fieldId])value=object(value)?value[key]:undefined;
    if(summary.length===1&&primary.length===1&&primary[0].projected&&typeof value==='string'&&summary[0].savedValue!==''&&summary[0].savedValue===primary[0].savedValue&&value===summary[0].savedValue)continue;
   }
   plan.issues.push({...issue});
  }
  for(const issue of input.sourceIssues??[])plan.issues.push({code:issue.code,level:issue.kind,message:issue.message,optionId:issue.optionId,...(issue.fieldId?{fieldId:issue.fieldId}:{})});
  if(!files.size&&!plan.nativeLegalAttachmentPlan?.files.length)add('NATIVE_ASSET_EMPTY','전송 계획에 포함된 실제 원본 파일이 없습니다.');
  plan.images=[...files.values()];plan.body=body;
  // Match native-asset-multipart's image-part allocation bound, including an
  // original reused under separate role aliases. PDFs keep their independent
  // existing 8MiB legal-plan bound; this is not a claimed Hub server limit.
  if(plan.images.reduce((bytes,file)=>bytes+file.byteLength,0)>64*1024*1024)add('NATIVE_ASSET_TRANSPORT_IMAGE_LIMIT','역할별로 전송할 이미지 파일 합계는 64MB 이하여야 합니다. 같은 원본을 다른 역할에 연결하면 각각 계산합니다.');
  if(plan.issues.some(issue=>issue.level==='error'))return plan;
  const prepared=copy(body);for(const document of prepared.jsonDocument)for(const key of ['msrpAgree','labelContactAgreed']){
   const page=document.imagePage as Node|undefined;if(page&&Object.hasOwn(page,key)){if(typeof page[key]!=='boolean')throw Error('저장 동의 항목의 불리언 형식을 확인해주세요.');page[key]=false;}
  }
  plan.identityDigest=await digest(identity);plan.originalBodySha256=await digest(body);plan.preparedBodySha256=await digest(prepared);plan.metadataValid=true;plan.sourcePlanSha256=await nativeAssetSourcePlanSha256(plan);
  // Byte reads may yield between hashing. Never label changed caller buffers as
  // the immutable byte identity already used to derive these filenames.
  for(const [key,proof]of byteProofs){const asset=byKey.get(key)!;if(asset.data.byteLength!==proof.bytes.length||await sha(new Uint8Array(asset.data))!==proof.sha256)throw Error('준비 중 이미지 원본이 변경되었습니다.');}
  if(!same(input.identity,identity)||!same(input.projection,projection)||!same(input.nativeLegalAttachmentPlan,legal)||!same([...input.ownedKeys],owned))throw Error('준비 중 상품·원문·서류 연결이 변경되었습니다.');
  return plan;
 }catch(error){
  plan.images=[];plan.body=null;plan.nativeLegalAttachmentPlan=null;plan.metadataValid=false;plan.identityDigest=null;plan.originalBodySha256=null;plan.preparedBodySha256=null;plan.sourcePlanSha256=null;
  add('NATIVE_ASSET_SOURCE_INVALID',error instanceof Error?error.message:'현재 원본 파일·상품 원천을 확인해주세요.');return plan;
 }
}
