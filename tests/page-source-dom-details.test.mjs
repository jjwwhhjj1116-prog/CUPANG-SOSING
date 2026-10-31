import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFragment} from 'parse5';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {readPageDomDetails,waitForPageDomDetails} from '../extensions/supplier-hub/page-dom-details.mjs';
import {pageCollectorDom} from './helpers/page-collector-dom.mjs';

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

test('Chrome-translated nested font/div detail heading selects only its bounded current-product body and ordered lazy images',()=>{
 const document=dom(`<nav><div><font>제품 상세 정보</font></div>${img('nav')}</nav>
 <div class="shop-card"><div><font>제품 상세 정보</font></div>${img('shop')}</div>
 <div class="shopCard"><div><font>제품 상세 정보</font></div>${img('shop-camel')}</div>
 <div class="storeCard"><div><font>제품 상세 정보</font></div>${img('store-camel')}</div>
 <div><div><font style="vertical-align: inherit"><font>제품 상세 정보</font></font></div>
  <div><p>현재 상품의 상세 설명</p>${img('translated-one','data-lazyload-src')}${img('translated-two','data-original')}</div>
  <div><div><font><font>추천 상품</font></font></div><p>다른 추천 상품</p>${img('recommended')}</div>
  <div><div><font>제품 속성</font></div><p>속성 표 원문</p>${img('attributes')}</div>
  <div><div><font>포장 정보</font></div><p>포장 표 원문</p>${img('packaging')}</div>
  <a href="https://detail.1688.com/offer/700000000796.html"><div>다른 상품 본문</div>${img('other-offer')}</a>
  <iframe src="https://foreign.invalid/details"></iframe>
 </div><div><div>제품 속성</div>${img('adjacent-attributes')}</div>
 <div><div>포장 정보</div>${img('adjacent-packaging')}</div><div><div>관련 상품</div>${img('adjacent-recommendation')}</div>`);
 Object.defineProperty(document.querySelector('iframe'),'contentWindow',{get:()=>assert.fail('Frames must never be read')});
 const query=document.querySelectorAll;document.querySelectorAll=selector=>{assert.notEqual(selector,'img','No document-wide image fallback');assert.doesNotMatch(selector,/\bbody\b/);return query(selector);};
 const result=readPageDomDetails(document,sourceUrl);
 assert.deepEqual(result.detailImages,[cdn('translated-one'),cdn('translated-two')]);
 assert.equal(result.description,'현재 상품의 상세 설명');
});

test('exact translated semantic headings work while loose labels, header/navigation and other-offer wrappers stay excluded',()=>{
 for(const label of ['상품 상세 정보','제품 상세','상품 설명','상세 설명']){
  const document=dom(`<header><div>${label}</div>${img('header')}</header><div role="navigation"><div>${label}</div>${img('navigation')}</div>
   <a href="https://detail.1688.com/offer/700000000796.html"><section><h2>${label}</h2>${img('foreign')}</section></a>
   <section><h2><font><font>${label}</font></font></h2><p>상품 본문</p>${img('local')}</section>
   <div><div>${label} 더 보기</div>${img('loose')}</div>`);
  const result=readPageDomDetails(document,sourceUrl);assert.deepEqual(result.detailImages,[cdn('local')]);assert.equal(result.description,'상품 본문');
 }
 const unscoped=dom('<div><font>제품 상세 정보</font></div>'+img('outside')+'<div>범위가 없는 본문</div>');
 assert.deepEqual(readPageDomDetails(unscoped,sourceUrl),{description:'',detailImages:[]});
});

test('a preceding independent attribute or recommendation section cannot exclude the following detail section',()=>{
 for(const [before,detail]of [['商品属性','商品详情'],['猜你喜欢','商品详情'],['제품 속성','제품 상세 정보'],['추천 상품','제품 상세 정보']]){
  for(const tag of ['section','article','div role="tabpanel"']){
   const closing=tag.split(' ')[0];
   const document=dom(`<div><${tag}><h3>${before}</h3></${closing}><section><h3><font>${detail}</font></h3><p>현재 상세 본문</p>${img('adjacent-local')}</section></div>`);
   const result=readPageDomDetails(document,sourceUrl);assert.deepEqual(result.detailImages,[cdn('adjacent-local')]);assert.equal(result.description,'현재 상세 본문');
  }
 }
});

test('translated heading discovery and scoped details retain explicit node, root, image and wrapper-depth bounds',()=>{
 assert.throws(()=>readPageDomDetails(dom('<div>다른 영역</div>'.repeat(6001)),sourceUrl),/상품 상세 제목 영역.*크기/);
 assert.throws(()=>readPageDomDetails(dom('<section></section>'.repeat(301)),sourceUrl),/상품 상세 구역.*크기/);
 assert.throws(()=>readPageDomDetails(dom(Array.from({length:31},(_,index)=>`<div><div>제품 상세 정보</div>${img('scope-'+index)}</div>`).join('')),sourceUrl),/상품 상세 영역이 너무 많/);
 assert.throws(()=>readPageDomDetails(dom('<div><div>제품 상세 정보</div>'+Array.from({length:201},(_,index)=>img('bound-'+index)).join('')+'</div>'),sourceUrl),/상세 이미지가 200개/);
 assert.deepEqual(readPageDomDetails(dom('<section><div>'+'<font>'.repeat(14)+'제품 상세 정보'+'</font>'.repeat(14)+'</div>'+img('too-deep')+'</section>'),sourceUrl).detailImages,[]);
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
 let changed=false,reads=0;const document={querySelectorAll(){assert.equal(changed,false,'No current-document read may follow the offer change');reads++;return [];}};
 await assert.rejects(()=>waitForPageDomDetails(document,sourceUrl,{wait:async()=>{changed=true;},assertCurrent(){if(changed)throw Error('changed synthetic offer');}}),/changed synthetic offer/);
 assert.equal(reads,5); // Bounded root/heading selectors plus exact tab/panel discovery; no second image scan.
});

const bundled=await build({entryPoints:[fileURLToPath(new URL('../deployment/extension-page-collector.mjs',import.meta.url))],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120'});
test('the actual trusted entry waits for seven translated-heading description images and sends one snapshot without any source request',async()=>{
 let description=dom('<div><div><font><font>제품 상세 정보</font></font></div><p>상세 표시 중</p></div>'),ticks=0;const messages=[];
 const {document,elements:nodes}=pageCollectorDom({title:'合成后跟保护贴',scripts:[{textContent:JSON.stringify({subject:'合成后跟保护贴',skuModel:{offerId:'700000000795',skuInfoMap:{black:{skuId:'synthetic-black',specAttrs:'黑色',price:'0.28'}}},offerImgList:[cdn('main')]})}],
  querySelectorAll:selector=>description.querySelectorAll(selector),
  querySelector(selector){return selector==='.price-container'?{textContent:'¥0.28 1件起批'}:description.querySelector(selector);}});
 const window={};window.top=window;
 vm.runInNewContext(bundled.outputFiles[0].text,{window,document,location:{href:sourceUrl},URL,Date,Error,TextEncoder,
  setTimeout(callback,ms){assert.equal(ms,250);if(++ticks===2)description=dom('<div><div><font><font>제품 상세 정보</font></font></div><p>硅胶后跟保护贴中文原文</p>'+Array.from({length:7},(_,index)=>img('detail-'+index,'data-original')).join('')+'</div><div><div>추천 상품</div>'+img('entry-recommendation')+'</div>');queueMicrotask(callback);return ticks;},
  chrome:{runtime:{sendMessage:async message=>{messages.push(message);return{ok:true,delivered:true};}}},fetch:()=>assert.fail('The collector must not fetch source HTML/images')});
 const button=nodes.find(node=>node.tag==='button');await button.click({isTrusted:false});assert.equal(messages.length,0);
 await button.click({isTrusted:true});assert.equal(messages.length,1);assert.equal(button.textContent,'수집 완료');
 assert.deepEqual(Array.from(messages[0].snapshot.images.filter(image=>image.role==='detail'),image=>image.url),Array.from({length:7},(_,index)=>cdn('detail-'+index)));
 assert.match(messages[0].snapshot.description,/硅胶后跟保护贴中文原文/);assert.ok(ticks<=6);
});
