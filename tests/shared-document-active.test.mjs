import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {deferred,singleDocumentFixture} from './helpers/supplier-hub-single-document.mjs';
import {createSupplierHubDocumentReceiver,SingleDocumentError,singleDocumentIdentity,SINGLE_DOCUMENT_FORMAT} from '../extensions/supplier-hub/single-document.mjs';

const contract={format:SINGLE_DOCUMENT_FORMAT,identity:singleDocumentIdentity,draftOnly:true};

test('separate receivers using the worker lock do not read or write the same request concurrently',async()=>{
 const gate=deferred(),entered=deferred();let held=false;
 const f=await singleDocumentFixture(undefined,{before:async name=>{if(name==='readSource'&&!held){held=true;entered.resolve();await gate.promise;}}});
 try{
  const activeKeys=new Set(['independent-key']);
  const first=createSupplierHubDocumentReceiver({adapter:f.adapter,store:f.storage.store,now:()=>f.now,activeKeys},contract);
  const second=createSupplierHubDocumentReceiver({adapter:f.adapter,store:f.storage.store,now:()=>f.now,activeKeys},contract);
  const ongoing=first.prepareDraft(f.packet,f.sender);await entered.promise;
  const before=f.calls.length,checkpoint=structuredClone(f.storage.get(f.context.key));
  const busy=await second.recoverDraft(f.packet,f.sender);
  assert.equal(busy.state,'busy');assert.equal(busy.registered,false);assert.equal(busy.success,false);
  assert.equal(f.calls.length,before);assert.deepEqual(f.storage.get(f.context.key),checkpoint);
  assert.equal(activeKeys.has(f.context.key),true);assert.equal(activeKeys.has('independent-key'),true);
  gate.resolve();const done=await ongoing;assert.equal(done.state,'validated');
  assert.equal(activeKeys.has(f.context.key),false);assert.equal(activeKeys.has('independent-key'),true);
  const read=await second.recoverDraft(f.packet,f.sender);assert.equal(read.state,'validated');assert.equal(read.recovered,true);
  f.assertPreserved();
 }finally{gate.resolve();f.close();}
});

test('a failure releases only its own shared active key, without changing a checkpoint',async()=>{
 const f=await singleDocumentFixture();try{
  const activeKeys=new Set(['independent-key']),store={...f.storage.store,get:async()=>{throw Error('synthetic store failure');}};
  const receiver=createSupplierHubDocumentReceiver({adapter:f.adapter,store,now:()=>f.now,activeKeys},contract);
  await assert.rejects(receiver.prepareDraft(f.packet,f.sender),/synthetic store failure/);
  assert.equal(activeKeys.has(f.context.key),false);assert.equal(activeKeys.has('independent-key'),true);
  assert.equal(f.storage.get(f.context.key),undefined);assert.equal(f.calls.length,0);f.assertPreserved();
 }finally{f.close();}
});

test('dispatcher shares the lock with fresh draft receivers and rejects a busy read before adapter creation',async()=>{
 const gate=deferred(),entered=deferred(),calls=[];let shared;
 const context={key:'same-verified-packet',packet:{format:'synthetic-product-document-v1'},identity:{appTabId:17},sourceAppTabId:17};
 const sandbox={SingleDocumentError,productDocumentIdentity:async()=>context,resolveProductSourceContext:async value=>value,
  readPreparedDocumentPreviewCheckpoint:async()=>null,createProductDocumentStore:()=>({}),
  createVerifiedProductDocumentBrowserAdapter:async()=>{calls.push('adapter');return{nativeAssets:true,sourcePlanSha256:'a'.repeat(64),adapter:{dispose(){calls.push('dispose');}}};},
  createProductDocumentReceiver:()=>assert.fail('Full receiver remains gated'),
  createProductDocumentDraftReceiver:options=>{if(shared)assert.equal(options.activeKeys,shared);else shared=options.activeKeys;calls.push('receiver');return{
   prepareDraft:async()=>{options.activeKeys.add(context.key);entered.resolve();try{await gate.promise;return{state:'validated'};}finally{options.activeKeys.delete(context.key);}},
   recoverDraft:async()=>{calls.push('recover');return{state:'validated'};}
  };}};
 const source=fs.readFileSync(new URL('../extensions/supplier-hub/product-document-dispatch.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
 const dispatch=vm.runInNewContext(source+'\ndispatchProductDocument',sandbox),message={type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action:'prepareDraft',packet:{requestId:'synthetic-request'}};
 const pending=dispatch(message,{});await entered.promise;
 const before=[...calls],busy=await dispatch({...message,action:'recoverDraft'},{});
 assert.equal(busy.state,'busy');assert.equal(busy.registered,false);assert.deepEqual(calls,before);
 gate.resolve();assert.equal((await pending).state,'validated');assert.equal(shared.has(context.key),false);
 assert.equal((await dispatch({...message,action:'recoverDraft'},{})).state,'validated');assert.ok(calls.includes('recover'));
});
