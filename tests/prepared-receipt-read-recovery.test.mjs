import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash,webcrypto} from 'node:crypto';
import {createProductDocumentPacket,PRODUCT_DOCUMENT_REQUEST_TTL} from '../extensions/supplier-hub/product-document.mjs';
import {productDocumentIdentity} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {singleDocumentIdentity} from '../extensions/supplier-hub/single-document.mjs';
import {singlePacket,singleDocumentFixture,SINGLE_COMPANIES,SINGLE_SENDER} from './helpers/supplier-hub-single-document.mjs';
import {SupplierHubRejectionDetails} from './helpers/rejection-details-ui.mjs';
import {productValidationRejectionFixture} from './helpers/product-validation-rejection.mjs';
import {normalizeRejectionDetails} from '../extensions/supplier-hub/rejection-details.mjs';
import {PRODUCT_DOCUMENT_LIVE_VERIFIED} from '../extensions/supplier-hub/product-document-dispatch.mjs';
import {SINGLE_DOCUMENT_LIVE_VERIFIED} from '../extensions/supplier-hub/single-dispatch.mjs';
import {sourceReadError} from '../extensions/supplier-hub/product-document-source.mjs';
import {runReservedSegments} from '../app/supplier-hub-reserved-work.mjs';

// Reuse declarations only: importing the test module would register unrelated
// suites and run its historical proof-writing hook. All production transport,
// client, packet, pending-storage and receipt validators remain real.
const fixtureUrl=new URL('./supplier-hub-product-transport-ui.test.mjs',import.meta.url),fixtureSource=fs.readFileSync(fixtureUrl,'utf8');
const ast=ts.createSourceFile(fixtureUrl.pathname,fixtureSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declarations=ast.statements.filter(node=>ts.isVariableStatement(node)||ts.isFunctionDeclaration(node)
  ||ts.isForOfStatement(node)&&node.expression.getText(ast)==='ast.statements').map(node=>node.getText(ast)).join('\n')
  .replace(/(?<!['"])import\.meta\.url/g,JSON.stringify(fixtureUrl.href));
const ui=vm.runInNewContext(declarations+'\n({fixture,allowPrepared,preparedResult,open,prepareDraft,reviewPrepared,confirmPrepared,nodes,text})',{
  fs,path,vm,assert,ts,createRequire,fileURLToPath,createHash,webcrypto,createProductDocumentPacket,PRODUCT_DOCUMENT_REQUEST_TTL,productDocumentIdentity,
  singleDocumentIdentity,singlePacket,singleDocumentFixture,SINGLE_COMPANIES,SINGLE_SENDER,SupplierHubRejectionDetails,productValidationRejectionFixture,
  normalizeRejectionDetails,sourceReadError,runReservedSegments,URL,Response,Request,TextEncoder,TextDecoder,Uint8Array,AbortController,Date,JSON,Array,Object,Error,Intl,structuredClone,setImmediate,
});
const recover='준비한 문서 단계 확인 · 읽기 전용',observe='접수 결과 조회',plain=value=>JSON.parse(JSON.stringify(value));
function reply(h,payload){
  if(payload.action==='reviewPreparedDraft')return ui.preparedResult(h,payload,'awaiting-consent',20,{challenge:h.f.challenge('logisticsPage')});
  if(payload.action==='confirmPreparedDraft')return ui.preparedResult(h,payload,'pending',23,{receipt:h.f.observation('SUBMITTED').receipt});
  assert.ok(['observePreparedDraft','recoverPreparedDraft'].includes(payload.action));
  return ui.preparedResult(h,payload,'accepted',24,{receipt:h.f.observation('FINISHED').receipt,...(payload.action==='recoverPreparedDraft'?{recovered:true}:{})});
}
async function uncertainReceipt(company=SINGLE_COMPANIES[0]){
  const h=await ui.fixture(company);ui.allowPrepared(h,payload=>reply(h,payload));
  try{
    await h.idle();await h.click(ui.open);await h.click(ui.prepareDraft);await h.click(ui.reviewPrepared);await h.click(ui.confirmPrepared);
    assert.equal(h.f.history[0].receipt.sourceStatus,'SUBMITTED');assert.ok(h.button(observe));
    h.firstReceipt=JSON.stringify(h.f.history[0]);h.firstReservation=JSON.stringify([...h.stored]);h.initialPacket=JSON.stringify(h.f.sent.at(-1).payload.packet);
    const fresh=h.f.refresh;let reads=0;
    h.f.refresh=async()=>{if(++reads===2)throw Error('synthetic transient post-observation catalog read failure');return fresh();};
    await h.click(observe);h.f.refresh=fresh;
    assert.equal(reads,2);assert.match(h.text(),/synthetic transient post-observation catalog read failure/);assert.equal(h.f.sent.at(-1).payload.action,'observePreparedDraft');
    assert.equal(JSON.stringify(h.f.history[0]),h.firstReceipt,'an unadopted FINISHED response must not replace the stored SUBMITTED receipt');
    assert.equal(JSON.stringify([...h.stored]),h.firstReservation);assert.deepEqual(plain(h.lockPairs.at(-1)),[true,true]);assert.equal(h.button(observe),undefined);
    return h;
  }catch(error){h.close();throw error;}
}
function assertReadOnlyTail(h,start){
  const sent=h.f.sent.slice(start).map(row=>row.payload);
  assert.ok(sent.length>0);assert.ok(sent.every(payload=>payload.action==='recoverPreparedDraft'||payload.action==='observePreparedDraft'));
  assert.ok(sent.every(payload=>JSON.stringify(payload.packet)===h.initialPacket),'recovery must preserve the original UUID, company, product, source fingerprint and reviewed body');
  assert.ok(sent.every(payload=>!Object.hasOwn(payload,'confirmation')),'read recovery never inherits terms or submits');
}

for(const company of SINGLE_COMPANIES)test(`${company.code}: a post-observation catalog failure keeps the existing receipt and exposes exact read recovery without replaying registration`,async()=>{
  const h=await uncertainReceipt(company);try{
    const count=h.f.sent.length,posts=h.f.calls.filter(call=>call.method==='POST').length;
    assert.ok(h.button(recover),'a stored receipt must not hide recovery while its observation is uncertain');assert.equal(h.button(recover).props.disabled,false);
    assert.equal(h.button(ui.prepareDraft),undefined);assert.equal(h.button(ui.reviewPrepared),undefined);assert.equal(h.button(ui.confirmPrepared),undefined);
    await h.click(recover);
    assert.equal(h.f.history[0].receipt.sourceStatus,'FINISHED');assert.ok(h.button(observe));assert.equal(h.button(recover),undefined);assert.deepEqual(plain(h.lockPairs.at(-1)),[true,false]);
    assert.equal(JSON.stringify([...h.stored]),h.firstReservation);assert.equal(h.f.calls.filter(call=>call.method==='POST').length,posts+1,'only the freshly verified receipt is persisted locally');
    assertReadOnlyTail(h,count);assert.deepEqual(plain(h.f.sent.slice(count).map(row=>row.payload.action)),['recoverPreparedDraft']);
    await h.click(observe);assertReadOnlyTail(h,count);assert.equal(h.f.sent.filter(row=>row.payload.action==='prepareDraft').length,1);assert.equal(h.f.sent.filter(row=>row.payload.action==='confirmPreparedDraft').length,1);
    assert.equal(PRODUCT_DOCUMENT_LIVE_VERIFIED,false);assert.equal(SINGLE_DOCUMENT_LIVE_VERIFIED,false);
  }finally{h.close();}
});

test('an active read recovery disables its button and rejects rapid old callbacks while preserving the receipt until the exact reply',async()=>{
  const h=await uncertainReceipt();let release;try{
    const before=h.f.sent.length,read=h.button(recover).props.onClick;
    h.f.bridge=payload=>{assert.equal(payload.action,'recoverPreparedDraft');return new Promise(resolve=>{release=()=>resolve(reply(h,payload));});};
    read();read();h.flush();await h.wait(()=>Boolean(release));assert.equal(h.f.sent.length,before+1);assert.equal(h.button(recover).props.disabled,true);
    assert.equal(JSON.stringify(h.f.history[0]),h.firstReceipt);assert.equal(JSON.stringify([...h.stored]),h.firstReservation);assert.deepEqual(plain(h.lockPairs.at(-1)),[true,true]);
    read();h.flush();assert.equal(h.f.sent.length,before+1);release();await h.idle();assert.equal(h.f.history[0].receipt.sourceStatus,'FINISHED');assert.ok(h.button(observe));assertReadOnlyTail(h,before);
  }finally{release?.();h.close();}
});

test('a mismatched recovery ACK cannot clear uncertainty, replace the old receipt or expose observe/submit; a later exact read can recover',async()=>{
  for(const mismatch of ['request','company','source']){
    const h=await uncertainReceipt();try{
      const before=h.f.sent.length,posts=h.f.calls.filter(call=>call.method==='POST').length;
      h.f.bridge=payload=>{const result=reply(h,payload);if(mismatch==='request')result.requestId='00000000-0000-4000-8000-000000000786';else if(mismatch==='company')result.identity.company=SINGLE_COMPANIES[1];else result.preparedBodySha256='f'.repeat(64);return result;};
      await h.click(recover);assert.ok(h.button(recover));assert.equal(h.button(observe),undefined);assert.equal(h.button(ui.confirmPrepared),undefined);assert.deepEqual(plain(h.lockPairs.at(-1)),[true,true]);
      assert.equal(JSON.stringify(h.f.history[0]),h.firstReceipt);assert.equal(JSON.stringify([...h.stored]),h.firstReservation);assert.equal(h.f.calls.filter(call=>call.method==='POST').length,posts);
      h.f.bridge=payload=>reply(h,payload);await h.click(recover);assert.equal(h.f.history[0].receipt.sourceStatus,'FINISHED');assert.ok(h.button(observe));assertReadOnlyTail(h,before);
    }finally{h.close();}
  }
});

test('a changed authenticated owner or company blocks the recovery before dispatch and retains the original reservation and receipt',async()=>{
  for(const change of ['owner','company']){
    const h=await uncertainReceipt();try{
      const actor=plain(h.f.actor),count=h.f.sent.length,posts=h.f.calls.filter(call=>call.method==='POST').length;
      if(change==='owner')h.f.actor.ownerId='different_owner';else h.f.actor.company=SINGLE_COMPANIES[1];
      await h.click(recover);assert.equal(h.f.sent.length,count);assert.equal(JSON.stringify(h.f.history[0]),h.firstReceipt);assert.equal(JSON.stringify([...h.stored]),h.firstReservation);assert.equal(h.f.calls.filter(call=>call.method==='POST').length,posts);
      assert.ok(h.button(recover));assert.equal(h.button(observe),undefined);assert.deepEqual(plain(h.lockPairs.at(-1)),[true,true]);
      Object.assign(h.f.actor,actor);await h.click(recover);assert.equal(h.f.history[0].receipt.sourceStatus,'FINISHED');assertReadOnlyTail(h,count);
    }finally{h.close();}
  }
});

test('an old recovery callback and late result cannot survive a product-review ABA even if the visible receipt still belongs to that old review',async()=>{
  const h=await uncertainReceipt();let release;try{
    const original=h.props(),read=h.button(recover).props.onClick,before=h.f.sent.length;
    h.f.bridge=payload=>new Promise(resolve=>{release=()=>resolve(reply(h,payload));});read();h.flush();await h.wait(()=>Boolean(release));
    const changed={...original.review,reviewDigest:'a'.repeat(64),identity:{...original.review.identity,productId:'other_product'}};
    h.render({...original,review:changed});h.render(original);read();h.flush();assert.equal(h.f.sent.length,before+1,'the callback from the old review cannot dispatch in a later incarnation');
    release();await h.idle();assert.equal(JSON.stringify(h.f.history[0]),h.firstReceipt);assert.equal(JSON.stringify([...h.stored]),h.firstReservation);assert.equal(h.button(observe),undefined);assert.equal(h.button(ui.confirmPrepared),undefined);assertReadOnlyTail(h,before);
  }finally{release?.();h.close();}
});
