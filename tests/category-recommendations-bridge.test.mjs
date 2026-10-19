import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const content=fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../extensions/supplier-hub/handoff-worker.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
const app=ts.transpileModule(fs.readFileSync(new URL('../app/supplier-hub-handoff.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture({version='2.1.1',failure=false}={}){
 const origin='http://localhost:3000',listeners=[],calls=[],timers=new Map();let workerHandler,id=0;
 const sender={frameId:0,url:origin+'/',tab:{id:7,windowId:17}},recommendations={source:'supplier-hub-category-predict-api',ownerId:'owner',company:{code:'A01526306',name:'유앤채'},productName:'남성 방한 모자',observedAt:1,items:[]};
 vm.runInNewContext(worker,{chrome:{runtime:{onMessage:{addListener(fn){workerHandler=fn;}}}},readAppSupplierHubCategoryRecommendations:async(message,who)=>{calls.push({message,who});if(failure)throw Error('회원 회사와 Supplier Hub 회사코드가 다릅니다.');return recommendations;}});
 const window={location:{origin},addEventListener:(_type,fn)=>listeners.push(fn),removeEventListener:(_type,fn)=>{const index=listeners.indexOf(fn);if(index>=0)listeners.splice(index,1);},postMessage(data,target){assert.equal(target,origin);queueMicrotask(()=>{for(const fn of [...listeners])void fn({source:window,origin,data});});}};
 vm.runInNewContext(content,{window,location:{origin},chrome:{runtime:{getManifest:()=>({version}),onMessage:{addListener(){}},sendMessage:message=>new Promise(resolve=>assert.equal(workerHandler(message,sender,resolve),true))}}});
 const exports={};vm.runInNewContext(app,{exports,require:()=>({}),window,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++id).padStart(12,'0')}`},setTimeout:(fn,delay)=>{timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),Error});
 return {exchange:exports.exchange,calls,recommendations,timers,window,listeners};
}

test('real app exchange crosses the content allowlist and worker route and returns official recommendations',async()=>{
 const h=fixture(),signal=new AbortController().signal;
 assert.equal((await h.exchange('PING',null,signal)).categoryRecommendations,true);
 const payload={productName:'남성 방한 모자',expectedOwnerId:'owner'},reply=await h.exchange('RECOMMEND_CATEGORIES',payload,signal);
 assert.equal(reply.ok,true);assert.equal(reply.recommendations,h.recommendations);assert.equal(h.calls.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].message)),{...payload,type:'YOOFAM_RECOMMEND_CATEGORIES'});
 assert.equal(h.calls[0].who.tab.id,7);assert.equal(h.timers.size,0);
});

test('prediction capability follows the installed worker manifest rather than new disk content',async()=>{
 for(const version of ['0.2.88','2.0.5','2.1.0']){
  const h=fixture({version});assert.equal((await h.exchange('PING',null,new AbortController().signal)).categoryRecommendations,false);assert.equal(h.calls.length,0);
 }
 for(const version of ['2.1.1','2.1.2','2.2.0','3.0.0'])assert.equal((await fixture({version}).exchange('PING',null,new AbortController().signal)).categoryRecommendations,true);
});

test('worker prediction failures return through the real content bridge instead of timing out',async()=>{
 const h=fixture({failure:true});await assert.rejects(h.exchange('RECOMMEND_CATEGORIES',{productName:'남성 방한 모자',expectedOwnerId:'owner'},new AbortController().signal),/회사코드가 다릅니다/);
 assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
});

test('foreign window or origin cannot forward recommendation commands',async()=>{
 const h=fixture(),data={channel:'YOOFAM_HUB_HANDOFF',requestId:'00000000-0000-4000-8000-000000000010',type:'RECOMMEND_CATEGORIES',payload:{productName:'남성 방한 모자',expectedOwnerId:'owner'}};
 await h.listeners[0]({source:{},origin:'http://localhost:3000',data});await h.listeners[0]({source:h.window,origin:'https://foreign.example',data});assert.equal(h.calls.length,0);
});
