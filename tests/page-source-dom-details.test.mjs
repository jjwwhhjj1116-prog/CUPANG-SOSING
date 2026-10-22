import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFragment} from 'parse5';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {readPageDomDetails,waitForPageDomDetails} from '../extensions/supplier-hub/page-dom-details.mjs';

const sourceUrl='https://detail.1688.com/offer/700000000795.html',cdn=name=>`https://cbu01.alicdn.com/synthetic-details-${name}.jpg`;
function dom(html){
 const matches=(node,selector)=>selector.split(',').some(piece=>{
  piece=piece.trim();const parts=piece.split(/\s+(?![^\[]*\])/u);if(parts.length>1){const end=parts.pop();if(!matches(node,end))return false;for(let parent=node.parentElement;parent;parent=parent.parentElement)if(matches(parent,parts.join(' ')))return true;return false;}
  const role=/^\[([^=]+)="([^"]+)"\]$/u.exec(piece);if(role)return node.getAttribute(role[1])===role[2];
  const id=/^#([\w-]+)$/u.exec(piece);if(id)return node.getAttribute('id')===id[1];
  const klass=/^(?:([\w-]+))?\.([\w-]+)$/u.exec(piece);if(klass)return(!klass[1]||node.tagName===klass[1].toUpperCase())&&(node.getAttribute('class')??'').split(/\s+/u).includes(klass[2]);
  return node.tagName===piece.toUpperCase();
 });
 const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
 const wrap=(raw,parent=null)=>{
  const attrs=new Map((raw.attrs??[]).map(pair=>[pair.name,pair.value]));
  const node={tagName:raw.tagName?.toUpperCase(),nodeName:raw.nodeName,nodeType:raw.nodeName==='#text'?3:1,nodeValue:raw.value,children:[],childNodes:[],parentElement:parent,
   getAttribute:name=>attrs.get(name)??null,setAttribute(name,value){attrs.set(name,value);},matches(selector){return matches(node,selector);},
   contains(other){for(let current=other;current;current=current.parentElement)if(current===node)return true;return false;},
   querySelectorAll(selector){return descendants(node).filter(child=>matches(child,selector));},querySelector(selector){return node.querySelectorAll(selector)[0]??null;}};
  node.childNodes=(raw.childNodes??[]).map(child=>wrap(child,node));node.children=node.childNodes.filter(child=>child.nodeType!==3);
  Object.defineProperty(node,'textContent',{get:()=>raw.nodeName==='#text'?raw.value:node.childNodes.map(child=>child.textContent).join('')});
  return node;
 };return wrap(parseFragment(html));
}
const img=(name,attribute='data-src')=>`<img src="data:image/gif;base64,placeholder" ${attribute}="${cdn(name)}">`;

test('Chinese named description retains ordered lazy images and text while gallery/recommend/shop/frame content stays excluded',()=>{
 const document=dom(`<div class="detail-gallery">${img('gallery')}</div><aside><section><h2>商品详情</h2>${img('sidebar')}</section></aside>
  <section><h2>商品详情</h2><p>硅胶<strong>后跟保护贴</strong></p>${img('one','data-lazyload-src')}${img('two','data-original')}
   <div class="recommendations">${img('recommend')}<p>不属于当前商品</p></div><a href="https://detail.1688.com/offer/700000000796.html">其他商品名称${img('other-offer')}</a>
   <section><h3>猜你喜欢</h3>${img('related')}</section><iframe src="https://foreign.invalid/detail">${img('frame')}</iframe><script>not product text</script></section>`);
 const frame=document.querySelector('iframe');Object.defineProperty(frame,'contentWindow',{get:()=>assert.fail('Frames must never be read')});
 const result=readPageDomDetails(document,sourceUrl);
 assert.deepEqual(result.detailImages,[cdn('one'),cdn('two')]);assert.match(result.description,/硅胶后跟保护贴/);
 assert.doesNotMatch(result.description,/不属于|not product|猜你喜欢|其他商品名称/);
});

test('exact legacy containers and explicitly named module survive without class-name guessing or duplicate pictures',()=>{
 const document=dom(`<div class="gallery">${img('gallery')}</div><div id="desc-lazyload-container"><p>中文详情</p>${img('old','data-ks-lazyload')}
 <div class="offer-description">${img('old','data-original-src')}${img('second','data-lazy-src')}</div></div>
 <div data-module-name="description">${img('module','data-lazyload')}</div><div class="some-detail-random">${img('unscoped')}</div>`);
 assert.deepEqual(readPageDomDetails(document,sourceUrl).detailImages,[cdn('old'),cdn('second'),cdn('module')]);
});

test('invalid early lazy sources cannot hide an allowed alternative, and foreign/active protocols never enter details',()=>{
 const document=dom(`<section><h3>图文详情</h3><img src="${cdn('cdn-placeholder')}" data-src="https://foreign.invalid/image.jpg" data-original="${cdn('allowed')}">
 <img src="javascript:alert(1)"><img data-original="http://cbu01.alicdn.com/no.jpg"><img data-lazy-src="https://user:secret@cbu01.alicdn.com/no.jpg"></section>`);
 assert.deepEqual(readPageDomDetails(document,sourceUrl).detailImages,[cdn('allowed')]);
});

test('passive settling reads lazily appearing same-page details with a hard six-tick bound and source checks',async()=>{
 let document=dom('<section><h2>商品详情</h2><p>正在加载</p></section>'),ticks=0,checks=0;
 const proxy={querySelectorAll:selector=>document.querySelectorAll(selector)};
 const result=await waitForPageDomDetails(proxy,sourceUrl,{assertCurrent(){checks++;},wait:async ms=>{assert.equal(ms,250);if(++ticks===2)document=dom('<section><h2>商品详情</h2><p>商品原文</p>'+img('loaded')+'</section>');}});
 assert.deepEqual(result.detailImages,[cdn('loaded')]);assert.equal(ticks,4);assert.equal(checks,6);
 let emptyTicks=0;const empty=await waitForPageDomDetails(dom('<p>no description region</p>'),sourceUrl,{wait:async()=>{emptyTicks++;}});
 assert.equal(emptyTicks,6);assert.deepEqual(empty.detailImages,[]);
});

test('a changed offer during passive settling aborts capture without reading frames or retrying the new offer',async()=>{
 let changed=false,reads=0;const document={querySelectorAll(){reads++;return [];}};
 await assert.rejects(()=>waitForPageDomDetails(document,sourceUrl,{wait:async()=>{changed=true;},assertCurrent(){if(changed)throw Error('changed synthetic offer');}}),/changed synthetic offer/);
 assert.equal(reads,3);
});

const bundled=await build({entryPoints:[fileURLToPath(new URL('../deployment/extension-page-collector.mjs',import.meta.url))],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120'});
test('the actual trusted entry waits for seven description images and sends one snapshot without any source request',async()=>{
 let description=dom('<section><h2>商品详情</h2><p>详情正在显示</p></section>'),ticks=0;const nodes=[],messages=[];
 const document={title:'合成后跟保护贴',scripts:[{textContent:JSON.stringify({subject:'合成后跟保护贴',skuModel:{offerId:'700000000795',skuInfoMap:{black:{skuId:'synthetic-black',specAttrs:'黑色',price:'0.28'}}},offerImgList:[cdn('main')]})}],
  getElementById:()=>null,documentElement:{append(){}},querySelectorAll:selector=>description.querySelectorAll(selector),
  querySelector(selector){return selector==='.price-container'?{textContent:'¥0.28 1件起批'}:description.querySelector(selector);},
  createElement(tag){const node={tag,id:'',style:{},textContent:'',hidden:false,disabled:false,setAttribute(){},append(){},attachShadow(){return{append(){}};},addEventListener(type,handler){if(type==='click')node.click=handler;}};nodes.push(node);return node;}};
 const window={};window.top=window;
 vm.runInNewContext(bundled.outputFiles[0].text,{window,document,location:{href:sourceUrl},URL,Date,Error,TextEncoder,
  setTimeout(callback,ms){assert.equal(ms,250);if(++ticks===2)description=dom('<section><h2>商品详情</h2><p>硅胶后跟保护贴中文原文</p>'+Array.from({length:7},(_,index)=>img('detail-'+index,'data-original')).join('')+'</section>');queueMicrotask(callback);return ticks;},
  chrome:{runtime:{sendMessage:async message=>{messages.push(message);return{ok:true,delivered:true};}}},fetch:()=>assert.fail('The collector must not fetch source HTML/images')});
 const button=nodes.find(node=>node.tag==='button');await button.click({isTrusted:false});assert.equal(messages.length,0);
 await button.click({isTrusted:true});assert.equal(messages.length,1);assert.equal(button.textContent,'수집 완료');
 assert.deepEqual(Array.from(messages[0].snapshot.images.filter(image=>image.role==='detail'),image=>image.url),Array.from({length:7},(_,index)=>cdn('detail-'+index)));
 assert.match(messages[0].snapshot.description,/硅胶后跟保护贴中文原文/);assert.ok(ticks<=6);
});
