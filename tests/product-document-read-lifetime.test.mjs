import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {PRODUCT_DOCUMENT_PREVIEW_ACK_TIMEOUT} from '../extensions/supplier-hub/product-document.mjs';

const withoutImports=name=>fs.readFileSync(new URL('../extensions/supplier-hub/'+name,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
const helperSource=withoutImports('product-document-read-lifetime.mjs').replace(/export /g,'');
const workerSource=withoutImports('handoff-worker.mjs');
const settle=async()=>{for(let index=0;index<8;index++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function fakeClock(){
 let now=0,next=0;const timers=new Map();
 const schedule=(callback,delay,interval=false)=>{const id=++next;timers.set(id,{callback,at:now+delay,period:interval?delay:null});return id;};
 return{get now(){return now;},timers,
  setInterval:(callback,delay)=>schedule(callback,delay,true),clearInterval:id=>timers.delete(id),
  setTimeout:(callback,delay)=>schedule(callback,delay),clearTimeout:id=>timers.delete(id),
  async tick(duration){const end=now+duration;for(;;){const entry=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!entry)break;
   const [id,timer]=entry;now=timer.at;if(timer.period===null)timers.delete(id);else timer.at+=timer.period;
   timer.callback();await settle();
  }now=end;await settle();}
 };
}
function fixture({api='resolved',operation}={}){
 const clock=fakeClock(),gate=operation??deferred(),pulseGate=deferred(),calls=[],replies=[];let listener,dispatches=0;
 const runtime={onMessage:{addListener(callback){listener=callback;}}};
 if(api!=='unavailable')runtime.getPlatformInfo=()=>{calls.push(clock.now);if(api==='throw')throw Error('private runtime detail');if(api==='reject')return Promise.reject(Error('private runtime detail'));return api==='pending'?pulseGate.promise:Promise.resolve({os:'win'});};
 const withProductDocumentReadLifetime=vm.runInNewContext(helperSource+'\nwithProductDocumentReadLifetime',{
  PRODUCT_DOCUMENT_PREVIEW_ACK_TIMEOUT,Date:{now:()=>clock.now},...clock,
 });
 vm.runInNewContext(workerSource,{chrome:{runtime},withProductDocumentReadLifetime,
  dispatchProductDocument:()=>{dispatches++;return gate.promise;},
 });
 const sender={id:'own-extension',frameId:0,url:'https://sourceflow.jjwwhhjj1116.workers.dev/',tab:{id:17,windowId:3}};
 return{clock,gate,pulseGate,calls,replies,get dispatches(){return dispatches;},
  begin(action){assert.equal(listener({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action},sender,value=>replies.push(JSON.parse(JSON.stringify(value)))),true);},
 };
}

test('actual worker performs one dispatch while a bounded audit uses local pulses and cleans up on completion',async()=>{
 const h=fixture();h.begin('auditUnexpectedLegal');assert.equal(h.dispatches,1);assert.deepEqual(h.calls,[]);assert.deepEqual(h.replies,[]);
 await h.clock.tick(24999);assert.deepEqual(h.calls,[]);
 await h.clock.tick(1);assert.deepEqual(h.calls,[25000]);
 await h.clock.tick(25000);assert.deepEqual(h.calls,[25000,50000]);
 h.gate.resolve({state:'read-only',remoteWrites:false});await settle();
 assert.deepEqual(h.replies,[{ok:true,result:{state:'read-only',remoteWrites:false}}]);assert.equal(h.clock.timers.size,0);
 await h.clock.tick(300000);assert.equal(h.dispatches,1);assert.deepEqual(h.calls,[25000,50000]);assert.equal(h.replies.length,1);
});

test('a coded failure is returned once and ends the operation-local pulse without retry',async()=>{
 const h=fixture();h.begin('recoverSavedDraftTarget');await h.clock.tick(25000);
 const error=Error('original scoped failure');error.code='SOURCE_CHANGED';h.gate.reject(error);await settle();
 assert.deepEqual(h.replies,[{ok:false,error:'original scoped failure',code:'SOURCE_CHANGED'}]);assert.equal(h.clock.timers.size,0);
 await h.clock.tick(300000);assert.equal(h.dispatches,1);assert.equal(h.calls.length,1);assert.equal(h.replies.length,1);
});

for(const [action,budget]of [['preview',PRODUCT_DOCUMENT_PREVIEW_ACK_TIMEOUT],['recoverSavedDraftTarget',180000],['auditUnexpectedLegal',180000],['validateSavedDocumentSteps',300000],['retrySavedDocumentStep',300000]])test(action+': pulse ends at the existing ACK cap even if the operation never answers',async()=>{
 const h=fixture();h.begin(action);await h.clock.tick(budget);
 assert.equal(h.calls.length,Math.floor((budget-1)/25000));assert.ok(h.calls.every(time=>time<budget));assert.equal(h.clock.timers.size,0);
 assert.equal(h.dispatches,1);assert.equal(h.replies.length,0,'cap does not settle or replace the underlying operation');
 const count=h.calls.length;await h.clock.tick(300000);assert.equal(h.calls.length,count);assert.equal(h.dispatches,1);
 h.gate.resolve({requestId:'original',remoteWrites:false});await settle();assert.equal(h.replies.length,1);assert.equal(h.replies[0].result.requestId,'original');
});

for(const api of ['unavailable','throw','reject'])test('an '+api+' local platform API does not alter the single operation or leak a failure',async()=>{
 const h=fixture({api});h.begin('auditUnexpectedLegal');await h.clock.tick(50000);
 assert.equal(h.dispatches,1);assert.equal(h.replies.length,0);
 if(api==='unavailable'){assert.deepEqual(h.calls,[]);assert.equal(h.clock.timers.size,0);}else assert.deepEqual(h.calls,[25000,50000]);
 h.gate.resolve({state:'audit-complete'});await settle();assert.deepEqual(h.replies,[{ok:true,result:{state:'audit-complete'}}]);assert.equal(h.clock.timers.size,0);
});

test('a slow platform API never overlaps another pulse',async()=>{
 const h=fixture({api:'pending'});h.begin('auditUnexpectedLegal');await h.clock.tick(100000);assert.deepEqual(h.calls,[25000]);
 h.pulseGate.resolve({os:'win'});await settle();await h.clock.tick(25000);assert.deepEqual(h.calls,[25000,125000]);
 h.gate.resolve({state:'complete'});await settle();assert.equal(h.replies.length,1);assert.equal(h.clock.timers.size,0);
});

for(const action of ['prepareDraft','confirmPreparedDraft','repairExistingDraft','resumeReservedRepair','confirm','start','observe','recoverDraft'])test(action+': unrelated document actions receive no pulse or timer',async()=>{
 const h=fixture();h.begin(action);assert.equal(h.clock.timers.size,0);await h.clock.tick(600000);assert.deepEqual(h.calls,[]);assert.equal(h.dispatches,1);
 h.gate.resolve({state:'original-result'});await settle();assert.deepEqual(h.replies,[{ok:true,result:{state:'original-result'}}]);
});

test('synchronous dispatcher failure still cleans up and produces one original failure',async()=>{
 const operation={get promise(){const error=Error('scoped synchronous failure');error.code='SOURCE_CHANGED';throw error;}};
 const h=fixture({operation});h.begin('auditUnexpectedLegal');await settle();assert.equal(h.clock.timers.size,0);assert.equal(h.dispatches,1);
 assert.deepEqual(h.replies,[{ok:false,error:'scoped synchronous failure',code:'SOURCE_CHANGED'}]);await h.clock.tick(300000);assert.deepEqual(h.calls,[]);
});
