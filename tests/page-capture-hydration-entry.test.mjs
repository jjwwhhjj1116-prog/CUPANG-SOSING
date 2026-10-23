import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {pageCollectorDom} from './helpers/page-collector-dom.mjs';
import {productDocument} from './helpers/product-document.mjs';

const bundle=await build({entryPoints:['deployment/extension-page-collector.mjs'],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120'});
const offerId='700000000807',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`,image=name=>`https://cbu01.alicdn.com/synthetic-hydration-${name}.jpg`;
const loaded=`<section><h2>商品属性</h2><div><span>材质</span><span>海绵</span></div></section>
 <section><h2>包装信息</h2><table><tr><th>颜色</th><th>重量(g)</th></tr><tr data-sku-id="synthetic-black"><td>黑色</td><td>10</td></tr></table></section>
 <section><h2>商品详情</h2><p>当前商品详情</p><img data-original="${image('detail')}"></section>`;
function events(target){
 const listeners=new Map();target.addEventListener=(type,listener)=>{const set=listeners.get(type)??new Set();set.add(listener);listeners.set(type,set);};
 target.removeEventListener=(type,listener)=>listeners.get(type)?.delete(listener);
 target.fire=(type,event={isTrusted:true})=>{for(const listener of listeners.get(type)??[])listener(event);};
 return()=>[...listeners.values()].reduce((sum,set)=>sum+set.size,0);
}
function harness({interrupt=false}={}){
 let page=productDocument('<p>加载中</p>'),now=Date.parse('2026-10-23T03:00:00.000Z'),waits=0;
 const data={subject:'合成商品',skuModel:{offerId,skuInfoMap:{black:{skuId:'synthetic-black',specAttrs:'黑色',price:'0.28'}}},offerImgList:[image('main')]};
 const {document,elements}=pageCollectorDom({scripts:[{textContent:JSON.stringify(data)}],querySelectorAll:selector=>page.querySelectorAll(selector),querySelector:selector=>selector==='.price-container'?{textContent:'¥0.28 1件起批'}:page.querySelector(selector)});
 const view={scrollX:7,scrollY:120,innerHeight:800},scrolls=[],messages=[];view.top=view;
 document.visibilityState='visible';document.scrollingElement={scrollHeight:20000};
 const viewListeners=events(view),documentListeners=events(document);
 view.scrollTo=({left,top,behavior})=>{assert.equal(behavior,'instant');scrolls.push({left,top});view.scrollX=left;view.scrollY=top;page=productDocument(top>=1700?loaded:'<p>加载中</p>');};
 class ClockDate extends Date{static now(){return now;}}
 const context={document,window:view,location:{href:sourceUrl},URL,Date:ClockDate,Error,TextEncoder,
  setTimeout(callback,ms){now+=ms;if(interrupt&&++waits===2){view.scrollY=999;view.fire('wheel');}queueMicrotask(callback);return waits;},
  chrome:{runtime:{sendMessage:async message=>{assert.equal(view.scrollY,120,'original position restored before the sole delivery');assert.equal(message.type,'YOOFAM_SAVE_PAGE_SOURCE');messages.push(structuredClone(message));return{ok:true,delivered:messages.length>1,message:'synthetic uncertain ACK'};}}},
  fetch:()=>assert.fail('Hydration never fetches source data')};
 vm.runInNewContext(bundle.outputFiles[0].text,context);
 return{document,view,scrolls,messages,context,button:elements.find(node=>node.tag==='button'),status:elements.find(node=>node.tag==='p'),listeners:()=>viewListeners()+documentListeners()};
}

test('trusted entry collects scroll-revealed attributes, exact option package and detail before restore; immutable retry never scrolls again',async()=>{
 const h=harness();await h.button.click({isTrusted:false});assert.equal(h.scrolls.length,0);assert.equal(h.messages.length,0);
 await h.button.click({isTrusted:true});assert.equal(h.messages.length,1);assert.equal(h.view.scrollY,120);assert.equal(h.listeners(),0);
 const captured=h.messages[0].snapshot;assert.deepEqual(captured.attributes,[{name:'材质',value:'海绵'}]);
 assert.deepEqual(captured.options[0].packaging,{source:'package-table',weightG:10});assert.deepEqual(captured.images.filter(row=>row.role==='detail'),[{url:image('detail'),role:'detail'}]);
 assert.equal(captured.description,'当前商品详情');assert.equal(h.button.textContent,'앱 전송 다시 시도');
 assert.ok(h.scrolls.length<=7);assert.ok(h.scrolls.every(row=>row.top<=3600));
 h.view.scrollTo=()=>assert.fail('The retained snapshot must never be hydrated again');
 await h.button.click({isTrusted:true});assert.equal(h.messages.length,2);assert.deepEqual(h.messages[1].snapshot,captured);assert.equal(h.button.textContent,'수집 완료');
});

test('trusted input during the actual entry hydration cancels the snapshot and leaves the user position intact',async()=>{
 const h=harness({interrupt:true});await h.button.click({isTrusted:true});
 assert.equal(h.messages.length,0);assert.equal(h.view.scrollY,999);assert.equal(h.listeners(),0);assert.equal(h.button.disabled,false);assert.match(h.status.textContent,/화면 조작/);
});
