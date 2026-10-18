import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {observeSupplierHubResult} from '../extensions/supplier-hub/observe.mjs';
import {verifySupplierHubCompany} from '../extensions/supplier-hub/company.mjs';
import {readSupplierHubValidation} from '../extensions/supplier-hub/result.mjs';
import {resultKey,isAcceptedResult,canObserveSupplierHubRegistration,canObserveOriginalSupplierHubValidation} from '../extensions/supplier-hub/handoff-store.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];

// Execute the actual extension store in serialized read/write transactions.
// This inert IndexedDB driver is not real Chrome-profile storage integration.
function transactionalStore(){
 const rows=new Map(),transactions=[];let serial=Promise.resolve(),failPut=false;
 const db={close(){},transaction(_name,mode){
  const operations=[],trace={mode,operations:[]};transactions.push(trace);
  const tx={objectStore:()=>({get(key){const request={};operations.push(()=>{trace.operations.push(['get',key]);request.result=structuredClone(rows.get(key));request.onsuccess?.();});return request;},
   put(value,key){const request={};operations.push(()=>{assert.equal(mode,'readwrite');trace.operations.push(['put',key]);if(failPut){failPut=false;throw Error('synthetic transaction failure');}rows.set(key,structuredClone(value));request.result=key;request.onsuccess?.();});return request;}})};
  serial=serial.then(()=>{const before=new Map(rows);try{while(operations.length)operations.shift()();tx.oncomplete?.();}catch(error){rows.clear();for(const [key,value]of before)rows.set(key,value);tx.error=error;tx.onerror?.();}});return tx;
 }};
 const indexedDB={open(){const request={};queueMicrotask(()=>{request.result=db;request.onsuccess?.();});return request;}},context=vm.createContext({indexedDB,URL,Date,TextEncoder});
 vm.runInContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-store.mjs',import.meta.url),'utf8').replace(/export (const|async function|function) /g,'$1 '),context);
 return{rows,transactions,record:(...args)=>context.transferRecord(...args),failNextPut(){failPut=true;}};
}
function facts(company){
 const identity={origin:'http://localhost:3000',productId:'synthetic-original',categoryId:'80719',fingerprint:'a'.repeat(64),company,includedOptions:1},quotationId='synthetic-accepted',filename='YOOFAM-'+identity.fingerprint+'.xlsx',observedAt=Date.now()-1000;
 const accepted={...identity,state:'validation-complete',registered:false,filename,quotationId,observedAt},registration={quotationId,registered:false,scope:'queried-pages',pagesRead:1,hasMore:false,includedOptions:1,observedAt:Date.now(),rows:[{title:'합성 상품',submittedAt:'fixture date',category:'합성 카테고리',barcode:'',sourceQuotation:filename,skuId:'SYNTHETIC-NEW-SKU',status:'상품 검수중',stage:'가격/정책'}]};
 return{identity,key:resultKey(identity),accepted,newer:{...accepted,registration},filename,quotationId};
}
async function observerFixture(company,{entry='app',initial,competing,resultPatch={}}={}){
 const f=facts(company),store=transactionalStore(),scripts=[],writes=[];let competed=false;
 await store.record('put','attempt:123',f.identity);
 if(initial!==undefined)await store.record('put',f.key,initial(f));
 const record=async(action,key,value)=>{
  const result=await store.record(action,key,value);
  if(action==='get'&&key===f.key&&competing&&!competed){competed=true;await competing(f,store,result);}
  if(action!=='get')writes.push({action,key,value,result});return result;
 };
 const tab={id:123,windowId:17,url:'https://supplier.coupang.com/qvt/registration'},api={runtime:{id:'fixture-extension',getURL:name=>'chrome-extension://fixture-extension/'+name},tabs:{query:async()=>[tab],get:async id=>id===123?tab:{id:7,windowId:17,url:f.identity.origin+'/'}},scripting:{executeScript:async({func})=>{
  scripts.push(func.name);
  if(func===verifySupplierHubCompany)return[{result:{code:company.code}}];
  if(func===readSupplierHubValidation)return[{result:{state:'validation-complete',registered:false,filename:f.filename,quotationId:f.quotationId,status:'완료',...resultPatch}}];
  assert.fail('unexpected external action '+func.name);
 }}};
 const request=entry==='app'?{...f.identity,type:'YOOFAM_REFRESH_RESULT',kind:'validation'}:{tabId:123,kind:'validation'},sender=entry==='app'?{frameId:0,url:f.identity.origin+'/',tab:{id:7,windowId:17}}:{id:'fixture-extension',url:'chrome-extension://fixture-extension/popup.html'};
 return{...f,store,scripts,writes,run:()=>observeSupplierHubResult(request,sender,api,record),get competed(){return competed;}};
}

for(const company of companies)for(const entry of ['app','popup'])test(`${company.code}: original ${entry} file refresh cannot erase a SKU CAS committed between snapshot read and file write`,async()=>{
 const h=await observerFixture(company,{entry,initial:f=>f.accepted,competing:async(f,store,snapshot)=>{
  assert.equal(canObserveSupplierHubRegistration(snapshot,f.newer),true);assert.equal(await store.record('register',f.key,{expected:snapshot,observation:f.newer}),true);
 }});
 await assert.rejects(h.run(),/더 최신 전송 결과/);
 assert.equal(h.competed,true);assert.deepEqual(plain(await h.store.record('get',h.key)),h.newer);
 const failed=h.writes.find(write=>write.action==='file-observe');assert.equal(failed.result,false);assert.equal(h.writes.some(write=>write.action==='put'),false);
 assert.deepEqual(plain(await h.store.record('get','attempt:123')),h.identity);
 assert.ok(h.scripts.every(name=>['verifySupplierHubCompany','readSupplierHubValidation'].includes(name)),'no attachment, consent or registration replay');
 assert.ok(h.store.transactions.some(tx=>tx.mode==='readwrite'&&tx.operations.length===1&&tx.operations[0][0]==='get'),'conflicting CAS reads without a write');
});

for(const company of companies)test(`${company.code}: competing ordinary file states win while the stale file observation performs no replacement`,async()=>{
 for(const state of ['validation-pending','validation-rejected']){
  let winning;
  const h=await observerFixture(company,{initial:f=>f.accepted,competing:async(f,store,snapshot)=>{winning={...f.accepted,state,quotationId:'',observedAt:Date.now(),status:'new observation'};assert.equal(await store.record('file-observe',f.key,{expected:snapshot,observation:winning}),true);}});
  await assert.rejects(h.run(),/더 최신 전송 결과/);assert.deepEqual(plain(await h.store.record('get',h.key)),winning);
 }
});

for(const company of companies)test(`${company.code}: current original-tab pending keeps issued SKUs while rejection and not-found retain their previous semantics`,async()=>{
 for(const state of ['validation-pending','validation-rejected','not-found']){
  const h=await observerFixture(company,{initial:f=>state==='not-found'?{...f.accepted,state:'validation-pending',quotationId:''}:f.newer,resultPatch:{state,quotationId:''}});
  if(state==='validation-pending'){
   await assert.rejects(h.run(),/조건부 검증 조회/);assert.deepEqual(plain(await h.store.record('get',h.key)),h.newer);continue;
  }
  assert.equal((await h.run()).state,state);const stored=await h.store.record('get',h.key);
  assert.equal(stored.state,state);assert.equal(stored.company.code,company.code);assert.equal(stored.registration,undefined);
  assert.equal(h.writes.length,1);assert.equal(h.writes[0].action,'file-observe');assert.equal(h.writes[0].result,true);
  assert.ok(h.store.transactions.some(tx=>tx.mode==='readwrite'&&tx.operations.map(op=>op[0]).join(',')==='get,put'),'one transaction performs compare and replace');
 }
});

for(const company of companies)test(`${company.code}: an unchanged accepted original file refresh retains the exact SKU observation and its own clock`,async()=>{
 const h=await observerFixture(company,{initial:f=>f.newer});await h.run();
 const stored=await h.store.record('get',h.key);assert.deepEqual(plain(stored.registration),h.newer.registration);assert.equal(stored.quotationId,h.quotationId);
 assert.equal(stored.registration.observedAt,h.newer.registration.observedAt);assert.equal(h.writes[0].result,true);
});

for(const company of companies)test(`${company.code}: eight concurrent original file CAS requests replace an exact snapshot only once`,async()=>{
 const h=transactionalStore(),f=facts(company);await h.record('put',f.key,f.accepted);
 const candidates=Array.from({length:8},(_,index)=>({...f.accepted,observedAt:Date.now(),detail:'synthetic file refresh '+index})),start=h.transactions.length;
 const outcomes=await Promise.all(candidates.map(observation=>h.record('file-observe',f.key,{expected:f.accepted,observation})));
 assert.equal(outcomes.filter(Boolean).length,1);assert.deepEqual(plain(await h.record('get',f.key)),candidates[outcomes.indexOf(true)]);
 assert.ok(h.transactions.slice(start,start+8).every(tx=>tx.mode==='readwrite'));assert.equal(h.transactions.slice(start,start+8).filter(tx=>tx.operations.some(op=>op[0]==='put')).length,1);
});

test('original file observation CAS cannot create SKU evidence, escape its source key or impersonate read-only recovery',async()=>{
 const h=transactionalStore(),f=facts(companies[0]);await h.record('put',f.key,f.accepted);const before=plain(await h.record('get',f.key)),count=h.transactions.length;
 for(const patch of [{origin:'https://foreign.example'},{company:{code:'A01464742',name:'유앤채'}},{purpose:'validation-status',profileId:'profile',recoveredAt:Date.now()},
  {validationResume:true},{attachmentNames:['wrong.xlsx']},{registration:f.newer.registration},{includedOptions:0},{observedAt:0},{registered:true},{filename:'wrong.xlsx'}]){
  const observation={...f.accepted,...patch};assert.equal(canObserveOriginalSupplierHubValidation(f.accepted,observation),false);await assert.rejects(h.record('file-observe',f.key,{expected:f.accepted,observation}));
 }
 await assert.rejects(h.record('file-observe','attempt:123',{expected:f.accepted,observation:f.accepted}));
 await assert.rejects(h.record('file-observe',f.key,{observation:f.accepted}));assert.equal(h.transactions.length,count,'invalid requests stop before storage');assert.deepEqual(plain(await h.record('get',f.key)),before);
});

test('original file observation CAS restores its exact receipt if a storage transaction aborts',async()=>{
 const h=transactionalStore(),f=facts(companies[1]);await h.record('put',f.key,f.newer);h.failNextPut();
 const observation={...f.newer,observedAt:Date.now(),status:'refreshed'};await assert.rejects(h.record('file-observe',f.key,{expected:f.newer,observation}),/transaction failure/);
 assert.deepEqual(plain(await h.record('get',f.key)),f.newer);
});

test('original legacy file observations retain missing counts and unassigned IDs without inventing accepted receipt evidence',async()=>{
 const h=transactionalStore(),f=facts(companies[0]);
 const legacy={...f.accepted};delete legacy.includedOptions;
 assert.equal(await h.record('file-observe',f.key,{expected:undefined,observation:legacy}),true);
 const first=await h.record('get',f.key);assert.equal(first.includedOptions,undefined);assert.equal(isAcceptedResult(f.identity,first),false);
 const unassigned={...legacy,quotationId:'',observedAt:Date.now()};assert.equal(await h.record('file-observe',f.key,{expected:first,observation:unassigned}),true);
 const second=await h.record('get',f.key);assert.equal(second.quotationId,'');assert.equal(second.includedOptions,undefined);assert.equal(second.registration,undefined);assert.equal(isAcceptedResult(f.identity,second),false);
 const fabricated={...unassigned,registration:{...f.newer.registration,quotationId:'',includedOptions:undefined}};
 assert.equal(canObserveOriginalSupplierHubValidation({...unassigned,registration:fabricated.registration},fabricated),false,'missing assigned ID cannot inherit SKU evidence');
 assert.equal(canObserveOriginalSupplierHubValidation(f.accepted,{...f.accepted,quotationId:'12345678...'}),false,'abbreviated IDs remain unavailable');
 assert.deepEqual(plain(await h.record('get',f.key)),plain(second));
});
