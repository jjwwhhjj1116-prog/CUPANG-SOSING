import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {validatePageSource,validatePageSourceForDelivery,validatePageSourceCaptureDiagnostics,PAGE_SOURCE_LIMIT} from '../extensions/supplier-hub/page-source.mjs';
import {savePageSource,sourceFingerprint} from '../extensions/supplier-hub/source-inbox.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {pageCollectorDom} from './helpers/page-collector-dom.mjs';

const sourceUrl='https://detail.1688.com/offer/700000000808.html',offerId='700000000808',origin='http://localhost:3000';
const main='https://cbu01.alicdn.com/synthetic-diagnostics-808.png';
const diagnostics=()=>({format:'yoofam-page-capture-diagnostics-v1',collectorVersion:'2.1.23',sections:{tabCount:8,knownTabCount:3,panelCount:2,linkedKnownPanelCount:2,unlinkedKnownTabCount:1},bodyTitles:{attributes:1,packaging:2,detail:3},description:'reference-missing'});
const source=()=>({format:'yoofam-page-source-v1',sourceUrl,offerId,collectedAt:new Date(Date.now()-1000).toISOString(),title:'합성 수집 진단',description:'',
 options:[{key:'black',name:'黑色',supplierSku:'synthetic-black',unitPriceCny:0.28,currency:'CNY',minimumOrder:1,stock:null,imageUrl:null}],images:[{url:main,role:'main'}],attributes:[]});
const bytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8');

test('legacy snapshots remain byte-identical and new diagnostics participate in the existing immutable fingerprint',async()=>{
 const legacy=source(),before=JSON.stringify(legacy),fingerprint=await sourceFingerprint(legacy);
 assert.deepEqual(validatePageSourceForDelivery(legacy),legacy);assert.equal(JSON.stringify(validatePageSource(legacy)),before);
 const enriched={...legacy,captureDiagnostics:diagnostics()};assert.deepEqual(validatePageSourceForDelivery(enriched),enriched);
 assert.notEqual(await sourceFingerprint(enriched),fingerprint);assert.equal(await sourceFingerprint(legacy),fingerprint);
 assert.equal(JSON.stringify(legacy),before);
});

test('only bounded counts, the injected version and fixed description reasons survive diagnostic validation',()=>{
 for(const description of ['not-needed','reference-missing','reference-invalid','unavailable','captured']){
  const value={...diagnostics(),description},before=JSON.stringify(value),accepted=validatePageSourceCaptureDiagnostics(value);
  assert.deepEqual(accepted,value);assert.notEqual(accepted,value);assert.equal(JSON.stringify(value),before);
 }
 const value=diagnostics();delete value.bodyTitles;
 assert.equal(Object.hasOwn(validatePageSourceCaptureDiagnostics(value),'bodyTitles'),false,'unmeasured counts stay absent');
});

test('unknown fields, page text, URLs, oversized versions, unsafe counts and inconsistent diagnostic relations are rejected',()=>{
 const changes=[v=>v.extra='secret',v=>v.format='other',v=>v.collectorVersion='x'.repeat(10000),v=>v.collectorVersion='2.1.23 https://private.test',
  v=>v.description='raw supplier response',v=>v.sections.pageText='private text',v=>v.bodyTitles.url='https://private.test',
  v=>v.sections.tabCount=301,v=>v.sections.panelCount=301,v=>v.sections.knownTabCount=31,v=>v.sections.linkedKnownPanelCount=-1,
  v=>v.sections.unlinkedKnownTabCount=0.5,v=>v.sections.tabCount='8',v=>v.sections.tabCount=NaN,v=>v.sections.panelCount=Infinity,
  v=>v.sections.tabCount=2,v=>v.sections.panelCount=1,v=>v.sections.unlinkedKnownTabCount=0,
  v=>v.bodyTitles.attributes=61,v=>v.bodyTitles={attributes:30,packaging:30,detail:1},v=>v.bodyTitles=null,v=>delete v.sections.panelCount];
 for(const change of changes){const value=diagnostics();change(value);assert.throws(()=>validatePageSourceCaptureDiagnostics(value),/수집 진단/);assert.throws(()=>validatePageSource({...source(),captureDiagnostics:value}));}
 for(const value of [null,undefined,[],true,'private text'])assert.throws(()=>validatePageSource({...source(),captureDiagnostics:value}),/수집 진단/);
 let reads=0;const accessor=diagnostics();Object.defineProperty(accessor,'collectorVersion',{enumerable:true,get(){reads++;return '2.1.23';}});
 assert.throws(()=>validatePageSourceCaptureDiagnostics(accessor),/수집 진단/);assert.equal(reads,0);
});

test('diagnostic bytes remain within the existing UTF-8 delivery limit rather than dropping product data',()=>{
 const value=source();value.captureDiagnostics=diagnostics();
 value.options=Array.from({length:200},(_,index)=>({...value.options[0],key:String(index),name:'汉'.repeat(500)}));
 value.attributes=Array.from({length:50},(_,index)=>({name:String(index),value:'汉'.repeat(1000)}));
 const remaining=PAGE_SOURCE_LIMIT-bytes(value);assert.ok(remaining>0&&remaining/3<20000);
 value.description='汉'.repeat(Math.floor(remaining/3))+'x'.repeat(remaining%3);
 assert.equal(bytes(value),PAGE_SOURCE_LIMIT);assert.deepEqual(validatePageSourceForDelivery(value),value);
 assert.throws(()=>validatePageSourceForDelivery({...value,description:value.description+'x'}),/UTF-8.*512KB/);
});

const bundle=await build({entryPoints:['deployment/extension-page-collector.mjs'],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120'});
async function collect(h,company){
 const route=h.load('app/api/source-inbox/route.ts'),records=new Map(),messages=[],receipts=[];
 const store=async(action,value)=>{if(action==='list')return [...records.values()];if(action==='put')records.set(value.id,structuredClone(value));if(action==='delete')records.delete(value);};
 const tab={id:20,windowId:3,url:origin+'/'},api={tabs:{query:async()=>[tab],get:async()=>tab,update:async()=>tab,sendMessage:async(_id,message)=>{
  if(message.type==='YOOFAM_READ_CATALOG_CONTEXT')return{ok:true,ownerId:'owner',company};
  assert.equal(message.type,'YOOFAM_SAVE_SOURCE_CAPTURE');const record=message.record;
  const response=await route.POST(new Request(origin+'/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:record.ownerId,expectedCompany:record.company,id:record.id,fingerprint:record.fingerprint,snapshot:record.snapshot})}));
  assert.equal(response.status,200,await response.clone().text());const receipt=await response.json();receipts.push(receipt);return receipt;
 }}};
 const data={offerId,subject:'합성 수집 진단',skuModel:{offerId,skuInfoMap:{black:{skuId:'synthetic-black',specAttrs:'黑色',price:'0.28'}}},offerImgList:[main]};
 const {elements,document}=pageCollectorDom({scripts:[{textContent:JSON.stringify(data)}],querySelector:selector=>selector==='.price-container'?{textContent:'¥0.28 1件起批'}:null}),window={};window.top=window;
 vm.runInNewContext(bundle.outputFiles[0].text,{window,document,location:{href:sourceUrl},URL,Date,Error,TextEncoder,chrome:{runtime:{getManifest(){assert.fail('An extension manifest is not the running collector version');},sendMessage:message=>{
  assert.equal(message.type,'YOOFAM_SAVE_PAGE_SOURCE');messages.push(structuredClone(message));return savePageSource(message,{frameId:0,url:sourceUrl,tab:{id:21,windowId:3}},api,store);
 }}},fetch(){assert.fail('Diagnostic collection cannot add a network read');}});
 const button=elements.find(node=>node.tag==='button');await button.click({isTrusted:false});assert.equal(messages.length,0);await button.click({isTrusted:true});
 assert.equal(button.textContent,'수집 완료');assert.equal(messages.length,1);assert.equal(receipts.length,1);assert.equal(records.size,0);
 return {snapshot:messages[0].snapshot,receipt:receipts[0],route};
}

for(const company of [{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}])test(`${company.code}: trusted collector diagnostics survive worker fingerprint, real inbox storage, listing and separate review without product writes`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const productsBefore=JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all()),{snapshot,receipt,route}=await collect(h,company);
  assert.match(snapshot.captureDiagnostics.collectorVersion,/^\d+\.\d+\.\d+$/);assert.equal(snapshot.captureDiagnostics.description,'reference-missing');
  assert.deepEqual(snapshot.captureDiagnostics.sections,{tabCount:0,knownTabCount:0,panelCount:0,linkedKnownPanelCount:0,unlinkedKnownTabCount:0});
  const raw=h.sqlite.prepare('SELECT payload FROM source_inbox').get().payload;assert.deepEqual(JSON.parse(raw),snapshot);
  assert.equal(receipt.fingerprint,await sourceFingerprint(snapshot));const listed=await(await route.GET()).json();assert.deepEqual(listed.items[0].snapshot,snapshot);
  const review={title:'직접 검토한 상품',options:snapshot.options.map(({key,name,supplierSku,unitPriceCny,currency,minimumOrder})=>({key,name,supplierSku,unitPriceCny,currency,minimumOrder}))};
  const request=(method,body)=>new Request(origin+'/api/source-inbox',{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const rejected=await route.PUT(request('PUT',{expectedOwnerId:'owner',id:receipt.id,expectedRevision:1,review:{...review,captureDiagnostics:diagnostics()}}));assert.equal(rejected.status,422);
  const saved=await route.PUT(request('PUT',{expectedOwnerId:'owner',id:receipt.id,expectedRevision:1,review}));assert.equal(saved.status,200);const item=(await saved.json()).item;
  assert.deepEqual(item.snapshot,snapshot);assert.deepEqual(item.reviewed.captureDiagnostics,snapshot.captureDiagnostics);assert.equal(h.sqlite.prepare('SELECT payload FROM source_inbox').get().payload,raw);
  const post={expectedOwnerId:'owner',expectedCompany:company,id:receipt.id,fingerprint:receipt.fingerprint,snapshot};
  const retry=await route.POST(request('POST',post));assert.equal(retry.status,200);assert.equal((await retry.json()).duplicate,true);
  const changed={...snapshot,captureDiagnostics:{...snapshot.captureDiagnostics,collectorVersion:'9.9.9'}};
  assert.equal((await route.POST(request('POST',{...post,snapshot:changed}))).status,400,'diagnostic tampering cannot reuse the old fingerprint');
  assert.equal((await route.POST(request('POST',{...post,snapshot:changed,fingerprint:await sourceFingerprint(changed)}))).status,409,'the original capture ID cannot be rewritten');
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM source_inbox_captures').get().n,0);assert.equal(h.sqlite.prepare('SELECT payload FROM source_inbox').get().payload,raw);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all()),productsBefore);assert.equal(h.network.length,0);
 }finally{h.close();}
});
