import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {readPageSourceElementImage} from '../extensions/supplier-hub/page-source.mjs';
import {savePageSource} from '../extensions/supplier-hub/source-inbox.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {pageCollectorDom} from './helpers/page-collector-dom.mjs';

// The shipped generated button runs against an inert current-document adapter.
// It cannot execute supplier scripts, read an iframe, or request any resource.
const bundle=fs.readFileSync(new URL('../extensions/supplier-hub/page-collector.js',import.meta.url),'utf8');
const offerId='700000000769',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const cdn=name=>`https://cbu01.alicdn.com/synthetic-step769-${name}.jpg`;
const placeholder='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const image=(attributes={},currentSrc=attributes.src??'')=>({currentSrc,getAttribute:name=>attributes[name]??null});
function currentButton({gallery=[],details=[],scriptMain,deliver=async()=>({ok:true,delivered:true}),nested=false}={}){
 const messages=[];
 const data={subject:'合成延迟图片商品',skuModel:{offerId,skuInfoMap:{black:{specAttrs:'黑色',skuId:'synthetic-black',price:'5.30'}}},...(scriptMain?{offerImgList:[scriptMain]}:{})};
 const {document,elements}=pageCollectorDom({title:'合成延迟图片商品',scripts:[{textContent:JSON.stringify(data)}],
  querySelector(selector){return selector.startsWith('meta')?{content:'合成延迟图片商品'}:selector==='.price-container'?{textContent:'¥5.30 1件起批'}:null;},
  querySelectorAll(selector){if(selector.includes('.detail-gallery'))return gallery;if(selector.includes('#desc-lazyload-container'))return selector.includes(' img')?details:[];if(selector.startsWith('h1,h2,h3,h4,h5,h6')||['section,article,[role="tabpanel"]','[role="tab"]','[role="tabpanel"]'].includes(selector))return[];assert.fail(`Unexpected selector: ${selector}`);}});
 const window={};window.top=nested?{}:window;
 const location={href:sourceUrl};
 vm.runInNewContext(bundle,{window,document,location,URL,Date,Error,TextEncoder,
  chrome:{runtime:{sendMessage:async message=>{messages.push(message);return deliver(message);}}},fetch:()=>assert.fail('Current-page collection must not fetch a source endpoint')});
 return {button:elements.find(node=>node.tag==='button'),status:elements.find(node=>node.tag==='p'),messages,document,location};
}
function localDelivery(h,company,{ackResult=receipt=>receipt}={}){
 const records=new Map(),receipts=[],tab={id:20,windowId:3,url:'http://localhost:3000/'};
 const origin='http://localhost:3000',bridge={window:{addEventListener(){},postMessage(){}},location:{origin},URL,Date,Error,Response,AbortController,setTimeout,clearTimeout,TextEncoder,crypto:webcrypto,
  chrome:{runtime:{onMessage:{addListener(){}}}},fetch:async(path,init)=>{
   let response;
   if(path==='/api/supplier-hub/catalog-context')response=Response.json({ownerId:'owner',company});
   else{assert.equal(path,'/api/source-inbox');assert.equal(init.method,'POST');response=await h.load('app/api/source-inbox/route.ts').POST(new Request(origin+path,init));assert.equal(response.status,200,await response.clone().text());receipts.push(await response.clone().json());}
   Object.defineProperty(response,'url',{value:origin+path});return response;
  }};
 vm.runInNewContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8'),bridge);
 const store=async(action,value)=>{if(action==='list')return [...records.values()];if(action==='put')records.set(value.id,structuredClone(value));if(action==='delete')records.delete(value);};
 const api={tabs:{query:async input=>{assert.equal(input.windowId,3);return [tab];},get:async()=>tab,sendMessage:async(_id,message)=>{
  if(message.type==='YOOFAM_READ_CATALOG_CONTEXT')return {ok:true,ownerId:'owner',company};
  assert.equal(message.type,'YOOFAM_SAVE_SOURCE_CAPTURE');const record=message.record;
  return ackResult(await bridge.savePageSourceInApp(record));
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

test('extension-retained delivery failures show their exact reason and require an explicit trusted retry',async()=>{
 for(const message of [
  '수집 당시 회원·회사로 로그인한 앱에서 불러오세요.',
  '저장 중 로그인 회사가 변경되었습니다. 확장 보관본은 유지됩니다.',
  '웹 수집함의 저장 확인을 받지 못했습니다. 확장 보관본은 유지됩니다.',
  '수집한 옵션 값이 올바르지 않습니다.',
  'YOOFAM 앱의 응답 시간이 초과되었습니다. 수집 결과를 확인하고 다시 시도해주세요.',
 ]){
  const fixture=currentButton({scriptMain:cdn('retained'),deliver:async()=>({ok:true,delivered:false,duplicate:true,message})});
  await fixture.button.click({isTrusted:true});
  assert.equal(fixture.button.textContent,'앱 전송 다시 시도');assert.equal(fixture.button.disabled,false);
  assert.match(fixture.status.textContent,/확장에 보관했습니다/);assert.ok(fixture.status.textContent.includes(message));
  assert.doesNotMatch(fixture.status.textContent,/AI상품등록 목록에 담았습니다|이미 수집함에 담긴/);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(fixture.messages.length,1,'retained delivery must not retry automatically');
  await fixture.button.click({isTrusted:false});assert.equal(fixture.messages.length,1,'retry still requires a trusted click');
 }
});

test('a manual retry resends the first immutable capture after an uncertain local ACK and completes only after the matching ACK',async()=>{
 const company={code:'A01464742',name:'와이홉'},h=mobileIntakeHarness();let first=true;
 try{
  const delivery=localDelivery(h,company,{ackResult:receipt=>{if(!first)return receipt;first=false;return {...receipt,fingerprint:'0'.repeat(64)};}});
  const fixture=currentButton({scriptMain:cdn('retry-original'),deliver:delivery.deliver});
  await fixture.button.click({isTrusted:true});
  assert.equal(fixture.button.textContent,'앱 전송 다시 시도');assert.match(fixture.status.textContent,/웹 수집함의 저장 확인을 받지 못했습니다/);
  assert.equal(delivery.records.size,1);assert.equal(delivery.receipts.length,1);
  const retained=JSON.stringify([...delivery.records.values()][0]),original=JSON.stringify(fixture.messages[0].snapshot),receipt=delivery.receipts[0];
  const stored=await h.load('db/source-inbox.ts').readSourceInbox('owner',receipt.id),originalStored=JSON.stringify(stored.snapshot);
  fixture.location.href=sourceUrl+'?spm=synthetic-manual-retry';
  Object.defineProperty(fixture.document,'scripts',{get:()=>assert.fail('Manual delivery retry must not recapture changed page data')});
  fixture.document.querySelector=()=>assert.fail('Manual delivery retry must retain the original capture');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(delivery.receipts.length,1);assert.equal(JSON.stringify([...delivery.records.values()][0]),retained);
  await fixture.button.click({isTrusted:true});
  assert.equal(fixture.messages.length,2);assert.equal(JSON.stringify(fixture.messages[1].snapshot),original);
  assert.equal(delivery.receipts.length,2);assert.equal(delivery.receipts[1].id,receipt.id);assert.equal(delivery.receipts[1].fingerprint,receipt.fingerprint);
  assert.equal(delivery.receipts[1].duplicate,true);assert.equal(delivery.records.size,0);assert.equal(fixture.button.textContent,'수집 완료');assert.match(fixture.status.textContent,/이미 수집함에 담긴 원문과 검토 내용을 유지/);
  assert.equal(JSON.stringify((await h.load('db/source-inbox.ts').readSourceInbox('owner',receipt.id)).snapshot),originalStored);
  assert.equal(h.network.length,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);assert.ok(!h.calls.some(path=>path.includes('supplier-hub-receipt')));
 }finally{h.close();}
});

test('a retry from a different offer is refused before messaging and leaves the current offer uncollected',async()=>{
 const fixture=currentButton({scriptMain:cdn('changed-offer'),deliver:async()=>({ok:true,delivered:false,message:'합성 미확인 ACK'})});
 await fixture.button.click({isTrusted:true});const original=JSON.stringify(fixture.messages[0].snapshot);
 const nextOffer='700000000788';fixture.location.href=`https://detail.1688.com/offer/${nextOffer}.html`;
 await fixture.button.click({isTrusted:true});
 assert.equal(fixture.messages.length,1);assert.equal(JSON.stringify(fixture.messages[0].snapshot),original);
 assert.equal(fixture.button.textContent,'상품 수집');assert.match(fixture.status.textContent,/이전 보관본은 확장에 유지/);assert.match(fixture.status.textContent,/현재 상품은 아직 수집하지 않았습니다/);
 const changed=JSON.parse(fixture.document.scripts[0].textContent);changed.skuModel.offerId=nextOffer;fixture.document.scripts[0].textContent=JSON.stringify(changed);
 await fixture.button.click({isTrusted:true});assert.equal(fixture.messages.length,2);assert.equal(fixture.messages[1].snapshot.offerId,nextOffer);assert.equal(fixture.messages[1].snapshot.sourceUrl,fixture.location.href);
});

test('only an explicit delivered true can show completion; malformed or rejected responses show an error',async()=>{
 for(const result of [{ok:true},{ok:true,delivered:null},{ok:true,delivered:'true'},{ok:true,delivered:1},{ok:false,error:'합성 서버 검증 실패'}]){
  const fixture=currentButton({scriptMain:cdn('unknown-result'),deliver:async()=>result});await fixture.button.click({isTrusted:true});
  assert.equal(fixture.messages.length,1);assert.equal(fixture.button.textContent,'상품 수집');assert.equal(fixture.button.disabled,false);
  assert.doesNotMatch(fixture.status.textContent,/AI상품등록 목록에 담았습니다|이미 수집함에 담긴|확장에 보관했습니다/);
  assert.match(fixture.status.textContent,/확인하지 못했습니다|합성 서버 검증 실패/);
 }
});

test('an in-flight result cannot mark a different current offer complete or retry its previous capture',async()=>{
 for(const result of [{ok:true,delivered:true},{ok:true,delivered:false,message:'합성 이전 상품 ACK 미확인'}]){
  let release;const response=new Promise(resolve=>{release=resolve;});
  const fixture=currentButton({scriptMain:cdn('late-result'),deliver:()=>response}),inFlight=fixture.button.click({isTrusted:true});
  // The hydration wrapper settles before the immutable send. Observe the
  // actual pending delivery, rather than assuming a synchronous click body.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(fixture.messages.length,1);assert.equal(fixture.button.disabled,true);
  await fixture.button.click({isTrusted:true});assert.equal(fixture.messages.length,1,'a second click while pending cannot start another capture');
  fixture.location.href='https://detail.1688.com/offer/700000000788.html';release(result);await inFlight;
  assert.equal(fixture.messages.length,1);assert.equal(fixture.button.textContent,'상품 수집');assert.equal(fixture.button.disabled,false);
  assert.match(fixture.status.textContent,/현재 상품은 아직 수집하지 않았습니다/);assert.doesNotMatch(fixture.status.textContent,/AI상품등록 목록에 담았습니다/);
  if(result.delivered)assert.match(fixture.status.textContent,/이전 상품은 앱 수집함에 저장되었습니다/);
  else{assert.match(fixture.status.textContent,/이전 상품은 확장에 보관했습니다/);assert.ok(fixture.status.textContent.includes(result.message));}
 }
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
