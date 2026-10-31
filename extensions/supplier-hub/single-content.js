// Authenticated app proof only; this script never creates a Hub document.
/* global yoofamSingleConfirmation */
let yoofamSingleSessionId=crypto.randomUUID(),yoofamSingleAccount=null;
let yoofamSingleSessionBound=false,yoofamSingleAccountChanged=false;
let yoofamSingleConfirmationAttempt=null;
let yoofamConfiguredRegistrationIntent=null;
const yoofamSingleVerifiedSourceModes=new Map();
const SINGLE_CONFIGURED_TERMS_VERSION='supplier-hub-displayed-terms-v1';
const singleConfiguredStages={productPage:{kind:'price-data',key:'msrpAgree',id:'agreeMSRPTerm'},imagePage:{kind:'label-contact',key:'labelContactAgreed',id:'agreeLabelContact'}};
const singleCanonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(singleCanonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+singleCanonical(value[key])).join(',')+'}';
async function singleDigest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(singleCanonical(value)))),b=>b.toString(16).padStart(2,'0')).join('');}
async function singleReadJson(path){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  const resource=path==='/api/supplier-hub/catalog-context'?'catalog-context':path==='/api/supplier-hub/registration-consents'?'registration-consents':path.includes('/native-assets')?'native-assets':path.includes('/supplier-hub-product-receipt')?'product-receipt':path.includes('/supplier-hub-receipt')?'receipt-history':'single-package';
  const failure=(code,status)=>Object.assign(Error('현재 앱의 저장 자료 조회를 확인하지 못했습니다.'),{sourceFailure:{code,resource,...(status===undefined?{}:{status})}});
  try{let response;try{response=await fetch(path,{cache:'no-store',credentials:'same-origin',redirect:'error',signal:controller.signal});}catch{throw failure(controller.signal.aborted?'SOURCE_READ_TIMEOUT':'SOURCE_READ_NETWORK');}
    if(!response.ok)throw failure('SOURCE_READ_HTTP',response.status);
    if(response.redirected||response.url!==location.origin+path||!/\bapplication\/json\b/i.test(response.headers.get('content-type')||''))throw failure('SOURCE_READ_RESPONSE');
    let text;try{text=await response.text();}catch{throw failure(controller.signal.aborted?'SOURCE_READ_TIMEOUT':'SOURCE_READ_NETWORK');}
    if(controller.signal.aborted)throw failure('SOURCE_READ_TIMEOUT');if(text.length>6*1024*1024)throw failure('SOURCE_READ_RESPONSE');try{return JSON.parse(text);}catch{throw failure('SOURCE_READ_RESPONSE');}
  }finally{clearTimeout(timer);}
}
// Only this isolated-world listener can arm a registration. Page messages,
// synthetic clicks, remembered terms and a configured-policy flag cannot.
globalThis.document?.addEventListener?.('click',event=>{
  if(event.isTrusted!==true||document.visibilityState!=='visible')return;
  const button=event.target?.closest?.('button[data-supplier-hub-registration-start="v1"]');
  if(!button||button.disabled||button.getAttribute('aria-disabled')==='true')return;
  const get=name=>button.getAttribute('data-supplier-hub-'+name),hash=/^[a-f0-9]{64}$/,id=/^\w[\w-]{0,99}$/;
  const binding={ownerId:get('owner-id'),productId:get('product-id'),companyCode:get('company-code'),packetDigest:get('packet-digest'),requestId:get('request-id'),identityDigest:get('identity-digest'),bodySha256:get('body-sha256'),preparedBodySha256:get('prepared-body-sha256')};
  yoofamConfiguredRegistrationIntent=null;
  if(!['ownerId','productId','requestId'].every(key=>id.test(binding[key]||''))||!Object.hasOwn({A01526306:1,A01464742:1},binding.companyCode)
    ||!['packetDigest','identityDigest','bodySha256','preparedBodySha256'].every(key=>hash.test(binding[key]||'')))return;
  const startedAt=Date.now();yoofamConfiguredRegistrationIntent={id:crypto.randomUUID(),startedAt,expiresAt:startedAt+900000,binding,docId:null,scope:null,stages:[],seen:new Set(),pending:null};
},true);
globalThis.window?.addEventListener?.('pagehide',()=>{yoofamConfiguredRegistrationIntent=null;});
function singleConfiguredIntent(input){
  const intent=yoofamConfiguredRegistrationIntent,source=input?.sourceExpected,identity=input?.identity,b=intent?.binding;
  if(!intent||Date.now()>=intent.expiresAt||!source||!identity||identity.ownerId!==b.ownerId||identity.productId!==b.productId||identity.company?.code!==b.companyCode
    ||input.identityDigest!==b.identityDigest||source.packetDigest!==b.packetDigest||source.requestId!==b.requestId||source.bodySha256!==b.bodySha256||source.preparedBodySha256!==b.preparedBodySha256
    ||intent.docId!==null&&singleCanonical(intent.docId)!==singleCanonical(input.docId))return null;
  return intent;
}
async function singleConfiguredPolicies(input,intent){
  const value=await singleReadJson('/api/supplier-hub/registration-consents'),same=(a,b)=>singleCanonical(a)===singleCanonical(b),object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
  if(!exact(value,['format','ownerId','company','actor','connections','policies'])||value.format!=='yoofam-member-registration-consents-v1'
    ||value.ownerId!==input.identity.ownerId||!same(value.company,input.identity.company)||!exact(value.actor,['email','role','credentialVersion'])
    ||typeof value.actor.email!=='string'||!value.actor.email||value.actor.email.length>254||!['admin','member'].includes(value.actor.role)
    ||value.actor.credentialVersion!==null&&(!Number.isSafeInteger(value.actor.credentialVersion)||value.actor.credentialVersion<0)
    ||!Array.isArray(value.connections)||value.connections.length>20||!Array.isArray(value.policies)||value.policies.length>40
    ||value.policies.some(row=>!row||!['price-data','label-contact'].includes(row.kind))
    ||new Set(value.policies.map(row=>row.connectionId+':'+row.kind)).size!==value.policies.length)return null;
  // A former or disabled account must not hide the one configured account.
  // Two complete active account policies are ambiguous and require review.
  const candidates=value.connections.filter(connection=>connection?.service==='supplier-hub'&&connection.enabled===true&&connection.hasPassword===true
    &&['price-data','label-contact'].every(kind=>value.policies.some(row=>row.kind===kind&&row.connectionId===connection.id&&row.connectionRevision===connection.revision&&row.enabled===true
      &&row.termsVersion===SINGLE_CONFIGURED_TERMS_VERSION&&same(row.actor,value.actor))));
  if(candidates.length!==1)return null;
  const selectedPolicies=value.policies.filter(row=>row.connectionId===candidates[0].id);
  const policies=[];
  for(const [stage,descriptor]of Object.entries(singleConfiguredStages)){
    const found=selectedPolicies.filter(row=>row?.kind===descriptor.kind);if(found.length!==1)return null;const policy=found[0],terms=policy.terms;
    if(!exact(policy,['kind','connectionId','connectionRevision','revision','enabled','termsVersion','termsSha256','terms','acceptedAt','updatedAt','actor'])
      ||policy.enabled!==true||policy.termsVersion!==SINGLE_CONFIGURED_TERMS_VERSION||!Number.isSafeInteger(policy.revision)||policy.revision<1
      ||!Number.isSafeInteger(policy.connectionRevision)||policy.connectionRevision<1||!same(policy.actor,value.actor)
      ||!exact(terms,['stage','key','id','title','text','termsText'])||terms.stage!==stage||terms.key!==descriptor.key||terms.id!==descriptor.id
      ||!['title','text','termsText'].every(key=>typeof terms[key]==='string'&&terms[key].trim())||terms.title.length>500||terms.text.length>10000||terms.termsText.length>50000
      ||policy.termsSha256!==await singleDigest({format:SINGLE_CONFIGURED_TERMS_VERSION,terms}))return null;
    const connections=value.connections.filter(row=>row?.id===policy.connectionId),connection=connections[0];
    if(connections.length!==1||!exact(connection,['id','service','alias','loginId','hasPassword','enabled','revision','createdAt','updatedAt'])
      ||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(connection.id||'')
      ||connection.service!=='supplier-hub'||connection.enabled!==true||connection.hasPassword!==true||connection.revision!==policy.connectionRevision)return null;
    policies.push(policy);
  }
  if(policies[0].connectionId!==policies[1].connectionId||policies[0].connectionRevision!==policies[1].connectionRevision)return null;
  const scope={ownerId:value.ownerId,company:value.company,actor:value.actor,connectionId:policies[0].connectionId,connectionRevision:policies[0].connectionRevision};
  if(intent.scope&&!same(intent.scope,scope))return null;
  const stage=input.challenge.stage,descriptor=singleConfiguredStages[stage];
  if(descriptor){
    if(input.challenge.items.length!==1||input.challenge.items[0].required!==true||intent.stages.length!==Object.keys(singleConfiguredStages).indexOf(stage))return null;
    const {required,...item}=input.challenge.items[0];void required;
    if(!same({stage,...item},policies.find(row=>row.kind===descriptor.kind).terms))return null;
  }else if(stage!=='logisticsPage'||input.challenge.items.length!==0||intent.stages.length!==2)return null;
  for(const prior of intent.stages){const current=policies.find(row=>row.kind===prior.kind);if(current.revision!==prior.revision||current.termsSha256!==prior.termsSha256)return null;}
  return {scope,policies:descriptor?policies.filter(row=>row.kind===descriptor.kind):policies};
}
async function singleConfiguredAuthorization(input,{wholeProduct=true,nativeAssets=false,consume=false,check=()=>{}}={}){
  if(!wholeProduct||!nativeAssets)return null;
  const intent=singleConfiguredIntent(input);if(!intent||intent.pending||intent.seen.has(input.challenge.id))return null;
  const current=()=>{check();if(singleConfiguredIntent(input)!==intent||Date.now()>=input.challenge.expiresAt)throw Error('원래 등록전송 확인이 취소되었거나 만료됐습니다.');};
  const marker={};intent.pending=marker;
  try{
    current();if(await singleDigest(input.identity)!==input.identityDigest)return null;
    const before=await verifySingleDocumentSource(input.sourceExpected,wholeProduct,nativeAssets);current();
    if(input.sessionId!==undefined&&before.sessionId!==input.sessionId)throw Error('현재 회원 세션이 변경되었습니다.');
    const policy=await singleConfiguredPolicies(input,intent);current();if(!policy)return null;
    const after=await verifySingleDocumentSource(input.sourceExpected,wholeProduct,nativeAssets);current();
    if(after.sessionId!==before.sessionId||singleCanonical(after.identity)!==singleCanonical(input.identity))throw Error('등록전송 중 회원·회사·저장 자료가 변경되었습니다.');
    const fresh=await singleConfiguredPolicies(input,intent);current();if(!fresh||singleCanonical(fresh)!==singleCanonical(policy))throw Error('저장된 동의 또는 연결 계정이 변경되었습니다.');
    const checkedAt=Date.now(),proof={format:'yoofam-configured-registration-authorization-v1',kind:'configured-policy',intentId:intent.id,startedAt:intent.startedAt,expiresAt:intent.expiresAt,checkedAt,
      ...policy.scope,identityDigest:input.identityDigest,packetDigest:input.sourceExpected.packetDigest,requestId:input.sourceExpected.requestId,docId:input.docId,challengeId:input.challenge.id,stage:input.challenge.stage,
      policies:policy.policies.map(({kind,revision,termsSha256})=>({kind,revision,termsSha256}))};
    if(consume){intent.docId=input.docId;intent.scope=policy.scope;intent.seen.add(input.challenge.id);if(input.challenge.stage==='logisticsPage')yoofamConfiguredRegistrationIntent=null;else intent.stages.push(proof.policies[0]);}
    return proof;
  }finally{if(intent.pending===marker)intent.pending=null;}
}
globalThis.window?.addEventListener?.('message',event=>{
  const message=event.data;if(event.source!==window||event.origin!==location.origin||message?.channel!=='YOOFAM_CONFIGURED_REGISTRATION_CONSENT')return;
  if(message.type==='cancel'){yoofamConfiguredRegistrationIntent=null;return;}
  if(message.type!=='probe'||typeof message.requestId!=='string'||!/^\w[\w-]{0,99}$/.test(message.requestId))return;
  const respond=result=>window.postMessage({channel:'YOOFAM_CONFIGURED_REGISTRATION_CONSENT_RESULT',requestId:message.requestId,result},location.origin);
  let input;try{
    const expected=message.expected,challenge=expected.challenge,stage=challenge.stage;
    input=singleConfirmationInput({...expected,sessionId:yoofamSingleSessionId,confirmation:{action:singleConfiguredStages[stage]?'confirm-and-continue':'confirm-and-submit',...(stage?{stage}:{}),userInitiated:true,mode:'configured-policy',challengeId:challenge.id,confirmedAt:Date.now(),approvedKeys:challenge.items.filter(item=>item.required).map(item=>item.key)}},true);
  }catch{respond({ok:false,error:'현재 등록전송 확인 요청이 다릅니다.'});return;}
  const mode=yoofamSingleVerifiedSourceModes.get(input.sourceExpected.packetDigest);
  if(!mode){respond({ok:true,confirmation:null});return;}
  void singleConfiguredAuthorization(input,mode).then(proof=>respond({ok:true,confirmation:proof?input.confirmation:null}),()=>respond({ok:false,error:'현재 회원·회사·동의 설정을 확인하지 못했습니다.'}));
});
function singleSourceIdentity(identity,wholeProduct){
  const id=/^\w[\w-]{0,99}$/;
  if(!identity||!['ownerId','productId'].every(key=>id.test(identity[key]||'')))return false;
  if(!wholeProduct)return ['profileId','optionId'].every(key=>id.test(identity[key]||''))&&!Object.hasOwn(identity,'members');
  return !Object.hasOwn(identity,'optionId')&&(identity.profileId===null||id.test(identity.profileId||''))
    &&(identity.requestedProfileId===null||id.test(identity.requestedProfileId||''))
    &&(identity.requestedProfileId===null||identity.requestedProfileId===identity.profileId)&&/^[a-f0-9]{64}$/.test(identity.inputFingerprint||'')
    &&Array.isArray(identity.members)&&identity.members.length>0&&identity.members.length<=200
    &&identity.members.every((member,index)=>member&&id.test(member.optionId||'')&&member.documentIndex===index&&typeof member.optionLabel==='string'&&member.optionLabel.length<=10000)
    &&new Set(identity.members.map(member=>member.optionId)).size===identity.members.length;
}
async function verifySingleDocumentSource(expected,wholeProduct=false,nativeAssets=false){
  const identity=expected?.identity,same=(a,b)=>singleCanonical(a)===singleCanonical(b),hash=/^[a-f0-9]{64}$/;
  if(!singleSourceIdentity(identity,wholeProduct)||identity.origin!==location.origin
    ||!['fingerprint','schemaSha256','accountContext'].every(key=>hash.test(identity[key]||''))||!hash.test(expected.bodySha256||'')
    ||!hash.test(expected.preparedBodySha256||'')||!hash.test(expected.packetDigest||''))throw Error('원래 회원·상품·옵션 요청을 확인해주세요.');
  const before=await singleReadJson('/api/supplier-hub/catalog-context'),context=singleCanonical([before.ownerId,before.company]);
  if(yoofamSingleAccount!==null&&yoofamSingleAccount!==context){yoofamSingleSessionId=crypto.randomUUID();yoofamSingleAccount=context;yoofamSingleAccountChanged=true;yoofamSingleSessionBound=false;throw Error('현재 회원 회사가 변경되었습니다.');}
  yoofamSingleAccount=context;
  const bytes=new TextEncoder().encode(JSON.stringify(['sourceflow-managed-product-account-v1',before.ownerId,before.company?.code,before.company?.name]));
  const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(before.ownerId!==identity.ownerId||!same(before.company,identity.company)||account!==identity.accountContext)throw Error('원래 회원 회사로 로그인해주세요.');
  const requested=wholeProduct?identity.requestedProfileId:identity.profileId;
  // These three authenticated reads are independent. Keep both account fences
  // and await every result before interpreting any source or receipt proof.
  const reads=await Promise.allSettled([
    singleReadJson(`/api/products/${encodeURIComponent(identity.productId)}/${nativeAssets?'native-assets':'supplier-hub-single-package'}${requested===null?'':`?profileId=${encodeURIComponent(requested)}`}`),
    singleReadJson(`/api/products/${encodeURIComponent(identity.productId)}/supplier-hub-receipt?mode=history`),
    singleReadJson(`/api/products/${encodeURIComponent(identity.productId)}/supplier-hub-product-receipt`),
  ]);
  const failed=reads.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  const [value,history,native]=reads.map(result=>result.value),after=await singleReadJson('/api/supplier-hub/catalog-context');
  const identifier=value=>Number.isSafeInteger(value)&&value>0||typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=200&&!/[\u0000-\u001f]|\.\.\.|…/.test(value);
  const nativeAllowed=row=>{
    const receipt=row?.receipt,states={SUBMITTED:'pending',FINISHED:'accepted',REJECTED:'rejected'};
    if(!row||!['yoofam-single-receipt-v1','yoofam-product-document-receipt-v1'].includes(row.format)
      ||row.productId!==identity.productId||!same(row.company,identity.company)||row.registered!==false||!/^\w[\w-]{0,99}$/.test(row.requestId||'')||!identifier(row.docId)
      ||!['packetDigest','identityDigest','preparedBodySha256'].every(key=>hash.test(row[key]||''))
      ||!receipt||!Object.hasOwn(states,receipt.sourceStatus)||receipt.state!==states[receipt.sourceStatus]||receipt.evidence!=='document-receipt'||receipt.registered!==false
      ||!same(receipt.company,row.company)||!same(receipt.docId,row.docId)||receipt.identityDigest!==row.identityDigest||receipt.preparedBodySha256!==row.preparedBodySha256
      ||!identifier(receipt.qvtRequestId)||!same(receipt.receiptId,receipt.qvtRequestId)||!Number.isSafeInteger(receipt.observedAt)||receipt.observedAt<=0||receipt.observedAt>Date.now()+5000
      ||Object.keys(receipt).some(key=>!['state','docId','company','identityDigest','preparedBodySha256','observedAt','receiptId','qvtRequestId','sourceStatus','evidence','registered'].includes(key)))return false;
    // A known rejection permits a new document. A pending or completed file
    // permits only recovery of this exact original request/document; it must
    // never authorize another creation. The endpoint already parses records.
    return receipt.sourceStatus==='REJECTED'||row.packetDigest===expected.packetDigest&&row.requestId===expected.requestId&&same(row.docId,expected.docId);
  };
  if(native.format!=='yoofam-native-receipt-history-v1'||native.productId!==identity.productId||!Array.isArray(native.receipts)||native.receipts.length>1000
    ||native.receipts.some(row=>!nativeAllowed(row)))throw Error('이 상품의 다른 전송 문서가 이미 보관돼 있거나 확인 이력이 다릅니다.');
  if(nativeAssets){
    const source=value.identity,{sourcePlanSha256:omitted,...manifest}=value;void omitted;
    if(value.format!=='yoofam-native-asset-source-plan-v1'||value.metadataValid!==true||value.sourcePlanSha256!==identity.fingerprint||value.registered!==false||value.remoteWrites!==false||value.submissionReady!==false||value.transportReady!==false||value.bytesVerified!==false
      ||!Array.isArray(value.issues)||value.issues.some(issue=>issue.level==='error')||!source||source.ownerId!==identity.ownerId||source.productId!==identity.productId||!same(source.company,identity.company)||source.categoryId!==identity.categoryId||source.schemaSha256!==identity.schemaSha256||source.inputFingerprint!==identity.inputFingerprint
      ||!same(source.source,{...identity.source,profileId:identity.profileId})||!same(source.members,identity.members)||await singleDigest(manifest)!==identity.fingerprint||await singleDigest(source)!==value.identityDigest||value.originalBodySha256!==expected.bodySha256||value.preparedBodySha256!==expected.preparedBodySha256
      ||!same(before,after)||history.history?.productId!==identity.productId||history.history.blocked!==false)throw Error('현재 파일명 원본 계획·회사·이전 전송 이력을 확인해주세요.');
  }else if(!same(before,after)||value.format!=='yoofam-supplier-hub-single-package-v1'||value.prepared!==true||value.registered!==false||value.remoteWrites!==false
    ||value.productId!==identity.productId||value.fingerprint!==identity.fingerprint||value.schemaSha256!==identity.schemaSha256||!same(value.company,identity.company)
    ||value.source?.profileId!==identity.profileId||!value.review?.canPrepare||!Array.isArray(value.review.issues)||value.review.issues.some(issue=>issue.level==='error')
    ||history.history?.productId!==identity.productId||history.history.blocked!==false)throw Error('현재 저장값 또는 이전 전송 이력을 확인해주세요.');
  const savedSource=nativeAssets?value.identity.source:value.source,options=nativeAssets?value.identity.members:value.options,payload=nativeAssets?value.body:value.payload;
  const source={productVersion:savedSource.productVersion,contentRevision:savedSource.contentRevision,optionRevision:savedSource.optionRevision,quotationRevision:savedSource.quotationRevision,profileRevision:savedSource.profileRevision};
  if(!same(source,identity.source)||!Array.isArray(options)||options.length!==payload?.jsonDocument?.length)throw Error('현재 포함 옵션 문서의 정확한 연결을 확인해주세요.');
  let body;
  if(wholeProduct){
    if(!nativeAssets&&(value.requestedProfileId!==identity.requestedProfileId||value.inputFingerprint!==identity.inputFingerprint)||options.length!==identity.members.length
      ||options.some((row,index)=>row.optionId!==identity.members[index].optionId||row.optionLabel!==identity.members[index].optionLabel))throw Error('전체 포함 옵션의 순서·저장값이 변경되었습니다.');
    body=structuredClone(payload);
  }else{
    if(value.options.filter(row=>row.optionId===identity.optionId).length!==1)throw Error('현재 선택 옵션의 연결을 확인해주세요.');
    const index=value.options.findIndex(row=>row.optionId===identity.optionId),document=structuredClone(value.payload.jsonDocument[index]);
    body={...value.payload,productName:document.startPage?.productName,jsonDocument:[document]};
  }
  if(body.docId!==null||body.scope!=='Retail_Categorized_Single'||body.displayCategoryCode!==identity.categoryId||await singleDigest(body)!==expected.bodySha256)throw Error('준비한 개별 문서의 저장 본문이 다릅니다.');
  const deferred=structuredClone(body);for(const document of deferred.jsonDocument)for(const key of ['msrpAgree','labelContactAgreed'])if(document.imagePage&&Object.hasOwn(document.imagePage,key))document.imagePage[key]=false;
  if(await singleDigest(deferred)!==expected.preparedBodySha256)throw Error('제출 전 동의를 분리한 본문이 다릅니다.');
  if(nativeAssets&&!yoofamSingleSessionBound&&!yoofamSingleAccountChanged){
    const sourceExpected=Object.fromEntries(['identity','bodySha256','preparedBodySha256','packetDigest','requestId','docId'].map(key=>[key,expected[key]]));
    const restored=await chrome.runtime.sendMessage({type:'YOOFAM_READ_PRODUCT_SOURCE_SESSION',expected:sourceExpected});
    if(restored?.ok!==true||Object.keys(restored).sort().join(',')!=='ok,sessionId'||restored.sessionId!==null&&!/^\w[\w-]{0,99}$/.test(restored.sessionId||''))throw Error('원래 새 초안의 연결 기록을 확인하지 못했습니다.');
    if(!same(before,await singleReadJson('/api/supplier-hub/catalog-context')))throw Error('연결 기록을 확인하는 동안 회원 회사가 변경되었습니다.');
    if(restored.sessionId!==null)yoofamSingleSessionId=restored.sessionId;
  }
  yoofamSingleSessionBound=true;
  yoofamSingleVerifiedSourceModes.set(expected.packetDigest,{wholeProduct,nativeAssets});
  if(yoofamSingleVerifiedSourceModes.size>64)yoofamSingleVerifiedSourceModes.delete(yoofamSingleVerifiedSourceModes.keys().next().value);
  return {ok:true,current:true,submissionReady:true,priorDocumentClear:true,identity,bodySha256:expected.bodySha256,sessionId:yoofamSingleSessionId,checkedAt:Date.now()};
}
function singleConfirmationInput(expected,wholeProduct=false){
  const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)),same=(a,b)=>singleCanonical(a)===singleCanonical(b),hash=/^[a-f0-9]{64}$/,id=/^\w[\w-]{0,99}$/;
  const exact=(value,required,optional=[])=>object(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
  const identifier=value=>Number.isSafeInteger(value)&&value>0||typeof value==='string'&&value.length>0&&value.length<=200&&value===value.trim()&&!/[\u0000-\u001f]|\.\.\.|…/.test(value);
  const identity=expected?.identity,challenge=expected?.challenge,details=expected?.confirmation,source=expected?.sourceExpected,time=Date.now();
  if(!object(expected)||!object(identity)||!object(source)||!same(source.identity,identity)||identity.origin!==location.origin
    ||!singleSourceIdentity(identity,wholeProduct)
    ||!['fingerprint','schemaSha256','accountContext'].every(key=>hash.test(identity[key]||''))
    ||!exact(identity.company,['code','name'])||({A01526306:'유앤채',A01464742:'와이홉'})[identity.company.code]!==identity.company.name
    ||!['bodySha256','preparedBodySha256','packetDigest'].every(key=>hash.test(source[key]||''))||!id.test(expected.sessionId||'')||!hash.test(expected.identityDigest||'')
    ||!exact(challenge,['id','docId','packetDigest','items','issuedAt','expiresAt'],['stage'])||!hash.test(challenge.id||'')
    ||!identifier(expected.docId)||!same(expected.docId,challenge.docId)||challenge.packetDigest!==source.packetDigest
    ||!Number.isSafeInteger(challenge.issuedAt)||challenge.issuedAt<=0||challenge.issuedAt>time+5000||challenge.expiresAt!==challenge.issuedAt+120000||time>=challenge.expiresAt
    ||!Array.isArray(challenge.items)||challenge.items.length>20
    ||challenge.stage!==undefined&&!['productPage','imagePage','logisticsPage'].includes(challenge.stage))throw Error('현재 문서의 동의 요청을 확인해주세요.');
  const stage=challenge.stage,intermediate=stage==='productPage'||stage==='imagePage';
  if(challenge.items.some(item=>!exact(item,['key','id','text','required'],['title','termsText'])||!id.test(item.key||'')||!id.test(item.id||'')
    ||typeof item.text!=='string'||!item.text.trim()||item.text.length>10000||typeof item.required!=='boolean'
    ||item.title!==undefined&&(typeof item.title!=='string'||!item.title.trim()||item.title.length>500)
    ||item.termsText!==undefined&&(typeof item.termsText!=='string'||!item.termsText.trim()||item.termsText.length>50000)
    ||intermediate&&(typeof item.title!=='string'||typeof item.termsText!=='string'))
    ||new Set(challenge.items.map(item=>item.key)).size!==challenge.items.length||new Set(challenge.items.map(item=>item.id)).size!==challenge.items.length
    ||(intermediate||stage===undefined)&&!challenge.items.some(item=>item.required)
    ||stage==='logisticsPage'&&challenge.items.length>0&&!challenge.items.some(item=>item.required)
    ||!exact(details,['action','userInitiated','challengeId','confirmedAt','approvedKeys'],['stage','mode'])||details.userInitiated!==true||details.challengeId!==challenge.id
    ||details.mode!==undefined&&details.mode!=='configured-policy'
    ||details.action!==(intermediate?'confirm-and-continue':'confirm-and-submit')
    ||(stage===undefined?details.stage!==undefined:details.stage!==stage)
    ||!Number.isSafeInteger(details.confirmedAt)||details.confirmedAt<challenge.issuedAt||details.confirmedAt>time+5000||details.confirmedAt>challenge.expiresAt
    ||!Array.isArray(details.approvedKeys)||new Set(details.approvedKeys).size!==details.approvedKeys.length
    ||!same([...details.approvedKeys].sort(),challenge.items.filter(item=>item.required).map(item=>item.key).sort()))throw Error('현재 단계의 약관과 직접 확인할 동작이 다릅니다.');
  return JSON.parse(singleCanonical(expected));
}
async function confirmSingleDocumentAction(expected,input,signal,current,wholeProduct=false,nativeAssets=false){
  const configured=input.confirmation.mode==='configured-policy';
  const check=()=>{if(signal.aborted||!current()||Date.now()>=input.challenge.expiresAt||!configured&&document.visibilityState!=='visible')throw Error('현재 동의 확인이 취소되었거나 만료됐습니다.');};
  if(configured){
    const proof=await singleConfiguredAuthorization(input,{wholeProduct,nativeAssets,consume:true,check});check();
    if(!proof)throw Error('현재 등록전송의 저장된 동의 설정을 다시 확인해주세요.');
    return {ok:true,userInitiated:true,challengeId:input.challenge.id,identityDigest:input.identityDigest,checkedAt:proof.checkedAt,consentProof:proof};
  }
  check();if(await singleDigest(input.identity)!==input.identityDigest)throw Error('현재 문서의 회원 연결을 확인해주세요.');
  const before=await verifySingleDocumentSource(input.sourceExpected,wholeProduct,nativeAssets);check();
  if(before.sessionId!==input.sessionId)throw Error('현재 회원 세션이 변경되었습니다.');
  const accepted=await yoofamSingleConfirmation.prompt(input,{signal});check();
  if(accepted!==true)throw Error('동의 확인을 취소했습니다.');
  // The visible text and action are tied to this immutable request. Read the
  // current member and saved source again after the real extension UI click.
  singleConfirmationInput(expected,wholeProduct);
  const after=await verifySingleDocumentSource(input.sourceExpected,wholeProduct,nativeAssets);check();
  if(after.sessionId!==before.sessionId||after.sessionId!==input.sessionId||singleCanonical(after.identity)!==singleCanonical(input.identity))throw Error('확인 중 회원·회사·저장한 자료가 변경되었습니다.');
  return {ok:true,userInitiated:true,challengeId:input.challenge.id,identityDigest:input.identityDigest,checkedAt:Date.now()};
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender?.id!==chrome.runtime.id||!['YOOFAM_VERIFY_SINGLE_DOCUMENT_SOURCE','YOOFAM_CONFIRM_SINGLE_DOCUMENT_ACTION','YOOFAM_VERIFY_PRODUCT_DOCUMENT_SOURCE','YOOFAM_CONFIRM_PRODUCT_DOCUMENT_ACTION','YOOFAM_VERIFY_NATIVE_PRODUCT_DOCUMENT_SOURCE','YOOFAM_CONFIRM_NATIVE_PRODUCT_DOCUMENT_ACTION'].includes(message?.type))return;
  const nativeAssets=message.type==='YOOFAM_VERIFY_NATIVE_PRODUCT_DOCUMENT_SOURCE'||message.type==='YOOFAM_CONFIRM_NATIVE_PRODUCT_DOCUMENT_ACTION',wholeProduct=nativeAssets||message.type==='YOOFAM_VERIFY_PRODUCT_DOCUMENT_SOURCE'||message.type==='YOOFAM_CONFIRM_PRODUCT_DOCUMENT_ACTION';
  if(message.type==='YOOFAM_CONFIRM_SINGLE_DOCUMENT_ACTION'||message.type==='YOOFAM_CONFIRM_PRODUCT_DOCUMENT_ACTION'||message.type==='YOOFAM_CONFIRM_NATIVE_PRODUCT_DOCUMENT_ACTION'){
    let input;try{input=singleConfirmationInput(message.expected,wholeProduct);if(yoofamSingleConfirmationAttempt||typeof yoofamSingleConfirmation==='undefined')throw Error('현재 동의 확인을 마친 뒤 다시 확인해주세요.');}
    catch(error){respond({ok:false,error:error.message});return;}
    const controller=new AbortController(),snapshot=singleCanonical(message.expected);yoofamSingleConfirmationAttempt=controller;
    let timer;const cancelled=new Promise((resolve,reject)=>{controller.signal.addEventListener('abort',()=>reject(Error('동의 확인을 취소했거나 시간이 초과됐습니다.')),{once:true});});
    const invalidate=()=>{yoofamConfiguredRegistrationIntent=null;controller.abort();},visibility=()=>{if(input.confirmation.mode!=='configured-policy'&&document.visibilityState!=='visible')invalidate();};
    window.addEventListener('pagehide',invalidate);document.addEventListener('visibilitychange',visibility);
    timer=setTimeout(invalidate,Math.max(0,input.challenge.expiresAt-Date.now()));
    const current=()=>yoofamSingleConfirmationAttempt===controller&&singleCanonical(message.expected)===snapshot;
    void Promise.race([confirmSingleDocumentAction(message.expected,input,controller.signal,current,wholeProduct,nativeAssets),cancelled])
      .then(respond,error=>respond({ok:false,error:error.message}))
      .finally(()=>{clearTimeout(timer);window.removeEventListener('pagehide',invalidate);document.removeEventListener('visibilitychange',visibility);if(yoofamSingleConfirmationAttempt===controller)yoofamSingleConfirmationAttempt=null;});
    return true;
  }
  verifySingleDocumentSource(message.expected,wholeProduct,nativeAssets).then(respond,error=>respond({ok:false,error:'현재 회원·회사·저장 자료를 확인하지 못했습니다.',...(error?.sourceFailure?{sourceFailure:error.sourceFailure}:{})}));return true;
});
