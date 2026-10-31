import {productDocumentReviewCanonical as canonical,PRODUCT_DOCUMENT_FORMAT,PRODUCT_DOCUMENT_TYPE,type SupplierHubProductDocumentReview} from '@/app/supplier-hub-product-document';
import type {NativeAssetSourcePlan} from '@/app/native-asset-source-plan';
import type {QuotationFieldsView} from '@/app/quotation-schema';
import {supplierHubCompany,type SupplierHubCompany} from '@/app/supplier-hub-company';
import {isOwnedImageKey} from '@/app/image-files';

type Node=Record<string,unknown>;
type Actor={ownerId:string;company:SupplierHubCompany};
type Scope={productId:string;profileId?:string;quotationView:QuotationFieldsView};
type ReadScope=Scope&{signal:AbortSignal;fetcher?:typeof fetch};
const HASH=/^[a-f0-9]{64}$/,ID=/^\w[\w-]{0,99}$/;
const object=(value:unknown):value is Node=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:unknown,keys:readonly string[]):value is Node=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const clone=<T,>(value:T):T=>JSON.parse(canonical(value)) as T;
const digest=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
const mismatchMessage='현재 저장한 상품·카테고리·파일과 전송 자료가 다릅니다. 다시 확인해주세요.';
const fail=(message=mismatchMessage):never=>{throw Error(message);};
// Names come only from the fixed checks below. Never include actual source
// values, private keys, filenames, option labels or remote response contents.
const mismatch=(...fields:string[]):never=>fail(`${mismatchMessage} (확인 항목: ${fields.join(', ')})`);
function checkFields(checks:readonly (readonly [string,boolean])[],message=mismatchMessage):void{
 const fields=[...new Set(checks.filter(([,matches])=>!matches).map(([field])=>field))];
 if(fields.length)fail(`${message} (확인 항목: ${fields.join(', ')})`);
}
function actor(value:unknown):Actor{
 const v=clone(value);if(!exact(v,['ownerId','company'])||typeof v.ownerId!=='string'||!ID.test(v.ownerId)||!exact(v.company,['code','name'])||!same(supplierHubCompany(v.company.code,v.company.name),v.company))return fail('현재 승인 회원 회사를 확인해주세요.');
 return v as Actor;
}
function scoped(value:unknown,scope:Scope,expected:Actor):NativeAssetSourcePlan{
 const plan=clone(value) as NativeAssetSourcePlan,view=clone(scope.quotationView),identity=plan.identity;
 if(!exact(plan,['format','storageNameSemantics','identity','identityDigest','images','nativeLegalAttachmentPlan','body','originalBodySha256','preparedBodySha256','sourcePlanSha256','issues','metadataValid','registered','remoteWrites','submissionReady','transportReady','bytesVerified'])
  ||plan.format!=='yoofam-native-asset-source-plan-v1'||plan.storageNameSemantics!=='private-key-leaf'||typeof plan.metadataValid!=='boolean'||!Array.isArray(plan.issues)||plan.issues.some(issue=>!object(issue)||!['error','review'].includes(issue.level)||typeof issue.message!=='string')
  ||['registered','remoteWrites','submissionReady','transportReady','bytesVerified'].some(key=>plan[key as keyof NativeAssetSourcePlan]!==false))return fail('현재 원본 파일 계획의 형식을 확인해주세요. (확인 항목: sourcePlan.shape)');
 if(!Array.isArray(plan.images)||plan.images.length>150||plan.images.some(file=>!exact(file,['key','originalName','transportName','imageType','contentType','byteLength','sha256','references'])
  ||typeof file.key!=='string'||typeof file.originalName!=='string'||typeof file.transportName!=='string'||!['MAIN','ADDITIONAL','SIZECHART','LABEL','DETAIL'].includes(file.imageType)
  ||!Array.isArray(file.references)||!file.references.length||file.references.length>6000||file.references.some(ref=>!exact(ref,['optionId','documentIndex','wire','slotIndex'])||typeof ref.optionId!=='string'||!Number.isSafeInteger(ref.documentIndex)||!Number.isSafeInteger(ref.slotIndex)||!object(ref.wire)||!Array.isArray(ref.wire.path)))
  ||plan.nativeLegalAttachmentPlan!==null&&(!object(plan.nativeLegalAttachmentPlan)||!Array.isArray(plan.nativeLegalAttachmentPlan.files)))return fail('현재 첨부 파일 목록의 형식을 확인해주세요. (확인 항목: images.shape, nativeLegalAttachmentPlan.shape)');
 if(!identity)return fail(plan.issues.map(issue=>issue.message).join('\n')||undefined);
 if(!exact(identity,['ownerId','productId','company','categoryId','categoryPath','schemaSha256','sourceFingerprint','inputFingerprint','source','members']))return mismatch('identity.shape');
 checkFields([
  ['productId',ID.test(scope.productId)],['profileId',scope.profileId===undefined||ID.test(scope.profileId)],
  ['identity.ownerId',identity.ownerId===expected.ownerId],['identity.productId',identity.productId===scope.productId],['identity.company',same(identity.company,expected.company)],
  ['identity.categoryId',typeof identity.categoryId==='string'&&/^[1-9]\d{0,19}$/.test(identity.categoryId)&&identity.categoryId===view.categoryContext?.categoryId],
  ['identity.categoryPath',same(identity.categoryPath,view.categoryContext.categoryPath)],
  ...(['schemaSha256','sourceFingerprint','inputFingerprint'] as const).map(key=>[`identity.${key}`,typeof identity[key]==='string'&&HASH.test(identity[key])] as const),
  ['identity.inputFingerprint',identity.inputFingerprint===view.inputFingerprint],
 ]);
 if(!exact(identity.source,['productVersion','contentRevision','optionRevision','quotationRevision','profileId','profileRevision']))return mismatch('identity.source.shape');
 checkFields([
  ['identity.source.productVersion',identity.source.productVersion===view.productVersion],['identity.source.contentRevision',identity.source.contentRevision===view.contentRevision],
  ['identity.source.optionRevision',identity.source.optionRevision===view.optionRevision],['identity.source.quotationRevision',identity.source.quotationRevision===view.revision],
  ['identity.source.profileId',identity.source.profileId===view.categoryContext.profileId&&(scope.profileId===undefined||identity.source.profileId===scope.profileId)&&(identity.source.profileId===null||ID.test(identity.source.profileId))],
  ['identity.source.profileRevision',identity.source.profileRevision===null||Number.isSafeInteger(identity.source.profileRevision)&&identity.source.profileRevision>=0],
  ['identity.members',Array.isArray(identity.members)&&identity.members.length>0&&identity.members.length<=200&&same(identity.members,view.resolved.rows.filter(row=>row.included).map((row,documentIndex)=>({optionId:row.optionId,optionLabel:row.optionLabel,documentIndex})))],
 ]);
 return plan;
}
function wireValue(document:unknown,wire:{path:string[];name?:string;nameKey?:string;valueKey?:string}){
 let value=document;for(const key of wire.path){if(!object(value)||!Object.hasOwn(value,key))return mismatch('body.imageWiring.path');value=value[key];}
 if(wire.name!==undefined){if(!Array.isArray(value)||!wire.nameKey||!wire.valueKey)return mismatch('body.imageWiring.name');const matches=value.filter(row=>object(row)&&row[wire.nameKey!]===wire.name);if(matches.length!==1)return mismatch('body.imageWiring.name');return matches[0][wire.valueKey];}
 return value;
}
/** Private filename-body review is a separate source contract. It never marks
 * the legacy public-URL package prepared, creates a target, or uploads a file. */
export async function compileNativeSupplierHubProductDocument(input:Scope&{sourcePlan:NativeAssetSourcePlan;ownerId:string}):Promise<SupplierHubProductDocumentReview>{
 const source=clone(input.sourcePlan);if(!source.identity)return mismatch('identity');
 const view=clone(input.quotationView),expected=actor({ownerId:input.ownerId,company:source.identity.company}),plan=scoped(source,input,expected),identity=plan.identity!;
 if(!ID.test(input.ownerId)||!supplierHubCompany(identity.company.code,identity.company.name)||!plan.metadataValid||plan.issues.some(issue=>issue.level==='error')||!plan.body||!plan.sourcePlanSha256||!HASH.test(plan.sourcePlanSha256)||!HASH.test(plan.identityDigest??'')||!HASH.test(plan.originalBodySha256??'')||!HASH.test(plan.preparedBodySha256??'')){
  checkFields([
  ['ownerId',ID.test(input.ownerId)],['identity.company',!!supplierHubCompany(identity.company.code,identity.company.name)],['metadataValid',plan.metadataValid],
  ['issues',!plan.issues.some(issue=>issue.level==='error')],['body',!!plan.body],['sourcePlanSha256',!!plan.sourcePlanSha256&&HASH.test(plan.sourcePlanSha256)],
  ['identityDigest',HASH.test(plan.identityDigest??'')],['originalBodySha256',HASH.test(plan.originalBodySha256??'')],['preparedBodySha256',HASH.test(plan.preparedBodySha256??'')],
  ],'원본 파일·필수 입력·서류 해당 여부를 먼저 확인해주세요.');
  return fail('원본 파일·필수 입력·서류 해당 여부를 먼저 확인해주세요.');
 }
 const {sourcePlanSha256:ignored,...manifest}=plan;void ignored;
 checkFields([['sourcePlanSha256',await digest(manifest)===plan.sourcePlanSha256],['identityDigest',await digest(identity)===plan.identityDigest]]);
 const body=clone(plan.body),members=clone(identity.members);
 if(body.docId!==null||body.scope!=='Retail_Categorized_Single'||body.displayCategoryCode!==identity.categoryId||!['categoryId','productNoticeNumber','version'].every(key=>typeof body[key as keyof typeof body]==='number'&&Number.isSafeInteger(body[key as keyof typeof body])||typeof body[key as keyof typeof body]==='string'&&/^\d{1,20}$/.test(body[key as keyof typeof body] as string))
  ||/^0+$/.test(String(body.categoryId))||typeof body.categoryPath!=='string'||!body.categoryPath.endsWith(' ('+identity.categoryId+')')||!Array.isArray(body.jsonDocument)||body.jsonDocument.length!==members.length){
  checkFields([
   ['body.docId',body.docId===null],['body.scope',body.scope==='Retail_Categorized_Single'],['body.displayCategoryCode',body.displayCategoryCode===identity.categoryId],
   ...(['categoryId','productNoticeNumber','version'] as const).map(key=>[`body.${key}`,typeof body[key]==='number'&&Number.isSafeInteger(body[key])||typeof body[key]==='string'&&/^\d{1,20}$/.test(body[key])] as const),
   ['body.categoryId',!/^0+$/.test(String(body.categoryId))],['body.categoryPath',typeof body.categoryPath==='string'&&body.categoryPath.endsWith(' ('+identity.categoryId+')')],
   ['body.jsonDocument',Array.isArray(body.jsonDocument)&&body.jsonDocument.length===members.length],
  ]);
 }
 for(const document of body.jsonDocument){if(!object(document)||Object.keys(document).some(key=>!['startPage','productPage','imagePage','legalPage','logisticsPage','sourcingPage'].includes(key))||Object.values(document).some(page=>!object(page))||!object(document.startPage)||typeof document.startPage.productName!=='string'||!document.startPage.productName.trim()||document.startPage.categoryPath!==body.categoryPath)return mismatch('body.jsonDocument.pages');}
 if(body.productName!==(body.jsonDocument[0].startPage as Node).productName)return mismatch('body.productName');
 if(!Array.isArray(plan.images)||plan.images.length>150||!plan.images.length&&!plan.nativeLegalAttachmentPlan?.files.length)return mismatch('images.count');
 const groups=new Map<string,{documentIndex:number;wire:NativeAssetSourcePlan['images'][number]['references'][number]['wire'];files:Map<number,string>}>(),names=new Set<string>();let total=0;
 for(const file of plan.images){
  checkFields([
   ['images.key.owner',isOwnedImageKey(input.ownerId,file.key)],['images.key.selected',view.imageKeys.includes(file.key)],['images.sha256',HASH.test(file.sha256)],
   ['images.imageType',['MAIN','ADDITIONAL','SIZECHART','LABEL','DETAIL'].includes(file.imageType)],['images.contentType',['image/png','image/jpeg'].includes(file.contentType)],
   ['images.byteLength',Number.isSafeInteger(file.byteLength)&&file.byteLength>0&&file.byteLength<=10*1024*1024],
   ['images.transportName',typeof file.transportName==='string'&&/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(file.transportName)&&!names.has(file.transportName)],
   ['images.references',Array.isArray(file.references)&&file.references.length>0],
  ]);
  names.add(file.transportName);total+=file.byteLength;
  for(const ref of file.references){const member=members[ref.documentIndex];checkFields([
   ['images.references.member',!!member&&member.optionId===ref.optionId],['images.references.slotIndex',Number.isSafeInteger(ref.slotIndex)&&ref.slotIndex>=0&&ref.slotIndex<30],['images.references.wire.path',Array.isArray(ref.wire.path)],
  ]);
   const expectedPath=file.imageType==='MAIN'?['imagePage','images','mainImage']:file.imageType==='ADDITIONAL'?['imagePage','images','additionalImage']:file.imageType==='SIZECHART'?['imagePage','images','sizeChartImage']:file.imageType==='DETAIL'?['imagePage','details','detailedImage']:['imagePage','images','labelImages'];
   if(!same(ref.wire.path,expectedPath)||(file.imageType==='LABEL'?!exact(ref.wire,['path','nameKey','valueKey','name'])||ref.wire.nameKey!=='labelImageType'||ref.wire.valueKey!=='labelImageFiles'||ref.wire.name!=='제품 한글 표시사항 라벨 또는 도안 이미지':!exact(ref.wire,['path'])))return mismatch('images.references.wire');
   const key=ref.documentIndex+'\0'+canonical(ref.wire),group=groups.get(key)??{documentIndex:ref.documentIndex,wire:ref.wire,files:new Map<number,string>()};if(group.files.has(ref.slotIndex))return mismatch('images.references.slotIndex.duplicate');group.files.set(ref.slotIndex,file.transportName);groups.set(key,group);
  }
 }
 if(total>64*1024*1024)return mismatch('images.totalByteLength');
 for(const group of groups.values()){const slots=[...group.files].sort(([a],[b])=>a-b);if(slots.some(([index],position)=>index!==position))return mismatch('images.references.slotIndex.sequence');if(wireValue(body.jsonDocument[group.documentIndex],group.wire)!==slots.map(([,name])=>name).join(','))return mismatch('body.imageWiring.value');}
 const prepared=clone(body);for(const document of prepared.jsonDocument)if(object(document.imagePage))for(const key of ['msrpAgree','labelContactAgreed'])if(Object.hasOwn(document.imagePage,key)){if(typeof document.imagePage[key]!=='boolean')return mismatch('body.imagePage.agreementType');document.imagePage[key]=false;}
 checkFields([['originalBodySha256',await digest(body)===plan.originalBodySha256],['preparedBodySha256',await digest(prepared)===plan.preparedBodySha256]]);
 const reviewIdentity={ownerId:identity.ownerId,company:clone(identity.company),productId:identity.productId,profileId:identity.source.profileId,requestedProfileId:input.profileId??null,categoryId:identity.categoryId,fingerprint:plan.sourcePlanSha256,inputFingerprint:identity.inputFingerprint,schemaSha256:identity.schemaSha256,source:clone(identity.source)};
 const originalBodySha256=plan.originalBodySha256!,preparedBodySha256=plan.preparedBodySha256!,reviewDigest=await digest({format:PRODUCT_DOCUMENT_FORMAT,type:PRODUCT_DOCUMENT_TYPE,identity:reviewIdentity,members,originalBodySha256,preparedBodySha256});
 return freeze({format:PRODUCT_DOCUMENT_FORMAT,type:PRODUCT_DOCUMENT_TYPE,identity:reviewIdentity,members,body,originalBodySha256,preparedBodySha256,reviewDigest,registered:false as const,remoteWrites:false as const,submissionReady:false as const});
}
const active=(signal:AbortSignal)=>{if(signal.aborted)fail('견적서 확인을 취소했습니다.');};
export const NATIVE_SOURCE_READ_TIMEOUT_MS=45000;
export class NativeSourceReadError extends Error{
 readonly code:'SOURCE_READ_TIMEOUT'|'SOURCE_READ_ABORTED';
 constructor(code:'SOURCE_READ_TIMEOUT'|'SOURCE_READ_ABORTED'){
  super(code==='SOURCE_READ_TIMEOUT'?'현재 상품의 원본 자료 확인이 45초 안에 끝나지 않았습니다. 저장 자료를 다시 조회해주세요.':'견적서 확인을 취소했습니다.');
  this.name='NativeSourceReadError';this.code=code;
 }
}
/** Bound the whole actor/source/actor observation, including response bodies.
 * The caller's controller belongs to the UI task and must remain active when
 * our local deadline expires so that the timeout can be rendered there. */
async function sourceReadWithinDeadline<T>(signal:AbortSignal,read:(signal:AbortSignal)=>Promise<T>):Promise<T>{
 if(signal.aborted)throw new NativeSourceReadError('SOURCE_READ_ABORTED');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,abort=()=>{};
 const interrupted=new Promise<never>((_,reject)=>{
  abort=()=>{reject(new NativeSourceReadError('SOURCE_READ_ABORTED'));controller.abort();};
  signal.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>{reject(new NativeSourceReadError('SOURCE_READ_TIMEOUT'));controller.abort();},NATIVE_SOURCE_READ_TIMEOUT_MS);
 });
 try{return await Promise.race([read(controller.signal),interrupted]);}
 finally{clearTimeout(timer);signal.removeEventListener('abort',abort);controller.abort();}
}
async function readJson(path:string,signal:AbortSignal,request:typeof fetch,limit=6*1024*1024):Promise<unknown>{
 active(signal);const response=await request.call(globalThis,path,{method:'GET',cache:'no-store',credentials:'same-origin',redirect:'error',signal});
 if(signal.aborted){void response.body?.cancel().catch(()=>{});active(signal);}
 if(response.redirected||!/\bapplication\/json\b/i.test(response.headers.get('content-type')??''))return fail('현재 상품의 전송 원본을 확인하지 못했습니다. 로그인 상태와 연결을 확인한 뒤 저장 자료를 다시 조회해주세요.');
 if(response.url){const actual=new URL(response.url);if(actual.pathname+actual.search!==path||typeof location!=='undefined'&&actual.origin!==location.origin)return fail();}
 const reader=response.body?.getReader();if(!reader)return fail();let length=0;const chunks:Uint8Array[]=[],abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{for(;;){active(signal);const part=await reader.read();active(signal);if(part.done)break;length+=part.value.byteLength;if(length>limit)return fail();chunks.push(part.value);}const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return fail('전송 원본 조회 응답을 확인하지 못했습니다. 저장 자료를 다시 조회해주세요.');}
  if(!response.ok){
   const error=object(value)?value:null,code=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)?` · ${error.code}`:'';
   const message=typeof error?.error==='string'&&error.error.length<=1000&&!/[\u0000-\u001f<>]/u.test(error.error)?` ${error.error}`:'';
   return fail(`현재 상품의 전송 원본 조회에 실패했습니다. (HTTP ${response.status}${code})${message}`);
  }
  return value;
 }
 finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function readCurrentNativeAssetSource(input:ReadScope):Promise<NativeAssetSourcePlan>{
 const request=input.fetcher??fetch,scope=clone({productId:input.productId,...(input.profileId?{profileId:input.profileId}:{}),quotationView:input.quotationView});
 if(!ID.test(scope.productId)||input.profileId!==undefined&&!ID.test(input.profileId))return fail();
 return sourceReadWithinDeadline(input.signal,async signal=>{
  const before=actor(await readJson('/api/supplier-hub/catalog-context',signal,request,4096)),path='/api/products/'+encodeURIComponent(scope.productId)+'/native-assets'+(scope.profileId?'?profileId='+encodeURIComponent(scope.profileId):'');
  const plan=scoped(await readJson(path,signal,request),scope,before),after=actor(await readJson('/api/supplier-hub/catalog-context',signal,request,4096));active(signal);
  checkFields([['actor',same(before,after)],['quotationView',same(input.quotationView,scope.quotationView)],['productId',input.productId===scope.productId],['profileId',(input.profileId??null)===(scope.profileId??null)]]);
  return freeze(plan);
 });
}
export async function reviewCurrentNativeSupplierHubProductDocument(input:ReadScope&{sourcePlan:NativeAssetSourcePlan}):Promise<SupplierHubProductDocumentReview>{
 active(input.signal);const plan=clone(input.sourcePlan),original=canonical(plan),quote=canonical(input.quotationView);if(!plan.identity)return mismatch('identity');
 // Compilation only examines the retained plan. One fresh complete source
 // observation after it detects any changed source or actor without reading
 // the same expensive plan twice during a single read-only review.
 const review=await compileNativeSupplierHubProductDocument({...input,sourcePlan:plan,ownerId:plan.identity.ownerId});active(input.signal);
 const after=await readCurrentNativeAssetSource(input);checkFields([['sourcePlan.current',canonical(after)===original],['sourcePlan.retained',canonical(input.sourcePlan)===original],['quotationView',canonical(input.quotationView)===quote]]);return review;
}
