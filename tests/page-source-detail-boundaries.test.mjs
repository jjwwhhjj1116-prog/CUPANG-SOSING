import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {readPageDomDetails} from '../extensions/supplier-hub/page-dom-details.mjs';
import {extractPageSource,readPageSourceDomFacts} from '../extensions/supplier-hub/page-source.mjs';
import {readProductSectionStructure} from '../extensions/supplier-hub/page-dom-sections.mjs';
import * as sourceParser from '../extensions/supplier-hub/page-source.mjs';
import * as detailParser from '../extensions/supplier-hub/page-dom-details.mjs';
import * as sectionParser from '../extensions/supplier-hub/page-dom-sections.mjs';
import * as observations from '../extensions/supplier-hub/page-capture-observations.mjs';
import * as hydration from '../extensions/supplier-hub/page-hydration.mjs';
import {productDocument} from './helpers/product-document.mjs';
import {pageCollectorDom} from './helpers/page-collector-dom.mjs';

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

test('an exact paragraph detail heading recognized by section diagnostics retains the same local BODY as a div heading',()=>{
 // Synthetic tag-only reconstruction, not evidence of the protected product DOM.
 for(const heading of ['<div>商品详情</div>','<p>商品详情</p>','<strong>商品详情</strong>','<p><strong><font>商品详情</font></strong></p>']){
  const document=productDocument(`<section>${heading}<p>当前商品正文</p><img data-original="${image('paragraph-body')}"></section>`);
  const structure=readProductSectionStructure(document);
  assert.equal(structure.bodyLabelCount,1);assert.deepEqual(structure.labels.map(row=>row.kind),['detail']);
  assert.deepEqual(readPageDomDetails(document,sourceUrl),{description:'当前商品正文',detailImages:[image('paragraph-body')]},heading);
 }
});

test('paragraph and inline detail labels cannot authorize ads, reviews, foreign offers, loose anchors or an unbounded body',()=>{
 const body=`<p>当前商品正文</p><img data-original="${image('forbidden-paragraph')}">`;
 for(const tag of ['p','strong']){
  const section=`<section><${tag}>商品详情</${tag}>${body}</section>`;
  for(const [open,close]of [['<nav>','</nav>'],['<aside>','</aside>'],['<header>','</header>'],['<div class="offer-card">','</div>'],['<div class="buyerReview">','</div>'],['<div class="recommendations">','</div>'],['<a href="https://detail.1688.com/offer/700000000999.html">','</a>']])
   assert.deepEqual(readPageDomDetails(productDocument(open+section+close),sourceUrl),{description:'',detailImages:[]});
  for(const html of [`<a href="#details"><${tag}>商品详情</${tag}></a>${body}`,`<section><${tag}></${tag}>${body}</section>`,`<section><${tag}>商品详情 更多</${tag}>${body}</section>`,`<${tag}>商品详情</${tag}>${body}`])
   assert.deepEqual(readPageDomDetails(productDocument(html),sourceUrl),{description:'',detailImages:[]});
 }
});

test('the original trusted collector entry retains a paragraph BODY alongside current attributes and package facts',async()=>{
 // Link the original unbundled entry to its original source modules. Only the
 // Chrome/DOM surfaces are inert; collect(), waits and delivery code are real.
 const entry=fs.readFileSync(new URL('../deployment/extension-page-collector.mjs',import.meta.url),'utf8').replace(/^import .+?;\r?$/gmu,''),version=JSON.parse(fs.readFileSync(new URL('../extensions/supplier-hub/manifest.json',import.meta.url),'utf8')).version;
 for(const tag of ['div','p','strong']){
  const scripts=[JSON.stringify({offerId,subject:'合成商品',skuModel:{offerId,skuInfoMap:{black:{skuId:'synthetic-black',specAttrs:'黑色',price:'0.28'}}},offerImgList:[image('main'),image('gallery')]})];
  const {document:page,reads}=styled(`<section><strong>商品属性</strong><table><tr><th>材质</th><td>海绵</td></tr></table></section><section><p>包装信息</p><table><tr><th>颜色</th><th>重量(g)</th></tr><tr data-sku-id="synthetic-black"><td>黑色</td><td>10</td></tr></table></section><section><${tag}><font>商品详情</font></${tag}><p>当前商品正文</p><div data-background="entry-css-first"></div><img data-original="${image('entry-paragraph-body')}"><div data-background="entry-css-second"></div><img src="${image('entry-img-last')}"><div class="recommendations"><img src="${image('entry-recommendation')}"><div data-background="entry-recommendation-css"></div></div><a href="https://detail.1688.com/offer/700000000999.html"><img src="${image('entry-foreign')}"></a></section><div class="gallery"><img src="${image('gallery')}"></div>`);
  const {document,elements}=pageCollectorDom({scripts:scripts.map(textContent=>({textContent})),querySelectorAll:selector=>page.querySelectorAll(selector),querySelector:selector=>selector==='.price-container'?{textContent:'¥0.28 1件起批'}:page.querySelector(selector)}),messages=[],window={};window.top=window;
  document.defaultView=page.defaultView;
  vm.runInNewContext(entry,{...sourceParser,...detailParser,...sectionParser,...observations,...hydration,COLLECTOR_SCRIPT_VERSION:version,window,document,location:{href:sourceUrl},URL,Date,Error,TextEncoder,
   setTimeout(callback){queueMicrotask(callback);return 1;},chrome:{runtime:{sendMessage:async message=>{messages.push(structuredClone(message));return{ok:true,delivered:true};}}},fetch:()=>assert.fail('No network or vendor requests are allowed')});
  await elements.find(node=>node.tag==='button').click({isTrusted:true});assert.equal(messages.length,1);assert.equal(messages[0].type,'YOOFAM_SAVE_PAGE_SOURCE');
  const snapshot=messages[0].snapshot;assert.deepEqual(snapshot.attributes,[{name:'材质',value:'海绵'}]);assert.deepEqual(snapshot.options[0].packaging,{source:'package-table',weightG:10});
  assert.deepEqual(snapshot.images.filter(row=>row.role==='detail'),['entry-css-first','entry-paragraph-body','entry-css-second','entry-img-last'].map(name=>({url:image(name),role:'detail'})),tag);
  assert.deepEqual(snapshot.images.filter(row=>row.role!=='detail'),[{url:image('main'),role:'main'},{url:image('gallery'),role:'additional'}]);
  assert.equal(snapshot.description,'当前商品正文');assert.ok(!reads.includes('entry-recommendation-css'));
 }
});

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
