import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {configuredConsentProofValid,configuredFinalMatchesStages} from '../extensions/supplier-hub/configured-consent-proof.mjs';
import {singleDocumentFixture,clone} from './helpers/supplier-hub-single-document.mjs';
import {createSupplierHubDocumentReceiver,singleDocumentIdentity,SINGLE_DOCUMENT_FORMAT} from '../extensions/supplier-hub/single-document.mjs';
import {nativeReceiverReceiptFixture,companies} from './helpers/native-product-receiver-receipt-flow.mjs';
import {createProductDocumentDraftReceiver} from '../extensions/supplier-hub/product-document-receiver.mjs';

const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const digest=async value=>Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))).toString('hex');
const plain=value=>JSON.parse(JSON.stringify(value));
const connectionId='11111111-1111-4111-8111-111111111111';
const actor={email:'owner@example.test',role:'member',credentialVersion:3};
const terms=[{stage:'productPage',key:'msrpAgree',id:'agreeMSRPTerm',title:'가격 정보 이용약관',text:'가격 자료 이용에 동의합니다.',termsText:'보이는 가격 자료 약관의 전체 원문입니다.\n가격 정보의 권한을 확인합니다.'},
  {stage:'imagePage',key:'labelContactAgreed',id:'agreeLabelContact',title:'공식 연락처 제공 및 공개 동의',text:'공식 업무용 연락처 제공에 동의합니다.',termsText:'보이는 연락처 제공 약관의 전체 원문입니다.\n업무용 연락처 공개를 확인합니다.'}];
class Bus{
  listeners=new Map();
  addEventListener(type,fn){const set=this.listeners.get(type)??new Set();set.add(fn);this.listeners.set(type,set);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  emit(type,value={}){for(const fn of [...this.listeners.get(type)??[]])fn({type,isTrusted:false,...value});}
}
// The real isolated content code owns click, policy, sequencing and replay
// behavior. Its separately tested current-source verifier is a fresh-read port
// here so faults can be placed precisely before/after a policy read.
async function contentFixture(){
  const origin='http://localhost:3000',window=new Bus(),document=new Bus(),replies=[],requests=[];document.visibilityState='visible';
  let now=1_800_000_000_000,handler,sourceReads=0,sourceCurrent=true,hook=()=>{};
  const identity={origin,appTabId:17,windowId:29,ownerId:'owner',company:{code:'A01526306',name:'유앤채'},productId:'synthetic-product',profileId:null,requestedProfileId:null,
    inputFingerprint:'1'.repeat(64),fingerprint:'2'.repeat(64),schemaSha256:'3'.repeat(64),accountContext:'4'.repeat(64),members:[{optionId:'option-one',optionLabel:'합성 옵션',documentIndex:0}],source:{productVersion:'v1',contentRevision:1,optionRevision:1,quotationRevision:1,profileRevision:1}};
  const identityDigest=await digest(identity),sourceExpected={identity,bodySha256:'a'.repeat(64),preparedBodySha256:'b'.repeat(64),packetDigest:'c'.repeat(64),requestId:'request-one',docId:'synthetic-doc'};
  const view={format:'yoofam-member-registration-consents-v1',ownerId:identity.ownerId,company:clone(identity.company),actor:clone(actor),
    connections:[{id:connectionId,service:'supplier-hub',alias:'내 서플라이어허브',loginId:'owner@example.test',hasPassword:true,enabled:true,revision:7,createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()}],
    policies:await Promise.all(terms.map(async(term,index)=>({kind:['price-data','label-contact'][index],connectionId,connectionRevision:7,revision:index+1,enabled:true,termsVersion:'supplier-hub-displayed-terms-v1',termsSha256:await digest({format:'supplier-hub-displayed-terms-v1',terms:term}),terms:clone(term),acceptedAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),actor:clone(actor)})))};
  window.postMessage=value=>{replies.push(plain(value));};
  const scope={window,document,location:{origin},crypto:webcrypto,TextEncoder,Uint8Array,AbortController,structuredClone,setTimeout,clearTimeout,
    Date:class extends Date{static now(){return now;}},yoofamSingleConfirmation:{prompt:()=>assert.fail('Configured policy must not manufacture a human prompt')},
    chrome:{runtime:{id:'extension',onMessage:{addListener:fn=>handler=fn}}},fetch:async(path,init)=>{requests.push({path,init});await hook('policy',requests.length);const response=Response.json(view);Object.defineProperty(response,'url',{value:origin+path});return response;}};
  vm.createContext(scope);vm.runInContext(fs.readFileSync(new URL('../extensions/supplier-hub/single-content.js',import.meta.url),'utf8'),scope);
  const sessionId=vm.runInContext('yoofamSingleSessionId',scope);
  scope.verifySingleDocumentSource=async input=>{sourceReads++;await hook('source',sourceReads);assert.equal(canonical(input),canonical(sourceExpected));if(!sourceCurrent)throw Error('fresh source changed');return{ok:true,identity:clone(identity),sessionId};};
  vm.runInContext(`yoofamSingleVerifiedSourceModes.set('${sourceExpected.packetDigest}',{wholeProduct:true,nativeAssets:true})`,scope);
  const input=(stage='productPage')=>{const term=terms.find(row=>row.stage===stage),items=term?[{...clone(term),required:true}]:[];for(const item of items)delete item.stage;
    const challenge={id:(stage==='productPage'?'d':stage==='imagePage'?'e':'f').repeat(64),docId:sourceExpected.docId,packetDigest:sourceExpected.packetDigest,stage,issuedAt:now,expiresAt:now+120000,items};
    return{identity:clone(identity),identityDigest,sourceExpected:clone(sourceExpected),docId:sourceExpected.docId,challenge,sessionId,
      confirmation:{action:term?'confirm-and-continue':'confirm-and-submit',stage,userInitiated:true,mode:'configured-policy',challengeId:challenge.id,confirmedAt:now,approvedKeys:items.map(item=>item.key)}};};
  const attrs={'registration-start':'v1','owner-id':identity.ownerId,'product-id':identity.productId,'company-code':identity.company.code,'identity-digest':identityDigest,'packet-digest':sourceExpected.packetDigest,'request-id':sourceExpected.requestId,'body-sha256':sourceExpected.bodySha256,'prepared-body-sha256':sourceExpected.preparedBodySha256};
  const arm=(trusted=true,patch={})=>{const values={...attrs,...patch},button={disabled:false,getAttribute:key=>values[key.replace('data-supplier-hub-','')]??null,closest:()=>values['registration-start']==='v1'?button:null};document.emit('click',{isTrusted:trusted,target:button});};
  let count=0;
  return{scope,view,identity,identityDigest,sourceExpected,requests,input,arm,document,window,replies,get sourceReads(){return sourceReads;},
    advance(ms){now+=ms;},setCurrent(value){sourceCurrent=value;},setHook(value){hook=value;},
    async confirm(value=input()){return new Promise(resolve=>handler({type:'YOOFAM_CONFIRM_NATIVE_PRODUCT_DOCUMENT_ACTION',expected:value},{id:'extension'},result=>resolve(plain(result))));},
    async probe(value=input()){const requestId='probe-'+(++count);window.emit('message',{source:window,origin,data:{channel:'YOOFAM_CONFIGURED_REGISTRATION_CONSENT',type:'probe',requestId,expected:value}});for(let n=0;n<200;n++){const result=replies.find(row=>row.requestId===requestId);if(result)return result.result;await new Promise(resolve=>setTimeout(resolve,2));}assert.fail('probe did not reply');},
    cancel(){window.emit('message',{source:window,origin,data:{channel:'YOOFAM_CONFIGURED_REGISTRATION_CONSENT',type:'cancel'}});}};
}

test('configured mode, saved policy, synthetic click and a preparation-only button cannot arm registration',async()=>{
  for(const mode of ['none','synthetic','prepare-only','hidden']){const f=await contentFixture();if(mode==='synthetic')f.arm(false);if(mode==='prepare-only')f.arm(true,{'registration-start':null});if(mode==='hidden'){f.document.visibilityState='hidden';f.arm();}
    assert.deepEqual(await f.probe(),{ok:true,confirmation:null});assert.equal((await f.confirm()).ok,false);assert.equal(f.requests.length,0);}
});

test('native registration intent reuses exact saved terms through two stages and final receipt intent while Hub has focus',async()=>{
  const f=await contentFixture();f.arm();f.document.visibilityState='hidden';const stageProofs=[];
  assert.equal((await f.probe(f.input('logisticsPage'))).confirmation,null);
  for(const stage of ['productPage','imagePage','logisticsPage']){const input=f.input(stage),probe=await f.probe(input);assert.equal(probe.confirmation.mode,'configured-policy');input.confirmation=probe.confirmation;
    const result=await f.confirm(input);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.consentProof.kind,'configured-policy');assert.equal(result.humanConfirmedAt,undefined);
    assert.equal(configuredConsentProofValid(result.consentProof,{identity:f.identity,identityDigest:f.identityDigest,packetDigest:f.sourceExpected.packetDigest,requestId:f.sourceExpected.requestId,docId:input.docId,challenge:input.challenge}),true);
    if(stage!=='logisticsPage')stageProofs.push({consentProof:result.consentProof});else assert.equal(configuredFinalMatchesStages(result.consentProof,stageProofs),true);
    assert.equal((await f.confirm(input)).ok,false,'same challenge cannot replay');
  }
  assert.equal((await f.probe()).confirmation,null);assert.ok(f.sourceReads>=12);assert.ok(f.requests.every(row=>row.path==='/api/supplier-hub/registration-consents'&&row.init.cache==='no-store'&&row.init.credentials==='same-origin'&&row.init.redirect==='error'&&row.init.method===undefined));
});

for(const mode of ['wrong-owner','wrong-company','wrong-actor','withdrawn','missing-policy','missing-password','connection-version','connection-disabled','terms-text','terms-title','unknown-kind'])test(`configured ${mode} requires manual review and emits no authorization`,async()=>{
  const f=await contentFixture();f.arm();
  if(mode==='wrong-owner')f.view.ownerId='other';if(mode==='wrong-company')f.view.company={code:'A01464742',name:'와이홉'};if(mode==='wrong-actor')f.view.policies[0].actor.credentialVersion++;
  if(mode==='withdrawn')f.view.policies[0].enabled=false;if(mode==='missing-policy')f.view.policies.pop();if(mode==='missing-password')f.view.connections[0].hasPassword=false;
  if(mode==='connection-version')f.view.connections[0].revision++;if(mode==='connection-disabled')f.view.connections[0].enabled=false;if(mode==='unknown-kind')f.view.policies[0].kind='other';
  if(mode==='terms-text'||mode==='terms-title'){f.view.policies[0].terms[mode==='terms-text'?'termsText':'title']+=' changed';f.view.policies[0].termsSha256=await digest({format:'supplier-hub-displayed-terms-v1',terms:f.view.policies[0].terms});}
  assert.equal((await f.probe()).confirmation,null);assert.equal((await f.confirm()).ok,false);
});

test('a unique current complete account pair permits inactive and incomplete prior profiles; two complete accounts require manual selection',async()=>{
  for(const mode of ['inactive','stale','incomplete','ambiguous']){const f=await contentFixture(),other='44444444-4444-4444-8444-444444444444';f.arm();
    f.view.connections.push({...clone(f.view.connections[0]),id:other});
    const extra=f.view.policies.slice(0,mode==='incomplete'?1:2).map(row=>({...clone(row),connectionId:other,...(mode==='inactive'?{enabled:false}:mode==='stale'?{connectionRevision:6}:{})}));f.view.policies.push(...extra);
    const result=await f.probe();assert.equal(result.confirmation?.mode??null,mode==='ambiguous'?null:'configured-policy');
  }
});

for(const mode of ['packet','document','intent-expiry','challenge-expiry','cancel','source','post-read-withdrawal','actor-change-after-stage'])test(`configured ${mode} cannot continue the original registration intent`,async()=>{
  const f=await contentFixture();f.arm();let input=f.input();
  if(mode==='packet')input.sourceExpected.packetDigest='9'.repeat(64);if(mode==='document'){await f.confirm(input);input=f.input('imagePage');input.docId=input.challenge.docId='different-doc';input.sourceExpected.docId='different-doc';}
  if(mode==='intent-expiry'){f.advance(900001);input=f.input();}if(mode==='challenge-expiry')f.advance(120001);if(mode==='cancel')f.cancel();if(mode==='source')f.setCurrent(false);
  if(mode==='post-read-withdrawal')f.setHook((kind,count)=>{if(kind==='source'&&count===2)f.view.policies[0].enabled=false;});
  if(mode==='actor-change-after-stage'){assert.equal((await f.confirm(input)).ok,true);input=f.input('imagePage');f.view.actor.credentialVersion++;for(const policy of f.view.policies)policy.actor.credentialVersion++;}
  assert.equal((await f.confirm(input)).ok,false);
});

async function engineFixture(){
  const f=await singleDocumentFixture(undefined,{stageFlow:true,finalNoItems:true,receipt:{state:'pending',evidence:'document-receipt',sourceStatus:'SUBMITTED',registered:false,qvtRequestId:'configured-request',receiptId:'configured-request',skuId:undefined}});
  f.adapter.qualifyPreparedDraft=async input=>({readOnly:true,docId:input.docId,company:clone(f.context.identity.company),identityDigest:f.context.identityDigest,packetDigest:f.context.packetDigest,sourcePlanSha256:f.context.identity.fingerprint,metadataObserved:true,checkedAt:f.now});
  f.adapter.readNavigation=async input=>{const stage=['productPage','imagePage','logisticsPage'][f.stageIndex],base={docId:input.docId,company:clone(f.context.identity.company),productName:f.packet.body.productName,stage};return stage==='logisticsPage'?{...base,readyForSubmit:true}:f.stageItems[stage].every(item=>item.checked)?{...base,readyForSubmit:false,readyForConsent:false,readyForContinue:true}:{...base,readyForSubmit:false,readyForConsent:true};};
  const intentId='22222222-2222-4222-8222-222222222222';
  f.proof=input=>({format:'yoofam-configured-registration-authorization-v1',kind:'configured-policy',intentId,startedAt:f.now,expiresAt:f.now+900000,checkedAt:f.now,
    ownerId:f.context.identity.ownerId,company:clone(f.context.identity.company),actor:clone(actor),connectionId,connectionRevision:7,identityDigest:f.context.identityDigest,packetDigest:f.context.packetDigest,requestId:f.packet.requestId,docId:input.docId,challengeId:input.challenge.id,stage:input.challenge.stage,
    policies:(input.challenge.stage==='logisticsPage'?['price-data','label-contact']:[input.challenge.stage==='productPage'?'price-data':'label-contact']).map(kind=>({kind,revision:kind==='price-data'?1:2,termsSha256:(kind==='price-data'?'a':'b').repeat(64)}))});
  f.adapter.verifyHumanConfirmation=async input=>({confirmed:true,challengeId:input.challenge.id,identityDigest:f.context.identityDigest,confirmedAt:f.now,consentProof:f.proof(input)});
  f.draft=createSupplierHubDocumentReceiver({adapter:f.adapter,store:f.storage.store,now:()=>f.now},{format:SINGLE_DOCUMENT_FORMAT,identity:singleDocumentIdentity,draftOnly:true,nativeLifecycle:true});
  await f.draft.prepareDraft(f.packet,f.sender);f.initial=await f.draft.reviewPreparedDraft(f.packet,f.sender);return f;
}

test('configured engine evidence stays distinct from human receipts and final intent requires both prior policy stages',async()=>{
  const f=await engineFixture();try{let state=f.initial;for(let count=0;count<3;count++){state=await f.draft.confirmPreparedDraft(f.packet,f.sender,{...f.action(state),mode:'configured-policy'});assert.equal(state.error,undefined,JSON.stringify(state));}
    assert.equal(state.state,'pending');assert.equal(f.submitted,1);const stored=f.storage.get(f.context.key);assert.equal(stored.humanConfirmedAt,undefined);assert.equal(stored.consentProof.kind,'configured-policy');assert.ok(stored.stageConsents.every(entry=>entry.consentProof.kind==='configured-policy'));f.assertPreserved();
  }finally{f.close();}
});

for(const mode of ['missing-proof','foreign-member','foreign-document','different-intent','different-connection','different-policy','human-proof'])test(`configured engine rejects ${mode} before accepting the affected checkbox or final submit`,async()=>{
  const f=await engineFixture();try{let state=f.initial;
    if(['different-intent','different-connection','different-policy'].includes(mode)){state=await f.draft.confirmPreparedDraft(f.packet,f.sender,{...f.action(state),mode:'configured-policy'});state=await f.draft.confirmPreparedDraft(f.packet,f.sender,{...f.action(state),mode:'configured-policy'});}
    const old=f.proof;f.adapter.verifyHumanConfirmation=async input=>{const proof=old(input);if(mode==='foreign-member')proof.ownerId='other';if(mode==='foreign-document')proof.docId='other';if(mode==='different-intent')proof.intentId='33333333-3333-4333-8333-333333333333';if(mode==='different-connection')proof.connectionRevision++;if(mode==='different-policy')proof.policies[0].revision++;
      return{confirmed:true,challengeId:input.challenge.id,identityDigest:f.context.identityDigest,confirmedAt:f.now,...(mode==='missing-proof'?{}:{consentProof:proof})};};
    const result=await f.draft.confirmPreparedDraft(f.packet,f.sender,{...f.action(state),...(mode==='human-proof'?{}:{mode:'configured-policy'})});assert.ok(result.error,JSON.stringify(result));assert.equal(f.submitted,0);if(state.challenge.stage==='productPage')assert.equal(f.stageAcceptCounts.productPage,0);f.assertPreserved();
  }finally{f.close();}
});

test('configured current and prior-stage checkpoint proofs cannot be transplanted into the ordinary unqualified document lane',async()=>{
  for(const mode of ['current','prior-stage']){const f=await engineFixture();try{
    if(mode==='prior-stage')await f.draft.confirmPreparedDraft(f.packet,f.sender,{...f.action(f.initial),mode:'configured-policy'});
    const row=f.storage.get(f.context.key);if(mode==='current')row.consentProof=f.proof({docId:f.initial.docId,challenge:f.initial.challenge});
    for(const key of ['preparedLifecycle','preparationOrigin','draftOnly'])delete row[key];
    const control=clone(row);delete control.consentProof;for(const stage of control.stageConsents)delete stage.consentProof;
    f.storage.force(f.context.key,control);assert.equal((await f.receiver.recover(f.packet,f.sender)).recovered,true,'the corresponding legacy checkpoint remains valid without configured proofs');
    f.storage.force(f.context.key,row);const before=f.calls.length;await assert.rejects(f.receiver.recover(f.packet,f.sender),{code:'CHECKPOINT'});assert.equal(f.calls.length,before);assert.equal(f.submitted,0);f.assertPreserved();
  }finally{f.close();}}
});

for(const company of companies)test(`${company.code}: actual native source, isolated policy verifier, browser adapter and official stage buttons reach one document receipt without human prompt`,async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.now()});let f;
  try{
    f=await nativeReceiverReceiptFixture(company,{configuredConsent:true,browser:{stageFlow:true,finalNoItems:true}});
    const connection={id:connectionId,service:'supplier-hub',alias:'합성 회원 계정',loginId:actor.email,enabled:true,hasPassword:true,revision:7,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    const displayed=[{stage:'productPage',key:'msrpAgree',id:'agreeMSRPTerm',title:f.stageTitles.productPage,text:'MSRP, OSRP 데이터 이용 약관 * 자세히보기 이용약관을 읽고 동의합니다.',termsText:f.stageTerms.productPage.join('\n')},
      {stage:'imagePage',key:'labelContactAgreed',id:'agreeLabelContact',title:f.stageTitles.imagePage,text:'합성 라벨 업무용 연락처 제공 및 공개 동의 * 자세히보기 이용약관을 읽고 동의합니다.',termsText:f.stageTerms.imagePage.join('\n')}];
    f.state.registrationConsents={format:'yoofam-member-registration-consents-v1',ownerId:f.context.identity.ownerId,company:clone(company),actor:clone(actor),connections:[connection],policies:await Promise.all(displayed.map(async(term,index)=>({kind:['price-data','label-contact'][index],connectionId,connectionRevision:7,revision:index+1,enabled:true,termsVersion:'supplier-hub-displayed-terms-v1',termsSha256:await digest({format:'supplier-hub-displayed-terms-v1',terms:term}),terms:term,acceptedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),actor:clone(actor)})))};
    const receiver=createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store}),sourceBefore=f.source.state(),protectedBefore=canonical(f.documents.get(f.prior.docId));
    f.armConfiguredRegistration();let state=await receiver.prepareDraft(f.packet,f.sender);assert.equal(state.state,'validated',JSON.stringify(state));const uploads=canonical(f.state.uploads);
    state=await receiver.reviewPreparedDraft(f.packet,f.sender);f.configuredAppHidden();
    for(const stage of ['productPage','imagePage','logisticsPage']){assert.equal(state.challenge.stage,stage,JSON.stringify(state));const probe=await f.probeConfiguredRegistration(state.challenge);assert.equal(probe.ok,true,JSON.stringify(probe));assert.equal(probe.confirmation?.mode,'configured-policy',JSON.stringify(probe));state=await receiver.confirmPreparedDraft(f.packet,f.sender,probe.confirmation);assert.equal(state.error,undefined,JSON.stringify(state));}
    assert.equal(state.state,'pending');assert.equal(state.receipt.qvtRequestId,'000769-QVT-raw');assert.equal(f.submitted,1);assert.equal(f.state.humanConfirmations.length,0);assert.deepEqual(f.stageApprovalClicks,{productPage:1,imagePage:1});
    const stored=f.storage.get(f.context.key);assert.equal(stored.humanConfirmedAt,undefined);assert.equal(stored.consentProof.kind,'configured-policy');assert.ok(stored.stageConsents.every(row=>row.consentProof.kind==='configured-policy'));
    assert.equal(canonical(f.state.uploads),uploads);assert.equal(f.source.state(),sourceBefore);assert.equal(canonical(f.documents.get(f.prior.docId)),protectedBefore);
    assert.ok(f.state.appReads.filter(row=>new URL(row.url).pathname==='/api/supplier-hub/registration-consents').length>=12);
    assert.equal((await receiver.observePreparedDraft(f.packet,f.sender)).state,'pending');assert.equal(f.submitted,1);
  }finally{f?.close();t.mock.timers.reset();}
});
