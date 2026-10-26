import {validateNativeLegalBytePlan} from './native-legal-bytes.mjs';

export const NATIVE_ASSET_UPLOAD_PLAN_FORMAT='yoofam-native-asset-upload-plan-v1';
export const NATIVE_ASSET_MULTIPART_FORMAT='yoofam-native-asset-multipart-preparation-v1';
const HASH=/^[a-f0-9]{64}$/,ID=/^\w[\w-]{0,99}$/,TYPES=['MAIN','ADDITIONAL','SIZECHART','LABEL','DETAIL'];
const COMPANY={A01526306:'유앤채',A01464742:'와이홉'},FILE_LIMIT=10*1024*1024,TOTAL_LIMIT=64*1024*1024;
const BARE={MAIN:['imagePage','images','mainImage'],ADDITIONAL:['imagePage','images','additionalImage'],SIZECHART:['imagePage','images','sizeChartImage'],DETAIL:['imagePage','details','detailedImage']};
const LEGAL_TYPES=['import_type','certificate','additional','categoryCert','adCert','msds'];
const FORBIDDEN=new Set(['__proto__','prototype','constructor','authorization','cookie','setcookie','password','accesstoken','refreshtoken','clientsecret','apikey','secret','privatekey','credentials','sessiontoken']);
export class NativeAssetMultipartError extends Error{constructor(code,message='현재 새 문서의 원본 파일·회사·저장값 연결을 다시 확인해주세요.'){super(message);this.name='NativeAssetMultipartError';this.code=code;}}
const fail=(code,message)=>{throw new NativeAssetMultipartError(code,message);};
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys,optional=[])=>object(value)&&keys.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>keys.includes(key)||optional.includes(key));
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&value===value.trim()&&!/[\u0000-\u001f\u007f]/u.test(value);
const revision=value=>Number.isSafeInteger(value)&&value>=0;
const nativePrototype=(prototype,name)=>{const c=Object.getOwnPropertyDescriptor(prototype,'constructor')?.value;return typeof c==='function'&&c.name===name&&/\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(c));};

/** Inert bounded metadata only: getters/toJSON/custom prototypes never run. */
export function nativeAssetMultipartCanonical(value){
 let count=0;const seen=new Set();
 const visit=(item,depth)=>{
  if(++count>50000||depth>30)fail('JSON_LIMIT');
  if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return JSON.stringify(item);
  if(!item||typeof item!=='object'||seen.has(item))fail('JSON');
  const descriptors=Object.getOwnPropertyDescriptors(item),keys=Reflect.ownKeys(descriptors),prototype=Object.getPrototypeOf(item);
  if(keys.some(key=>typeof key!=='string')||Object.values(descriptors).some(d=>!Object.hasOwn(d,'value')))fail('JSON');
  seen.add(item);let result;
  if(Array.isArray(item)){
   if(!prototype||!nativePrototype(prototype,'Array')||keys.length!==item.length+1||Object.keys(item).length!==item.length||Object.keys(item).some((key,index)=>key!==String(index)))fail('JSON');
   result='['+Array.from({length:item.length},(_,index)=>visit(descriptors[String(index)].value,depth+1)).join(',')+']';
  }else{
   if(prototype!==null&&(Object.getPrototypeOf(prototype)!==null||!nativePrototype(prototype,'Object'))||keys.some(key=>!descriptors[key].enumerable||FORBIDDEN.has(key.replace(/[-_]/g,'').toLowerCase())))fail('JSON');
   result='{'+keys.sort().map(key=>JSON.stringify(key)+':'+visit(descriptors[key].value,depth+1)).join(',')+'}';
  }
  seen.delete(item);return result;
 };
 const result=visit(value,0);if(new TextEncoder().encode(result).byteLength>1024*1024)fail('JSON_LIMIT');return result;
}
const copy=value=>JSON.parse(nativeAssetMultipartCanonical(value));
const same=(a,b)=>nativeAssetMultipartCanonical(a)===nativeAssetMultipartCanonical(b);
const byteDigest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const digest=async value=>byteDigest(new TextEncoder().encode(nativeAssetMultipartCanonical(value)));
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export async function nativeAssetUploadPlanSha256(plan){const clean=copy(plan);delete clean.planSha256;return digest(clean);}
function checkIdentity(identity){
 if(!exact(identity,['ownerId','productId','company','categoryId','categoryPath','schemaSha256','sourceFingerprint','inputFingerprint','source','members'])
  ||typeof identity.ownerId!=='string'||!ID.test(identity.ownerId)||typeof identity.productId!=='string'||!ID.test(identity.productId)||!exact(identity.company,['code','name'])||COMPANY[identity.company.code]!==identity.company.name
  ||!text(identity.categoryId,20)||!/^[1-9]\d*$/.test(identity.categoryId)||!Array.isArray(identity.categoryPath)||!identity.categoryPath.length||identity.categoryPath.length>20||identity.categoryPath.some(s=>!text(s,500))
  ||!['schemaSha256','sourceFingerprint','inputFingerprint'].every(key=>typeof identity[key]==='string'&&HASH.test(identity[key])))fail('IDENTITY');
 const source=identity.source;
 if(!exact(source,['productVersion','contentRevision','optionRevision','quotationRevision','profileId','profileRevision'])||!text(source.productVersion,64)||!Number.isFinite(Date.parse(source.productVersion))
  ||!['contentRevision','optionRevision','quotationRevision'].every(key=>revision(source[key]))
  ||(source.profileId===null?source.profileRevision!==null:typeof source.profileId!=='string'||!ID.test(source.profileId)||source.profileRevision!==null&&!revision(source.profileRevision)))fail('SOURCE');
 if(!Array.isArray(identity.members)||!identity.members.length||identity.members.length>200||identity.members.some((m,index)=>!exact(m,['optionId','optionLabel','documentIndex'])||typeof m.optionId!=='string'||!ID.test(m.optionId)||!text(m.optionLabel,2000)||m.documentIndex!==index)
  ||new Set(identity.members.map(m=>m.optionId)).size!==identity.members.length)fail('MEMBERS');
}
const documentId=value=>Number.isSafeInteger(value)&&value>0||typeof value==='string'&&/^\w[\w-]{0,199}$/.test(value)&&(!/^\d+$/.test(value)||/^[1-9]\d*$/.test(value));
function checkTarget(target){
 if(!exact(target,['docId','requestId','packetDigest','preparedBodySha256','createOperationId','baselineDocIds'])||!documentId(target.docId)||typeof target.requestId!=='string'||!ID.test(target.requestId)
  ||typeof target.packetDigest!=='string'||!HASH.test(target.packetDigest)||typeof target.preparedBodySha256!=='string'||!HASH.test(target.preparedBodySha256)||target.createOperationId!==target.requestId+':create'
  ||!Array.isArray(target.baselineDocIds)||target.baselineDocIds.length>10000||target.baselineDocIds.some(id=>!documentId(id)||String(id)===String(target.docId))
  ||new Set(target.baselineDocIds.map(String)).size!==target.baselineDocIds.length)fail('NEW_DOCUMENT');
}
const filename=(value,max=180)=>text(value,max)&&!/[\\/<>:"|?*%,#\u202a-\u202e\u2066-\u2069]/u.test(value)&&!/[. ]$/.test(value);
function checkWire(wire,type){
 if(type==='LABEL')return exact(wire,['path','nameKey','valueKey','name'])&&same(wire.path,['imagePage','images','labelImages'])&&wire.nameKey==='labelImageType'&&wire.valueKey==='labelImageFiles'&&wire.name==='제품 한글 표시사항 라벨 또는 도안 이미지';
 return exact(wire,['path'])&&same(wire.path,BARE[type]);
}
function checkImage(file,identity){
 if(!exact(file,['key','originalName','transportName','imageType','contentType','byteLength','sha256','references'])||!TYPES.includes(file.imageType)||!text(file.key,512)||!file.key.startsWith(identity.ownerId+'/')
  ||!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(file.key.slice(identity.ownerId.length+1))||!filename(file.originalName,512)||!filename(file.transportName)||typeof file.sha256!=='string'||!HASH.test(file.sha256)
  ||!['image/png','image/jpeg'].includes(file.contentType)||![file.originalName,file.transportName].every(name=>(file.contentType==='image/png'?/\.png$/i:/\.jpe?g$/i).test(name))
  ||!Number.isSafeInteger(file.byteLength)||file.byteLength<24||file.byteLength>FILE_LIMIT||!Array.isArray(file.references)||!file.references.length||file.references.length>200)fail('IMAGE');
 for(const ref of file.references){
  if(!exact(ref,['optionId','documentIndex','wire','slotIndex'])||identity.members[ref.documentIndex]?.optionId!==ref.optionId||!Number.isSafeInteger(ref.documentIndex)||ref.documentIndex<0
   ||!Number.isSafeInteger(ref.slotIndex)||ref.slotIndex<0||ref.slotIndex>29||!checkWire(ref.wire,file.imageType)||file.imageType==='MAIN'&&ref.slotIndex!==0)fail('IMAGE_WIRE');
 }
}
function bindings(images){
 const groups=new Map();
 for(const file of images)for(const ref of file.references){const id=ref.optionId+'\0'+nativeAssetMultipartCanonical(ref.wire);let group=groups.get(id);if(!group){group={optionId:ref.optionId,documentIndex:ref.documentIndex,wire:copy(ref.wire),slots:new Map()};groups.set(id,group);}if(group.slots.has(ref.slotIndex))fail('IMAGE_WIRE_DUPLICATE');group.slots.set(ref.slotIndex,file.transportName);}
 return [...groups.values()].map(group=>{const names=[...group.slots].sort(([a],[b])=>a-b);if(names.some(([index],position)=>index!==position))fail('IMAGE_WIRE_GAP');return{optionId:group.optionId,documentIndex:group.documentIndex,wire:group.wire,value:names.map(([,name])=>name).join(',')};});
}
function bytesCopy(value,length){
 try{
  if(value instanceof ArrayBuffer&&Object.getPrototypeOf(value)===ArrayBuffer.prototype){if(value.byteLength!==length)fail('BYTE_LENGTH');return new Uint8Array(value).slice();}
  if(value instanceof Uint8Array){const proto=Object.getPrototypeOf(Uint8Array.prototype),get=name=>Object.getOwnPropertyDescriptor(proto,name).get.call(value),buffer=get('buffer');if(typeof SharedArrayBuffer!=='undefined'&&buffer instanceof SharedArrayBuffer)fail('BYTES');if(get('byteLength')!==length)fail('BYTE_LENGTH');return new Uint8Array(new Uint8Array(buffer,get('byteOffset'),length));}
 }catch(cause){if(cause instanceof NativeAssetMultipartError)throw cause;}
 return fail('BYTES');
}
function imageHeader(bytes,type){
 // Structural header/trailer checks are bounded; no decoder or transcoder runs.
 // The digest proves exact declared private bytes, not successful remote decoding.
 const u32=offset=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(offset);
 if(type==='image/png'){
  if(bytes.length<45||![137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)||u32(8)!==13||new TextDecoder().decode(bytes.subarray(12,16))!=='IHDR'||!u32(16)||!u32(20))return false;
  let index=8,idat=false,count=0;while(index+12<=bytes.length&&count++<10000){const length=u32(index),name=new TextDecoder().decode(bytes.subarray(index+4,index+8));if(length>bytes.length-index-12)return false;if(name==='IDAT')idat=true;if(name==='IEND')return length===0&&index+12===bytes.length&&idat;index+=length+12;}return false;
 }
 if(bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)return false;
 let index=2,dimension=false;while(index+4<bytes.length){if(bytes[index++]!==255)return false;while(bytes[index]===255)index++;const marker=bytes[index++];if(marker===218)return dimension;if(marker===216||marker>=208&&marker<=215)continue;const size=(bytes[index]<<8)|bytes[index+1];if(size<2||index+size>bytes.length)return false;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(size<8||!((bytes[index+3]<<8)|bytes[index+4])||!((bytes[index+5]<<8)|bytes[index+6]))return false;dimension=true;}index+=size;}return false;
}
function optionsField(options,key,required=false){
 if(!object(options))fail('OPTIONS');const descriptors=Object.getOwnPropertyDescriptors(options);if(Object.values(descriptors).some(d=>!Object.hasOwn(d,'value')))fail('OPTIONS');
 const value=descriptors[key]?.value;if(required&&value===undefined)fail('OPTIONS');return value;
}
function legalSnapshot(value){
 const inert=(item,array=false)=>{if(!item||typeof item!=='object')fail('LEGAL_PREPARATION');const descriptors=Object.getOwnPropertyDescriptors(item),keys=Reflect.ownKeys(descriptors),prototype=Object.getPrototypeOf(item);if(keys.some(key=>typeof key!=='string')||Object.values(descriptors).some(d=>!Object.hasOwn(d,'value'))
  ||(array? !Array.isArray(item)||!prototype||!nativePrototype(prototype,'Array')||keys.length!==item.length+1||Object.keys(item).some((key,index)=>key!==String(index)) : Array.isArray(item)||prototype!==null&&(Object.getPrototypeOf(prototype)!==null||!nativePrototype(prototype,'Object'))))fail('LEGAL_PREPARATION');};
 inert(value);
 if(!exact(value,['format','identity','identityDigest','planSha256','groups','bytesVerified','transportReady','registered','remoteWrites','submissionReady'])||value.format!=='yoofam-native-legal-byte-preparation-v1'
  ||value.bytesVerified!==true||['transportReady','registered','remoteWrites','submissionReady'].some(key=>value[key]!==false)||!Array.isArray(value.groups)||value.groups.length>6)fail('LEGAL_PREPARATION');
 inert(value.groups,true);
 return {format:value.format,identity:value.identity,identityDigest:value.identityDigest,planSha256:value.planSha256,groups:value.groups.map(group=>{
  inert(group);
  if(!exact(group,['nativeType','parts'])||!LEGAL_TYPES.includes(group.nativeType)||!Array.isArray(group.parts)||!group.parts.length||group.parts.length>10)fail('LEGAL_PREPARATION');
  inert(group.parts,true);
  return {nativeType:group.nativeType,parts:group.parts.map(part=>{inert(part);if(!exact(part,['name','originalName','transportName','contentType','byteLength','sha256','file'])||part.name!=='uploadFiles'||part.contentType!=='application/pdf')fail('LEGAL_PREPARATION');const {file,...metadata}=Object.getOwnPropertyDescriptors(part);if(!file||!Object.hasOwn(file,'value')||Object.values(metadata).some(d=>!Object.hasOwn(d,'value')))fail('LEGAL_PREPARATION');return Object.fromEntries(Object.entries(metadata).map(([key,d])=>[key,d.value]));})};})};
}

/** Prepare only exact byte-bearing requests. Expected identity/plan/target must
 * come independently from the caller's current trusted app and owned-new-draft
 * checkpoint. This function cannot establish that authority, upload, inspect a
 * browser session, or make the existing dispatch gates ready. Filename bindings
 * are a transport recipe; the saved quotation and legacy URL payload stay intact.
 * SR SHA6fc9c0fa... [2875870,2879318): images use additionalImageFiles;
 * legal buckets use uploadFiles. The browser must choose the multipart boundary. */
export async function prepareNativeAssetMultipart(input,options){
 const original=nativeAssetMultipartCanonical(input),plan=JSON.parse(original),expected=copy(optionsField(options,'expectedIdentity',true)),expectedTarget=copy(optionsField(options,'expectedTarget',true)),expectedSha=optionsField(options,'expectedPlanSha256',true),readImage=optionsField(options,'readImage'),signal=optionsField(options,'signal'),legal=optionsField(options,'legalPreparation');
 checkIdentity(expected);checkTarget(expectedTarget);
 if(!exact(plan,['format','identity','identityDigest','target','images','nativeLegalAttachmentPlan','planSha256','registered','remoteWrites','submissionReady','transportReady'])||plan.format!==NATIVE_ASSET_UPLOAD_PLAN_FORMAT||!same(plan.identity,expected)||!same(plan.target,expectedTarget)
  ||typeof expectedSha!=='string'||!HASH.test(expectedSha)||plan.planSha256!==expectedSha||typeof plan.identityDigest!=='string'||!HASH.test(plan.identityDigest)||['registered','remoteWrites','submissionReady','transportReady'].some(key=>plan[key]!==false)
  ||!Array.isArray(plan.images)||plan.images.length>150||signal!==undefined&&!(signal instanceof AbortSignal)||plan.images.length&&typeof readImage!=='function')fail('PLAN');
 checkIdentity(plan.identity);checkTarget(plan.target);
 let legalBasis=null;const legalFiles=[];
 if(plan.nativeLegalAttachmentPlan!==null){legalBasis=nativeAssetMultipartCanonical(legalSnapshot(legal));for(const group of legal.groups)for(const part of group.parts)legalFiles.push([part,part.file]);}
 else if(legal!==undefined)fail('LEGAL_PREPARATION');
 const stable=()=>{if(signal?.aborted)fail('ABORTED');if(nativeAssetMultipartCanonical(input)!==original||!same(optionsField(options,'expectedIdentity',true),expected)||!same(optionsField(options,'expectedTarget',true),expectedTarget)||optionsField(options,'expectedPlanSha256',true)!==expectedSha||optionsField(options,'readImage')!==readImage||optionsField(options,'legalPreparation')!==legal||optionsField(options,'signal')!==signal
  ||legalBasis!==null&&(nativeAssetMultipartCanonical(legalSnapshot(legal))!==legalBasis||legalFiles.some(([part,file])=>part.file!==file)))fail('SOURCE_CHANGED');};
 stable();if(await digest(plan.identity)!==plan.identityDigest||await nativeAssetUploadPlanSha256(plan)!==expectedSha)fail('DIGEST');stable();
 const aliases=new Set(),uses=new Set();let total=0;
 for(const image of plan.images){checkImage(image,plan.identity);const alias=image.transportName.normalize('NFC').toLocaleLowerCase('en-US');if(aliases.has(alias))fail('IMAGE_NAME_COLLISION');aliases.add(alias);const use=image.key+'\0'+image.imageType;if(uses.has(use))fail('IMAGE_DUPLICATE');uses.add(use);total+=image.byteLength;if(total>TOTAL_LIMIT)fail('BYTE_LIMIT');}
 const filenameBindings=bindings(plan.images),verified=[],legalWork=[],legalGroups=[];
 if(plan.nativeLegalAttachmentPlan!==null){
  const legalPlan=await validateNativeLegalBytePlan(plan.nativeLegalAttachmentPlan,{expectedIdentity:expected,expectedPlanSha256:plan.nativeLegalAttachmentPlan?.planSha256});stable();
  const files=legalPlan.files;
  if(!same(legal.identity,expected)||legal.identityDigest!==plan.identityDigest||legal.planSha256!==legalPlan.planSha256||!same(legal.groups.map(g=>({nativeType:g.nativeType,count:g.parts.length})),legalPlan.groups.map(g=>({nativeType:g.nativeType,count:g.fileKeys.length}))))fail('LEGAL_PREPARATION');
  for(const group of legal.groups){const parts=[];for(let index=0;index<group.parts.length;index++){
   const part=group.parts[index],metadata=files.find(file=>file.key===legalPlan.groups.find(g=>g.nativeType===group.nativeType).fileKeys[index]);
   if(!metadata||part.originalName!==metadata.originalName||part.transportName!==metadata.transportName||part.byteLength!==metadata.byteLength||part.sha256!==metadata.sha256||!(part.file instanceof Blob))fail('LEGAL_PREPARATION');
   parts.push({metadata,file:part.file});
  }legalWork.push({nativeType:group.nativeType,parts});}
 }
 // All metadata and authority checks finish before either private reader runs.
 for(const group of legalWork){const parts=[];for(const {metadata,file}of group.parts){
  const bytes=bytesCopy(await Blob.prototype.arrayBuffer.call(file),metadata.byteLength);stable();
  if(!/^%PDF-\d\.\d/.test(new TextDecoder().decode(bytes.subarray(0,8)))||!/%%EOF[\t\n\r ]*$/.test(new TextDecoder().decode(bytes.subarray(Math.max(0,bytes.length-1024))))||await byteDigest(bytes)!==metadata.sha256)fail('PDF_BYTES');stable();parts.push({metadata,bytes});
 }legalGroups.push({nativeType:group.nativeType,parts});}
 // Bound independent private reads to three. No upload request is constructed
 // until every byte has verified, and a failed batch settles before returning.
 for(let offset=0;offset<plan.images.length;offset+=3){
  const batch=await Promise.allSettled(plan.images.slice(offset,offset+3).map(async image=>{stable();const bytes=bytesCopy(await readImage(freeze(copy(image))),image.byteLength);stable();if(!imageHeader(bytes,image.contentType))fail('IMAGE_HEADER');if(await byteDigest(bytes)!==image.sha256)fail('BYTE_DIGEST');stable();return{metadata:image,bytes};}));
  const rejected=batch.find(value=>value.status==='rejected');if(rejected)throw rejected.reason;
  stable();verified.push(...batch.map(value=>value.value));
 }
 if(!verified.length&&!legalGroups.length)fail('EMPTY');stable();
 const requests=[],doc=encodeURIComponent(String(plan.target.docId)),imageGroups=TYPES.filter(type=>verified.some(file=>file.metadata.imageType===type));
 for(const imageType of imageGroups){const selected=verified.filter(file=>file.metadata.imageType===imageType),body=new FormData();for(const {metadata,bytes}of selected)body.append('additionalImageFiles',new Blob([bytes],{type:metadata.contentType}),metadata.transportName);requests.push(Object.freeze({kind:'image',imageType,method:'POST',path:`/sr/draft/api/upload-images/${doc}?imageType=${imageType}`,body,files:freeze(selected.map(({metadata})=>({transportName:metadata.transportName,contentType:metadata.contentType,byteLength:metadata.byteLength,sha256:metadata.sha256})))}));}
 for(const group of legalGroups){const body=new FormData();for(const {metadata,bytes}of group.parts)body.append('uploadFiles',new Blob([bytes],{type:'application/pdf'}),metadata.transportName);requests.push(Object.freeze({kind:'legal',nativeType:group.nativeType,method:'POST',path:`/sr/draft/api/upload-files-by-type/${doc}?fileType=${group.nativeType}`,body,files:freeze(group.parts.map(({metadata})=>({transportName:metadata.transportName,nativeType:metadata.nativeType,contentType:'application/pdf',byteLength:metadata.byteLength,sha256:metadata.sha256})))}));}
 const reads=[...(verified.length?[{kind:'image',method:'GET',path:`/sr/draft/api/get-images-by-id/${doc}`}]:[]),...legalGroups.map(group=>({kind:'legal',nativeType:group.nativeType,method:'POST',path:`/sr/draft/api/get-files-by-type/${doc}?fileType=${group.nativeType}`,body:{}}))];
 stable();return Object.freeze({format:NATIVE_ASSET_MULTIPART_FORMAT,identity:freeze(expected),identityDigest:plan.identityDigest,target:freeze(expectedTarget),planSha256:expectedSha,requests:Object.freeze(requests),reads:freeze(reads),filenameBindings:freeze(filenameBindings),bytesVerified:true,
  targetVerified:false,actualUploadVerified:false,transportReady:false,registered:false,remoteWrites:false,submissionReady:false});
}

/** Validate the decoded response array consumed by the shipped client, not an
 * invented HTTP envelope. Metadata matching proves neither remote bytes nor a
 * receipt. No descriptor URL is fetched or substituted into quotation fields. */
const descriptorImageUrl=value=>{
 if(!text(value,4096)||value.includes('\\')||!(/^(https:\/\/|\/[^/])/.test(value)))return false;
 try{const url=new URL(value,'https://supplier.coupang.com');return url.protocol==='https:'&&!url.username&&!url.password&&(value.startsWith('https://')||url.origin==='https://supplier.coupang.com');}catch{return false;}
};
export function validateNativeAssetUploadDescriptors(response,{kind,expectedFiles}){
 const rows=copy(response),expected=copy(expectedFiles);if(!['image','legal'].includes(kind)||!Array.isArray(rows)||!rows.length||rows.length>150||!Array.isArray(expected)||rows.length!==expected.length)fail('DESCRIPTORS');
 const nameKey=kind==='image'?'imageName':'fileName',names=new Set();
 for(const file of expected)if(!object(file)||!filename(file.transportName)||names.has(file.transportName))fail('DESCRIPTORS');else names.add(file.transportName);
 const seen=new Set(),descriptors=[];
 for(const row of rows){if(!object(row)||!text(row[nameKey],180)||!names.has(row[nameKey])||seen.has(row[nameKey])||!text(row.s3Link,4096))fail('DESCRIPTORS');seen.add(row[nameKey]);
  if(kind==='legal'){if(!LEGAL_TYPES.includes(row.fileType)||expected.find(file=>file.transportName===row.fileName)?.nativeType!==row.fileType)fail('DESCRIPTORS');descriptors.push({fileName:row.fileName,fileType:row.fileType,s3Link:row.s3Link});}
  else{if(!descriptorImageUrl(row.imageUrl)||row.host!==undefined&&(!text(row.host,253)||!/^([a-z0-9-]+\.)+[a-z0-9-]+$/i.test(row.host))||row.mainImage!==undefined&&typeof row.mainImage!=='boolean')fail('DESCRIPTORS');descriptors.push({imageName:row.imageName,imageUrl:row.imageUrl,s3Link:row.s3Link,...(row.host===undefined?{}:{host:row.host}),...(row.mainImage===undefined?{}:{mainImage:row.mainImage})});}
 }
 return freeze({kind,descriptors,metadataMatched:true,remoteBytesVerified:false,actualUploadVerified:false,registered:false,remoteWrites:false,submissionReady:false});
}
