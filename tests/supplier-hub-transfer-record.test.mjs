import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// A serialized transactional IndexedDB fixture exercises the actual store
// implementation. This is not a real Chrome profile/storage integration test.
function fixture(){
 const rows=new Map(),modes=[];let serial=Promise.resolve();
 const db={close(){},transaction(_name,mode){
  modes.push(mode);const operations=[],tx={objectStore:()=>({
   get(key){const request={};operations.push(()=>{request.result=structuredClone(rows.get(key));request.onsuccess?.();});return request;},
   put(value,key){const request={};operations.push(()=>{if(mode!=='readwrite')throw Error('Read-only transaction');rows.set(key,structuredClone(value));request.result=key;request.onsuccess?.();});return request;},
  })};
  serial=serial.then(()=>{const previous=new Map(rows);try{while(operations.length)operations.shift()();tx.oncomplete?.();}
   catch(error){rows.clear();for(const [key,value] of previous)rows.set(key,value);tx.error=error;tx.onerror?.();}});
  return tx;
 }};
 const indexedDB={open(){const request={};queueMicrotask(()=>{request.result=db;request.onsuccess?.();});return request;}};
 const source=fs.readFileSync(new URL('../extensions/supplier-hub/handoff-store.mjs',import.meta.url),'utf8')
  .replace(/export (const|async function|function) /g,'$1 ');
 const context=vm.createContext({indexedDB,URL,Date});vm.runInContext(source,context);
 return {rows,modes,record:(...args)=>context.transferRecord(...args)};
}

test('concurrent tab recovery claims persist exactly one identity without replacing the winner',async()=>{
 const h=fixture(),values=Array.from({length:8},(_,i)=>({productId:`product-${i}`,company:{code:'A01464742',name:'와이홉'}}));
 const results=await Promise.all(values.map(value=>h.record('claim','attempt:123',value)));
 assert.equal(results.filter(Boolean).length,1);
 const winner=values[results.indexOf(true)],saved=await h.record('get','attempt:123');assert.deepEqual(saved,winner);
 assert.equal(await h.record('claim','attempt:123',{productId:'new-work'}),false);assert.deepEqual(await h.record('get','attempt:123'),winner);
 saved.productId='mutated';assert.deepEqual(await h.record('get','attempt:123'),winner);
 assert.deepEqual(h.modes.slice(0,8),Array(8).fill('readwrite'));
});

test('a newer existing tab assignment and persisted upload claims are preserved across fresh store connections',async()=>{
 const h=fixture(),current={productId:'new-work'},key=`transmission:https://sourceflow.jjwwhhjj1116.workers.dev:p:80719:${'a'.repeat(64)}`;
 await h.record('put','attempt:123',current);assert.equal(await h.record('claim','attempt:123',{productId:'old-work'}),false);
 assert.deepEqual(await h.record('get','attempt:123'),current);
 const results=await Promise.all(Array.from({length:8},()=>h.record('claim',key,{state:'started'})));
 assert.equal(results.filter(Boolean).length,1);assert.equal((await h.record('get',key)).state,'started');
 assert.equal(await h.record('claim','attempt:124',{productId:'other'}),true);assert.deepEqual(await h.record('get','attempt:123'),current);
});

test('atomic claims cannot target malformed result records or malformed tab keys',async()=>{
 const h=fixture();
 for(const key of ['result:http://localhost:3000:p:80719:a','attempt:abc','attempt:-1','unrelated'])await assert.rejects(h.record('claim',key,{}));
 assert.equal(h.rows.size,0);assert.equal(h.modes.length,0);
});
test('concurrent accepted receipt restoration never overwrites the first saved identity',async()=>{
 const h=fixture(),identity={origin:'http://localhost:3000',productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64)};
 const key=`result:${identity.origin}:p:80719:${identity.fingerprint}`;
 const values=Array.from({length:8},(_,index)=>({...identity,company:{code:'A01464742',name:'와이홉'},includedOptions:6,filename:`YOOFAM-${identity.fingerprint}.xlsx`,quotationId:`quote-${index}`,state:'validation-complete',observedAt:Date.now(),registered:false}));
 const results=await Promise.all(values.map(value=>h.record('claim',key,value)));assert.equal(results.filter(Boolean).length,1);
 assert.deepEqual(await h.record('get',key),values[results.indexOf(true)]);
 for(const patch of [{company:{code:'A01464742',name:'유앤채'}},{includedOptions:0},{state:'not-found'},{fingerprint:'b'.repeat(64)},{origin:'https://other.test'},{quotationId:' quote'},{registered:true}])await assert.rejects(h.record('claim',key,{...values[0],...patch}));
 assert.equal(h.rows.size,1);
});
test('pending and rejected server receipts can be restored atomically without creating upload attempts',async()=>{
 for(const state of ['validation-pending','validation-rejected']){
  const h=fixture(),value={origin:'http://localhost:3000',productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64),company:{code:'A01464742',name:'와이홉'},includedOptions:6,
   filename:`YOOFAM-${'a'.repeat(64)}.xlsx`,state,observedAt:Date.now(),registered:false},key=`result:${value.origin}:p:80719:${value.fingerprint}`;
  assert.equal(await h.record('claim',key,value),true);assert.equal(await h.record('claim',key,{...value,state:'validation-complete',quotationId:'quote'}),false);
  assert.deepEqual(await h.record('get',key),value);assert.equal(h.rows.size,1);
  for(const patch of [{observedAt:0},{state:'not-found'},{includedOptions:201},{detail:'x'.repeat(20001)}])await assert.rejects(h.record('claim',key,{...value,...patch}));
 }
});

test('accepted receipt promotion atomically replaces only the exact pending snapshot for both companies',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])for(const state of ['validation-pending','not-found']){
  const h=fixture(),identity={origin:'http://localhost:3000',productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64)},key=`result:${identity.origin}:p:80719:${identity.fingerprint}`;
  const expected={...identity,company,includedOptions:6,filename:`YOOFAM-${identity.fingerprint}.xlsx`,state,observedAt:Date.now(),registered:false};
  const accepted={...expected,state:'validation-complete',quotationId:'synthetic-accepted',profileId:'profile',receiptRecovered:true};
  await h.record('put',key,expected);
  const results=await Promise.all(Array.from({length:8},()=>h.record('promote',key,{expected,accepted})));
  assert.equal(results.filter(Boolean).length,1);assert.deepEqual(await h.record('get',key),accepted);assert.equal(h.rows.size,1);
  assert.ok(h.modes.slice(1,9).every(mode=>mode==='readwrite'));
 }
});

test('promotion cannot overwrite competing accepted/rejected or newer pending observations and rejects mismatched receipt sources',async()=>{
 const identity={origin:'http://localhost:3000',productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64)},key=`result:${identity.origin}:p:80719:${identity.fingerprint}`;
 const expected={...identity,company:{code:'A01464742',name:'와이홉'},includedOptions:6,filename:`YOOFAM-${identity.fingerprint}.xlsx`,state:'validation-pending',observedAt:Date.now(),registered:false};
 const accepted={...expected,state:'validation-complete',quotationId:'synthetic-accepted',profileId:'profile',receiptRecovered:true};
 for(const competing of [{...accepted,quotationId:'another-id'},{...expected,state:'validation-rejected'},{...expected,observedAt:expected.observedAt+1},{...expected,status:'newer pending'},undefined]){
  const h=fixture();if(competing)await h.record('put',key,competing);assert.equal(await h.record('promote',key,{expected,accepted}),false);
  assert.deepEqual(await h.record('get',key),competing);
 }
 for(const patch of [{company:{code:'A01526306',name:'유앤채'}},{includedOptions:5},{profileId:'../profile'},{filename:'other.xlsx'},{fingerprint:'b'.repeat(64)},
  {state:'validation-rejected'},{quotationId:'truncated...'},{observedAt:0}]){
  const h=fixture();await h.record('put',key,expected);await assert.rejects(h.record('promote',key,{expected,accepted:{...accepted,...patch}}));
  assert.deepEqual(await h.record('get',key),expected);
 }
 for(const patch of [{profileId:'different'},{quotationId:'other-id'},{state:'validation-rejected'},{registration:{rows:[]}},{productId:'another-product'}]){
  const h=fixture(),prior={...expected,...patch};await h.record('put',key,prior);await assert.rejects(h.record('promote',key,{expected:prior,accepted}));assert.deepEqual(await h.record('get',key),prior);
 }
});
