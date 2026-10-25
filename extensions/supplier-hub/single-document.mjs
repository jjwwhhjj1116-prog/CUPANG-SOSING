import {HANDOFF_ORIGINS} from './handoff-store.mjs';
import {receiptRejectionDetailsValid} from './rejection-details.mjs';

// Clean-room reconstruction of the recorded Single protocol. The retained
// artifact establishes these paths, not live response schemas or acceptance.
// REA: ev_17ed0cebd00b285e0bc489221547e437d2b3f69d9b636a813eb942a0a2a3a49a.
export const SINGLE_DOCUMENT_FORMAT='yoofam-supplier-hub-single-document-v1';
export const SINGLE_DOCUMENT_ORIGIN='https://supplier.coupang.com';
export const SINGLE_DOCUMENT_PATHS=Object.freeze({create:'/sr/draft/api/create',update:'/sr/draft/api/update',drafts:'/sr/draft/api/drafts'});
const COMPANIES=Object.freeze({A01526306:'유앤채',A01464742:'와이홉'});
const PAGES=['startPage','productPage','imagePage','legalPage','logisticsPage','sourcingPage'];
const STATES=new Set(['prepared','target-requested','target-created','create-requested','created','update-requested','updated','validation-requested','validated','validation-rejected','navigation-requested','navigation-ready','awaiting-stage-consent','stage-consent-requested','awaiting-consent','consent-requested','submit-requested','pending','accepted','rejected','registered']);
const DRAFT_STATES=new Set(['prepared','target-requested','target-created','create-requested','created','update-requested','updated','validation-requested','validated','validation-rejected']);
const PREPARED_LIFECYCLE_STATES=new Set(['navigation-requested','navigation-ready','awaiting-stage-consent','stage-consent-requested','awaiting-consent','consent-requested','submit-requested','pending','accepted','rejected']);
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
  if(!object(state)||state.format!==context.packet.format||state.key!==context.key||state.laneKey!==context.laneKey||state.packetDigest!==context.packetDigest||state.identityDigest!==context.identityDigest||state.bodySha256!==context.bodySha256||state.originalBodySha256!==context.originalBodySha256
    ||!same(state.identity,context.identity)||!ID.test(state.requestId||'')||!STATES.has(state.state)||!revision(state.sequence)
    ||!Number.isSafeInteger(state.updatedAt)||state.updatedAt<=0||!Array.isArray(state.baselineDocIds)||state.baselineDocIds.some(id=>!identifier(id))
    ||!Array.isArray(state.validatedSteps)||!same(state.validatedSteps,[2,3,4,5].slice(0,state.validatedSteps.length))
    ||state.validatedSteps.length>4||!(state.docId===null||identifier(state.docId))||state.docId!==null&&state.baselineDocIds.some(id=>same(id,state.docId))
    ||state.tab!==null&&!tabValid(state.tab,context.packet)||state.sessionId!==null&&(typeof state.sessionId!=='string'||!ID.test(state.sessionId)))fail('CHECKPOINT','저장한 개별 전송 기록의 연결을 확인해주세요.');
  if(state.draftOnly!==undefined&&(state.draftOnly!==true||state.preparedLifecycle!==true&&(!DRAFT_STATES.has(state.state)||state.stageConsents?.length||state.challenge!==null||state.receipt!==null
    ||state.humanConfirmedAt!==undefined||state.submitRequestedAt!==undefined))||state.draftOnly===true&&state.state==='validated'&&state.validatedSteps.length!==4)fail('CHECKPOINT','제출하지 않은 새 초안의 원래 준비 기록을 확인해주세요.');
  if(state.createRetry!==undefined){const retry=state.createRetry;
    if(state.draftOnly!==true||!object(retry)||!['approvedAt,attempt,originalRequestedAt,originalSequence','approvedAt,attempt,originalRequestedAt,originalSequence,resumeUsed'].includes(Object.keys(retry).sort().join(','))||retry.attempt!==1
      ||retry.resumeUsed!==undefined&&retry.resumeUsed!==true
      ||![retry.approvedAt,retry.originalRequestedAt,retry.originalSequence].every(v=>Number.isSafeInteger(v)&&v>0)||retry.originalRequestedAt+60000>retry.approvedAt
      ||retry.approvedAt>state.updatedAt||retry.originalSequence>=state.sequence)fail('CHECKPOINT','원래 생성 요청의 1회 재시도 기록을 확인해주세요.');
  }
  if(state.preparedLifecycle!==undefined||state.preparationOrigin!==undefined){const origin=state.preparationOrigin;
    if(state.preparedLifecycle!==true||state.draftOnly!==true||!PREPARED_LIFECYCLE_STATES.has(state.state)||state.validatedSteps.length!==4
      ||!object(origin)||Object.keys(origin).sort().join(',')!=='preparedCheckpointSequence,qualifiedAt,qualifiedCheckpointSequence'||!Number.isSafeInteger(origin.preparedCheckpointSequence)||origin.preparedCheckpointSequence<1
      ||origin.qualifiedCheckpointSequence!==origin.preparedCheckpointSequence+1||origin.qualifiedCheckpointSequence>state.sequence||!Number.isSafeInteger(origin.qualifiedAt)||origin.qualifiedAt<1||origin.qualifiedAt>state.updatedAt)fail('CHECKPOINT','원래 새 초안의 단계 확인 연결을 검증하지 못했습니다.');
  }
  const beforeTarget=['prepared','target-requested'].includes(state.state),beforeDocument=['prepared','target-requested','target-created'].includes(state.state);
  if(beforeTarget?state.ownedTarget!=null:!targetValid(state.ownedTarget,context,state.requestId))fail('CHECKPOINT','이 전송에서 만든 새 Supplier Hub 탭 기록이 없습니다. 기존 탭은 사용하지 않았습니다.');
  if(beforeDocument?state.tab!==null:!state.tab||state.tab.tabId!==state.ownedTarget.tabId||state.tab.requestId!==state.requestId||state.tab.packetDigest!==context.packetDigest)fail('CHECKPOINT','새 전송 탭과 현재 문서의 연결을 확인해주세요.');
  if(state.state!=='prepared'&&!state.sessionId)fail('CHECKPOINT','개별 전송 회원 세션 기록이 없습니다.');
  if(!['prepared','target-requested','target-created','create-requested'].includes(state.state)&&state.docId===null)fail('CHECKPOINT','새 문서 식별값이 저장되지 않았습니다.');
  if(['target-requested','target-created'].includes(state.state)&&(state.operationId!==state.requestId+':target'||state.docId!==null))fail('CHECKPOINT','새 전송 탭의 원래 생성 요청을 확인해주세요.');
  const stages=state.stageConsents??[];
  if(state.state==='navigation-ready'&&(state.preparedLifecycle!==true||!stages.length||state.challenge!==null||state.receipt!==null||state.submitRequestedAt!==undefined))fail('CHECKPOINT','원래 새 문서의 아직 요청하지 않은 다음 단계를 확인해주세요.');
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
  if(state.state==='validation-rejected'&&(![2,3,4,5].includes(state.requestedStep)||state.requestedStep!==2+state.validatedSteps.length
    ||state.operationId!==state.requestId+':validate:'+state.requestedStep||state.sequence<1
    ||!Array.isArray(state.validationErrors)||state.validationErrors.length>200||state.validationErrors.some(error=>!object(error)||typeof error.columnName!=='string'||error.columnName.length>500||typeof error.message!=='string'||error.message.length>2000)
    ||stages.length!==0||state.challenge!==null||state.receipt!==null||state.humanConfirmedAt!==undefined||state.submitRequestedAt!==undefined))fail('CHECKPOINT','제출 전 단계 검증 반려 기록을 확인해주세요.');
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
  // A whole-product document receipt is not a scalar catalog SKU join. Keep
  // this document-level contract distinct until every member is proven.
  if(Array.isArray(context.identity.members)&&(!object(receipt)||receipt.sourceStatus===undefined||receipt.state==='registered'||Object.hasOwn(receipt,'skuId')))return false;
  if(object(receipt)&&receipt.sourceStatus!==undefined){
    const nativeStates={SUBMITTED:'pending',REJECTED:'rejected',FINISHED:'accepted'};
    if(!Object.hasOwn(nativeStates,receipt.sourceStatus)||nativeStates[receipt.sourceStatus]!==receipt.state||receipt.evidence!=='document-receipt'||receipt.registered!==false
      ||!identifier(receipt.qvtRequestId)||!same(receipt.receiptId,receipt.qvtRequestId)||Object.hasOwn(receipt,'skuId')||receipt.observedAt<(state.submitRequestedAt??state.humanConfirmedAt))return false;
  }
  return object(receipt)&&receiptRejectionDetailsValid(receipt)&&['pending','accepted','rejected','registered'].includes(receipt.state)&&same(receipt.docId,state.docId)&&same(receipt.company,context.packet.company)
    &&receipt.identityDigest===context.identityDigest&&receipt.preparedBodySha256===context.bodySha256&&Number.isSafeInteger(receipt.observedAt)
    &&receipt.observedAt>=state.humanConfirmedAt&&receipt.observedAt<=time+5000&&['document-receipt','document-and-sku'].includes(receipt.evidence)
    &&(receipt.receiptId===undefined||identifier(receipt.receiptId))&&(receipt.skuId===undefined||identifier(receipt.skuId))
    &&(!['accepted','registered'].includes(receipt.state)||identifier(receipt.receiptId))
    &&(receipt.state!=='registered'||receipt.evidence==='document-and-sku'&&identifier(receipt.skuId));
}
/** Preview may recover only the ID/session from this original durable native
 * operation. No page-supplied ID, lane claim, checkpoint save or Hub call. */
export async function readPreparedDocumentPreviewCheckpoint(context,store){
  if(!object(context)||context.packet?.format!=='yoofam-supplier-hub-product-document-v1'||!Array.isArray(context.identity?.members)||typeof store?.get!=='function')fail('CHECKPOINT','원래 전체 상품 문서의 읽기 확인 범위를 확인해주세요.');
  const value=await store.get(context.key);if(value===undefined||value===null)return null;
  const state=checkpointValid(clone(value),context);
  if(state.draftOnly!==true||state.requestId!==context.packet.requestId)fail('CHECKPOINT_MODE','원래 준비한 새 문서의 같은 요청만 읽기로 확인할 수 있습니다.');
  return state.docId===null?null:Object.freeze({docId:state.docId,sessionId:state.sessionId,...(state.preparedLifecycle===true&&state.submitRequestedAt!==undefined?{submitRequestedAt:state.submitRequestedAt}:{})});
}
function result(state,extra={}){
  return {format:state.format,requestId:state.requestId,identity:clone(state.identity),identityDigest:state.identityDigest,packetDigest:state.packetDigest,originalBodySha256:state.originalBodySha256,preparedBodySha256:state.bodySha256,state:state.state,
    docId:state.docId,registered:state.state==='registered',success:state.state==='registered',needsRecovery:['target-requested','create-requested','update-requested','validation-requested','stage-consent-requested','consent-requested','submit-requested'].includes(state.state)||state.preparedLifecycle===true&&state.state==='navigation-requested',
    ...(state.challenge&&['awaiting-stage-consent','awaiting-consent'].includes(state.state)?{challenge:clone(state.challenge)}:{}),...(state.receipt?{receipt:clone(state.receipt)}:{}),
    ...(Array.isArray(state.identity.members)&&state.state==='validation-rejected'?{validationRejection:{evidence:'document-validation-rejection',operationId:state.operationId,step:state.requestedStep,
      validatedSteps:clone(state.validatedSteps),checkpointSequence:state.sequence,rejectedAt:state.updatedAt,submitted:false,consented:false,
      errors:state.validationErrors.map(({columnName,message})=>({columnName,message}))}}:{}),
    ...(state.draftOnly===true?state.preparedLifecycle===true?{draftOnly:true,preparedLifecycle:true,lifecycleProof:{evidence:'native-prepared-draft-lifecycle',...clone(state.preparationOrigin),checkpointSequence:state.sequence,observedAt:state.updatedAt,validatedSteps:clone(state.validatedSteps),
      consentRequested:Boolean(state.stageConsents?.length||state.humanConfirmedAt!==undefined),submitRequested:state.submitRequestedAt!==undefined}}:{draftOnly:true,draftProof:{evidence:'document-draft-preparation',validatedSteps:clone(state.validatedSteps),checkpointSequence:state.sequence,observedAt:state.updatedAt,submitted:false,consented:false,...(state.createRetry?{createRetryApproved:true}:{})}}:{}),...extra};
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
export function createSingleDocumentReceiver(options){
  return createSupplierHubDocumentReceiver(options,{format:SINGLE_DOCUMENT_FORMAT,identity:singleDocumentIdentity});
}

/** The transport contract is supplied by trusted extension modules, never by
 * packet data. Legacy single-option validation remains its original wrapper.
 * Both wrappers share durable write/recovery/consent handling below. */
export function createSupplierHubDocumentReceiver({adapter,store,now=Date.now},contract){
  if(!object(contract)||Object.keys(contract).some(key=>!['format','identity','draftOnly','nativeLifecycle'].includes(key))||typeof contract.format!=='string'||!contract.format||typeof contract.identity!=='function'
    ||Object.hasOwn(contract,'draftOnly')&&contract.draftOnly!==true||Object.hasOwn(contract,'nativeLifecycle')&&(contract.nativeLifecycle!==true||contract.draftOnly!==true))throw new TypeError('A trusted document transport contract is required.');
  const draftOnly=contract.draftOnly===true,nativeLifecycle=contract.nativeLifecycle===true;
  const required=['readSource','createTarget','readTab','hubRequest','readDocument','recoverWrite','readValidation','navigate','readAgreements','verifyHumanConfirmation','confirmAgreements','submit','observeReceipt'];
  if(!adapter||required.some(key=>typeof adapter[key]!=='function')||nativeLifecycle&&typeof adapter.qualifyPreparedDraft!=='function'||!store||['get','claim','compareAndSet'].some(key=>typeof store[key]!=='function')||typeof now!=='function')throw new TypeError('Single document adapter/store contract is required.');
  const active=new Set();
  const clock=()=>{const value=now();if(!Number.isSafeInteger(value)||value<=0)fail('CLOCK','전송 시각을 확인하지 못했습니다.');return value;};
  async function get(context){const value=await store.get(context.key);if(value===undefined||value===null)return null;const state=clone(checkpointValid(value,context));
    if((state.draftOnly===true)!==draftOnly||draftOnly&&state.requestId!==context.packet.requestId||state.preparedLifecycle===true&&!nativeLifecycle)fail('CHECKPOINT_MODE','원래 새 초안 준비 요청과 같은 기록에서만 계속 확인해주세요.');return state;}
  async function save(context,previous,changes){
    const next={...clone(previous),...clone(changes),sequence:previous.sequence+1,updatedAt:clock()};checkpointValid(next,context);
    if(await store.compareAndSet(context.key,safeValue(previous),safeValue(next))!==true)fail('CHECKPOINT_CONFLICT','더 최신 전송 기록이 있습니다. 추가 요청하지 않고 조회해주세요.');return next;
  }
  const call=(name,input)=>adapter[name](safeValue(input));
  async function guard(context,state,readOnlyReceipt=false){
    if(readOnlyReceipt&&(!nativeLifecycle||state.preparedLifecycle!==true||state.submitRequestedAt===undefined))fail('CHECKPOINT_MODE','이미 제출한 원래 새 문서의 읽기 확인 범위를 확인해주세요.');
    const proof=await call('readSource',{identity:context.identity,bodySha256:context.originalBodySha256,preparedBodySha256:context.bodySha256,packetDigest:context.packetDigest,requestId:state.requestId,docId:state.docId,
      ...(readOnlyReceipt?{receiptRecovery:{sessionId:state.sessionId,submitRequestedAt:state.submitRequestedAt}}:{})});
    if(!object(proof)||proof.current!==true||proof.submissionReady!==true||proof.priorDocumentClear!==true||!same(proof.identity,context.identity)||proof.bodySha256!==context.originalBodySha256||typeof proof.sessionId!=='string'||!ID.test(proof.sessionId)
      ||!readOnlyReceipt&&state.sessionId!==null&&proof.sessionId!==state.sessionId)fail('SOURCE_CHANGED','현재 회원·회사·저장한 견적서가 준비한 자료와 다릅니다.');
    if(state.tab||state.ownedTarget){const target=state.tab??state.ownedTarget,tab=await call('readTab',{tab:target,identity:context.identity});if(!tabValid(tab,context.packet)||tab.tabId!==target.tabId)fail('TAB_CHANGED','새 Supplier Hub 탭·회사·로그인 상태가 변경되었습니다.');}
    return proof;
  }
  async function request(context,state,method,path,body){
    try{await guard(context,state);}catch(error){
      // The adapter has not been called here: a failed final source/tab guard
      // is positive local proof that create was never dispatched. Preserve
      // the operation and owned target, but do not leave a false uncertain
      // write checkpoint. Errors after calling the adapter remain unresolved.
      if(method==='POST'&&path===SINGLE_DOCUMENT_PATHS.create&&state.state==='create-requested'&&state.docId===null)
        await save(context,state,{state:'target-created',tab:null,operationId:state.requestId+':target'});
      throw error;
    }
    try{return responseJson(await call('hubRequest',{tab:state.tab,sessionId:state.sessionId,identity:context.identity,requestId:state.requestId,...(state.operationId===undefined?{}:{operationId:state.operationId}),method,path,...(body===undefined?{}:{body}),
      ...(method==='POST'&&path===SINGLE_DOCUMENT_PATHS.create?{baselineDocIds:clone(state.baselineDocIds)}:{}),
      ...(state.createRetry&&method==='POST'&&path===SINGLE_DOCUMENT_PATHS.create?{retryCreateApproval:clone(state.createRetry)}:{})}));}
    catch(error){
      if(error instanceof SingleDocumentError&&error.code==='CREATE_RETRY_PRECHECK_NOT_SENT'&&state.createRetry&&method==='POST'&&path===SINGLE_DOCUMENT_PATHS.create&&state.state==='create-requested'&&state.docId===null)
        await save(context,state,{state:'target-created',tab:null,operationId:state.requestId+':target'});
      throw error;
    }
  }
  async function readDocument(context,state,recovery=false,afterConsent=false){
    await guard(context,state);
    const proof=await call(recovery?'recoverWrite':'readDocument',{tab:state.tab,identity:context.identity,identityDigest:context.identityDigest,requestId:state.requestId,
      operationId:state.operationId,operation:recovery?(state.state==='create-requested'?'create':'update'):'readback',docId:state.docId,baselineDocIds:state.baselineDocIds,expectedBody:state.docId===null?context.packet.body:withDoc(context.packet,state.docId)});
    let body=proof?.body;
    if(object(body)&&((state.stageConsents??[]).length||afterConsent)){
      body=clone(body);
      if(!Array.isArray(body.jsonDocument))fail('READBACK_UNCONFIRMED','동의 이후의 전체 옵션 문서 배열을 확인해주세요.');
      const allowed=afterConsent?['msrpAgree','labelContactAgreed']:(state.stageConsents??[]).map(entry=>STAGE_FLAGS[entry.stage].key);
      for(const document of body.jsonDocument??[])for(const key of allowed){const page=document?.imagePage;if(page&&Object.hasOwn(page,key)){
        if(typeof page[key]!=='boolean')fail('READBACK_UNCONFIRMED','동의 항목 이외의 문서 변경을 확인해주세요.');page[key]=false;
      }}
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
    if(value.readyForContinue===true){
      if(!nativeLifecycle||state.preparedLifecycle!==true||value.readyForSubmit!==false||value.readyForConsent!==false||value.stage!==state.stageConsents.at(-1)?.stage)fail('NAVIGATION','원래 단계의 미요청 다음 동작을 확인하지 못했습니다.');
      return save(context,state,{state:'navigation-ready',challenge:null});
    }
    if(value.readyForConsent===true&&value.readyForSubmit===false){
      const stage=value.stage;
      if(stage!==STAGES[(state.stageConsents??[]).length]||typeof adapter.readStageAgreements!=='function'||typeof adapter.confirmStageAgreements!=='function'
        ||!context.packet.body.jsonDocument.every(document=>Object.hasOwn(document.imagePage??{},STAGE_FLAGS[stage]?.key)))fail('AGREEMENT_REVIEW','현재 단계의 동의와 원문 양식 연결을 확인해주세요.');
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
        state=await save(context,state,{state:step===5&&!draftOnly?'validated':'updated',validatedSteps:[...state.validatedSteps,step]});
      }
      if(draftOnly&&state.validatedSteps.length===4)return verifyDraft(context,state);
    }
    if(state.state==='validated'){
      if(draftOnly&&!state.preparedLifecycle){await verifyDraft(context,state);return state;}
      const ids=drafts(await request(context,state,'GET',SINGLE_DOCUMENT_PATHS.drafts));
      if(ids.filter(id=>same(id,state.docId)).length!==1)fail('DRAFT_NOT_FOUND','방금 생성한 문서가 중간 저장 목록에 정확히 표시되지 않습니다.');
      await readDocument(context,state);state=await save(context,state,{state:'navigation-requested'});
    }
    if(state.state==='navigation-requested')state=await navigation(context,state);
    return state;
  }
  async function verifyDraft(context,state){
    const ids=drafts(await request(context,state,'GET',SINGLE_DOCUMENT_PATHS.drafts));
    if(ids.filter(id=>same(id,state.docId)).length!==1)fail('DRAFT_NOT_FOUND','방금 생성한 문서가 중간 저장 목록에 정확히 표시되지 않습니다.');
    await readDocument(context,state);
    return state.state==='validated'?state:save(context,state,{state:'validated'});
  }
  async function qualifyPrepared(context,state){
    await guard(context,state);await readDocument(context,state);
    const ids=drafts(await request(context,state,'GET',SINGLE_DOCUMENT_PATHS.drafts));if(ids.filter(id=>same(id,state.docId)).length!==1)fail('DRAFT_NOT_FOUND','원래 새 초안이 저장 목록에 정확히 표시되지 않습니다.');
    const proof=await call('qualifyPreparedDraft',{tab:state.tab,sessionId:state.sessionId,identity:context.identity,docId:state.docId});
    if(!object(proof)||proof.readOnly!==true||!same(proof.docId,state.docId)||!same(proof.company,context.packet.company)||proof.identityDigest!==context.identityDigest||proof.packetDigest!==context.packetDigest
      ||proof.sourcePlanSha256!==context.identity.fingerprint||proof.metadataObserved!==true||!Number.isSafeInteger(proof.checkedAt)||Math.abs(clock()-proof.checkedAt)>60000)fail('NATIVE_PREPARED_UNCONFIRMED','현재 새 초안의 원본 파일·문서 연결을 확인하지 못했습니다.');
    await guard(context,state);await readDocument(context,state);
  }
  async function operate(packet,sender,action,details){
    const context=await contract.identity(packet,sender,action);
    if(!object(context)||context.packet?.format!==contract.format)fail('PACKET','요청한 문서 전송 형식과 검증한 자료가 다릅니다.');
    if(active.has(context.key))return {format:context.packet.format,requestId:packet.requestId,state:'busy',registered:false,success:false};
    active.add(context.key);let state;
    try{
      state=await get(context);
      if(state?.preparedLifecycle&&['prepareDraft','recoverDraft'].includes(action))fail('CHECKPOINT_MODE','등록 단계 확인을 시작한 원래 새 초안의 결과를 조회해주세요.');
      if(action==='start'||draftOnly&&action==='prepareDraft'){
        if(state){await guard(context,state);
          if(draftOnly&&['prepared','target-created','created','updated','validated'].includes(state.state))state=await continuation(context,state);
          return result(state,{duplicate:true});}
        state={format:context.packet.format,key:context.key,laneKey:context.laneKey,identity:context.identity,identityDigest:context.identityDigest,bodySha256:context.bodySha256,originalBodySha256:context.originalBodySha256,packetDigest:context.packetDigest,
          requestId:context.packet.requestId,state:'prepared',sequence:0,updatedAt:clock(),docId:null,tab:null,ownedTarget:null,sessionId:null,baselineDocIds:[],validatedSteps:[],stageConsents:[],challenge:null,receipt:null,...(draftOnly?{draftOnly:true}:{})};
        if(await store.claim(context.key,safeValue(state))!==true){state=await get(context);if(!state)fail('CHECKPOINT_CONFLICT','같은 옵션의 다른 개별 전송 기록을 먼저 확인해주세요.');await guard(context,state);return result(state,{duplicate:true});}
        state=await continuation(context,state);return result(state);
      }
      if(!state)fail('CHECKPOINT','먼저 새 개별 전송 요청을 준비해주세요.');
      const readOnlyReceipt=nativeLifecycle&&state.preparedLifecycle===true&&state.submitRequestedAt!==undefined&&['recoverPreparedDraft','observePreparedDraft'].includes(action);
      await guard(context,state,readOnlyReceipt);
      if(action==='retryCreateDraft'||action==='resumeCreateRetryDraft'){
        if(!nativeLifecycle||!draftOnly||state.preparedLifecycle||state.state!=='create-requested'||state.docId!==null
          ||action==='retryCreateDraft'&&(state.createRetry!==undefined||state.updatedAt+60000>clock())
          ||action==='resumeCreateRetryDraft'&&(!state.createRetry||state.createRetry.resumeUsed!==undefined))fail('CREATE_RETRY_SCOPE','문서번호가 없는 원래 새 초안에 승인된 1회 재시도만 허용됩니다. 저장 결과를 다시 조회해주세요.');
        state=await save(context,state,{createRetry:action==='resumeCreateRetryDraft'?{...state.createRetry,resumeUsed:true}:{attempt:1,originalRequestedAt:state.updatedAt,originalSequence:state.sequence,approvedAt:clock()}});
        const created=await request(context,state,'POST',SINGLE_DOCUMENT_PATHS.create,context.packet.body);
        if(!object(created)||!identifier(created.docId)||state.baselineDocIds.some(id=>same(id,created.docId)))fail('CREATE_UNCONFIRMED','재시도 생성 결과를 확인하지 못했습니다. 같은 요청의 저장 결과만 조회해주세요.');
        state=await save(context,state,{state:'created',docId:created.docId});return result(state,{recovered:true});
      }
      if(nativeLifecycle&&['reviewPreparedDraft','confirmPreparedDraft','recoverPreparedDraft','observePreparedDraft'].includes(action)){
        if(action==='reviewPreparedDraft'){
          if(state.preparedLifecycle){
            if(state.state!=='navigation-ready')return result(state,{duplicate:true});
            await qualifyPrepared(context,state);state=await save(context,state,{state:'navigation-requested'});state=await navigation(context,state);return result(state);
          }
          if(state.state!=='validated'||state.validatedSteps.length!==4)fail('NATIVE_PREPARED_UNCONFIRMED','먼저 원래 새 초안의 네 단계 저장·검증을 모두 확인해주세요.');
          await qualifyPrepared(context,state);
          state=await save(context,state,{state:'navigation-requested',preparedLifecycle:true,preparationOrigin:{preparedCheckpointSequence:state.sequence,qualifiedCheckpointSequence:state.sequence+1,qualifiedAt:clock()}});
          state=await navigation(context,state);return result(state);
        }
        if(!state.preparedLifecycle){
          if(action!=='recoverPreparedDraft')fail('CHECKPOINT_MODE','원래 새 초안의 단계 확인 기록을 조회해주세요.');
          if(state.state==='validated'&&state.validatedSteps.length===4)await qualifyPrepared(context,state);
          action='recoverDraft';
        }else{
          if(action==='confirmPreparedDraft'&&['awaiting-stage-consent','awaiting-consent'].includes(state.state))await qualifyPrepared(context,state);
          action={confirmPreparedDraft:'confirm',recoverPreparedDraft:'recover',observePreparedDraft:'observe'}[action];
        }
      }
      if(draftOnly&&!state.preparedLifecycle){
        if(action!=='recoverDraft')fail('ACTION','새 초안 준비의 읽기 확인 동작을 확인해주세요.');
        if(state.state==='target-requested')fail('TARGET_UNCONFIRMED','새 탭 생성 응답을 확인하지 못했습니다. 새 탭을 다시 만들지 않았습니다.');
        if(['create-requested','update-requested'].includes(state.state)){
          if(state.state==='create-requested'&&state.createRetry?.resumeUsed===true&&typeof adapter.inspectCreateRetry==='function'){
            const inspected=await call('inspectCreateRetry',{tab:state.tab,sessionId:state.sessionId,identity:context.identity,requestId:state.requestId,operationId:state.operationId,
              docId:null,expectedBody:context.packet.body,baselineDocIds:state.baselineDocIds,createRetryApproval:state.createRetry});
            if(inspected!==null){
              if(!object(inspected)||inspected.format!=='yoofam-create-retry-precheck-v1'||inspected.requestId!==state.requestId||inspected.operationId!==state.operationId
                ||inspected.packetDigest!==context.packetDigest||inspected.identityDigest!==context.identityDigest||inspected.preparedBodySha256!==context.bodySha256
                ||inspected.markerAbsent!==true||inspected.baselineMatched!==true||inspected.duplicateMatches!==0||inspected.remoteWrites!==false||!Number.isSafeInteger(inspected.checkedAt)||Math.abs(clock()-inspected.checkedAt)>60000)
                fail('CREATE_RETRY_INSPECTION_BLOCKED','원래 승인된 생성 확인의 출처·본문 연결이 다릅니다.');
              await guard(context,state);state=await save(context,state,{state:'target-created',tab:null,operationId:state.requestId+':target'});return result(state,{recovered:true});
            }
          }
          const proof=await readDocument(context,state,true);state=await save(context,state,{state:state.state==='create-requested'?'created':'updated',docId:proof.docId});
        }else if(state.state==='validation-requested'){
          const proof=await call('readValidation',{tab:state.tab,identity:context.identity,docId:state.docId,version:context.packet.body.version,step:state.requestedStep,operationId:state.operationId});
          if(!object(proof)||proof.readOnly!==true||proof.operationId!==state.operationId||!same(proof.docId,state.docId)||!same(proof.company,context.packet.company)||proof.step!==state.requestedStep)fail('READBACK_UNCONFIRMED','원래 초안 단계의 검증 결과를 확인하지 못했습니다.');
          const validated=validateSingleStepResponse(proof.response);
          state=await save(context,state,validated.valid?{state:'updated',validatedSteps:[...state.validatedSteps,state.requestedStep]}:{state:'validation-rejected',validationErrors:validated.errors});
        }
        if(['updated','validated'].includes(state.state)&&state.validatedSteps.length===4)state=await verifyDraft(context,state);
        else if(state.docId!==null)await readDocument(context,state);
        return result(state,{recovered:true});
      }
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
        }else if(state.state==='navigation-requested'||nativeLifecycle&&state.state==='navigation-ready'){
          await readDocument(context,state);
          if(typeof adapter.readNavigation==='function'){
            const value=await call('readNavigation',{tab:state.tab,identity:context.identity,docId:state.docId,productName:context.packet.body.productName,stageConsents:state.stageConsents??[]});
            state=await pauseNavigation(context,state,value);
          }else state=await save(context,state,{state:'awaiting-consent',challenge:await challenge(context,state)});
        }else if(['consent-requested','awaiting-consent'].includes(state.state)){
          state=await save(context,state,{state:'awaiting-consent',challenge:await challenge(context,state)});
        }else if(['submit-requested','pending','accepted','rejected','registered'].includes(state.state)){const observed=await observe(context,state,readOnlyReceipt);return nativeLifecycle?{...observed,recovered:true}:observed;}
        if(nativeLifecycle&&state.preparedLifecycle&&state.state==='navigation-requested'){
          await readDocument(context,state);state=await pauseNavigation(context,state,await call('readNavigation',{tab:state.tab,identity:context.identity,docId:state.docId,productName:context.packet.body.productName,stageConsents:state.stageConsents??[]}));
        }
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
      if(action==='observe')return await observe(context,state,readOnlyReceipt);
      fail('ACTION','개별 견적서 요청 동작을 확인해주세요.');
    }catch(error){
      // The saved requested state wins, including a write whose caller lost
      // its response or checkpoint CAS. Never replay/merge guessed ACKs.
      const failure={code:error instanceof SingleDocumentError?error.code:'ADAPTER_FAILURE',message:error instanceof SingleDocumentError?error.message:'요청 결과를 확정하지 못했습니다. 현재 전송 기록을 조회해주세요.'};
      if(['SOURCE_CHANGED','TAB_CHANGED'].includes(failure.code))return {format:context.packet.format,requestId:context.packet.requestId,state:'scope-blocked',registered:false,success:false,needsRecovery:false,error:failure};
      const latest=await get(context);if(latest)return result(latest,{error:failure});
      throw error;
    }finally{active.delete(context.key);}
  }
  async function observe(context,state,readOnlyReceipt=false){
    if(!['submit-requested','pending','accepted','rejected','registered'].includes(state.state))return result(state);
    await guard(context,state,readOnlyReceipt);
    const receipt=await call('observeReceipt',{tab:state.tab,sessionId:state.sessionId,identity:context.identity,identityDigest:context.identityDigest,preparedBodySha256:context.bodySha256,docId:state.docId,operationId:state.operationId,
      submitRequestedAt:state.submitRequestedAt??state.humanConfirmedAt,expectedBody:withDoc(context.packet,state.docId),baselineDocIds:state.baselineDocIds,previousReceipt:state.receipt});
    if(!receiptValid(receipt,state,context,clock()))fail('RECEIPT_UNCONFIRMED','새 문서와 연결된 실제 접수·SKU 증거를 확인하지 못했습니다.');
    if(state.receipt?.receiptId!==undefined&&(!same(receipt.receiptId,state.receipt.receiptId)||state.state==='accepted'&&receipt.state==='pending'))fail('RECEIPT_CHANGED','원래 확인한 접수 식별값을 다른 관찰로 바꿀 수 없습니다.');
    if(context.packet.format!==SINGLE_DOCUMENT_FORMAT&&state.state==='rejected'&&receipt.state!=='rejected')fail('RECEIPT_CHANGED','원래 전체 상품 문서의 반려 결과를 다른 상태로 바꿀 수 없습니다.');
    if(state.state==='registered'&&(receipt.state!=='registered'||!same(receipt.skuId,state.receipt.skuId)))fail('RECEIPT_CHANGED','원래 확인한 등록 식별값을 다른 관찰로 바꿀 수 없습니다.');
    if(state.receipt&&receipt.observedAt<state.receipt.observedAt)fail('RECEIPT_CHANGED','더 오래된 등록 결과를 반영하지 않습니다.');
    await guard(context,state,readOnlyReceipt);state=await save(context,state,{state:receipt.state,receipt});return result(state);
  }
  if(draftOnly)return Object.freeze({prepareDraft:(packet,sender)=>operate(packet,sender,'prepareDraft'),recoverDraft:(packet,sender)=>operate(packet,sender,'recoverDraft'),...(nativeLifecycle?{
    retryCreateDraft:(packet,sender)=>operate(packet,sender,'retryCreateDraft'),
    resumeCreateRetryDraft:(packet,sender)=>operate(packet,sender,'resumeCreateRetryDraft'),
    reviewPreparedDraft:(packet,sender)=>operate(packet,sender,'reviewPreparedDraft'),confirmPreparedDraft:(packet,sender,confirmation)=>operate(packet,sender,'confirmPreparedDraft',confirmation),
    recoverPreparedDraft:(packet,sender)=>operate(packet,sender,'recoverPreparedDraft'),observePreparedDraft:(packet,sender)=>operate(packet,sender,'observePreparedDraft')}: {})});
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
    if(typeof key!=='string'||! /^(?:single|product)-document:[a-f0-9]{64}$/.test(key))fail('CHECKPOINT','개별 전송 기록 키를 확인해주세요.');
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
              if(!/^(?:single|product)-document-lane:[a-f0-9]{64}$/.test(next?.laneKey||''))fail('CHECKPOINT','개별 옵션 전송 기록을 확인해주세요.');
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
