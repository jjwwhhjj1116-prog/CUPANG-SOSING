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

for(const company of [{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}])test(company.code+': old pending save is truthfully acknowledged; only another explicit collection stores fresh version two',async()=>{
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
  const replay=await savePageSource({snapshot:fresh},sender,api,store);assert.equal(replay.delivered,true);assert.equal(replay.pendingSnapshotReplayed,true);assert.equal(replay.newCaptureStored,false);assert.equal(replay.duplicate,true);
  assert.equal(records.size,0);assert.deepEqual(requests.at(-1),old);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM source_inbox_captures').get().n,0);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM source_inbox').get()),reviewedBefore);
  const second=await savePageSource({snapshot:fresh},sender,api,store);assert.equal(second.delivered,true);assert.equal(second.duplicate,false);assert.equal(second.pendingSnapshotReplayed,undefined);assert.notEqual(second.id,record.id);
  const latest=await h.load('db/source-inbox.ts').findSourceInbox('owner',offerId);assert.equal(latest.captureVersion,2);assert.equal(latest.snapshot.options[0].packaging.weightG,10);assert.equal(latest.snapshot.images.filter(row=>row.role==='detail').length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(latest.snapshot.captureDiagnostics)),fresh.captureDiagnostics);
  assert.equal(h.sqlite.prepare('SELECT payload FROM source_inbox').get().payload,oldRaw.payload);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM source_inbox').get()),reviewedBefore);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM products').all()),productsBefore);
  assert.equal(h.network.length,0);assert.equal(records.size,0);
 }finally{h.close();}
});

test('an uncertain old pending replay remains queued and never claims the current capture was saved',async()=>{
 const company={code:'A01464742',name:'와이홉'},records=new Map(),tab={id:30,windowId:4,url:origin+'/'},sender={frameId:0,url:sourceUrl,tab:{id:31,windowId:4}},store=async(action,value)=>{if(action==='list')return [...records.values()];if(action==='put')records.set(value.id,structuredClone(value));if(action==='delete')records.delete(value);};
 const sent=[],api={tabs:{query:async()=>[tab],get:async()=>tab,sendMessage:async(_id,message)=>{if(message.type==='YOOFAM_READ_CATALOG_CONTEXT')return{ok:true,ownerId:'owner',company};sent.push(message.record.snapshot);throw Error('Synthetic no acknowledgement');}}};
 await savePageSource({snapshot:snapshot()},sender,api,store);const original=JSON.stringify([...records.values()][0]);
 const replay=await savePageSource({snapshot:snapshot(true)},sender,api,store);assert.equal(replay.delivered,false);assert.equal(replay.pendingSnapshotReplayed,true);assert.equal(replay.newCaptureStored,false);assert.equal(JSON.stringify([...records.values()][0]),original);assert.equal(sent.length,2);assert.deepEqual(sent[0],sent[1]);
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
