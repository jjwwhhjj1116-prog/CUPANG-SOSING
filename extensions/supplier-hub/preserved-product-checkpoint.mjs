import {HANDOFF_ORIGINS} from './handoff-store.mjs';
import {createProductDocumentStore} from './product-document-receiver.mjs';

const FORMAT='yoofam-preserved-product-checkpoint-inspection-v1';
const COMPANIES={A01526306:'유앤채',A01464742:'와이홉'};
const HASH=/^[a-f0-9]{64}$/,ID=/^\w[\w-]{0,99}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const STATES=new Set(['prepared','target-requested','target-created','create-requested','created','update-requested','updated','validation-requested','validated','validation-rejected','navigation-requested','navigation-ready','awaiting-stage-consent','stage-consent-requested','awaiting-consent','consent-requested','submit-requested','pending','accepted','rejected']);
const MESSAGES={found:'기존 요청의 보관 기록을 읽었습니다. 본문·파일을 복원하거나 전송하지 않았습니다. 계속 실행할 수 있는 원본 문맥은 아직 확인하지 않았습니다.',
  'not-found':'이 확장 보관함에서 같은 회원·회사·상품의 요청을 찾지 못했습니다. 새 요청을 만들지 않았습니다.',
  'storage-missing':'이 브라우저 확장에 기존 요청 보관함이 없습니다. 다른 브라우저의 기록을 추정하거나 새 기록을 만들지 않았습니다.',
  'scan-limit':'보관함의 확인 한도에 도달했습니다. 요청의 부재나 유일성을 확정하지 않았습니다.',
  ambiguous:'같은 범위의 요청번호에 여러 기록이 있습니다. 하나를 임의로 선택하지 않았습니다.',
  'document-mismatch':'보관된 요청의 문서번호가 요청한 문서와 다릅니다. 다른 문서로 연결하지 않았습니다.',
  'checkpoint-invalid':'보관된 요청의 식별값·문서·단계 연결을 확인하지 못했습니다. 기존 기록은 변경하지 않았습니다.'};
const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const dense=value=>Array.isArray(value)&&Object.keys(value).length===value.length&&Object.keys(value).every((key,index)=>key===String(index));
const documentId=value=>typeof value==='number'?Number.isSafeInteger(value)&&value>0:typeof value==='string'&&/^[1-9]\d{0,29}$/.test(value);
const company=value=>exact(value,['code','name'])&&Object.hasOwn(COMPANIES,value.code)&&COMPANIES[value.code]===value.name;
const fail=(code,message)=>{const error=new Error(message);error.code=code;throw error;};
const bad=()=>fail('PRESERVED_CHECKPOINT_INVALID','보관된 요청의 식별값·문서·단계 연결을 확인하지 못했습니다. 기존 기록은 변경하지 않았습니다.');
function canonical(value,depth=0,seen=new Set()){
  if(depth>15)bad();
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){if(!Number.isFinite(value))bad();return JSON.stringify(value);}
  if(!object(value)&&!Array.isArray(value)||seen.has(value))bad();seen.add(value);
  const result=Array.isArray(value)?'['+value.map(item=>canonical(item,depth+1,seen)).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key],depth+1,seen)).join(',')+'}';
  seen.delete(value);if(result.length>256*1024)bad();return result;
}
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
const accountDigest=async(identity)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['sourceflow-managed-product-account-v1',identity.ownerId,identity.company.code,identity.company.name])))),byte=>byte.toString(16).padStart(2,'0')).join('');
function targetOf(message){
  if(!exact(message,['type','action','target'])||message.type!=='YOOFAM_INSPECT_PRESERVED_PRODUCT_DOCUMENT'||message.action!=='inspect'
    )fail('PRESERVED_REQUEST_INVALID','확인할 기존 요청번호·문서번호·상품·승인 회사를 확인해주세요.');
  return validatePreservedProductInspectionTarget(message.target);
}
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export function validatePreservedProductInspectionTarget(target){
  if(!exact(target,['requestId','docId','productId','company'])||!UUID.test(target.requestId||'')||!documentId(target.docId)||!UUID.test(target.productId||'')||!company(target.company))
    fail('PRESERVED_REQUEST_INVALID','확인할 기존 요청번호·문서번호·상품·승인 회사를 확인해주세요.');
  return freeze(structuredClone(target));
}
function result(target,status,scan,checkpoint=null,code=status){
  return {format:FORMAT,target,status,found:scan.matches.length>0,scanned:scan.scanned,complete:scan.complete,readOnly:true,remoteWrites:false,checkpointWrites:false,registered:false,canResume:false,checkpoint,diagnostic:{code,message:MESSAGES[status]}};
}
/** The app accepts only this metadata report, never a packet, source lease or
 * action capability smuggled into an extension response. */
export function validatePreservedProductInspectionResult(value,expectedTarget){
  const target=validatePreservedProductInspectionTarget(expectedTarget),badReport=()=>fail('PRESERVED_REPORT_INVALID','보관 요청 확인 응답의 범위와 읽기 전용 상태를 확인하지 못했습니다.');
  try{
    if(new TextEncoder().encode(canonical(value)).length>65536||!exact(value,['format','target','status','found','scanned','complete','readOnly','remoteWrites','checkpointWrites','registered','canResume','checkpoint','diagnostic'])
      ||value.format!==FORMAT||canonical(validatePreservedProductInspectionTarget(value.target))!==canonical(target)||!Object.hasOwn(MESSAGES,value.status)
      ||typeof value.found!=='boolean'||!integer(value.scanned)||value.scanned>500||typeof value.complete!=='boolean'||value.readOnly!==true||value.remoteWrites!==false||value.checkpointWrites!==false||value.registered!==false||value.canResume!==false
      ||!exact(value.diagnostic,['code','message'])||value.diagnostic.code!==value.status||value.diagnostic.message!==MESSAGES[value.status])badReport();
    if(value.status==='scan-limit'&&value.complete||value.status!=='scan-limit'&&value.status!=='ambiguous'&&!value.complete
      ||['found','ambiguous','document-mismatch','checkpoint-invalid'].includes(value.status)&&!value.found||['not-found','storage-missing'].includes(value.status)&&value.found
      ||value.status==='storage-missing'&&value.scanned!==0||value.status!=='found'&&value.checkpoint!==null)badReport();
    if(value.status==='found'){
      const c=value.checkpoint,source=c?.source;
      if(!exact(c,['state','sequence','updatedAt','requestId','docId','identityDigest','packetDigest','originalBodySha256','preparedBodySha256','sourcePlanSha256','profileId','categoryId','source','membersCount','validatedSteps','draftOnly','preparedLifecycle','operationId','requestedStep','submitRequestedAt','savedAppTabId','savedWindowId','savedHubTabId','laneMatched','durableBodyAvailable','durableSourcePlanAvailable'])
        ||!STATES.has(c.state)||['prepared','target-requested','target-created','create-requested'].includes(c.state)||!integer(c.sequence)||c.sequence<1||!integer(c.updatedAt)||c.updatedAt<1||c.updatedAt>Date.now()+5000
        ||c.requestId!==target.requestId||!documentId(c.docId)||String(c.docId)!==String(target.docId)||!['identityDigest','packetDigest','originalBodySha256','preparedBodySha256','sourcePlanSha256'].every(key=>HASH.test(c[key]||''))
        ||!(c.profileId===null||ID.test(c.profileId||''))||!(c.categoryId===null||/^\d{1,20}$/.test(c.categoryId||''))
        ||!exact(source,['productVersion','contentRevision','optionRevision','quotationRevision','profileRevision'])||typeof source.productVersion!=='string'||!Number.isFinite(Date.parse(source.productVersion))||Date.parse(source.productVersion)>c.updatedAt+5000
        ||!['contentRevision','optionRevision','quotationRevision'].every(key=>integer(source[key]))||!(source.profileRevision===null||integer(source.profileRevision))
        ||!Number.isSafeInteger(c.membersCount)||c.membersCount<1||c.membersCount>200||!dense(c.validatedSteps)||c.validatedSteps.length>4||c.validatedSteps.some((step,index)=>step!==[2,3,4,5][index])
        ||c.state==='validated'&&c.validatedSteps.length!==4||c.draftOnly!==true||typeof c.preparedLifecycle!=='boolean'||c.operationId!==null&&(typeof c.operationId!=='string'||c.operationId.length>200||!c.operationId.startsWith(target.requestId+':')||/[\u0000-\u001f]/.test(c.operationId))
        ||!(c.requestedStep===null||[2,3,4,5].includes(c.requestedStep))||!(c.submitRequestedAt===null||integer(c.submitRequestedAt)&&c.submitRequestedAt>0&&c.submitRequestedAt<=c.updatedAt)
        ||!integer(c.savedAppTabId)||!integer(c.savedWindowId)||!(c.savedHubTabId===null||integer(c.savedHubTabId))||c.laneMatched!==true||c.durableBodyAvailable!==false||c.durableSourcePlanAvailable!==false||value.scanned<1)badReport();
    }
    return freeze(structuredClone(value));
  }catch{badReport();}
}
async function checkedCheckpoint(match,scope,target,now){
  const state=match.checkpoint,identity=state?.identity;
  if(!object(state)||!object(identity)||state.format!=='yoofam-supplier-hub-product-document-v1'||state.draftOnly!==true||!STATES.has(state.state)||['prepared','target-requested','target-created','create-requested'].includes(state.state)
    ||state.key!==match.key||state.key!=='product-document:'+state.packetDigest||!HASH.test(state.packetDigest||'')||!HASH.test(state.identityDigest||'')
    ||!HASH.test(state.bodySha256||'')||!HASH.test(state.originalBodySha256||'')||state.requestId!==target.requestId||!documentId(state.docId)
    ||identity.origin!==scope.origin||identity.ownerId!==scope.ownerId||identity.productId!==target.productId||!company(identity.company)||canonical(identity.company)!==canonical(target.company)
    ||!integer(identity.appTabId)||!integer(identity.windowId)||!HASH.test(identity.accountContext||'')||!HASH.test(identity.fingerprint||'')||!HASH.test(identity.inputFingerprint||'')||!HASH.test(identity.schemaSha256||'')
    ||!integer(state.sequence)||state.sequence<1||!integer(state.updatedAt)||state.updatedAt<1||state.updatedAt>now+5000
    ||!dense(identity.members)||!identity.members.length||identity.members.length>200||!dense(state.validatedSteps)||state.validatedSteps.length>4
    ||state.validatedSteps.some((step,index)=>step!==[2,3,4,5][index])||state.state==='validated'&&state.validatedSteps.length!==4
    ||state.preparedLifecycle!==undefined&&state.preparedLifecycle!==true||state.operationId!==undefined&&(typeof state.operationId!=='string'||state.operationId.length>200||!state.operationId.startsWith(state.requestId+':')||/[\u0000-\u001f]/.test(state.operationId))
    ||state.requestedStep!==undefined&&![2,3,4,5].includes(state.requestedStep)||state.submitRequestedAt!==undefined&&(!integer(state.submitRequestedAt)||state.submitRequestedAt<1||state.submitRequestedAt>state.updatedAt))bad();
  const source=identity.source;
  if(!exact(source,['productVersion','contentRevision','optionRevision','quotationRevision','profileRevision'])||typeof source.productVersion!=='string'||!Number.isFinite(Date.parse(source.productVersion))||Date.parse(source.productVersion)>state.updatedAt+5000
    ||!['contentRevision','optionRevision','quotationRevision'].every(key=>integer(source[key]))||!(source.profileRevision===null||integer(source.profileRevision))
    ||!(identity.profileId===null||ID.test(identity.profileId||''))||!(identity.categoryId===null||/^\d{1,20}$/.test(identity.categoryId||'')))bad();
  if(await digest(identity)!==state.identityDigest||await accountDigest(identity)!==identity.accountContext)bad();
  const logical={...identity};delete logical.appTabId;delete logical.windowId;
  if(await digest({identity:logical,bodySha256:state.bodySha256,originalBodySha256:state.originalBodySha256})!==state.packetDigest)bad();
  const lane=Object.fromEntries(['origin','ownerId','accountContext','company','productId'].map(key=>[key,identity[key]]));
  if(state.laneKey!=='product-document-lane:'+await digest(lane)||!exact(match.lane,['key'])||match.lane.key!==state.key)bad();
  const hub=state.tab??state.ownedTarget;
  if(hub!==null&&hub!==undefined&&(!object(hub)||!integer(hub.tabId)||hub.windowId!==identity.windowId))bad();
  return {state:state.state,sequence:state.sequence,updatedAt:state.updatedAt,requestId:state.requestId,docId:state.docId,
    identityDigest:state.identityDigest,packetDigest:state.packetDigest,originalBodySha256:state.originalBodySha256,preparedBodySha256:state.bodySha256,sourcePlanSha256:identity.fingerprint,
    profileId:identity.profileId,categoryId:identity.categoryId,source:structuredClone(source),membersCount:identity.members.length,validatedSteps:[...state.validatedSteps],draftOnly:true,preparedLifecycle:state.preparedLifecycle===true,
    operationId:state.operationId??null,requestedStep:state.requestedStep??null,submitRequestedAt:state.submitRequestedAt??null,
    savedAppTabId:identity.appTabId,savedWindowId:identity.windowId,savedHubTabId:hub?.tabId??null,laneMatched:true,durableBodyAvailable:false,durableSourcePlanAvailable:false};
}
/** Inspect existing extension-private metadata only. This does not instantiate
 * a receiver/adapter, recover a source lease, contact Hub or mutate any store. */
export async function inspectPreservedProductDocument(message,sender,{api=globalThis.chrome,store=createProductDocumentStore(),now=Date.now}={}){
  const target=targetOf(message);let origin;
  try{const url=new URL(sender?.url);if(url.username||url.password)throw Error('origin');origin=url.origin;}catch{fail('PRESERVED_SENDER_INVALID','기존 요청을 확인할 앱 출처를 확인해주세요.');}
  if(sender?.id!==api?.runtime?.id||sender?.frameId!==0||!HANDOFF_ORIGINS.includes(origin)||!integer(sender?.tab?.id)||!integer(sender?.tab?.windowId))
    fail('PRESERVED_SENDER_INVALID','현재 앱의 확장 연결에서만 기존 요청을 확인할 수 있습니다.');
  const current=async()=>{
    const tab=await api.tabs.get(sender.tab.id);let url;try{url=new URL(tab.url);}catch{fail('PRESERVED_SCOPE_CHANGED','현재 앱 탭을 다시 확인해주세요.');}
    if(tab.id!==sender.tab.id||tab.windowId!==sender.tab.windowId||tab.pendingUrl||url.origin!==origin||url.username||url.password)fail('PRESERVED_SCOPE_CHANGED','확인 중 현재 앱 탭이 변경되었습니다.');
    const reply=await api.tabs.sendMessage(sender.tab.id,{type:'YOOFAM_READ_PRESERVED_PRODUCT_DOCUMENT_SCOPE',expected:{origin,target}},{frameId:0}),scope=reply?.scope;
    if(reply?.ok!==true||!exact(scope,['ownerId','company','target'])||!ID.test(scope.ownerId||'')||!company(scope.company)||canonical(scope.company)!==canonical(target.company)||canonical(scope.target)!==canonical(target))
      fail('PRESERVED_SCOPE_UNVERIFIED','현재 승인 회원·회사와 요청의 회사 연결을 확인하지 못했습니다.');
    return {origin,ownerId:scope.ownerId,company:structuredClone(scope.company)};
  };
  const before=await current(),scan=await store.inspectProductRequest({...before,productId:target.productId,requestId:target.requestId,docId:target.docId});
  const finish=async report=>{if(canonical(before)!==canonical(await current()))fail('PRESERVED_SCOPE_CHANGED','확인 중 로그인 회원·승인 회사가 변경되었습니다.');return validatePreservedProductInspectionResult(report,target);};
  if(!object(scan)||!Array.isArray(scan.matches)||scan.matches.length>2||!integer(scan.scanned)||scan.scanned>500||typeof scan.complete!=='boolean'||typeof scan.available!=='boolean')bad();
  if(!scan.available)return finish(result(target,'storage-missing',scan));
  if(scan.matches.length>1)return finish(result(target,'ambiguous',scan));
  if(!scan.complete)return finish(result(target,'scan-limit',scan));
  if(!scan.matches.length)return finish(result(target,'not-found',scan));
  if(String(scan.matches[0].checkpoint?.docId)!==String(target.docId))return finish(result(target,'document-mismatch',scan));
  let checkpoint;try{checkpoint=await checkedCheckpoint(scan.matches[0],before,target,now());}
  catch(error){if(error?.code!=='PRESERVED_CHECKPOINT_INVALID')throw error;return finish(result(target,'checkpoint-invalid',scan));}
  return finish(result(target,'found',scan,checkpoint));
}
