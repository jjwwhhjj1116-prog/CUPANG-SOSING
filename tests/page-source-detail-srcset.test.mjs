import test from 'node:test';
import assert from 'node:assert/strict';
import {readPageDomDetails} from '../extensions/supplier-hub/page-dom-details.mjs';
import {productDocument} from './helpers/product-document.mjs';

const sourceUrl='https://detail.1688.com/offer/700000000927.html';
const cdn=name=>`https://cbu01.alicdn.com/synthetic-srcset-${name}.jpg`;
const attribute=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;');
const read=html=>readPageDomDetails(productDocument(`<section><h2>商品详情</h2>${html}</section>`),sourceUrl).detailImages;
const image=(srcset,extra='')=>`<img src="${cdn('fallback')}" srcset="${attribute(srcset)}" ${extra}>`;

test('detail IMG uses the largest observed width candidate instead of the displayed or lazy thumbnail',()=>{
 const result=read(image(`${cdn('small')}_300x300.jpg 300w, ${cdn('large')} 1600w, ${cdn('medium')} 800w`,`data-src="${cdn('lazy-thumbnail')}"`));
 assert.deepEqual(result,[cdn('large')]);
});

test('density candidates include descriptorless 1x and choose positive finite decimal or exponent maxima',()=>{
 for(const [srcset,expected]of [
  [`${cdn('implicit')}, ${cdn('half')} .5x, ${cdn('retina')} 2.5x`,cdn('retina')],
  [`${cdn('retina')} 2x, ${cdn('exponent')} 3e0x, ${cdn('implicit')}`,cdn('exponent')],
  [`${cdn('implicit')}, ${cdn('half')} 0.5x`,cdn('implicit')],
 ])assert.deepEqual(read(image(srcset)),[expected]);
});

test('commas inside an observed URL are preserved without inventing or rewriting a CDN URL',()=>{
 const largest=cdn('large,original')+'?x-oss-process=image/resize,w_1600,h_1200';
 const srcset=`${cdn('small')} 400w,${largest} 1600w`;
 assert.deepEqual(read(image(srcset)),[largest]);
});

test('data-srcset and srcset compare only the same descriptor unit and retain lazy priority for incomparable sets',()=>{
 const cases=[
  {lazy:`${cdn('lazy-small')} 400w, ${cdn('lazy-large')} 1200w`,normal:`${cdn('normal-large')} 1600w`,expected:cdn('normal-large')},
  {lazy:`${cdn('lazy-large')} 2x`,normal:`${cdn('normal-large')} 3x`,expected:cdn('normal-large')},
  {lazy:`${cdn('lazy-large')} 800w`,normal:`${cdn('normal-large')} 3x`,expected:cdn('lazy-large')},
  {lazy:`${cdn('invalid')} 800w 2x`,normal:`${cdn('normal-large')} 2x`,expected:cdn('normal-large')},
 ];
 for(const row of cases)assert.deepEqual(read(image(row.normal,`data-srcset="${attribute(row.lazy)}"`)),[row.expected]);
});

test('malformed descriptors, mixed units, control characters and excessive sets preserve an ordinary lazy fallback',()=>{
 const bad=[
  `${cdn('one')} 400w, ${cdn('two')} 2x`,`${cdn('one')} 400w, ${cdn('two')}`,
  `${cdn('one')} 400w 2x`,`${cdn('one')} 2x 3x`,`${cdn('one')} 2h`,`${cdn('one')} 0w`,
  `${cdn('one')} -1x`,`${cdn('one')} +2x`,`${cdn('one')} 2.x`,`${cdn('one')} Infinityx`,
  `${cdn('one')} 1e999x`,`${cdn('one')} 9007199254740992w`,`${cdn('one')} 0x`,
  `${cdn('one')},, ${cdn('two')} 2x`,`, ${cdn('one')} 2x`,`${cdn('one')} 2x,`,
  `${cdn('one')} 1x\u0007`,`${cdn('one')} 2x,`+' '.repeat(16384),
  Array.from({length:65},(_,index)=>`${cdn(String(index))} ${index+1}w`).join(', '),
 ];
 for(const srcset of bad)assert.deepEqual(read(image(srcset,`data-original="${cdn('lazy-fallback')}"`)),[cdn('lazy-fallback')],srcset.slice(0,160));
});

test('candidate URLs share the existing HTTPS alicdn bounds and invalid hosts cannot win by declaring a larger width',()=>{
 const bad=[
  'https://foreign.invalid/large.jpg','http://cbu01.alicdn.com/large.jpg','https://cbu01.alicdn.com.foreign.invalid/large.jpg',
  'https://user:secret@cbu01.alicdn.com/large.jpg','https://cbu01.alicdn.com:8443/large.jpg',
  'https://cbu01.alicdn.com/large.jpg#fragment','javascript:alert(1)','data:image/png;base64,AAAA',
 ];
 for(const url of bad){
  assert.deepEqual(read(image(`${url} 9000w`)),[cdn('fallback')]);
  assert.deepEqual(read(image(`${cdn('allowed')} 800w, ${url} 9000w`)),[cdn('allowed')]);
 }
 assert.deepEqual(read(image('//cbu01.alicdn.com/synthetic-srcset-relative.jpg 1600w')),[cdn('relative')]);
});

test('chosen sources retain DOM and background order, deduplicate exact URLs and never read excluded roots or frames',()=>{
 const document=productDocument(`<div class="gallery"><img srcset="${cdn('gallery')} 9999w"></div><section><h2>商品详情</h2>
  <div id="before"></div>${image(`${cdn('one')} 400w, ${cdn('two')} 1600w`)}
  <img srcset="${cdn('two')} 2x"><div id="after"></div>
  <div class="recommendations"><img id="excluded" srcset="${cdn('recommend')} 9999w"></div><iframe></iframe></section>`);
 document.defaultView={getComputedStyle(node){const id=node.getAttribute('id');return{backgroundImage:['before','after'].includes(id)?`url("${cdn(id)}")`:'none'};}};
 const excluded=document.querySelector('#excluded'),get=excluded.getAttribute;
 excluded.getAttribute=name=>{assert.ok(!['srcset','data-srcset'].includes(name),'No excluded candidate read');return get(name);};
 Object.defineProperty(document.querySelector('iframe'),'contentWindow',{get:()=>assert.fail('No frame access')});
 assert.deepEqual(readPageDomDetails(document,sourceUrl).detailImages,['before','two','after'].map(cdn));
 assert.throws(()=>readPageDomDetails(document,'https://foreign.invalid/offer/700000000927.html'),/1688 상품 본문/);
});

test('equal maximum descriptors use their first observed URL and a missing srcset keeps every existing fallback priority',()=>{
 assert.deepEqual(read(image(`${cdn('first')} 1600w, ${cdn('second')} 1600w`)),[cdn('first')]);
 assert.deepEqual(read(`<img data-src="${cdn('lazy-first')}" src="${cdn('displayed')}" data-original="${cdn('original')}">`),[cdn('lazy-first')]);
});
