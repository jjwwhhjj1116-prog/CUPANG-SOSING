import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {assetApiFixture,companies,module,plain} from './helpers/supplier-hub-single-assets.mjs';
import {quotationAiUI} from './helpers/quotation-ai-ui.mjs';
import {singleDocumentIdentity} from '../extensions/supplier-hub/single-document.mjs';
import {dispatchSingleDocument,SINGLE_DOCUMENT_LIVE_VERIFIED} from '../extensions/supplier-hub/single-dispatch.mjs';
import {singlePacket,SINGLE_SENDER} from './helpers/supplier-hub-single-document.mjs';
const client=module('app/supplier-hub-single-client.ts');
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
for(const company of companies)test(company.name+': actual Single package selection is exact, immutable, and cannot be transmitted through an unverified release gate',async()=>{
  const f=await assetApiFixture(company);try{
    const view=await json(await f.h.route(f.base+'/quotation-fields'+f.query)),initial=await json(await f.h.route(f.endpoint)),before=f.state();
    assert.equal(client.singlePackageCurrent(initial,view,f.id),true);await assert.rejects(client.singlePackagePacket(initial,'owner','synthetic-one'));
    const prepared=await json(await f.prepare(initial.fingerprint));assert.equal(prepared.prepared,true);
    const stored=JSON.stringify(prepared),packet=plain(await client.singlePackagePacket(prepared,'owner','synthetic-one'));assert.equal(JSON.stringify(prepared),stored);assert.equal(packet.body.jsonDocument.length,1);
    const identity=await singleDocumentIdentity(packet,SINGLE_SENDER);assert.equal(identity.packet.company.code,company.code);assert.equal(identity.packet.body.docId,null);
    const preview=await dispatchSingleDocument({type:'YOOFAM_SINGLE_DOCUMENT_REQUEST',action:'preview',packet},SINGLE_SENDER);assert.equal(preview.remoteWrites,false);assert.equal(preview.liveVerified,false);
    for(const action of ['start','resume','recover','confirm','observe'])await assert.rejects(dispatchSingleDocument({type:'YOOFAM_SINGLE_DOCUMENT_REQUEST',action,packet},SINGLE_SENDER),error=>error.code==='SINGLE_LIVE_CONTRACT_UNVERIFIED');
    assert.equal(f.state(),before);assert.deepEqual(f.h.network,[]);
    assert.equal(client.singlePackageCurrent(prepared,{...view,revision:view.revision+1},f.id),false);
    await assert.rejects(client.singlePackagePacket(prepared,'owner','excluded-row'));await assert.rejects(client.singlePackagePacket({...prepared,options:[...prepared.options,prepared.options[0]]},'owner','synthetic-one'));
  }finally{f.close();}
});
test('UI mount performs no image publication; explicit review then prepare uses current saved fingerprint only',async()=>{
  const f=await assetApiFixture();try{
    const view=await json(await f.h.route(f.base+'/quotation-fields'+f.query)),before=f.state();
    const ui=quotationAiUI({productId:f.id,profileId:f.profile.id,view,disabled:false},(url,init)=>{
      if(url==='/api/supplier-hub/catalog-context')return Response.json({ownerId:'owner',company:f.profile.supplierHub?.company??companies[0]});
      if(String(url).includes('/supplier-hub-single-receipt')){assert.equal(init?.method??'GET','GET');return Response.json({format:'yoofam-single-receipt-history-v1',productId:f.id,receipts:[]});}
      return f.h.route(url,{method:init?.method??'GET',body:init?.body?JSON.parse(init.body):undefined});
    },'app/components/supplier-hub-single-review.tsx','SupplierHubSingleReview');
    await ui.idle();assert.equal(ui.calls.length,3,JSON.stringify(ui.alerts()));assert.ok(ui.calls.every(call=>call.method==='GET'));assert.equal(ui.calls.filter(call=>call.url.includes('/supplier-hub-single-package')).length,0);assert.equal(ui.button('이미지 전송 자료 준비').props.disabled,true);
    await ui.click('개별 견적 자료 검토');assert.deepEqual(ui.calls.filter(call=>call.url.includes('/supplier-hub-single-package')).map(c=>c.method),['GET']);assert.equal(ui.button('이미지 전송 자료 준비').props.disabled,false);
    await ui.click('이미지 전송 자료 준비');const packageCalls=ui.calls.filter(call=>call.url.includes('/supplier-hub-single-package'));assert.deepEqual(packageCalls.map(c=>c.method),['GET','POST']);assert.equal(packageCalls[1].body.action,'prepare');assert.equal(ui.button('이미지 전송 자료 준비').props.disabled,true);
    assert.equal(f.state(),before);assert.deepEqual(f.h.network,[]);ui.unmount();
  }finally{f.close();}
});
test('content bridge rechecks exact body and member, has a local epoch and cannot manufacture human confirmation',async()=>{
  const f=await assetApiFixture();try{
    const initial=await json(await f.h.route(f.endpoint)),prepared=await json(await f.prepare(initial.fingerprint)),packet=plain(await client.singlePackagePacket(prepared,'owner','synthetic-one')),ctx=await singleDocumentIdentity(packet,SINGLE_SENDER);
    const source={identity:ctx.identity,bodySha256:ctx.originalBodySha256,preparedBodySha256:ctx.bodySha256,packetDigest:ctx.packetDigest,requestId:packet.requestId,docId:null};
    let actor={ownerId:'owner',company:prepared.company},handler;const requests=[];
    const scope={crypto:webcrypto,TextEncoder,Uint8Array,AbortController,Date,JSON,Array,Object,Error,structuredClone,setTimeout,clearTimeout,location:{origin:new URL(SINGLE_SENDER.url).origin},chrome:{runtime:{id:'extension',onMessage:{addListener:fn=>handler=fn}}},fetch:async path=>{requests.push(path);const response=Response.json(path.includes('catalog-context')?actor:path.includes('supplier-hub-product-receipt')?{format:'yoofam-native-receipt-history-v1',productId:f.id,receipts:[]}:path.includes('supplier-hub-receipt')?{history:{productId:f.id,blocked:false}}:prepared);Object.defineProperty(response,'url',{value:new URL(SINGLE_SENDER.url).origin+path});return response;}};
    vm.runInNewContext(fs.readFileSync(new URL('../extensions/supplier-hub/single-content.js',import.meta.url),'utf8'),scope);
    const proof=await scope.verifySingleDocumentSource(source);assert.equal(proof.current,true);assert.ok(proof.sessionId);assert.equal(requests.length,5);
    await assert.rejects(scope.verifySingleDocumentSource({...source,bodySha256:'a'.repeat(64)}));
    actor={ownerId:'owner',company:companies[1]};await assert.rejects(scope.verifySingleDocumentSource(source));actor={ownerId:'owner',company:prepared.company};await assert.rejects(scope.verifySingleDocumentSource(source));
    const again=await scope.verifySingleDocumentSource(source);assert.notEqual(again.sessionId,proof.sessionId);
    let reply;handler({type:'YOOFAM_CONFIRM_SINGLE_DOCUMENT_ACTION',expected:{confirmation:{userInitiated:true}}},{id:'extension'},v=>reply=v);assert.equal(reply.ok,false);
    assert.equal(handler({type:'YOOFAM_VERIFY_SINGLE_DOCUMENT_SOURCE',expected:source},{id:'foreign-extension'},()=>assert.fail()),undefined);
  }finally{f.close();}
});
test('Single dispatcher does not accept a forged enabled flag or an unsupported sender',async()=>{
  assert.equal(SINGLE_DOCUMENT_LIVE_VERIFIED,false);await assert.rejects(dispatchSingleDocument({type:'YOOFAM_SINGLE_DOCUMENT_REQUEST',action:'start',packet:singlePacket(),liveVerified:true},SINGLE_SENDER),error=>error.code==='SINGLE_ACTION');
  await assert.rejects(dispatchSingleDocument({type:'YOOFAM_SINGLE_DOCUMENT_REQUEST',action:'preview',packet:singlePacket()},{...SINGLE_SENDER,frameId:1}),error=>error.code==='SENDER');
});
