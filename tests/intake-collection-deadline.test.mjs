import test from 'node:test';
import assert from 'node:assert/strict';
import {acknowledgementClock,deferred,observe,settle} from './helpers/intake-collection-deadline.mjs';

const sourceUrl='https://detail.1688.com/offer/741000000001.html';
const job={id:'local-deadline-job',offer_id:'741000000001',source_url:sourceUrl};
const receivedAt='2026-10-19T01:00:01.000Z';
const receipt=()=>({jobId:job.id,offerId:job.offer_id,receipt:{receivedAt,result:{schemaVersion:1,sourceUrl,offerId:job.offer_id,provider:'1688-public-mobile-v1',collectedAt:'2026-10-19T01:00:00.000Z',title:'로컬 합성 상품',description:'',options:[{sku:'local-option',name:'검정',unitPriceCny:2.99,minimumOrder:1,stock:null}],images:[]}}});

for(const action of ['collect','browser-capture'])for(const phase of ['headers','body'])test(`${action} stalled ${phase} recovers exactly once without accepting a late source`,async()=>{
 const h=acknowledgementClock(),controller=new AbortController(),held=deferred(),calls=[];let lateReads=0,cancelledBodies=0;
 const value=observe(h.requestIntakeCollectionReceipt(job,action,{signal:controller.signal,capture:{format:'local-test-only'},fetcher:async(url,init)=>{
  calls.push({url,init});if(init.method==='GET')return Response.json(receipt());
  return phase==='headers'?held.promise:{ok:true,status:200,body:{cancel:async()=>{cancelledBodies++;}},json:()=>held.promise};
 }}));
 await settle();assert.equal(value.settled,false);assert.equal(h.timers.size,1);h.fire(40_000);await settle();
 assert.equal(value.error,undefined);assert.equal(value.value.kind,'received');assert.equal(value.value.receivedAt,receivedAt);
 assert.deepEqual(calls.map(item=>[item.url.split('/').at(-1),item.init.method]),[[action,'POST'],['result','GET']]);
 assert.equal(calls[0].init.signal.aborted,true);assert.equal(calls[1].init.signal.aborted,false);assert.equal(controller.signal.aborted,false);assert.equal(h.timers.size,0);
 const wrong={...receipt(),jobId:'wrong-late-job'};
 held.resolve(phase==='headers'?{ok:true,status:200,body:{cancel:async()=>{cancelledBodies++;}},json:async()=>{lateReads++;return wrong;}}:wrong);
 await settle();assert.equal(value.value.source.title,'로컬 합성 상품');assert.equal(calls.length,2);assert.equal(lateReads,0);assert.equal(cancelledBodies,1);
});

for(const phase of ['headers','body'])test(`one receipt recovery bounds stalled ${phase} and never retries the write`,async()=>{
 const h=acknowledgementClock(),controller=new AbortController(),held=deferred(),calls=[];
 const value=observe(h.requestIntakeCollectionReceipt(job,'collect',{signal:controller.signal,fetcher:async(url,init)=>{
  calls.push({url,init});if(init.method==='POST')throw Error('local ACK lost');
  return phase==='headers'?held.promise:{ok:true,status:200,json:()=>held.promise};
 }}));
 await settle();assert.equal(value.settled,false);assert.equal(calls.length,2);h.fire(10_000);await settle();
 assert.match(value.error.message,/저장된 원문도 확인하지 못했습니다.*입력은 유지/);assert.equal(controller.signal.aborted,false);assert.equal(calls[1].init.signal.aborted,true);assert.equal(h.timers.size,0);
 held.resolve(phase==='headers'?Response.json(receipt()):receipt());await settle();assert.equal(calls.length,2);
});

for(const status of [400,401,403,404,409,422])test(`HTTP${status} headers stay terminal when their body stalls`,async()=>{
 const h=acknowledgementClock(),controller=new AbortController(),calls=[];
 const value=observe(h.requestIntakeCollectionReceipt(job,'collect',{signal:controller.signal,fetcher:async(url,init)=>{calls.push({url,init});return {ok:false,status,json:()=>new Promise(()=>{})};}}));
 await settle();h.fire(40_000);await settle();assert.match(value.error.message,/상품 정보를 가져오지 못했습니다/);assert.equal(calls.length,1);assert.equal(h.timers.size,0);assert.equal(controller.signal.aborted,false);
});

for(const phase of ['headers','body','recovery-headers','recovery-body'])test(`parent abort releases ${phase} without waiting for the transport`,async()=>{
 const h=acknowledgementClock(),controller=new AbortController(),held=deferred(),calls=[];
 const value=observe(h.requestIntakeCollectionReceipt(job,'collect',{signal:controller.signal,fetcher:async(url,init)=>{
  calls.push({url,init});if(phase.startsWith('recovery')&&init.method==='POST')throw Error('local lost ACK');
  return phase.endsWith('headers')?held.promise:{ok:true,status:200,json:()=>held.promise};
 }}));
 await settle();assert.equal(value.settled,false);controller.abort();await settle();assert.equal(value.settled,true);assert.equal(value.value,undefined);assert.equal(value.error,undefined);
 assert.equal(calls.length,phase.startsWith('recovery')?2:1);assert.equal(calls.at(-1).init.signal.aborted,true);assert.equal(h.timers.size,0);
 held.reject(Error('local late rejection'));await settle();assert.equal(calls.length,phase.startsWith('recovery')?2:1);
});

test('a rejected recovery status does not wait for or read its error body',async()=>{
 const h=acknowledgementClock();let calls=0,reads=0,cancels=0;
 const value=await h.requestIntakeCollectionReceipt(job,'collect',{signal:new AbortController().signal,fetcher:async()=>{
  if(++calls===1)throw Error('ACK lost');return {ok:false,status:403,json:async()=>{reads++;return {};},body:{cancel:async()=>{cancels++;}}};
 }}).then(()=>null,error=>error);
 assert.match(value.message,/저장된 원문도 확인하지 못했습니다/);assert.equal(calls,2);assert.equal(reads,0);assert.equal(cancels,1);assert.equal(h.timers.size,0);
});

test('a completed valid body keeps its identity validation and no timeout survives',async()=>{
 const h=acknowledgementClock();let calls=0;
 await assert.rejects(h.requestIntakeCollectionReceipt(job,'collect',{signal:new AbortController().signal,fetcher:async()=>{calls++;return Response.json({...receipt(),jobId:'foreign'});}}),/요청한 상품과 다릅니다/);
 assert.equal(calls,1);assert.equal(h.timers.size,0);
});

test('invalid internal deadline configuration fails before any request or timer',async()=>{
 const h=acknowledgementClock();let calls=0;
 for(const options of [{timeoutMs:0},{timeoutMs:-1},{timeoutMs:NaN},{timeoutMs:Infinity},{timeoutMs:120001},{recoveryTimeoutMs:0},{recoveryTimeoutMs:30001},{recoveryTimeoutMs:1.5}]){
  await assert.rejects(h.requestIntakeCollectionReceipt(job,'collect',{...options,signal:new AbortController().signal,fetcher:async()=>{calls++;return Response.json(receipt());}}),/제한 시간/);
 }
 assert.equal(calls,0);assert.equal(h.timers.size,0);
});
