import test from 'node:test';
import assert from 'node:assert/strict';
import {readPageDomDetails} from '../extensions/supplier-hub/page-dom-details.mjs';
import {extractPageSource,readPageSourceDomFacts} from '../extensions/supplier-hub/page-source.mjs';
import {productDocument} from './helpers/product-document.mjs';

const offerId='700000000810',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const image=name=>`https://cbu01.alicdn.com/synthetic-detail-boundary-${name}.jpg`;
const font=value=>`<font><font>${value}</font></font>`;
function styled(html){
 const document=productDocument(html),reads=[];
 document.defaultView={getComputedStyle(node){
  const name=node.getAttribute('data-background');reads.push(name);
  return{backgroundImage:name?`url("${image(name)}")`:'none'};
 }};
 return{document,reads};
}
function detailSection({tag='section',heading='商品详情'}={}){
 return `<${tag}><h3>${font(heading)}</h3><p>현재 상품 상세</p><img src="${image('own')}"><div data-background="own-css"></div></${tag}>`;
}

// Semantic regression fixtures, not a retained DOM or an assertion about the
// structure of the user's capture 8. No styles or images are loaded.
test('an exact local detail section survives earlier review, attribute and packaging headings on shared ancestors',()=>{
 for(const preceding of ['商品评价','同款推荐','商品属性','包装信息','제품 리뷰','동일한 스타일 추천','제품 속성','포장 정보'])
  for(const heading of ['商品详情','제품 상세 정보'])for(const tag of ['section','article','div']){
   const {document,reads}=styled(`<div><h2>${font(preceding)}</h2><p>앞 구역 안내</p><img src="${image('earlier')}"><div data-background="earlier-css"></div><div>${detailSection({tag,heading})}</div></div>`);
   assert.deepEqual(readPageDomDetails(document,sourceUrl),{description:'현재 상품 상세',detailImages:[image('own'),image('own-css')]});
   assert.ok(!reads.includes('earlier-css'),'The shared ancestor is never promoted to a detail root');
  }
});

test('shared wrappers retain current-product attributes, all three package rows, and detail IMG/CSS together',()=>{
 const names=['米色','粉色','黑色'];
 const scripts=[JSON.stringify({skuModel:{offerId,skuInfoMap:Object.fromEntries(names.map((name,index)=>[name,{skuId:'synthetic-'+index,specAttrs:name,price:'0.28'}]))},offerImgList:[image('main')]})];
 for(const words of [['商品评价','商品属性','包装信息','商品详情'],['제품 리뷰','제품 속성','포장 정보','제품 상세 정보']]){
  const {document,reads}=styled(`<div><h2>${font(words[0])}</h2><p>앞 리뷰 구역</p><img src="${image('review')}"><div data-background="review-css"></div>
   <section><h3>${font(words[1])}</h3><table><tr><th>材质</th><td>海绵</td></tr></table></section>
   <section><h3>${font(words[2])}</h3><table><tr><th>颜色</th><th>重量(g)</th></tr>${names.map((name,index)=>`<tr data-sku-id="synthetic-${index}"><td>${name}</td><td>10</td></tr>`).join('')}</table></section>
   ${detailSection({heading:words[3]})}</div>`);
  const result=extractPageSource({sourceUrl,scripts,title:'合成后跟贴',domFacts:readPageSourceDomFacts(document,sourceUrl,scripts),...readPageDomDetails(document,sourceUrl)});
  assert.deepEqual(result.attributes,[{name:'材质',value:'海绵'}]);
  assert.deepEqual(result.options.map(row=>[row.supplierSku,row.packaging]),names.map((_,index)=>['synthetic-'+index,{source:'package-table',weightG:10}]));
  assert.deepEqual(result.images.filter(row=>row.role==='detail').map(row=>row.url),[image('own'),image('own-css')]);
  assert.equal(result.description,'현재 상품 상세');assert.ok(!reads.includes('review-css'));
 }
});

test('a local detail boundary never overrides explicit unrelated ancestors, navigation, ignored tags or foreign offers',()=>{
 const wrappers=[['<nav>','</nav>'],['<aside>','</aside>'],['<header>','</header>'],['<footer>','</footer>'],['<button>','</button>'],['<div role="navigation">','</div>'],
  ['<a href="https://detail.1688.com/offer/700000000999.html">','</a>'],
  ...['recommendations','buyerReview','review-zone','related-products','shop-card','offer-card','gallery','sku-image'].map(name=>[`<div class="${name}">`,'</div>'])];
 for(const [open,close]of wrappers){
  const {document,reads}=styled(open+'<div><h2>商品评价</h2>'+detailSection()+'</div>'+close);
  assert.deepEqual(readPageDomDetails(document,sourceUrl),{description:'',detailImages:[]});
  assert.deepEqual(reads,[],'Explicit excluded ancestors must be rejected before any computed-style read');
 }
 const {document}=styled(`<a href="${sourceUrl}"><div><h2>商品评价</h2>${detailSection()}</div></a>`);
 assert.deepEqual(readPageDomDetails(document,sourceUrl).detailImages,[image('own'),image('own-css')]);
});

test('nearer review, attribute and packaging subsections still exclude their own images and text',()=>{
 for(const heading of ['商品评价','同款推荐','商品属性','包装信息','제품 리뷰','제품 속성','포장 정보']){
  const {document,reads}=styled(`<div><h2>商品评价</h2><section><h3>商品详情</h3><p>현재 상품 상세</p><img src="${image('own')}"><div data-background="own-css"></div>
   <div><h4>${font(heading)}</h4><p>제외할 내용</p><img src="${image('excluded')}"><div data-background="excluded-css"></div></div></section></div>`);
  assert.deepEqual(readPageDomDetails(document,sourceUrl),{description:'현재 상품 상세',detailImages:[image('own'),image('own-css')]});
  assert.ok(!reads.includes('excluded-css'));
 }
});

test('an unlabelled body under an unrelated heading cannot borrow a later sibling detail heading',()=>{
 const {document,reads}=styled(`<div><h2>商品评价</h2><img src="${image('unlabelled')}"><div data-background="unlabelled-css"></div></div>${detailSection()}`);
 assert.deepEqual(readPageDomDetails(document,sourceUrl),{description:'현재 상품 상세',detailImages:[image('own'),image('own-css')]});
 assert.ok(!reads.includes('unlabelled-css'));
});
