import {HANDOFF_ORIGINS} from './handoff-store.mjs';

// Clean-room reconstruction of the recorded Single protocol. The retained
// artifact establishes these paths, not live response schemas or acceptance.
// REA: ev_17ed0cebd00b285e0bc489221547e437d2b3f69d9b636a813eb942a0a2a3a49a.
export const SINGLE_DOCUMENT_FORMAT='yoofam-supplier-hub-single-document-v1';
export const SINGLE_DOCUMENT_ORIGIN='https://supplier.coupang.com';
export const SINGLE_DOCUMENT_PATHS=Object.freeze({create:'/sr/draft/api/create',update:'/sr/draft/api/update',drafts:'/sr/draft/api/drafts'});
const COMPANIES=Object.freeze({A01526306:'유앤채',A01464742:'와이홉'});
const PAGES=['startPage','productPage','imagePage','legalPage','logisticsPage','sourcingPage'];
const STATES=new Set(['prepared','target-requested','target-created','create-requested','created','update-requested','updated','validation-requested','validated','validation-rejected','navigation-requested','awaiting-stage-consent','stage-consent-requested','awaiting-consent','consent-requested','submit-requested','pending','accepted','rejected','registered']);
const STAGE_FLAGS={productPage:{key:'msrpAgree',id:'agreeMSRPTerm'},imagePage:{key:'labelContactAgreed',id:'agreeLabelContact'}};
const STAGES=Object.keys(STAGE_FLAGS);
const HEX=/^[a-f0-9]{64}$/;
const ID=/^\w[\w-]{0,99}$/;
const LIMIT=6*1024*1024;

export class SingleDocumentError extends Error{
  constructor(code,message){super(message);this.name='SingleDocumentError';this.code=code;}
}
const fail=(code,message)=>{throw new SingleDocumentError(code,message);};
const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const same=(left,right)=>left===undefined||right===undefined?left===right:canonical(left)===canonical(right);
const identifier=value=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=200&&!/[\u0000-\u001f]|\.\.\.|…/.test(value)
  ||Number.isSafeInteger(value)&&value>0;
const company=value=>object(value)&&Object.keys(value).length===2&&COMPANIES[value.code]===value.name&&Object.hasOwn(COMPANIES,value.code);
const numeric=value=>Number.isSafeInteger(value)&&value>=0||typeof value==='string'&&/^\d{1,20}$/.test(value);
function exactKeys(value,keys,optional=[]){
  if(!object(value)||keys.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>!keys.includes(key)&&!optional.includes(key)))fail('PACKET','개별 견적서 전달 항목을 확인해주세요.');
}
function canonical(value){
  let count=0;const seen=new Set();
  const visit=(item,depth)=>{
    if(++count>100000||depth>30)fail('JSON_LIMIT','개별 견적서 자료가 너무 큽니다.');
    if(item===null||typeof item==='boolean'||typeof item==='string')return JSON.stringify(item);
    if(typeof item==='number'&&Number.isFinite(item))return JSON.stringify(item);
    if(!item||typeof item!=='object'||seen.has(item))fail('JSON','개별 견적서는 유한한 JSON 값이어야 합니다.');
    seen.add(item);let result;
    if(Array.isArray(item)){
      if(Object.keys(item).length!==item.length)fail('JSON','개별 견적서 배열 항목을 확인해주세요.');
      result='['+item.map(child=>visit(child,depth+1)).join(',')+']';
    }else{
      const proto=Object.getPrototypeOf(item);
      if(proto!==Object.prototype&&proto!==null)fail('JSON','개별 견적서 JSON 객체를 확인해주세요.');
      const keys=Object.keys(item).sort();
      if(keys.some(key=>['__proto__','prototype','constructor','authorization','cookie','password','accessToken','refreshToken'].includes(key)))fail('JSON','인증 자료는 개별 견적서에 포함할 수 없습니다.');
      result='{'+keys.map(key=>JSON.stringify(key)+':'+visit(item[key],depth+1)).join(',')+'}';
    }
    seen.delete(item);return result;
  };
  const result=visit(value,0);if(new TextEncoder().encode(result).length>LIMIT)fail('JSON_LIMIT','개별 견적서 자료가 너무 큽니다.');return result;
}
const clone=value=>JSON.parse(canonical(value));
async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
const safeValue=value=>freeze(clone(value));
const revision=value=>Number.isSafeInteger(value)&&value>=0;

/** A transport packet is deliberately different from the saved-value preview.
 * Schema/projection/image readiness must be established by the app adapter;
 * this receiver never converts private image keys or obtains 1688 content. */
export function validateSingleDocumentPacket(packet,sender){
  exactKeys(packet,['type','format','requestId','ownerId','accountContext','company','productId','profileId','optionId','categoryId','fingerprint','schemaSha256','source','body']);
  let origin;try{const url=new URL(sender?.url);if(url.username||url.password)throw Error();origin=url.origin;}catch{fail('SENDER','앱 출처를 확인하지 못했습니다.');}
  if(!HANDOFF_ORIGINS.includes(origin)||sender?.frameId!==0||!Number.isSafeInteger(sender?.tab?.id)||sender.tab.id<0||!Number.isSafeInteger(sender.tab.windowId)||sender.tab.windowId<0)fail('SENDER','허용된 앱 탭에서만 개별 견적서를 전달할 수 있습니다.');
  if(packet.type!=='YOOFAM_SINGLE_DOCUMENT_TRANSPORT'||packet.format!==SINGLE_DOCUMENT_FORMAT
    ||!['requestId','ownerId','productId','profileId','optionId'].every(key=>typeof packet[key]==='string'&&ID.test(packet[key]))
    ||!['accountContext','fingerprint','schemaSha256'].every(key=>typeof packet[key]==='string'&&HEX.test(packet[key]))
    ||!company(packet.company)||typeof packet.categoryId!=='string'||!/^\d{1,20}$/.test(packet.categoryId))fail('PACKET','개별 견적서의 회원·회사·옵션 식별값을 확인해주세요.');
  exactKeys(packet.source,['productVersion','contentRevision','optionRevision','quotationRevision','profileRevision']);
  if(typeof packet.source.productVersion!=='string'||!Number.isFinite(Date.parse(packet.source.productVersion))
    ||!['contentRevision','optionRevision','quotationRevision'].every(key=>revision(packet.source[key]))
    ||!(packet.source.profileRevision===null||revision(packet.source.profileRevision)))fail('SOURCE','저장한 상품·견적서 버전을 확인해주세요.');
  const body=packet.body;
  exactKeys(body,['docId','productName','categoryPath','categoryId','displayCategoryCode','jsonDocument','scope','productNoticeNumber','version'],['remark']);
  if(body.docId!==null||body.scope!=='Retail_Categorized_Single'||!numeric(body.categoryId)||String(body.categoryId)==='0'
    ||body.displayCategoryCode!==packet.categoryId||!numeric(body.productNoticeNumber)||!numeric(body.version)
    ||typeof body.productName!=='string'||!body.productName.trim()||body.productName.length>500
    ||typeof body.categoryPath!=='string'||!body.categoryPath.endsWith(' ('+packet.categoryId+')')
    ||!Array.isArray(body.jsonDocument)||body.jsonDocument.length!==1||!object(body.jsonDocument[0])
    ||Object.keys(body.jsonDocument[0]).some(key=>!PAGES.includes(key)))fail('DOCUMENT','새 개별 견적서는 선택한 옵션 1개와 정확한 Single 양식이어야 합니다.');
  const start=body.jsonDocument[0].startPage;
  if(!object(start)||start.productName!==body.productName||start.categoryPath!==body.categoryPath
    ||body.remark!==undefined&&typeof body.remark!=='string')fail('DOCUMENT','개별 문서의 상품명·카테고리 연결을 확인해주세요.');
  // Schema defaults are not an action-time human consent. Preserve their
  // original bytes separately and defer only these known agreement flags.
  const image=body.jsonDocument[0].imagePage;
  if(image!==undefined&&!object(image))fail('DOCUMENT','이미지 단계 자료를 확인해주세요.');
  if(image&&['msrpAgree','labelContactAgreed'].some(key=>Object.hasOwn(image,key)&&typeof image[key]!=='boolean'))fail('CONSENT_NOT_DEFERRED','제출 시 동의 선택값을 확인해주세요.');
  const originalBody=clone(body),deferredBody=clone(body);
  for(const key of ['msrpAgree','labelContactAgreed'])if(deferredBody.jsonDocument[0].imagePage&&Object.hasOwn(deferredBody.jsonDocument[0].imagePage,key))deferredBody.jsonDocument[0].imagePage[key]=false;
  return safeValue({...packet,body:deferredBody,originalBody,origin,appTabId:sender.tab.id,windowId:sender.tab.windowId});
}
function identity(packet){
  const keys=['origin','appTabId','windowId','ownerId','accountContext','company','productId','profileId','optionId','categoryId','fingerprint','schemaSha256','source'];
  return Object.fromEntries(keys.map(key=>[key,packet[key]]));
}
export async function singleDocumentIdentity(packet,sender){
  const value=validateSingleDocumentPacket(packet,sender),scope=identity(value),identityDigest=await digest(scope),bodySha256=await digest(value.body),originalBodySha256=await digest(value.originalBody);
  // A second app tab/request ID must not create the same option document again.
  // The checkpoint still records its original app tab/window for strict resume.
  const logical={...scope};delete logical.appTabId;delete logical.windowId;
  const packetDigest=await digest({identity:logical,bodySha256,originalBodySha256});
  const laneKey='single-document-lane:'+await digest(Object.fromEntries(['origin','ownerId','accountContext','company','productId','profileId','optionId'].map(key=>[key,scope[key]])));
  return {packet:value,identity:scope,identityDigest,bodySha256,originalBodySha256,packetDigest,laneKey,key:'single-document:'+packetDigest};
}
export function validateSingleStepResponse(value){
  if(!object(value)||value.code!==200||!Array.isArray(value.data)||value.data.length!==1||!object(value.data[0])||typeof value.data[0].success!=='boolean')fail('VALIDATION_RESPONSE','Supplier Hub 단계 검증 응답을 확인하지 못했습니다.');
  if(value.data[0].success===true){if(value.data[0].errors!==undefined&&(!Array.isArray(value.data[0].errors)||value.data[0].errors.length))fail('VALIDATION_RESPONSE','단계 검증 성공과 오류 항목이 일치하지 않습니다.');return {valid:true,errors:[]};}
  const errors=value.data[0].errors;
  if(errors!==undefined&&(!Array.isArray(errors)||errors.length>200||errors.some(error=>!object(error)||typeof error.columnName!=='string'||typeof error.message!=='string'||error.columnName.length>500||error.message.length>2000)))fail('VALIDATION_RESPONSE','단계 검증 오류 자료를 확인해주세요.');
  return {valid:false,errors:clone(errors??[])};
}
function drafts(value){
  if(!Array.isArray(value)||value.length>10000||value.some(row=>!object(row)||!identifier(row.docId)))fail('DRAFT_LIST','Supplier Hub 중간 저장 목록을 확인하지 못했습니다.');
  const ids=value.map(row=>row.docId);if(new Set(ids.map(canonical)).size!==ids.length)fail('DRAFT_LIST','중간 저장 문서 식별값이 중복되었습니다.');return ids;
}
function responseJson(response){
  if(!object(response)||response.ok!==true||!Number.isSafeInteger(response.status)||response.status<200||response.status>=300||!Object.hasOwn(response,'json'))fail('ACK_UNCERTAIN','Supplier Hub 요청 결과를 확정하지 못했습니다. 읽기로 확인해주세요.');
  return response.json;
}
const withDoc=(packet,docId)=>({...clone(packet.body),docId});
function tabValid(tab,packet){
  return object(tab)&&Number.isSafeInteger(tab.tabId)&&tab.tabId>=0&&tab.windowId===packet.windowId&&tab.origin===SINGLE_DOCUMENT_ORIGIN&&tab.authenticated===true&&same(tab.company,packet.company);
}
function targetValid(target,context,requestId){
  return object(target)&&Object.keys(target).length===5&&Number.isSafeInteger(target.tabId)&&target.tabId>=0&&target.tabId!==context.identity.appTabId
    &&target.windowId===context.identity.windowId&&target.origin===SINGLE_DOCUMENT_ORIGIN&&target.requestId===requestId&&target.packetDigest===context.packetDigest;
}
function checkpointValid(state,context){
  if(!object(state)||state.format!==SINGLE_DOCUMENT_FORMAT||state.key!==context.key||state.laneKey!==context.laneKey||state.packetDigest!==context.packetDigest||state.identityDigest!==context.identityDigest||state.bodySha256!==context.bodySha256||state.originalBodySha256!==context.originalBodySha256
    ||!same(state.identity,context.identity)||!ID.test(state.requestId||'')||!STATES.has(state.state)||!revision(state.sequence)
    ||!Number.isSafeInteger(state.updatedAt)||state.updatedAt<=0||!Array.isArray(state.baselineDocIds)||state.baselineDocIds.some(id=>!identifier(id))
    ||!Array.isArray(state.validatedSteps)||!same(state.validatedSteps,[2,3,4,5].slice(0,state.validatedSteps.length))
    ||state.validatedSteps.length>4||!(state.docId===null||identifier(state.docId))||state.docId!==null&&state.baselineDocIds.some(id=>same(id,state.docId))
    ||state.tab!==null&&!tabValid(state.tab,context.packet)||state.sessionId!==null&&(typeof state.sessionId!=='string'||!ID.test(state.sessionId)))fail('CHECKPOINT','저장한 개별 전송 기록의 연결을 확인해주세요.');
  const beforeTarget=['prepared','target-requested'].includes(state.state),beforeDocument=['prepared','target-requested','target-created'].includes(state.state);
  if(beforeTarget?state.ownedTarget!=null:!targetValid(state.ownedTarget,context,state.requestId))fail('CHECKPOINT','이 전송에서 만든 새 Supplier Hub 탭 기록이 없습니다. 기존 탭은 사용하지 않았습니다.');
  if(beforeDocument?state.tab!==null:!state.tab||state.tab.tabId!==state.ownedTarget.tabId||state.tab.requestId!==state.requestId||state.tab.packetDigest!==context.packetDigest)fail('CHECKPOINT','새 전송 탭과 현재 문서의 연결을 확인해주세요.');
  if(state.state!=='prepared'&&!state.sessionId)fail('CHECKPOINT','개별 전송 회원 세션 기록이 없습니다.');
  if(!['prepared','target-requested','target-created','create-requested'].includes(state.state)&&state.docId===null)fail('CHECKPOINT','새 문서 식별값이 저장되지 않았습니다.');
  if(['target-requested','target-created'].includes(state.state)&&(state.operationId!==state.requestId+':target'||state.docId!==null))fail('CHECKPOINT','새 전송 탭의 원래 생성 요청을 확인해주세요.');
  const stages=state.stageConsents??[];
  if(!Array.isArray(stages)||stages.length>2||stages.some((entry,index)=>!object(entry)||entry.stage!==STAGES[index]||!object(entry.challenge)||entry.challenge.stage!==entry.stage
    ||!same(entry.challenge.docId,state.docId)||entry.challenge.packetDigest!==context.packetDigest||!HEX.test(entry.challenge.id||'')
    ||!Number.isSafeInteger(entry.challenge.issuedAt)||entry.challenge.issuedAt<=0||entry.challenge.expiresAt!==entry.challenge.issuedAt+120000
    ||!Number.isSafeInteger(entry.confirmedAt)||entry.confirmedAt<entry.challenge.issuedAt||entry.confirmedAt>entry.challenge.expiresAt
    ||!Array.isArray(entry.challenge.items)||entry.challenge.items.length!==1||entry.challenge.items[0].key!==STAGE_FLAGS[entry.stage].key||entry.challenge.items[0].id!==STAGE_FLAGS[entry.stage].id
    ||entry.challenge.items[0].required!==true||typeof entry.challenge.items[0].text!=='string'||!entry.challenge.items[0].text.trim()||entry.challenge.items[0].text.length>10000
    ||typeof entry.challenge.items[0].title!=='string'||!entry.challenge.items[0].title.trim()||entry.challenge.items[0].title.length>500||typeof entry.challenge.items[0].termsText!=='string'||!entry.challenge.items[0].termsText.trim()||entry.challenge.items[0].termsText.length>50000))fail('CHECKPOINT','개별 문서의 단계별 동의 기록을 확인해주세요.');
  if(['awaiting-stage-consent','stage-consent-requested','awaiting-consent','consent-requested','submit-requested','pending','accepted','rejected','registered'].includes(state.state)&&state.validatedSteps.length!==4)fail('CHECKPOINT','개별 문서의 단계 검증 기록이 없습니다.');
  if(['awaiting-stage-consent','stage-consent-requested','awaiting-consent','consent-requested','submit-requested'].includes(state.state)&&!object(state.challenge))fail('CHECKPOINT','제출 시 동의 확인 기록이 없습니다.');
  if(state.challenge!==null&&(!object(state.challenge)||!HEX.test(state.challenge.id||'')||!same(state.challenge.docId,state.docId)||state.challenge.packetDigest!==context.packetDigest
    ||!Number.isSafeInteger(state.challenge.issuedAt)||state.challenge.issuedAt<=0||state.challenge.expiresAt!==state.challenge.issuedAt+120000
    ||!Array.isArray(state.challenge.items)||state.challenge.items.length>20||!state.challenge.items.length&&!(state.challenge.stage==='logisticsPage'&&stages.length===2)
    ||state.challenge.items.some(item=>!object(item)||!ID.test(item.key||'')||!ID.test(item.id||'')||typeof item.text!=='string'||!item.text.trim()||typeof item.required!=='boolean')
    ||new Set(state.challenge.items.map(item=>item.key)).size!==state.challenge.items.length||state.challenge.items.length>0&&!state.challenge.items.some(item=>item.required)
    ||state.challenge.stage!==undefined&&!['productPage','imagePage','logisticsPage'].includes(state.challenge.stage)))fail('CHECKPOINT','저장한 동의 확인 항목이 문서와 다릅니다.');
  if(['awaiting-stage-consent','stage-consent-requested'].includes(state.state)&&(!STAGES.includes(state.challenge.stage)||state.challenge.stage!==STAGES[stages.length]
    ||state.challenge.items.length!==1||state.challenge.items[0].key!==STAGE_FLAGS[state.challenge.stage].key||state.challenge.items[0].id!==STAGE_FLAGS[state.challenge.stage].id
    ||typeof state.challenge.items[0].title!=='string'||!state.challenge.items[0].title.trim()||typeof state.challenge.items[0].termsText!=='string'||!state.challenge.items[0].termsText.trim()))fail('CHECKPOINT','현재 단계의 정확한 약관 확인 기록이 없습니다.');
  if(['consent-requested','submit-requested','pending','accepted','rejected','registered'].includes(state.state)
    &&(!state.challenge||!Number.isSafeInteger(state.humanConfirmedAt)||state.humanConfirmedAt<state.challenge.issuedAt||state.humanConfirmedAt>state.challenge.expiresAt))fail('CHECKPOINT','현재 사용자의 제출 확인 기록이 없습니다.');
  if(state.state==='validation-requested'&&(![2,3,4,5].includes(state.requestedStep)||state.requestedStep!==2+state.validatedSteps.length
    ||state.operationId!==state.requestId+':validate:'+state.requestedStep))fail('CHECKPOINT','단계 검증 요청 기록을 확인해주세요.');
  for(const [phase,operation] of [['create-requested','create'],['update-requested','update'],['consent-requested','consent'],['submit-requested','submit']])
    if(state.state===phase&&state.operationId!==state.requestId+':'+operation)fail('CHECKPOINT','원래 문서 요청 기록을 확인해주세요.');
  if(state.state==='stage-consent-requested'&&(state.operationId!==state.requestId+':stage-consent:'+state.challenge.stage||!Number.isSafeInteger(state.humanConfirmedAt)
    ||state.humanConfirmedAt<state.challenge.issuedAt||state.humanConfirmedAt>state.challenge.expiresAt))fail('CHECKPOINT','원래 단계 동의 요청 기록을 확인해주세요.');
  if(['pending','accepted','rejected','registered'].includes(state.state)&&(!receiptValid(state.receipt,state,context,state.updatedAt)||state.receipt.state!==state.state))fail('CHECKPOINT','저장한 접수·SKU 증거를 확인해주세요.');
  if(state.submitRequestedAt!==undefined&&(!['submit-requested','pending','accepted','rejected','registered'].includes(state.state)||!Number.isSafeInteger(state.humanConfirmedAt)
    ||!Number.isSafeInteger(state.submitRequestedAt)||state.submitRequestedAt<state.humanConfirmedAt||state.submitRequestedAt>state.updatedAt))fail('CHECKPOINT','원래 문서의 제출 요청 시각을 확인해주세요.');
  return state;
}
function receiptValid(receipt,state,context,time){
  if(object(receipt)&&receipt.sourceStatus!==undefined){
    const nativeStates={SUBMITTED:'pending',REJECTED:'rejected',FINISHED:'accepted'};
    if(!Object.hasOwn(nativeStates,receipt.sourceStatus)||nativeStates[receipt.sourceStatus]!==receipt.state||receipt.evidence!=='document-receipt'||receipt.registered!==false
      ||!identifier(receipt.qvtRequestId)||!same(receipt.receiptId,receipt.qvtRequestId)||Object.hasOwn(receipt,'skuId')||receipt.observedAt<(state.submitRequestedAt??state.humanConfirmedAt))return false;
  }
  return object(receipt)&&['pending','accepted','rejected','registered'].includes(receipt.state)&&same(receipt.docId,state.docId)&&same(receipt.company,context.packet.company)
    &&receipt.identityDigest===context.identityDigest&&receipt.preparedBodySha256===context.bodySha256&&Number.isSafeInteger(receipt.observedAt)
    &&receipt.observedAt>=state.humanConfirmedAt&&receipt.observedAt<=time+5000&&['document-receipt','document-and-sku'].includes(receipt.evidence)
    &&(receipt.receiptId===undefined||identifier(receipt.receiptId))&&(receipt.skuId===undefined||identifier(receipt.skuId))
    &&(!['accepted','registered'].includes(receipt.state)||identifier(receipt.receiptId))
    &&(receipt.state!=='registered'||receipt.evidence==='document-and-sku'&&identifier(receipt.skuId));
}
function result(state,extra={}){
  return {format:SINGLE_DOCUMENT_FORMAT,requestId:state.requestId,identity:clone(state.identity),identityDigest:state.identityDigest,packetDigest:state.packetDigest,originalBodySha256:state.originalBodySha256,preparedBodySha256:state.bodySha256,state:state.state,
    docId:state.docId,registered:state.state==='registered',success:state.state==='registered',needsRecovery:['target-requested','create-requested','update-requested','validation-requested','stage-consent-requested','consent-requested','submit-requested'].includes(state.state),
    ...(state.challenge&&['awaiting-stage-consent','awaiting-consent'].includes(state.state)?{challenge:clone(state.challenge)}:{}),...(state.receipt?{receipt:clone(state.receipt)}:{}),...extra};
}

/** Explicit adapters only; importing this module performs no browser/network
 * action. Adapter methods must run in the selected authenticated Hub tab.
 * readSource proves CURRENT app identity, schema/projection/image readiness and
 * a local sessionId which changes on logout/owner/context ABA; not a cookie.
 * readDocument/recoverWrite must be actual read evidence, never echo the input.
 * verifyHumanConfirmation is a trusted action-time UI boundary, not packet data.
 * Mutation adapters must repeat tab/company/session/document checks at actual
 * dispatch/click; the core's preceding read cannot make a browser action atomic.
 * All store claim/CAS operations must be atomic and committed before resolving;
 * claim also reserves next.laneKey across packets, except positive rejection. */
export function createSingleDocumentReceiver({adapter,store,now=Date.now}){
  const required=['readSource','createTarget','readTab','hubRequest','readDocument','recoverWrite','readValidation','navigate','readAgreements','verifyHumanConfirmation','confirmAgreements','submit','observeReceipt'];
  if(!adapter||required.some(key=>typeof adapter[key]!=='function')||!store||['get','claim','compareAndSet'].some(key=>typeof store[key]!=='function')||typeof now!=='function')throw new TypeError('Single document adapter/store contract is required.');
  const active=new Set();
  const clock=()=>{const value=now();if(!Number.isSafeInteger(value)||value<=0)fail('CLOCK','전송 시각을 확인하지 못했습니다.');return value;};
  async function get(context){const value=await store.get(context.key);return value===undefined||value===null?null:clone(checkpointValid(value,context));}
  async function save(context,previous,changes){
    const next={...clone(previous),...clone(changes),sequence:previous.sequence+1,updatedAt:clock()};checkpointValid(next,context);
    if(await store.compareAndSet(context.key,safeValue(previous),safeValue(next))!==true)fail('CHECKPOINT_CONFLICT','더 최신 전송 기록이 있습니다. 추가 요청하지 않고 조회해주세요.');return next;
  }
  const call=(name,input)=>adapter[name](safeValue(input));
  async function guard(context,state){
    const proof=await call('readSource',{identity:context.identity,bodySha256:context.originalBodySha256,preparedBodySha256:context.bodySha256,packetDigest:context.packetDigest,requestId:state.requestId,docId:state.docId});
    if(!object(proof)||proof.current!==true||proof.submissionReady!==true||proof.priorDocumentClear!==true||!same(proof.identity,context.identity)||proof.bodySha256!==context.originalBodySha256||typeof proof.sessionId!=='string'||!ID.test(proof.sessionId)
      ||state.sessionId!==null&&proof.sessionId!==state.sessionId)fail('SOURCE_CHANGED','현재 회원·회사·저장한 견적서가 준비한 자료와 다릅니다.');
    if(state.tab||state.ownedTarget){const target=state.tab??state.ownedTarget,tab=await call('readTab',{tab:target,identity:context.identity});if(!tabValid(tab,context.packet)||tab.tabId!==target.tabId)fail('TAB_CHANGED','새 Supplier Hub 탭·회사·로그인 상태가 변경되었습니다.');}
    return proof;
  }
  async function request(context,state,method,path,body){
    await guard(context,state);
    return responseJson(await call('hubRequest',{tab:state.tab,sessionId:state.sessionId,identity:context.identity,requestId:state.requestId,...(state.operationId===undefined?{}:{operationId:state.operationId}),method,path,...(body===undefined?{}:{body})}));
  }
  async function readDocument(context,state,recovery=false,afterConsent=false){
    await guard(context,state);
    const proof=await call(recovery?'recoverWrite':'readDocument',{tab:state.tab,identity:context.identity,identityDigest:context.identityDigest,requestId:state.requestId,
      operationId:state.operationId,operation:recovery?(state.state==='create-requested'?'create':'update'):'readback',docId:state.docId,baselineDocIds:state.baselineDocIds,expectedBody:state.docId===null?context.packet.body:withDoc(context.packet,state.docId)});
    let body=proof?.body;
    if(object(body)&&((state.stageConsents??[]).length||afterConsent)){
      body=clone(body);const page=body.jsonDocument?.[0]?.imagePage;
      const allowed=afterConsent?['msrpAgree','labelContactAgreed']:(state.stageConsents??[]).map(entry=>STAGE_FLAGS[entry.stage].key);
      for(const key of allowed)if(page&&Object.hasOwn(page,key)){
        if(typeof page[key]!=='boolean')fail('READBACK_UNCONFIRMED','동의 항목 이외의 문서 변경을 확인해주세요.');page[key]=false;
      }
    }
    if(!object(proof)||!identifier(proof.docId)||!same(proof.company,context.packet.company)||proof.identityDigest!==context.identityDigest
      ||state.baselineDocIds.some(id=>same(id,proof.docId))||state.docId!==null&&!same(proof.docId,state.docId)
      ||recovery&&(proof.operationId!==state.operationId||proof.readOnly!==true)
      ||!same(body,withDoc(context.packet,proof.docId)))fail('READBACK_UNCONFIRMED','새 문서의 정확한 저장값을 읽기로 확인하지 못했습니다.');
    await guard(context,state);return proof;
  }
  function agreementDescriptor(value,state,context){
    if(!object(value)||!same(value.docId,state.docId)||!same(value.company,context.packet.company)||value.readyForSubmit!==true||!Array.isArray(value.items)||value.items.length>20
      ||!value.items.length&&(state.stageConsents??[]).length!==2)fail('AGREEMENT_REVIEW','현재 개별 등록 화면의 동의 항목을 확인해주세요.');
    const items=value.items;
    if(items.some(item=>!object(item)||!ID.test(item.key||'')||!ID.test(item.id||'')||typeof item.text!=='string'||!item.text.trim()||item.text.length>10000||typeof item.required!=='boolean'||typeof item.checked!=='boolean'
      ||item.enabled!==true)||new Set(items.map(item=>item.key)).size!==items.length||new Set(items.map(item=>item.id)).size!==items.length||items.length>0&&!items.some(item=>item.required))fail('AGREEMENT_REVIEW','동의 문구·선택 항목이 명확하지 않습니다.');
    return items.map(({key,id,text,required})=>({key,id,text,required}));
  }
  function stageDescriptor(value,state,context,stage){
    const flag=STAGE_FLAGS[stage];
    if(!flag||!object(value)||!same(value.docId,state.docId)||!same(value.company,context.packet.company)||value.stage!==stage||value.readyForConsent!==true||!Array.isArray(value.items)||value.items.length!==1)fail('AGREEMENT_REVIEW','현재 단계의 약관 전문을 확인해주세요.');
    const item=value.items[0];
    if(!object(item)||item.key!==flag.key||item.id!==flag.id||item.required!==true||item.enabled!==true||typeof item.checked!=='boolean'
      ||typeof item.text!=='string'||!item.text.trim()||item.text.length>10000||typeof item.title!=='string'||!item.title.trim()||item.title.length>500
      ||typeof item.termsText!=='string'||!item.termsText.trim()||item.termsText.length>50000)fail('AGREEMENT_REVIEW','현재 단계의 정확한 약관·선택 항목을 확인해주세요.');
    return [{key:item.key,id:item.id,text:item.text,required:true,title:item.title,termsText:item.termsText}];
  }
  async function challenge(context,state,stage){
    await guard(context,state);
    const review=await call(stage?'readStageAgreements':'readAgreements',{tab:state.tab,identity:context.identity,docId:state.docId,...(stage?{stage}:{})});
    const items=stage?stageDescriptor(review,state,context,stage):agreementDescriptor(review,state,context),issuedAt=clock();
    if(!stage&&!items.length)stage='logisticsPage';
    return {id:await digest({packetDigest:context.packetDigest,docId:state.docId,sequence:state.sequence,items,issuedAt,...(stage?{stage}:{})}),docId:state.docId,packetDigest:context.packetDigest,items,issuedAt,expiresAt:issuedAt+120000,...(stage?{stage}:{})};
  }
  async function navigation(context,state){
    await guard(context,state);
    await readDocument(context,state);
    const value=await call('navigate',{tab:state.tab,sessionId:state.sessionId,identity:context.identity,docId:state.docId,productName:context.packet.body.productName,version:context.packet.body.version,stageConsents:state.stageConsents??[]});
    return pauseNavigation(context,state,value);
  }
  async function pauseNavigation(context,state,value){
    if(!object(value)||!same(value.docId,state.docId)||!same(value.company,context.packet.company)||value.productName!==context.packet.body.productName)fail('NAVIGATION','새 문서 등록 화면을 확인하지 못했습니다.');
    if(value.readyForConsent===true&&value.readyForSubmit===false){
      const stage=value.stage;
      if(stage!==STAGES[(state.stageConsents??[]).length]||typeof adapter.readStageAgreements!=='function'||typeof adapter.confirmStageAgreements!=='function'
        ||!Object.hasOwn(context.packet.body.jsonDocument[0].imagePage??{},STAGE_FLAGS[stage]?.key))fail('AGREEMENT_REVIEW','현재 단계의 동의와 원문 양식 연결을 확인해주세요.');
      return save(context,state,{state:'awaiting-stage-consent',challenge:await challenge(context,state,stage)});
    }
    if(value.readyForSubmit!==true)fail('NAVIGATION','새 문서 최종 등록 화면을 확인하지 못했습니다.');
    return save(context,state,{state:'awaiting-consent',challenge:await challenge(context,state)});
  }
  async function continuation(context,state){
    if(state.state==='prepared'){
      const proof=await guard(context,state);
      state=await save(context,state,{state:'target-requested',sessionId:proof.sessionId,operationId:state.requestId+':target'});
      await guard(context,state);
      const target=await call('createTarget',{identity:context.identity,requestId:state.requestId,packetDigest:context.packetDigest});
      if(!targetValid(target,context,state.requestId))fail('TAB_CHANGED','이 전송에서 만든 새 Supplier Hub 탭을 확인하지 못했습니다.');
      state=await save(context,state,{state:'target-created',ownedTarget:target});
    }
    if(state.state==='target-created'){
      await guard(context,state);
      const tab=await call('readTab',{identity:context.identity,tab:state.ownedTarget});
      if(!tabValid(tab,context.packet)||tab.tabId!==state.ownedTarget.tabId)fail('TAB_CHANGED','새 Supplier Hub 탭의 회사·로그인 상태를 확인해주세요.');
      const prepared={...state,tab:clone(tab)};await guard(context,prepared);
      const baselineDocIds=drafts(await request(context,prepared,'GET',SINGLE_DOCUMENT_PATHS.drafts));
      state=await save(context,state,{tab,baselineDocIds,state:'create-requested',operationId:state.requestId+':create'});
      const created=await request(context,state,'POST',SINGLE_DOCUMENT_PATHS.create,context.packet.body);
      if(!object(created)||!identifier(created.docId)||created.errorCode!==undefined&&created.errorCode!==null&&created.errorCode!==''||state.baselineDocIds.some(id=>same(id,created.docId)))fail('CREATE_UNCONFIRMED','새 문서 생성 응답의 식별값을 확인하지 못했습니다.');
      state=await save(context,state,{state:'created',docId:created.docId});
    }
    if(state.state==='created'){
      await guard(context,state);state=await save(context,state,{state:'update-requested',operationId:state.requestId+':update'});
      const updated=await request(context,state,'POST',SINGLE_DOCUMENT_PATHS.update,withDoc(context.packet,state.docId));
      if(!object(updated)||updated.errorCode!==undefined&&updated.errorCode!==null&&updated.errorCode!=='')fail('UPDATE_UNCONFIRMED','문서 수정 결과를 확정하지 못했습니다.');
      await readDocument(context,state);state=await save(context,state,{state:'updated'});
    }
    if(state.state==='updated'){
      for(const step of [2,3,4,5].slice(state.validatedSteps.length)){
        await guard(context,state);state=await save(context,state,{state:'validation-requested',operationId:state.requestId+':validate:'+step,requestedStep:step});
        const validated=validateSingleStepResponse(await request(context,state,'POST','/sr/qvt/api/validate-step/'+step,{docId:state.docId,version:context.packet.body.version}));
        if(!validated.valid)return save(context,state,{state:'validation-rejected',validationErrors:validated.errors});
        state=await save(context,state,{state:step===5?'validated':'updated',validatedSteps:[...state.validatedSteps,step]});
      }
    }
    if(state.state==='validated'){
      const ids=drafts(await request(context,state,'GET',SINGLE_DOCUMENT_PATHS.drafts));
      if(ids.filter(id=>same(id,state.docId)).length!==1)fail('DRAFT_NOT_FOUND','방금 생성한 문서가 중간 저장 목록에 정확히 표시되지 않습니다.');
      await readDocument(context,state);state=await save(context,state,{state:'navigation-requested'});
    }
    if(state.state==='navigation-requested')state=await navigation(context,state);
    return state;
  }
  async function operate(packet,sender,action,details){
    const context=await singleDocumentIdentity(packet,sender);
    if(active.has(context.key))return {format:SINGLE_DOCUMENT_FORMAT,requestId:packet.requestId,state:'busy',registered:false,success:false};
    active.add(context.key);let state;
    try{
      state=await get(context);
      if(action==='start'){
        if(state){await guard(context,state);return result(state,{duplicate:true});}
        state={format:SINGLE_DOCUMENT_FORMAT,key:context.key,laneKey:context.laneKey,identity:context.identity,identityDigest:context.identityDigest,bodySha256:context.bodySha256,originalBodySha256:context.originalBodySha256,packetDigest:context.packetDigest,
          requestId:context.packet.requestId,state:'prepared',sequence:0,updatedAt:clock(),docId:null,tab:null,ownedTarget:null,sessionId:null,baselineDocIds:[],validatedSteps:[],stageConsents:[],challenge:null,receipt:null};
        if(await store.claim(context.key,safeValue(state))!==true){state=await get(context);if(!state)fail('CHECKPOINT_CONFLICT','같은 옵션의 다른 개별 전송 기록을 먼저 확인해주세요.');await guard(context,state);return result(state,{duplicate:true});}
        state=await continuation(context,state);return result(state);
      }
      if(!state)fail('CHECKPOINT','먼저 새 개별 전송 요청을 준비해주세요.');
      await guard(context,state);
      if(action==='resume'){
        if(!['prepared','target-created','created','updated','validated','navigation-requested'].includes(state.state))return result(state);
        state=await continuation(context,state);return result(state);
      }
      if(action==='recover'){
        if(state.state==='target-requested')fail('TARGET_UNCONFIRMED','새 탭 생성 응답을 확인하지 못했습니다. 다른 탭을 선택하거나 새 탭을 다시 만들지 않았습니다.');
        if(['create-requested','update-requested'].includes(state.state)){
          const proof=await readDocument(context,state,true);
          state=await save(context,state,{state:state.state==='create-requested'?'created':'updated',docId:proof.docId});
        }else if(state.state==='validation-requested'){
          await guard(context,state);const proof=await call('readValidation',{tab:state.tab,identity:context.identity,docId:state.docId,version:context.packet.body.version,step:state.requestedStep,operationId:state.operationId});
          if(!object(proof)||proof.readOnly!==true||proof.operationId!==state.operationId||!same(proof.docId,state.docId)||!same(proof.company,context.packet.company)||proof.step!==state.requestedStep)fail('READBACK_UNCONFIRMED','이 문서의 원래 단계 검증을 확인하지 못했습니다.');
          const validated=validateSingleStepResponse(proof.response);
          state=await save(context,state,validated.valid?{state:state.requestedStep===5?'validated':'updated',validatedSteps:[...state.validatedSteps,state.requestedStep]}:{state:'validation-rejected',validationErrors:validated.errors});
        }else if(state.state==='stage-consent-requested'){
          if(typeof adapter.recoverStageConsent!=='function')fail('CONSENT_UNCONFIRMED','원래 단계 동의를 읽기로 확인해주세요.');
          const check=state.challenge,proof=await call('recoverStageConsent',{tab:state.tab,sessionId:state.sessionId,identity:context.identity,docId:state.docId,stage:check.stage,challenge:check,operationId:state.operationId});
          if(proof?.readOnly!==true||proof.operationId!==state.operationId||!same(stageDescriptor(proof,state,context,check.stage),check.items)||proof.items.some(item=>!item.checked))fail('CONSENT_UNCONFIRMED','원래 단계의 동의 반영을 확인하지 못했습니다. 다시 선택하지 않았습니다.');
          await guard(context,state);state=await save(context,state,{state:'navigation-requested',stageConsents:[...(state.stageConsents??[]),{stage:check.stage,challenge:check,confirmedAt:state.humanConfirmedAt}]});
        }else if(state.state==='awaiting-stage-consent'){
          state=await save(context,state,{challenge:await challenge(context,state,state.challenge.stage)});
        }else if(state.state==='navigation-requested'){
          await readDocument(context,state);
          if(typeof adapter.readNavigation==='function'){
            const value=await call('readNavigation',{tab:state.tab,identity:context.identity,docId:state.docId,productName:context.packet.body.productName,stageConsents:state.stageConsents??[]});
            state=await pauseNavigation(context,state,value);
          }else state=await save(context,state,{state:'awaiting-consent',challenge:await challenge(context,state)});
        }else if(['consent-requested','awaiting-consent'].includes(state.state)){
          state=await save(context,state,{state:'awaiting-consent',challenge:await challenge(context,state)});
        }else if(['submit-requested','pending','accepted','rejected','registered'].includes(state.state))return await observe(context,state);
        return result(state,{recovered:true});
      }
      if(action==='confirm'){
        if(state.state==='awaiting-stage-consent'){
          const check=state.challenge,time=clock();
          if(!object(details)||details.action!=='confirm-and-continue'||details.stage!==check.stage||details.userInitiated!==true||details.challengeId!==check.id
            ||!Number.isSafeInteger(details.confirmedAt)||details.confirmedAt<check.issuedAt||details.confirmedAt>time+5000||time>check.expiresAt
            ||!Array.isArray(details.approvedKeys)||!same([...details.approvedKeys].sort(),check.items.filter(item=>item.required).map(item=>item.key).sort()))fail('HUMAN_CONFIRMATION','현재 단계 약관을 읽고 직접 확인한 뒤 계속해주세요.');
          await readDocument(context,state);
          const current=await call('readStageAgreements',{tab:state.tab,identity:context.identity,docId:state.docId,stage:check.stage});
          if(!same(stageDescriptor(current,state,context,check.stage),check.items))fail('AGREEMENT_CHANGED','현재 단계 약관이 변경되었습니다. 다시 읽어주세요.');
          const verified=await call('verifyHumanConfirmation',{identity:context.identity,docId:state.docId,challenge:check,confirmation:details});
          if(verified?.confirmed!==true||verified.challengeId!==check.id||verified.identityDigest!==context.identityDigest||clock()>check.expiresAt)fail('HUMAN_CONFIRMATION','현재 단계의 사용자 확인을 검증하지 못했습니다.');
          const confirmedAt=verified.confirmedAt??details.confirmedAt;
          if(!Number.isSafeInteger(confirmedAt)||confirmedAt<check.issuedAt||confirmedAt>check.expiresAt||confirmedAt>clock()+5000)fail('HUMAN_CONFIRMATION','현재 단계 사용자 확인 시각을 검증하지 못했습니다.');
          await guard(context,state);
          const final=await call('readStageAgreements',{tab:state.tab,identity:context.identity,docId:state.docId,stage:check.stage});
          if(!same(stageDescriptor(final,state,context,check.stage),check.items))fail('AGREEMENT_CHANGED','사용자 확인 중 현재 약관이 변경되었습니다.');
          await readDocument(context,state);
          if(clock()>check.expiresAt)fail('HUMAN_CONFIRMATION','현재 단계 약관 확인 시간이 만료됐습니다. 다시 읽어주세요.');
          state=await save(context,state,{state:'stage-consent-requested',operationId:state.requestId+':stage-consent:'+check.stage,humanConfirmedAt:confirmedAt});
          const accepted=await call('confirmStageAgreements',{tab:state.tab,sessionId:state.sessionId,identity:context.identity,docId:state.docId,stage:check.stage,challenge:check,confirmation:details,operationId:state.operationId});
          if(!same(stageDescriptor(accepted,state,context,check.stage),check.items)||accepted.items.some(item=>!item.checked))fail('CONSENT_UNCONFIRMED','원래 단계의 동의 선택 반영을 확인하지 못했습니다.');
          await guard(context,state);state=await save(context,state,{state:'navigation-requested',stageConsents:[...(state.stageConsents??[]),{stage:check.stage,challenge:check,confirmedAt:state.humanConfirmedAt}]});
          state=await continuation(context,state);return result(state);
        }
        if(state.state!=='awaiting-consent')return result(state);
        const check=state.challenge,time=clock();
        if(!object(details)||details.action!=='confirm-and-submit'||details.userInitiated!==true||details.challengeId!==check.id
          ||(check.stage===undefined?details.stage!==undefined:details.stage!==check.stage)
          ||!Number.isSafeInteger(details.confirmedAt)||details.confirmedAt<check.issuedAt||details.confirmedAt>time+5000||time>check.expiresAt
          ||!Array.isArray(details.approvedKeys)||!same([...details.approvedKeys].sort(),check.items.filter(item=>item.required).map(item=>item.key).sort()))fail('HUMAN_CONFIRMATION','현재 동의 문구를 읽고 직접 확인한 뒤 제출해주세요.');
        await guard(context,state);
        const current=await call('readAgreements',{tab:state.tab,identity:context.identity,docId:state.docId});
        if(!same(agreementDescriptor(current,state,context),check.items))fail('AGREEMENT_CHANGED','등록 화면의 동의 항목이 변경되었습니다. 다시 읽어주세요.');
        await readDocument(context,state);
        const verified=await call('verifyHumanConfirmation',{identity:context.identity,docId:state.docId,challenge:check,confirmation:details});
        if(!object(verified)||verified.confirmed!==true||verified.challengeId!==check.id||verified.identityDigest!==context.identityDigest||clock()>check.expiresAt)fail('HUMAN_CONFIRMATION','현재 사용자의 제출 확인을 검증하지 못했습니다.');
        const confirmedAt=verified.confirmedAt??details.confirmedAt;
        if(!Number.isSafeInteger(confirmedAt)||confirmedAt<check.issuedAt||confirmedAt>check.expiresAt||confirmedAt>clock()+5000)fail('HUMAN_CONFIRMATION','현재 제출 확인 시각을 검증하지 못했습니다.');
        await guard(context,state);if(clock()>check.expiresAt)fail('HUMAN_CONFIRMATION','현재 제출 확인 시간이 만료됐습니다. 다시 읽어주세요.');
        state=await save(context,state,{state:'consent-requested',operationId:state.requestId+':consent',humanConfirmedAt:confirmedAt});
        const accepted=await call('confirmAgreements',{tab:state.tab,sessionId:state.sessionId,identity:context.identity,docId:state.docId,challenge:check,confirmation:details});
        if(!same(agreementDescriptor(accepted,state,context),check.items)||accepted.items.some(item=>item.required&&!item.checked))fail('CONSENT_UNCONFIRMED','동의 선택의 반영을 확인하지 못했습니다. 제출하지 않았습니다.');
        await guard(context,state);
        const finalReview=await call('readAgreements',{tab:state.tab,identity:context.identity,docId:state.docId});
        if(!same(agreementDescriptor(finalReview,state,context),check.items)||finalReview.items.some(item=>item.required&&!item.checked))fail('CONSENT_UNCONFIRMED','제출 직전 동의 선택값이 변경되었습니다.');
        await readDocument(context,state,false,true);
        state=await save(context,state,{state:'submit-requested',operationId:state.requestId+':submit',submitRequestedAt:clock()});
        await guard(context,state);
        // submit may lose its ACK; its durable checkpoint is never retried.
        await call('submit',{tab:state.tab,sessionId:state.sessionId,identity:context.identity,docId:state.docId,requestId:state.requestId,operationId:state.operationId,challenge:check,expectedBody:withDoc(context.packet,state.docId)});
        return await observe(context,state);
      }
      if(action==='observe')return await observe(context,state);
      fail('ACTION','개별 견적서 요청 동작을 확인해주세요.');
    }catch(error){
      // The saved requested state wins, including a write whose caller lost
      // its response or checkpoint CAS. Never replay/merge guessed ACKs.
      const failure={code:error instanceof SingleDocumentError?error.code:'ADAPTER_FAILURE',message:error instanceof SingleDocumentError?error.message:'요청 결과를 확정하지 못했습니다. 현재 전송 기록을 조회해주세요.'};
      if(['SOURCE_CHANGED','TAB_CHANGED'].includes(failure.code))return {format:SINGLE_DOCUMENT_FORMAT,requestId:context.packet.requestId,state:'scope-blocked',registered:false,success:false,needsRecovery:false,error:failure};
      const latest=await get(context);if(latest)return result(latest,{error:failure});
      throw error;
    }finally{active.delete(context.key);}
  }
  async function observe(context,state){
    if(!['submit-requested','pending','accepted','rejected','registered'].includes(state.state))return result(state);
    await guard(context,state);
    const receipt=await call('observeReceipt',{tab:state.tab,sessionId:state.sessionId,identity:context.identity,identityDigest:context.identityDigest,preparedBodySha256:context.bodySha256,docId:state.docId,operationId:state.operationId,
      submitRequestedAt:state.submitRequestedAt??state.humanConfirmedAt,expectedBody:withDoc(context.packet,state.docId),baselineDocIds:state.baselineDocIds,previousReceipt:state.receipt});
    if(!receiptValid(receipt,state,context,clock()))fail('RECEIPT_UNCONFIRMED','새 문서와 연결된 실제 접수·SKU 증거를 확인하지 못했습니다.');
    if(state.receipt?.receiptId!==undefined&&(!same(receipt.receiptId,state.receipt.receiptId)||state.state==='accepted'&&receipt.state==='pending'))fail('RECEIPT_CHANGED','원래 확인한 접수 식별값을 다른 관찰로 바꿀 수 없습니다.');
    if(state.state==='registered'&&(receipt.state!=='registered'||!same(receipt.skuId,state.receipt.skuId)))fail('RECEIPT_CHANGED','원래 확인한 등록 식별값을 다른 관찰로 바꿀 수 없습니다.');
    if(state.receipt&&receipt.observedAt<state.receipt.observedAt)fail('RECEIPT_CHANGED','더 오래된 등록 결과를 반영하지 않습니다.');
    await guard(context,state);state=await save(context,state,{state:receipt.state,receipt});return result(state);
  }
  return Object.freeze({start:(packet,sender)=>operate(packet,sender,'start'),resume:(packet,sender)=>operate(packet,sender,'resume'),
    recover:(packet,sender)=>operate(packet,sender,'recover'),confirm:(packet,sender,confirmation)=>operate(packet,sender,'confirm',confirmation),observe:(packet,sender)=>operate(packet,sender,'observe')});
}

/** A separate durable store; no bulk record or original draft is modified.
 * Resolve only after transaction completion, including claim and snapshot CAS. */
export function createSingleDocumentStore(indexedDBApi=globalThis.indexedDB){
  if(!indexedDBApi||typeof indexedDBApi.open!=='function')throw new TypeError('IndexedDB is required for Single document checkpoints.');
  const open=()=>new Promise((resolve,reject)=>{
    const request=indexedDBApi.open('yoofam-single-document-handoff',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('operations');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  async function transact(action,key,expected,next){
    if(typeof key!=='string'||!/^single-document:[a-f0-9]{64}$/.test(key))fail('CHECKPOINT','개별 전송 기록 키를 확인해주세요.');
    const db=await open();
    try{return await new Promise((resolve,reject)=>{
      const transaction=db.transaction('operations',action==='get'?'readonly':'readwrite'),table=transaction.objectStore('operations');let outcome;
      const request=table.get(key);
      request.onsuccess=()=>{
        try{
          const current=request.result;
          if(action==='get')outcome=current;
          else if(action==='claim'){
            outcome=false;
            if(current===undefined){
              if(!/^single-document-lane:[a-f0-9]{64}$/.test(next?.laneKey||''))fail('CHECKPOINT','개별 옵션 전송 기록을 확인해주세요.');
              const lane=table.get(next.laneKey);
              lane.onsuccess=()=>{
                const claim=()=>{table.add(clone(next),key);table.put({key},next.laneKey);outcome=true;};
                if(lane.result===undefined)claim();
                else if(typeof lane.result?.key==='string'){
                  const prior=table.get(lane.result.key);
                  prior.onsuccess=()=>{
                    // A positively rejected prior document stays immutable.
                    // Pending/unknown/accepted records never release a lane.
                    if(['validation-rejected','rejected'].includes(prior.result?.state))claim();
                  };
                }
              };
            }
          }
          else{outcome=current!==undefined&&same(current,expected);if(outcome)table.put(clone(next),key);}
        }catch(error){reject(error);transaction.abort();}
      };
      transaction.oncomplete=()=>resolve(outcome);transaction.onabort=()=>reject(transaction.error??new Error('Single checkpoint transaction aborted.'));
      transaction.onerror=()=>reject(transaction.error??new Error('Single checkpoint transaction failed.'));
    });}finally{db.close();}
  }
  return Object.freeze({get:key=>transact('get',key),claim:(key,value)=>transact('claim',key,null,value),compareAndSet:(key,expected,next)=>transact('cas',key,expected,next)});
}
