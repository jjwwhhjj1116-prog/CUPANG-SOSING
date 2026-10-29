import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {savePageSource} from '../extensions/supplier-hub/source-inbox.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {pageCollectorDom} from './helpers/page-collector-dom.mjs';

const sourceUrl='https://detail.1688.com/offer/700000000796.html',offerId='700000000796',origin='http://localhost:3000';
const main='https://cbu01.alicdn.com/synthetic-pending-796.png',detail='https://cbu01.alicdn.com/synthetic-detail-796.png';
const snapshot=(fresh=false)=>({format:'yoofam-page-source-v1',sourceUrl,offerId,collectedAt:new Date(Date.now()-1000+(fresh?1:0)).toISOString(),title:'합성 원문',description:fresh?'새로 수집한 상세 설명':'',
 options:[{key:'black',name:'黑色',supplierSku:'synthetic-black',unitPriceCny:0.28,currency:'CNY',minimumOrder:1,stock:null,imageUrl:main,...(fresh?{packaging:{source:'package-table',weightG:10}}:{})}],
 images:[{url:main,role:'main'},...(fresh?[{url:detail,role:'detail'}]:[])],attributes:fresh?[{name:'材质',value:'海绵'}]:[],
 captureDiagnostics:{format:'yoofam-page-capture-diagnostics-v1',collectorVersion:fresh?'2.1.24':'2.1.23',sections:{tabCount:fresh?2:1,knownTabCount:0,panelCount:0,linkedKnownPanelCount:0,unlinkedKnownTabCount:0},description:fresh?'not-needed':'reference-missing'}});

for(const company of [{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}])test(company.code+': one explicit fresh capture stores version two while the uncertain older snapshot and manual review remain intact',async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const records=new Map(),apiRoute=h.load('app/api/source-inbox/route.ts'),requests=[];let loseAcknowledgement=true;
  const store=async(action,value)=>{if(action==='list')return [...records.values()];if(action==='put')records.set(value.id,structuredClone(value));if(action==='delete')records.delete(value);};
  const tab={id:20,windowId:3,url:origin+'/'},sender={frameId:0,url:sourceUrl,tab:{id:21,windowId:3}},api={tabs:{query:async()=>[tab],get:async()=>tab,update:async()=>tab,sendMessage:async(_id,message)=>{
   if(message.type==='YOOFAM_READ_CATALOG_CONTEXT')return{ok:true,ownerId:'owner',company};
   assert.equal(message.type,'YOOFAM_SAVE_SOURCE_CAPTURE');requests.push(structuredClone(message.record.snapshot));
   const record=message.record,response=await apiRoute.POST(new Request(origin+'/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:record.ownerId,expectedCompany:record.company,id:record.id,fingerprint:record.fingerprint,snapshot:record.snapshot})}));
   assert.equal(response.status,200,await response.clone().text());const body=await response.json();
   if(loseAcknowledgement)throw Error('Synthetic lost acknowledgement');return body;
  }}};
  const old=snapshot(),fresh=snapshot(true),first=await savePageSource({snapshot:old},sender,api,store);assert.equal(first.delivered,false);assert.equal(records.size,1);
  const record=[...records.values()][0],oldRaw=h.sqlite.prepare('SELECT * FROM source_inbox').get();
  const reviewed={...old,title:'직접 검토한 기존 원문'};
  const reviewResponse=await apiRoute.PUT(new Request(origin+'/api/source-inbox',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:'owner',id:record.id,expectedRevision:1,review:{title:reviewed.title,options:old.options.map(({key,name,supplierSku,unitPriceCny,currency,minimumOrder})=>({key,name,supplierSku,unitPriceCny,currency,minimumOrder}))}})}));assert.equal(reviewResponse.status,200);
  const reviewedBefore=JSON.stringify(h.sqlite.prepare('SELECT * FROM source_inbox').get()),productsBefore=JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all());
  loseAcknowledgement=false;
  const second=await savePageSource({snapshot:fresh},sender,api,store);assert.equal(second.delivered,true);assert.equal(second.duplicate,false);assert.equal(second.pendingSnapshotReplayed,undefined);assert.equal(second.newCaptureStored,undefined);assert.notEqual(second.id,record.id);
  assert.equal(requests.length,2,'the fresh click sends one fresh snapshot and does not implicitly retry the old one');assert.deepEqual(requests.at(-1),fresh);assert.equal(records.size,1);assert.deepEqual([...records.values()][0],record);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM source_inbox').get()),reviewedBefore);
  const latest=await h.load('db/source-inbox.ts').findSourceInbox('owner',offerId);assert.equal(latest.captureVersion,2);assert.equal(latest.snapshot.options[0].packaging.weightG,10);assert.equal(latest.snapshot.images.filter(row=>row.role==='detail').length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(latest.snapshot.captureDiagnostics)),fresh.captureDiagnostics);
  assert.equal(h.sqlite.prepare('SELECT payload FROM source_inbox').get().payload,oldRaw.payload);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM source_inbox').get()),reviewedBefore);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all()),productsBefore);
  assert.equal(h.network.length,0);assert.equal(records.size,1);
  const oldRetry=await savePageSource({snapshot:old},sender,api,store);assert.equal(oldRetry.delivered,true);assert.equal(oldRetry.duplicate,true);assert.equal(oldRetry.id,record.id);assert.equal(records.size,0);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM source_inbox').get()),reviewedBefore);assert.equal((await h.load('db/source-inbox.ts').findSourceInbox('owner',offerId)).captureVersion,2);
 }finally{h.close();}
});

test('uncertain fresh and older captures stay separately queued and an exact fresh retry reuses only its own immutable record',async()=>{
 const company={code:'A01464742',name:'와이홉'},records=new Map(),tab={id:30,windowId:4,url:origin+'/'},sender={frameId:0,url:sourceUrl,tab:{id:31,windowId:4}},store=async(action,value)=>{if(action==='list')return [...records.values()];if(action==='put')records.set(value.id,structuredClone(value));if(action==='delete')records.delete(value);};
 const sent=[],api={tabs:{query:async()=>[tab],get:async()=>tab,sendMessage:async(_id,message)=>{if(message.type==='YOOFAM_READ_CATALOG_CONTEXT')return{ok:true,ownerId:'owner',company};sent.push(structuredClone(message.record));throw Error('Synthetic no acknowledgement');}}};
 const old=snapshot(),fresh=snapshot(true);await savePageSource({snapshot:old},sender,api,store);const original=JSON.stringify([...records.values()][0]);
 const first=await savePageSource({snapshot:fresh},sender,api,store);assert.equal(first.delivered,false);assert.equal(first.pendingSnapshotReplayed,undefined);assert.equal(first.newCaptureStored,undefined);assert.equal(records.size,2);assert.equal(JSON.stringify(records.get(sent[0].id)),original);assert.equal(sent.length,2);assert.deepEqual(sent[1].snapshot,fresh);assert.notEqual(sent[0].id,sent[1].id);
 const before=JSON.stringify([...records.values()]),retry=await savePageSource({snapshot:fresh},sender,api,store);assert.equal(retry.delivered,false);assert.equal(retry.id,first.id);assert.equal(records.size,2);assert.equal(JSON.stringify([...records.values()]),before);assert.deepEqual(sent[2],sent[1]);
});

test('a full extension queue preserves every old record, rejects another fresh capture, and still permits an exact pending retry',async()=>{
 const company={code:'A01464742',name:'와이홉'},records=new Map(),tab={id:40,windowId:5,url:origin+'/'},sender={frameId:0,url:sourceUrl,tab:{id:41,windowId:5}},sent=[];let acknowledge=false;
 const store=async(action,value)=>{if(action==='list')return [...records.values()];if(action==='put')records.set(value.id,structuredClone(value));if(action==='delete')records.delete(value);};
 const api={tabs:{query:async()=>[tab],get:async()=>tab,update:async()=>tab,sendMessage:async(_id,message)=>{if(message.type==='YOOFAM_READ_CATALOG_CONTEXT')return{ok:true,ownerId:'owner',company};sent.push(structuredClone(message.record));if(!acknowledge)throw Error('Synthetic unknown save result');return{ok:true,id:message.record.id,fingerprint:message.record.fingerprint,ownerId:'owner',company};}}};
 const old=snapshot(),fresh=snapshot(true),first=await savePageSource({snapshot:old},sender,api,store),original=records.get(first.id);
 for(let index=1;index<40;index++){const record={...structuredClone(original),id:crypto.randomUUID()};records.set(record.id,record);}
 const before=JSON.stringify([...records.values()]);await assert.rejects(savePageSource({snapshot:fresh},sender,api,store),/확장 수집함이 가득/);assert.equal(sent.length,1);assert.equal(JSON.stringify([...records.values()]),before);
 acknowledge=true;const retry=await savePageSource({snapshot:old},sender,api,store);assert.equal(retry.delivered,true);assert.equal(retry.id,first.id);assert.equal(records.size,39);assert.equal(sent.length,2);assert.deepEqual(sent[1],sent[0]);
});

const bundle=await build({entryPoints:[fileURLToPath(new URL('../deployment/extension-page-collector.mjs',import.meta.url))],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120'});
for(const firstDelivered of [true,false])test('button explains retained old snapshot '+(firstDelivered?'acknowledgement':'uncertainty')+' and never recollects without another trusted click',async()=>{
 const messages=[],{elements,document}=pageCollectorDom({title:'합성 원문',scripts:[{textContent:JSON.stringify({skuModel:{offerId,skuInfoMap:{black:{skuId:'synthetic-black',specAttrs:'黑色',price:'0.28'}}},offerImgList:[main]})}],querySelector:selector=>selector==='.price-container'?{textContent:'¥0.28 1双起批'}:null});
 const window={};window.top=window;
 vm.runInNewContext(bundle.outputFiles[0].text,{window,document,location:{href:sourceUrl},URL,Date,Error,TextEncoder,chrome:{runtime:{sendMessage:async message=>{messages.push(message);return messages.length===1?{ok:true,delivered:firstDelivered,duplicate:true,pendingSnapshotReplayed:true,newCaptureStored:false,message:'Synthetic retained capture'}:{ok:true,delivered:true,duplicate:false};}}},fetch(){assert.fail('No product endpoint request');}});
 const button=elements.find(node=>node.tag==='button'),status=elements.find(node=>node.tag==='p');await button.click({isTrusted:true});
 assert.equal(messages.length,1);assert.match(status.textContent,/방금 읽은 새 상품정보는 아직 저장하지 않았습니다/);assert.doesNotMatch(button.textContent,/수집 완료/);
 if(firstDelivered){assert.equal(button.textContent,'현재 상품 다시 수집');assert.match(status.textContent,/한 번 눌러 새 수집본/);}else assert.equal(button.textContent,'앱 전송 다시 시도');
 await button.click({isTrusted:false});assert.equal(messages.length,1);await button.click({isTrusted:true});assert.equal(messages.length,2);assert.equal(button.textContent,'수집 완료');
});
