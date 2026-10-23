import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPageSource,readPageSourceDomFacts} from '../extensions/supplier-hub/page-source.mjs';
import {readPageDomDetails} from '../extensions/supplier-hub/page-dom-details.mjs';
import {readProductSectionLinks,readProductSectionStructure} from '../extensions/supplier-hub/page-dom-sections.mjs';
import {productDocument} from './helpers/product-document.mjs';

// Inert reconstructions of the user's observed labels and three 10 g rows.
// CSS/div structures exercise supported shapes; they are not retained live DOM.
const offerId='700000000806',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const names=['蝴蝶结后跟贴米色','蝴蝶结后跟贴粉色','蝴蝶结后跟贴黑色'];
const koreanNames=['리본 뒤꿈치 패드 베이지','리본 뒤꿈치 패드 분홍','리본 뒤꿈치 패드 검정'];
const image=name=>`https://cbu01.alicdn.com/synthetic-806-${name}.jpg`;
const scripts=[JSON.stringify({skuModel:{offerId,skuInfoMap:Object.fromEntries(names.map((name,index)=>['color-'+index,{skuId:'synthetic-'+index,specAttrs:name,price:'0.28'}]))},offerImgList:[image('main')]})];
const font=value=>`<font style="vertical-align:inherit"><font>${value}</font></font>`;
function layout({translated=false,grouped=false,native=false}={}){
 const words=translated?['제품 리뷰','제품 속성','포장 정보','제품 상세 정보','동일한 스타일 추천','색상','무게(g)']:['商品评价','商品属性','包装信息','商品详情','同款推荐','颜色','重量(g)'];
 const heading=value=>`<div><div><div>${font(value)}</div></div></div>`;
 const header=native?`<tr><th>${font(words[5])}</th><th>${font(words[6])}</th></tr>`:`<div><div>${font(words[5])}</div><div>${font(words[6])}</div></div>`;
 const rows=(translated?koreanNames:names).map((name,index)=>native?`<tr data-sku-id="synthetic-${index}"><td>${font(name)}</td><td>${font('10')}</td></tr>`:`<div data-sku-id="synthetic-${index}"><div>${font(name)}</div><div>${font('10')}</div></div>`).join('');
 const table=native?`<table><thead>${header}</thead><tbody>${rows}</tbody></table>`:`<div class="css-packaging-table">${grouped?`<div>${header}</div><div>${rows}</div>`:header+rows}</div>`;
 return `<html><body><header>${Array.from({length:8},(_,index)=>`<button role="tab">通用导航${index}</button>`).join('')}</header>
 <main><nav>${words.slice(0,5).map(word=>`<a>${font(word)}</a>`).join('')}</nav>
 <div>${heading(words[1])}<div><div><div><div>${font('材质')}</div></div><div><div>${font('海绵')}</div></div></div><div><div>${font('产品类别')}</div><div>${font('后跟贴')}</div></div></div></div>
 <div>${heading(words[2])}${table}</div>
 <div>${heading(words[3])}<div class="detail-desc-decorate-richtext"><p>当前商品的详细说明。</p><img data-src="${image('detail-1')}"><img data-original="${image('detail-2')}"></div>
 <div>${heading(words[4])}<p>推荐其他商品</p><img data-src="${image('related')}"></div><div>${heading(words[0])}<p>买家上传</p><img data-src="${image('review')}"></div></div>
 </main></body></html>`;
}
function capture(html){
 const document=productDocument(html),domFacts=readPageSourceDomFacts(document,sourceUrl,scripts),details=readPageDomDetails(document,sourceUrl);
 return{document,result:extractPageSource({sourceUrl,scripts,title:'合成后跟贴',domFacts,...details})};
}

test('non-ARIA Chinese/Korean section headings retain native and div package tables beside unrelated ARIA tabs',()=>{
 for(const translated of [false,true])for(const grouped of [false,true])for(const native of [false,true]){
  const {document,result}=capture(layout({translated,grouped,native}));
  assert.deepEqual(readProductSectionLinks(document).diagnostics,{tabCount:8,knownTabCount:0,panelCount:0,linkedKnownPanelCount:0,unlinkedKnownTabCount:0});
  assert.deepEqual(result.attributes,[{name:'材质',value:'海绵'},{name:'产品类别',value:'后跟贴'}]);
  assert.deepEqual(result.options.map(row=>[row.name,row.packaging]),names.map(name=>[name,{source:'package-table',weightG:10}]));
  assert.deepEqual(result.images.filter(row=>row.role==='detail').map(row=>row.url),[image('detail-1'),image('detail-2')]);
  assert.equal(result.description,'当前商品的详细说明。');
 }
});

test('CSS package tables still require exact SKU/name, explicit units and rectangular rows',()=>{
 const base=layout({translated:true,grouped:true});
 for(const mutate of [
  value=>value.replace('data-sku-id="synthetic-0"','data-sku-id="foreign-sku"'),
  value=>value.replaceAll('data-sku-id=','data-unverified='),
  value=>value.replaceAll('무게(g)','무게'),
  value=>value.replace(font('10'),font('10kg')),
  value=>value.replace(font('10'),font('约10')),
  value=>value.replace(`<div>${font('10')}</div></div>`,`<div>${font('10')}</div><div>extra</div></div>`),
 ])assert.throws(()=>capture(mutate(base)),/포장 표의 옵션명·SKU|속성·포장 표/u);
});

test('a CSS package table is never inferred from a navigation label, foreign offer or recommendation',()=>{
 const packageHtml=`<div><div>${font('包装信息')}</div><div><div><div>颜色</div><div>重量(g)</div></div><div><div>${names[0]}</div><div>999</div></div></div></div>`;
 for(const [open,close]of [['<nav>','</nav>'],['<aside>','</aside>'],['<div class="offer-card">','</div>'],['<div class="related-products">','</div>'],['<a href="https://detail.1688.com/offer/700000000999.html">','</a>']]){
  const {result}=capture(open+packageHtml+close);assert.equal(result.options[0].packaging,undefined);
 }
 const table='<div><div><div>颜色</div><div>重量(g)</div></div><div><div>'+names[0]+'</div><div>999</div></div></div>';
 assert.equal(capture('<nav><a>包装信息</a></nav>'+table).result.options[0].packaging,undefined);
 assert.throws(()=>capture('<div><div>包装信息</div><div>同款推荐</div>'+table+'</div>'),/속성·포장 표/u);
});

test('multi-div detail title and the retained exact richtext container work without broad detail-class fallback',()=>{
 const standalone=productDocument(`<div><div><div><div>${font('제품 상세 정보')}</div></div></div><p>현재 상품 상세</p><img data-src="${image('wrapped')}"></div><div class="random-detail-content"><img data-src="${image('unscoped')}"></div>`);
 assert.deepEqual(readPageDomDetails(standalone,sourceUrl),{description:'현재 상품 상세',detailImages:[image('wrapped')]});
 const richtext=productDocument(`<div class="detail-desc-decorate-richtext"><p>原文</p><img data-src="${image('richtext')}"></div><div class="related-products"><div class="detail-desc-decorate-richtext"><img data-src="${image('foreign')}"></div></div>`);
 assert.deepEqual(readPageDomDetails(richtext,sourceUrl),{description:'原文',detailImages:[image('richtext')]});
 for(const label of ['제품 매개 변수','상품 매개 변수','포장 매개 변수']){
  const excluded=productDocument(`<div class="offer-description"><p>原文</p><img data-src="${image('local')}"><section><h3>${label}</h3><img data-src="${image('facts')}"></section></div>`);
  assert.deepEqual(readPageDomDetails(excluded,sourceUrl),{description:'原文',detailImages:[image('local')]});
 }
});

test('structural diagnostics distinguish non-ARIA body headings without exposing page text or attributes',()=>{
 const document=productDocument(layout({translated:true}).replace('<main>','<main id="private-identifier" class="private-class"><p>private-body-text</p>'));
 const result=readProductSectionStructure(document),serialized=JSON.stringify(result);
 assert.equal(result.labelCount,10);assert.equal(result.bodyLabelCount,3);
 assert.equal(result.labels.filter(row=>row.kind==='attributes'&&!row.excluded).length,1);
 assert.ok(result.labels.some(row=>row.kind==='packaging'&&!row.excluded&&row.ancestors.some(ancestor=>ancestor.tag==='DIV')));
 assert.doesNotMatch(serialized,/private-|https:|合成|颜色|包装|스타일|synthetic/u);
 for(const row of result.labels){assert.ok(row.ancestors.length<=5);for(const ancestor of row.ancestors)assert.deepEqual(Object.keys(ancestor).sort(),['children','frames','images','role','tables','tag']);}
 assert.throws(()=>readProductSectionStructure(productDocument('<div>商品属性</div>'.repeat(61))),/수집 크기/u);
});
