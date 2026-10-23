import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPageSource,readPageSourceDomFacts} from '../extensions/supplier-hub/page-source.mjs';
import {readPageDomDetails} from '../extensions/supplier-hub/page-dom-details.mjs';
import {readProductSectionLinks} from '../extensions/supplier-hub/page-dom-sections.mjs';
import {readPageDomFacts} from '../extensions/supplier-hub/page-dom-facts.mjs';
import {productDocument} from './helpers/product-document.mjs';

const offerId='700000000805',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const names=['蝴蝶结后跟贴米色','蝴蝶结后跟贴粉色','蝴蝶结后跟贴黑色'];
const script=JSON.stringify({globalData:{offerBaseInfo:{offerId,subject:'合成后跟贴'},tempModel:{offerId}},skuModel:{offerId,skuInfoMap:Object.fromEntries(names.map((name,index)=>['color-'+index,{skuId:'synthetic-'+index,specAttrs:name,price:'0.28'}]))},offerImgList:['https://cbu01.alicdn.com/synthetic-main-805.png']});
const image=index=>`https://cbu01.alicdn.com/synthetic-section-805-${index}.png`;
const ids=['attributes','packaging','description'];
function layout({translated=false,roleTable=false,tabsOnly=false,ancestorClass='offer-page-layout'}={}){
 const words=translated?['제품 속성','포장 정보','제품 상세 정보','색상','무게(g)']:['商品属性','包装信息','商品详情','颜色','重量(g)'];
 const heading=(index,id)=>tabsOnly?'':`<h3 id="${id}-heading"><font><font>${words[index]}</font></font></h3>`;
 const attributes='<div class="attribute-pair"><span>材质</span><span>海绵</span></div><div class="attribute-pair"><span>产品类别</span><span>后跟贴</span></div>';
 const rows=names.map((name,index)=>roleTable?`<div role="row" data-sku-id="synthetic-${index}"><span role="cell">${name}</span><span role="cell">10</span></div>`:`<tr data-sku-id="synthetic-${index}"><td>${name}</td><td>10</td></tr>`).join('');
 const table=roleTable?`<div role="grid"><div role="row"><span role="columnheader">${words[3]}</span><span role="columnheader">${words[4]}</span></div>${rows}</div>`:`<table><thead><tr><th>${words[3]}</th><th>${words[4]}</th></tr></thead><tbody>${rows}</tbody></table>`;
 const tabs=tabsOnly?'<nav role="tablist">'+ids.map((id,index)=>`<button id="${id}-tab" role="tab" aria-controls="${id}-panel"><font><font>${words[index]}</font></font></button>`).join('')+'</nav>':'';
 const section=(id,index,body)=>`<section id="${id}-panel" role="tabpanel" aria-labelledby="${tabsOnly?id+'-tab':id+'-heading'}">${heading(index,id)}${body}</section>`;
 return `<!doctype html><html><head><title>合成后跟贴</title></head><body><header>合成供货商</header><main class="${ancestorClass}"><div class="two-column-layout"><div class="document-column">${tabs}${section('attributes',0,attributes)}${section('packaging',1,table)}${section('description',2,'<p>当前合成商品详情。</p>'+Array.from({length:7},(_,index)=>`<img data-src="${image(index)}">`).join(''))}</div><aside class="sticky-purchase-column"><h1>合成后跟贴</h1><p>¥0.28 1双起批</p>${names.map(name=>`<div>${name}</div>`).join('')}</aside></div></main><footer>合成页脚</footer></body></html>`;
}
function capture(html,expectedScripts=[script]){
 const document=productDocument(html),domFacts=readPageSourceDomFacts(document,sourceUrl,expectedScripts),details=readPageDomDetails(document,sourceUrl);
 return {document,result:extractPageSource({sourceUrl,scripts:expectedScripts,domFacts,title:'合成后跟贴',description:details.description,detailImages:details.detailImages,priceText:'¥0.28',minimumOrderText:'1双起批'})};
}
function assertComplete(result){
 assert.deepEqual(result.attributes,[{name:'材质',value:'海绵'},{name:'产品类别',value:'后跟贴'}]);
 assert.deepEqual(result.options.map(row=>[row.name,row.packaging]),names.map(name=>[name,{source:'package-table',weightG:10}]));
 assert.deepEqual(result.images.filter(row=>row.role==='detail').map(row=>row.url),Array.from({length:7},(_,index)=>image(index)));
 assert.equal(result.description,'当前合成商品详情。');
 assert.ok(result.options.every(row=>!Object.hasOwn(row.packaging,'widthMm')));
}
function assertEmpty(result){assert.deepEqual(result.attributes,[]);assert.ok(result.options.every(row=>row.packaging===undefined));assert.equal(result.description,'');assert.equal(result.images.filter(row=>row.role==='detail').length,0);}

test('complete Chinese and Chrome-translated documents retain left-side current sections beside a sticky purchase column',()=>{
 for(const translated of [false,true])assertComplete(capture(layout({translated,roleTable:translated})).result);
});
test('exact Chinese/Korean ARIA tabs authorize only their unique reciprocal panels without duplicate headings',()=>{
 for(const translated of [false,true]){
  const {document,result}=capture(layout({translated,roleTable:translated,tabsOnly:true}));assertComplete(result);
  assert.deepEqual(readProductSectionLinks(document).diagnostics,{tabCount:3,knownTabCount:3,panelCount:3,linkedKnownPanelCount:3,unlinkedKnownTabCount:0});
 }
});
test('global shop/store layout wrappers do not erase normal current-product sections or exact linked panels',()=>{
 for(const ancestorClass of ['shop-page-layout','store-layout','shopPageLayout'])for(const tabsOnly of [false,true])assertComplete(capture(layout({translated:true,roleTable:true,tabsOnly,ancestorClass})).result);
});
test('ordinary image/detail preview tokens remain readable while explicit review and recommendation regions stay excluded',()=>{
 for(const ancestorClass of ['image-preview','detail-preview','imagePreview','detailPreview'])for(const tabsOnly of [false,true])assertComplete(capture(layout({ancestorClass,tabsOnly})).result);
 for(const ancestorClass of ['review','reviews','review-zone','buyerReview','reviewCard','review-card','preview-recommendations'])for(const tabsOnly of [false,true])assertEmpty(capture(layout({ancestorClass,tabsOnly})).result);
 const ownLink=productDocument(`<a href="${sourceUrl}"><div class="offer-description image-preview"><p>현재 상품 상세</p><img data-src="${image(0)}"></div></a>`);
 assert.deepEqual(readPageDomDetails(ownLink,sourceUrl),{description:'현재 상품 상세',detailImages:[image(0)]},'Existing exact same-offer detail links retain their own source identity');
});
test('actual commerce cards, recommendations, aside and footer never authorize their contained sections',()=>{
 for(const ancestorClass of ['shop-card','shopCard','storeCard','recommendations','review-area'])for(const tabsOnly of [false,true])assertEmpty(capture(layout({ancestorClass,tabsOnly})).result);
 for(const tag of ['aside','footer'])assertEmpty(capture(layout({tabsOnly:true}).replace('<main class="offer-page-layout">',`<${tag}>`).replace('</main>',`</${tag}>`)).result);
});
test('missing, wrong, duplicate or ambiguous ARIA relationships cannot claim unlabelled adjacent content',()=>{
 const good=layout({tabsOnly:true});
 const mutations=[
  html=>html.replaceAll('aria-controls=','data-unlinked='),
  html=>html.replaceAll('aria-labelledby=','data-unlinked='),
  html=>html.replaceAll('role="tabpanel"','role="region"'),
  html=>html.replaceAll('role="tablist"','role="navigation"'),
  html=>html.replaceAll('aria-labelledby="attributes-tab"','aria-labelledby="packaging-tab"').replaceAll('aria-labelledby="packaging-tab"','aria-labelledby="description-tab"').replaceAll('aria-labelledby="description-tab"','aria-labelledby="missing-tab"'),
  html=>html.replaceAll('aria-controls="attributes-panel"','aria-controls="attributes-panel other"').replaceAll('aria-controls="packaging-panel"','aria-controls="packaging-panel other"').replaceAll('aria-controls="description-panel"','aria-controls="description-panel other"'),
  html=>html.replace('</body>',ids.map(id=>`<div id="${id}-panel"></div>`).join('')+'</body>'),
  html=>html.replace('</nav>',ids.map(id=>`<button id="${id}-tab" role="tab" aria-controls="${id}-panel">任意</button>`).join('')+'</nav>'),
  html=>html.replace('</nav>',ids.map(id=>`<button role="tab" aria-controls="${id}-panel">任意</button>`).join('')+'</nav>'),
  html=>html.replace(/<font><font>(商品属性|包装信息|商品详情)<\/font><\/font>/gu,'<font><font>$1 推荐</font></font>'),
 ];
 for(const mutate of mutations)assertEmpty(capture(mutate(good)).result);
});
test('linked panels inside navigation, nested panels or another offer link remain excluded',()=>{
 const good=layout({tabsOnly:true});
 for(const [open,close]of [['<nav>','</nav>'],['<div role="tabpanel">','</div>'],['<a href="https://detail.1688.com/offer/700000000806.html">','</a>']]){
  const html=good.replace('<section id="attributes-panel"',open+'<section id="attributes-panel"').replace('</div><aside',close+'</div><aside');
  assertEmpty(capture(html).result);
 }
});
test('linked and headed fact regions never accept descendant other-offer, navigation or related-card tables/pairs',()=>{
 const table='<table><tr><td>材质</td><td>OTHER PRODUCT</td></tr></table>';
 const pair='<div><span>材质</span><span>OTHER PRODUCT</span></div>';
 const linked=body=>'<nav role="tablist"><button role="tab" id="current-tab" aria-controls="current-panel">商品属性</button></nav><section role="tabpanel" id="current-panel" aria-labelledby="current-tab">'+body+'</section>';
 const wrappers=[['<a href="https://detail.1688.com/offer/700000000999.html">','</a>'],['<div role="navigation">','</div>'],
  ...['offer-card','related-products','suggest-products','feedback-card','shop-card','storeCard'].map(value=>[`<div class="${value}">`,'</div>'])];
 for(const [open,close]of wrappers)for(const body of [table,pair]){
  assert.equal(readPageDomFacts(productDocument(linked(open+body+close))),null,'A linked panel cannot authorize unrelated descendants');
  assert.equal(readPageDomFacts(productDocument(open+'<section><h3>商品属性</h3>'+body+'</section>'+close)),null,'A visual heading cannot authorize an unrelated ancestor');
 }
 const packageTable='<table><tr><th>颜色</th><th>重量(g)</th></tr>'+names.map(name=>`<tr><td>${name}</td><td>999</td></tr>`).join('')+'</table>';
 for(const [open,close]of wrappers){
  assert.equal(readPageDomFacts(productDocument(linked(open+packageTable+close).replace('商品属性','包装信息'))),null,'A linked package panel cannot import another card\'s weight');
  assert.equal(readPageDomFacts(productDocument(open+'<section><h3>包装信息</h3>'+packageTable+'</section>'+close)),null,'A package heading in unrelated content does not authorize supplier measurements');
 }
 const good='<div class="shop-page-layout"><section><h3>商品属性</h3><div><span>材质</span><span>海绵</span></div></section></div>';
 assert.deepEqual(readPageDomFacts(productDocument(good)),{attributes:[{name:'材质',value:'海绵'}],packaging:[]});
});
test('a known navigation label with no linked panel cannot authorize document-wide table/image fallback',()=>{
 const html=layout({tabsOnly:true}).replaceAll('role="tabpanel"','role="presentation"');
 const {document,result}=capture(html);assertEmpty(result);
 assert.deepEqual(readProductSectionLinks(document).diagnostics,{tabCount:3,knownTabCount:3,panelCount:0,linkedKnownPanelCount:0,unlinkedKnownTabCount:3});
});
test('a permitted table/grid cannot import nested unrelated native rows or role rowgroups',()=>{
 const panel=(kind,body)=>`<nav role="tablist"><button role="tab" id="current-tab" aria-controls="current-panel">${kind}</button></nav><section role="tabpanel" id="current-panel" aria-labelledby="current-tab">${body}</section>`;
 for(const marker of ['class="related-products"','class="offer-card"','class="suggest-products"','class="feedback-card"','role="navigation"']){
  const attrs=`<table><tbody ${marker}><tr><td>材质</td><td>OTHER PRODUCT</td></tr></tbody><tbody><tr><td>当前材质</td><td>海绵</td></tr></tbody></table>`;
  assert.deepEqual(readPageDomFacts(productDocument(panel('商品属性',attrs))),{attributes:[{name:'当前材质',value:'海绵'}],packaging:[]});
  const pack=`<table><thead><tr><th>颜色</th><th>重量(g)</th></tr></thead><tbody ${marker}><tr><td>${names[0]}</td><td>999</td></tr></tbody><tbody><tr><td>${names[0]}</td><td>10</td></tr></tbody></table>`;
  assert.deepEqual(readPageDomFacts(productDocument(panel('包装信息',pack))),{attributes:[],packaging:[{name:names[0],packaging:{source:'package-table',weightG:10}}]});
  const grid=`<div role="grid"><div role="row"><div role="columnheader">颜色</div><div role="columnheader">重量(g)</div></div><div ${marker}><div role="row"><div role="cell">${names[0]}</div><div role="cell">999</div></div></div><div role="row"><div role="cell">${names[0]}</div><div role="cell">10</div></div></div>`;
  assert.deepEqual(readPageDomFacts(productDocument(panel('包装信息',grid))),{attributes:[],packaging:[{name:names[0],packaging:{source:'package-table',weightG:10}}]});
 }
});
test('excluded cell/inline descendants never leak through textContent, and per-row element bounds fail explicitly',()=>{
 const panel=(kind,body)=>`<nav role="tablist"><button role="tab" id="current-tab" aria-controls="current-panel">${kind}</button></nav><section role="tabpanel" id="current-panel" aria-labelledby="current-tab">${body}</section>`;
 for(const marker of ['class="related-products"','class="offer-card"','class="feedback-card"','role="navigation"'])for(const inline of [false,true]){
  const badCell=inline?`<td><span ${marker}>OTHER PRODUCT</span></td>`:`<td ${marker}>OTHER PRODUCT</td>`;
  const attrs=`<table><tr><td>材质</td>${badCell}</tr><tr><td>当前材质</td><td><font><span>海绵</span></font></td></tr></table>`;
  assert.deepEqual(readPageDomFacts(productDocument(panel('商品属性',attrs))),{attributes:[{name:'当前材质',value:'海绵'}],packaging:[]});
  const pack=`<table><tr><th>颜色</th><th>重量(g)</th></tr><tr><td>${names[0]}</td><td><span ${marker}>999</span></td></tr><tr><td>${names[0]}</td><td><font>10</font></td></tr></table>`;
  assert.deepEqual(readPageDomFacts(productDocument(panel('包装信息',pack))),{attributes:[],packaging:[{name:names[0],packaging:{source:'package-table',weightG:10}}]});
 }
 const excessive='<table><tr><td>材质</td><td>'+Array.from({length:513},()=>'<span>x</span>').join('')+'</td></tr></table>';
 assert.throws(()=>readPageDomFacts(productDocument(panel('商品属性',excessive))),/속성·포장 표/u);
 const deep='<table><tr><td>材质</td><td>'+'<span>'.repeat(41)+'x'+'</span>'.repeat(41)+'</td></tr></table>';
 // The existing forty-ancestor cap rejects this deep branch before any
 // value can be read, even before the local row-depth cap is reached.
 assert.equal(readPageDomFacts(productDocument(panel('商品属性',deep))),null);
});
test('linked package sections preserve unit/header and exact SKU validation without inventing values',()=>{
 assert.throws(()=>capture(layout({tabsOnly:true}).replaceAll('重量(g)','重量')),/속性|속성·포장 표/u);
 assert.throws(()=>capture(layout({tabsOnly:true}).replace('data-sku-id="synthetic-0"','data-sku-id="foreign-sku"')),/포장 표의 옵션명·SKU/u);
 const other=JSON.stringify({offerId:'700000000806',subject:'其他产品'});
 assert.throws(()=>capture(layout({tabsOnly:true}),[other]),/현재 상품/u);
});
test('tab/panel discovery keeps finite section and identified-node limits',()=>{
 const tabs=Array.from({length:31},(_,index)=>`<button id="t-${index}" role="tab" aria-controls="p-${index}">商品属性</button>`).join('');
 assert.throws(()=>readProductSectionLinks(productDocument('<nav role="tablist">'+tabs+'</nav>')),/수집 크기/u);
 const idsHtml=Array.from({length:20001},(_,index)=>`<i id="x-${index}"></i>`).join('');
 assert.throws(()=>readProductSectionLinks(productDocument(layout({tabsOnly:true})+idsHtml)),/수집 크기/u);
});
