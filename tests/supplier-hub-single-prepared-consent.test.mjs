import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {createHash,webcrypto} from 'node:crypto';
import {assetApiFixture,assetSnapshot,companies,module,plain} from './helpers/supplier-hub-single-assets.mjs';
import {singleDocumentFixture} from './helpers/supplier-hub-single-document.mjs';
import {singleDocumentIdentity} from '../extensions/supplier-hub/single-document.mjs';
import {dispatchSingleDocument,SINGLE_DOCUMENT_LIVE_VERIFIED} from '../extensions/supplier-hub/single-dispatch.mjs';

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const proofs=[],files=['app/supplier-hub-single-projection.ts','app/supplier-hub-single-client.ts','app/components/supplier-hub-single-review.tsx',
  'extensions/supplier-hub/single-document.mjs','extensions/supplier-hub/single-document-adapter.mjs','extensions/supplier-hub/single-owned-target.mjs',
  'tests/helpers/supplier-hub-single-document.mjs','tests/supplier-hub-single-prepared-consent.test.mjs'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]));
const frozen=hashes();
after(()=>{assert.deepEqual(hashes(),frozen);fs.writeFileSync(new URL('../outputs/step705-prepared-consent-proof.json',import.meta.url),JSON.stringify({sourceHashes:frozen,cases:proofs,
  boundary:'Actual local API/SQLite/public image preparation/client packet/receiver checkpoints; source, images, tabs, remote draft validation and human actions are synthetic. No real Hub submission.',
  externalRequests:0,browserActions:0,operatingProductWrites:0,supplierHubWrites:0},null,2)+'\n');});

for(const company of companies)test(company.name+': actual API prepares missing native consent flags false and each synthetic stage confirmation changes only its own flag',async()=>{
  const snapshot=assetSnapshot(company),raw=JSON.parse(snapshot.schemaString);delete raw.properties.imagePage.properties.msrpAgree;delete raw.properties.imagePage.properties.labelContactAgreed;snapshot.schemaString=JSON.stringify(raw);
  const immutable=JSON.stringify(snapshot),f=await assetApiFixture(company,snapshot);let remote;
  try{
    const before=f.state(),privateBefore=f.objectState(),view=await json(await f.h.route(f.endpoint));
    for(const document of view.payload.jsonDocument){assert.equal(document.imagePage.msrpAgree,false);assert.equal(document.imagePage.labelContactAgreed,false);}
    const prepared=await json(await f.prepare(view.fingerprint));assert.equal(prepared.prepared,true);assert.equal(prepared.remoteWrites,false);assert.equal(prepared.registered,false);
    const client=module('app/supplier-hub-single-client.ts'),packet=plain(await client.singlePackagePacket(prepared,'owner','synthetic-one')),packetBefore=JSON.stringify(packet);
    assert.equal(packet.body.jsonDocument.length,1);assert.equal(packet.body.jsonDocument[0].imagePage.msrpAgree,false);assert.equal(packet.body.jsonDocument[0].imagePage.labelContactAgreed,false);
    remote=await singleDocumentFixture(company,{packet,stageFlow:true,finalNoItems:true,receipt:{state:'pending',evidence:'document-receipt',skuId:undefined}});
    const product=await remote.receiver.start(packet,remote.sender);assert.equal(product.state,'awaiting-stage-consent',JSON.stringify(product.error));assert.equal(product.challenge.stage,'productPage');
    assert.equal(remote.submitted,0);let doc=remote.documents.get(product.docId).jsonDocument[0];assert.equal(doc.imagePage.msrpAgree,false);assert.equal(doc.imagePage.labelContactAgreed,false);
    const image=await remote.receiver.confirm(packet,remote.sender,remote.action(product));assert.equal(image.state,'awaiting-stage-consent');assert.equal(image.challenge.stage,'imagePage');
    doc=remote.documents.get(image.docId).jsonDocument[0];assert.equal(doc.imagePage.msrpAgree,true);assert.equal(doc.imagePage.labelContactAgreed,false);assert.equal(remote.submitted,0);
    const final=await remote.receiver.confirm(packet,remote.sender,remote.action(image));assert.equal(final.state,'awaiting-consent');
    doc=remote.documents.get(final.docId).jsonDocument[0];assert.equal(doc.imagePage.msrpAgree,true);assert.equal(doc.imagePage.labelContactAgreed,true);assert.equal(remote.submitted,0);
    const receipt=await remote.receiver.confirm(packet,remote.sender,remote.action(final));assert.equal(receipt.state,'pending');assert.equal(receipt.registered,false);assert.equal(remote.submitted,1);
    assert.equal(JSON.stringify(packet),packetBefore);assert.equal(JSON.stringify(snapshot),immutable);assert.equal(f.state(),before);assert.equal(f.objectState(),privateBefore);assert.deepEqual(f.h.network,[]);remote.assertPreserved();
    assert.equal(remote.calls.filter(call=>call.name==='createTarget').length,1);assert.equal(remote.createCount,1);assert.equal(remote.updateCount,1);
    assert.equal(SINGLE_DOCUMENT_LIVE_VERIFIED,false);await assert.rejects(dispatchSingleDocument({type:'YOOFAM_SINGLE_DOCUMENT_REQUEST',action:'start',packet},remote.sender),error=>error.code==='SINGLE_LIVE_CONTRACT_UNVERIFIED');
    proofs.push({name:'prepared native consent',company:plain(company),syntheticSource:true,initialFlags:[false,false],afterProduct:[true,false],afterImage:[true,true],syntheticFinalSubmit:1,
      registered:false,extensionOwnedTargets:1,businessDataAndPrivateFilesPreserved:true,gateStillFalse:true});
  }finally{remote?.close();f.close();}
});

// Reuse the actual UI/bridge fixture declarations without registering its suite.
const fixtureUrl=new URL('./supplier-hub-single-stage-ui.test.mjs',import.meta.url),source=fs.readFileSync(fixtureUrl,'utf8');
const ast=ts.createSourceFile(fixtureUrl.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),parts=[];
for(const statement of ast.statements){
  if(ts.isImportDeclaration(statement))continue;
  if(ts.isForOfStatement(statement)||ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='test')break;
  parts.push(statement.getText(ast));
}
const fixtureDependencies={assert,fs,vm,ts,webcrypto,createRequire,singleDocumentIdentity,dispatchSingleDocument};
// Keep transport objects in the actual module's realm, as in the source fixture.
// A second VM realm would fail the receiver's intentional plain-JSON guard.
const fixture=vm.compileFunction(parts.join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href))+'\nreturn fixture;',Object.keys(fixtureDependencies))(...Object.values(fixtureDependencies));

test('target creation ACK loss exposes only read-only recovery and never another start or resume',async()=>{
  const h=fixture(companies[0],{verified:true});try{
    await h.prepare();assert.ok(h.button('선택 옵션의 개별 견적 등록 시작'),h.text());const start=h.button('선택 옵션의 개별 견적 등록 시작').props.onClick;
    h.bridge=async payload=>{assert.ok(['start','recover'].includes(payload.action));return h.result('target-requested',null,{docId:null,needsRecovery:true,error:{code:'TARGET_UNCERTAIN',message:'전송 탭 결과 미확정'}});};
    await h.click('선택 옵션의 개별 견적 등록 시작');assert.match(h.text(),/기존 작업 탭을 사용하거나 새 탭을 다시 만들지 않고/);
    assert.equal(h.button('개별 견적 단계 계속 확인'),undefined);assert.equal(h.button('전용 Supplier Hub 탭 확인 계속'),undefined);
    start();await h.idle();assert.equal(h.sent.filter(call=>call.snapshot.payload.action==='start').length,1);
    await h.click('개별 요청 저장 결과 확인');assert.equal(h.sent.at(-1).snapshot.payload.action,'recover');assert.equal(h.sent.filter(call=>call.snapshot.payload.action==='resume').length,0);
    assert.equal(h.calls.filter(call=>call.method==='POST'&&String(call.url).includes('single-receipt')).length,0);
    proofs.push({name:'target unknown UI',start:1,recover:1,resume:0,receiptWrites:0});
  }finally{h.close();}
});

test('created target keeps its request identity and explicitly continues to the first terms challenge',async()=>{
  const h=fixture(companies[1],{verified:true});try{
    await h.prepare();h.bridge=async payload=>payload.action==='start'?h.result('target-created',null,{docId:null}):h.result('awaiting-stage-consent',h.challenge('productPage'));
    await h.click('선택 옵션의 개별 견적 등록 시작');assert.match(h.text(),/既存|기존 작업 탭은 이동하지 않습니다/);
    await h.click('전용 Supplier Hub 탭 확인 계속');assert.equal(h.sent.at(-1).snapshot.payload.action,'resume');
    assert.equal(new Set(h.sent.map(call=>JSON.stringify(call.snapshot.payload.packet))).size,1);assert.match(h.text(),/마지막 문단 productPage/);
    assert.equal(h.button('현재 단계 동의 확인 · 계속').props.disabled,true);
    proofs.push({name:'created target UI',start:1,resume:1,packetUnchanged:true,consentUnselected:true});
  }finally{h.close();}
});

test('new target checkpoint replies cannot contain an existing document, consent challenge or receipt, or hide an unresolved creation',async()=>{
  for(const extra of [{docId:'existing-work'}, {challenge:{id:'unexpected'}}, {receipt:{}}, {needsRecovery:false}]){
    const h=fixture(companies[0],{verified:true});try{
      await h.prepare();h.bridge=async()=>h.result('target-requested',null,{docId:null,needsRecovery:true,...extra});await h.click('선택 옵션의 개별 견적 등록 시작');
      assert.match(h.text(),/회원·문서·본문 연결을 확인하지 못했습니다/);assert.equal(h.button('개별 견적 단계 계속 확인'),undefined);
      assert.equal(h.calls.filter(call=>call.method==='POST'&&String(call.url).includes('single-receipt')).length,0);
    }finally{h.close();}
  }
  proofs.push({name:'invalid target checkpoint',cases:4,receiptWrites:0});
});
