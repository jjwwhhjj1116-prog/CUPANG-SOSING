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
function preparedResult(h,payload,state,sequence,extra={}){
 const submitted=['pending','accepted','rejected','submit-requested'].includes(state);
 h.qualifiedAt??=h.f.clock.now;
 return h.f.state(state,{requestId:payload.packet.requestId,draftOnly:true,preparedLifecycle:true,lifecycleProof:{evidence:'native-prepared-draft-lifecycle',preparedCheckpointSequence:12,qualifiedCheckpointSequence:13,checkpointSequence:sequence,qualifiedAt:h.qualifiedAt,observedAt:h.f.clock.now,validatedSteps:[2,3,4,5],consentRequested:sequence>14,submitRequested:submitted},...extra});
}
function allowPrepared(h,run){h.f.bridge=async payload=>payload.action==='preview'?{...h.f.preview(),requestId:payload.packet.requestId,draftPreparationAvailable:true,preparedLifecycleAvailable:true}:payload.action==='prepareDraft'?draftResult(h.f,payload.packet.requestId):run(payload);}
function checkTerms(h){for(const node of nodes(h.render()).filter(node=>node.type==='input'&&node.props.type==='checkbox')){assert.equal(Boolean(node.props.disabled),false);node.props.onChange({target:{checked:true}});}h.flush();}

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
  h.f.bridge=async()=>{throw Error('원래 초안 본문을 확인하지 못했습니다.');};await h.click(recoverDraft);assert.deepEqual(h.lockPairs.at(-1),[true,true]);assert.match(h.text(),/원래 초안 본문/);assert.doesNotMatch(h.text(),/초안 저장·검증 완료/);assert.equal(h.stored.size,1);assert.equal(h.button(prepareDraft),undefined);
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
      require: name => name === '@/app/components/supplier-hub-native-registration' ? {SupplierHubNativeRegistration:()=>null} : name === '@/app/components/supplier-hub-rejection-details' ? {SupplierHubRejectionDetails} : name === 'react' ? react : name === '@/app/supplier-hub-product-client' ? f.client : name.startsWith('@/') ? f.load(name.slice(2) + '.ts') : name.endsWith('product-document.mjs') ? {
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
