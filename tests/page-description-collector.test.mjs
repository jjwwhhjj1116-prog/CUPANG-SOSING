import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {pageCollectorDom} from './helpers/page-collector-dom.mjs';

const offerId='700000000001',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const main='https://cbu01.alicdn.com/synthetic-main.jpg',detail='https://cbu01.alicdn.com/synthetic-detail.jpg';
const bundle=await build({entryPoints:['deployment/extension-page-collector.mjs'],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120'});
function harness({linked=true,respond=async()=>({ok:true,available:true,sourceUrl,offerId,detailImages:[main,detail]})}={}){
 const data={offerId,subject:'합성 상품',skuModel:{offerId,skuInfoMap:{black:{skuId:'synthetic-black',specAttrs:'黑色',price:'0.28'}}},offerImgList:[main],...(linked?{detailUrl:'https://itemcdn.tmall.com/1688offer/SYNTHETICONLY'}:{})};
 const {elements,document}=pageCollectorDom({scripts:[{textContent:JSON.stringify(data)}],querySelector:selector=>selector==='.price-container'?{textContent:'¥0.28 1件起批'}:null});
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
 const snapshot=h.messages[1].snapshot;assert.equal(snapshot.options.length,1);assert.deepEqual(snapshot.images,[{url:main,role:'main'},{url:detail,role:'detail'}]);
 assert.equal(snapshot.captureDiagnostics.description,'captured');assert.doesNotMatch(JSON.stringify(snapshot.captureDiagnostics),/https?:|SYNTHETICONLY/);
 assert.equal(h.button.textContent,'수집 완료');assert.match(h.status.textContent,/상세이미지 1장/);
});

test('unproven or unavailable description links preserve the normal capture without retrying or inventing detail images',async()=>{
 const unlinked=harness({linked:false});await unlinked.button.click({isTrusted:true});assert.equal(unlinked.messages.length,1);assert.equal(unlinked.messages[0].type,'YOOFAM_SAVE_PAGE_SOURCE');
 assert.equal(unlinked.messages[0].snapshot.captureDiagnostics.description,'reference-missing');
 const unavailable=harness({respond:async()=>({ok:true,available:false,sourceUrl,offerId,detailImages:[],reason:'link-unavailable'})});await unavailable.button.click({isTrusted:true});
 assert.equal(unavailable.messages.length,2);assert.deepEqual(unavailable.messages[1].snapshot.images,[{url:main,role:'main'}]);assert.match(unavailable.status.textContent,/상세이미지 0장/);
 assert.equal(unavailable.messages[1].snapshot.captureDiagnostics.description,'unavailable');
});

test('wrong-offer or foreign-CDN description replies never reach inbox storage',async()=>{
 for(const patch of [{offerId:'700000000002'},{sourceUrl:sourceUrl.replace(offerId,'700000000002')},{detailImages:['https://evil.test/image.jpg']}]){
  const h=harness({respond:async()=>({ok:true,available:true,sourceUrl,offerId,detailImages:[detail],...patch})});await h.button.click({isTrusted:true});
  assert.equal(h.messages.length,1);assert.notEqual(h.button.textContent,'수집 완료');
 }
});

test('navigation during the explicit description await stops capture before any inbox write',async()=>{
 let release;const h=harness({respond:()=>new Promise(resolve=>{release=resolve;})}),operation=h.button.click({isTrusted:true});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.messages.length,1);h.context.location.href=sourceUrl.replace(offerId,'700000000002');release({ok:true,available:true,sourceUrl,offerId,detailImages:[detail]});await operation;
 assert.equal(h.messages.length,1);assert.notEqual(h.button.textContent,'수집 완료');assert.match(h.status.textContent,/상품 페이지가 변경/);
});
