import {prepareNativeAssetMultipart,nativeAssetUploadPlanSha256,validateNativeAssetUploadDescriptors} from './native-asset-multipart.mjs';
import {prepareNativeLegalBytes} from './native-legal-bytes.mjs';

export class NativeProductAssetsError extends Error{constructor(code,message='현재 새 문서의 원본 파일·저장값 연결을 다시 확인해주세요.'){super(message);this.name='NativeProductAssetsError';this.code=code;}}
const fail=(code,message)=>{throw new NativeProductAssetsError(code,message);};
const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
const copy=value=>JSON.parse(canon(value)),same=(a,b)=>canon(a)===canon(b);
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
const base64=bytes=>{let value='';for(let offset=0;offset<bytes.length;offset+=16384)value+=String.fromCharCode(...bytes.subarray(offset,offset+16384));return btoa(value);};
export function nativeProductAssetBytes(value){if(typeof value!=='string'||value.length>14*1024*1024||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))fail('NATIVE_ASSET_BYTES');const text=atob(value),bytes=Uint8Array.from(text,character=>character.charCodeAt(0));if(base64(bytes)!==value)fail('NATIVE_ASSET_BYTES');return bytes;}

/** Serialized only into the original authenticated app frame. Reads current
 * source JSON/private bytes; no Hub request, cookie/token read or publication. */
export async function nativeProductDocumentAppSourcePage(input){
 const expected=input.identity,origin=location.origin,HASH=/^[a-f0-9]{64}$/;
 if(!['https://sourceflow.jjwwhhjj1116.workers.dev','http://localhost:3000','http://127.0.0.1:3000'].includes(origin)||origin!==expected?.origin||!HASH.test(expected.fingerprint||''))throw Error('원래 앱의 원본 파일 요청이 아닙니다.');
 let nodes=0;const canon=(value,depth=0)=>{if(++nodes>100000||depth>30)throw Error('원본 계획이 처리 범위를 초과했습니다.');return value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(item=>canon(item,depth+1)).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key],depth+1)).join(',')+'}';};
 const canonical=value=>{nodes=0;return canon(value);},same=(a,b)=>canonical(a)===canonical(b),sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join(''),digest=value=>sha(new TextEncoder().encode(canonical(value)));
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000),requested=expected.requestedProfileId,query=requested===null?'':'?profileId='+encodeURIComponent(requested),path='/api/products/'+encodeURIComponent(expected.productId)+'/native-assets';
 async function read(path,limit,type){const url=origin+path,response=await fetch(url,{method:'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal,headers:{accept:type||'application/json'}});
  if(!response.ok||response.redirected||response.url!==url||type&&response.headers.get('content-type')?.split(';')[0]!==type||!type&&!/\bapplication\/json\b/i.test(response.headers.get('content-type')||''))throw Error('현재 앱의 원본 응답 출처·형식이 다릅니다.');
  const reader=response.body?.getReader();if(!reader)throw Error('원본 응답이 없습니다.');const parts=[];let length=0;try{for(;;){const item=await reader.read();if(item.done)break;length+=item.value.length;if(length>limit)throw Error('원본 응답이 너무 큽니다.');parts.push(item.value);}}finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return{response,bytes};
 }
 const json=async path=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode((await read(path,6*1024*1024)).bytes));
 function scope(plan){const identity=plan?.identity,source={...expected.source,profileId:expected.profileId};
  if(plan?.format!=='yoofam-native-asset-source-plan-v1'||plan.metadataValid!==true||plan.sourcePlanSha256!==expected.fingerprint||plan.issues?.some(issue=>issue.level==='error')
   ||['registered','remoteWrites','submissionReady','transportReady','bytesVerified'].some(key=>plan[key]!==false)||!identity||identity.ownerId!==expected.ownerId||identity.productId!==expected.productId||!same(identity.company,expected.company)
   ||identity.categoryId!==expected.categoryId||identity.schemaSha256!==expected.schemaSha256||identity.inputFingerprint!==expected.inputFingerprint||!same(identity.source,source)||!same(identity.members,expected.members)
   ||plan.originalBodySha256!==input.bodySha256||plan.preparedBodySha256!==input.preparedBodySha256||plan.body?.docId!==null||plan.body?.scope!=='Retail_Categorized_Single'||plan.body?.jsonDocument?.length!==expected.members?.length)throw Error('검토한 원본·회사·포함 옵션·파일명 본문이 현재 저장값과 다릅니다.');
 }
 try{
  const before=await json('/api/supplier-hub/catalog-context');if(before.ownerId!==expected.ownerId||!same(before.company,expected.company))throw Error('현재 승인 회원 회사가 다릅니다.');
  const account=await sha(new TextEncoder().encode(JSON.stringify(['sourceflow-managed-product-account-v1',before.ownerId,before.company.code,before.company.name])));if(account!==expected.accountContext)throw Error('현재 회원 연결이 변경됐습니다.');
  const plan=await json(path+query);scope(plan);const {sourcePlanSha256:omitted,...manifest}=plan;void omitted;
  if(await digest(manifest)!==expected.fingerprint||await digest(plan.identity)!==plan.identityDigest||await digest(plan.body)!==input.bodySha256)throw Error('현재 원본 계획의 독립 해시가 다릅니다.');
  const deferred=JSON.parse(JSON.stringify(plan.body));for(const document of deferred.jsonDocument)for(const key of ['msrpAgree','labelContactAgreed'])if(document.imagePage&&Object.hasOwn(document.imagePage,key))document.imagePage[key]=false;
  if(await digest(deferred)!==input.preparedBodySha256)throw Error('파일명 문서의 제출 전 저장값이 다릅니다.');
  let fileReply;
  if(input.action==='image'||input.action==='legal'){
   const candidates=input.action==='image'?plan.images:plan.nativeLegalAttachmentPlan?.files,files=candidates?.filter(file=>same(file,input.file));if(files?.length!==1)throw Error('현재 원본 계획에 포함된 정확한 파일만 조회할 수 있습니다.');const file=files[0];
   const filePath=input.action==='image'?path+'?sourcePlanSha256='+expected.fingerprint+'&key='+encodeURIComponent(file.key)+(requested===null?'':'&profileId='+encodeURIComponent(requested)):'/api/products/'+encodeURIComponent(expected.productId)+'/legal-documents?key='+encodeURIComponent(file.key);
   const original=await read(filePath,file.byteLength,file.contentType);if(original.bytes.length!==file.byteLength||await sha(original.bytes)!==file.sha256)throw Error('원본의 실제 길이·해시가 다릅니다.');
   if(input.action==='image'&&(original.response.headers.get('x-yoofam-source-plan-sha256')!==expected.fingerprint||original.response.headers.get('x-yoofam-file-sha256')!==file.sha256))throw Error('현재 상품 원본의 서버 확인값이 다릅니다.');
   const latest=await json(path+query);scope(latest);if(!same(plan,latest))throw Error('원본 조회 중 상품·견적·파일이 변경됐습니다.');
   let binary='';for(let offset=0;offset<original.bytes.length;offset+=16384)binary+=String.fromCharCode(...original.bytes.subarray(offset,offset+16384));fileReply={base64:btoa(binary),byteLength:file.byteLength,sha256:file.sha256,contentType:file.contentType};
  }else if(input.action!==undefined&&input.action!=='plan')throw Error('원본 조회 동작을 확인해주세요.');
  const after=await json('/api/supplier-hub/catalog-context');if(!same(before,after)||controller.signal.aborted)throw Error('조회 중 회원 회사가 변경됐습니다.');
  return{current:true,identity:expected,bodySha256:input.bodySha256,preparedBodySha256:input.preparedBodySha256,checkedAt:Date.now(),sourcePlan:plan,...(fileReply?{file:fileReply}:{})};
 }finally{clearTimeout(timer);}
}

/** Actual adapter update boundary. It consumes independently re-read server
 * plan/owned-create records, then uploads only verified private multipart parts.
 * Hub metadata agreement is not remote binary persistence or a receipt. */
export async function prepareAndUploadNativeProductAssets({sourcePlan,binding,target,readImage,readOriginal,readCurrent,executeGroup}){
 const original=canon(sourcePlan),expected=copy(sourcePlan.identity),expectedTarget=copy(target);
 const current=async()=>{const fresh=await readCurrent();if(canon(fresh.sourcePlan)!==original||!same(fresh.target,expectedTarget)||!same(fresh.binding,binding))fail('NATIVE_ASSET_SOURCE_CHANGED');};
 await current();if(sourcePlan.sourcePlanSha256!==binding.nativeAssetSourcePlanSha256||sourcePlan.preparedBodySha256!==binding.preparedBodySha256||sourcePlan.originalBodySha256!==binding.originalBodySha256)fail('NATIVE_ASSET_BODY');
 let legalPreparation;const legal=sourcePlan.nativeLegalAttachmentPlan;
 if(legal)legalPreparation=await prepareNativeLegalBytes(legal,{expectedIdentity:expected,expectedPlanSha256:legal.planSha256,readOriginal});
 const plan={format:'yoofam-native-asset-upload-plan-v1',identity:expected,identityDigest:sourcePlan.identityDigest,target:expectedTarget,images:copy(sourcePlan.images),nativeLegalAttachmentPlan:legal?copy(legal):null,planSha256:null,registered:false,remoteWrites:false,submissionReady:false,transportReady:false};
 plan.planSha256=await nativeAssetUploadPlanSha256(plan);
 const prepared=await prepareNativeAssetMultipart(plan,{expectedIdentity:expected,expectedTarget,expectedPlanSha256:plan.planSha256,readImage,...(legalPreparation?{legalPreparation}:{})});await current();
 const groups=[];
 for(const request of prepared.requests){const parts=[],entries=[...request.body.entries()];if(entries.length!==request.files.length)fail('NATIVE_ASSET_PARTS');let length=0;
  for(let index=0;index<entries.length;index++){const [name,file]=entries[index],metadata=request.files[index],bytes=new Uint8Array(await Blob.prototype.arrayBuffer.call(file));length+=bytes.length;
   if(name!==(request.kind==='image'?'additionalImageFiles':'uploadFiles')||file.name!==metadata.transportName||file.type!==metadata.contentType||bytes.length!==metadata.byteLength||await hash(bytes)!==metadata.sha256)fail('NATIVE_ASSET_PARTS');
   parts.push({...copy(metadata),fieldName:name,base64:base64(bytes)});
  }
  // One Chrome frame call carries one upload group, never the entire 64MiB plan.
  if(length>20*1024*1024)fail('NATIVE_ASSET_FRAME_LIMIT');groups.push({kind:request.kind,...(request.kind==='image'?{imageType:request.imageType}:{nativeType:request.nativeType}),path:request.path,parts});
 }
 const observations=[];
 for(const group of groups){await current();const value=await executeGroup({binding:copy(binding),sourcePlanSha256:sourcePlan.sourcePlanSha256,plan:copy(plan),expectedTarget:copy(expectedTarget),group});await current();
  if(value?.metadataObserved!==true||value.remoteBytesVerified!==false||value.actualUploadVerified!==false||value.registered!==false||!same(value.docId,target.docId)||value.planSha256!==plan.planSha256)fail('NATIVE_ASSET_UPLOAD_UNCONFIRMED');
  validateNativeAssetUploadDescriptors(value.descriptors,{kind:group.kind,expectedFiles:group.parts});observations.push(copy(value));
 }
 return{sourcePlanSha256:sourcePlan.sourcePlanSha256,planSha256:plan.planSha256,groups:observations,metadataObserved:true,remoteBytesVerified:false,actualUploadVerified:false,registered:false};
}
