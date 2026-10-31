import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {pageCollectorDom} from './helpers/page-collector-dom.mjs';
import {productDocument} from './helpers/product-document.mjs';

const offerId='700000000001',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const main='https://cbu01.alicdn.com/synthetic-main.jpg',detail='https://cbu01.alicdn.com/synthetic-detail.jpg';
const bundle=await build({entryPoints:['deployment/extension-page-collector.mjs'],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120'});
function harness({linked=true,domDetails=[],extraScripts=[],gallery=[main],optionImage,respond=async()=>({ok:true,available:true,sourceUrl,offerId,detailImages:[main,detail]})}={}){
 const data={offerId,subject:'합성 상품',skuModel:{offerId,skuInfoMap:{black:{skuId:'synthetic-black',specAttrs:'黑色',price:'0.28',...(optionImage?{imageUrl:optionImage}:{})}}},offerImgList:gallery,...(linked?{detailUrl:'https://itemcdn.tmall.com/1688offer/SYNTHETICONLY'}:{})};
 const page=productDocument('<section><h2>商品详情</h2>'+domDetails.map(url=>`<img data-original="${url}">`).join('')+'</section>');
 const {elements,document}=pageCollectorDom({scripts:[{textContent:JSON.stringify(data)},...extraScripts.map(textContent=>({textContent}))],querySelectorAll:selector=>page.querySelectorAll(selector),querySelector:selector=>selector==='.price-container'?{textContent:'¥0.28 1件起批'}:page.querySelector(selector)});
 const messages=[],window={};window.top=window;
 const context={window,document,location:{href:sourceUrl},URL,Date,Error,TextEncoder,chrome:{runtime:{sendMessage:async message=>{
  messages.push(structuredClone(message));if(message.type==='YOOFAM_READ_PAGE_DESCRIPTION')return respond();
  assert.equal(message.type,'YOOFAM_SAVE_PAGE_SOURCE');return {ok:true,delivered:true};
 }}},fetch(){assert.fail('The isolated button must not fetch a source URL');}};
 vm.runInNewContext(bundle.outputFiles[0].text,context);
 return {context,messages,button:elements.find(node=>node.tag==='button'),status:elements.find(node=>node.tag==='p')};
}

test('one trusted click reads one explicitly linked description and saves one validated role-preserving snapshot',async()=>{
 const h=harness();await h.button.click({isTrusted:false});assert.equal(h.messages.length,0);
 await h.button.click({isTrusted:true});assert.deepEqual(h.messages.map(message=>message.type),['YOOFAM_READ_PAGE_DESCRIPTION','YOOFAM_SAVE_PAGE_SOURCE']);
 const snapshot=h.messages[1].snapshot;assert.equal(snapshot.options.length,1);assert.deepEqual(snapshot.images,[{url:main,role:'main'},{url:main,role:'detail'},{url:detail,role:'detail'}]);
 assert.equal(snapshot.captureDiagnostics.description,'captured');assert.doesNotMatch(JSON.stringify(snapshot.captureDiagnostics),/https?:|SYNTHETICONLY/);
 assert.equal(h.button.textContent,'수집 완료');assert.match(h.status.textContent,/상세이미지 2장/);
});

test('unproven or unavailable description links preserve the normal capture without retrying or inventing detail images',async()=>{
 const unlinked=harness({linked:false});await unlinked.button.click({isTrusted:true});assert.equal(unlinked.messages.length,1);assert.equal(unlinked.messages[0].type,'YOOFAM_SAVE_PAGE_SOURCE');
 assert.equal(unlinked.messages[0].snapshot.captureDiagnostics.description,'reference-missing');
 const unavailable=harness({respond:async()=>({ok:true,available:false,sourceUrl,offerId,detailImages:[],reason:'link-unavailable'})});await unavailable.button.click({isTrusted:true});
 assert.equal(unavailable.messages.length,2);assert.deepEqual(unavailable.messages[1].snapshot.images,[{url:main,role:'main'}]);assert.match(unavailable.status.textContent,/상세이미지 0장/);
 assert.equal(unavailable.messages[1].snapshot.captureDiagnostics.description,'unavailable');
});

test('a partial visible detail never skips the bound document and all seven explicit images retain document order',async()=>{
 const six=Array.from({length:6},(_,index)=>`https://cbu01.alicdn.com/synthetic-detail-${index+1}.jpg`);
 const h=harness({domDetails:[six[4]],respond:async()=>({ok:true,available:true,sourceUrl,offerId,detailImages:[main,...six,six[2]]})});
 await h.button.click({isTrusted:true});assert.deepEqual(h.messages.map(message=>message.type),['YOOFAM_READ_PAGE_DESCRIPTION','YOOFAM_SAVE_PAGE_SOURCE']);
 const snapshot=h.messages[1].snapshot;assert.deepEqual(snapshot.images,[{url:main,role:'main'},...[main,...six].map(url=>({url,role:'detail'}))]);
 assert.equal(snapshot.captureDiagnostics.description,'captured');assert.match(h.status.textContent,/상세이미지 7장/);
});

test('the recorded globalData.detailModel shape is discovered even when one DOM detail is already visible',async()=>{
 const envelope={globalData:{offerBaseInfo:{offerId},tempModel:{offerId},isPicPrivate:false,isPricePrivate:false,detailModel:{offerId,detailUrl:'https://air.1688.com/pages/od/app-desc/d7p56fw2w/index.html?url='+encodeURIComponent('https://itemcdn.tmall.com/1688offer/SYNTHETICONLY')+'&offerId='+offerId}}};
 const h=harness({linked:false,domDetails:[detail],extraScripts:['window.__INIT_DATA = '+JSON.stringify(envelope)+';']});
 await h.button.click({isTrusted:true});assert.deepEqual(h.messages.map(message=>message.type),['YOOFAM_READ_PAGE_DESCRIPTION','YOOFAM_SAVE_PAGE_SOURCE']);
 assert.equal(h.messages[1].snapshot.captureDiagnostics.description,'captured');assert.deepEqual(h.messages[1].snapshot.images,[{url:main,role:'main'},{url:main,role:'detail'},{url:detail,role:'detail'}]);
});

test('bound description merge deduplicates while retaining DOM-only details and existing main attribution',async()=>{
 const first='https://cbu01.alicdn.com/synthetic-desc-first.jpg',extra='https://cbu01.alicdn.com/synthetic-dom-only.jpg';
 const h=harness({domDetails:[detail,extra],respond:async()=>({ok:true,available:true,sourceUrl,offerId,detailImages:[first,detail,main,first]})});
 await h.button.click({isTrusted:true});assert.deepEqual(h.messages[1].snapshot.images,[{url:main,role:'main'},...[first,detail,main,extra].map(url=>({url,role:'detail'}))]);
});

test('an explicitly linked main-only description retains its detail role with or without the same visible DOM detail',async()=>{
 for(const domDetails of [[],[main]]){
  const h=harness({domDetails,respond:async()=>({ok:true,available:true,sourceUrl,offerId,detailImages:[main,main]})});await h.button.click({isTrusted:true});
  assert.deepEqual(h.messages.map(message=>message.type),['YOOFAM_READ_PAGE_DESCRIPTION','YOOFAM_SAVE_PAGE_SOURCE']);
  const snapshot=h.messages[1].snapshot;assert.deepEqual(snapshot.images,[{url:main,role:'main'},{url:main,role:'detail'}]);
  assert.equal(snapshot.captureDiagnostics.description,'captured');assert.match(h.status.textContent,/상세이미지 1장/);
 }
});

test('role-specific enrichment preserves non-detail order and the first image index used for each option URL',async()=>{
 const galleryImage='https://cbu01.alicdn.com/synthetic-gallery.jpg',optionImage='https://cbu01.alicdn.com/synthetic-option.jpg',domOnly='https://cbu01.alicdn.com/synthetic-dom-only.jpg';
 const baseline=harness({linked:false,gallery:[main,galleryImage],optionImage});await baseline.button.click({isTrusted:true});
 const original=baseline.messages[0].snapshot;
 const h=harness({gallery:[main,galleryImage],optionImage,domDetails:[optionImage,domOnly],respond:async()=>({ok:true,available:true,sourceUrl,offerId,detailImages:[optionImage,main,galleryImage,optionImage]})});await h.button.click({isTrusted:true});
 const snapshot=h.messages[1].snapshot;
 assert.deepEqual(snapshot.images.filter(image=>image.role!=='detail'),original.images);
 assert.deepEqual(snapshot.images.filter(image=>image.role==='detail'),[optionImage,main,galleryImage,domOnly].map(url=>({url,role:'detail'})));
 assert.deepEqual(snapshot.options,original.options);
 for(const option of original.options)assert.equal(snapshot.images.findIndex(image=>image.url===option.imageUrl),original.images.findIndex(image=>image.url===option.imageUrl));
 assert.equal(snapshot.images[snapshot.images.findIndex(image=>image.url===optionImage)].role,'additional');
});

test('role-preserving enrichment accepts the exact 200-placement limit without silently discarding a shared URL',async()=>{
 const gallery=[main,...Array.from({length:119},(_,index)=>`https://cbu01.alicdn.com/synthetic-gallery-${index+1}.jpg`)];
 const details=[main,...Array.from({length:79},(_,index)=>`https://cbu01.alicdn.com/synthetic-description-${index+1}.jpg`)];
 const h=harness({gallery,respond:async()=>({ok:true,available:true,sourceUrl,offerId,detailImages:details})});await h.button.click({isTrusted:true});
 assert.equal(h.messages.length,2);const snapshot=h.messages[1].snapshot;
 assert.equal(snapshot.images.length,200);assert.equal(snapshot.images.filter(image=>image.role==='detail').length,80);
 assert.deepEqual(snapshot.images.slice(0,120),gallery.map((url,index)=>({url,role:index?'additional':'main'})));
 assert.deepEqual(snapshot.images.slice(120),details.map(url=>({url,role:'detail'})));
});

test('enrichment exceeding a reply or combined placement limit fails before inbox storage rather than truncating roles',async()=>{
 const details=Array.from({length:80},(_,index)=>index===0?main:`https://cbu01.alicdn.com/synthetic-description-${index}.jpg`);
 for(const input of [
  {respond:async()=>({ok:true,available:true,sourceUrl,offerId,detailImages:[...details,'https://cbu01.alicdn.com/synthetic-overflow.jpg']})},
  {gallery:[main,...Array.from({length:120},(_,index)=>`https://cbu01.alicdn.com/synthetic-gallery-${index+1}.jpg`)],respond:async()=>({ok:true,available:true,sourceUrl,offerId,detailImages:details})},
 ]){
  const h=harness(input);await h.button.click({isTrusted:true});
  assert.deepEqual(h.messages.map(message=>message.type),['YOOFAM_READ_PAGE_DESCRIPTION']);assert.notEqual(h.button.textContent,'수집 완료');
 }
});

test('failed enrichment retains a partial observed detail and explicitly marks its full range unconfirmed',async()=>{
 for(const respond of [async()=>({ok:true,available:false,sourceUrl,offerId,detailImages:[],reason:'network-unavailable'}),async()=>{throw Error('Synthetic worker unavailable');}]){
  const h=harness({domDetails:[detail],respond});await h.button.click({isTrusted:true});
  assert.deepEqual(h.messages.map(message=>message.type),['YOOFAM_READ_PAGE_DESCRIPTION','YOOFAM_SAVE_PAGE_SOURCE']);
  const snapshot=h.messages[1].snapshot;assert.deepEqual(snapshot.images,[{url:main,role:'main'},{url:detail,role:'detail'}]);assert.equal(snapshot.captureDiagnostics.description,'unavailable');
  assert.match(h.status.textContent,/상세이미지 1장/);assert.match(h.status.textContent,/전체 상세사진 범위는 미확인/);
 }
});

test('a partial detail without a proven description reference is preserved without any description request',async()=>{
 const h=harness({linked:false,domDetails:[detail]});await h.button.click({isTrusted:true});assert.equal(h.messages.length,1);assert.equal(h.messages[0].type,'YOOFAM_SAVE_PAGE_SOURCE');
 assert.deepEqual(h.messages[0].snapshot.images,[{url:main,role:'main'},{url:detail,role:'detail'}]);assert.equal(h.messages[0].snapshot.captureDiagnostics.description,'reference-missing');
});

test('wrong-offer or foreign-CDN description replies never reach inbox storage',async()=>{
 for(const patch of [{offerId:'700000000002'},{sourceUrl:sourceUrl.replace(offerId,'700000000002')},{detailImages:['https://evil.test/image.jpg']}]){
  const h=harness({domDetails:[detail],respond:async()=>({ok:true,available:true,sourceUrl,offerId,detailImages:[detail],...patch})});await h.button.click({isTrusted:true});
  assert.equal(h.messages.length,1);assert.notEqual(h.button.textContent,'수집 완료');
 }
});

test('navigation during the explicit description await stops capture before any inbox write',async()=>{
 let release;const h=harness({respond:()=>new Promise(resolve=>{release=resolve;})}),operation=h.button.click({isTrusted:true});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.messages.length,1);h.context.location.href=sourceUrl.replace(offerId,'700000000002');release({ok:true,available:true,sourceUrl,offerId,detailImages:[detail]});await operation;
 assert.equal(h.messages.length,1);assert.notEqual(h.button.textContent,'수집 완료');assert.match(h.status.textContent,/상품 페이지가 변경/);
});
