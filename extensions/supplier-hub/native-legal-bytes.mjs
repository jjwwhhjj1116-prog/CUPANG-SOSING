// Private original preparation only. No browser, network, authentication,
// upload response or registration adapter is available to this module.
export const NATIVE_LEGAL_PLAN_FORMAT='yoofam-native-legal-attachment-plan-v1';
export const NATIVE_LEGAL_BYTES_FORMAT='yoofam-native-legal-byte-preparation-v1';
const TYPES=['import_type','certificate','additional','categoryCert','adCert','msds'];
const HASH=/^[a-f0-9]{64}$/,ID=/^\w[\w-]{0,99}$/,CATEGORY=/^[1-9]\d{0,19}$/;
const COMPANIES={A01526306:'유앤채',A01464742:'와이홉'},FILE_LIMIT=5*1024*1024,TOTAL_LIMIT=8*1024*1024;
const denied=new Set(['proto','prototype','constructor','authorization','cookie','setcookie','password','accesstoken','refreshtoken','clientsecret','apikey','secret','privatekey','credentials','sessiontoken','s3link','base64','dataurl']);
export class NativeLegalBytesError extends Error{constructor(code,message){super(message);this.name='NativeLegalBytesError';this.code=code;}}
const fail=(code='PLAN',message='현재 상품의 원본 PDF 첨부 계획을 다시 확인해주세요.')=>{throw new NativeLegalBytesError(code,message);};
const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
function nativePrototype(value,name){const constructor=Object.getOwnPropertyDescriptor(value,'constructor')?.value;return typeof constructor==='function'&&constructor.name===name&&/\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(constructor));}
/** Inspect descriptors before reading; never execute getters or toJSON. */
function canonical(value){
 let count=0;const seen=new Set();
 const visit=(item,depth)=>{
  if(++count>30000||depth>25)fail('JSON_LIMIT');
  if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return JSON.stringify(item);
  if(!item||typeof item!=='object'||seen.has(item))fail('JSON');
  const keys=Reflect.ownKeys(item),descriptors=Object.getOwnPropertyDescriptors(item),prototype=Object.getPrototypeOf(item);
  if(keys.some(key=>typeof key!=='string')||Object.values(descriptors).some(field=>!Object.hasOwn(field,'value')))fail('JSON');
  seen.add(item);let result;
  if(Array.isArray(item)){
   const parent=prototype&&Object.getPrototypeOf(prototype);
   if(!prototype||!nativePrototype(prototype,'Array')||!parent||Object.getPrototypeOf(parent)!==null||!nativePrototype(parent,'Object')
    ||keys.length!==item.length+1||Object.keys(item).length!==item.length||Object.keys(item).some((key,index)=>key!==String(index)))fail('JSON');
   result='['+Array.from({length:item.length},(_,index)=>visit(descriptors[index].value,depth+1)).join(',')+']';
  }else{
   if(prototype!==null&&(Object.getPrototypeOf(prototype)!==null||!nativePrototype(prototype,'Object'))
    ||keys.some(key=>!descriptors[key].enumerable||denied.has(key.replace(/[-_]/g,'').toLowerCase())))fail('JSON');
   result='{'+keys.sort().map(key=>JSON.stringify(key)+':'+visit(descriptors[key].value,depth+1)).join(',')+'}';
  }
  seen.delete(item);return result;
 };
 const result=visit(value,0);if(new TextEncoder().encode(result).byteLength>1024*1024)fail('JSON_LIMIT');return result;
}
const exact=(value,keys)=>{if(!object(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail();};
const text=(value,max,empty=false)=>typeof value==='string'&&value.length<=max&&(empty||value.trim().length>0)&&!/[\u0000-\u001f\u007f]/u.test(value);
const hash=value=>typeof value==='string'&&HASH.test(value);
const revision=value=>Number.isSafeInteger(value)&&value>=0;
const same=(left,right)=>canonical(left)===canonical(right);
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
const hex=bytes=>Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
const digest=async bytes=>hex(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)));
const jsonDigest=value=>digest(new TextEncoder().encode(canonical(value)));
function optionsValue(options,key,required=false){
 if(!object(options))fail('OPTIONS');const descriptor=Object.getOwnPropertyDescriptor(options,key);
 if(!descriptor){if(required)fail('OPTIONS');return undefined;}if(!Object.hasOwn(descriptor,'value'))fail('OPTIONS');return descriptor.value;
}
function checkIdentity(identity){
 exact(identity,['ownerId','productId','company','categoryId','categoryPath','schemaSha256','sourceFingerprint','inputFingerprint','source','members']);
 if(typeof identity.ownerId!=='string'||!ID.test(identity.ownerId)||typeof identity.productId!=='string'||!ID.test(identity.productId)||typeof identity.categoryId!=='string'||!CATEGORY.test(identity.categoryId)||!['schemaSha256','sourceFingerprint','inputFingerprint'].every(key=>hash(identity[key])))fail('IDENTITY');
 exact(identity.company,['code','name']);if(!Object.hasOwn(COMPANIES,identity.company.code)||COMPANIES[identity.company.code]!==identity.company.name)fail('COMPANY');
 if(!Array.isArray(identity.categoryPath)||identity.categoryPath.length<1||identity.categoryPath.length>20||identity.categoryPath.some(value=>!text(value,500)||value!==value.trim()))fail('CATEGORY');
 const source=identity.source;exact(source,['productVersion','contentRevision','optionRevision','quotationRevision','profileId','profileRevision']);
 if(!text(source.productVersion,64)||source.productVersion!==source.productVersion.trim()||!Number.isFinite(Date.parse(source.productVersion))||!['contentRevision','optionRevision','quotationRevision'].every(key=>revision(source[key]))
  ||!(source.profileId===null||typeof source.profileId==='string'&&ID.test(source.profileId))||!(source.profileRevision===null||revision(source.profileRevision))
  ||source.profileId===null&&source.profileRevision!==null)fail('SOURCE');
 if(!Array.isArray(identity.members)||identity.members.length<1||identity.members.length>200)fail('MEMBERS');
 const members=new Set();for(const [index,member] of identity.members.entries()){
  exact(member,['optionId','optionLabel','documentIndex']);if(typeof member.optionId!=='string'||!ID.test(member.optionId)||members.has(member.optionId)||!text(member.optionLabel,2000)||member.optionLabel!==member.optionLabel.trim()||member.documentIndex!==index)fail('MEMBERS');members.add(member.optionId);
 }
}
function checkBinding(binding,identity){
 const certificate=binding?.nativeType==='certificate';exact(binding,['format','schemaSha256','categoryId','nativeType',...(certificate?['certificate']:[])]);
 if(binding.format!=='supplier-hub-native-legal-binding-v1'||binding.schemaSha256!==identity.schemaSha256||binding.categoryId!==identity.categoryId||!TYPES.includes(binding.nativeType))fail('BINDING');
 if(certificate){const row=binding.certificate;exact(row,['schemaIndex','fieldId','path','nameKey','valueKey','name','value']);
  if(!Number.isSafeInteger(row.schemaIndex)||row.schemaIndex<0||row.schemaIndex>=400||typeof row.fieldId!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(row.fieldId)
   ||!same(row.path,['legalPage','certificates'])||!['nameKey','valueKey'].every(key=>typeof row[key]==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(row[key]))||row.nameKey===row.valueKey
   ||typeof row.name!=='string'||!row.name.trim()||row.name.length>500||/[\u0000-\u001f]/u.test(row.name)||row.name!==row.name.trim()
   ||!(row.value===null||typeof row.value==='boolean'||typeof row.value==='number'&&Number.isFinite(row.value)||typeof row.value==='string'&&row.value.length<=2000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(row.value)))fail('BINDING');
 }
}
function checkPlan(plan){
 exact(plan,['format','identity','identityDigest','applicability','targets','files','groups','issues','metadataValid','planSha256','registered','remoteWrites','submissionReady','transportReady','bytesVerified']);
 if(plan.format!==NATIVE_LEGAL_PLAN_FORMAT||plan.applicability!=='required'||plan.metadataValid!==true||!hash(plan.identityDigest)||!hash(plan.planSha256)
  ||['registered','remoteWrites','submissionReady','transportReady','bytesVerified'].some(key=>plan[key]!==false)||!Array.isArray(plan.issues)||plan.issues.length)fail();
 checkIdentity(plan.identity);
 if(!Array.isArray(plan.targets)||plan.targets.length<1||plan.targets.length>405||!Array.isArray(plan.files)||plan.files.length<1||plan.files.length>10||!Array.isArray(plan.groups))fail();
 const targetIds=new Set(),certificateIndices=new Set();for(const target of plan.targets){
  exact(target,['id','binding']);checkBinding(target.binding,plan.identity);
  const expected=target.binding.nativeType==='certificate'?'certificate:'+target.binding.certificate.fieldId:'bucket:'+target.binding.nativeType;
  if(target.id!==expected||targetIds.has(target.id)||target.binding.nativeType==='certificate'&&certificateIndices.has(target.binding.certificate.schemaIndex))fail('TARGET');
  if(target.binding.nativeType==='certificate')certificateIndices.add(target.binding.certificate.schemaIndex);targetIds.add(target.id);
 }
 const keys=new Set(),aliases=new Set(),usedTargets=new Set();let total=0;
 for(const file of plan.files){
  exact(file,['key','originalName','transportName','type','contentType','byteLength','sha256','nativeType','binding','downloadPath','targetId']);checkBinding(file.binding,plan.identity);
  const prefix=plan.identity.ownerId+'/legal/'+plan.identity.productId+'/';
  if(typeof file.key!=='string'||!file.key.startsWith(prefix)||!/^legal-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.pdf$/.test(file.key.slice(prefix.length))||keys.has(file.key))fail('KEY');
  if(!text(file.originalName,180)||file.originalName!==file.originalName.trim()||/[<>:"|?*\\/\u202a-\u202e\u2066-\u2069]/u.test(file.originalName)||!/\.pdf$/i.test(file.originalName)||file.type!=='pdf'||file.contentType!=='application/pdf'
   ||!Number.isSafeInteger(file.byteLength)||file.byteLength<12||file.byteLength>FILE_LIMIT||!hash(file.sha256)||file.nativeType!==file.binding.nativeType)fail('FILE');
  if(file.nativeType==='certificate'&&/cert\d+-/i.test(file.originalName))fail('ALIAS','인증서 원본 파일명에 다른 인증 행으로 오인할 수 있는 예약 접두사가 있습니다.');
  const alias=file.nativeType==='certificate'?`cert${file.binding.certificate.schemaIndex}-${file.originalName}`:file.originalName;
  const aliasKey=file.nativeType+'\0'+alias.normalize('NFC').toLocaleLowerCase('en-US');
  if(file.transportName!==alias||aliases.has(aliasKey))fail('ALIAS');
  const target=plan.targets.find(target=>target.id===file.targetId);
  if(!target||usedTargets.has(file.targetId)||!same(target.binding,file.binding))fail('TARGET');
  if(file.downloadPath!==`/api/products/${encodeURIComponent(plan.identity.productId)}/legal-documents?key=${encodeURIComponent(file.key)}`)fail('PATH');
  total+=file.byteLength;if(total>TOTAL_LIMIT)fail('BYTE_LIMIT');keys.add(file.key);aliases.add(aliasKey);usedTargets.add(file.targetId);
 }
 const groups=TYPES.map(nativeType=>({nativeType,fileKeys:plan.files.filter(file=>file.nativeType===nativeType).map(file=>file.key)})).filter(group=>group.fileKeys.length);
 if(!same(plan.groups,groups))fail('GROUPS');
}

/** expectedIdentity must come from the caller's current authenticated source,
 * not from accepting a manifest's self-declared owner/company as authority. */
export async function validateNativeLegalBytePlan(input,options){
 const expectedIdentity=optionsValue(options,'expectedIdentity',true),expectedPlanSha256=optionsValue(options,'expectedPlanSha256',true),original=canonical(input),expected=canonical(expectedIdentity),plan=JSON.parse(original);
 checkPlan(plan);checkIdentity(JSON.parse(expected));if(canonical(plan.identity)!==expected)fail('IDENTITY');if(!hash(expectedPlanSha256)||plan.planSha256!==expectedPlanSha256)fail('PLAN_DIGEST');
 const stable=()=>{if(canonical(input)!==original||canonical(optionsValue(options,'expectedIdentity',true))!==expected||optionsValue(options,'expectedPlanSha256',true)!==expectedPlanSha256)fail('SOURCE_CHANGED','원본 서류를 확인하는 동안 상품·회사·첨부 계획이 변경되었습니다.');};
 if(await jsonDigest(plan.identity)!==plan.identityDigest)fail('IDENTITY_DIGEST');stable();
 const {planSha256,...body}=plan;if(await jsonDigest(body)!==planSha256)fail('PLAN_DIGEST');stable();
 return freeze(plan);
}
function originalBytes(value,expectedLength){
 try{
  if(value instanceof ArrayBuffer){
   if(Object.getPrototypeOf(value)!==ArrayBuffer.prototype)fail('BYTES');
   if(Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get.call(value)!==expectedLength)fail('BYTE_LENGTH','저장한 PDF 원본의 크기가 첨부 계획과 다릅니다.');
   return new Uint8Array(value).slice();
  }
  if(value instanceof Uint8Array){
   const prototype=Object.getPrototypeOf(Uint8Array.prototype),read=name=>Object.getOwnPropertyDescriptor(prototype,name).get.call(value),buffer=read('buffer');
   if(typeof SharedArrayBuffer!=='undefined'&&buffer instanceof SharedArrayBuffer)fail('BYTES');
   const byteLength=read('byteLength');if(byteLength!==expectedLength)fail('BYTE_LENGTH','저장한 PDF 원본의 크기가 첨부 계획과 다릅니다.');
   return new Uint8Array(new Uint8Array(buffer,read('byteOffset'),byteLength));
  }
 }catch(cause){if(cause instanceof NativeLegalBytesError)throw cause;}
 return fail('BYTES','PDF 원본의 실제 파일 내용을 확인하지 못했습니다.');
}
function pdf(bytes){
 const start=new TextDecoder().decode(bytes.subarray(0,8)),end=new TextDecoder().decode(bytes.subarray(Math.max(0,bytes.length-1024)));
 return /^%PDF-\d\.\d/u.test(start)&&/%%EOF[\t\n\r ]*$/u.test(end);
}
/** Reads only exact private originals through the supplied reader. All bytes
 * are copied, checked and retained locally before any file part is returned. */
export async function prepareNativeLegalBytes(input,options){
 const readOriginal=optionsValue(options,'readOriginal',true),signal=optionsValue(options,'signal');if(typeof readOriginal!=='function'||signal!==undefined&&!(signal instanceof AbortSignal))fail('OPTIONS');
 // Capture authority before the validator's first await as well: a changed
 // caller source must not become a fresh baseline between async functions.
 const original=canonical(input),expected=canonical(optionsValue(options,'expectedIdentity',true)),expectedPlanSha256=optionsValue(options,'expectedPlanSha256',true);
 const plan=await validateNativeLegalBytePlan(input,options);
 const stable=()=>{if(signal?.aborted)fail('ABORTED','원본 서류 준비를 중단했습니다.');if(canonical(input)!==original||canonical(optionsValue(options,'expectedIdentity',true))!==expected||optionsValue(options,'expectedPlanSha256',true)!==expectedPlanSha256||optionsValue(options,'readOriginal',true)!==readOriginal)fail('SOURCE_CHANGED','원본 서류를 확인하는 동안 상품·회사·첨부 계획이 변경되었습니다.');};
 const verified=new Map();stable();if(canonical(plan.identity)!==expected||plan.planSha256!==expectedPlanSha256)fail('SOURCE_CHANGED');
 for(const file of plan.files){
  stable();const bytes=originalBytes(await readOriginal(file),file.byteLength);stable();
  if(!pdf(bytes))fail('PDF','저장한 파일이 완전한 PDF 원본인지 확인해주세요.');
  if(await digest(bytes)!==file.sha256)fail('BYTE_DIGEST','저장한 PDF 원본 내용이 첨부 계획과 다릅니다.');stable();verified.set(file.key,bytes);
 }
 stable();const groups=plan.groups.map(group=>({nativeType:group.nativeType,parts:group.fileKeys.map(key=>{
  const metadata=plan.files.find(file=>file.key===key),bytes=verified.get(key);
  const file=typeof File==='function'?new File([bytes],metadata.transportName,{type:'application/pdf',lastModified:0}):new Blob([bytes],{type:'application/pdf'});
  return Object.freeze({name:'uploadFiles',originalName:metadata.originalName,transportName:metadata.transportName,contentType:'application/pdf',byteLength:metadata.byteLength,sha256:metadata.sha256,file:Object.freeze(file)});
 })}));
 stable();groups.forEach(group=>{Object.freeze(group.parts);Object.freeze(group);});Object.freeze(groups);
 return Object.freeze({format:NATIVE_LEGAL_BYTES_FORMAT,identity:plan.identity,identityDigest:plan.identityDigest,planSha256:plan.planSha256,groups,
  bytesVerified:true,transportReady:false,registered:false,remoteWrites:false,submissionReady:false});
}
