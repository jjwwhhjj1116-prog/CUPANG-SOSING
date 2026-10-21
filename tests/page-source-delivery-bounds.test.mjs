import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {extractPageSource,validatePageSource,validatePageSourceForDelivery,PAGE_SOURCE_LIMIT} from '../extensions/supplier-hub/page-source.mjs';
import {savePageSource,flushPageSources} from '../extensions/supplier-hub/source-inbox.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {intakeOwnerScopeHarness} from './helpers/intake-owner-scope.mjs';

const sourceUrl='https://detail.1688.com/offer/779000000001.html',offerId='779000000001',origin='http://localhost:3000';
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}],main='https://cbu01.alicdn.com/synthetic-step779-main.png';
const bytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
function input({variants=1,details=0,images=false,dense=false,description=''}={}){
 return {sourceUrl,title:'合成审计商品',description,priceText:'¥1.00',detailImages:Array.from({length:details},(_,index)=>`https://cbu01.alicdn.com/synthetic-step779-detail-${index}.png`),
  scripts:[JSON.stringify({offerId,subject:'合成审计商品',skuModel:{offerId,skuInfoMap:Object.fromEntries(Array.from({length:variants},(_,index)=>['synthetic-'+index,
   {skuId:'synthetic-'+index,specAttrs:dense?'汉'.repeat(497)+String(index).padStart(3,'0'):'合成选项 '+index,price:'1.00',...(images?{imageUrl:`https://cbu01.alicdn.com/synthetic-step779-option-${index}.png`}:{})}]))},
   ...(dense?{propsList:Array.from({length:50},(_,index)=>({name:'synthetic-'+index,value:'汉'.repeat(1000)}))}:{}),offerImgList:[main]})]};
}
function boundary(extra=0){
 const base=extractPageSource(input({variants:200,dense:true})),remaining=PAGE_SOURCE_LIMIT-bytes(base)-4000+extra;
 assert.ok(remaining>0);const description='🧪'.repeat(1000)+'汉'.repeat(Math.floor(remaining/3))+'x'.repeat(remaining%3);
 assert.ok(description.length<=20000);const source=validatePageSource({...base,description});assert.equal(bytes(source),PAGE_SOURCE_LIMIT+extra);return source;
}
const request=body=>new Request(origin+'/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

test('new extraction rejects the reproduced Chinese-heavy source before an undeliverable capture can be reported',()=>{
 assert.throws(()=>extractPageSource(input({variants:200,dense:true,description:'汉'.repeat(20000)})),/UTF-8.*512KB.*524,288/);
});

test('UTF-8 boundary counts Chinese and emoji bytes exactly while legacy validation remains readable',()=>{
 const exact=boundary(),over=boundary(1);assert.ok(exact.description.includes('🧪'));assert.ok(JSON.stringify(exact).length<PAGE_SOURCE_LIMIT);
 assert.deepEqual(validatePageSourceForDelivery(exact),exact);assert.deepEqual(validatePageSource(over),over,'legacy stored char-bounded records still decode');
 assert.throws(()=>validatePageSourceForDelivery(over),/UTF-8.*512KB/);
 assert.deepEqual(JSON.parse(JSON.stringify(exact)),exact,'no split surrogate or Unicode content loss');
});

for(const company of companies)test(company.code+': exact UTF-8 source saves through the real API; one extra byte is rejected without changing stored data',async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const api=h.load('app/api/source-inbox/route.ts'),source=boundary(),fingerprint=await h.load('app/source-inbox.ts').pageSourceFingerprint(source),id='77900000-0000-4000-8000-000000000001';
  const first=await api.POST(request({expectedOwnerId:'owner',expectedCompany:company,id,fingerprint,snapshot:source}));assert.equal(first.status,200,await first.clone().text());
  const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM source_inbox').all()),over=boundary(1),nextFingerprint=await h.load('app/source-inbox.ts').pageSourceFingerprint(over);
  const rejected=await api.POST(request({expectedOwnerId:'owner',expectedCompany:company,id:'77900000-0000-4000-8000-000000000002',fingerprint:nextFingerprint,snapshot:over}));assert.equal(rejected.status,400);assert.match((await rejected.json()).error,/UTF-8.*512KB/);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM source_inbox').all()),before);assert.equal(h.network.length,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);
 }finally{h.close();}
});

test('legacy stored oversized source is still decoded and listed unchanged; a new review cannot create an oversized delivery',async()=>{
 const h=mobileIntakeHarness();try{
  const source=boundary(1),fingerprint=await h.load('app/source-inbox.ts').pageSourceFingerprint(source),id='77900000-0000-4000-8000-000000000003';
  await h.load('db/source-inbox.ts').storeSourceInbox('owner',companies[0],id,fingerprint,source);
  const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM source_inbox').all()),stored=await h.load('db/source-inbox.ts').readSourceInbox('owner',id);
  assert.deepEqual(JSON.parse(JSON.stringify(stored.snapshot)),source);const response=await h.load('app/api/source-inbox/route.ts').GET();assert.equal(response.status,200);const listed=(await response.json()).items[0];assert.equal(listed.fingerprint,fingerprint);assert.deepEqual(listed.issues,[],'legacy byte-size alone is not a new read-only issue');
  const review={title:source.title,options:source.options.map(row=>({key:row.key,name:row.name,supplierSku:row.supplierSku,unitPriceCny:row.unitPriceCny,currency:row.currency,minimumOrder:row.minimumOrder}))};
  assert.throws(()=>h.load('app/source-inbox.ts').reviewPageSource(source,review),/UTF-8.*512KB/);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM source_inbox').all()),before);assert.equal(h.network.length,0);
 }finally{h.close();}
});

test('new saves and retained deliveries apply the same byte bound without editing or deleting an old immutable queue record',async()=>{
 const snapshot=boundary(1),fingerprint=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(snapshot)))).toString('hex');
 const record={id:'77900000-0000-4000-8000-000000000004',ownerId:'owner',company:companies[0],origin,windowId:3,snapshot,fingerprint},before=JSON.stringify(record),writes=[];
 const tab={id:20,windowId:3,url:origin+'/'},api={tabs:{get:async()=>tab,sendMessage:async(_id,message)=>{assert.equal(message.type,'YOOFAM_READ_CATALOG_CONTEXT','oversize delivery never posts a source capture');return {ok:true,ownerId:'owner',company:companies[0]};}}};
 const store=async(action,value)=>{if(action==='list')return [record];writes.push({action,value});};
 const result=await flushPageSources({}, {frameId:0,url:tab.url,tab},api,store);assert.equal(result.delivered,0);assert.equal(result.pending,1);assert.match(result.errors[0],/UTF-8.*512KB/);assert.equal(JSON.stringify(record),before);assert.deepEqual(writes,[]);
 await assert.rejects(savePageSource({snapshot},{frameId:0,url:sourceUrl,tab:{id:21,windowId:3}},api,store),/UTF-8.*512KB/);assert.deepEqual(writes,[]);
});

test('200 captured images retain every matched SKU image and exact source index through promotion',()=>{
 const snapshot=extractPageSource(input({variants:198,details:1,images:true}));assert.equal(snapshot.images.length,200);assert.equal(snapshot.options.length,198);
 const h=mobileIntakeHarness();try{
  const result=h.load('app/source-inbox.ts').pageSourceCollectionResult(snapshot);
  for(let index=0;index<snapshot.options.length;index++){assert.equal(result.options[index].sku,'synthetic-'+index);assert.equal(result.images[result.options[index].imageIndex].url,snapshot.options[index].imageUrl);}
  assert.deepEqual(validatePageSourceForDelivery(snapshot),snapshot);assert.equal(h.network.length,0);
 }finally{h.close();}
});

test('201 image overflow rejects explicitly instead of silently losing an observed SKU image',()=>{
 assert.throws(()=>extractPageSource(input({variants:1,details:199,images:true})),/200개.*옵션 이미지.*일부만 담지/);
 assert.throws(()=>extractPageSource(input({variants:199,details:1,images:true})),/200개.*옵션 이미지.*일부만 담지/);
});

test('new deliveries reject a missing option image while legacy image snapshots remain readable',()=>{
 const source=extractPageSource(input({variants:1,images:true})),missing={...source,images:source.images.filter(row=>row.url===main)};
 assert.deepEqual(validatePageSource(missing),missing);assert.throws(()=>validatePageSourceForDelivery(missing),/옵션 이미지.*원본 이미지 목록/);
});

for(const company of companies)test(company.code+': historical missing option image is a read-only issue and blocks new intake without changing saved rows',async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});let ui;
 try{
  const complete=extractPageSource(input({variants:1,images:true})),legacy=validatePageSource({...complete,images:complete.images.filter(row=>row.url===main)});
  const id='77900000-0000-4000-8000-000000000009',fingerprint=await h.load('app/source-inbox.ts').pageSourceFingerprint(legacy);
  await h.load('db/source-inbox.ts').storeSourceInbox('owner',company,id,fingerprint,legacy);const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM source_inbox').all());
  const listed=await h.load('app/api/source-inbox/route.ts').GET();assert.equal(listed.status,200);const item=(await listed.json()).items[0];
  assert.deepEqual(item.snapshot,legacy);assert.deepEqual(item.issues,['옵션 이미지 원본 연결']);assert.deepEqual(validatePageSource(legacy),legacy);
  const ready=await h.load('app/api/source-inbox/ready/route.ts').GET(new Request(origin+'/api/source-inbox/ready?'+new URLSearchParams({sourceUrl,captureId:id,fingerprint,revision:'1'})));
  assert.equal(ready.status,409);assert.equal((await ready.json()).code,'PAGE_SOURCE_REVIEW_REQUIRED');
  assert.throws(()=>h.load('app/source-inbox.ts').pageSourceCollectionResult(item.snapshot),/옵션 이미지 원본 연결/);
  await assert.rejects(h.load('app/owned-page-capture.ts').parseOwnedPageCapture('owner',{sourceUrl,format:'yoofam-saved-page-capture-v1',captureId:id,fingerprint,revision:1},sourceUrl),/옵션 이미지 원본 연결/);
  const componentSource=fs.readFileSync(new URL('../app/components/intake-queue-panel.tsx',import.meta.url),'utf8').replace('sourceItems=[]','sourceItems='+JSON.stringify([item]));
  ui=intakeOwnerScopeHarness({owner:'owner',code:company.code,name:company.name},{componentSource});
  ui.setRows([{...ui.rows[0],url:sourceUrl,sourceCapture:{sourceUrl,format:'yoofam-saved-page-capture-v1',captureId:id,fingerprint,revision:1}}]);
  const rows=JSON.stringify(ui.rows);ui.button('이 상품 초안 작성').props.onClick();await ui.settle();
  assert.equal(ui.posts.length,0);assert.equal(ui.collections.length,0);assert.equal(ui.opened.length,0);assert.equal(JSON.stringify(ui.rows),rows);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM source_inbox').all()),before);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);assert.equal(h.network.length,0);
 }finally{ui?.close();h.close();}
});

test('ordinary 13-SKU source keeps all prices, identities and images unchanged',()=>{
 const source=extractPageSource(input({variants:13,details:3,images:true}));assert.equal(source.options.length,13);assert.equal(source.images.length,17);
 assert.deepEqual(validatePageSourceForDelivery(source),source);assert.ok(source.options.every((row,index)=>row.supplierSku==='synthetic-'+index&&row.unitPriceCny===1&&source.images.some(image=>image.url===row.imageUrl)));
});
