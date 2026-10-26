import test from 'node:test';
import assert from 'node:assert/strict';
import {ownedRecordMirrorRuntime} from './helpers/owned-record-mirror.mjs';

const copy=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const binding={identity:{appTabId:10,windowId:2,company:{code:'A01526306',name:'유앤채'}},requestId:'original-request',sessionId:'original-session',packetDigest:'a'.repeat(64),identityDigest:'b'.repeat(64),preparedBodySha256:'c'.repeat(64),originalBodySha256:'d'.repeat(64)};
 const target={tabId:11,windowId:2,origin:'https://supplier.coupang.com',requestId:binding.requestId,packetDigest:binding.packetDigest};
 const record={binding:copy(binding),docId:2347603,createOperationId:binding.requestId+':create',baselineDocIds:[2347000],state:'created',optional:null,zero:0,flag:false};
 const document={documentElement:{dataset:{}},body:{innerText:'Company Code: A01526306'}},location={origin:target.origin,pathname:'/dashboard/KR'},runtime=ownedRecordMirrorRuntime(document,location);
 const input={binding,target,knownDocId:record.docId},key='yoofam-owned-document-mirror-v1:'+binding.packetDigest;
 const set=value=>{document.documentElement.dataset.yoofamSingleDocumentRecords=JSON.stringify({[binding.packetDigest]:value});};
 return{...runtime,document,location,binding,target,record,input,key,set};
}

test('a same-tab reload restores only the exact previously observed document and preserves pending operations',async()=>{
 const f=fixture();try{
  assert.equal(f.run(f.input).ready,true);
  f.record.nativeAssets={state:'preparing',groups:{'image:MAIN':{state:'requested',requestId:'pending-upload'}}};f.set(f.record);await f.flush();
  assert.deepEqual(JSON.parse(f.storage.get(f.key)).record,f.record);
  delete f.document.documentElement.dataset.yoofamSingleDocumentRecords;f.reset();await f.flush();
  const result=f.run(f.input);assert.equal(result.ready,true);assert.equal(result.restored,true);
  assert.deepEqual(JSON.parse(f.document.documentElement.dataset.yoofamSingleDocumentRecords)[f.binding.packetDigest],f.record);
  assert.equal(JSON.parse(f.storage.get(f.key)).record.nativeAssets.groups['image:MAIN'].state,'requested','a mirror never invents an upload ACK');
 }finally{f.close();}
});

test('a snapshot cannot create ownership without the durable known document ID',async()=>{
 const f=fixture();try{f.set(f.record);f.run(f.input);await f.flush();delete f.document.documentElement.dataset.yoofamSingleDocumentRecords;f.reset();await f.flush();
  assert.equal(f.run({...f.input,knownDocId:null}).restored,false);assert.equal(f.document.documentElement.dataset.yoofamSingleDocumentRecords,undefined);
  assert.equal(f.run(f.input).restored,true);
 }finally{f.close();}
});

for(const change of ['tab','document','binding','company'])test(`a different ${change} cannot restore the original document record`,async()=>{
 const f=fixture();try{f.set(f.record);f.run(f.input);await f.flush();const before=f.storage.get(f.key);delete f.document.documentElement.dataset.yoofamSingleDocumentRecords;f.reset();await f.flush();const input=copy(f.input);
  if(change==='tab')input.target.tabId++;if(change==='document')input.knownDocId++;if(change==='binding')input.binding.identityDigest='e'.repeat(64);if(change==='company')f.document.body.innerText='Company Code: A01464742';
  if(change==='company')assert.throws(()=>f.run(input));else assert.equal(f.run(input).ready,false);
  assert.equal(f.document.documentElement.dataset.yoofamSingleDocumentRecords,undefined);assert.equal(f.storage.get(f.key),before);
 }finally{f.close();}
});

test('removing a live record never rewinds to a stale mirror or erases the last observation',async()=>{
 const f=fixture();try{f.set(f.record);f.run(f.input);await f.flush();const before=f.storage.get(f.key);
  delete f.document.documentElement.dataset.yoofamSingleDocumentRecords;await f.flush();const result=f.run(f.input);
  assert.equal(result.ready,false);assert.equal(result.restored,false);assert.equal(f.storage.get(f.key),before);
 }finally{f.close();}
});

test('a storage failure after a real DOM ACK preserves that ACK and blocks the next write boundary',async()=>{
 const f=fixture();try{f.set(f.record);f.run(f.input);await f.flush();f.control.failWrite=true;
  const acknowledged={...f.record,state:'updated',updateOperationId:f.binding.requestId+':update'};
  f.set(acknowledged);const apiAck={status:200,docId:2347603};await f.flush();
  assert.deepEqual(apiAck,{status:200,docId:2347603});assert.deepEqual(JSON.parse(f.document.documentElement.dataset.yoofamSingleDocumentRecords)[f.binding.packetDigest],acknowledged);
  const health=f.run(f.input);assert.equal(health.ready,false);assert.equal(health.code,'OWNED_RECORD_STORAGE');
  f.control.failWrite=false;assert.equal(f.run(f.input).ready,true);assert.deepEqual(JSON.parse(f.storage.get(f.key)).record,acknowledged);
 }finally{f.close();}
});

test('renewed stage challenges are mirrored as observed, never rejected as a backwards ACK',async()=>{
 const f=fixture();try{f.set({...f.record,state:'validated',challengeId:'old',watchState:'active'});f.run(f.input);await f.flush();
  const next={...f.record,state:'validated',challengeId:'renewed',watchState:'active',challengeIssuedAt:1234};f.set(next);await f.flush();assert.equal(f.run(f.input).ready,true);assert.deepEqual(JSON.parse(f.storage.get(f.key)).record,next);
 }finally{f.close();}
});

test('corrupt or conflicting stored records do not overwrite a fresh page record',async()=>{
 for(const corrupt of ['json','newer']){const f=fixture();try{f.set(f.record);f.run(f.input);await f.flush();
  if(corrupt==='json')f.storage.set(f.key,'{broken');else{const saved=JSON.parse(f.storage.get(f.key));saved.record.state='updated';f.storage.set(f.key,JSON.stringify(saved));}
  f.reset();const before=f.storage.get(f.key),result=f.run(f.input);assert.equal(result.ready,false);assert.equal(result.restored,false);assert.equal(f.storage.get(f.key),before);
 }finally{f.close();}}
});
