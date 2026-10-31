import test from 'node:test';
import assert from 'node:assert/strict';
import {readPageDomDetails} from '../extensions/supplier-hub/page-dom-details.mjs';
import {createPageCaptureObservations} from '../extensions/supplier-hub/page-capture-observations.mjs';
import {extractPageSource} from '../extensions/supplier-hub/page-source.mjs';
import {productDocument} from './helpers/product-document.mjs';

const offerId='700000000898',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const cdn=name=>`https://cbu01.alicdn.com/synthetic-detail-order-${name}.jpg`;
const expected=['first','second','third'].map(cdn);
const scripts=[JSON.stringify({skuModel:{offerId,skuInfoMap:{black:{skuId:'synthetic-order-898',specAttrs:'black',price:'1'}}},offerImgList:[cdn('gallery')]})];
function fixture(){
 const document=productDocument(`<div class="detail-gallery"><img src="${cdn('gallery')}"></div>
  <section id="details"><h2>商品详情</h2><div id="first"></div><img data-src="${cdn('second')}"><div id="third"></div></section>`);
 document.defaultView={getComputedStyle(node){return {backgroundImage:['first','third'].includes(node.getAttribute('id'))?`url("${cdn(node.getAttribute('id'))}")`:'none'};}};
 const root=document.querySelector('#details'),children=[...root.children];
 return{document,root,children,read:()=>readPageDomDetails(document,sourceUrl),
  onlySecond(){root.children=children.filter(node=>!['first','third'].includes(node.getAttribute('id')));},
  restore(){root.children=[...children];}};
}
function source(detail){return extractPageSource({sourceUrl,scripts,title:'Synthetic detail order',priceText:'¥1',...detail});}

test('actual DOM reader, click observations and source normalization retain background/IMG/background order without gallery promotion',()=>{
 const f=fixture(),detail=f.read();assert.deepEqual(detail.detailImages,expected);
 const capture=createPageCaptureObservations(sourceUrl);capture.add(null,detail);
 const snapshot=source(capture.result().detail);
 assert.deepEqual(snapshot.images.filter(row=>row.role==='detail').map(row=>row.url),expected);
 assert.deepEqual(snapshot.images.filter(row=>row.url===cdn('gallery')).map(row=>row.role),['main']);
});

test('a fuller same-document same-root observation restores earlier lazy photos in their actual DOM order',()=>{
 const f=fixture(),capture=createPageCaptureObservations(sourceUrl);f.onlySecond();capture.add(null,f.read());
 assert.deepEqual(capture.result().detail.detailImages,[cdn('second')]);
 f.restore();capture.add(null,f.read());
 assert.deepEqual(capture.result().detail.detailImages,expected);
 assert.deepEqual(source(capture.result().detail).images.filter(row=>row.role==='detail').map(row=>row.url),expected);
});

test('equal-set rearrangements, contradictory expansions and partial retreats never erase the existing proven order',()=>{
 const f=fixture(),capture=createPageCaptureObservations(sourceUrl);capture.add(null,f.read());
 const heading=f.children[0];
 f.root.children=[heading,f.children[3],f.children[2],f.children[1]];
 capture.add(null,f.read());assert.deepEqual(capture.result().detail.detailImages,expected);
 f.onlySecond();capture.add(null,f.read());assert.deepEqual(capture.result().detail.detailImages,expected);
 const extra=productDocument(`<img src="${cdn('fourth')}">`).querySelector('img');extra.parentElement=f.root;
 f.root.children=[heading,f.children[1],f.children[3],f.children[2],extra];
 capture.add(null,f.read());assert.deepEqual(capture.result().detail.detailImages,[...expected,cdn('fourth')]);
});

test('serialized lists and replacement documents or root scopes cannot claim authority to reorder earlier photos',()=>{
 for(const variant of ['serialized','document','roots']){
  const f=fixture(),capture=createPageCaptureObservations(sourceUrl);f.onlySecond();capture.add(null,f.read());f.restore();
  let detail;
  if(variant==='serialized')detail=structuredClone(f.read());
  else if(variant==='document')detail=fixture().read();
  else{
   const extra=productDocument(`<section><h2>商品详情</h2><img src="${cdn('fourth')}"></section>`).querySelector('section');
   const body=f.document.querySelector('body');extra.parentElement=body;body.children.push(extra);detail=f.read();
  }
  capture.add(null,detail);
  assert.deepEqual(capture.result().detail.detailImages,[cdn('second'),cdn('first'),cdn('third'),...(variant==='roots'?[cdn('fourth')]:[])],variant);
 }
});

test('mixed-root contributions cannot later be relabelled as one complete ordered observation',()=>{
 const f=fixture(),capture=createPageCaptureObservations(sourceUrl);f.onlySecond();capture.add(null,f.read());
 capture.add(null,{description:'',detailImages:[cdn('first')]});f.restore();capture.add(null,f.read());
 assert.deepEqual(capture.result().detail.detailImages,[cdn('second'),cdn('first'),cdn('third')]);
});
