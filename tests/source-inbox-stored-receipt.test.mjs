import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {savePageSource,sourceFingerprint} from '../extensions/supplier-hub/source-inbox.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const origin='http://localhost:3000',sourceUrl='https://detail.1688.com/offer/700000000802.html',offerId='700000000802';
const companyList=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const sourceTime=Date.now()-10000;
const source=(index=1)=>({format:'yoofam-page-source-v1',sourceUrl,offerId,collectedAt:new Date(sourceTime+index).toISOString(),title:'합성 수집본',description:'',attributes:[],
 options:[{key:'black',name:'黑色',supplierSku:'synthetic-black',unitPriceCny:0.28,currency:'CNY',minimumOrder:1,stock:1,imageUrl:null}],images:[{url:'https://cbu01.alicdn.com/synthetic-stored-receipt.png',role:'main'}]});
let nextWindow=80200;
function harness(company=companyList[0]){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name}),route=h.load('app/api/source-inbox/route.ts'),records=new Map(),notifications=[],sends=[],windowId=++nextWindow;
 const tab={id:++nextWindow,windowId,url:origin+'/',active:true},sender={frameId:0,url:sourceUrl,tab:{id:++nextWindow,windowId}};
 const x={h,route,records,notifications,sends,company,transformServer:null,transformApp:null,loseAcknowledgement:false};
 const fetchApp=async(path,init)=>{
  let response;
  if(path==='/api/supplier-hub/catalog-context')response=Response.json({ownerId:'owner',company});
  else{
   assert.equal(path,'/api/source-inbox');assert.equal(init.method,'POST');
   response=await route.POST(new Request(origin+path,init));
   if(x.transformServer&&response.ok)response=Response.json(x.transformServer(await response.json()));
  }
  Object.defineProperty(response,'url',{value:origin+path});return response;
 };
 const context={window:{addEventListener(){},postMessage(message,target){assert.equal(target,origin);notifications.push(structuredClone(message));}},location:{origin},
  chrome:{runtime:{onMessage:{addListener(){}}}},fetch:fetchApp,URL,Date,Error,Response,AbortController,setTimeout,clearTimeout,TextEncoder,crypto:webcrypto};
 vm.runInNewContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8'),context);
 const api={tabs:{query:async()=>[tab],get:async()=>tab,update:async()=>tab,sendMessage:async(_id,message)=>{
  if(message.type==='YOOFAM_READ_CATALOG_CONTEXT')return{ok:true,ownerId:'owner',company};
  assert.equal(message.type,'YOOFAM_SAVE_SOURCE_CAPTURE');sends.push(structuredClone(message.record));
  const result=await context.savePageSourceInApp(message.record);if(x.loseAcknowledgement)throw Error('Synthetic lost app acknowledgement');
  return x.transformApp?x.transformApp(result):result;
 }}};
 const store=async(action,value)=>{if(action==='list')return [...records.values()].map(item=>structuredClone(item));if(action==='put')records.set(value.id,structuredClone(value));if(action==='delete')records.delete(value);};
 x.save=snapshot=>savePageSource({snapshot},sender,api,store,{timeoutMs:1000,pollMs:1});
 x.post=async(snapshot,id)=>{const fingerprint=await sourceFingerprint(snapshot),response=await route.POST(new Request(origin+'/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:'owner',expectedCompany:company,id,fingerprint,snapshot})}));assert.equal(response.status,200,await response.clone().text());return response.json();};
 x.count=()=>h.sqlite.prepare('SELECT (SELECT count(*) FROM source_inbox)+(SELECT count(*) FROM source_inbox_captures) n').get().n;
 return x;
}
const clone=value=>JSON.parse(JSON.stringify(value));
for(const company of companyList)test(company.code+': real API → classic app bridge → worker conveys the actual stored version/time; idempotent alias ACK points to storedId rather than request ID',async()=>{
 const x=harness(company);try{
  const snapshot=source(),storedId='00000000-0000-4000-8000-000000000802',first=await x.post(snapshot,storedId),before=x.h.sqlite.prepare('SELECT * FROM source_inbox').get();
  assert.equal(first.sourceUrl,sourceUrl);assert.equal(first.collectedAt,snapshot.collectedAt);assert.equal(first.receivedAt,before.received_at);
  const result=await x.save(snapshot);assert.equal(result.delivered,true);assert.equal(result.duplicate,true);assert.notEqual(result.id,storedId);
  assert.deepEqual(clone(result.storedReceipt),{ownerId:'owner',company,sourceUrl,fingerprint:first.fingerprint,storedId,captureVersion:1,receivedAt:before.received_at,collectedAt:snapshot.collectedAt});
  assert.equal(result.ownerId,'owner');assert.deepEqual(clone(result.company),company);assert.equal(result.fingerprint,first.fingerprint);assert.equal(x.records.size,0);assert.equal(x.count(),1);
  assert.deepEqual(x.h.sqlite.prepare('SELECT * FROM source_inbox').get(),before,'duplicate diagnostics cannot change the retained source or time');
  const fresh=source(2),second=await x.save(fresh);assert.equal(second.duplicate,false);assert.equal(second.storedReceipt.storedId,second.id);assert.equal(second.storedReceipt.captureVersion,2);assert.equal(second.storedReceipt.collectedAt,fresh.collectedAt);assert.notEqual(second.storedReceipt.fingerprint,first.fingerprint);
  assert.equal(x.count(),2);assert.deepEqual(x.h.sqlite.prepare('SELECT * FROM source_inbox').get(),before);assert.equal(x.h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);assert.equal(x.h.network.length,0);
 }finally{x.h.close();}
});

test('an old pending replay reports the retained snapshot receipt, never the newly read capture time, and stores fresh facts only on another explicit click',async()=>{
 const x=harness();try{
  const old=source(),fresh=source(2);x.loseAcknowledgement=true;
  assert.equal((await x.save(old)).delivered,false);const before=x.h.sqlite.prepare('SELECT * FROM source_inbox').get();assert.equal(x.records.size,1);
  x.loseAcknowledgement=false;const replay=await x.save(fresh);assert.equal(replay.delivered,true);assert.equal(replay.pendingSnapshotReplayed,true);assert.equal(replay.newCaptureStored,false);
  assert.equal(replay.storedReceipt.collectedAt,old.collectedAt);assert.notEqual(replay.storedReceipt.collectedAt,fresh.collectedAt);assert.equal(replay.storedReceipt.receivedAt,before.received_at);assert.equal(replay.storedReceipt.storedId,before.id);assert.equal(replay.storedReceipt.captureVersion,1);assert.equal(x.count(),1);
  const actualFresh=await x.save(fresh);assert.equal(actualFresh.storedReceipt.captureVersion,2);assert.equal(actualFresh.storedReceipt.collectedAt,fresh.collectedAt);assert.equal(x.count(),2);assert.equal(x.records.size,0);
 }finally{x.h.close();}
});

const badServerCases=[
 ['partial new fields',body=>{delete body.collectedAt;return body;}],
 ['wrong stored fingerprint',body=>({...body,storedFingerprint:'0'.repeat(64)})],
 ['invalid stored ID',body=>({...body,storedId:'not-a-source-id'})],
 ['invalid version',body=>({...body,captureVersion:0})],
 ['different source',body=>({...body,sourceUrl:sourceUrl.replace(offerId,'700000000803')})],
 ['noncanonical source',body=>({...body,sourceUrl:sourceUrl+'?spm=unbound'})],
 ['different collection time',body=>({...body,collectedAt:source(9).collectedAt})],
 ['future receive time',body=>({...body,receivedAt:new Date(Date.now()+120000).toISOString()})],
 ['rolled-over calendar date',body=>({...body,receivedAt:'2025-02-31T00:00:00.000Z'})],
 ['receive predates capture beyond permitted clock skew',body=>({...body,receivedAt:new Date(sourceTime-120000).toISOString()})],
];
for(const [label,mutate] of badServerCases)test('advertised server receipt rejects '+label+' without clearing the immutable pending record or posting an update',async()=>{
 const x=harness();try{
  x.transformServer=mutate;const result=await x.save(source());assert.equal(result.delivered,false);assert.equal(result.storedReceipt,undefined);assert.equal(x.records.size,1);assert.equal(x.notifications.length,0);assert.equal(x.count(),1,'the uncertain saved row is retained, without another retry');assert.equal(x.sends.length,1);
 }finally{x.h.close();}
});

const badAppCases=[
 ['null receipt',result=>({...result,storedReceipt:null})],
 ['partial receipt',result=>{delete result.storedReceipt.receivedAt;return result;}],
 ['extra receipt fields',result=>{result.storedReceipt.privateField='never forward';return result;}],
 ['other owner',result=>{result.storedReceipt.ownerId='foreign';return result;}],
 ['other company',result=>{result.storedReceipt.company=companyList[1];return result;}],
 ['different fingerprint',result=>{result.storedReceipt.fingerprint='0'.repeat(64);return result;}],
 ['different collection time',result=>{result.storedReceipt.collectedAt=source(9).collectedAt;return result;}],
];
for(const [label,mutate] of badAppCases)test('worker independently rejects '+label+' from an advertised app receipt and retains pending source',async()=>{
 const x=harness();try{
  x.transformApp=mutate;const result=await x.save(source());assert.equal(result.delivered,false);assert.equal(result.storedReceipt,undefined);assert.equal(x.records.size,1);assert.equal(x.sends.length,1);assert.equal(x.count(),1);
 }finally{x.h.close();}
});

for(const legacy of ['server','app'])test('a matching legacy '+legacy+' ACK remains compatible without manufacturing a receipt from request values or local time',async()=>{
 const x=harness();try{
  if(legacy==='server')x.transformServer=body=>{for(const key of ['receivedAt','collectedAt','sourceUrl'])delete body[key];return body;};
  else x.transformApp=body=>{delete body.storedReceipt;return body;};
  const result=await x.save(source());assert.equal(result.delivered,true);assert.equal(Object.hasOwn(result,'storedReceipt'),false);assert.equal(x.records.size,0);assert.equal(x.count(),1);assert.equal(x.sends.length,1);
 }finally{x.h.close();}
});
