import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
import * as parser from '../extensions/supplier-hub/preserved-product-checkpoint.mjs';

const selection={requestId:'f29491bd-1882-456a-8a63-eec8586db6c6',docId:2347603,productId:'e2f8037c-294e-45a8-b06d-58cc5909683c'};
const actor={ownerId:'member-a',company:{code:'A01526306',name:'유앤채'}};
function fixture(){
  const listeners=new Set(),sent=[],timers=new Map(),contexts=[],pings=[],data=new Map(),reads=[],writes=[],order=[];let timerId=0;
  const win={location:{origin:'https://sourceflow.jjwwhhjj1116.workers.dev'},localStorage:{getItem(key){reads.push(key);order.push('pending-read');f.onPendingRead?.();return data.get(key)??null;},setItem(key,value){writes.push(['set',key,value]);data.set(key,value);},removeItem(key){writes.push(['remove',key]);data.delete(key);}},addEventListener:(type,fn)=>{assert.equal(type,'message');listeners.add(fn);},removeEventListener:(type,fn)=>listeners.delete(fn),postMessage:(message,origin)=>{assert.equal(origin,win.location.origin);sent.push(message);}};
  const pendingApi={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/supplier-hub-product-pending.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:pendingApi,window:win,Error,Date});
  const exports={};const scope={exports,Error,crypto:webcrypto,window:win,AbortController,Object,setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),require:name=>name.includes('preserved-product-checkpoint')?parser:name==='@/app/supplier-hub-product-pending'?pendingApi:name==='@/app/supplier-hub-handoff'?{exchange:async(type,payload,signal)=>{assert.equal(type,'PING');assert.equal(payload,null);assert.equal(signal.aborted,false);pings.push(type);order.push('PING');if(f.pingError)throw f.pingError;return structuredClone(f.capability);}}:{readSingleCatalogContext:async signal=>{assert.equal(signal.aborted,false);contexts.push('GET catalog-context');return structuredClone(contexts.length===2&&f.after?f.after:actor);}}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/preserved-product-request-client.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope);
  const f={client:exports,listeners,sent,timers,contexts,pings,data,reads,writes,order,pendingApi,capability:{version:'2.1.61',preservedProductCheckpointInspection:true},pingError:null,window:win,after:null,onPendingRead:null};
  f.reply=(override={},event={})=>{const request=sent.at(-1),target={...selection,company:actor.company};const result={format:'yoofam-preserved-product-checkpoint-inspection-v1',target,status:'not-found',found:false,scanned:3,complete:true,readOnly:true,remoteWrites:false,checkpointWrites:false,registered:false,canResume:false,checkpoint:null,diagnostic:{code:'not-found',message:'이 확장 보관함에서 같은 회원·회사·상품의 요청을 찾지 못했습니다. 새 요청을 만들지 않았습니다.'},...override};for(const fn of [...listeners])fn({source:win,origin:win.location.origin,data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:request.requestId,result:{ok:true,result}},...event});};
  return f;
}
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};

test('preserved request inspection sends exactly one read-only command and validates current owner/company around it',async()=>{
 const f=fixture(),controller=new AbortController(),pending=f.client.inspectPreservedProductRequest(selection,actor.ownerId,controller.signal);await settle();
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].type,'PRESERVED_PRODUCT_DOCUMENT');assert.deepEqual(JSON.parse(JSON.stringify(f.sent[0].payload)),{action:'inspect',target:{...selection,company:actor.company}});
 assert.deepEqual(f.pings,['PING']);
 f.reply();const result=await pending;assert.equal(result.status,'not-found');assert.equal(result.canResume,false);assert.deepEqual(f.contexts,['GET catalog-context','GET catalog-context']);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);assert.equal(f.sent.length,1);
});

test('wrong actor or malformed target never dispatches a request',async()=>{
 for(const [input,owner]of[[selection,'different-owner'],[{...selection,docId:NaN},actor.ownerId],[{...selection,requestId:'new-guess'},actor.ownerId]]){
  const f=fixture();await assert.rejects(f.client.inspectPreservedProductRequest(input,owner,new AbortController().signal));assert.equal(f.sent.length,0);assert.equal(f.pings.length,0);
 }
});

test('an old or mismatched installed worker fails before the unsupported command, listener or long timer',async()=>{
 for(const capability of [{version:'2.1.59',preservedProductCheckpointInspection:false},{version:'2.1.59',preservedProductCheckpointInspection:true},{version:'2.1.61',preservedProductCheckpointInspection:false},{version:'2.1.61'},{version:'not-a-version',preservedProductCheckpointInspection:true},{version:'2.1.65536',preservedProductCheckpointInspection:true}]){
  const f=fixture();f.capability=capability;
  await assert.rejects(f.client.inspectPreservedProductRequest(selection,actor.ownerId,new AbortController().signal),/Chrome 확장/);
  assert.deepEqual(f.pings,['PING']);assert.equal(f.sent.length,0);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);assert.equal(f.contexts.length,2);
 }
 const f=fixture();f.pingError=Error('extension disconnected');
 await assert.rejects(f.client.inspectPreservedProductRequest(selection,actor.ownerId,new AbortController().signal),/disconnected/);
 assert.equal(f.sent.length,0);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);
});

test('cross-origin and uncorrelated replies cannot finish an inspection; widened capability responses are rejected',async()=>{
 const f=fixture(),pending=f.client.inspectPreservedProductRequest(selection,actor.ownerId,new AbortController().signal);await settle();
 f.reply({}, {origin:'https://other.test'});assert.equal(f.listeners.size,1);
 f.reply({}, {source:{}});assert.equal(f.listeners.size,1);
 f.reply({canResume:true});await assert.rejects(pending,/응답의 범위/);assert.equal(f.sent.length,1);assert.equal(f.contexts.length,2);
});

test('actor changes after extension lookup discard the response without a write or replay',async()=>{
 const f=fixture();f.after={ownerId:'member-b',company:{code:'A01464742',name:'와이홉'}};
 const pending=f.client.inspectPreservedProductRequest(selection,actor.ownerId,new AbortController().signal);await settle();f.reply();await assert.rejects(pending,/회원·회사가 달라/);assert.equal(f.sent.length,1);
});

test('timeout and cancellation clean listeners and never retry the original or create a replacement request',async()=>{
 for(const cancel of[false,true]){
  const f=fixture(),controller=new AbortController(),pending=f.client.inspectPreservedProductRequest(selection,actor.ownerId,controller.signal);await settle();
  if(cancel)controller.abort();else [...f.timers.values()][0]();
  await assert.rejects(pending,cancel?/취소/:/확장 응답/);assert.equal(f.sent.length,1);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);
 }
});

function localDescriptor(patch={}){return {format:'yoofam-product-document-pending-v1',origin:'https://sourceflow.jjwwhhjj1116.workers.dev',ownerId:actor.ownerId,
 companyCode:actor.company.code,companyName:actor.company.name,productId:selection.productId,requestId:selection.requestId,createdAt:Date.now()-60000,
 reviewDigest:'a'.repeat(64),originalBodySha256:'b'.repeat(64),preparedBodySha256:'c'.repeat(64),identityDigest:'d'.repeat(64),appTabId:123,windowId:456,...patch};}
function storeDescriptor(f,value){const key=f.pendingApi.productDocumentPendingKey({identity:{...actor,productId:selection.productId}});f.data.set(key,typeof value==='string'?value:JSON.stringify(value));return key;}

test('unsupported extension still exposes exact absent or matching web descriptor diagnostics before its preflight',async()=>{
 for(const saved of [null,localDescriptor()]){
  const f=fixture();f.capability={version:'2.1.59'};if(saved)storeDescriptor(f,saved);
  await assert.rejects(f.client.inspectPreservedProductRequest(selection,actor.ownerId,new AbortController().signal),error=>{
   assert.ok(error instanceof f.client.PreservedProductInspectionError);const info=error.pendingDiagnostic;
   assert.equal(info.status,saved?'same-request':'absent');assert.equal(info.sameRequest,saved?true:null);
   assert.equal(info.requestId,saved?.requestId??null);assert.equal(info.createdAt,saved?.createdAt??null);
   assert.deepEqual(Object.keys(info).sort(),['status','requestId','createdAt','sameRequest','message'].sort());
   assert.doesNotMatch(JSON.stringify(info),/reviewDigest|originalBodySha256|preparedBodySha256|identityDigest|appTabId|windowId|password|jsonDocument/);
   return true;
  });
  assert.deepEqual(f.order,['pending-read','PING']);assert.equal(f.contexts.length,2);assert.equal(f.sent.length,0);assert.equal(f.writes.length,0);
 }
});

test('a different web request is reported without changing it or dispatching that request',async()=>{
 const f=fixture(),saved=localDescriptor({requestId:'00000000-0000-4000-8000-000000000734'}),key=storeDescriptor(f,saved);f.pingError=Error('extension disconnected');
 await assert.rejects(f.client.inspectPreservedProductRequest(selection,actor.ownerId,new AbortController().signal),error=>{
  assert.equal(error.pendingDiagnostic.status,'different-request');assert.equal(error.pendingDiagnostic.sameRequest,false);assert.equal(error.pendingDiagnostic.requestId,saved.requestId);return true;
 });
 assert.equal(f.data.get(key),JSON.stringify(saved));assert.equal(f.writes.length,0);assert.equal(f.sent.length,0);
});

test('corrupt, wider or unavailable web records stay untouched and return no guessed request identity',async()=>{
 for(const raw of ['{broken',JSON.stringify({...localDescriptor(),body:'forbidden'}),JSON.stringify(localDescriptor({ownerId:'different-owner'})),'x'.repeat(4097),'storage-blocked']){
  const f=fixture();f.capability={version:'2.1.59'};const key=storeDescriptor(f,raw);
  if(raw==='storage-blocked')Object.defineProperty(f.window,'localStorage',{get(){throw Error('private mode denied');}});
  await assert.rejects(f.client.inspectPreservedProductRequest(selection,actor.ownerId,new AbortController().signal),error=>{
   assert.equal(error.pendingDiagnostic.status,'unreadable');assert.equal(error.pendingDiagnostic.requestId,null);assert.equal(error.pendingDiagnostic.createdAt,null);assert.equal(error.pendingDiagnostic.sameRequest,null);return true;
  });
  assert.equal(f.data.get(key),raw);assert.equal(f.writes.length,0);assert.equal(f.sent.length,0);
 }
});

test('actor/company changes or cancellation cannot expose a local descriptor with an extension error',async()=>{
 for(const after of [{...actor,ownerId:'member-b'},{...actor,company:{code:'A01464742',name:'와이홉'}},{...actor,company:{...actor.company,name:'changed-name'}}]){
  const f=fixture();storeDescriptor(f,localDescriptor());f.capability={version:'2.1.59'};f.after=after;
  await assert.rejects(f.client.inspectPreservedProductRequest(selection,actor.ownerId,new AbortController().signal),error=>{assert.match(error.message,/회원·회사가 달라/);assert.equal(error.pendingDiagnostic,undefined);return true;});
  assert.equal(f.writes.length,0);assert.equal(f.sent.length,0);
 }
 for(const point of ['before','during-read','during-reply']){
  const f=fixture(),controller=new AbortController();storeDescriptor(f,localDescriptor());
  if(point==='before')controller.abort();
  if(point==='during-read')f.onPendingRead=()=>controller.abort();
  const pending=f.client.inspectPreservedProductRequest(selection,actor.ownerId,controller.signal);
  if(point==='during-reply'){await settle();controller.abort();}
  await assert.rejects(pending,error=>{assert.equal(error.pendingDiagnostic,undefined);return true;});
  assert.equal(f.writes.length,0);assert.equal(f.sent.length,point==='during-reply'?1:0);
 }
});

test('successful checkpoint inspection includes bounded local metadata and still cannot resume',async()=>{
 const f=fixture(),saved=localDescriptor();storeDescriptor(f,saved);const pending=f.client.inspectPreservedProductRequest(selection,actor.ownerId,new AbortController().signal);await settle();f.reply();
 const result=await pending;assert.equal(result.canResume,false);assert.equal(result.pendingDiagnostic.status,'same-request');assert.equal(result.pendingDiagnostic.requestId,saved.requestId);
 assert.equal(f.writes.length,0);assert.equal(f.sent.length,1);assert.equal(f.sent[0].payload.action,'inspect');assert.deepEqual(f.order,['pending-read','PING']);
});
