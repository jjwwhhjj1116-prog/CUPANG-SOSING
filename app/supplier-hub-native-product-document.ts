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
const fail=(message='현재 저장한 상품·카테고리·파일과 전송 자료가 다릅니다. 다시 확인해주세요.'):never=>{throw Error(message);};
function actor(value:unknown):Actor{
 const v=clone(value);if(!exact(v,['ownerId','company'])||typeof v.ownerId!=='string'||!ID.test(v.ownerId)||!exact(v.company,['code','name'])||!same(supplierHubCompany(v.company.code,v.company.name),v.company))return fail('현재 승인 회원 회사를 확인해주세요.');
 return v as Actor;
}
function scoped(value:unknown,scope:Scope,expected:Actor):NativeAssetSourcePlan{
 const plan=clone(value) as NativeAssetSourcePlan,view=clone(scope.quotationView),identity=plan.identity;
 if(!exact(plan,['format','storageNameSemantics','identity','identityDigest','images','nativeLegalAttachmentPlan','body','originalBodySha256','preparedBodySha256','sourcePlanSha256','issues','metadataValid','registered','remoteWrites','submissionReady','transportReady','bytesVerified'])
  ||plan.format!=='yoofam-native-asset-source-plan-v1'||plan.storageNameSemantics!=='private-key-leaf'||typeof plan.metadataValid!=='boolean'||!Array.isArray(plan.issues)||plan.issues.some(issue=>!object(issue)||!['error','review'].includes(issue.level)||typeof issue.message!=='string')
  ||['registered','remoteWrites','submissionReady','transportReady','bytesVerified'].some(key=>plan[key as keyof NativeAssetSourcePlan]!==false))return fail('현재 원본 파일 계획의 형식을 확인해주세요.');
 if(!Array.isArray(plan.images)||plan.images.length>150||plan.images.some(file=>!exact(file,['key','originalName','transportName','imageType','contentType','byteLength','sha256','references'])
  ||typeof file.key!=='string'||typeof file.originalName!=='string'||typeof file.transportName!=='string'||!['MAIN','ADDITIONAL','SIZECHART','LABEL','DETAIL'].includes(file.imageType)
  ||!Array.isArray(file.references)||!file.references.length||file.references.length>6000||file.references.some(ref=>!exact(ref,['optionId','documentIndex','wire','slotIndex'])||typeof ref.optionId!=='string'||!Number.isSafeInteger(ref.documentIndex)||!Number.isSafeInteger(ref.slotIndex)||!object(ref.wire)||!Array.isArray(ref.wire.path)))
  ||plan.nativeLegalAttachmentPlan!==null&&(!object(plan.nativeLegalAttachmentPlan)||!Array.isArray(plan.nativeLegalAttachmentPlan.files)))return fail('현재 첨부 파일 목록의 형식을 확인해주세요.');
 if(!identity)return fail(plan.issues.map(issue=>issue.message).join('\n')||undefined);
 if(!exact(identity,['ownerId','productId','company','categoryId','categoryPath','schemaSha256','sourceFingerprint','inputFingerprint','source','members'])
  ||!ID.test(scope.productId)||scope.profileId!==undefined&&!ID.test(scope.profileId)||identity.ownerId!==expected.ownerId||identity.productId!==scope.productId||!same(identity.company,expected.company)
  ||typeof identity.categoryId!=='string'||!/^[1-9]\d{0,19}$/.test(identity.categoryId)||identity.categoryId!==view.categoryContext?.categoryId||!same(identity.categoryPath,view.categoryContext.categoryPath)
  ||!['schemaSha256','sourceFingerprint','inputFingerprint'].every(key=>typeof identity[key as keyof typeof identity]==='string'&&HASH.test(identity[key as keyof typeof identity] as string))||identity.inputFingerprint!==view.inputFingerprint
  ||!exact(identity.source,['productVersion','contentRevision','optionRevision','quotationRevision','profileId','profileRevision'])||identity.source.productVersion!==view.productVersion||identity.source.contentRevision!==view.contentRevision
  ||identity.source.optionRevision!==view.optionRevision||identity.source.quotationRevision!==view.revision||identity.source.profileId!==view.categoryContext.profileId||scope.profileId!==undefined&&identity.source.profileId!==scope.profileId
  ||identity.source.profileId!==null&&!ID.test(identity.source.profileId)||identity.source.profileRevision!==null&&(!Number.isSafeInteger(identity.source.profileRevision)||identity.source.profileRevision<0)
  ||!Array.isArray(identity.members)||!identity.members.length||identity.members.length>200||!same(identity.members,view.resolved.rows.filter(row=>row.included).map((row,documentIndex)=>({optionId:row.optionId,optionLabel:row.optionLabel,documentIndex}))))return fail();
 return plan;
}
function wireValue(document:unknown,wire:{path:string[];name?:string;nameKey?:string;valueKey?:string}){
 let value=document;for(const key of wire.path){if(!object(value)||!Object.hasOwn(value,key))return fail();value=value[key];}
 if(wire.name!==undefined){if(!Array.isArray(value)||!wire.nameKey||!wire.valueKey)return fail();const matches=value.filter(row=>object(row)&&row[wire.nameKey!]===wire.name);if(matches.length!==1)return fail();return matches[0][wire.valueKey];}
 return value;
}
/** Private filename-body review is a separate source contract. It never marks
 * the legacy public-URL package prepared, creates a target, or uploads a file. */
export async function compileNativeSupplierHubProductDocument(input:Scope&{sourcePlan:NativeAssetSourcePlan;ownerId:string}):Promise<SupplierHubProductDocumentReview>{
 const source=clone(input.sourcePlan);if(!source.identity)return fail();
 const view=clone(input.quotationView),expected=actor({ownerId:input.ownerId,company:source.identity.company}),plan=scoped(source,input,expected),identity=plan.identity!;
 if(!ID.test(input.ownerId)||!supplierHubCompany(identity.company.code,identity.company.name)||!plan.metadataValid||plan.issues.some(issue=>issue.level==='error')||!plan.body||!plan.sourcePlanSha256||!HASH.test(plan.sourcePlanSha256)||!HASH.test(plan.identityDigest??'')||!HASH.test(plan.originalBodySha256??'')||!HASH.test(plan.preparedBodySha256??''))return fail('원본 파일·필수 입력·서류 해당 여부를 먼저 확인해주세요.');
 const {sourcePlanSha256:ignored,...manifest}=plan;void ignored;
 if(await digest(manifest)!==plan.sourcePlanSha256||await digest(identity)!==plan.identityDigest)return fail();
 const body=clone(plan.body),members=clone(identity.members);
 if(body.docId!==null||body.scope!=='Retail_Categorized_Single'||body.displayCategoryCode!==identity.categoryId||!['categoryId','productNoticeNumber','version'].every(key=>typeof body[key as keyof typeof body]==='number'&&Number.isSafeInteger(body[key as keyof typeof body])||typeof body[key as keyof typeof body]==='string'&&/^\d{1,20}$/.test(body[key as keyof typeof body] as string))
  ||/^0+$/.test(String(body.categoryId))||typeof body.categoryPath!=='string'||!body.categoryPath.endsWith(' ('+identity.categoryId+')')||!Array.isArray(body.jsonDocument)||body.jsonDocument.length!==members.length)return fail();
 for(const document of body.jsonDocument){if(!object(document)||Object.keys(document).some(key=>!['startPage','productPage','imagePage','legalPage','logisticsPage','sourcingPage'].includes(key))||Object.values(document).some(page=>!object(page))||!object(document.startPage)||typeof document.startPage.productName!=='string'||!document.startPage.productName.trim()||document.startPage.categoryPath!==body.categoryPath)return fail();}
 if(body.productName!==(body.jsonDocument[0].startPage as Node).productName)return fail();
 if(!Array.isArray(plan.images)||plan.images.length>150||!plan.images.length&&!plan.nativeLegalAttachmentPlan?.files.length)return fail();
 const groups=new Map<string,{documentIndex:number;wire:NativeAssetSourcePlan['images'][number]['references'][number]['wire'];files:Map<number,string>}>(),names=new Set<string>();let total=0;
 for(const file of plan.images){
  if(!isOwnedImageKey(input.ownerId,file.key)||!view.imageKeys.includes(file.key)||!HASH.test(file.sha256)||!['MAIN','ADDITIONAL','SIZECHART','LABEL','DETAIL'].includes(file.imageType)||!['image/png','image/jpeg'].includes(file.contentType)||!Number.isSafeInteger(file.byteLength)||file.byteLength<=0||file.byteLength>10*1024*1024||typeof file.transportName!=='string'||!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(file.transportName)||names.has(file.transportName)||!Array.isArray(file.references)||!file.references.length)return fail();
  names.add(file.transportName);total+=file.byteLength;
  for(const ref of file.references){const member=members[ref.documentIndex];if(!member||member.optionId!==ref.optionId||!Number.isSafeInteger(ref.slotIndex)||ref.slotIndex<0||ref.slotIndex>=30||!Array.isArray(ref.wire.path))return fail();
   const expectedPath=file.imageType==='MAIN'?['imagePage','images','mainImage']:file.imageType==='ADDITIONAL'?['imagePage','images','additionalImage']:file.imageType==='SIZECHART'?['imagePage','images','sizeChartImage']:file.imageType==='DETAIL'?['imagePage','details','detailedImage']:['imagePage','images','labelImages'];
   if(!same(ref.wire.path,expectedPath)||(file.imageType==='LABEL'?!exact(ref.wire,['path','nameKey','valueKey','name'])||ref.wire.nameKey!=='labelImageType'||ref.wire.valueKey!=='labelImageFiles'||ref.wire.name!=='제품 한글 표시사항 라벨 또는 도안 이미지':!exact(ref.wire,['path'])))return fail();
   const key=ref.documentIndex+'\0'+canonical(ref.wire),group=groups.get(key)??{documentIndex:ref.documentIndex,wire:ref.wire,files:new Map<number,string>()};if(group.files.has(ref.slotIndex))return fail();group.files.set(ref.slotIndex,file.transportName);groups.set(key,group);
  }
 }
 if(total>64*1024*1024)return fail();
 for(const group of groups.values()){const slots=[...group.files].sort(([a],[b])=>a-b);if(slots.some(([index],position)=>index!==position)||wireValue(body.jsonDocument[group.documentIndex],group.wire)!==slots.map(([,name])=>name).join(','))return fail();}
 const prepared=clone(body);for(const document of prepared.jsonDocument)if(object(document.imagePage))for(const key of ['msrpAgree','labelContactAgreed'])if(Object.hasOwn(document.imagePage,key)){if(typeof document.imagePage[key]!=='boolean')return fail();document.imagePage[key]=false;}
 if(await digest(body)!==plan.originalBodySha256||await digest(prepared)!==plan.preparedBodySha256)return fail();
 const reviewIdentity={ownerId:identity.ownerId,company:clone(identity.company),productId:identity.productId,profileId:identity.source.profileId,requestedProfileId:input.profileId??null,categoryId:identity.categoryId,fingerprint:plan.sourcePlanSha256,inputFingerprint:identity.inputFingerprint,schemaSha256:identity.schemaSha256,source:clone(identity.source)};
 const originalBodySha256=plan.originalBodySha256!,preparedBodySha256=plan.preparedBodySha256!,reviewDigest=await digest({format:PRODUCT_DOCUMENT_FORMAT,type:PRODUCT_DOCUMENT_TYPE,identity:reviewIdentity,members,originalBodySha256,preparedBodySha256});
 return freeze({format:PRODUCT_DOCUMENT_FORMAT,type:PRODUCT_DOCUMENT_TYPE,identity:reviewIdentity,members,body,originalBodySha256,preparedBodySha256,reviewDigest,registered:false as const,remoteWrites:false as const,submissionReady:false as const});
}
const active=(signal:AbortSignal)=>{if(signal.aborted)fail('견적서 확인을 취소했습니다.');};
async function readJson(path:string,signal:AbortSignal,request:typeof fetch,limit=6*1024*1024):Promise<unknown>{
 active(signal);const response=await request.call(globalThis,path,{method:'GET',cache:'no-store',credentials:'same-origin',redirect:'error',signal});active(signal);
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
 finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function readCurrentNativeAssetSource(input:ReadScope):Promise<NativeAssetSourcePlan>{
 const request=input.fetcher??fetch,scope=clone({productId:input.productId,...(input.profileId?{profileId:input.profileId}:{}),quotationView:input.quotationView});
 if(!ID.test(scope.productId)||input.profileId!==undefined&&!ID.test(input.profileId))return fail();
 const before=actor(await readJson('/api/supplier-hub/catalog-context',input.signal,request,4096)),path='/api/products/'+encodeURIComponent(scope.productId)+'/native-assets'+(scope.profileId?'?profileId='+encodeURIComponent(scope.profileId):'');
 const plan=scoped(await readJson(path,input.signal,request),scope,before),after=actor(await readJson('/api/supplier-hub/catalog-context',input.signal,request,4096));active(input.signal);
 if(!same(before,after)||!same(input.quotationView,scope.quotationView)||input.productId!==scope.productId||(input.profileId??null)!==(scope.profileId??null))return fail();
 return freeze(plan);
}
export async function reviewCurrentNativeSupplierHubProductDocument(input:ReadScope&{sourcePlan:NativeAssetSourcePlan}):Promise<SupplierHubProductDocumentReview>{
 const original=canonical(input.sourcePlan),quote=canonical(input.quotationView),plan=await readCurrentNativeAssetSource(input);if(canonical(plan)!==original||!plan.identity)return fail();
 const review=await compileNativeSupplierHubProductDocument({...input,sourcePlan:plan,ownerId:plan.identity.ownerId});active(input.signal);
 const after=await readCurrentNativeAssetSource(input);if(canonical(after)!==original||canonical(input.sourcePlan)!==original||canonical(input.quotationView)!==quote)return fail();return review;
}
