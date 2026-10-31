import test from 'node:test';
import assert from 'node:assert/strict';
import {readPageDomDetails,waitForPageDomDetails} from '../extensions/supplier-hub/page-dom-details.mjs';
import {productDocument} from './helpers/product-document.mjs';

const sourceUrl='https://detail.1688.com/offer/700000000808.html';
const cdn=name=>`https://cbu01.alicdn.com/synthetic-background-${name}.jpg`;
const css=name=>`url("${cdn(name)}")`;
// Model browser-computed backgroundImage values without loading CSS, images,
// frames or external documents. These are fixtures, not a live-site capture.
function styled(html,backgrounds,{forbidden=[]}={}){
 const document=productDocument(html),reads=[];
 document.defaultView={getComputedStyle(node){
  const id=node.getAttribute('id');assert.ok(!forbidden.includes(id),'Excluded or unscoped style was read: '+id);
  assert.ok(node.tagName!=='BODY'&&node.tagName!=='HTML','Document-wide styles must not be read');
  reads.push(id);return{backgroundImage:backgrounds[id]??'none'};
 }};
 return{document,reads};
}

test('verified richtext roots retain CSS background images including multiple url layers and deduplicate ordinary images',()=>{
 const {document,reads}=styled(`<div class="detail-desc-decorate-richtext" id="root"><p>현재 상품 설명</p>
  <img data-src="${cdn('same')}"><div id="one"></div><div id="layers"></div>
  <div class="offer-description" id="nested"><img src="${cdn('same')}"><div id="last"></div></div></div>`,
 {root:css('root'),one:css('same'),layers:`${css('second')}, url('${cdn('third')}')`,last:`url(${cdn('last')})`});
 const result=readPageDomDetails(document,sourceUrl);
 assert.deepEqual(result.detailImages,['root','same','second','third','last'].map(cdn));
 assert.equal(result.description,'현재 상품 설명');assert.equal(reads.filter(id=>id==='nested').length,1);
});

test('semantic and exact-module detail roots support backgrounds without searching unrelated document styles',()=>{
 for(const heading of ['商品详情','제품 상세 정보']){
  const {document,reads}=styled(`<div id="unscoped" class="random-detail-content"></div><section id="semantic"><h3>${heading}</h3><div id="body-image"></div></section>
   <div data-module-name="description" id="module"><p>추가 상세 설명</p></div>`,
  {unscoped:css('unscoped'),semantic:css('semantic'),'body-image':css('body'),module:css('module')},{forbidden:['unscoped']});
  assert.deepEqual(readPageDomDetails(document,sourceUrl).detailImages,['module','semantic','body'].map(cdn));
  assert.ok(!reads.includes('unscoped'));
 }
});

test('recommendations, reviews, gallery, SKU, foreign offers, navigation, attributes and frames are excluded before their styles are read',()=>{
 const blocked=['recommend','review','gallery','sku','shop','foreign','nav','attributes','packaging','frame','side'];
 const {document}=styled(`<div class="offer-description"><p>현재 상세 원문</p><div id="own"></div>
  <div class="recommendations" id="recommend"><div id="recommend-child"></div></div><div class="buyerReview" id="review"></div>
  <div class="gallery" id="gallery"></div><div class="sku-image" id="sku"></div><div class="shop-card" id="shop"></div>
  <a href="https://detail.1688.com/offer/700000000809.html" id="foreign"><div id="foreign-child"></div></a>
  <nav id="nav"></nav><section id="attributes"><h3>商品属性</h3></section><section id="packaging"><h3>包装信息</h3></section>
  <iframe id="frame"></iframe><aside id="side"></aside><a href="${sourceUrl}" id="same-offer"></a></div>`,
 Object.fromEntries([...blocked,'recommend-child','foreign-child','own','same-offer'].map(id=>[id,css(id)])),{forbidden:[...blocked,'recommend-child','foreign-child']});
 Object.defineProperty(document.querySelector('iframe'),'contentWindow',{get:()=>assert.fail('No frame access')});
 assert.deepEqual(readPageDomDetails(document,sourceUrl).detailImages,[cdn('own'),cdn('same-offer')]);
});

test('CSS image URLs retain the same host/protocol/credential bounds and never interpret arbitrary CSS functions or escapes',()=>{
 const values=[
  'url("https://foreign.invalid/photo.jpg")','url("http://cbu01.alicdn.com/photo.jpg")','url("javascript:alert(1)")',
  'url("data:image/png;base64,AAAA")','url("https://user:password@cbu01.alicdn.com/photo.jpg")',
  'url("https://cbu01.alicdn.com:8443/photo.jpg")','url("https://cbu01.alicdn.com/photo.jpg#fragment")',
  `image-set(${css('image-set')} 1x)`,`linear-gradient(red, blue), ${css('gradient')}`,
  `content: ${css('style-text')}`,`url("https://cbu01.alicdn.com/escaped\\20 image.jpg")`,`${css('trailing')},`,
  `${css('unclosed')};color:red`, 'url("https://cbu01.alicdn.com/line\nimage.jpg")',
 ];
 const {document}=styled('<div class="offer-description">'+values.map((_,index)=>`<div id="bad-${index}"></div>`).join('')+'<div id="mixed"></div></div>',
 {...Object.fromEntries(values.map((value,index)=>['bad-'+index,value])),mixed:`url("https://foreign.invalid/no.jpg"), ${css('allowed')}`});
 assert.deepEqual(readPageDomDetails(document,sourceUrl).detailImages,[cdn('allowed')]);
});

test('scoped background traversal retains hard element/image bounds and unavailable computed styles do not invent values',()=>{
 const tooMany=styled('<div class="offer-description">'+Array.from({length:201},(_,index)=>`<div id="image-${index}"></div>`).join('')+'</div>',
 Object.fromEntries(Array.from({length:201},(_,index)=>['image-'+index,css('image-'+index)])));
 assert.throws(()=>readPageDomDetails(tooMany.document,sourceUrl),/상세 이미지가 200개/);
 const manyElements=styled('<div class="offer-description">'+'<p></p>'.repeat(6000)+'</div>',{});
 assert.throws(()=>readPageDomDetails(manyElements.document,sourceUrl),/배경 이미지 영역.*크기/);
 const missing=productDocument(`<div class="offer-description" style='background-image:${css('unread')}'></div>`);
 assert.deepEqual(readPageDomDetails(missing,sourceUrl).detailImages,[]);
 missing.defaultView={getComputedStyle(){throw Error('unavailable');}};
 assert.deepEqual(readPageDomDetails(missing,sourceUrl).detailImages,[]);
});

test('an extension global computed-style reader works without pseudo-element or non-background property reads',()=>{
 const document=productDocument('<section><h2>商品详情</h2><div id="computed"></div></section>');
 const previous=Object.getOwnPropertyDescriptor(globalThis,'getComputedStyle');
 Object.defineProperty(globalThis,'getComputedStyle',{configurable:true,value(...args){
  assert.equal(args.length,1,'Pseudo-element styles must not be inspected');
  return new Proxy({backgroundImage:args[0].getAttribute('id')==='computed'?css('global'):'none'},
   {get(target,key){assert.equal(key,'backgroundImage');return target[key];}});
 }});
 try{assert.deepEqual(readPageDomDetails(document,sourceUrl).detailImages,[cdn('global')]);}
 finally{if(previous)Object.defineProperty(globalThis,'getComputedStyle',previous);else delete globalThis.getComputedStyle;}
});

test('passive settling detects computed backgrounds appearing later inside the same verified root',async()=>{
 const {document}=styled('<section><h2>商品详情</h2><div id="late"></div></section>',{});
 let ticks=0,checks=0;
 document.defaultView.getComputedStyle=node=>({backgroundImage:ticks>=2&&node.getAttribute('id')==='late'?css('late'):'none'});
 const result=await waitForPageDomDetails(document,sourceUrl,{assertCurrent(){checks++;},wait:async ms=>{assert.equal(ms,250);ticks++;}});
 assert.deepEqual(result.detailImages,[cdn('late')]);assert.equal(ticks,4);assert.equal(checks,6);
});
