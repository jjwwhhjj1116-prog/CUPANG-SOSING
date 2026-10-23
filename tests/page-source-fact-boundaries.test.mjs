import test from 'node:test';
import assert from 'node:assert/strict';
import {readPageDomFacts} from '../extensions/supplier-hub/page-dom-facts.mjs';
import {extractPageSource,readPageSourceDomFacts} from '../extensions/supplier-hub/page-source.mjs';
import {productDocument} from './helpers/product-document.mjs';

const offerId='700000000809',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const names=['米色','粉色','黑色'];
const scripts=[JSON.stringify({skuModel:{offerId,skuInfoMap:Object.fromEntries(names.map((name,index)=>[name,{skuId:'synthetic-'+index,specAttrs:name,price:'0.28'}]))},offerImgList:['https://cbu01.alicdn.com/synthetic-boundary-main.jpg']})];
const font=value=>`<font><font>${value}</font></font>`;
const attrTable='<table><tr><th>材质</th><td>海绵</td></tr></table>';
const packTable=(weight=10)=>'<table><tr><th>颜色</th><th>重量(g)</th></tr>'+names.map((name,index)=>`<tr data-sku-id="synthetic-${index}"><td>${name}</td><td>${weight}</td></tr>`).join('')+'</table>';
function sections({tag='section',translated=false}={}){
 const heading=value=>`<h3>${font(value)}</h3>`;
 return `<${tag}>${heading(translated?'제품 속성':'商品属性')}${attrTable}</${tag}><${tag}>${heading(translated?'포장 정보':'包装信息')}${packTable()}</${tag}>`;
}
function capture(html){
 const document=productDocument(html),domFacts=readPageSourceDomFacts(document,sourceUrl,scripts);
 return extractPageSource({sourceUrl,scripts,domFacts,title:'合成后跟贴',priceText:'¥0.28'});
}

// This is a semantic layout regression fixture, not a retained live DOM or a
// claim that capture 8 used this exact structure.
test('a leading review/recommendation heading does not erase separately headed sibling product sections',()=>{
 for(const label of ['商品评价','同款推荐','제품 리뷰','동일한 스타일 추천'])for(const tag of ['section','article','div'])for(const translated of [false,true]){
  const source=capture(`<div><h2>${font(label)}</h2><p>앞 구역 안내</p>${sections({tag,translated})}</div>`);
  assert.deepEqual(source.attributes,[{name:'材质',value:'海绵'}]);
  assert.deepEqual(source.options.map(row=>[row.supplierSku,row.packaging]),names.map((_,index)=>['synthetic-'+index,{source:'package-table',weightG:10}]));
 }
});

test('a local product heading never overrides an explicit unrelated ancestor or other-offer identity',()=>{
 const wrappers=[['<nav>','</nav>'],['<aside>','</aside>'],['<footer>','</footer>'],['<div role="navigation">','</div>'],['<div role="tab">','</div>'],
  ['<a href="https://detail.1688.com/offer/700000000999.html">','</a>'],
  ...['recommendations','review-zone','buyerReview','offer-card','shop-card','related-products'].map(name=>[`<div class="${name}">`,'</div>'])];
 for(const [open,close]of wrappers){
  const source=capture(open+'<div><h2>商品评价</h2>'+sections()+'</div>'+close);
  assert.deepEqual(source.attributes,[]);assert.ok(source.options.every(row=>row.packaging===undefined));
 }
});

test('unlabelled tables under an unrelated heading remain excluded and cannot borrow later product headings',()=>{
 const document=productDocument('<div><h2>商品评价</h2>'+attrTable+packTable(999)+'</div>'+sections());
 const facts=readPageDomFacts(document);
 assert.deepEqual(facts.attributes,[{name:'材质',value:'海绵'}]);
 assert.deepEqual(facts.packaging.map(row=>row.packaging.weightG),[10,10,10]);
 assert.equal(readPageDomFacts(productDocument('<div><h2>商品评价</h2>'+attrTable+packTable(999)+'</div>')),null);
});

test('a nearer unrelated subsection excludes its rows even inside a valid product section',()=>{
 const attributes='<section><h3>商品属性</h3>'+attrTable+'<div><h4>同款推荐</h4><table><tr><th>错误材质</th><td>其他商品</td></tr></table></div></section>';
 const packaging='<section><h3>包装信息</h3>'+packTable()+'<div><h4>商品评价</h4>'+packTable(999)+'</div></section>';
 // Mixed local sections cannot be expanded into one apparent product table.
 assert.throws(()=>capture(attributes+packaging),/속성·포장 표/u);
 const linked='<nav role="tablist"><button id="a" role="tab" aria-controls="p">商品属性</button></nav><section role="tabpanel" id="p" aria-labelledby="a">'+attrTable+'<div><h4>商品评价</h4><div><span>错误材质</span><span>其他商品</span></div></div></section>';
 assert.equal(readPageDomFacts(productDocument(linked)),null,'Mixed linked region remains untrusted');
});

test('the new boundary cannot weaken explicit package units or exact SKU matching',()=>{
 const layout='<div><h2>商品评价</h2>'+sections()+'</div>';
 assert.throws(()=>capture(layout.replaceAll('重量(g)','重量')),/속성·포장 표/u);
 assert.throws(()=>capture(layout.replace('data-sku-id="synthetic-0"','data-sku-id="foreign-sku"')),/포장 표의 옵션명·SKU/u);
});
