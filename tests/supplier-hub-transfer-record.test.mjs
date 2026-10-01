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

test('atomic claims cannot target result records or malformed tab keys',async()=>{
 const h=fixture();
 for(const key of ['result:http://localhost:3000:p:80719:a','attempt:abc','attempt:-1','unrelated'])await assert.rejects(h.record('claim',key,{}));
 assert.equal(h.rows.size,0);assert.equal(h.modes.length,0);
});
