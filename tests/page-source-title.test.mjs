import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {extractPageSource} from '../extensions/supplier-hub/page-source.mjs';
import {pageCollectorDom} from './helpers/page-collector-dom.mjs';

// All page fixtures are inert, synthetic and never make a source request.
const offerId='700000000001',sourceUrl='https://detail.1688.com/offer/'+offerId+'.html';
const gallery=['https://cbu01.alicdn.com/synthetic-title.jpg'];
const skuModel={offerId,skuInfoMap:{black:{specAttrs:'黑色',skuId:'synthetic-black',price:'5.30'}}};
const page=(data,extra={})=>extractPageSource({sourceUrl,gallery,title:'Synthetic shop metadata',scripts:[JSON.stringify(data)],...extra});

test('current-product raw subject overrides shop metadata and an unrelated earlier subject',()=>{
 const unrelated=JSON.stringify({offerId:'700000000002',subject:'Unrelated recommendation'});
 const current=JSON.stringify({subject:'合成测试商品',subjectTrans:'Unverified translated title',skuModel,offerImgList:gallery});
 const source=page({}, {scripts:[unrelated,current]});
 assert.equal(source.title,'合成测试商品');
 assert.equal(source.options[0].supplierSku,'synthetic-black');
});

test('the subject is scoped to the SKU JSON object rather than an earlier shop object in the same script',()=>{
 const source=page({shop:{subject:'Synthetic shop name'},recommendations:[{subject:'Unrelated recommendation'}],current:{subject:'合成测试商品',skuModel}});
 assert.equal(source.title,'合成测试商品');
 const spaced='window.synthetic = { "subject" : "合成测试商品", "skuModel"  : '+JSON.stringify(skuModel)+' };';
 assert.equal(page({}, {scripts:[spaced]}).title,'合成测试商品');
});

test('same-offer product title containers are accepted without using unrelated or unbound titles',()=>{
 assert.equal(page({offerBaseInfo:{offerId,title:'合成测试商品'},skuModel}).title,'合成测试商品');
 assert.equal(page({}, {scripts:[JSON.stringify({offerId,offerTitle:'合成测试商品'}),JSON.stringify({skuModel})]}).title,'合成测试商品');
 assert.equal(page({}, {scripts:[JSON.stringify({subject:'Unbound page label'}),JSON.stringify({skuModel})]}).title,'Synthetic shop metadata');
 assert.equal(page({}, {scripts:[JSON.stringify({offerId:'700000000002',subject:'Unrelated recommendation'}),JSON.stringify({skuModel})]}).title,'Synthetic shop metadata');
 assert.equal(page({subjectTrans:'Unverified provider translation',skuModel}).title,'Synthetic shop metadata');
});

test('mismatched current-product identities and conflicting current-product subjects fail before a capture is created',()=>{
 for(const data of [
  {offerId:'700000000002',subject:'Wrong product',skuModel},
  {subject:'Wrong product',skuModel:{...skuModel,productId:'700000000002'}},
  {offerBaseInfo:{offerId:'700000000002',title:'Wrong product'},skuModel}
 ])assert.throws(()=>page(data),/상품 번호/);
 assert.throws(()=>page({}, {scripts:[JSON.stringify({subject:'First current title',skuModel}),JSON.stringify({subject:'Conflicting current title',skuModel})]}),/상품명이 여러 개/);
 assert.throws(()=>page({current:{subject:'Current',skuModel},other:{subject:'Other',skuModel:{...skuModel,skuInfoMap:{other:{price:'6'}}}}}),/옵션 원문이 여러 개/);
});

test('missing verified structured titles use the caller fallback or reject an empty title',()=>{
 assert.equal(page({skuModel},{title:'Visible product heading'}).title,'Visible product heading');
 assert.throws(()=>page({skuModel},{title:'   '}),/상품명이 보이는/);
});

const bundle=await build({entryPoints:[fileURLToPath(new URL('../deployment/extension-page-collector.mjs',import.meta.url))],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120'});
async function collectTitle({subject,productTitle='',metaTitle='Synthetic shop metadata',documentTitle='Synthetic document title'}={}){
 const messages=[];
 const data={skuModel,offerImgList:gallery,...subject?{subject}:{}};
 const {elements,document}=pageCollectorDom({title:documentTitle,scripts:[{textContent:JSON.stringify(data)}],
  querySelector(selector){if(selector==='h1')return{textContent:'Misleading generic shop heading'};if(selector.startsWith('h1.d-title'))return{textContent:productTitle};if(selector.startsWith('meta'))return{content:metaTitle};return null;},querySelectorAll:()=>[]});
 const window={};window.top=window;
 vm.runInNewContext(bundle.outputFiles[0].text,{window,document,location:{href:sourceUrl},URL,Date,Error,TextEncoder,chrome:{runtime:{sendMessage:async message=>{messages.push(message);return{ok:true,delivered:true};}}},fetch:()=>assert.fail('No product endpoint may be fetched')});
 await elements.find(node=>node.tag==='button').click({isTrusted:true});
 assert.equal(messages.length,1);
 return messages[0].snapshot;
}

test('collector chooses structured subject, then product-specific heading, metadata, document; never generic shop h1',async()=>{
 assert.equal((await collectTitle({subject:'合成测试商品',productTitle:'Visible heading'})).title,'合成测试商品');
 assert.equal((await collectTitle({productTitle:'Visible product heading'})).title,'Visible product heading');
 assert.equal((await collectTitle()).title,'Synthetic shop metadata');
 assert.equal((await collectTitle({metaTitle:''})).title,'Synthetic document title');
});
