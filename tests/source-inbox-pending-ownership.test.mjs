import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPageSource} from '../extensions/supplier-hub/page-source.mjs';
import {savePageSource,sourceFingerprint} from '../extensions/supplier-hub/source-inbox.mjs';

const app='https://sourceflow.jjwwhhjj1116.workers.dev/';
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
const options={timeoutMs:1000,pollMs:1};
let serial=78800;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let count=0;count<200;count++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,1));}assert.fail('The expected fake Chrome boundary was not reached');}
function snapshot(){
 const offerId='700000000788';
 return extractPageSource({sourceUrl:`https://detail.1688.com/offer/${offerId}.html`,title:'合成原文商品',priceText:'¥5.30',minimumOrderText:'1件起批',scripts:[JSON.stringify({skuModel:{offerId,skuInfoMap:{black:{skuId:'synthetic-788',specAttrs:'黑色',price:'5.30'}}},offerImgList:['https://cbu01.alicdn.com/synthetic-788.jpg']})]});
}
function harness({hold='update',company=companies[0]}={}){
 const windowId=++serial,sourceId=++serial,appId=++serial,tab={id:appId,windowId,url:app},scope={ok:true,ownerId:'owner_788',company:structuredClone(company)};
 const records=new Map(),server=new Map(),calls=[],gate=deferred(),reached=deferred();
 const h={tab,scope,records,server,calls,gate,reached,ready:true};
 h.api={tabs:{
  query:async({windowId:requested})=>{calls.push('query');return tab.windowId===requested?[{...tab}]:[];},
  get:async id=>{assert.equal(id,appId);calls.push('get');return {...tab};},
  create:async()=>assert.fail('An exact retry must not create a replacement receiver'),
  sendMessage:async(id,message,frame)=>{
   assert.equal(id,appId);assert.deepEqual(frame,{frameId:0});calls.push(message.type);
   if(message.type==='YOOFAM_READ_CATALOG_CONTEXT')return h.ready?structuredClone(scope):{ok:false};
   assert.equal(message.type,'YOOFAM_SAVE_SOURCE_CAPTURE');const record=structuredClone(message.record);
   assert.equal(records.has(record.id),true);server.set(record.id,record);
   if(hold==='save'){reached.resolve();await gate.promise;}
   return {ok:true,id:record.id,fingerprint:record.fingerprint,ownerId:record.ownerId,company:record.company};
  },
  update:async(id,input)=>{assert.equal(id,appId);assert.deepEqual(input,{active:true});calls.push('update');if(hold==='update'){reached.resolve();await gate.promise;}return {...tab};},
 }};
 h.store=async(action,value)=>{calls.push('store:'+action);if(action==='list')return [...records.values()].map(row=>structuredClone(row));if(action==='put')records.set(value.id,structuredClone(value));if(action==='delete')records.delete(value);};
 h.sender=data=>({frameId:0,url:data.sourceUrl,tab:{id:sourceId,windowId}});
 h.save=(data,extra={})=>savePageSource({snapshot:data},{...h.sender(data),...extra},h.api,h.store,options);
 h.count=type=>calls.filter(call=>call===type).length;
 return h;
}

for(const company of companies)test(company.code+': exact pending retry shares one immutable same-owner operation and rechecks its scope before returning',async()=>{
 const h=harness({company}),source=snapshot(),immutable=JSON.stringify(source),first=h.save(source);
 await h.reached.promise;assert.equal(h.records.size,0,'the durable ACK already cleared the extension queue');
 const reads=h.count('YOOFAM_READ_CATALOG_CONTEXT'),retry=h.save(structuredClone(source));
 await until(()=>h.count('YOOFAM_READ_CATALOG_CONTEXT')>reads);await turn();h.gate.resolve();
 const [one,two]=await Promise.all([first,retry]);assert.deepEqual(two,one);assert.equal(two.delivered,true);
 assert.equal(h.count('YOOFAM_SAVE_SOURCE_CAPTURE'),1);assert.equal(h.count('store:put'),1);assert.equal(h.count('store:delete'),1);assert.equal(h.count('update'),1);
 const record=h.server.get(one.id);assert.equal(JSON.stringify(record.snapshot),immutable);assert.equal(record.fingerprint,await sourceFingerprint(source));assert.deepEqual(record.company,company);assert.equal(record.ownerId,'owner_788');
 assert.ok(h.count('YOOFAM_READ_CATALOG_CONTEXT')>=reads+2,'a shared result must also pass a current scope read after its pending wait');
});

test('an exact retry during login readiness waits for the original receiver and creates no second operation',async()=>{
 const h=harness({hold:'save'}),source=snapshot();h.ready=false;
 const first=h.save(source);await until(()=>h.count('query')>1);const retry=h.save(structuredClone(source));
 await turn();assert.equal(h.count('store:put'),0);h.ready=true;await h.reached.promise;h.gate.resolve();
 const [one,two]=await Promise.all([first,retry]);assert.deepEqual(two,one);assert.equal(two.delivered,true);assert.equal(h.count('store:put'),1);assert.equal(h.count('YOOFAM_SAVE_SOURCE_CAPTURE'),1);
});

for(const [label,mutate] of [
 ['owner',h=>{h.scope.ownerId='other_owner_788';}],
 ['company',h=>{h.scope.company=structuredClone(companies[1]);}],
 ['app window',h=>{h.tab.windowId++;}],
 ['app origin',h=>{h.tab.url='http://localhost:3000/';}],
 ['app navigation',h=>{h.tab.pendingUrl='https://unrelated.invalid/';}],
])test('a '+label+' change after the durable ACK cannot reuse the old pending success or save for a replacement scope',async()=>{
 const h=harness(),source=snapshot(),first=h.save(source);await h.reached.promise;
 const immutable=JSON.stringify([...h.server.values()]);mutate(h);
 try{
  await assert.rejects(h.save(structuredClone(source)),/변경|로그인/);
  assert.equal(h.count('YOOFAM_SAVE_SOURCE_CAPTURE'),1);assert.equal(h.count('store:put'),1);assert.equal(h.count('store:delete'),1);assert.equal(h.records.size,0);
  assert.equal(JSON.stringify([...h.server.values()]),immutable);assert.ok([...h.server.values()].every(record=>record.ownerId==='owner_788'&&record.company.code===companies[0].code));
 }finally{h.gate.resolve();}
 assert.equal((await first).delivered,true,'the original durable save remains confirmed despite its delayed focus response');
});

for(const [label,mutate] of [
 ['owner',h=>{h.scope.ownerId='other_owner_788';}],
 ['company',h=>{h.scope.company=structuredClone(companies[1]);}],
 ['app window',h=>{h.tab.windowId++;}],
])test('a '+label+' change while an exact retry waits cannot publish a late durable ACK to that retry',async()=>{
 const h=harness(),source=snapshot(),first=h.save(source);await h.reached.promise;
 const reads=h.count('YOOFAM_READ_CATALOG_CONTEXT'),retry=h.save(structuredClone(source));
 await until(()=>h.count('YOOFAM_READ_CATALOG_CONTEXT')>reads);await turn();mutate(h);h.gate.resolve();
 const [one,two]=await Promise.allSettled([first,retry]);assert.equal(one.status,'fulfilled');assert.equal(one.value.delivered,true);assert.equal(two.status,'rejected');assert.match(two.reason.message,/변경|로그인/);
 assert.equal(h.count('YOOFAM_SAVE_SOURCE_CAPTURE'),1);assert.equal(h.count('store:put'),1);assert.equal(h.count('store:delete'),1);assert.equal(h.server.size,1);assert.equal(h.records.size,0);
});

test('an owner change before a late save ACK keeps the original immutable queue and rejects a joined retry',async()=>{
 const h=harness({hold:'save'}),source=snapshot(),first=h.save(source);await h.reached.promise;
 const immutable=JSON.stringify([...h.records.values()]),reads=h.count('YOOFAM_READ_CATALOG_CONTEXT'),retry=h.save(structuredClone(source));
 await until(()=>h.count('YOOFAM_READ_CATALOG_CONTEXT')>reads);await turn();h.scope.ownerId='other_owner_788';h.gate.resolve();
 const [one,two]=await Promise.allSettled([first,retry]);assert.equal(one.status,'fulfilled');assert.equal(one.value.delivered,false);assert.match(one.value.message,/로그인 회사가 변경/);assert.equal(two.status,'rejected');
 assert.equal(JSON.stringify([...h.records.values()]),immutable);assert.equal(h.count('store:put'),1);assert.equal(h.count('store:delete'),0);assert.equal(h.count('YOOFAM_SAVE_SOURCE_CAPTURE'),1);assert.equal(h.count('update'),0);
 assert.ok([...h.server.values()].every(record=>record.ownerId==='owner_788'));
});

test('source-window, offer and fingerprint mismatches stay outside the exact pending operation',async()=>{
 const h=harness(),source=snapshot(),first=h.save(source);await h.reached.promise;
 try{
  await assert.rejects(h.save(structuredClone(source),{tab:{id:h.sender(source).tab.id,windowId:h.tab.windowId+1}}),/이전 상품 수집이 진행 중/);
  const other={...structuredClone(source),sourceUrl:source.sourceUrl.replace('700000000788','700000000789'),offerId:'700000000789'};
  await assert.rejects(h.save(other),/이전 상품 수집이 진행 중/);
  await assert.rejects(h.save({...structuredClone(source),title:'different clicked snapshot'}),/이전 상품 수집이 진행 중/);
  await assert.rejects(h.save(structuredClone(source),{url:other.sourceUrl}),/클릭한 상품과 수집 원문이 다릅니다/);
  assert.equal(h.count('YOOFAM_SAVE_SOURCE_CAPTURE'),1);assert.equal(h.count('store:put'),1);
 }finally{h.gate.resolve();}
 assert.equal((await first).delivered,true);
});
