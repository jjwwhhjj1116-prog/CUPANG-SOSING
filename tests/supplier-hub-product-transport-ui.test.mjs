import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash, webcrypto } from 'node:crypto';
import { createProductDocumentPacket,PRODUCT_DOCUMENT_REQUEST_TTL } from '../extensions/supplier-hub/product-document.mjs';
import { productDocumentIdentity } from '../extensions/supplier-hub/product-document-receiver.mjs';
import { singleDocumentIdentity } from '../extensions/supplier-hub/single-document.mjs';
import { singlePacket, singleDocumentFixture, SINGLE_COMPANIES, SINGLE_SENDER } from './helpers/supplier-hub-single-document.mjs';
import {SupplierHubRejectionDetails} from './helpers/rejection-details-ui.mjs';
import {productValidationRejectionFixture} from './helpers/product-validation-rejection.mjs';
import {normalizeRejectionDetails} from '../extensions/supplier-hub/rejection-details.mjs';
import {runReservedSegments} from '../app/supplier-hub-reserved-work.mjs';
import {sourceReadError} from '../extensions/supplier-hub/product-document-source.mjs';

const releaseVersion=JSON.parse(fs.readFileSync(new URL('../extensions/supplier-hub/manifest.json',import.meta.url),'utf8')).version;
const releaseDownload='/downloads/yoofam-plus-supplier-hub-extension-'+releaseVersion+'.zip';
assert.ok(fs.existsSync(new URL('../public'+releaseDownload,import.meta.url)),'current integrated extension package exists');

const fixtureURL = new URL('./supplier-hub-product-client.test.mjs', import.meta.url), source = fs.readFileSync(fixtureURL, 'utf8');
const ast = ts.createSourceFile(fixtureURL.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), parts = [];
for (const statement of ast.statements) {
  if (ts.isVariableStatement(statement) && statement.pos < source.indexOf('async function fixture(') || ts.isFunctionDeclaration(statement) && ['fixture', 'groupRecord', 'legacyRecord'].includes(statement.name?.text)) parts.push(statement.getText(ast));
}
const declarations = parts.join('\n').replaceAll('import.meta.url', JSON.stringify(fixtureURL.href));
const factory = vm.runInNewContext(declarations + '\n({fixture,groupRecord,legacyRecord})', { assert, fs, path, vm, ts, createRequire, fileURLToPath, createHash, webcrypto, createProductDocumentPacket, productDocumentIdentity, singleDocumentIdentity, singlePacket, SINGLE_COMPANIES, SINGLE_SENDER,
  URL, Response, Request, TextEncoder, TextDecoder, Uint8Array, AbortController, Date, JSON, Array, Object, Error, Intl, structuredClone, setImmediate });
const native = createRequire(import.meta.url), plain = value => JSON.parse(JSON.stringify(value)), cases = [];
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? tree.type === SupplierHubRejectionDetails ? nodes(tree.type(tree.props)) : [tree, ...nodes(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join(' ') : tree && typeof tree === 'object' ? tree.type === SupplierHubRejectionDetails ? text(tree.type(tree.props)) : text(tree.props?.children) : tree == null ? '' : String(tree);
const turn = () => new Promise(resolve => setImmediate(resolve)), deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
const open = '전체 옵션 전송 자료 확인', start = '전체 상품 견적 등록 시작', close = '전송 자료 확인 닫기', recover = '같은 문서 저장 결과 확인';
const release='검증 반려 확인 · 수정 허용';
const prepareDraft='새 견적 초안 만들기 · 제출 안 함',recoverDraft='같은 초안 저장 결과 확인 · 읽기 전용',continueDraft='같은 초안 준비 계속 · 제출 안 함';
const draftResult=(f,requestId,state='validated',extra={})=>f.state(state,{requestId,draftOnly:true,
 draftProof:{evidence:'document-draft-preparation',validatedSteps:state==='validated'?[2,3,4,5]:[],checkpointSequence:12,observedAt:f.clock.now,submitted:false,consented:false},...extra});
function allowDraft(h,run){h.f.bridge=async payload=>payload.action==='preview'?{...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,createRetryAvailable:true,createRetryContinuationAvailable:true}:run(payload);}

const reviewPrepared='준비한 새 견적서 등록전송',confirmPrepared='현재 문서 동의 확인 · 계속',recoverPrepared='준비한 문서 단계 확인 · 읽기 전용';
const registerDraft='견적서 등록전송 시작';
function preparedResult(h,payload,state,sequence,extra={}){
 const submitted=['pending','accepted','rejected','submit-requested'].includes(state);
 h.qualifiedAt??=h.f.clock.now;
 return h.f.state(state,{requestId:payload.packet.requestId,draftOnly:true,preparedLifecycle:true,lifecycleProof:{evidence:'native-prepared-draft-lifecycle',preparedCheckpointSequence:12,qualifiedCheckpointSequence:13,checkpointSequence:sequence,qualifiedAt:h.qualifiedAt,observedAt:h.f.clock.now,validatedSteps:[2,3,4,5],consentRequested:sequence>14,submitRequested:submitted},...extra});
}
function allowPrepared(h,run){h.f.bridge=async payload=>payload.action==='preview'?{...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,preparedLifecycleAvailable:true}:payload.action==='prepareDraft'?draftResult(h.f,payload.packet.requestId):run(payload);}
function checkTerms(h){for(const node of nodes(h.render()).filter(node=>node.type==='input'&&node.props.type==='checkbox')){assert.equal(Boolean(node.props.disabled),false);node.props.onChange({target:{checked:true}});}h.flush();}

for(const company of SINGLE_COMPANIES)test(`${company.code}: explicit registration click prepares once and hands the exact validated document to consent without unlocking`,async()=>{
 const h=await fixture(company);try{
  allowPrepared(h,payload=>{assert.equal(payload.action,'reviewPreparedDraft');return preparedResult(h,payload,'awaiting-stage-consent',14,{challenge:h.f.challenge('productPage')});});
  await h.idle();assert.equal(h.button(registerDraft),undefined);assert.equal(h.f.sent.length,0);await h.click(open);
  assert.ok(h.button(prepareDraft));const click=h.button(registerDraft).props.onClick,lockStart=h.lockPairs.length,refreshStart=h.refreshCalls.length;
  click();click();await h.idle();
  assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','prepareDraft','reviewPreparedDraft']);
  const packets=h.f.sent.map(row=>row.payload.packet);assert.equal(new Set(packets.map(packet=>packet.requestId)).size,1);
  assert.ok(packets.every(packet=>packet.review.reviewDigest===packets[0].review.reviewDigest&&packet.review.originalBodySha256===packets[0].review.originalBodySha256&&packet.review.preparedBodySha256===packets[0].review.preparedBodySha256));
  assert.equal(new Set(h.refreshCalls.slice(refreshStart)).size,1,'one admitted controller spans preparation and handoff');
  assert.ok(h.lockPairs.slice(lockStart).every(pair=>pair[0]===true&&pair[1]===true),'no intermediate close/source unlock');
  assert.equal(h.button(registerDraft),undefined);assert.equal(h.button(confirmPrepared).props.disabled,true);assert.match(h.text(),/마지막 문단/);
  assert.equal(h.f.sent.some(row=>row.payload.action==='confirmPreparedDraft'),false,'registration intent does not accept terms');assert.equal(h.f.history.length,0);assert.equal(h.stored.size,1);
  click();await h.idle();assert.equal(h.f.sent.length,3);assert.ok(h.f.calls.every(row=>row.method==='GET'));
 }finally{h.close();}
});

test('new preparation-only click and recovery never inherit the explicit registration intent',async()=>{
 const h=await fixture();try{
  allowPrepared(h,payload=>{assert.equal(payload.action,'recoverPreparedDraft');return draftResult(h.f,payload.packet.requestId,'validated',{recovered:true});});
  await h.idle();await h.click(open);const oldRegister=h.button(registerDraft).props.onClick;await h.click(prepareDraft);
  assert.ok(h.button(reviewPrepared));assert.equal(h.f.sent.length,2);oldRegister();await h.idle();assert.equal(h.f.sent.length,2);
  await h.click(recoverDraft);assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','prepareDraft','recoverPreparedDraft']);assert.equal(h.f.history.length,0);
 }finally{h.close();}
});

test('registration does not hand off incomplete, rejected, errored, malformed or missing preparation acknowledgements',async()=>{
 for(const mode of ['incomplete','rejected','error','malformed','lost-ACK']){const h=await fixture();try{
  h.f.bridge=async payload=>{
   if(payload.action==='preview')return {...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,preparedLifecycleAvailable:true};
   assert.equal(payload.action,'prepareDraft');if(mode==='lost-ACK')return undefined;
   const result=draftResult(h.f,payload.packet.requestId,mode==='incomplete'?'updated':mode==='rejected'?'validation-rejected':'validated');
   if(mode==='error')result.error={code:'SOURCE_CHANGED',message:'저장한 원문·이미지 검토가 바뀌었습니다.'};
   if(mode==='malformed')result.draftProof.validatedSteps=[2,3,4];return result;
  };
  await h.idle();await h.click(open);const old=h.button(registerDraft).props.onClick;
  if(mode==='lost-ACK'){old();h.flush();await h.wait(()=>h.f.sent.length===2);h.f.advance(120001);await h.idle();}else await h.click(registerDraft);
  old();await h.idle();assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','prepareDraft'],mode);assert.equal(h.stored.size,1);assert.equal(h.button(confirmPrepared),undefined);assert.equal(h.f.history.length,0);
 }finally{h.close();}}
});

test('registration preflight authentication and reservation save failures cannot start preparation or handoff',async()=>{
 for(const mode of ['auth','save']){const options={},h=await fixture(SINGLE_COMPANIES[0],options);try{
  allowPrepared(h,()=>assert.fail('no registration action before admission'));
  await h.idle();await h.click(open);if(mode==='auth')h.f.actor.ownerId='another-owner';else options.storageWriteError=true;
  await h.click(registerDraft);assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview']);assert.equal(h.f.history.length,0);assert.equal(h.stored.size,0);
 }finally{h.close();}}
});

test('combined registration lost handoff ACK retains its exact request and recovery never replays preparation or qualification',async()=>{
 const h=await fixture();try{
  allowPrepared(h,payload=>payload.action==='reviewPreparedDraft'?undefined:preparedResult(h,payload,'navigation-ready',14,{recovered:true}));
  await h.idle();await h.click(open);const stale=h.button(registerDraft).props.onClick;stale();h.flush();await h.wait(()=>h.f.sent.length===3);h.f.advance(120001);await h.idle();
  assert.ok(h.button(recoverDraft));assert.equal(h.button(registerDraft),undefined);assert.deepEqual(h.lockPairs.at(-1),[true,true]);
  stale();await h.idle();assert.equal(h.f.sent.length,3);const reservation=[...h.stored.entries()];await h.click(recoverDraft);
  assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','prepareDraft','reviewPreparedDraft','recoverPreparedDraft']);
  assert.equal(new Set(h.f.sent.map(row=>row.payload.packet.requestId)).size,1);assert.ok(h.button('같은 문서 다음 단계 계속'));assert.equal(h.button(confirmPrepared),undefined);
  assert.deepEqual([...h.stored.entries()],reservation);assert.equal(h.f.history.length,0);assert.ok(h.f.calls.every(row=>row.method==='GET'));
 }finally{h.close();}
});

test('registration handoff expires on cancellation, disabled view, owner/company/source changes, reservation replacement and review ABA',async()=>{
 for(const mode of ['cancel','disabled','owner','company','source','reservation','review-ABA']){const h=await fixture(),reply=deferred();let closed=false;try{
  allowPrepared(h,()=>assert.fail('stale preparation must not reach registration'));
  const originalBridge=h.f.bridge;h.f.bridge=async payload=>payload.action==='prepareDraft'?reply.promise:originalBridge(payload);
  await h.idle();await h.click(open);h.button(registerDraft).props.onClick();h.flush();await h.wait(()=>h.f.sent.length===2);
  const payload=h.f.sent[1].payload,props=h.props(),reservation=[...h.stored.entries()];
  if(mode==='cancel'){h.close();closed=true;}
  if(mode==='disabled')h.render({...props,disabled:true});
  if(mode==='owner')h.f.actor.ownerId='another-owner';
  if(mode==='company')h.f.actor.company=SINGLE_COMPANIES[1];
  if(mode==='source')h.f.refresh=async()=>({...h.f.review,preparedBodySha256:'f'.repeat(64)});
  if(mode==='reservation'){const[key,raw]=reservation[0];h.stored.set(key,JSON.stringify({...JSON.parse(raw),requestId:'00000000-0000-4000-8000-000000000000'}));}
  if(mode==='review-ABA'){h.render({...props,review:{...props.review,reviewDigest:'f'.repeat(64)}});h.render(props);}
  reply.resolve(draftResult(h.f,payload.packet.requestId));
  if(closed){for(let i=0;i<6;i++)await turn();}else await h.idle();
  assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','prepareDraft'],mode);assert.equal(h.f.history.length,0);assert.equal(h.stored.size,1);
 }finally{reply.resolve();if(!closed)h.close();}}
});

for(const company of SINGLE_COMPANIES)test(`${company.code}: prepared UI explicitly checks two complete terms stages, submits once and saves exact receipt without unqualified start`,async()=>{
 const h=await fixture(company);let confirmations=0;try{
  allowPrepared(h,payload=>{
   if(payload.action==='reviewPreparedDraft')return preparedResult(h,payload,'awaiting-stage-consent',14,{challenge:h.f.challenge('productPage')});
   if(payload.action==='confirmPreparedDraft'){
    confirmations++;assert.ok(payload.confirmation);if(confirmations===1)return preparedResult(h,payload,'awaiting-stage-consent',17,{challenge:{...h.f.challenge('imagePage'),id:'2'.repeat(64)}});
    if(confirmations===2)return preparedResult(h,payload,'awaiting-consent',20,{challenge:{...h.f.challenge('logisticsPage'),id:'3'.repeat(64)}});
    return preparedResult(h,payload,'pending',23,{receipt:h.f.observation('SUBMITTED').receipt});
   }
   assert.equal(payload.action,'observePreparedDraft');return preparedResult(h,payload,'accepted',24,{receipt:h.f.observation('FINISHED').receipt});
  });
  await h.idle();await h.click(open);await h.click(prepareDraft);assert.ok(h.button(reviewPrepared));assert.equal(h.button(start),undefined);await h.click(reviewPrepared);
  assert.match(h.text(),/마지막 문단/);assert.equal(h.button(confirmPrepared).props.disabled,true);checkTerms(h);await h.click(confirmPrepared);
  assert.equal(h.button(confirmPrepared).props.disabled,true,'next stage never inherits previous checked keys');checkTerms(h);await h.click(confirmPrepared);
  assert.equal(h.button(confirmPrepared).props.disabled,false,'empty final challenge still requires explicit submit click');assert.equal(h.f.history.length,0);await h.click(confirmPrepared);
  assert.equal(h.f.history[0].receipt.sourceStatus,'SUBMITTED');assert.deepEqual(h.lockPairs.at(-1),[true,true]);assert.equal(h.button(confirmPrepared),undefined);assert.doesNotMatch(h.text(),/약관 동의와 최종 제출은 진행하지 않습니다|현재 상품은 전송하지 않았습니다|아래 현재 약관/);
  await h.click('접수 결과 조회');assert.equal(h.f.history[0].receipt.sourceStatus,'FINISHED');assert.deepEqual(h.lockPairs.at(-1),[true,false]);
  assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','prepareDraft','reviewPreparedDraft','confirmPreparedDraft','confirmPreparedDraft','confirmPreparedDraft','observePreparedDraft']);assert.equal(confirmations,3);assert.equal(new Set(h.f.sent.map(row=>row.payload.packet.requestId)).size,1);assert.equal(h.f.calls.filter(row=>row.method==='POST').length,2);
 }finally{h.close();}
});

test('prepared lost consent ACK recovers navigation-ready read-only and continues only on explicit same-document click',async()=>{
 const h=await fixture();let recovering=false;try{allowPrepared(h,payload=>{
  if(payload.action==='reviewPreparedDraft')return preparedResult(h,payload,'awaiting-stage-consent',recovering?18:14,{challenge:h.f.challenge(recovering?'imagePage':'productPage')});
  if(payload.action==='confirmPreparedDraft')return undefined;
  assert.equal(payload.action,'recoverPreparedDraft');recovering=true;return preparedResult(h,payload,'navigation-ready',17,{recovered:true});
 });await h.idle();await h.click(open);await h.click(prepareDraft);await h.click(reviewPrepared);checkTerms(h);const old=h.button(confirmPrepared).props.onClick;old();h.flush();await h.wait(()=>h.f.sent.length===4);h.f.advance(120001);await h.idle();assert.ok(h.button(recoverPrepared));old();h.flush();assert.equal(h.f.sent.length,4);
 await h.click(recoverPrepared);assert.ok(h.button('같은 문서 다음 단계 계속'));assert.equal(h.button(confirmPrepared),undefined);assert.equal(h.f.sent.length,5);await h.click('같은 문서 다음 단계 계속');assert.ok(h.button(confirmPrepared));assert.equal(h.button(confirmPrepared).props.disabled,true);assert.equal(h.f.sent.filter(row=>row.payload.action==='confirmPreparedDraft').length,1);assert.equal(h.f.history.length,0);assert.equal(h.stored.size,1);
 }finally{h.close();}
});

test('first qualification cannot replace a different prepared checkpoint or survive a review ABA callback',async()=>{
 for(const mode of ['checkpoint','ABA']){const h=await fixture();try{allowPrepared(h,payload=>{const result=preparedResult(h,payload,'awaiting-stage-consent',16,{challenge:h.f.challenge('productPage')});result.lifecycleProof.preparedCheckpointSequence=14;result.lifecycleProof.qualifiedCheckpointSequence=15;return result;});await h.idle();await h.click(open);await h.click(prepareDraft);const old=h.button(reviewPrepared).props.onClick;
  if(mode==='ABA'){const props=h.props();h.render({...props,review:{...props.review,reviewDigest:'a'.repeat(64)}});h.render(props);old();h.flush();assert.equal(h.f.sent.length,2);}
  else{await h.click(reviewPrepared);assert.equal(h.button(confirmPrepared),undefined);assert.ok(h.button(recoverDraft));assert.match(h.text(),/다른 등록 기록/);assert.deepEqual(h.lockPairs.at(-1),[true,true]);}
  assert.equal(h.f.history.length,0);assert.equal(h.stored.size,1);
 }finally{h.close();}}
});

test('older preview exposes only the direct integrated-extension download and no new draft action',async()=>{
 const h=await fixture();try{await h.idle();await h.click(open);assert.equal(h.button(prepareDraft),undefined);assert.equal(h.button(start),undefined);
  const link=nodes(h.render()).find(node=>node.type==='a'&&node.props.download!==undefined);assert.equal(link.props.href,releaseDownload);assert.ok(h.f.calls.every(call=>call.method==='GET'));assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview']);
 }finally{h.close();}
});
for(const company of SINGLE_COMPANIES)test(`${company.code}: explicit new draft owns one reservation, reports actual document validation and unlocks only outer close`,async()=>{
 const h=await fixture(company);try{allowDraft(h,payload=>draftResult(h.f,payload.packet.requestId,'validated',payload.action==='recoverDraft'?{recovered:true}:{}));
  await h.idle();await h.click(open);assert.equal(h.button(start),undefined);const click=h.button(prepareDraft).props.onClick;click();click();await h.idle();
  assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','prepareDraft']);assert.equal(h.stored.size,1);assert.deepEqual(h.lockPairs.at(-1),[true,false]);assert.match(h.text(),/초안 문서 new-document-728/);assert.match(h.text(),/검증\s*4\s*\/4/);assert.match(h.text(),/미제출/);assert.equal(h.button(prepareDraft),undefined);assert.equal(h.button(start),undefined);assert.equal(h.button(continueDraft),undefined);assert.ok(h.button(recoverDraft));assert.equal(h.f.history.length,0);assert.ok(h.f.calls.every(call=>call.method==='GET'));
  click();h.flush();assert.equal(h.f.sent.length,2);await h.click(recoverDraft);assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','prepareDraft','recoverDraft']);assert.deepEqual(h.lockPairs.at(-1),[true,false]);assert.equal(h.stored.size,1);assert.equal(h.f.calls.some(call=>call.method==='POST'),false);
 }finally{h.close();}
});

test('lost draft ACK and remount preserve one operation; only exact read recovery can unlock closing',async()=>{
 const h=await fixture();let remount;try{allowDraft(h,async()=>undefined);await h.idle();await h.click(open);const old=h.button(prepareDraft).props.onClick;old();h.flush();await h.wait(()=>h.f.sent.length===2);h.f.advance(120001);await h.idle();assert.ok(h.button(recoverDraft));assert.equal(h.button(prepareDraft),undefined);assert.deepEqual(h.lockPairs.at(-1),[true,true]);old();h.flush();assert.equal(h.f.sent.length,2);
  const original=h.f.sent[1].payload.packet.requestId;h.close();remount=await fixture(SINGLE_COMPANIES[0],{stored:h.stored});allowDraft(remount,payload=>{assert.equal(payload.action,'recoverDraft');assert.equal(payload.packet.requestId,original);return draftResult(remount.f,original,'validated',{recovered:true});});
  await remount.idle();await remount.click('이전 문서 전송 자료 확인');assert.equal(remount.button(prepareDraft),undefined);assert.ok(remount.button(recoverDraft));await remount.click(recoverDraft);assert.deepEqual(plain(remount.f.sent.map(row=>row.payload.action)),['preview','recoverDraft']);assert.deepEqual(remount.lockPairs.at(-1),[true,false]);assert.equal(remount.stored.size,1);assert.equal(remount.f.calls.some(call=>call.method==='POST'),false);
 }finally{h.close();remount?.close();}
});

test('an authenticated missing-create result requires explicit retry consent and dispatches only once under the original reservation',async()=>{
 const h=await fixture();try{
  allowDraft(h,payload=>payload.action==='retryCreateDraft'?draftResult(h.f,payload.packet.requestId,'created',{recovered:true})
   :draftResult(h.f,payload.packet.requestId,'create-requested',{docId:null,needsRecovery:true,...(payload.action==='recoverDraft'?{error:{code:'READBACK_UNCONFIRMED',message:'생성 문서번호 미확인'}}:{})}));
  await h.idle();await h.click(open);await h.click(prepareDraft);const original=h.f.sent[1].payload.packet.requestId;
  assert.equal(h.button('기존 요청으로 생성 1회 재시도'),undefined);
  await h.click(recoverDraft);const retry=h.button('기존 요청으로 생성 1회 재시도');assert.ok(retry);assert.equal(retry.props.disabled,true);
  const checkbox=nodes(h.render()).find(node=>node.type==='input'&&node.props.type==='checkbox');assert.ok(checkbox);checkbox.props.onChange({target:{checked:true}});h.flush();
  const click=h.button('기존 요청으로 생성 1회 재시도').props.onClick;click();click();await h.idle();
  assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','prepareDraft','recoverDraft','retryCreateDraft']);
  assert.ok(h.f.sent.every(row=>row.payload.packet.requestId===original));assert.equal(h.stored.size,1);assert.ok(h.button(continueDraft));
  click();await h.idle();assert.equal(h.f.sent.filter(row=>row.payload.action==='retryCreateDraft').length,1);assert.equal(h.button('기존 요청으로 생성 1회 재시도'),undefined);
 }finally{h.close();}
});

const repairDraft='같은 문서 파일 저장·본문 복구 1회';
const repairProof=(h,attempted=false)=>({evidence:'document-draft-preparation',validatedSteps:[],checkpointSequence:12,observedAt:h.f.clock.now,submitted:false,consented:false,...(attempted?{existingDocumentRepairAttempted:true}:{})});
const recoverSavedTarget='원래 저장 문서 검증 탭 복구 · 파일·본문 재전송 안 함';
const savedTargetCapabilities={draftPreparationAvailable:true,preparedLifecycleAvailable:true,savedDraftTargetRecoveryAvailable:true,existingDocumentRepairAvailable:true,existingDocumentRepairRetryAvailable:true,existingDocumentRepairContinuationAvailable:true,existingDocumentRepairReservedResumeAvailable:true,existingDocumentRepairSegmentedAvailable:true};
function savedTargetProof(h,sequence=12){return {...repairProof(h,true),existingDocumentRepairRetryAttempted:true,existingDocumentRepairContinuationAttempted:true,existingDocumentRepairContinuationResumed:true,checkpointSequence:sequence};}
function savedTargetClosed(h,payload,code='SAVED_DRAFT_TARGET_CLOSED'){return draftResult(h.f,payload.packet.requestId,'update-requested',{docId:'2347603',needsRecovery:true,draftProof:savedTargetProof(h),error:{code,message:'원래 저장 문서의 전용 검증 탭이 닫혔습니다.'}});}
async function seedOriginalPreviewIntent(h){
 const pending=h.f.load('app/supplier-hub-product-pending.ts');
 await pending.claimProductDocumentPending(h.f.review,{packet:h.f.packet,preview:h.f.preview(),packetDigest:h.f.context.packetDigest,origin:h.f.window.location.origin},new AbortController().signal);
 return [...h.stored.entries()];
}

for(const company of SINGLE_COMPANIES)test(`${company.code}: completed bounded preview source failures release only view close before any session exists`,async()=>{
 for(const code of ['SOURCE_READ_TIMEOUT','SOURCE_READ_NETWORK','SOURCE_READ_RESPONSE','SOURCE_READ_HTTP']){const h=await fixture(company);try{
  const reservation=await seedOriginalPreviewIntent(h),original=h.f.packet.requestId;
  h.f.bridge=async()=>{throw sourceReadError({code,resource:'native-assets',...(code==='SOURCE_READ_HTTP'?{status:503}:{})});};
  await h.idle();assert.deepEqual(h.lockPairs.at(-1),[true,true]);await h.click('이전 문서 전송 자료 확인');
  assert.deepEqual(h.lockPairs.at(-1),[true,false],code);assert.match(h.text(),/이 화면을 닫아도 원래 요청/);assert.equal(h.button(prepareDraft),undefined);assert.equal(h.button(start),undefined);assert.equal(h.button(recoverDraft),undefined);
  assert.equal(h.f.sent.length,1);assert.equal(h.f.sent[0].payload.action,'preview');assert.equal(h.f.sent[0].payload.packet.requestId,original);assert.ok(h.f.calls.every(row=>row.method==='GET'));assert.deepEqual([...h.stored.entries()],reservation);
  h.close();assert.deepEqual([...h.stored.entries()],reservation,'view dismissal never clears the original reservation');
 }finally{h.close();}}
});

test('preview source failure dismissal resets on another connect, then remount recovers the same reserved request without create',async()=>{
 const h=await fixture(),held=deferred();let next;try{
  const reservation=await seedOriginalPreviewIntent(h),original=h.f.packet.requestId;
  h.f.bridge=async()=>{throw sourceReadError({code:'SOURCE_READ_TIMEOUT',resource:'native-assets'});};await h.idle();await h.click('이전 문서 전송 자료 확인');assert.deepEqual(h.lockPairs.at(-1),[true,false]);
  h.f.bridge=()=>held.promise;h.button('이전 문서 전송 자료 확인').props.onClick();h.flush();await h.wait(()=>h.f.sent.length===2);
  assert.deepEqual(h.lockPairs.at(-1),[true,true]);assert.doesNotMatch(h.text(),/이 화면을 닫아도 원래 요청/);
  const message=h.f.sent.at(-1);h.f.emit(message,null,{ok:false,error:sourceReadError({code:'SOURCE_READ_NETWORK',resource:'native-assets'}).message,code:'SOURCE_READ_NETWORK'});await h.idle();assert.deepEqual(h.lockPairs.at(-1),[true,false]);
  h.close();next=await fixture(SINGLE_COMPANIES[0],{stored:h.stored});allowDraft(next,payload=>{assert.equal(payload.action,'recoverDraft');return draftResult(next.f,payload.packet.requestId,'updated',{docId:'2347603',recovered:true});});
  await next.idle();assert.deepEqual(next.lockPairs.at(-1),[true,true]);await next.click('이전 문서 전송 자료 확인');assert.ok(next.button(recoverDraft));assert.equal(next.button(prepareDraft),undefined);assert.equal(next.button(start),undefined);await next.click(recoverDraft);
  assert.deepEqual(plain(next.f.sent.map(row=>row.payload.action)),['preview','recoverDraft']);assert.ok(next.f.sent.every(row=>row.payload.packet.requestId===original));assert.deepEqual([...next.stored.entries()],reservation);assert.equal(next.f.history.length,0);assert.ok(next.f.calls.every(row=>row.method==='GET'));
 }finally{held.resolve();h.close();next?.close();}
});

test('preview generic, ACK, scope and malformed source errors never release an existing reservation',async()=>{
 for(const mode of ['generic','ack-timeout','preflight-timeout','scope','malformed-message','wrong-resource','fresh-source']){const h=await fixture();try{
  const reservation=await seedOriginalPreviewIntent(h);h.f.bridge=async()=>{
   if(mode==='ack-timeout')return undefined;if(mode==='generic')throw Error('알 수 없는 실행 오류');
   if(mode==='scope')throw sourceReadError({code:'SOURCE_CHANGED'});
   if(mode==='preflight-timeout')throw Object.assign(Error('현재 회원·회사·견적 원본 확인 시간이 초과됐습니다. 상품은 전송하지 않았습니다.'),{code:'PRODUCT_SOURCE_PREFLIGHT_TIMEOUT'});
   const error=sourceReadError({code:'SOURCE_READ_TIMEOUT',resource:'native-assets'});if(mode==='malformed-message')error.message='검증되지 않은 오류';if(mode==='wrong-resource')error.message=error.message.replace('/api/products/:id/native-assets','https://unknown.invalid/private');throw error;
  };await h.idle();if(mode==='fresh-source')h.f.refresh=async()=>({...h.f.review,preparedBodySha256:'f'.repeat(64)});
  if(mode==='ack-timeout'){h.button('이전 문서 전송 자료 확인').props.onClick();h.flush();await h.wait(()=>h.f.sent.length===1);h.f.advance(180001);await h.idle();}else await h.click('이전 문서 전송 자료 확인');
  assert.deepEqual(h.lockPairs.at(-1),[true,true],mode);assert.doesNotMatch(h.text(),/이 화면을 닫아도 원래 요청/,mode);assert.deepEqual([...h.stored.entries()],reservation,mode);assert.ok(h.f.sent.every(row=>row.payload.action==='preview'));
 }finally{h.close();}}
});

test('preview close allowance is revoked by review ABA, disabled scope, storage error and changed intent while a read is pending',async()=>{
 for(const mode of ['review-ABA','disabled','storage','intent-pending']){const options={},h=await fixture(SINGLE_COMPANIES[0],options),held=deferred();try{
  const reservation=await seedOriginalPreviewIntent(h);h.f.bridge=async()=>{throw sourceReadError({code:'SOURCE_READ_TIMEOUT',resource:'native-assets'});};await h.idle();await h.click('이전 문서 전송 자료 확인');assert.deepEqual(h.lockPairs.at(-1),[true,false]);
  if(mode==='review-ABA'){const props=h.props();h.render({...props,review:{...props.review,reviewDigest:'a'.repeat(64)}});h.render(props);await h.idle();}
  if(mode==='disabled')h.render({...h.props(),disabled:true});if(mode==='storage'){options.storageReadError=true;h.flush();}
  if(mode==='intent-pending'){
   h.f.bridge=()=>held.promise;h.button('이전 문서 전송 자료 확인').props.onClick();h.flush();await h.wait(()=>h.f.sent.length===2);const message=h.f.sent.at(-1),[key,raw]=reservation[0];
   h.stored.set(key,JSON.stringify({...JSON.parse(raw),requestId:'00000000-0000-4000-8000-000000000000'}));h.storageChanged(key);h.f.emit(message,null,{ok:false,error:sourceReadError({code:'SOURCE_READ_TIMEOUT',resource:'native-assets'}).message,code:'SOURCE_READ_TIMEOUT'});await h.idle();
  }
  h.flush();assert.deepEqual(h.lockPairs.at(-1),[true,true],mode);assert.doesNotMatch(h.text(),/이 화면을 닫아도 원래 요청/,mode);assert.ok(h.f.sent.every(row=>row.payload.action==='preview'));
 }finally{held.resolve();h.close();}}
});

test('a finished verified draft read error releases only view close and remount preserves the exact request and records',async()=>{
 const h=await fixture();let next;try{
  allowDraft(h,payload=>payload.action==='prepareDraft'?draftResult(h.f,payload.packet.requestId,'update-requested',{docId:'2347603',needsRecovery:true}):savedTargetClosed(h,payload,'NATIVE_ASSET_RECOVERY_UNCONFIRMED'));
  await h.idle();await h.click(open);await h.click(prepareDraft);const reservation=[...h.stored.entries()],original=h.f.sent[1].payload.packet.requestId;
  assert.deepEqual(h.lockPairs.at(-1),[true,true]);await h.click(recoverDraft);
  assert.deepEqual(h.lockPairs.at(-1),[true,false]);assert.match(h.text(),/이 화면을 닫아도 원래 요청과 문서 보관 기록은 유지/);
  assert.match(h.text(),/원본 편집은 계속 잠겨/);assert.equal(h.button(prepareDraft),undefined);assert.equal(h.button(continueDraft),undefined);assert.equal(h.button(start),undefined);
  assert.deepEqual([...h.stored.entries()],reservation);h.close();assert.deepEqual([...h.stored.entries()],reservation,'dismiss never clears reservations or other durable local records');
  next=await fixture(SINGLE_COMPANIES[0],{stored:h.stored});allowDraft(next,payload=>{assert.equal(payload.action,'recoverDraft');assert.equal(payload.packet.requestId,original);return savedTargetClosed(next,payload,'NATIVE_ASSET_RECOVERY_UNCONFIRMED');});
  await next.idle();assert.deepEqual(next.lockPairs.at(-1),[true,true]);await next.click('이전 문서 전송 자료 확인');assert.equal(next.button(prepareDraft),undefined);assert.ok(next.button(recoverDraft));
  assert.deepEqual(next.lockPairs.at(-1),[true,true],'the old view dismissal never authorizes a new view');await next.click(recoverDraft);assert.deepEqual(next.lockPairs.at(-1),[true,false]);
  assert.deepEqual(plain(next.f.sent.map(row=>row.payload.action)),['preview','recoverDraft']);assert.deepEqual([...next.stored.entries()],reservation);
  assert.equal(next.f.history.length,0);assert.ok([...h.f.calls,...next.f.calls].every(row=>row.method==='GET'));
 }finally{h.close();next?.close();}
});

test('saved-target read failure can dismiss only after settling and a new read immediately restores both guards',async()=>{
 const h=await fixture(),held=deferred();let hold=false;try{
  h.f.bridge=async payload=>payload.action==='preview'?{...h.f.preview(),requestId:payload.packet.requestId,...savedTargetCapabilities,preparedLifecycleAvailable:false}
   :payload.action==='prepareDraft'?draftResult(h.f,payload.packet.requestId,'update-requested',{docId:'2347603',needsRecovery:true,draftProof:savedTargetProof(h)})
   :hold?held.promise:savedTargetClosed(h,payload);
  await h.idle();await h.click(open);await h.click(prepareDraft);await h.click(recoverDraft);assert.deepEqual(h.lockPairs.at(-1),[true,false]);
  const reservation=[...h.stored.entries()];hold=true;h.button(recoverSavedTarget).props.onClick();h.flush();await h.wait(()=>h.f.sent.at(-1).payload.action==='recoverSavedDraftTarget');
  assert.deepEqual(h.lockPairs.at(-1),[true,true]);assert.doesNotMatch(h.text(),/이 화면을 닫아도 원래 요청/);
  const packet=h.f.sent.at(-1).payload.packet;held.resolve(savedTargetClosed(h,{packet},'CURRENT_READ_ONLY_UNCONFIRMED'));await h.idle();
  assert.deepEqual(h.lockPairs.at(-1),[true,false]);assert.deepEqual([...h.stored.entries()],reservation);
  assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','prepareDraft','recoverDraft','recoverSavedDraftTarget']);assert.equal(h.f.history.length,0);
 }finally{held.resolve();h.close();}
});

test('busy, missing ACK, unknown document and unverified read errors never release view close',async()=>{
 for(const mode of ['busy','timeout','generic','identity','document','request','unknown-document']){const h=await fixture();try{
  allowDraft(h,payload=>{
   if(payload.action==='prepareDraft')return draftResult(h.f,payload.packet.requestId,'update-requested',{docId:'2347603',needsRecovery:true});
   if(mode==='busy')return {format:h.f.review.format,requestId:payload.packet.requestId,state:'busy',registered:false,success:false};
   if(mode==='timeout')return undefined;if(mode==='generic')throw Error('읽기 응답 없음');
   const value=savedTargetClosed(h,payload);if(mode==='identity')value.packetDigest='f'.repeat(64);if(mode==='document')value.docId='other-document';
   if(mode==='request')value.requestId='00000000-0000-4000-8000-000000000000';if(mode==='unknown-document'){value.state='create-requested';value.docId=null;value.draftProof=repairProof(h);}
   return value;
  });await h.idle();await h.click(open);await h.click(prepareDraft);const reservation=[...h.stored.entries()];
  if(mode==='timeout'){h.button(recoverDraft).props.onClick();h.flush();await h.wait(()=>h.f.sent.length===3);h.f.advance(180001);await h.idle();}else await h.click(recoverDraft);
  assert.deepEqual(h.lockPairs.at(-1),[true,true],mode);assert.doesNotMatch(h.text(),/이 화면을 닫아도 원래 요청/,mode);assert.deepEqual([...h.stored.entries()],reservation,mode);
 }finally{h.close();}}
});

test('review ABA, changed durable intent, unreadable storage and changed source revoke the idle read dismissal',async()=>{
 for(const mode of ['review-ABA','intent-ABA','storage','source']){const options={},h=await fixture(SINGLE_COMPANIES[0],options);try{
  allowDraft(h,payload=>payload.action==='prepareDraft'?draftResult(h.f,payload.packet.requestId,'update-requested',{docId:'2347603',needsRecovery:true}):savedTargetClosed(h,payload));
  await h.idle();await h.click(open);await h.click(prepareDraft);await h.click(recoverDraft);assert.deepEqual(h.lockPairs.at(-1),[true,false]);
  const oldRead=h.button(recoverDraft).props.onClick,reservation=[...h.stored.entries()];
  if(mode==='review-ABA'){const props=h.props();h.render({...props,review:{...props.review,reviewDigest:'a'.repeat(64)}});h.flush();h.render(props);await h.idle();oldRead();await h.idle();assert.equal(h.f.sent.length,3);}
  if(mode==='intent-ABA'){const [key,raw]=reservation[0];h.stored.set(key,JSON.stringify({...JSON.parse(raw),requestId:'00000000-0000-4000-8000-000000000000'}));h.storageChanged(key);h.stored.set(key,raw);h.storageChanged(key);}
  if(mode==='storage'){options.storageReadError=true;h.flush();}
  if(mode==='source'){h.f.refresh=async()=>({...h.f.review,preparedBodySha256:'f'.repeat(64)});await h.click(recoverDraft);assert.equal(h.f.sent.length,3,'source change must be fenced before another bridge dispatch');}
  h.flush();assert.deepEqual(h.lockPairs.at(-1),[true,true],mode);assert.doesNotMatch(h.text(),/이 화면을 닫아도 원래 요청/,mode);assert.deepEqual([...h.stored.entries()],reservation,mode);
 }finally{h.close();}}
});

test('a write error and prepared lifecycle read error cannot inherit the explicit draft-read dismissal',async()=>{
 const h=await fixture();try{
  h.f.bridge=async payload=>payload.action==='preview'?{...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,existingDocumentRepairAvailable:true}
   :payload.action==='prepareDraft'?draftResult(h.f,payload.packet.requestId,'update-requested',{docId:'2347603',needsRecovery:true})
   :draftResult(h.f,payload.packet.requestId,'update-requested',{docId:'2347603',needsRecovery:true,error:{code:'OWNED_RECORD_MISSING',message:'동일 문서 읽기 오류'}});
  await h.idle();await h.click(open);await h.click(prepareDraft);await h.click(recoverDraft);assert.deepEqual(h.lockPairs.at(-1),[true,false]);
  const reservation=[...h.stored.entries()];checkTerms(h);await h.click(repairDraft);assert.deepEqual(h.lockPairs.at(-1),[true,true]);assert.doesNotMatch(h.text(),/이 화면을 닫아도 원래 요청/);assert.deepEqual([...h.stored.entries()],reservation);
 }finally{h.close();}
 const prepared=await fixture();try{
  allowPrepared(prepared,payload=>savedTargetClosed(prepared,payload));await prepared.idle();await prepared.click(open);await prepared.click(prepareDraft);await prepared.click(recoverDraft);
  assert.equal(prepared.f.sent.at(-1).payload.action,'recoverPreparedDraft');assert.deepEqual(prepared.lockPairs.at(-1),[true,true]);assert.doesNotMatch(prepared.text(),/이 화면을 닫아도 원래 요청/);
 }finally{prepared.close();}
});

test('saved original document recovers only its verification tab after remount, then validates only on an explicit continuation',async()=>{
 const seed=await fixture();let h;try{
  allowDraft(seed,payload=>draftResult(seed.f,payload.packet.requestId,'update-requested',{docId:'2347603',needsRecovery:true,draftProof:savedTargetProof(seed)}));
  await seed.idle();await seed.click(open);await seed.click(prepareDraft);const original=seed.f.sent[1].payload.packet.requestId,reservation=[...seed.stored.entries()];seed.close();
  h=await fixture(SINGLE_COMPANIES[0],{stored:seed.stored});h.f.bridge=async payload=>payload.action==='preview'?{...h.f.preview(),requestId:payload.packet.requestId,...savedTargetCapabilities}
   :payload.action==='recoverSavedDraftTarget'?draftResult(h.f,payload.packet.requestId,'updated',{docId:'2347603',recovered:true,draftProof:savedTargetProof(h,13)})
   :payload.action==='prepareDraft'?draftResult(h.f,payload.packet.requestId,'validated',{docId:'2347603',draftProof:{...savedTargetProof(h,14),validatedSteps:[2,3,4,5]}})
   :savedTargetClosed(h,payload);
  await h.idle();await h.click('이전 문서 전송 자료 확인');assert.equal(h.button(recoverSavedTarget),undefined);await h.click(recoverDraft);
  assert.ok(h.button(recoverSavedTarget));assert.equal(h.button(prepareDraft),undefined);assert.equal(h.button(repairDraft),undefined);assert.equal(h.button('원래 예약의 미요청 파일만 이어 저장'),undefined);assert.equal(h.button('원래 요청의 새 검증 탭 연결 · 생성 안 함'),undefined);
  assert.equal(nodes(h.render()).filter(node=>node.type==='input'&&node.props.type==='checkbox').length,0);
  const stale=h.button(recoverSavedTarget).props.onClick;stale();stale();await h.idle();
  assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','recoverPreparedDraft','recoverSavedDraftTarget']);assert.ok(h.button(continueDraft));assert.equal(h.button(recoverSavedTarget),undefined);assert.equal(h.button(reviewPrepared),undefined);
  assert.deepEqual([...h.stored.entries()],reservation);assert.deepEqual(h.lockPairs.at(-1),[true,true]);stale();await h.idle();assert.equal(h.f.sent.length,3);
  await h.click(continueDraft);assert.ok(h.button(reviewPrepared));assert.equal(h.button(confirmPrepared),undefined);assert.equal(h.f.sent.filter(row=>row.payload.action==='prepareDraft').length,1);
  assert.ok(h.f.sent.every(row=>row.payload.packet.requestId===original));assert.ok(h.f.sent.every(row=>row.payload.packet.review.preparedBodySha256===h.f.review.preparedBodySha256));assert.equal(h.f.history.length,0);assert.ok(h.f.calls.every(row=>row.method==='GET'));
 }finally{seed.close();h?.close();}
});

test('saved-target button requires its exact closed response and native flag, and unrelated or stale reads revoke old callbacks',async()=>{
 for(const mode of ['no-flag','unrelated','identity','document','stale-read','source-ABA']){const h=await fixture();let code='SAVED_DRAFT_TARGET_CLOSED';try{
  h.f.bridge=async payload=>payload.action==='preview'?{...h.f.preview(),requestId:payload.packet.requestId,...savedTargetCapabilities,...(mode==='no-flag'?{savedDraftTargetRecoveryAvailable:false}:{})}
   :payload.action==='prepareDraft'?draftResult(h.f,payload.packet.requestId,'update-requested',{docId:'2347603',needsRecovery:true,draftProof:savedTargetProof(h)})
   :(()=>{const value=savedTargetClosed(h,payload,mode==='unrelated'?'UNRELATED_READ_FAILURE':code);if(mode==='identity')value.packetDigest='a'.repeat(64);if(mode==='document')value.docId='other-document';return value;})();
  await h.idle();await h.click(open);await h.click(prepareDraft);await h.click(recoverDraft);
  if(['no-flag','unrelated','identity','document'].includes(mode)){assert.equal(h.button(recoverSavedTarget),undefined);assert.equal(h.f.sent.some(row=>row.payload.action==='recoverSavedDraftTarget'),false);continue;}
  const stale=h.button(recoverSavedTarget).props.onClick,reservation=[...h.stored.entries()];
  if(mode==='stale-read'){code='UNRELATED_READ_FAILURE';await h.click(recoverDraft);}
  else{const props=h.props();h.render({...props,review:{...props.review,reviewDigest:'a'.repeat(64)}});h.render(props);}
  assert.equal(h.button(recoverSavedTarget),undefined);stale();await h.idle();assert.equal(h.f.sent.some(row=>row.payload.action==='recoverSavedDraftTarget'),false);assert.deepEqual([...h.stored.entries()],reservation);assert.equal(h.f.history.length,0);
 }finally{h.close();}}
});

test('saved-target recovery timeout retains the original reservation and needs another authenticated read before any retry',async()=>{
 const h=await fixture();try{
  h.f.bridge=async payload=>payload.action==='preview'?{...h.f.preview(),requestId:payload.packet.requestId,...savedTargetCapabilities}
   :payload.action==='prepareDraft'?draftResult(h.f,payload.packet.requestId,'update-requested',{docId:'2347603',needsRecovery:true,draftProof:savedTargetProof(h)})
   :payload.action==='recoverSavedDraftTarget'?undefined:savedTargetClosed(h,payload);
  await h.idle();await h.click(open);await h.click(prepareDraft);await h.click(recoverDraft);const reservation=[...h.stored.entries()],stale=h.button(recoverSavedTarget).props.onClick;
  stale();h.flush();await h.wait(()=>h.f.sent.some(row=>row.payload.action==='recoverSavedDraftTarget'));h.f.advance(180001);await h.idle();assert.equal(h.button(recoverSavedTarget),undefined);assert.ok(h.button(recoverDraft));assert.equal(h.button(continueDraft),undefined);assert.deepEqual(h.lockPairs.at(-1),[true,true]);
  stale();await h.idle();assert.equal(h.f.sent.filter(row=>row.payload.action==='recoverSavedDraftTarget').length,1);assert.deepEqual([...h.stored.entries()],reservation);
  await h.click(recoverDraft);assert.ok(h.button(recoverSavedTarget));assert.equal(h.f.history.length,0);assert.ok(h.f.calls.every(row=>row.method==='GET'));
 }finally{h.close();}
});

test('saved-target recovery rejects a different document and cannot publish a late result across a source ABA',async()=>{
 for(const mode of ['document','source-ABA']){const h=await fixture(),reply=deferred();try{
  h.f.bridge=async payload=>payload.action==='preview'?{...h.f.preview(),requestId:payload.packet.requestId,...savedTargetCapabilities}
   :payload.action==='prepareDraft'?draftResult(h.f,payload.packet.requestId,'update-requested',{docId:'2347603',needsRecovery:true,draftProof:savedTargetProof(h)})
   :payload.action==='recoverSavedDraftTarget'?reply.promise:savedTargetClosed(h,payload);
  await h.idle();await h.click(open);await h.click(prepareDraft);await h.click(recoverDraft);const reservation=[...h.stored.entries()],stale=h.button(recoverSavedTarget).props.onClick;
  stale();h.flush();await h.wait(()=>h.f.sent.some(row=>row.payload.action==='recoverSavedDraftTarget'));
  if(mode==='source-ABA'){const props=h.props();h.render({...props,review:{...props.review,reviewDigest:'a'.repeat(64)}});h.render(props);}
  const requestId=h.f.sent.at(-1).payload.packet.requestId;reply.resolve(draftResult(h.f,requestId,'updated',{docId:mode==='document'?'other-document':'2347603',recovered:true,draftProof:savedTargetProof(h,13)}));await h.idle();
  assert.equal(h.button(continueDraft),undefined);assert.equal(h.button(recoverSavedTarget),undefined);assert.equal(h.button(reviewPrepared),undefined);stale();await h.idle();assert.equal(h.f.sent.filter(row=>row.payload.action==='recoverSavedDraftTarget').length,1);assert.deepEqual([...h.stored.entries()],reservation);assert.equal(h.f.history.length,0);
 }finally{h.close();}}
});

test('failed file-list reads preserve reservations but revoke current and stale continuation controls until a fresh listed result',async()=>{
 for(const reserved of [false,true]){const h=await fixture();let failed=false;try{
  const proof=()=>({...repairProof(h,true),existingDocumentRepairRetryAttempted:true,...(reserved?{existingDocumentRepairContinuationAttempted:true,existingDocumentRepairContinuationResumed:true}:{})});
  h.f.bridge=async payload=>payload.action==='preview'?{...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,preparedLifecycleAvailable:true,existingDocumentRepairAvailable:true,existingDocumentRepairRetryAvailable:true,existingDocumentRepairContinuationAvailable:true,existingDocumentRepairReservedResumeAvailable:true,existingDocumentRepairSegmentedAvailable:true}
   :draftResult(h.f,payload.packet.requestId,'update-requested',{docId:'2347603',needsRecovery:true,draftProof:proof(),...(payload.action.startsWith('recover')?{error:{code:failed?'NATIVE_ASSET_RECOVERY_UNCONFIRMED':'NATIVE_ASSET_RECOVERY_READ_ONLY',message:failed?'확인 단계: observation-page · 항목: http-response, http-redirect':'원래 문서 파일 목록 2/9개 확인'}}:{})});
  await h.idle();await h.click(open);await h.click(prepareDraft);await h.click(recoverDraft);
  const label=reserved?'원래 예약의 미요청 파일만 이어 저장':'승인된 복구의 남은 저장 이어가기';const stale=h.button(label).props.onClick;
  const reservation=[...h.stored.entries()];failed=true;await h.click(recoverDraft);
  assert.equal(h.button(label),undefined);assert.match(h.text(),/파일·본문 저장 결과가 아직 확인되지 않아 이어 저장을 보류/);assert.doesNotMatch(h.text(),/아직 요청하지 않은 자료만 이어 저장할 수 있습니다/);
  stale();await h.idle();assert.equal(h.f.sent.filter(row=>['continueApprovedRepair','resumeReservedRepair'].includes(row.payload.action)).length,0);assert.deepEqual([...h.stored.entries()],reservation);
  failed=false;await h.click(recoverDraft);assert.ok(h.button(label));assert.equal(new Set(h.f.sent.map(row=>row.payload.packet.requestId)).size,1);assert.equal(h.f.history.length,0);
 }finally{h.close();}}
});
test('reserved resume needs a verified read snapshot and dispatches once with the same request and document',async()=>{
 for(const resumed of [false,true]){const h=await fixture();try{
  const proof=()=>({...repairProof(h,true),existingDocumentRepairRetryAttempted:true,existingDocumentRepairContinuationAttempted:true,...(resumed?{existingDocumentRepairContinuationResumed:true}:{})});
  h.f.bridge=async payload=>payload.action==='preview'?{...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,preparedLifecycleAvailable:true,existingDocumentRepairAvailable:true,existingDocumentRepairRetryAvailable:true,existingDocumentRepairContinuationAvailable:true,existingDocumentRepairReservedResumeAvailable:true}
   :payload.action==='resumeReservedRepair'?draftResult(h.f,payload.packet.requestId,'updated',{docId:'2347603',recovered:true,draftProof:{...proof(),existingDocumentRepairContinuationResumed:true,checkpointSequence:16}})
   :draftResult(h.f,payload.packet.requestId,'update-requested',{docId:'2347603',needsRecovery:true,draftProof:proof(),...(payload.action.startsWith('recover')?{error:{code:'NATIVE_ASSET_RECOVERY_READ_ONLY',message:'파일 목록 2/9개 확인'}}:{})});
  await h.idle();await h.click(open);await h.click(prepareDraft);
  const label='원래 예약의 미요청 파일만 이어 저장';assert.equal(h.button(label),undefined);await h.click(recoverDraft);
  if(resumed){assert.equal(h.button(label),undefined);continue;}
  assert.ok(h.button(label),h.text());const click=h.button(label).props.onClick;click();click();await h.idle();click();await h.idle();
  assert.equal(h.f.sent.filter(row=>row.payload.action==='resumeReservedRepair').length,1);assert.equal(new Set(h.f.sent.map(row=>row.payload.packet.requestId)).size,1);
  assert.equal(h.button(label),undefined);assert.ok(h.button(continueDraft));
 }finally{h.close();}}
});
test('segmented reserved UI carries one original reservation through confirmed groups to the original body update',async()=>{
 const h=await fixture();let segments=0;try{
  const proof=sequence=>({...repairProof(h,true),existingDocumentRepairRetryAttempted:true,existingDocumentRepairContinuationAttempted:true,existingDocumentRepairContinuationResumed:true,checkpointSequence:sequence});
  h.f.bridge=async payload=>payload.action==='preview'?{...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,preparedLifecycleAvailable:true,existingDocumentRepairAvailable:true,existingDocumentRepairRetryAvailable:true,existingDocumentRepairContinuationAvailable:true,existingDocumentRepairReservedResumeAvailable:true,existingDocumentRepairSegmentedAvailable:true}
   :payload.action==='resumeReservedRepair'?draftResult(h.f,payload.packet.requestId,++segments===3?'updated':'update-requested',{docId:'2347603',recovered:true,needsRecovery:segments<3,draftProof:proof(12+segments)})
   :draftResult(h.f,payload.packet.requestId,'update-requested',{docId:'2347603',needsRecovery:true,draftProof:proof(12),...(payload.action.startsWith('recover')?{error:{code:'NATIVE_ASSET_RECOVERY_READ_ONLY',message:'파일 목록 2/9개 확인'}}:{})});
  await h.idle();await h.click(open);await h.click(prepareDraft);await h.click(recoverDraft);
  const stale=h.button('원래 예약의 미요청 파일만 이어 저장').props.onClick;stale();await h.idle();
  assert.equal(segments,3);assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','prepareDraft','recoverPreparedDraft','resumeReservedRepair','resumeReservedRepair','resumeReservedRepair']);
  assert.equal(new Set(h.f.sent.map(row=>row.payload.packet.requestId)).size,1);assert.ok(h.button(continueDraft));assert.equal(h.button('원래 예약의 미요청 파일만 이어 저장'),undefined);
  stale();await h.idle();assert.equal(segments,3);assert.equal(h.f.history.length,0);assert.ok(h.f.calls.every(row=>row.method==='GET'));
 }finally{h.close();}
});
test('approved repair continuation retains the original request and dispatches once only when the extension supports remaining-work checks',async()=>{
 for(const available of [false,true]){const h=await fixture();try{
  const proof=()=>({...repairProof(h,true),existingDocumentRepairRetryAttempted:true});
  h.f.bridge=async payload=>payload.action==='preview'?{...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,preparedLifecycleAvailable:true,existingDocumentRepairAvailable:true,existingDocumentRepairRetryAvailable:true,...(available?{existingDocumentRepairContinuationAvailable:true}:{})}
   :payload.action==='continueApprovedRepair'?draftResult(h.f,payload.packet.requestId,'updated',{docId:'2347603',recovered:true,draftProof:{...proof(),existingDocumentRepairContinuationAttempted:true,checkpointSequence:16}})
   :draftResult(h.f,payload.packet.requestId,'update-requested',{docId:'2347603',needsRecovery:true,draftProof:proof(),...(payload.action.startsWith('recover')?{error:{code:'NATIVE_ASSET_RECOVERY_READ_ONLY',message:'원래 문서 파일 목록 2/9개 확인'}}:{})});
  await h.idle();await h.click(open);await h.click(prepareDraft);await h.click(recoverDraft);
  const label='승인된 복구의 남은 저장 이어가기',button=h.button(label);
  if(!available){assert.equal(button,undefined);continue;}
  assert.ok(button);const click=button.props.onClick;click();click();await h.idle();click();await h.idle();
  assert.equal(h.f.sent.filter(row=>row.payload.action==='continueApprovedRepair').length,1);
  assert.equal(new Set(h.f.sent.map(row=>row.payload.packet.requestId)).size,1);assert.equal(h.button(label),undefined);assert.ok(h.button(continueDraft));
  assert.equal(h.f.sent.filter(row=>row.payload.action==='retryExistingDraftRepair').length,0);assert.ok(h.f.calls.every(row=>row.method==='GET'));
 }finally{h.close();}}
});
test('verified recovery shows the reservation snapshot separately from a timed out continuation and never re-enables it',async()=>{
 for(const reserved of [false,true]){const h=await fixture();let afterTimeout=false;try{
  const proof=()=>({...repairProof(h,true),existingDocumentRepairRetryAttempted:true,...(afterTimeout&&reserved?{existingDocumentRepairContinuationAttempted:true}:{})});
  h.f.bridge=async payload=>payload.action==='preview'?{...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,preparedLifecycleAvailable:true,existingDocumentRepairAvailable:true,existingDocumentRepairRetryAvailable:true,existingDocumentRepairContinuationAvailable:true}
   :payload.action==='continueApprovedRepair'?undefined
   :draftResult(h.f,payload.packet.requestId,'update-requested',{docId:'2347603',needsRecovery:true,draftProof:proof(),...(payload.action.startsWith('recover')?{error:{code:'NATIVE_ASSET_RECOVERY_READ_ONLY',message:'원래 문서 파일 목록 2/9개 확인'}}:{})});
  await h.idle();await h.click(open);await h.click(prepareDraft);await h.click(recoverDraft);
  const continuation='승인된 복구의 남은 저장 이어가기';assert.ok(h.button(continuation));
  const click=h.button(continuation).props.onClick;click();h.flush();await h.wait(()=>h.f.sent.some(row=>row.payload.action==='continueApprovedRepair'));
  h.f.advance(240001);await h.idle();afterTimeout=true;assert.equal(h.button(continuation),undefined);await h.click(recoverDraft);
  assert.match(h.text(),reserved?/이번 읽기 시점에 이어 저장 예약 기록이 확인됐습니다.*저장 완료를 뜻하지 않습니다/:/이번 읽기 시점에는 이어 저장 예약 기록이 확인되지 않았습니다.*이전 작업이 아직 진행 중일 수 있으므로/);
  assert.equal(h.button(continuation),undefined);click();await h.idle();assert.equal(h.f.sent.filter(row=>row.payload.action==='continueApprovedRepair').length,1);
  assert.equal(new Set(h.f.sent.map(row=>row.payload.packet.requestId)).size,1);assert.ok(h.f.calls.every(row=>row.method==='GET'));
 }finally{h.close();}}
});
test('unverified recovery replies do not create an authenticated reservation snapshot',async()=>{
 const h=await fixture();try{
  const proof={...repairProof(h,true),existingDocumentRepairRetryAttempted:true};let reads=0;
  h.f.bridge=async payload=>payload.action==='preview'?{...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,existingDocumentRepairAvailable:true,existingDocumentRepairRetryAvailable:true,existingDocumentRepairContinuationAvailable:true}
   :draftResult(h.f,payload.packet.requestId,'update-requested',{docId:'2347603',needsRecovery:true,draftProof:proof,...(payload.action==='recoverDraft'?{error:{code:'NATIVE_ASSET_RECOVERY_READ_ONLY',message:'원래 문서 파일 목록 2/9개 확인'},...(++reads===2?{packetDigest:'f'.repeat(64)}:{})}:{})});
  await h.idle();await h.click(open);await h.click(prepareDraft);await h.click(recoverDraft);assert.match(h.text(),/이번 읽기 시점에는 이어 저장 예약 기록이 확인되지 않았습니다/);
  await h.click(recoverDraft);assert.match(h.text(),/원래 회원·문서·본문/);assert.doesNotMatch(h.text(),/이번 읽기 시점에(?:는)? 이어 저장 예약 기록/);
 }finally{h.close();}
});
test('first prepared read after remount displays the verified original reservation snapshot',async()=>{
 for(const reserved of [false,true]){const initial=await fixture();let restored;try{
  allowDraft(initial,()=>undefined);await initial.idle();await initial.click(open);const start=initial.button(prepareDraft).props.onClick;start();initial.flush();await initial.wait(()=>initial.f.sent.length===2);initial.f.advance(120001);await initial.idle();
  const original=initial.f.sent[1].payload.packet.requestId;initial.close();restored=await fixture(SINGLE_COMPANIES[0],{stored:initial.stored});
  restored.f.bridge=async payload=>payload.action==='preview'?{...restored.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,preparedLifecycleAvailable:true,existingDocumentRepairAvailable:true,existingDocumentRepairRetryAvailable:true,existingDocumentRepairContinuationAvailable:true}
   :draftResult(restored.f,payload.packet.requestId,'update-requested',{docId:'2347603',needsRecovery:true,draftProof:{...repairProof(restored,true),existingDocumentRepairRetryAttempted:true,...(reserved?{existingDocumentRepairContinuationAttempted:true}:{})},error:{code:'NATIVE_ASSET_RECOVERY_READ_ONLY',message:'원래 문서 파일 목록 2/9개 확인'}});
  await restored.idle();await restored.click('이전 문서 전송 자료 확인');await restored.click(recoverDraft);
  assert.deepEqual(plain(restored.f.sent.map(row=>row.payload.action)),['preview','recoverPreparedDraft']);assert.ok(restored.f.sent.every(row=>row.payload.packet.requestId===original));
  assert.match(restored.text(),reserved?/이번 읽기 시점에 이어 저장 예약 기록이 확인됐습니다.*저장 완료를 뜻하지 않습니다/:/이번 읽기 시점에는 이어 저장 예약 기록이 확인되지 않았습니다.*이전 작업이 아직 진행 중일 수 있으므로/);
  if(reserved)assert.equal(restored.button('승인된 복구의 남은 저장 이어가기'),undefined);
  assert.ok(restored.f.calls.every(row=>row.method==='GET'));
 }finally{initial.close();restored?.close();}}
});
const missingOwnedDraft=(h,payload,attempted=false)=>draftResult(h.f,payload.packet.requestId,'update-requested',{docId:'2347603',needsRecovery:true,draftProof:repairProof(h,attempted),...(payload.action==='recoverDraft'||payload.action==='recoverPreparedDraft'?{error:{code:'OWNED_RECORD_MISSING',message:'원래 문서 2347603의 저장 기록이 없습니다.'}}:{})});
function allowRepair(h,run,available=true){h.f.bridge=async payload=>payload.action==='preview'?{...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,preparedLifecycleAvailable:true,...(available?{existingDocumentRepairAvailable:true}:{})}:run(payload);}

test('additional same-document repair needs its separate capability and explicit approval, and duplicate callbacks cannot dispatch twice',async()=>{
 const h=await fixture();try{
  h.f.bridge=async payload=>payload.action==='preview'?{...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,preparedLifecycleAvailable:true,existingDocumentRepairAvailable:true,existingDocumentRepairRetryAvailable:true}
   :payload.action==='retryExistingDraftRepair'?draftResult(h.f,payload.packet.requestId,'updated',{docId:'2347603',recovered:true,draftProof:{...repairProof(h,true),existingDocumentRepairRetryAttempted:true,checkpointSequence:15}}):missingOwnedDraft(h,payload,true);
  await h.idle();await h.click(open);await h.click(prepareDraft);await h.click(recoverDraft);const label='같은 문서 추가 1회 복구';
  assert.equal(h.button(repairDraft),undefined);assert.equal(h.button(label).props.disabled,true);const unapproved=h.button(label).props.onClick;unapproved();await h.idle();assert.equal(h.f.sent.length,3);
  const checkbox=nodes(h.render()).find(node=>node.type==='input'&&node.props.type==='checkbox');checkbox.props.onChange({target:{checked:true}});h.flush();
  const approved=h.button(label).props.onClick;approved();approved();await h.idle();assert.equal(h.f.sent.filter(row=>row.payload.action==='retryExistingDraftRepair').length,1);
  assert.ok(h.button(continueDraft));assert.equal(h.button(label),undefined);assert.equal(h.button(repairDraft),undefined);approved();unapproved();await h.idle();assert.equal(h.f.sent.filter(row=>row.payload.action==='retryExistingDraftRepair').length,1);
  assert.equal(new Set(h.f.sent.map(row=>row.payload.packet.requestId)).size,1);assert.equal(h.f.history.length,0);assert.ok(h.f.calls.every(row=>row.method==='GET'));
 }finally{h.close();}
});

test('an authenticated failed pre-lifecycle read retains the known document and uses only fresh draft readback next',async()=>{
 const h=await fixture();try{
  allowRepair(h,payload=>missingOwnedDraft(h,payload));await h.idle();await h.click(open);await h.click(prepareDraft);const original=h.f.sent[1].payload.packet.requestId;
  await h.click(recoverDraft);assert.match(h.text(),/원래 문서 2347603/);assert.match(h.text(),/파일·본문 저장 결과 미확인/);
  await h.click(recoverDraft);assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','prepareDraft','recoverPreparedDraft','recoverDraft']);
  assert.ok(h.f.sent.every(row=>row.payload.packet.requestId===original));assert.equal(h.f.history.length,0);assert.equal(h.stored.size,1);
  assert.ok(h.f.calls.every(row=>row.method==='GET'));assert.equal(h.f.sent.filter(row=>row.payload.action==='repairExistingDraft').length,0);
 }finally{h.close();}
});

test('a verified prior repair attempt is shown after remount and cannot become another repair permission',async()=>{
 const stored=new Map(),first=await fixture(SINGLE_COMPANIES[0],{stored});let next;try{
  allowRepair(first,payload=>missingOwnedDraft(first,payload));await first.idle();await first.click(open);await first.click(prepareDraft);first.close();
  next=await fixture(SINGLE_COMPANIES[0],{stored});allowRepair(next,payload=>missingOwnedDraft(next,payload,true));await next.idle();await next.click('이전 문서 전송 자료 확인');
  assert.doesNotMatch(next.text(),/새 견적 초안 한 개를 만들고/);await next.click(recoverDraft);
  assert.match(next.text(),/원래 문서 2347603/);assert.match(next.text(),/같은 문서의 1회 저장 복구를 요청했습니다/);assert.equal(next.button(repairDraft),undefined);
  await next.click(recoverDraft);assert.deepEqual(plain(next.f.sent.map(row=>row.payload.action)),['preview','recoverPreparedDraft','recoverDraft']);
  assert.equal(next.f.sent.filter(row=>row.payload.action==='repairExistingDraft').length,0);assert.equal(stored.size,1);assert.ok(next.f.calls.every(row=>row.method==='GET'));
 }finally{first.close();next?.close();}
});

test('same-document repair needs explicit approval, refreshes only its envelope and blocks duplicate/stale write callbacks',async()=>{
 const h=await fixture();try{
  allowRepair(h,payload=>payload.action==='repairExistingDraft'
   ?draftResult(h.f,payload.packet.requestId,'updated',{docId:'2347603',recovered:true,draftProof:{...repairProof(h,true),checkpointSequence:13}})
   :payload.action==='prepareDraft'&&h.f.sent.some(row=>row.payload.action==='repairExistingDraft')
    ?draftResult(h.f,payload.packet.requestId,'validated',{docId:'2347603',draftProof:{...repairProof(h,true),validatedSteps:[2,3,4,5],checkpointSequence:18}})
    :missingOwnedDraft(h,payload));
  await h.idle();await h.click(open);await h.click(prepareDraft);const original=plain(h.f.sent[1].payload.packet);assert.equal(h.button(repairDraft),undefined);
  await h.click(recoverDraft);assert.ok(h.button(repairDraft));assert.equal(h.button(repairDraft).props.disabled,true);
  const unchecked=h.button(repairDraft).props.onClick;unchecked();await h.idle();assert.equal(h.f.sent.length,3);
  const checkbox=nodes(h.render()).find(node=>node.type==='input'&&node.props.type==='checkbox');assert.equal(checkbox.props.checked,false);
  checkbox.props.onChange({target:{checked:true}});h.flush();h.f.advance(PRODUCT_DOCUMENT_REQUEST_TTL+1);
  const repair=h.button(repairDraft).props.onClick;repair();repair();await h.idle();
  assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','prepareDraft','recoverPreparedDraft','preview','repairExistingDraft']);
  const sent=h.f.sent.at(-1).payload;assert.equal(sent.packet.requestId,original.requestId);assert.deepEqual(plain(sent.packet.review),original.review);assert.ok(sent.packet.createdAt>original.createdAt);
  assert.deepEqual(Object.keys(sent).sort(),['action','packet']);assert.equal(h.stored.size,1);assert.match(h.text(),/초안 문서 2347603/);assert.ok(h.button(continueDraft));assert.equal(h.button(reviewPrepared),undefined);
  assert.equal(h.button(repairDraft),undefined);assert.equal(h.button(start),undefined);
  repair();unchecked();await h.idle();assert.equal(h.f.sent.filter(row=>row.payload.action==='repairExistingDraft').length,1);
  await h.click(continueDraft);assert.match(h.text(),/검증\s*4\s*\/4/);assert.ok(h.button(reviewPrepared));assert.ok(h.f.sent.every(row=>row.payload.packet.requestId===original.requestId));
  assert.equal(h.f.history.length,0);assert.ok(h.f.calls.every(row=>row.method==='GET'));
 }finally{h.close();}
});

test('lost same-document repair ACK offers only readback and a durable attempt blocks another repair after remount',async()=>{
 const h=await fixture();let next;try{
  allowRepair(h,payload=>payload.action==='repairExistingDraft'?undefined:missingOwnedDraft(h,payload));
  await h.idle();await h.click(open);await h.click(prepareDraft);await h.click(recoverDraft);
  const checkbox=nodes(h.render()).find(node=>node.type==='input'&&node.props.type==='checkbox');checkbox.props.onChange({target:{checked:true}});h.flush();
  const repair=h.button(repairDraft).props.onClick;repair();h.flush();await h.wait(()=>h.f.sent.length===4);h.f.advance(180001);await h.idle();
  assert.equal(h.button(repairDraft),undefined);assert.ok(h.button(recoverDraft));assert.match(h.text(),/다시 저장하지 않고 원래 문서의 결과만 확인/);repair();await h.idle();assert.equal(h.f.sent.length,4);
  const original=h.f.sent.at(-1).payload.packet.requestId;h.close();next=await fixture(SINGLE_COMPANIES[0],{stored:h.stored});
  allowRepair(next,payload=>missingOwnedDraft(next,payload,true));await next.idle();await next.click('이전 문서 전송 자료 확인');await next.click(recoverDraft);
  assert.equal(next.button(repairDraft),undefined);assert.ok(next.button(recoverDraft));assert.equal(next.button(prepareDraft),undefined);assert.equal(next.button(start),undefined);
  assert.deepEqual(plain(next.f.sent.map(row=>row.payload.action)),['preview','recoverPreparedDraft']);assert.ok(next.f.sent.every(row=>row.payload.packet.requestId===original));assert.equal(next.stored.size,1);assert.equal(next.f.history.length,0);
 }finally{h.close();next?.close();}
});

test('repair UI rejects old capability, altered identity, unrelated errors, non-update state and prior attempts',async()=>{
 for(const mode of ['old-extension','identity','digest','other-error','prior-attempt','wrong-state','extra-proof']){const h=await fixture();try{
  allowRepair(h,payload=>{const value=missingOwnedDraft(h,payload,mode==='prior-attempt');if(payload.action==='recoverPreparedDraft'){
   if(mode==='identity')value.identity.company=SINGLE_COMPANIES[1];
   if(mode==='digest')value.preparedBodySha256='0'.repeat(64);
   if(mode==='other-error')value.error.code='SOURCE_CHANGED';
   if(mode==='wrong-state'){value.state='created';value.needsRecovery=false;}
   if(mode==='extra-proof')value.draftProof.untrusted=true;
  }return value;},mode!=='old-extension');
  await h.idle();await h.click(open);await h.click(prepareDraft);await h.click(recoverDraft);assert.equal(h.button(repairDraft),undefined,mode);
  assert.ok(h.button(recoverDraft),mode);assert.equal(h.f.sent.filter(row=>row.payload.action==='repairExistingDraft').length,0);assert.equal(h.f.history.length,0);
 }finally{h.close();}}
});

test('a failed recovery retains its authenticated document number across later repair replies without selecting a docId in the request',async()=>{
 const h=await fixture();let next;try{
  allowRepair(h,payload=>missingOwnedDraft(h,payload));await h.idle();await h.click(open);await h.click(prepareDraft);h.close();
  next=await fixture(SINGLE_COMPANIES[0],{stored:h.stored});allowRepair(next,payload=>missingOwnedDraft(next,payload));
  await next.idle();await next.click('이전 문서 전송 자료 확인');await next.click(recoverDraft);assert.ok(next.button(repairDraft));
  const checkbox=nodes(next.render()).find(node=>node.type==='input'&&node.props.type==='checkbox');checkbox.props.onChange({target:{checked:true}});next.flush();
  allowRepair(next,payload=>draftResult(next.f,payload.packet.requestId,'updated',{docId:'different-document',recovered:true,draftProof:{...repairProof(next,true),checkpointSequence:13}}));
  await next.click(repairDraft);assert.match(next.text(),/문서번호와 다른 복구 응답/);assert.equal(next.button(continueDraft),undefined);assert.equal(next.button(reviewPrepared),undefined);assert.equal(next.button(repairDraft),undefined);assert.ok(next.button(recoverDraft));
  const sent=next.f.sent.at(-1).payload;assert.equal(sent.action,'repairExistingDraft');assert.equal(Object.hasOwn(sent,'docId'),false);assert.equal(Object.hasOwn(sent.packet,'docId'),false);assert.equal(sent.packet.review.body.docId,null);assert.equal(next.stored.size,1);assert.equal(next.f.history.length,0);
 }finally{h.close();next?.close();}
});

test('saved retry approval offers only same-request continuation and a double click cannot dispatch twice',async()=>{
 const h=await fixture();try{
  allowDraft(h,payload=>payload.action==='resumeCreateRetryDraft'?draftResult(h.f,payload.packet.requestId,'created',{recovered:true})
   :draftResult(h.f,payload.packet.requestId,'create-requested',{docId:null,needsRecovery:true,draftProof:{evidence:'document-draft-preparation',validatedSteps:[],checkpointSequence:12,observedAt:h.f.clock.now,submitted:false,consented:false,createRetryApproved:true},...(payload.action==='recoverDraft'?{error:{code:'READBACK_UNCONFIRMED',message:'기존 승인 있음'}}:{})}));
  await h.idle();await h.click(open);await h.click(prepareDraft);await h.click(recoverDraft);
  assert.equal(h.button('기존 요청으로 생성 1회 재시도'),undefined);const click=h.button('승인된 1회 생성 계속').props.onClick;click();click();await h.idle();
  assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','prepareDraft','recoverDraft','resumeCreateRetryDraft']);
  assert.equal(new Set(h.f.sent.map(row=>row.payload.packet.requestId)).size,1);assert.equal(h.stored.size,1);assert.ok(h.button(continueDraft));click();await h.idle();assert.equal(h.f.sent.length,4);
 }finally{h.close();}
});

test('a closed original target exposes a separate unchecked connection approval and retains the approved retry UUID',async()=>{
 const h=await fixture();try{
  allowDraft(h,payload=>draftResult(h.f,payload.packet.requestId,'create-requested',{docId:null,needsRecovery:true,
   draftProof:{evidence:'document-draft-preparation',validatedSteps:[],checkpointSequence:12,observedAt:h.f.clock.now,submitted:false,consented:false,createRetryApproved:true},
   ...(payload.action==='recoverDraft'?{error:{code:'CLOSED_TARGET_APPROVAL',message:'원래 검증 탭이 닫혔습니다.'}}:{})}));
  await h.idle();await h.click(open);await h.click(prepareDraft);await h.click(recoverDraft);
  const connect='원래 요청의 새 검증 탭 연결 · 생성 안 함';
  assert.equal(h.button('기존 요청으로 생성 1회 재시도'),undefined);assert.equal(h.button('승인된 1회 생성 계속'),undefined);
  assert.equal(h.button(connect).props.disabled,true);const stale=h.button(connect).props.onClick;
  stale();await h.idle();assert.equal(h.f.sent.length,3);
  const checkbox=nodes(h.render()).find(node=>node.type==='input'&&node.props.type==='checkbox');assert.equal(checkbox.props.checked,false);
  checkbox.props.onChange({target:{checked:true}});h.flush();assert.equal(h.button(connect).props.disabled,false);
  const click=h.button(connect).props.onClick;click();click();await h.idle();
  assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','prepareDraft','recoverDraft','recoverClosedTarget']);
  assert.equal(new Set(h.f.sent.map(row=>row.payload.packet.requestId)).size,1);assert.equal(h.stored.size,1);
  assert.equal(h.button(connect),undefined);click();await h.idle();assert.equal(h.f.sent.length,4);
  assert.equal(h.f.calls.some(call=>call.method==='POST'),false);assert.equal(h.f.history.length,0);
 }finally{h.close();}
});

test('malformed draft proof and stale review callbacks retain the pending reservation and cannot expose consent or submit',async()=>{
 for(const mode of ['receipt','proof','stale']){const h=await fixture();try{allowDraft(h,payload=>draftResult(h.f,payload.packet.requestId,'validated',mode==='receipt'?{receipt:{}}:mode==='proof'?{draftProof:{evidence:'document-draft-preparation',validatedSteps:[2,3,4],checkpointSequence:12,observedAt:h.f.clock.now,submitted:false,consented:false}}:{}));
   await h.idle();await h.click(open);const old=h.button(prepareDraft).props.onClick;
   if(mode==='stale'){const original=h.props().review,changed={...original,reviewDigest:'e'.repeat(64)};h.render({...h.props(),review:changed});h.render({...h.props(),review:original});old();h.flush();assert.equal(h.f.sent.length,1);assert.equal(h.stored.size,0);continue;}
   await h.click(prepareDraft);assert.equal(h.button(prepareDraft),undefined);assert.ok(h.button(recoverDraft));assert.deepEqual(h.lockPairs.at(-1),[true,true]);assert.equal(h.stored.size,1);assert.equal(h.button('현재 문서 동의 확인 · 계속'),undefined);assert.equal(h.button(start),undefined);assert.equal(h.f.calls.some(call=>call.method==='POST'),false);
  }finally{h.close();}
 }
});

test('verified incomplete draft recovery offers only explicit same-operation continuation; expired preview refreshes TTL without a new UUID',async()=>{
 const h=await fixture();try{let preparations=0;allowDraft(h,payload=>{
   if(payload.action==='recoverDraft')return draftResult(h.f,payload.packet.requestId,'created',{recovered:true});
   preparations++;return draftResult(h.f,payload.packet.requestId,preparations===1?'create-requested':'validated',preparations===1?{docId:null,needsRecovery:true}:{});
  });await h.idle();await h.click(open);await h.click(prepareDraft);assert.equal(h.button(continueDraft),undefined);await h.click(recoverDraft);assert.ok(h.button(continueDraft));const requestId=h.f.sent[1].payload.packet.requestId;h.f.advance(120001);await h.click(continueDraft);
  assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','prepareDraft','recoverDraft','preview','prepareDraft']);assert.ok(h.f.sent.every(row=>row.payload.packet.requestId===requestId));assert.equal(preparations,2);assert.equal(h.stored.size,1);assert.deepEqual(h.lockPairs.at(-1),[true,false]);assert.equal(h.f.calls.some(call=>call.method==='POST'),false);
 }finally{h.close();}
});
test('a failed latest draft readback relocks closing and removes the completed label until exact read recovery succeeds',async()=>{
 const h=await fixture();try{allowDraft(h,payload=>draftResult(h.f,payload.packet.requestId,'validated',payload.action==='recoverDraft'?{recovered:true}:{}));await h.idle();await h.click(open);await h.click(prepareDraft);assert.deepEqual(h.lockPairs.at(-1),[true,false]);
  h.f.bridge=async()=>{throw Error('원래 초안 본문을 확인하지 못했습니다.');};await h.click(recoverDraft);assert.deepEqual(h.lockPairs.at(-1),[true,true]);assert.match(h.text(),/확장이 문서 요청을 완료하지 못했습니다/);assert.doesNotMatch(h.text(),/원래 초안 본문|초안 저장·검증 완료/);assert.equal(h.stored.size,1);assert.equal(h.button(prepareDraft),undefined);
  h.f.bridge=async payload=>draftResult(h.f,payload.packet.requestId,'validated',{recovered:true});await h.click(recoverDraft);assert.deepEqual(h.lockPairs.at(-1),[true,false]);assert.match(h.text(),/초안 저장·검증 완료/);assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','prepareDraft','recoverDraft','recoverDraft']);assert.equal(h.f.calls.some(call=>call.method==='POST'),false);
  h.render({...h.props(),review:{...h.props().review,reviewDigest:'e'.repeat(64)}});assert.deepEqual(h.lockPairs.at(-1),[true,true],'a different review cannot inherit the previous draft close permission even before passive effects');assert.doesNotMatch(h.text(),/초안 저장·검증 완료/);
 }finally{h.close();}
});
test('only exact recovered draft validation rejection releases its reservation into the immutable rejection ledger',async()=>{
 const h=await fixture();try{allowDraft(h,payload=>draftResult(h.f,payload.packet.requestId,'validation-rejected',{...(payload.action==='recoverDraft'?{recovered:true}:{}),
   draftProof:{evidence:'document-draft-preparation',validatedSteps:[2],checkpointSequence:12,observedAt:h.f.clock.now,submitted:false,consented:false},
   validationRejection:{evidence:'document-validation-rejection',operationId:payload.packet.requestId+':validate:3',step:3,validatedSteps:[2],checkpointSequence:12,rejectedAt:h.f.clock.now,submitted:false,consented:false}}));
  await h.idle();await h.click(open);await h.click(prepareDraft);assert.ok(h.button(release));assert.deepEqual(h.lockPairs.at(-1),[true,true]);const original=h.f.sent[1].payload.packet.requestId;
  await h.click(release);assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','prepareDraft','recoverDraft']);assert.deepEqual(h.lockPairs.at(-1),[false,false]);assert.equal([...h.stored.keys()].some(key=>key.startsWith('yoofam-product-document-pending:')),false);assert.equal(h.stored.size,1);
  const ledger=JSON.parse([...h.stored.values()][0]);assert.equal(ledger[0].pending.requestId,original);assert.equal(ledger[0].validationRejection.step,3);await h.click(open);assert.equal(h.f.sent.length,3,'same rejected body cannot create another draft');assert.match(h.text(),/이미 반려/);assert.equal(h.f.calls.some(call=>call.method==='POST'),false);
 }finally{h.close();}
});
test('owner change while awaiting the draft claim lock prevents both reservation and remote creation',async()=>{
 const held=deferred(),h=await fixture();try{allowDraft(h,payload=>draftResult(h.f,payload.packet.requestId));await h.idle();await h.click(open);
  h.f.window.navigator.locks.request=async(_key,_options,run)=>{await held.promise;return run();};h.button(prepareDraft).props.onClick();h.flush();await h.wait(()=>h.refreshCalls.length>=3);h.f.actor.ownerId='other';held.resolve();await h.idle();assert.equal(h.stored.size,0);assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview']);assert.equal(h.f.calls.some(call=>call.method==='POST'),false);
 }finally{held.resolve();h.close();}
});

for(const company of SINGLE_COMPANIES)test(company.name+' actual transport renders exact rejected receipt reasons in current result and stored history',async()=>{
 const h=await fixture(company,{verified:true});try{
  await h.idle();await h.click(open);h.f.bridge=async payload=>({...h.f.observation('REJECTED'),requestId:payload.packet.requestId,
   receipt:{...h.f.observation('REJECTED').receipt,rejectionDetails:normalizeRejectionDetails(JSON.stringify({errors:[{columnName:'단품 포장 크기',message:'가로 세로 높이를 확인해주세요.'}]}))}});
  await h.click(start);assert.match(h.text(),/단품 포장 크기/);assert.match(h.text(),/가로 세로 높이를 확인해주세요/);assert.equal(nodes(h.render()).filter(node=>node.type==='caption'&&node.props.children==='Supplier Hub 반려 상세').length,2);
  assert.equal(h.f.history.length,1);assert.equal(h.f.history[0].registered,false);assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','start']);
 }finally{h.close();}
});
const validationRejected=(f,requestId)=>f.state('validation-rejected',{requestId,validationRejection:{evidence:'document-validation-rejection',operationId:requestId+':validate:2',step:2,validatedSteps:[],checkpointSequence:8,rejectedAt:f.clock.now,submitted:false,consented:false}});
after(() => fs.writeFileSync(new URL('../outputs/step728-product-transport-ui-proof.json', import.meta.url), JSON.stringify({ cases,
  boundary: 'Actual product transport component and actual app client/packet/receipt functions. React hook scheduling, window bridge, clock and local API are isolated; live:true is synthetic test ACK only. No Chrome/Hub/source collection/actual acceptance.',
  externalRequests: 0, realProductWrites: 0, hubWrites: 0, actualReceiptVerified: false }, null, 2) + '\n'));

async function fixture(company = SINGLE_COMPANIES[0], options = {}) {
  const f = await factory.fixture(company, options), slots = [], effects = [], refreshCalls = [], locks = [], lockPairs=[]; let cursor = 0, sequence = 100000, props;
  const stored=options.stored??new Map(),storageListeners=new Set(),events=f.window.addEventListener,removeEvents=f.window.removeEventListener;
  f.window.localStorage={getItem:key=>{if(options.storageReadError)throw Error('storage unavailable');return stored.get(key)??null;},setItem:(key,value)=>{if(options.storageWriteError)throw Error('storage unavailable');stored.set(key,value);},removeItem:key=>stored.delete(key)};
  f.window.navigator={locks:{request:async(_name,_options,run)=>run()}};
  f.window.addEventListener=(type,fn)=>type==='storage'?storageListeners.add(fn):events(type,fn);
  f.window.removeEventListener=(type,fn)=>type==='storage'?storageListeners.delete(fn):removeEvents(type,fn);
  const originalBridge=f.bridge;
  f.bridge=async payload=>{const result=await originalBridge(payload);return result&&{...result,requestId:payload.packet.requestId};};
  const hook = (effect, deps, layout) => { const index = cursor++, old = slots[index]; if (!old || !deps || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) { old?.cleanup?.(); slots[index] = { deps, cleanup: null }; const run = () => slots[index].cleanup = effect(); if (layout) run(); else effects.push(run); } };
  const react = { useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => slots[index] = typeof value === 'function' ? value(slots[index]) : value]; }, useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index]; }, useEffect: (fn, deps) => hook(fn, deps, false), useLayoutEffect: (fn, deps) => hook(fn, deps, true) };
  react.useMemo=(fn,deps)=>{const index=cursor++,old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))slots[index]={deps,value:fn()};return slots[index].value;};
  class LocalDate extends Date { static now() { return f.clock.now; } }
  const exports = {}, component = 'app/components/supplier-hub-product-transport.tsx';
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + component, import.meta.url), 'utf8'), { fileName: component, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, Error, Date: LocalDate, window:f.window, AbortController, fetch: f.fetch, setTimeout: (fn, delay) => { const id = ++sequence; f.timers.set(id, { fn, due: f.clock.now + delay }); return id; }, clearTimeout: id => f.timers.delete(id),
      require: name => name === '@/app/preserved-product-request-reconnect' && options.reconnect ? {reconnectPreservedProductDraft:input=>options.reconnect(input,f)} : name === '@/app/components/supplier-hub-native-registration' ? {SupplierHubNativeRegistration:()=>null} : name === '@/app/components/supplier-hub-rejection-details' ? {SupplierHubRejectionDetails} : name === '@/app/supplier-hub-reserved-work.mjs' ? {runReservedSegments} : name === 'react' ? react : name === '@/app/supplier-hub-product-client' ? f.client : name.startsWith('@/') ? f.load(name.slice(2) + '.ts') : name.endsWith('product-document-source.mjs') ? {sourceReadError} : name.endsWith('product-document.mjs') ? {
        // Each fresh preview gets a different real UUID. Recovery must supply
        // its original UUID explicitly; a constant test seed cannot mask loss.
        createProductDocumentPacket: (review,value={}) => createProductDocumentPacket(review, { ...value,createdAt:value.createdAt??f.clock.now,now:f.clock.now }),
        PRODUCT_DOCUMENT_REQUEST_TTL,
      } : native(name) });
  props = { review: f.review, disabled: false, refresh: async signal => { refreshCalls.push(signal); return f.refresh(signal); }, onLockChange: (value,close=value) => {locks.push(value);lockPairs.push([value,close]);} };
  f.refresh = async () => { if (f.actor.ownerId !== f.review.identity.ownerId || JSON.stringify(f.actor.company) !== JSON.stringify(f.review.identity.company)) throw Error('현재 회원 회사가 변경되었습니다.'); return plain(f.review); };
  const render = (next = props) => { props = next; cursor = 0; return exports.SupplierHubProductTransport(props); };
  const flush = () => { render(); effects.splice(0).forEach(fn => fn()); };
  const h = { f, stored,refreshCalls, locks, lockPairs, render, flush, props: () => props, text: () => text(render()), button: label => nodes(render()).find(node => node.type === 'button' && node.props.children === label),storageChanged(key){for(const fn of storageListeners)fn({key});flush();},
    async wait(predicate) { const deadline=Date.now()+10000;while(Date.now()<deadline){flush();if(predicate())return;await turn();}assert.fail('Product UI boundary timeout'); },
    async idle() { await h.wait(() => !render().props['aria-busy']); }, async click(label) { const node = h.button(label); assert.ok(node, label); assert.equal(Boolean(node.props.disabled), false, label); node.props.onClick(); await h.idle(); },
    close() { for (const slot of slots) slot?.cleanup?.(); } };
  return h;
}

function reconnectInputs(h,requestId='f29491bd-1882-456a-8a63-eec8586db6c6',docId='2347603'){
 for(const [label,value] of [['복구할 원래 요청번호',requestId],['복구할 원래 문서번호',docId]]){
  const field=nodes(h.render()).find(node=>node.type==='input'&&node.props['aria-label']===label);assert.ok(field,label);field.props.onChange({target:{value}});h.flush();
 }
}
test('explicit reconnect adopts only its verified original draft and never automatically starts or submits',async()=>{
 const calls=[],h=await fixture(undefined,{reconnect:async(input,f)=>{
  calls.push(input.target);assert.equal(input.isCurrent(),true);assert.equal(input.target.productId,f.review.identity.productId);
  const packet=await createProductDocumentPacket(input.review,{requestId:input.target.requestId,createdAt:f.clock.now,now:f.clock.now});
  const session=await f.client.previewProductDocument(packet,input.signal);
  const local=f.load('app/supplier-hub-product-pending.ts'),pending=await local.claimProductDocumentPending(input.review,session,input.signal,async()=>{assert.equal(input.isCurrent(),true);});
  return{session,pending,observation:draftResult(f,input.target.requestId,'validated',{docId:input.target.docId})};
 }});try{
  h.f.bridge=async payload=>{assert.equal(payload.action,'preview','no write or continuation from reconnect UI');return{...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,preparedLifecycleAvailable:true};};
  await h.idle();reconnectInputs(h);await h.click('원래 저장 문서 연결 복구');
  assert.equal(calls.length,1);assert.equal(calls[0].requestId,'f29491bd-1882-456a-8a63-eec8586db6c6');assert.equal(calls[0].docId,'2347603');
  assert.match(h.text(),/Supplier Hub 초안 문서 2347603/);assert.ok(h.button(reviewPrepared));assert.equal(h.button(prepareDraft),undefined);assert.equal(h.button(start),undefined);
  assert.equal(h.stored.size,1);assert.deepEqual(h.lockPairs.at(-1),[true,false],'saved validated original can close, source stays protected');
 }finally{h.close();}
});
test('reconnect result cannot cross a disabled scope or overwrite an existing local request',async()=>{
 const gate=deferred();let inputs;
 const h=await fixture(undefined,{reconnect:async(input)=>{inputs=input;await gate.promise;assert.equal(input.isCurrent(),false);throw Error('scope changed');}});try{
  await h.idle();reconnectInputs(h);h.button('원래 저장 문서 연결 복구').props.onClick();h.flush();
  assert.equal(inputs.isCurrent(),true);h.render({...h.props(),disabled:true});gate.resolve();await turn();h.flush();
  assert.equal(h.stored.size,0);assert.equal(h.button(reviewPrepared),undefined);assert.equal(h.f.sent.length,0);
 }finally{h.close();}
 const reserved=await fixture();try{
  allowDraft(reserved,async payload=>draftResult(reserved.f,payload.packet.requestId,'validated'));
  await reserved.idle();await reserved.click(open);await reserved.click(prepareDraft);assert.equal(reserved.stored.size,1);
  assert.equal(reserved.button('원래 저장 문서 연결 복구'),undefined,'existing pending uses its original flow');
 }finally{reserved.close();}
});
test('reconnect input is cleared on a different review and invalid IDs never call the helper',async()=>{
 let calls=0;const h=await fixture(undefined,{reconnect:async()=>{calls++;throw Error('unexpected');}});try{
  await h.idle();reconnectInputs(h,'invalid','02347603');await h.click('원래 저장 문서 연결 복구');assert.equal(calls,0);assert.equal(h.stored.size,0);
  const next=plain(h.props().review);next.reviewDigest='f'.repeat(64);h.render({...h.props(),review:next});h.flush();
  for(const label of ['복구할 원래 요청번호','복구할 원래 문서번호'])assert.equal(nodes(h.render()).find(node=>node.type==='input'&&node.props['aria-label']===label)?.props.value,'');
 }finally{h.close();}
});
test('post-claim reconnect failure retains original source and close locks without adopting a session',async()=>{
 const h=await fixture(undefined,{reconnect:async(input,f)=>{
  const packet=await createProductDocumentPacket(input.review,{requestId:input.target.requestId,createdAt:f.clock.now,now:f.clock.now});
  const session=await f.client.previewProductDocument(packet,input.signal);
  await f.load('app/supplier-hub-product-pending.ts').claimProductDocumentPending(input.review,session,input.signal);
  throw Error('post-claim source read failed');
 }});try{
  h.f.bridge=async payload=>{assert.equal(payload.action,'preview');return{...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,preparedLifecycleAvailable:true};};
  await h.idle();reconnectInputs(h);await h.click('원래 저장 문서 연결 복구');
  assert.equal(h.stored.size,1);assert.match(h.text(),/post-claim source read failed/);assert.match(h.text(),/이 상품의 이전 전송 요청이 보관되어 있습니다/);
  assert.deepEqual(h.lockPairs.at(-1),[true,true]);assert.equal(h.button(reviewPrepared),undefined);assert.equal(h.button(prepareDraft),undefined);assert.equal(h.button('원래 저장 문서 연결 복구'),undefined);
  assert.equal(JSON.parse([...h.stored.values()][0]).requestId,'f29491bd-1882-456a-8a63-eec8586db6c6');
 }finally{h.close();}
});

const reconnectSavedTarget='원래 문서의 새 읽기 탭 연결 · 재전송 안 함';
const auditOriginal='원래 문서 본문·첨부 전체 대조 · 읽기 전용';
const validateStoredSteps='쿠팡 저장 문서 단계 검사 · 파일·본문 저장 안 함';
function originalAuditFixtureReport(session,patch={}){
 return {requestId:session.packet.requestId,docId:'2347603',identityDigest:session.preview.identityDigest,packetDigest:session.packetDigest,
  imageCount:24,legalCount:1,bodyMatchesExpected:false,legalEntries:[{index:0,kind:'certificate',association:'unlinked',schemaIndex:null,descriptorSha256:'a'.repeat(64),pairedImageDescriptorMatch:false,expectedLabelReferences:3}],
  differences:[{documentIndex:0,schemaIndex:0,path:'legalPage.certificates.value',expectedValueKind:'na',actualValueKind:'empty'}],differenceCount:1,...patch};
}

test('saved-document server step inspection requires the explicit audit, renders response rows without option inference and cannot adopt or submit',async()=>{
 const checked=[],h=await fixture(undefined,{reconnect:async(_input,f)=>{throw reconnectClosedError(f,{savedDraftTargetClosed:false});}});try{
  h.f.bridge=async payload=>({...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,unexpectedLegalAuditAvailable:true,savedDocumentStepValidationAvailable:true});
  h.f.client.auditUnexpectedLegal=async session=>originalAuditFixtureReport(session);
  h.f.client.validateSavedDocumentSteps=async(session,audit,signal)=>{checked.push({session,audit,signal});return{requestId:session.packet.requestId,docId:2347603,identityDigest:session.preview.identityDigest,packetDigest:session.packetDigest,
   stages:[{stage:2,state:'passed',cached:false,requested:true,failureCode:null,errors:[],errorCount:0,errorsTruncated:false},{stage:3,state:'rejected',cached:false,requested:true,failureCode:null,errors:[{rowIndex:2,columnName:'한글 표시사항 동의',category:'consent'}],errorCount:1,errorsTruncated:false}]};};
  await h.idle();reconnectInputs(h);await h.click('원래 저장 문서 연결 복구');assert.equal(h.button(validateStoredSteps).props.disabled,true);
  await h.click(auditOriginal);assert.equal(h.button(validateStoredSteps).props.disabled,false);const click=h.button(validateStoredSteps).props.onClick;click();click();await h.idle();
  assert.equal(checked.length,1);assert.equal(checked[0].audit.docId,'2347603');assert.equal(checked[0].signal.aborted,false);
  assert.match(h.text(),/쿠팡 단계 검사/);assert.match(h.text(),/상품 정보\s+·\s+검사 통과/);assert.match(h.text(),/이미지\s+·\s+오류 확인/);assert.match(h.text(),/한글 표시사항 동의/);assert.match(h.text(),/응답 행은 상품 옵션 번호와 다릅니다/);assert.match(h.text(),/검사 통과는 실제 접수 완료를 뜻하지 않습니다/);
  assert.match(h.text(),/원래 본문\s+불일치/);assert.equal(h.stored.size,0);assert.ok(h.f.calls.every(row=>row.method==='GET'));assert.ok(h.f.sent.every(row=>row.payload.action==='preview'));
  for(const label of [start,prepareDraft,reviewPrepared,'현재 문서 동의 확인 · 계속'])assert.equal(h.button(label),undefined);
 }finally{h.close();}
});

test('unknown saved-document stage results never expose a native error or enable draft registration',async()=>{
 const h=await fixture(undefined,{reconnect:async(_input,f)=>{throw reconnectClosedError(f,{savedDraftTargetClosed:false});}});try{
  h.f.bridge=async payload=>({...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,unexpectedLegalAuditAvailable:true,savedDocumentStepValidationAvailable:true});h.f.client.auditUnexpectedLegal=async session=>originalAuditFixtureReport(session);
  h.f.client.validateSavedDocumentSteps=async()=>{throw Error('PRIVATE_HUB_VALIDATION_BODY');};
  await h.idle();reconnectInputs(h);await h.click('원래 저장 문서 연결 복구');await h.click(auditOriginal);await h.click(validateStoredSteps);
  assert.match(h.text(),/응답이 미확정일 수 있어 자동 재검사는 하지 않았습니다/);assert.doesNotMatch(h.text(),/PRIVATE_HUB_VALIDATION_BODY/);assert.equal(h.button(validateStoredSteps).props.disabled,true);assert.equal(h.stored.size,0);
  for(const label of [start,prepareDraft,reviewPrepared])assert.equal(h.button(label),undefined);
 }finally{h.close();}
});

test('legacy uncertain validation exposes a separate deliberate recheck warning and sends only one explicitly clicked retry',async()=>{
 const retried=[],h=await fixture(undefined,{reconnect:async(_input,f)=>{throw reconnectClosedError(f,{savedDraftTargetClosed:false});}});try{
  h.f.bridge=async payload=>({...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,unexpectedLegalAuditAvailable:true,savedDocumentStepValidationAvailable:true,savedDocumentStepRetryAvailable:true});
  h.f.client.auditUnexpectedLegal=async session=>originalAuditFixtureReport(session);
  const makeReport=(session,state)=>({requestId:session.packet.requestId,docId:2347603,identityDigest:session.preview.identityDigest,packetDigest:session.packetDigest,
   stages:[{stage:2,state,cached:state==='uncertain',requested:state!=='uncertain',failureCode:state==='uncertain'?'prior-uncertain':null,errors:[],errorCount:0,errorsTruncated:false}]});
  h.f.client.validateSavedDocumentSteps=async session=>makeReport(session,'uncertain');
  h.f.client.retrySavedDocumentStep=async(session,audit,prior,signal)=>{retried.push({session,audit,prior,signal});return makeReport(session,'rejected');};
  await h.idle();reconnectInputs(h);await h.click('원래 저장 문서 연결 복구');await h.click(auditOriginal);await h.click(validateStoredSteps);
  const label='미확정 단계 검사 1회 다시 요청 · 파일·본문 저장 안 함';assert.equal(retried.length,0);assert.match(h.text(),/이전 검사 요청이 쿠팡에서 처리됐을 수 있습니다/);assert.ok(h.button(label));
  const click=h.button(label).props.onClick;click();click();await h.idle();assert.equal(retried.length,1);assert.equal(retried[0].prior.stages[0].failureCode,'prior-uncertain');assert.equal(retried[0].signal.aborted,false);assert.equal(h.stored.size,0);assert.equal(h.button(label),undefined);
  assert.ok(h.f.calls.every(row=>row.method==='GET'));assert.ok(h.f.sent.every(row=>row.payload.action==='preview'));for(const action of [start,prepareDraft,reviewPrepared])assert.equal(h.button(action),undefined);
 }finally{h.close();}
});
test('original document full audit is explicit and cannot adopt a session, claim a reservation or submit',async()=>{
 const audited=[],h=await fixture(undefined,{reconnect:async(_input,f)=>{throw reconnectClosedError(f,{savedDraftTargetClosed:false});}});try{
  h.f.bridge=async payload=>{assert.equal(payload.action,'preview');return{...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,preparedLifecycleAvailable:true};};
  h.f.client.auditUnexpectedLegal=async(session,signal)=>{assert.equal(signal.aborted,false);audited.push(session);return originalAuditFixtureReport(session);};
  await h.idle();reconnectInputs(h);assert.equal(h.button(auditOriginal),undefined);await h.click('원래 저장 문서 연결 복구');
  assert.ok(h.button(auditOriginal));assert.equal(audited.length,0);const click=h.button(auditOriginal).props.onClick;click();click();await h.idle();
  assert.equal(audited.length,1);assert.equal(audited[0].packet.requestId,'f29491bd-1882-456a-8a63-eec8586db6c6');assert.match(h.text(),/문서\s+2347603/);assert.match(h.text(),/원래 본문\s+불일치/);
  assert.match(h.text(),/원래 견적과 다른 저장 항목/);assert.doesNotMatch(h.text(),/본문 세부 항목 대조/,'older reports keep their coarse comparison without inventing leaf details');
  assert.match(h.text(),/인증서 파일명 규칙/);assert.match(h.text(),/certN- 규칙 연결 없음/);
  assert.match(h.text(),/동일 이미지 객체로 확인되지 않음/);assert.match(h.text(),/한글표시사항 파일명 참조/);assert.match(h.text(),/3회/);assert.ok(h.text().includes('a'.repeat(64)));
  assert.match(h.text(),/파일 내용의 동일 여부나 필요한 서류인지는 이 결과만으로 판단하지 않습니다/);
  assert.equal(h.stored.size,0);assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview']);assert.ok(h.f.calls.every(row=>row.method==='GET'));
  for(const label of [start,prepareDraft,reviewPrepared,'현재 문서 동의 확인 · 계속'])assert.equal(h.button(label),undefined);
 }finally{h.close();}
});

test('original legal audit distinguishes matched descriptors, zero label references and unknown references without offering delete or submit',async()=>{
 const h=await fixture(undefined,{reconnect:async(_input,f)=>{throw reconnectClosedError(f,{savedDraftTargetClosed:false});}});try{
  h.f.bridge=async payload=>({...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,unexpectedLegalAuditAvailable:true});
  h.f.client.auditUnexpectedLegal=async session=>originalAuditFixtureReport(session,{legalCount:2,legalEntries:[
   {index:0,kind:'certificate',association:'linked',schemaIndex:1,descriptorSha256:'b'.repeat(64),pairedImageDescriptorMatch:true,expectedLabelReferences:0},
   {index:1,kind:'other',association:'unknown',schemaIndex:null,descriptorSha256:'c'.repeat(64),pairedImageDescriptorMatch:false,expectedLabelReferences:null},
  ]});
  await h.idle();reconnectInputs(h);await h.click('원래 저장 문서 연결 복구');await h.click(auditOriginal);
  assert.match(h.text(),/certN- 규칙 일치/);assert.match(h.text(),/파일명·저장 위치 일치/);assert.match(h.text(),/0회/);assert.match(h.text(),/규칙 확인 필요/);assert.match(h.text(),/확인되지 않음/);
  assert.ok(h.text().includes('b'.repeat(64)));assert.ok(h.text().includes('c'.repeat(64)));assert.equal(h.stored.size,0);
  assert.ok(h.f.calls.every(row=>row.method==='GET'));assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview']);
  for(const label of [start,prepareDraft,reviewPrepared,'현재 문서 동의 확인 · 계속','첨부 삭제'])assert.equal(h.button(label),undefined);
 }finally{h.close();}
});

test('versioned original audit leaf rows show structural paths, fixed types and boolean/null states without exposing values or enabling repairs',async()=>{
 const h=await fixture(undefined,{reconnect:async(_input,f)=>{throw reconnectClosedError(f,{savedDraftTargetClosed:false});}});try{
  h.f.bridge=async payload=>({...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,unexpectedLegalAuditAvailable:true});
  h.f.client.auditUnexpectedLegal=async session=>originalAuditFixtureReport(session,{bodyLeafDifferences:{format:'yoofam-saved-body-leaf-differences-v1',visited:20,truncated:true,rows:[
   {path:['jsonDocument',0,'imagePage','agreeLabelContact'],expectedType:'boolean',actualType:'boolean',expectedValueKind:'present',actualValueKind:'present',expectedPrimitive:true,actualPrimitive:false},
   {path:['jsonDocument',1,'legalPage','adCert'],expectedType:'missing',actualType:'string-empty',expectedValueKind:'missing',actualValueKind:'empty'},
   {path:['jsonDocument',2,'productPage','stock'],expectedType:'number',actualType:'null',expectedValueKind:'present',actualValueKind:'present'},
   {path:['jsonDocument',2,'productPage','toString'],expectedType:'missing',actualType:'string-empty',expectedValueKind:'missing',actualValueKind:'empty'},
  ]}});
  await h.idle();reconnectInputs(h);await h.click('원래 저장 문서 연결 복구');await h.click(auditOriginal);
  const table=nodes(h.render()).find(node=>node.type==='table'&&nodes(node).some(child=>child.type==='caption'&&text(child)==='원래 견적과 다른 세부 저장 항목'));
  assert.ok(table);const rows=nodes(table).filter(node=>node.type==='tr').slice(1).map(row=>nodes(row).filter(node=>node.type==='td').map(text));
  assert.match(rows[0][0],/jsonDocument\[0\]\.imagePage\.agreeLabelContact/);assert.deepEqual(rows[0].slice(1),['참/거짓','참','참/거짓','거짓']);
  assert.match(rows[1][0],/광고 인증 정보/);assert.match(rows[1][0],/jsonDocument\[1\]\.legalPage\.adCert/);assert.deepEqual(rows[1].slice(1),['항목 없음','항목 없음','빈 문자열','빈 값']);
  assert.match(rows[2][0],/jsonDocument\[2\]\.productPage\.stock/);assert.deepEqual(rows[2].slice(1),['숫자','값 있음','null','null']);
  assert.match(rows[3][0],/^저장 항목/,'unknown structural keys do not inherit a dictionary prototype label');assert.match(rows[3][0],/jsonDocument\[2\]\.productPage\.toString/);
  assert.match(h.text(),/일부 항목만 표시/);assert.match(h.text(),/원문 값 대신 저장 경로·자료형·값 상태만 표시/);assert.match(h.text(),/원래 견적과 다른 저장 항목/,'coarse schema-bound differences remain available');
  assert.equal(h.stored.size,0);assert.ok(h.f.calls.every(row=>row.method==='GET'));assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview']);
  for(const label of [start,prepareDraft,reviewPrepared,'현재 문서 동의 확인 · 계속'])assert.equal(h.button(label),undefined);
  assert.doesNotMatch(h.text(),/s3:|\.jpe?g|비밀 원문|자동 복구 완료/u);
 }finally{h.close();}
});

test('a filtered empty leaf projection does not imply the original body matches or was fully compared',async()=>{
 const h=await fixture(undefined,{reconnect:async(_input,f)=>{throw reconnectClosedError(f,{savedDraftTargetClosed:false});}});try{
  h.f.bridge=async payload=>({...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,unexpectedLegalAuditAvailable:true});
  h.f.client.auditUnexpectedLegal=async session=>originalAuditFixtureReport(session,{bodyLeafDifferences:{format:'yoofam-saved-body-leaf-differences-v1',visited:20,truncated:true,rows:[]}});
  await h.idle();reconnectInputs(h);await h.click('원래 저장 문서 연결 복구');await h.click(auditOriginal);
  assert.match(h.text(),/원래 본문\s+불일치/);assert.match(h.text(),/대조 범위 또는 표시 한도로 일부 항목만 표시/);assert.match(h.text(),/원래 본문의 일치가 확인된 것은 아닙니다/);
  assert.equal(h.stored.size,0);assert.ok(h.f.calls.every(row=>row.method==='GET'));assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview']);
  for(const label of [start,prepareDraft,reviewPrepared,'현재 문서 동의 확인 · 계속'])assert.equal(h.button(label),undefined);
 }finally{h.close();}
});

test('exact-schema native patterns explain discrepancies without changing original mismatch, unlinked certificate or registration locks',async()=>{
 const schemaSha256='f675549f02d67d903a82e28ba4ba116ee1a96f7740558431b3a0ce4cbfd47e10';
 const h=await fixture(undefined,{schemaSha256,reconnect:async(_input,f)=>{throw reconnectClosedError(f,{savedDraftTargetClosed:false});}});try{
  h.f.bridge=async payload=>({...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,unexpectedLegalAuditAvailable:true});
  h.f.client.auditUnexpectedLegal=async session=>originalAuditFixtureReport(session,{bodyLeafDifferences:{format:'yoofam-saved-body-leaf-differences-v1',visited:20,truncated:false,rows:[
   {path:['jsonDocument',0,'productPage','commonAttributes','osrp'],expectedType:'string',actualType:'missing',expectedValueKind:'present',actualValueKind:'missing'},
   {path:['jsonDocument',1,'imagePage','details','htmlProductDetailContent'],expectedType:'string-empty',actualType:'null',expectedValueKind:'empty',actualValueKind:'present'},
   {path:['jsonDocument',1,'imagePage','msrpAgree'],expectedType:'boolean',actualType:'boolean',expectedValueKind:'present',actualValueKind:'present',expectedPrimitive:false,actualPrimitive:true},
  ]}});
  await h.idle();reconnectInputs(h);await h.click('원래 저장 문서 연결 복구');await h.click(auditOriginal);
  assert.match(h.text(),/공식 저장 형식과 같은 패턴\s+2\s*개 · 별도 확인\s+1\s*개/);assert.match(h.text(),/선택 항목 제외 패턴 · 값 누락 검토 필요/);assert.match(h.text(),/빈 상세 HTML의 null 변환 패턴/);assert.match(h.text(),/검증된 변환 규칙 없음 · 별도 확인/);
  assert.match(h.text(),/원래 본문\s+불일치/);assert.match(h.text(),/본문 불일치와 등록 차단은 유지/);assert.match(h.text(),/연결 없음/);assert.match(h.text(),/본문 차이\s+1\s*개/);
  assert.equal(h.stored.size,0);assert.ok(h.f.calls.every(row=>row.method==='GET'));assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview']);
  for(const label of [start,prepareDraft,reviewPrepared,'현재 문서 동의 확인 · 계속'])assert.equal(h.button(label),undefined);
  assert.doesNotMatch(h.text(),/원래 본문 일치|자동 복구 완료|정상 변환 확정/);
 }finally{h.close();}
});

test('original audit displays a fixed read phase/code, preserves typed schema failures and hides raw errors without enabling transmission',async()=>{
 for(const mode of ['typed-audit','unknown-audit','preview','after-audit']){
  let audits=0;const h=await fixture(undefined,{reconnect:async(_input,f)=>{throw reconnectClosedError(f,{savedDraftTargetClosed:false});}});try{
   await h.idle();reconnectInputs(h);await h.click('원래 저장 문서 연결 복구');
   h.f.bridge=async payload=>{if(mode==='preview')throw Error('PRIVATE_PREVIEW_STACK');return{...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,unexpectedLegalAuditAvailable:true};};
   h.f.client.auditUnexpectedLegal=async session=>{audits++;
    if(mode==='typed-audit')throw new h.f.client.ProductDocumentBridgeError('읽기 전용 인증서 스키마 조회를 중단했습니다. 단계: legal-documents / http-503. 문서·파일·본문을 변경하지 않았습니다.',false,'UNEXPECTED_LEGAL_AUDIT_SCHEMA_READ');
    if(mode==='unknown-audit')throw Error('PRIVATE_NATIVE_STACK');
    if(mode==='after-audit')h.f.refresh=async()=>{throw Error('PRIVATE_FINAL_SOURCE_READ');};
    return originalAuditFixtureReport(session);
   };
   await h.click(auditOriginal);const shown=h.text();assert.match(shown,/읽기 전용 대조 중단/u);assert.doesNotMatch(shown,/PRIVATE_|응답이 확정되지 않았습니다/u);
   if(mode==='typed-audit'){assert.match(shown,/문서·첨부 읽기 \[UNEXPECTED_LEGAL_AUDIT_SCHEMA_READ\]/u);assert.match(shown,/legal-documents \/ http-503/u);}
   if(mode==='unknown-audit')assert.match(shown,/문서·첨부 읽기 \[UNEXPECTED_LEGAL_AUDIT_READ_FAILED\]/u);
   if(mode==='preview')assert.match(shown,/확장 연결 확인 \[PRODUCT_DOCUMENT_DISPATCH_FAILED\]/u);
   if(mode==='after-audit')assert.match(shown,/대조 후 원본 확인 \[UNEXPECTED_LEGAL_AUDIT_READ_FAILED\]/u);
   assert.equal(audits,mode==='preview'?0:1);assert.equal(h.stored.size,0);assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview']);assert.ok(h.f.calls.every(row=>row.method==='GET'));
   for(const label of [start,prepareDraft,reviewPrepared,'현재 문서 동의 확인 · 계속'])assert.equal(h.button(label),undefined);
   assert.doesNotMatch(shown,/원래 본문\s+불일치/);assert.ok(h.button(auditOriginal));
  }finally{h.close();}
 }
});
test('audit callback expires on original input, review ABA, disabled scope and unmount',async()=>{
 for(const mode of ['input-ABA','review-ABA','disabled','unmount']){
  let calls=0;const h=await fixture(undefined,{reconnect:async(_input,f)=>{throw reconnectClosedError(f,{savedDraftTargetClosed:false});}});try{
   h.f.client.auditUnexpectedLegal=async()=>{calls++;throw Error('must not audit');};await h.idle();reconnectInputs(h);await h.click('원래 저장 문서 연결 복구');
   const callback=h.button(auditOriginal).props.onClick;
   if(mode==='input-ABA'){reconnectInputs(h,undefined,'2347604');reconnectInputs(h);}
   if(mode==='review-ABA'){const props=h.props();h.render({...props,review:{...props.review,reviewDigest:'f'.repeat(64)}});h.flush();h.render(props);h.flush();}
   if(mode==='disabled')h.render({...h.props(),disabled:true});
   if(mode==='unmount')h.close();callback();await turn();h.flush();assert.equal(calls,0);assert.equal(h.f.sent.length,0);assert.equal(h.stored.size,0);
  }finally{h.close();}
 }
});
test('late or mismatched audit result never displays as current or unlocks continuation',async()=>{
 for(const mode of ['disabled','input','doc','request','digest']){
  const gate=deferred();let entered=false;const h=await fixture(undefined,{reconnect:async(_input,f)=>{throw reconnectClosedError(f,{savedDraftTargetClosed:false});}});try{
   h.f.bridge=async payload=>({...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,preparedLifecycleAvailable:true});
   h.f.client.auditUnexpectedLegal=async session=>{entered=true;await gate.promise;return originalAuditFixtureReport(session,mode==='doc'?{docId:'2347604'}:mode==='request'?{requestId:'other-request'}:mode==='digest'?{packetDigest:'f'.repeat(64)}:{});};
   await h.idle();reconnectInputs(h);await h.click('원래 저장 문서 연결 복구');h.button(auditOriginal).props.onClick();await h.wait(()=>entered);
   if(mode==='disabled')h.render({...h.props(),disabled:true});
   // A real input is disabled during a read; a changed review is the source
   // boundary that can invalidate it while that response is in flight.
   if(mode==='input')h.render({...h.props(),review:{...h.props().review,reviewDigest:'e'.repeat(64)}});
   gate.resolve();await h.idle();assert.doesNotMatch(h.text(),/원래 본문\s+불일치/);assert.equal(h.stored.size,0);assert.equal(h.button(reviewPrepared),undefined);assert.equal(h.button(start),undefined);
  }finally{gate.resolve();h.close();}
 }
});
function reconnectClosedError(f,patch={}){
 return Object.assign(new f.client.ProductDocumentBridgeError('원래 저장 문서 검증 탭이 닫혔습니다.',false,'PRODUCT_DOCUMENT_DRAFT_SOURCE_FAILURE','update-requested'),{savedDraftTargetClosed:true,knownDocId:'2347603',...patch});
}
test('a correlated closed original tab exposes only explicit target read recovery before any web reservation or session adoption',async()=>{
 const calls=[],h=await fixture(undefined,{reconnect:async(input,f)=>{
  calls.push({recoverSavedTarget:input.recoverSavedTarget,target:plain(input.target)});
  if(!input.recoverSavedTarget)throw reconnectClosedError(f);
  assert.equal(input.isCurrent(),true);assert.equal(h.stored.size,0);
  const packet=await createProductDocumentPacket(input.review,{requestId:input.target.requestId,createdAt:f.clock.now,now:f.clock.now}),session=await f.client.previewProductDocument(packet,input.signal);
  const pending=await f.load('app/supplier-hub-product-pending.ts').claimProductDocumentPending(input.review,session,input.signal,async()=>assert.equal(input.isCurrent(),true));
  return {session,pending,observation:draftResult(f,input.target.requestId,'validated',{docId:input.target.docId})};
 }});try{
  h.f.bridge=async payload=>{assert.equal(payload.action,'preview');return {...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,preparedLifecycleAvailable:true};};
  await h.idle();reconnectInputs(h);assert.equal(h.button(reconnectSavedTarget),undefined);await h.click('원래 저장 문서 연결 복구');
  assert.ok(h.button(reconnectSavedTarget));assert.equal(h.stored.size,0);assert.equal(h.f.sent.length,0);assert.equal(h.button(prepareDraft),undefined);assert.equal(h.button(start),undefined);assert.equal(h.button(reviewPrepared),undefined);
  assert.deepEqual(calls.map(row=>row.recoverSavedTarget),[undefined]);await h.click(reconnectSavedTarget);
  assert.deepEqual(calls.map(row=>row.recoverSavedTarget),[undefined,true]);assert.ok(calls.every(row=>row.target.requestId==='f29491bd-1882-456a-8a63-eec8586db6c6'&&row.target.docId==='2347603'));
  assert.equal(h.stored.size,1);assert.equal(h.button(reconnectSavedTarget),undefined);assert.ok(h.button(reviewPrepared));assert.equal(h.button(prepareDraft),undefined);assert.equal(h.button(start),undefined);
  assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview']);assert.ok(h.f.calls.every(row=>row.method==='GET'));assert.equal(h.f.history.length,0);
 }finally{h.close();}
});

test('generic, uncertain or mismatched closed errors cannot create a target recovery control',async()=>{
 for(const patch of [{generic:true},{uncertain:true},{savedDraftTargetClosed:false},{knownDocId:'2347604'},{draftState:'created'},{code:'OTHER'}]){
  const h=await fixture(undefined,{reconnect:async(_input,f)=>{if(patch.generic)throw Object.assign(Error('closed'),{savedDraftTargetClosed:true,knownDocId:'2347603'});throw reconnectClosedError(f,patch);}});try{
   await h.idle();reconnectInputs(h);await h.click('원래 저장 문서 연결 복구');assert.equal(h.button(reconnectSavedTarget),undefined);assert.equal(h.stored.size,0);assert.equal(h.f.sent.length,0);
  }finally{h.close();}
 }
});

test('closed-target hint and captured callbacks expire on input epochs, disabled scope, review ABA and unmount',async()=>{
 for(const mode of ['input','input-ABA','disabled','review-ABA','unmount']){
  let calls=0;const h=await fixture(undefined,{reconnect:async(_input,f)=>{calls++;throw reconnectClosedError(f);}});try{
   await h.idle();reconnectInputs(h);await h.click('원래 저장 문서 연결 복구');const stale=h.button(reconnectSavedTarget).props.onClick;
   if(mode==='input'||mode==='input-ABA'){reconnectInputs(h,'f29491bd-1882-456a-8a63-eec8586db6c6','2347604');if(mode==='input-ABA')reconnectInputs(h);assert.equal(h.button(reconnectSavedTarget),undefined);}
   if(mode==='disabled')h.render({...h.props(),disabled:true});
   if(mode==='review-ABA'){const props=h.props(),next=plain(props.review);next.reviewDigest='f'.repeat(64);h.render({...props,review:next});h.flush();h.render(props);h.flush();assert.equal(h.button(reconnectSavedTarget),undefined);}
   if(mode==='unmount')h.close();
   stale();await turn();h.flush();assert.equal(calls,1);assert.equal(h.stored.size,0);assert.equal(h.f.sent.length,0);
  }finally{h.close();}
 }
});

test('a late closed error after the review is disabled does not offer a recovery action',async()=>{
 const gate=deferred(),h=await fixture(undefined,{reconnect:async(_input,f)=>{await gate.promise;throw reconnectClosedError(f);}});try{
  await h.idle();reconnectInputs(h);h.button('원래 저장 문서 연결 복구').props.onClick();h.flush();h.render({...h.props(),disabled:true});gate.resolve();await turn();h.flush();
  assert.equal(h.button(reconnectSavedTarget),undefined);assert.equal(h.stored.size,0);assert.equal(h.f.sent.length,0);
 }finally{h.close();}
});

for(const company of SINGLE_COMPANIES)for(const status of ['SUBMITTED','FINISHED','REJECTED'])test(`${company.code}: ${status} releases enclosing close/source guards only after its exact local receipt is positively saved`,async()=>{
 const gate=deferred(),h=await fixture(company,{verified:true,beforeSaveReply:()=>gate.promise});try{
  h.render();assert.deepEqual(h.lockPairs.at(-1),[true,true],'unchecked local pending storage is not yet permission to leave or change the source');
  await h.idle();assert.deepEqual(h.lockPairs.at(-1),[false,false]);await h.click(open);assert.deepEqual(h.lockPairs.at(-1),[true,true]);
  h.f.bridge=async payload=>({...h.f.observation(status),requestId:payload.packet.requestId});h.button(start).props.onClick();h.flush();
  await h.wait(()=>h.f.calls.some(row=>row.method==='POST'));
  assert.deepEqual(h.lockPairs.at(-1),[true,true],'a native terminal response before the local save ACK is still owned by this view');
  gate.resolve();await h.idle();
  const expected=status==='FINISHED'?[true,false]:status==='REJECTED'?[false,false]:[true,true];assert.deepEqual(h.lockPairs.at(-1),expected);
  assert.equal(h.stored.size,1,'accepted/pending retain the original operation; rejected retains its immutable ledger');
  assert.equal([...h.stored.keys()].some(key=>key.startsWith('yoofam-product-document-pending:')),status!=='REJECTED');
  assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','start']);assert.equal(h.f.history[0].registered,false);
 }finally{gate.resolve();h.close();}
});

test('an accepted observation whose local save fails keeps both guards until retry saves the same packet, without a second Hub action',async()=>{
 let fail=true;const h=await fixture(SINGLE_COMPANIES[0],{verified:true,beforeSaveReply(){if(fail)throw Error('synthetic lost receipt ACK');}});try{
  await h.idle();await h.click(open);h.f.bridge=async payload=>({...h.f.observation('FINISHED'),requestId:payload.packet.requestId});await h.click(start);
  assert.deepEqual(h.lockPairs.at(-1),[true,true]);assert.ok(h.button('확인 결과 저장 다시 시도'));assert.equal(h.stored.size,1);
  const packet=JSON.stringify(h.f.sent[1].payload.packet);fail=false;await h.click('확인 결과 저장 다시 시도');
  assert.deepEqual(h.lockPairs.at(-1),[true,false]);assert.equal(h.button('확인 결과 저장 다시 시도'),undefined);assert.equal(JSON.stringify(h.f.sent[1].payload.packet),packet);
  assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','start']);assert.equal(h.f.calls.filter(row=>row.method==='POST').length,2);
 }finally{h.close();}
});

for(const initial of ['SUBMITTED','FINISHED'])test(`a newer stored rejection supersedes displayed ${initial} without trapping the released original request`,async()=>{
 const h=await fixture(SINGLE_COMPANIES[0],{verified:true,beforeSaveReply(record,f){record.receipt.observedAt=f.clock.now+1;record.receipt.state='rejected';record.receipt.sourceStatus='REJECTED';}});try{
  await h.idle();await h.click(open);h.f.bridge=async payload=>({...h.f.observation(initial),requestId:payload.packet.requestId});await h.click(start);
  assert.equal(h.f.history[0].receipt.sourceStatus,'REJECTED');assert.deepEqual(h.lockPairs.at(-1),[false,false]);
  assert.match(h.text().replace(/\s+/gu,' '),/문서 new-document-728 · 등록 파일 qvt-728 · 반려/);assert.doesNotMatch(h.text().replace(/\s+/gu,' '),/문서 new-document-728 · 등록 파일 qvt-728 · (접수 처리 중|파일 처리 완료)/);
  assert.equal([...h.stored.keys()].some(key=>key.startsWith('yoofam-product-document-pending:')),false);assert.equal(h.stored.size,1,'the exact immutable rejection ledger is retained');
  assert.equal(h.button('접수 결과 조회'),undefined);assert.equal(h.button('확인 결과 저장 다시 시도'),undefined);
  assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','start']);assert.equal(h.f.calls.filter(row=>row.method==='POST').length,1);
 }finally{h.close();}
});

test('a newer stored acceptance releases closing while retaining its exact original request and document',async()=>{
 const h=await fixture(SINGLE_COMPANIES[0],{verified:true,beforeSaveReply(record,f){record.receipt.observedAt=f.clock.now+1;record.receipt.state='accepted';record.receipt.sourceStatus='FINISHED';}});try{
  await h.idle();await h.click(open);h.f.bridge=async payload=>({...h.f.observation('SUBMITTED'),requestId:payload.packet.requestId});await h.click(start);
  assert.equal(h.f.history[0].receipt.sourceStatus,'FINISHED');assert.deepEqual(h.lockPairs.at(-1),[true,false]);
  assert.match(h.text().replace(/\s+/gu,' '),/문서 new-document-728 · 등록 파일 qvt-728 · 파일 처리 완료/);assert.equal(h.stored.size,1);assert.ok([...h.stored.keys()][0].startsWith('yoofam-product-document-pending:'));
  assert.ok(h.button('접수 결과 조회'));assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','start']);assert.equal(h.f.calls.filter(row=>row.method==='POST').length,1);
 }finally{h.close();}
});

test('prepared rejection superseding a pending receipt preserves lifecycle proof, releases closing, and exposes no inert observation action',async()=>{
 const h=await fixture(SINGLE_COMPANIES[0],{beforeSaveReply(record,f){record.receipt.observedAt=f.clock.now+1;record.receipt.state='rejected';record.receipt.sourceStatus='REJECTED';}});try{
  allowPrepared(h,payload=>payload.action==='reviewPreparedDraft'?preparedResult(h,payload,'awaiting-consent',14,{challenge:h.f.challenge('logisticsPage')}):preparedResult(h,payload,'pending',17,{receipt:h.f.observation('SUBMITTED').receipt}));
  await h.idle();await h.click(open);await h.click(prepareDraft);await h.click(reviewPrepared);await h.click(confirmPrepared);
  assert.deepEqual(h.lockPairs.at(-1),[false,false]);assert.match(h.text().replace(/\s+/gu,' '),/문서 new-document-728 · 등록 파일 qvt-728 · 반려/);
  assert.equal(h.button('접수 결과 조회'),undefined);assert.equal(h.button(recoverPrepared),undefined);assert.equal(h.stored.size,1);
  assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','prepareDraft','reviewPreparedDraft','confirmPreparedDraft']);assert.equal(h.f.calls.filter(row=>row.method==='POST').length,1);
 }finally{h.close();}
});

for(const mode of ['disabled','review-ABA'])test(`a newer stored receipt cannot release or replace ${mode} local observation ownership`,async()=>{
 const gate=deferred(),h=await fixture(SINGLE_COMPANIES[0],{verified:true,beforeSaveReply:async(record,f)=>{await gate.promise;record.receipt.observedAt=f.clock.now+1;record.receipt.state='rejected';record.receipt.sourceStatus='REJECTED';}});try{
  await h.idle();await h.click(open);h.f.bridge=async payload=>({...h.f.observation('SUBMITTED'),requestId:payload.packet.requestId});h.button(start).props.onClick();h.flush();await h.wait(()=>h.f.calls.some(call=>call.method==='POST'));
  const before=h.props();if(mode==='disabled')h.render({...before,disabled:true});else{h.render({...before,review:{...before.review,reviewDigest:'e'.repeat(64)}});h.render(before);}h.flush();
  gate.resolve();await h.idle();if(mode==='disabled'){h.render(before);h.flush();}
  assert.equal(h.f.history[0].receipt.sourceStatus,'REJECTED','the isolated API save may finish, but its stale acknowledgement cannot mutate the current UI');
  assert.deepEqual(h.lockPairs.at(-1),[true,true]);assert.ok([...h.stored.keys()].some(key=>key.startsWith('yoofam-product-document-pending:')));assert.ok([...h.stored.keys()].every(key=>!key.startsWith('yoofam-product-document-rejections:')));
  assert.doesNotMatch(h.text().replace(/\s+/gu,' '),/문서 new-document-728 · 등록 파일 qvt-728 · 반려/);assert.ok(h.button('확인 결과 저장 다시 시도'));
  assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','start']);assert.equal(h.f.calls.filter(row=>row.method==='POST').length,1);
 }finally{gate.resolve();h.close();}
});

for (const company of SINGLE_COMPANIES) test(company.name + ': explicit preview rechecks before/after and retains all included options without live actions', async () => {
  const h = await fixture(company); try {
    await h.idle(); await h.wait(() => h.f.calls.length === 3); assert.equal(h.f.sent.length, 0); assert.equal(h.refreshCalls.length, 0);
    assert.ok(h.f.calls.every(call => call.method === 'GET')); await h.click(open);
    assert.equal(h.refreshCalls.length, 2); assert.deepEqual(plain(h.f.sent.map(message => message.payload.action)), ['preview']);
    const packet = h.f.sent[0].payload.packet; assert.equal(packet.review.members.length, 2); assert.equal(packet.review.body.jsonDocument.length, 2); assert.equal(Object.hasOwn(packet, 'optionId'), false);
    assert.equal(packet.review.body.jsonDocument[1].productPage.modelNumber, ''); assert.equal(h.button(start), undefined); assert.ok(h.text().includes(company.name)); assert.match(h.text(), /포함 옵션\s*2\s*개/);
    assert.ok(h.text().includes('현재 상품은 전송하지 않았습니다.')); assert.ok(h.button(close)); assert.equal(h.button(open).props.disabled, true);
    await h.click(close); assert.equal(h.button(open).props.disabled, false); assert.equal(h.f.sent.length, 1);
    cases.push({ name: 'explicit full preview ' + company.code, included: 2, refreshes: 2, nativeActions: 0 });
  } finally { h.close(); }
});

test('pending preview locks once, ignores old callback duplicates and suppresses stale owner/fingerprint results', async () => {
  const h = await fixture(), held = deferred(); try {
    await h.idle(); h.f.refresh = () => held.promise; const oldOpen = h.button(open).props.onClick; oldOpen(); oldOpen(); h.flush(); assert.equal(h.refreshCalls.length, 1); assert.equal(h.button(open).props.disabled, true);
    const changed = { ...h.props().review, identity: { ...h.props().review.identity, ownerId: 'other-owner' }, reviewDigest: 'e'.repeat(64) };
    h.render({ ...h.props(), review: changed }); held.resolve(changed); await h.idle(); oldOpen(); h.flush(); assert.equal(h.f.sent.length, 0); assert.equal(h.refreshCalls.length, 1);
    assert.equal(h.button(close), undefined); cases.push({ name: 'stale props and callbacks', duplicatePreviews: 0, staleResultAdoptions: 0 });
  } finally { h.close(); }
});

test('late disabled preview and changed fresh review never expose a session', async () => {
  for (const mode of ['disabled', 'changed', 'owner']) { const h = await fixture(), held = deferred(); try {
    await h.idle(); h.f.refresh = () => held.promise; h.button(open).props.onClick(); h.flush();
    if (mode === 'disabled') h.render({ ...h.props(), disabled: true });
    if (mode === 'owner') h.f.actor.ownerId = 'different';
    held.resolve(mode === 'changed' ? { ...h.f.review, reviewDigest: 'e'.repeat(64) } : mode === 'owner' ? Promise.reject(Error('회원 회사 변경')) : plain(h.f.review));
    await h.idle(); assert.equal(h.f.sent.length, 0); assert.equal(h.button(close), undefined);
  } finally { h.close(); } }
  cases.push({ name: 'disabled/changed/member preflight', noSession: true, nativeActions: 0 });
});

test('changed post-preview fresh data rejects even a valid extension ACK', async () => {
  const h = await fixture(); try {
    await h.idle(); let count = 0; h.f.refresh = async () => ++count === 2 ? { ...h.f.review, preparedBodySha256: 'e'.repeat(64) } : plain(h.f.review);
    await h.click(open); assert.equal(h.f.sent.length, 1); assert.equal(h.button(close), undefined); assert.ok(h.text().includes('바뀌었습니다'));
    cases.push({ name: 'post ACK fresh source', staleSessionAdoptions: 0 });
  } finally { h.close(); }
});

test('missing start ACK retains the same request and only offers read recovery, never a second start', async () => {
  const h = await fixture(SINGLE_COMPANIES[0], { verified: true }); try {
    await h.idle(); await h.click(open); const oldStart = h.button(start).props.onClick;
    h.f.bridge = async () => undefined; oldStart(); h.flush(); await h.wait(() => h.f.sent.length === 2); h.f.advance(60001); await h.idle();
    assert.equal(h.button(start), undefined); assert.ok(h.button(recover)); oldStart(); h.flush(); assert.equal(h.f.sent.length, 2);
    assert.equal(h.f.sent[0].payload.packet.requestId, h.f.sent[1].payload.packet.requestId); assert.equal(h.button(close), undefined);
    cases.push({ name: 'missing mutation ACK', sameRequestRetained: true, duplicateStarts: 0 });
  } finally { h.close(); }
});

test('disabling while start ACK is pending still retains uncertainty after re-enable', async () => {
  const h = await fixture(SINGLE_COMPANIES[0], { verified: true }); try {
    await h.idle(); await h.click(open); h.f.bridge = async () => undefined; h.button(start).props.onClick(); h.flush(); await h.wait(() => h.f.sent.length === 2);
    h.render({ ...h.props(), disabled: true }); h.f.advance(60001); await h.idle(); h.render({ ...h.props(), disabled: false }); h.flush();
    assert.equal(h.button(start), undefined, 'an unresolved native request must never be advertised as a new start'); assert.ok(h.button(recover)); assert.equal(h.f.sent.length, 2);
    cases.push({ name: 'disabled in flight', sameRequestUncertaintyRetained: true });
  } finally { h.close(); }
});

test('mixed native history labels group versus scalar documents without a SKU registration claim', async () => {
  const h = await fixture(); try {
    h.f.history = [await factory.groupRecord(h.f, 'FINISHED'), await factory.legacyRecord(h.f)]; await h.idle(); await h.wait(() => h.text().includes('보관된 문서 확인 이력'));
    assert.ok(h.text().includes('포함 옵션 2개 · 문서 1개')); assert.ok(h.text().includes('개별 옵션 문서')); assert.ok(h.text().includes('파일 처리 완료 · SKU 확인 전'));
    assert.equal(h.text().includes('등록 완료'), false); assert.equal(h.f.sent.length, 0); assert.ok(h.f.calls.every(call => call.method === 'GET'));
    cases.push({ name: 'mixed receipt labels', groupAndScalarDistinct: true, skuClaim: false, nativeActions: 0 });
  } finally { h.close(); }
});

test('unmount and an expired envelope restore the original operation UUID for explicit read recovery only',async()=>{
 const stored=new Map(),first=await fixture(SINGLE_COMPANIES[0],{verified:true,stored});let original;
 try{
  await first.idle();await first.click(open);first.f.bridge=async()=>undefined;first.button(start).props.onClick();first.flush();await first.wait(()=>first.f.sent.length===2);
  original=first.f.sent[1].payload.packet;first.f.advance(60001);await first.idle();assert.equal(stored.size,1);assert.equal(first.button(start),undefined);
 }finally{first.close();}
 const next=await fixture(SINGLE_COMPANIES[0],{verified:true,stored});try{
  next.f.clock.now=original.createdAt+240001;await next.idle();assert.equal(next.f.sent.length,0,'mount never dispatches a preview/start/recovery');
  assert.notEqual(next.f.packet.requestId,original.requestId,'a new mount has a different default UUID');assert.equal(next.button(start),undefined);assert.ok(next.button('이전 문서 전송 자료 확인'));
  next.f.bridge=async payload=>payload.action==='preview'?{...next.f.preview(),requestId:payload.packet.requestId}:{...next.f.state('created'),requestId:original.requestId};
  await next.click('이전 문서 전송 자료 확인');assert.deepEqual(plain(next.f.sent.map(row=>row.payload.action)),['preview']);assert.ok(next.button(recover));assert.equal(next.button(start),undefined);
  await next.click(recover);assert.deepEqual(plain(next.f.sent.map(row=>row.payload.action)),['preview','recover']);assert.ok(next.f.sent.every(row=>row.payload.packet.requestId===original.requestId));
  assert.ok(next.f.sent[0].payload.packet.createdAt>original.createdAt+120000);assert.equal(JSON.parse([...stored.values()][0]).createdAt,original.createdAt,'audit timestamp is not renewed');
  assert.equal(next.f.calls.some(row=>row.method==='POST'),false);assert.equal(stored.size,1,'an in-progress operation remains reserved');
 }finally{next.close();}
});

test('storage failure and cross-tab descriptor replacement block a new native mutation',async()=>{
 const broken=await fixture(SINGLE_COMPANIES[0],{verified:true,storageWriteError:true});try{
  await broken.idle();await broken.click(open);await broken.click(start);assert.deepEqual(plain(broken.f.sent.map(row=>row.payload.action)),['preview']);assert.equal(broken.stored.size,0);
 }finally{broken.close();}
 const h=await fixture(SINGLE_COMPANIES[0],{verified:true});try{
  await h.idle();await h.click(open);h.f.bridge=async()=>undefined;h.button(start).props.onClick();h.flush();await h.wait(()=>h.f.sent.length===2);
  const [key,raw]=[...h.stored][0],other={...JSON.parse(raw),requestId:'00000000-0000-4000-8000-000000000739'};h.stored.set(key,JSON.stringify(other));h.storageChanged(key);await h.idle();
  assert.match(h.text(),/다른 탭/);assert.equal(h.f.sent.length,2);assert.equal(h.button(start),undefined);h.button(recover)?.props.onClick();await h.idle();assert.equal(h.f.sent.length,2);
 }finally{h.close();}
});

test('durably saved terminal rejection clears only its operation so a later proposal is not falsely blocked',async()=>{
 const stored=new Map(),h=await fixture(SINGLE_COMPANIES[0],{verified:true,stored});try{
  await h.idle();await h.click(open);h.f.bridge=async payload=>({...h.f.observation('REJECTED'),requestId:payload.packet.requestId});
  await h.click(start);assert.equal(h.f.calls.filter(row=>row.method==='POST').length,1);assert.equal(stored.size,1);assert.match(h.text(),/반려/);
 }finally{h.close();}
 const reopened=await fixture(SINGLE_COMPANIES[0],{verified:true,stored});try{
  await reopened.idle();assert.ok(reopened.button(open));assert.equal(reopened.button('이전 문서 전송 자료 확인'),undefined);assert.equal(reopened.f.sent.length,0);
  await reopened.click(open);assert.equal(reopened.f.sent.length,0);assert.match(reopened.text(),/상품·견적서를 수정/);
 }finally{reopened.close();}
});

test('owner changes while the descriptor lock is pending cannot dispatch a stale start',async()=>{
 const h=await fixture(SINGLE_COMPANIES[0],{verified:true}),held=deferred();try{
  await h.idle();await h.click(open);let locked;
  h.f.window.navigator.locks.request=async(_name,_options,run)=>{locked=run;await held.promise;return run();};
  h.button(start).props.onClick();h.flush();await h.wait(()=>Boolean(locked));h.f.actor.ownerId='different-member';held.resolve();await h.idle();
  assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview']);assert.equal(h.stored.size,0,'changed source is rejected before any intent or Hub request exists');assert.match(h.text(),/회원 회사/);
  await h.click(start);assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview']);assert.equal(h.stored.size,0);
 }finally{h.close();}
});

test('changed source on remount keeps the old descriptor and cannot preview or start a new operation',async()=>{
 const stored=new Map(),h=await fixture(SINGLE_COMPANIES[0],{verified:true,stored});try{
  await h.idle();await h.click(open);h.f.bridge=async()=>undefined;h.button(start).props.onClick();h.flush();await h.wait(()=>h.f.sent.length===2);h.f.advance(60001);await h.idle();
 }finally{h.close();}
 const next=await fixture(SINGLE_COMPANIES[0],{verified:true,stored});try{
  const changed={...next.props().review,reviewDigest:'e'.repeat(64)};next.render({...next.props(),review:changed});await next.idle();
  assert.match(next.text(),/이전 저장값/);assert.equal(next.f.sent.length,0);assert.equal(next.button(start),undefined);assert.equal(stored.size,1);
 }finally{next.close();}
});

test('late rejected history cannot delete the descriptor under a connected recovery session',async()=>{
 const stored=new Map(),first=await fixture(SINGLE_COMPANIES[0],{verified:true,stored});let original;
 try{await first.idle();await first.click(open);first.f.bridge=async()=>undefined;first.button(start).props.onClick();first.flush();await first.wait(()=>first.f.sent.length===2);original=first.f.sent[1].payload.packet;first.f.advance(60001);await first.idle();}finally{first.close();}
 const held=deferred(),next=await fixture(SINGLE_COMPANIES[0],{verified:true,stored,historyResponse:()=>held.promise});try{
  await next.idle();await next.click('이전 문서 전송 자료 확인');assert.ok(next.button(recover));
  const rejected=await factory.groupRecord(next.f,'REJECTED');rejected.requestId=original.requestId;
  held.resolve(Response.json({format:'yoofam-native-receipt-history-v1',productId:next.f.review.identity.productId,receipts:[rejected]}));
  await next.wait(()=>next.text().includes('보관된 문서 확인 이력'));await turn();next.flush();assert.equal(stored.size,1);assert.ok(next.button(recover));
  next.f.bridge=async payload=>({...next.f.observation('REJECTED'),requestId:payload.packet.requestId});await next.click(recover);
  assert.equal(stored.size,1);assert.equal(next.f.sent.filter(row=>row.payload.action==='start').length,0);assert.match(next.text(),/반려/);
 }finally{next.close();}
});

for(const company of SINGLE_COMPANIES)test(company.name+': actual receiver step-2 rejection survives lost ACK/remount and permits only explicit corrected review',async()=>{
 const stored=new Map(),first=await fixture(company,{verified:true,stored});let nativeReceiver,original;
 try{
  await first.idle();await first.click(open);original=first.f.sent[0].payload.packet;
  nativeReceiver=await productValidationRejectionFixture(original,{now:first.f.clock.now});
  first.f.bridge=async payload=>{assert.equal(payload.action,'start');const result=await nativeReceiver.receiver.start(payload.packet,SINGLE_SENDER);assert.equal(result.state,'validation-rejected');return undefined;};
  first.button(start).props.onClick();first.flush();await first.wait(()=>nativeReceiver.storage.get(nativeReceiver.context.key)?.state==='validation-rejected');first.f.advance(60001);await first.idle();
  assert.equal(nativeReceiver.creates,1);assert.equal(nativeReceiver.updates,1);assert.equal(nativeReceiver.validations,1);assert.equal(stored.size,1);assert.ok(first.button(recover));assert.equal(first.button(release),undefined);
 }finally{first.close();}
 const next=await fixture(company,{verified:true,stored});try{
  next.f.clock.now=original.createdAt+240001;nativeReceiver.now=next.f.clock.now;nativeReceiver.remount();await next.idle();assert.equal(next.f.sent.length,0);
  next.f.bridge=async payload=>payload.action==='preview'?{...next.f.preview(),requestId:payload.packet.requestId}:nativeReceiver.receiver.recover(payload.packet,SINGLE_SENDER);
  await next.click('이전 문서 전송 자료 확인');await next.click(recover);assert.ok(next.button(release));assert.equal(next.button('현재 문서 단계 계속 확인'),undefined);assert.equal(stored.size,1,'reading rejection alone never releases reservation');
  assert.match(next.text(),/수정할 입력 항목/);assert.match(next.text(),/supplyPrice/);assert.match(next.text(),/합성 단계 검증 반려/);
  assert.equal(nodes(next.render()).filter(node=>node.type==='caption'&&node.props.children==='Supplier Hub 단계 검증 결과').length,1);
  const held=next.button(release).props.onClick;await next.click(release);assert.equal(stored.size,1,'compact rejected identity survives release');assert.ok(next.button(open));assert.equal(next.button(start),undefined);assert.equal(next.locks.at(-1),false);
  assert.match(next.text(),/supplyPrice/);assert.match(next.text(),/합성 단계 검증 반려/,'explicit release keeps current review diagnostics readable');
  assert.equal(JSON.stringify([...stored.values()]).includes('합성 단계 검증 반려'),false,'large native diagnostics never replace compact immutable rejection proof');
  const originalProps=next.props();next.render({...originalProps,review:{...originalProps.review,identity:{...originalProps.review.identity,ownerId:'other-owner'}}});
  assert.doesNotMatch(next.text(),/합성 단계 검증 반려/);next.render(originalProps);assert.doesNotMatch(next.text(),/합성 단계 검증 반려/,'review ABA cannot revive another view report');
  held();next.flush();assert.deepEqual(plain(next.f.sent.map(row=>row.payload.action)),['preview','recover','recover']);
  assert.ok(next.f.sent.every(row=>row.payload.packet.requestId===original.requestId));assert.equal(nativeReceiver.creates,1);assert.equal(nativeReceiver.updates,1);assert.equal(nativeReceiver.validations,1);assert.equal(next.f.calls.some(row=>row.method==='POST'),false);nativeReceiver.assertPreserved();
 }finally{next.close();}
 const corrected=await fixture(company,{verified:true,stored});let secondReceiver;try{
  const changed=plain(corrected.f.review);changed.body.jsonDocument[1].productPage.supplyPrice=4321;changed.identity.source.quotationRevision++;
  const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  const hash=value=>createHash('sha256').update(canonical(value)).digest('hex'),deferredBody=plain(changed.body);
  for(const document of deferredBody.jsonDocument)for(const key of ['msrpAgree','labelContactAgreed'])if(Object.hasOwn(document.imagePage??{},key))document.imagePage[key]=false;
  changed.originalBodySha256=hash(changed.body);changed.preparedBodySha256=hash(deferredBody);changed.reviewDigest=hash({format:changed.format,type:changed.type,identity:changed.identity,members:changed.members,originalBodySha256:changed.originalBodySha256,preparedBodySha256:changed.preparedBodySha256});
  corrected.f.review=changed;corrected.render({...corrected.props(),review:changed});await corrected.idle();assert.equal(corrected.f.sent.length,0);
  corrected.f.bridge=async payload=>{
   if(payload.action==='preview'){const context=await productDocumentIdentity(payload.packet,SINGLE_SENDER,{now:corrected.f.clock.now});return {...corrected.f.preview(),requestId:payload.packet.requestId,identity:context.identity,identityDigest:context.identityDigest,packetDigest:context.packetDigest,reviewDigest:changed.reviewDigest,preparedBodySha256:changed.preparedBodySha256,originalBodySha256:changed.originalBodySha256};}
   assert.equal(payload.action,'start');secondReceiver=await productValidationRejectionFixture(payload.packet,{now:corrected.f.clock.now,storage:nativeReceiver.storage,documents:nativeReceiver.documents});return secondReceiver.receiver.start(payload.packet,SINGLE_SENDER);
  };
  await corrected.click(open);assert.ok(corrected.button(start));assert.equal(secondReceiver,undefined);assert.notEqual(corrected.f.sent[0].payload.packet.requestId,original.requestId);
  await corrected.click(start);assert.equal(secondReceiver.creates,1,corrected.text());assert.equal(nativeReceiver.creates,1);assert.equal(secondReceiver.validations,1);assert.equal(stored.size,2,'prior rejection and new pending are both durable');secondReceiver.assertPreserved();
  cases.push({name:'actual validation rejection recovery '+company.code,step:2,lostAck:true,remount:true,explicitRecoveries:2,correctedBody:true,oldOperationCreates:1,syntheticCorrectedCreates:1,realProductWrites:0,hubWrites:0});
 }finally{corrected.close();nativeReceiver.close();}
});

test('legacy validation without diagnostics stays explicit and never invents an input error',async()=>{
 const h=await fixture(SINGLE_COMPANIES[0],{verified:true});try{
  await h.idle();await h.click(open);h.f.bridge=async payload=>validationRejected(h.f,payload.packet.requestId);await h.click(start);
  assert.match(h.text(),/수정할 입력 항목/);assert.match(h.text(),/오류 상세가 제공되지 않았습니다/);
  assert.equal(nodes(h.render()).some(node=>node.type==='caption'&&node.props.children==='Supplier Hub 단계 검증 결과'),false);
  assert.equal(h.f.sent.length,2);assert.equal(h.f.calls.some(row=>row.method==='POST'),false);
 }finally{h.close();}
});

test('validation rejection release rejects missing/altered proof, uncertain/error ACK and changed document or account',async()=>{
 for(const mode of ['missing','step','sequence','submitted','extra','error','unrecovered','uncertain','doc','request','owner','proof-change']){
  const h=await fixture(SINGLE_COMPANIES[0],{verified:true});try{
   await h.idle();await h.click(open);let original;
   h.f.bridge=async payload=>{const result=validationRejected(h.f,payload.packet.requestId);original=plain(result);return result;};await h.click(start);assert.ok(h.button(release));
   h.f.bridge=async()=>{const result={...plain(original),recovered:true};
    if(mode==='missing')delete result.validationRejection;
    if(mode==='step')result.validationRejection.step=3;
    if(mode==='sequence')result.validationRejection.checkpointSequence=0;
    if(mode==='submitted')result.validationRejection.submitted=true;
    if(mode==='extra')result.validationRejection.unknown=true;
    if(mode==='error')result.error={code:'SOURCE_CHANGED',message:'합성 조회 실패'};
    if(mode==='unrecovered')delete result.recovered;
    if(mode==='uncertain')result.needsRecovery=true;
    if(mode==='doc')result.docId='another-document';
    if(mode==='request')result.requestId='00000000-0000-4000-8000-000000000735';
    if(mode==='owner')result.identity.ownerId='different-owner';
    if(mode==='proof-change')result.validationRejection.checkpointSequence++;
    return result;
   };
   await h.click(release);assert.equal(h.stored.size,1,mode);assert.equal(h.button(start),undefined);assert.equal(h.f.sent.filter(row=>row.payload.action==='start').length,1);assert.equal(h.f.calls.some(row=>row.method==='POST'),false);
  }finally{h.close();}
 }
 cases.push({name:'validation release malformed or changed proof',negativeCases:12,reservationsPreserved:true});
});

test('validation release timeout, owner change inside lock, stale callback and replaced reservation retain original safety',async()=>{
 for(const mode of ['timeout','owner-lock','scope-lock','replacement']){
  const h=await fixture(SINGLE_COMPANIES[0],{verified:true}),held=deferred();try{
   await h.idle();await h.click(open);let original;h.f.bridge=async payload=>original=validationRejected(h.f,payload.packet.requestId);await h.click(start);
   const oldRelease=h.button(release).props.onClick;
   if(mode==='timeout'){
    h.f.bridge=async()=>undefined;oldRelease();h.flush();await h.wait(()=>h.f.sent.length===3);h.f.advance(60001);await h.idle();assert.equal(h.stored.size,1);assert.ok(h.button(release));
   }else{
    h.f.bridge=async()=>({...plain(original),recovered:true});let waiting;
    h.f.window.navigator.locks.request=async(_name,_options,run)=>{waiting=true;await held.promise;return run();};oldRelease();h.flush();await h.wait(()=>waiting);
    if(mode==='owner-lock')h.f.actor.ownerId='new-owner';
    if(mode==='scope-lock')h.render({...h.props(),review:{...h.props().review,reviewDigest:'e'.repeat(64)}});
    if(mode==='replacement'){const [key,raw]=[...h.stored][0];h.stored.set(key,JSON.stringify({...JSON.parse(raw),requestId:'00000000-0000-4000-8000-000000000736'}));}
    held.resolve();await h.idle();assert.equal(h.stored.size,1);oldRelease();h.flush();await h.idle();assert.equal(h.stored.size,1);
   }
   assert.equal(h.f.sent.filter(row=>row.payload.action==='start').length,1);assert.equal(h.f.calls.some(row=>row.method==='POST'),false);
  }finally{h.close();}
 }
 cases.push({name:'validation release delayed boundaries',timeouts:1,ownerScopeOrReservationChanges:3,reservationsPreserved:true});
});

test('native committed rejection validates stage, sequence, errors and absence of consent/submit while legacy Single output stays compatible',async()=>{
 const h=await fixture(SINGLE_COMPANIES[0],{verified:true});let nativeReceiver;try{
  await h.idle();await h.click(open);const packet=h.f.sent[0].payload.packet;nativeReceiver=await productValidationRejectionFixture(packet,{now:h.f.clock.now});
  const result=await nativeReceiver.receiver.start(packet,SINGLE_SENDER);assert.equal(result.validationRejection.step,2);assert.deepEqual(result.validationRejection.validatedSteps,[]);
  const saved=nativeReceiver.storage.get(nativeReceiver.context.key);
  for(const patch of [{requestedStep:3},{operationId:'wrong:validate:2'},{sequence:0},{validationErrors:['bad']},{validationErrors:[{columnName:'x',message:'x'.repeat(2001)}]},
   {humanConfirmedAt:h.f.clock.now},{submitRequestedAt:h.f.clock.now},{receipt:{}},{challenge:{}},{stageConsents:[{}]}]){
   nativeReceiver.storage.force(nativeReceiver.context.key,{...plain(saved),...patch});
   await assert.rejects(nativeReceiver.receiver.recover(packet,SINGLE_SENDER),error=>error.code==='CHECKPOINT');
  }
  nativeReceiver.storage.force(nativeReceiver.context.key,saved);const recovered=await nativeReceiver.receiver.recover(packet,SINGLE_SENDER);assert.equal(recovered.recovered,true);assert.deepEqual(recovered.validationRejection,result.validationRejection);
  assert.equal(nativeReceiver.creates,1);assert.equal(nativeReceiver.updates,1);assert.equal(nativeReceiver.validations,1);nativeReceiver.assertPreserved();
 }finally{h.close();nativeReceiver?.close();}
 const legacy=await singleDocumentFixture(SINGLE_COMPANIES[0],{validationResponse:()=>({code:200,data:[{success:false,errors:[]}]})});try{
  const result=await legacy.receiver.start(legacy.packet,legacy.sender);assert.equal(result.state,'validation-rejected');assert.equal(Object.hasOwn(result,'validationRejection'),false);
  const recovered=await legacy.receiver.recover(legacy.packet,legacy.sender);assert.equal(recovered.recovered,true);assert.equal(Object.hasOwn(recovered,'validationRejection'),false);assert.equal(legacy.submitted,0);legacy.assertPreserved();
 }finally{legacy.close();}
 cases.push({name:'native checkpoint proof and Single compatibility',corruptCheckpointsRejected:10,productOnlyWireField:true,syntheticLegacySubmit:0});
});

test('unchanged review after validation release is blocked before preview across remount without a new UUID reservation',async()=>{
 const stored=new Map(),h=await fixture(SINGLE_COMPANIES[0],{verified:true,stored});let local;try{
  await h.idle();await h.click(open);const original=h.f.sent[0].payload.packet;local=await productValidationRejectionFixture(original,{now:h.f.clock.now});
  h.f.bridge=async payload=>payload.action==='preview'?{...h.f.preview(),requestId:payload.packet.requestId}:payload.action==='start'?local.receiver.start(payload.packet,SINGLE_SENDER):local.receiver.recover(payload.packet,SINGLE_SENDER);
  await h.click(start);await h.click(release);assert.equal(stored.size,1);const sent=h.f.sent.length;await h.click(open);
  assert.equal(h.f.sent.length,sent);assert.match(h.text(),/상품·견적서를 수정/);assert.equal(h.button(start),undefined);assert.equal(h.locks.at(-1),false);assert.equal(local.creates,1);
  assert.ok([...stored.keys()].every(key=>!key.startsWith('yoofam-product-document-pending:')));
 }finally{h.close();}
 const reopened=await fixture(SINGLE_COMPANIES[0],{verified:true,stored});try{
  await reopened.idle();await reopened.click(open);assert.equal(reopened.f.sent.length,0);assert.match(reopened.text(),/상품·견적서를 수정/);assert.equal(reopened.button(start),undefined);assert.equal(stored.size,1);
 }finally{reopened.close();local?.close();}
 cases.push({name:'unchanged rejected identity after release',actualReceiverReproductionConfirmedBeforeFix:true,remount:true,newPreviews:0,newReservations:0,nativeCreates:1});
});

test('a stale preview cannot claim after another tab releases the same rejected review into the ledger',async()=>{
 const stored=new Map(),old=await fixture(SINGLE_COMPANIES[0],{verified:true,stored}),other=await fixture(SINGLE_COMPANIES[0],{verified:true,stored});try{
  await old.idle();await other.idle();await old.click(open);const staleStart=old.button(start).props.onClick;
  await other.click(open);let original;other.f.bridge=async payload=>original=validationRejected(other.f,payload.packet.requestId);await other.click(start);
  other.f.bridge=async()=>({...plain(original),recovered:true});await other.click(release);assert.equal(stored.size,1);
  staleStart();old.flush();await old.idle();assert.deepEqual(plain(old.f.sent.map(row=>row.payload.action)),['preview']);assert.match(old.text(),/상품·견적서를 수정/);
  assert.ok([...stored.keys()].every(key=>!key.startsWith('yoofam-product-document-pending:')));
 }finally{old.close();other.close();}
 cases.push({name:'stale preview after rejected ledger commit',startDispatches:0,newReservations:0});
});

test('a durable ledger written before failed pending deletion still permits the original explicit recovery and release',async()=>{
 const stored=new Map(),h=await fixture(SINGLE_COMPANIES[0],{verified:true,stored});let local;try{
  await h.idle();await h.click(open);const packet=h.f.sent[0].payload.packet;local=await productValidationRejectionFixture(packet,{now:h.f.clock.now});
  h.f.bridge=async payload=>payload.action==='start'?local.receiver.start(payload.packet,SINGLE_SENDER):local.receiver.recover(payload.packet,SINGLE_SENDER);await h.click(start);
  const remove=h.f.window.localStorage.removeItem;h.f.window.localStorage.removeItem=()=>{throw Error('synthetic pending deletion failed');};await h.click(release);assert.equal(stored.size,2);assert.ok(h.button(release));
  h.f.window.localStorage.removeItem=remove;
 }finally{h.close();}
 const reopened=await fixture(SINGLE_COMPANIES[0],{verified:true,stored});try{
  await reopened.idle();reopened.f.bridge=async payload=>payload.action==='preview'?{...reopened.f.preview(),requestId:payload.packet.requestId}:local.receiver.recover(payload.packet,SINGLE_SENDER);
  await reopened.click('이전 문서 전송 자료 확인');await reopened.click(recover);await reopened.click(release);assert.equal(stored.size,1);
  assert.equal(local.creates,1);assert.equal(local.validations,1);assert.ok([...stored.keys()].every(key=>!key.startsWith('yoofam-product-document-pending:')));
 }finally{reopened.close();local?.close();}
 cases.push({name:'ledger before failed pending delete',remountRecovery:true,duplicateLedgerRecords:0,nativeCreates:1});
});

test('strict valid native REJECTED receipt with later observedAt can finish ledger release after failed pending deletion',async()=>{
 const stored=new Map(),h=await fixture(SINGLE_COMPANIES[0],{verified:true,stored,beforeSaveReply:async(record,f)=>{record.receipt.observedAt=f.clock.now;}});try{
  await h.idle();await h.click(open);h.f.bridge=async payload=>({...h.f.observation('REJECTED'),requestId:payload.packet.requestId});
  const remove=h.f.window.localStorage.removeItem;h.f.window.localStorage.removeItem=()=>{throw Error('native pending delete failed');};await h.click(start);
  assert.equal(stored.size,2);assert.ok(h.button('확인 결과 저장 다시 시도'));const [key,before]=[...stored].find(([name])=>name.startsWith('yoofam-product-document-rejections:'));
  h.f.window.localStorage.removeItem=remove;h.f.advance(1);await h.click('확인 결과 저장 다시 시도');
  assert.equal(stored.size,1);assert.equal(stored.get(key),before,'first exact stored native rejection is retained');assert.equal(h.button('확인 결과 저장 다시 시도'),undefined);
  assert.equal(h.f.calls.filter(row=>row.method==='POST').length,2);assert.deepEqual(plain(h.f.sent.map(row=>row.payload.action)),['preview','start']);
  assert.ok(h.f.history[0].receipt.observedAt>JSON.parse(before)[0].receiptRejection.observedAt);
 }finally{h.close();}
 cases.push({name:'native rejected refreshed timestamp retry',actualStrictNativeRecord:true,localReceiptSaveAttempts:2,nativeStartDispatches:1,originalLedgerPreserved:true});
});
