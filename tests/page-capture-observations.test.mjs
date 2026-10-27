import test from 'node:test';
import assert from 'node:assert/strict';
import {createPageCaptureObservations} from '../extensions/supplier-hub/page-capture-observations.mjs';
import {extractPageSource} from '../extensions/supplier-hub/page-source.mjs';

const offerId='700000000794',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const names=['蝴蝶结后跟贴米色','蝴蝶结后跟贴粉色','蝴蝶结后跟贴黑色'];
const images=['https://cbu01.alicdn.com/virtual-detail-1.jpg','https://cbu01.alicdn.com/virtual-detail-2.jpg'];
const scripts=[JSON.stringify({skuModel:{offerId,skuInfoMap:Object.fromEntries(names.map((name,index)=>['color-'+index,{skuId:'synthetic-'+index,specAttrs:name,price:'0.28'}]))},offerImgList:['https://cbu01.alicdn.com/virtual-main.jpg']})];
const facts=(attributes=[],packaging=[])=>({format:'yoofam-page-dom-facts-v1',sourceUrl,offerId,attributes,packaging});
const detail=(description='',detailImages=[])=>({description,detailImages});

test('offer-bound virtualized observations retain attributes, each exact SKU weight and ordered detail photos',()=>{
 const collected=createPageCaptureObservations(sourceUrl);
 collected.add(facts([{name:'材质',value:'海绵'}]),detail());
 collected.add(facts([],names.map((name,index)=>({name,supplierSku:'synthetic-'+index,packaging:{source:'package-table',weightG:10}}))),detail());
 collected.add(null,detail('商品原文',[images[0]]));collected.add(null,detail('商品原文',images));
 const {facts:domFacts,detail:result}=collected.result();
 const snapshot=extractPageSource({sourceUrl,scripts,domFacts,description:result.description,detailImages:result.detailImages,title:'合成后跟贴',priceText:'¥0.28'});
 assert.deepEqual(snapshot.attributes,[{name:'材质',value:'海绵'}]);
 assert.deepEqual(snapshot.options.map(option=>option.packaging),names.map(()=>({source:'package-table',weightG:10})));
 assert.deepEqual(snapshot.images.filter(image=>image.role==='detail').map(image=>image.url),images);
 assert.ok(snapshot.options.every(option=>!Object.hasOwn(option.packaging,'widthMm')));
});

test('unbound observations, mismatching attribute values and unsafe image URLs fail instead of mixing data',()=>{
 const a=createPageCaptureObservations(sourceUrl);
 assert.throws(()=>a.add({...facts(),offerId:'700000000795'},detail()),/변경/);
 a.add(facts([{name:'材质',value:'海绵'}]),detail());
 assert.throws(()=>a.add(facts([{name:'材质',value:'棉'}]),detail()),/서로 다릅니다/);
 assert.throws(()=>a.add(null,detail('', ['https://example.com/not-product.jpg'])),/이미지/);
});

test('conflicting weights across viewports remain contradictory and cannot be silently chosen by order',()=>{
 const a=createPageCaptureObservations(sourceUrl),row={name:names[0],supplierSku:'synthetic-0',packaging:{source:'package-table',weightG:10}};
 a.add(facts([],[row]),detail());a.add(facts([],[{...row,packaging:{source:'package-table',weightG:20}}]),detail());
 assert.throws(()=>extractPageSource({sourceUrl,scripts,domFacts:a.result().facts,title:'合成后跟贴',priceText:'¥0.28'}),/속성·포장 표/);
});

test('growing descriptions replace their earlier fragments without duplicating or truncating later text',()=>{
 const a=createPageCaptureObservations(sourceUrl),first='원문 '.repeat(3000),full=first+'상세 내용 끝';
 a.add(null,detail(first));a.add(null,detail(full));a.add(null,detail(first));
 assert.equal(a.result().detail.description,full);
});

test('independent descriptions stay in order without guessing overlaps',()=>{
 const a=createPageCaptureObservations(sourceUrl);
 a.add(null,detail('첫 번째'));a.add(null,detail('두 번째'));a.add(null,detail('첫 번째 상세'));
 assert.equal(a.result().detail.description,'첫 번째 상세\n두 번째');
});
