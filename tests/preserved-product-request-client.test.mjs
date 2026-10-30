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
  const listeners=new Set(),sent=[],timers=new Map(),contexts=[];let timerId=0;
  const win={location:{origin:'https://sourceflow.jjwwhhjj1116.workers.dev'},addEventListener:(type,fn)=>{assert.equal(type,'message');listeners.add(fn);},removeEventListener:(type,fn)=>listeners.delete(fn),postMessage:(message,origin)=>{assert.equal(origin,win.location.origin);sent.push(message);}};
  const exports={};const scope={exports,Error,crypto:webcrypto,window:win,AbortController,Object,setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),require:name=>name.includes('preserved-product-checkpoint')?parser:{readSingleCatalogContext:async signal=>{assert.equal(signal.aborted,false);contexts.push('GET catalog-context');return structuredClone(contexts.length===2&&f.after?f.after:actor);}}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/preserved-product-request-client.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope);
  const f={client:exports,listeners,sent,timers,contexts,window:win,after:null};
  f.reply=(override={},event={})=>{const request=sent.at(-1),target={...selection,company:actor.company};const result={format:'yoofam-preserved-product-checkpoint-inspection-v1',target,status:'not-found',found:false,scanned:3,complete:true,readOnly:true,remoteWrites:false,checkpointWrites:false,registered:false,canResume:false,checkpoint:null,diagnostic:{code:'not-found',message:'이 확장 보관함에서 같은 회원·회사·상품의 요청을 찾지 못했습니다. 새 요청을 만들지 않았습니다.'},...override};for(const fn of [...listeners])fn({source:win,origin:win.location.origin,data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:request.requestId,result:{ok:true,result}},...event});};
  return f;
}
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};

test('preserved request inspection sends exactly one read-only command and validates current owner/company around it',async()=>{
 const f=fixture(),controller=new AbortController(),pending=f.client.inspectPreservedProductRequest(selection,actor.ownerId,controller.signal);await settle();
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].type,'PRESERVED_PRODUCT_DOCUMENT');assert.deepEqual(JSON.parse(JSON.stringify(f.sent[0].payload)),{action:'inspect',target:{...selection,company:actor.company}});
 f.reply();const result=await pending;assert.equal(result.status,'not-found');assert.equal(result.canResume,false);assert.deepEqual(f.contexts,['GET catalog-context','GET catalog-context']);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);assert.equal(f.sent.length,1);
});

test('wrong actor or malformed target never dispatches a request',async()=>{
 for(const [input,owner]of[[selection,'different-owner'],[{...selection,docId:NaN},actor.ownerId],[{...selection,requestId:'new-guess'},actor.ownerId]]){
  const f=fixture();await assert.rejects(f.client.inspectPreservedProductRequest(input,owner,new AbortController().signal));assert.equal(f.sent.length,0);
 }
});

test('cross-origin and uncorrelated replies cannot finish an inspection; widened capability responses are rejected',async()=>{
 const f=fixture(),pending=f.client.inspectPreservedProductRequest(selection,actor.ownerId,new AbortController().signal);await settle();
 f.reply({}, {origin:'https://other.test'});assert.equal(f.listeners.size,1);
 f.reply({}, {source:{}});assert.equal(f.listeners.size,1);
 f.reply({canResume:true});await assert.rejects(pending,/응답의 범위/);assert.equal(f.sent.length,1);assert.equal(f.contexts.length,1);
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
