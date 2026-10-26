import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRecoveryFixture} from './helpers/native-product-recovery.mjs';

const proof=f=>({identity:f.context.identity,bodySha256:f.context.originalBodySha256,preparedBodySha256:f.context.bodySha256,packetDigest:f.context.packetDigest,requestId:f.packet.requestId,docId:null});
const kind=url=>url.pathname.endsWith('/native-assets')?'plan':url.pathname.endsWith('/supplier-hub-receipt')?'history':url.pathname.endsWith('/supplier-hub-product-receipt')?'receipt':null;

test('source and both receipt reads overlap while the final account fence remains required',{timeout:5000},async()=>{
 let enabled=false,release;const gate=new Promise(resolve=>{release=resolve;}),started=new Set();
 const f=await nativeRecoveryFixture(undefined,{beforeNativeAppFetch:async url=>{if(!enabled)return;const name=kind(url);if(!name)return;started.add(name);if(started.size===3){enabled=false;release();}await gate;}});
 try{enabled=true;const value=await f.adapter.readSource(proof(f));assert.equal(value.current,true);assert.deepEqual([...started].sort(),['history','plan','receipt']);assert.deepEqual(f.state.uploads,[]);
  const last=f.state.appReads.at(-1);assert.ok(last.endsWith('/api/supplier-hub/catalog-context'));
 }finally{release();f.close();}
});

test('a receipt read failure waits for the in-flight source read and cannot produce a current proof',{timeout:5000},async()=>{
 let enabled=false,release,startedResolve;const gate=new Promise(resolve=>{release=resolve;}),started=new Set(),allStarted=new Promise(resolve=>{startedResolve=resolve;});
 const f=await nativeRecoveryFixture(undefined,{beforeNativeAppFetch:async url=>{if(!enabled)return;const name=kind(url);if(!name)return;started.add(name);if(started.size===3)startedResolve();if(name==='history')throw Error('synthetic receipt read failure');if(name==='plan')await gate;}});
 try{enabled=true;let settled=false;const pending=f.adapter.readSource(proof(f));pending.then(()=>{settled=true;},()=>{settled=true;});await allStarted;await Promise.resolve();await Promise.resolve();assert.equal(settled,false);
  enabled=false;release();await assert.rejects(pending);assert.deepEqual(f.state.uploads,[]);assert.equal(f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').length,0);
 }finally{release();f.close();}
});
