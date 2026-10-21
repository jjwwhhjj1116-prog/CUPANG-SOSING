import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {readPageSourceElementImage} from '../extensions/supplier-hub/page-source.mjs';
import {savePageSource} from '../extensions/supplier-hub/source-inbox.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

// The shipped generated button runs against an inert current-document adapter.
// It cannot execute supplier scripts, read an iframe, or request any resource.
const bundle=fs.readFileSync(new URL('../extensions/supplier-hub/page-collector.js',import.meta.url),'utf8');
const offerId='700000000769',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const cdn=name=>`https://cbu01.alicdn.com/synthetic-step769-${name}.jpg`;
const placeholder='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const image=(attributes={},currentSrc=attributes.src??'')=>({currentSrc,getAttribute:name=>attributes[name]??null});
function currentButton({gallery=[],details=[],scriptMain,deliver=async()=>({ok:true,delivered:true}),nested=false}={}){
 const elements=[],messages=[];
 const create=tag=>{const node={tag,id:'',style:{},textContent:'',hidden:false,disabled:false,setAttribute(){},append(){},attachShadow(){return {append(){}};},addEventListener(type,listener){if(type==='click')node.click=listener;}};elements.push(node);return node;};
 const data={subject:'合成延迟图片商品',skuModel:{offerId,skuInfoMap:{black:{specAttrs:'黑色',skuId:'synthetic-black',price:'5.30'}}},...(scriptMain?{offerImgList:[scriptMain]}:{})};
 const document={getElementById:()=>null,createElement:create,documentElement:{append(){}},title:'合成延迟图片商品',scripts:[{textContent:JSON.stringify(data)}],
  querySelector(selector){return selector.startsWith('meta')?{content:'合成延迟图片商品'}:selector==='.price-container'?{textContent:'¥5.30 1件起批'}:null;},
  querySelectorAll(selector){if(selector.includes('.detail-gallery'))return gallery;if(selector.includes('#desc-lazyload-container'))return details;assert.fail(`Unexpected selector: ${selector}`);}};
 const window={};window.top=nested?{}:window;
 vm.runInNewContext(bundle,{window,document,location:{href:sourceUrl},URL,Date,Error,TextEncoder,
  chrome:{runtime:{sendMessage:async message=>{messages.push(message);return deliver(message);}}},fetch:()=>assert.fail('Current-page collection must not fetch a source endpoint')});
 return {button:elements.find(node=>node.tag==='button'),status:elements.find(node=>node.tag==='p'),messages};
}
function localDelivery(h,company){
 const records=new Map(),receipts=[],tab={id:20,windowId:3,url:'http://localhost:3000/'};
 const store=async(action,value)=>{if(action==='list')return [...records.values()];if(action==='put')records.set(value.id,structuredClone(value));if(action==='delete')records.delete(value);};
 const api={tabs:{query:async input=>{assert.equal(input.windowId,3);return [tab];},get:async()=>tab,sendMessage:async(_id,message)=>{
  if(message.type==='YOOFAM_READ_CATALOG_CONTEXT')return {ok:true,ownerId:'owner',company};
  assert.equal(message.type,'YOOFAM_SAVE_SOURCE_CAPTURE');const record=message.record;
  const response=await h.load('app/api/source-inbox/route.ts').POST(new Request('http://localhost:3000/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({expectedOwnerId:record.ownerId,expectedCompany:record.company,id:record.id,fingerprint:record.fingerprint,snapshot:record.snapshot})}));
  assert.equal(response.status,200,await response.clone().text());const receipt=await response.json();receipts.push(receipt);return receipt;
 }}};
 return {records,receipts,deliver:message=>savePageSource(message,{frameId:0,url:sourceUrl,tab:{id:21,windowId:3}},api,store)};
}

for(const [company,lazyAttribute] of [[{code:'A01526306',name:'유앤채'},'data-lazyload-src'],[{code:'A01464742',name:'와이홉'},'data-ks-lazyload']])test(`${company.code}: shipped trusted button retains a lazy detail beside its script main and receives a real local inbox ACK`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,sourceFetcher:()=>assert.fail('A lazy image must not initiate source collection')});
 try{
  const delivery=localDelivery(h,company),before=h.sqlite.prepare('SELECT count(*) n FROM products').get().n;
  const fixture=currentButton({scriptMain:cdn('main'),details:[image({src:placeholder,'data-src':'https://foreign.invalid/not-an-image.jpg',[lazyAttribute]:cdn('detail')})],deliver:delivery.deliver});
  await fixture.button.click({isTrusted:false});assert.equal(fixture.messages.length,0);assert.equal(delivery.receipts.length,0);
  await fixture.button.click({isTrusted:true});assert.equal(fixture.messages.length,1);assert.equal(delivery.receipts.length,1);
  assert.equal(fixture.button.textContent,'수집 완료');assert.match(fixture.status.textContent,/AI상품등록 목록에 담았습니다/);
  const receipt=delivery.receipts[0],saved=await h.load('db/source-inbox.ts').readSourceInbox('owner',receipt.id);
  assert.deepEqual(JSON.parse(JSON.stringify(saved.snapshot.images)),[{url:cdn('main'),role:'main'},{url:cdn('detail'),role:'detail'}]);
  assert.equal(saved.company.code,company.code);assert.equal(saved.snapshot.options[0].unitPriceCny,5.3);assert.equal(saved.snapshot.options[0].supplierSku,'synthetic-black');
  assert.equal(saved.fingerprint,receipt.fingerprint);assert.equal(delivery.records.size,0,'only a matching durable web ACK clears the extension copy');
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,before);assert.equal(h.network.length,0);assert.ok(!h.calls.some(path=>path.includes('supplier-hub-receipt')));
 }finally{h.close();}
});

test('shipped gallery-only capture skips placeholder candidates and retains main/additional/detail roles in local inbox',async()=>{
 const company={code:'A01464742',name:'와이홉'},h=mobileIntakeHarness();
 try{
  const delivery=localDelivery(h,company),fixture=currentButton({
   gallery:[image({src:placeholder,'data-lazyload-src':cdn('gallery-main')}),image({src:placeholder,'data-ks-lazyload':'//cbu01.alicdn.com/synthetic-step769-gallery-extra.jpg'})],
   details:[image({src:placeholder,'data-src':cdn('gallery-detail')})],deliver:delivery.deliver});
  await fixture.button.click({isTrusted:true});assert.equal(fixture.messages.length,1);assert.equal(delivery.receipts.length,1);assert.equal(fixture.button.textContent,'수집 완료');
  const saved=await h.load('db/source-inbox.ts').readSourceInbox('owner',delivery.receipts[0].id);
  assert.deepEqual(JSON.parse(JSON.stringify(saved.snapshot.images)),[
   {url:cdn('gallery-main'),role:'main'},{url:cdn('gallery-extra'),role:'additional'},{url:cdn('gallery-detail'),role:'detail'}]);
  assert.equal(h.network.length,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);
 }finally{h.close();}
});

test('a placeholder-only or foreign-only image cannot produce a shipped success or inbox write; untrusted and nested-page clicks remain inactive',async()=>{
 for(const candidate of [placeholder,'https://alicdn.com.foreign.invalid/image.jpg','http://cbu01.alicdn.com/image.jpg','https://user:secret@cbu01.alicdn.com/image.jpg']){
  const fixture=currentButton({gallery:[image({src:placeholder,'data-lazyload-src':candidate})],deliver:()=>assert.fail('An invalid image must not reach the inbox')});
  await fixture.button.click({isTrusted:false});assert.equal(fixture.messages.length,0);
  await fixture.button.click({isTrusted:true});assert.equal(fixture.messages.length,0);assert.match(fixture.status.textContent,/옵션·이미지/);assert.notEqual(fixture.button.textContent,'수집 완료');assert.equal(fixture.button.disabled,false);
 }
 const nested=currentButton({nested:true,scriptMain:cdn('never-read')});assert.equal(nested.button,undefined);assert.equal(nested.messages.length,0);
});

test('current-element selection preserves existing valid-source priorities and rejects every invalid early URL before trying an allowed lazy value',()=>{
 const element=image({'data-src':cdn('data'),src:cdn('src'),'data-lazyload-src':cdn('lazy'),'data-ks-lazyload':cdn('ks')},cdn('current'));
 assert.equal(readPageSourceElementImage(element),cdn('current'));assert.equal(readPageSourceElementImage(element,{preferDataSource:true}),cdn('data'));
 assert.equal(readPageSourceElementImage(null),null);
 const invalid=[placeholder,'blob:https://detail.1688.com/fake','javascript:alert(1)','http://cbu01.alicdn.com/image.jpg','https://foreign.invalid/image.jpg','https://alicdn.com.foreign.invalid/image.jpg','https://user:secret@cbu01.alicdn.com/image.jpg','https://cbu01.alicdn.com:443/image.jpg#fragment','https://cbu01.alicdn.com:444/image.jpg','https://cbu01.alicdn.com/'+('a'.repeat(2050))+'.jpg'];
 for(const candidate of invalid){
  const node=image({'data-src':candidate,src:candidate,'data-lazyload-src':candidate,'data-ks-lazyload':cdn('allowed')},candidate);
  assert.equal(readPageSourceElementImage(node),cdn('allowed'));assert.equal(readPageSourceElementImage(node,{preferDataSource:true}),cdn('allowed'));
 }
});
