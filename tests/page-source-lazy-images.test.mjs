import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {readPageSourceElementImage} from '../extensions/supplier-hub/page-source.mjs';
import {pageCollectorDom} from './helpers/page-collector-dom.mjs';
import {productDocument} from './helpers/product-document.mjs';

const offerId='700000000001',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const main='https://cbu01.alicdn.com/synthetic-lazy-main.jpg',black='https://cbu01.alicdn.com/synthetic-lazy-black.jpg',gray='https://cbu01.alicdn.com/synthetic-lazy-gray.jpg';
const placeholder='data:image/gif;base64,placeholder',lazyAttributes=['data-original','data-original-src','data-lazy-src','data-lazyload'];
const bundle=await build({entryPoints:['deployment/extension-page-collector.mjs'],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120'});
const image=(values={},currentSrc='')=>({currentSrc,getAttribute:name=>Object.hasOwn(values,name)?values[name]:null});
function harness(html,{gallery=[]}={}){
 const data={offerId,subject:'合成原文',skuModel:{offerId,beginAmount:2,skuInfoMap:{black:{skuId:'synthetic-black',specAttrs:'黑色',price:'5.30',stock:7},gray:{skuId:'synthetic-gray',specAttrs:'灰色',price:'6.10',stock:8}}},...(gallery.length?{offerImgList:gallery}:{})};
 const page=productDocument(html),pending=[page];
 // Match the inert DOM helper's existing parent/child graph, including the
 // sibling relation used by the production exact-label SKU reader.
 while(pending.length){const node=pending.pop();Object.defineProperty(node,'nextElementSibling',{get:()=>node.parentElement?.children[node.parentElement.children.indexOf(node)+1]??null});pending.push(...node.children);}
 const {elements,document}=pageCollectorDom({scripts:[{textContent:JSON.stringify(data)}],querySelectorAll:selector=>page.querySelectorAll(selector),querySelector:selector=>selector==='.price-container'?{textContent:'人民币 2件起批'}:page.querySelector(selector)});
 const messages=[],window={};window.top=window;
 vm.runInNewContext(bundle.outputFiles[0].text,{window,document,location:{href:sourceUrl},URL,Date,Error,TextEncoder,chrome:{runtime:{sendMessage:async message=>{messages.push(structuredClone(message));assert.equal(message.type,'YOOFAM_SAVE_PAGE_SOURCE');return{ok:true,delivered:true};}}},fetch(){assert.fail('A lazy-image fallback must not request a source');}});
 return{messages,button:elements.find(node=>node.tag==='button'),status:elements.find(node=>node.tag==='p')};
}
const optionFacts=snapshot=>snapshot.options.map(({key,name,supplierSku,unitPriceCny,currency,minimumOrder,stock})=>({key,name,supplierSku,unitPriceCny,currency,minimumOrder,stock}));

test('new lazy spellings are same-element fallback only and retain every previously valid source priority',()=>{
 const prior=['data-src','src','data-lazyload-src','data-ks-lazyload'];
 for(const preferDataSource of [false,true])for(const lazyAttribute of lazyAttributes){
  const fallback=image({src:placeholder,[lazyAttribute]:black});assert.equal(readPageSourceElementImage(fallback,{preferDataSource}),black);
  for(const name of prior)assert.equal(readPageSourceElementImage(image({src:placeholder,[lazyAttribute]:black,[name]:main}),{preferDataSource}),main);
  assert.equal(readPageSourceElementImage(image({src:placeholder,[lazyAttribute]:black},main),{preferDataSource}),main);
 }
 assert.equal(readPageSourceElementImage(image({'data-src':main,src:gray,'data-original':black},gray),{preferDataSource:true}),main);
 assert.equal(readPageSourceElementImage(image({'data-src':main,src:gray,'data-original':black},gray)),gray);
 assert.equal(readPageSourceElementImage(image({'data-original':black,'data-original-src':gray,'data-lazy-src':main})),black);
});

test('lazy fallback keeps protocol, CDN, port, credential and hash bounds while trying a later valid candidate',()=>{
 const rejected=['https://alicdn.com.foreign.invalid/image.jpg','http://cbu01.alicdn.com/image.jpg','https://user:secret@cbu01.alicdn.com/image.jpg','https://cbu01.alicdn.com:8443/image.jpg','https://cbu01.alicdn.com/image.jpg#foreign','data:image/png;base64,placeholder'];
 for(const lazyAttribute of lazyAttributes)for(const value of rejected)assert.equal(readPageSourceElementImage(image({src:placeholder,[lazyAttribute]:value})),null);
 assert.equal(readPageSourceElementImage(image({src:placeholder,'data-original':rejected[0],'data-original-src':black})),black);
 assert.equal(readPageSourceElementImage(image({'data-original':'//cbu01.alicdn.com/synthetic-lazy-black.jpg'})),black);
});

test('actual trusted collector retains gallery lazy originals without inventing detail roles or changing variant facts',async()=>{
 const expected=[{key:'black',name:'黑色',supplierSku:'synthetic-black',unitPriceCny:5.3,currency:'CNY',minimumOrder:2,stock:7},{key:'gray',name:'灰色',supplierSku:'synthetic-gray',unitPriceCny:6.1,currency:'CNY',minimumOrder:2,stock:8}];
 for(const attribute of lazyAttributes){
  const h=harness(`<section class="gallery"><img src="${placeholder}" ${attribute}="${main}"><img src="${placeholder}" ${attribute}="${gray}"></section>`);
  await h.button.click({isTrusted:false});assert.equal(h.messages.length,0);await h.button.click({isTrusted:true});
  assert.equal(h.messages.length,1,h.status.textContent);const snapshot=h.messages[0].snapshot;
  assert.deepEqual(snapshot.images,[{url:main,role:'main'},{url:gray,role:'additional'}]);assert.deepEqual(optionFacts(snapshot),expected);
  assert.equal(snapshot.images.some(row=>row.role==='detail'),false);assert.equal(h.button.textContent,'수집 완료');
 }
});

test('actual trusted collector supplements only uniquely named current-offer SKU lazy images with exact script facts unchanged',async()=>{
 for(const attribute of lazyAttributes){
  const baseline=harness('',{gallery:[main]});await baseline.button.click({isTrusted:true});
  const html=`<section class="offer-sku" data-offer-id="${offerId}"><span>颜色</span><ul><li>黑色<img src="${placeholder}" ${attribute}="${black}"><span>¥999.00</span> 库存999</li><li>灰色<img src="${placeholder}" ${attribute}="${gray}"><span>¥999.00</span> 库存999</li></ul></section>`;
  const h=harness(html,{gallery:[main]});await h.button.click({isTrusted:true});assert.equal(h.messages.length,1,h.status.textContent);
  const snapshot=h.messages[0].snapshot;assert.deepEqual(optionFacts(snapshot),optionFacts(baseline.messages[0].snapshot));assert.deepEqual(snapshot.options.map(row=>row.imageUrl),[black,gray]);
  assert.deepEqual(snapshot.images,[{url:main,role:'main'},{url:black,role:'additional'},{url:gray,role:'additional'}]);
  const foreign=harness(html.replaceAll(`data-offer-id="${offerId}"`,'data-offer-id="700000000999"'),{gallery:[main]});await foreign.button.click({isTrusted:true});
  assert.deepEqual(foreign.messages[0].snapshot.options.map(row=>row.imageUrl),[null,null]);assert.deepEqual(foreign.messages[0].snapshot.images,[{url:main,role:'main'}]);
 }
});

test('rejected lazy gallery URLs fail before any inbox save and cannot be reported as a completed capture',async()=>{
 for(const attribute of lazyAttributes){
  const h=harness(`<section class="gallery"><img src="${placeholder}" ${attribute}="https://alicdn.com.foreign.invalid/unrelated.jpg"></section>`);
  await h.button.click({isTrusted:true});assert.equal(h.messages.length,0);assert.notEqual(h.button.textContent,'수집 완료');
 }
});

test('actual collector preserves valid gallery precedence and rejects foreign SKU lazy URLs and unscoped image elements',async()=>{
 const preferred=harness(`<section class="gallery"><img src="${main}" data-src="${gray}" data-original="${black}"></section>`);await preferred.button.click({isTrusted:true});
 assert.deepEqual(preferred.messages[0].snapshot.images,[{url:gray,role:'main'}]);
 const current=harness(`<section class="gallery"><img src="${main}" data-original="${black}"></section>`);await current.button.click({isTrusted:true});assert.deepEqual(current.messages[0].snapshot.images,[{url:main,role:'main'}]);
 const rejected='https://alicdn.com.foreign.invalid/not-a-product.jpg';
 const h=harness(`<section class="offer-sku" data-offer-id="${offerId}"><span>颜色</span><ul><li>黑色<img src="${placeholder}" data-original="${rejected}"></li><li>灰色<img src="${placeholder}" data-original="${rejected}"></li></ul></section><div class="unscoped"><img src="${placeholder}" data-original="${black}"></div>`,{gallery:[main]});
 await h.button.click({isTrusted:true});assert.equal(h.messages.length,1,h.status.textContent);assert.deepEqual(h.messages[0].snapshot.options.map(row=>row.imageUrl),[null,null]);assert.deepEqual(h.messages[0].snapshot.images,[{url:main,role:'main'}]);
});
