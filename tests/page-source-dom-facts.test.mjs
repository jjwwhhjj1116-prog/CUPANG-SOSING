import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parseFragment} from 'parse5';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {extractPageSource,readPageSourceDomFacts,validatePageSource} from '../extensions/supplier-hub/page-source.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {pageCollectorDom} from './helpers/page-collector-dom.mjs';

// Inert semantic DOM only. These are synthetic documents modelled after the
// user-provided three-colour package table, never a source website request.
const offerId='700000000794',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`,image='https://cbu01.alicdn.com/synthetic-dom-facts-794.png';
const names=['蝴蝶结后跟贴米色','蝴蝶结后跟贴粉色','蝴蝶结后跟贴黑色'];
const skuModel={offerId,skuInfoMap:Object.fromEntries(names.map((name,index)=>['color-'+index,{skuId:'synthetic-'+index,specAttrs:name,price:'0.28'}]))};
const scripts=[JSON.stringify({globalData:{offerBaseInfo:{offerId,subject:'合成后跟贴'},tempModel:{offerId}},skuModel,offerImgList:[image]})];
function documentFromHtml(html){
 const match=(node,selector)=>selector.split(',').some(part=>{
  part=part.trim();if(/^[a-z][a-z0-9]*$/u.test(part))return node.tagName===part.toUpperCase();
  if(part==='a[href]')return node.tagName==='A'&&node.getAttribute('href')!==null;
  const role=/^\[role="([^"]+)"\]$/u.exec(part);if(role)return node.getAttribute('role')===role[1];
  const attribute=/^\[(class|id)\*="([^"]+)"( i)?\]$/u.exec(part);assert.ok(attribute,'Unsupported fixture selector '+part);
  const actual=node.getAttribute(attribute[1])??'';return attribute[3]?actual.toLowerCase().includes(attribute[2].toLowerCase()):actual.includes(attribute[2]);
 });
 const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
 const wrap=(raw,parent=null)=>{
  const node={tagName:raw.tagName?.toUpperCase(),children:[],parentElement:parent,getAttribute(name){return raw.attrs?.find(item=>item.name===name)?.value??null;},
   matches(selector){return match(node,selector);},closest(selector){for(let current=node;current;current=current.parentElement)if(match(current,selector))return current;return null;},
   contains(other){for(let current=other;current;current=current.parentElement)if(current===node)return true;return false;},
   querySelectorAll(selector){return descendants(node).filter(child=>match(child,selector));},querySelector(selector){return node.querySelectorAll(selector)[0]??null;}};
  Object.defineProperty(node,'textContent',{get(){const read=raw=>raw.value??(raw.childNodes??[]).map(read).join('');return read(raw);}});
  node.children=(raw.childNodes??[]).filter(child=>child.tagName).map(child=>wrap(child,node));return node;
 };
 const root=wrap(parseFragment(html));return{querySelectorAll:selector=>root.querySelectorAll(selector),querySelector:selector=>root.querySelector(selector)};
}
const table=(headers=['颜色','重量(g)'],rows=names.map(name=>[name,'10']))=>`<section><h2>包装信息</h2><table><thead><tr>${headers.map(value=>`<th>${value}</th>`).join('')}</tr></thead><tbody>${rows.map(values=>`<tr>${values.map(value=>`<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`;
const attributes='<section><h2>商品属性</h2><table><tr><th>材质</th><td>海绵</td><th>产品类别</th><td>后跟贴</td></tr></table></section>';
function capture(html,scriptList=scripts){const document=documentFromHtml(html),domFacts=readPageSourceDomFacts(document,sourceUrl,scriptList);return extractPageSource({sourceUrl,scripts:scriptList,domFacts,title:'合成后跟贴',priceText:'¥0.28',minimumOrderText:'1双起批'});}

test('labelled native package table retains all three exact colours and explicit 10 g, with no invented dimensions',()=>{
 const source=capture(attributes+table());
 assert.deepEqual(source.attributes,[{name:'材质',value:'海绵'},{name:'产品类别',value:'后跟贴'}]);
 assert.deepEqual(source.options.map(row=>[row.name,row.minimumOrder,row.packaging]),names.map(name=>[name,1,{source:'package-table',weightG:10}]));
 assert.ok(source.options.every(row=>!Object.hasOwn(row.packaging,'widthMm')));
});

test('native package order never controls option matching, and explicit units alone are converted',()=>{
 const source=capture(table(['颜色','重量(kg)','宽(cm)','长(mm)','高(mm)'],[[names[2],'0.01','1.5','20','3'],[names[0],'0.02','2','30','4'],[names[1],'0.03','2.5','40','5']]));
 assert.deepEqual(source.options.map(row=>row.packaging),[
  {source:'package-table',weightG:20,widthMm:20,lengthMm:30,heightMm:4},
  {source:'package-table',weightG:30,widthMm:25,lengthMm:40,heightMm:5},
  {source:'package-table',weightG:10,widthMm:15,lengthMm:20,heightMm:3},
 ]);
});

test('role div grid uses semantic row and column headers, including exact supplier SKU identity',()=>{
 const html='<section><h3>包装信息</h3><div role="grid"><div role="row"><div role="columnheader">SKU</div><div role="columnheader">重量(g)</div></div>'+[2,0,1].map(index=>`<div role="row"><div role="rowheader">synthetic-${index}</div><div role="gridcell">${10+index}</div></div>`).join('')+'</div></section>';
 assert.deepEqual(capture(html).options.map(row=>row.packaging.weightG),[10,11,12]);
 const attrs='<section><h3>商品属性</h3><div><span>材质</span><span>海绵</span></div><div><span>产品类别</span><span>后跟贴</span></div></section>';
 assert.deepEqual(capture(attrs).attributes,[{name:'材质',value:'海绵'},{name:'产品类别',value:'后跟贴'}]);
});

test('Chrome-translated Korean headings and headers retain exact original option identities and explicit physical units',()=>{
 const koreanAttributes=attributes.replace('商品属性','제품\n 속성');
 const koreanPack=table(['색상','무게(g)','가로(mm)','세로(cm)','높이(mm)'],names.map(name=>[name,'10','20','3','4']))
  .replace('包装信息','포장\n 정보</h2><h3>제품 무게 및 치수').replace('</h2><table>','</h3><table>');
 const source=capture(koreanAttributes+koreanPack);
 assert.equal(source.attributes[0].value,'海绵');assert.deepEqual(source.options.map(row=>row.packaging),names.map(()=>({source:'package-table',weightG:10,widthMm:20,lengthMm:30,heightMm:4})));
});

test('translated nested inline/font section headings retain attributes and exact original SKU package facts',()=>{
 for(const [attributeHeading,packageHeading]of [['商品属性','包装信息'],['상품 속성','포장 정보']]){
  const source=capture(attributes.replace('<h2>商品属性</h2>',`<h3><font style="vertical-align:inherit"><font style="vertical-align:inherit">${attributeHeading}</font></font></h3>`)
   +table().replace('<h2>包装信息</h2>',`<h3><font><font>${packageHeading}</font></font></h3>`));
  assert.deepEqual(source.attributes,[{name:'材质',value:'海绵'},{name:'产品类别',value:'后跟贴'}]);
  assert.deepEqual(source.options.map(row=>row.packaging),names.map(()=>({source:'package-table',weightG:10})));
 }
});

test('font-only and split inline headings also support translated attribute pairs without treating their containers as headings',()=>{
 const attrs='<section><font><font>상품 속성</font></font><div><span><font><font>材质</font></font></span><span><strong>海绵</strong></span></div><div><span>产品类别</span><span><font>后跟贴</font></span></div></section>';
 for(const heading of ['<font><font>포장 정보</font></font>','<h3><span>포장</span><strong> 정보</strong></h3>','<p><font>包</font><span>装信息</span></p>']){
  const source=capture(attrs+table().replace('<h2>包装信息</h2>',heading));
  assert.deepEqual(source.attributes,[{name:'材质',value:'海绵'},{name:'产品类别',value:'后跟贴'}]);assert.deepEqual(source.options.map(row=>row.packaging.weightG),[10,10,10]);
 }
});

test('translated wrapper labels cannot authorise excluded navigation/shop/recommendation facts or adjacent mixed sections',()=>{
 const wrapped=value=>value.replace(/<h2>([^<]+)<\/h2>/gu,'<h3><font><font>$1</font></font></h3>');
 const bad=wrapped(attributes.replace('海绵','错误推荐材质')+table(['颜色','重量(g)'],[[names[0],'999']]));
 for(const [open,close]of [['<nav>','</nav>'],['<footer>','</footer>'],['<div role="tab">','</div>'],['<div class="shop-card">','</div>'],['<div id="recommend-more">','</div>'],['<div class="review-zone">','</div>']]){
  const source=capture(open+bad+close+wrapped(attributes+table()));
  assert.equal(source.attributes[0].value,'海绵');assert.deepEqual(source.options.map(row=>row.packaging.weightG),[10,10,10]);
 }
 const mixed='<section><h3><font>商品属性</font></h3><h3><font>包装信息</font></h3><table><tr><th>材质</th><td>海绵</td></tr></table></section>';
 assert.throws(()=>capture(mixed),/속성·포장 표/,'neighbouring different section labels cannot claim a shared table');
 const noExact=table().replace('包装信息','包装信息与推荐商品');assert.ok(capture(noExact).options.every(row=>row.packaging===undefined));
 const wrongSku=wrapped(table(['SKU','重量(g)'],[['not-current-sku','10']]));assert.throws(()=>capture(wrongSku),/포장 표의 옵션명·SKU/);
});

test('translated nested wrappers count once while the original heading, row and attribute limits stay enforced',()=>{
 const wrapped=attributes.replace('<h2>商品属性</h2>','<h3><font><font>商品属性</font></font></h3>');
 assert.equal(capture(wrapped.repeat(30)).attributes.length,2,'three translated wrappers are one labelled section');
 assert.throws(()=>capture(wrapped.repeat(31)),/속성·포장 표/);
 assert.throws(()=>capture(table(['颜色','重量(g)'],Array.from({length:201},()=>[names[0],'10'])).replace('<h2>包装信息</h2>','<h3><font>포장 정보</font></h3>')),/속성·포장 표/);
 const oversized='<section><h3><font>상품 속성</font></h3><table>'+Array.from({length:51},(_,i)=>`<tr><th><font>属性${i}</font></th><td><font>值</font></td></tr>`).join('')+'</table></section>';
 assert.throws(()=>capture(oversized),/속성·포장 표/);
});

test('translated row names require stable exact supplier SKU; no row-order or translation matching is invented',()=>{
 const koreanNames=['리본 뒤꿈치 패드 베이지','리본 뒤꿈치 패드 분홍','리본 뒤꿈치 패드 검정'];
 const base=table(['색상','무게(g)'],koreanNames.map(name=>[name,'10'])).replace('包装信息','포장 정보');
 assert.throws(()=>capture(base),/Chrome 번역.*원문 표시/);
 let index=0;const identified=base.replace(/<tr><td>/gu,()=>`<tr data-sku-id="synthetic-${index++}"><td>`);
 assert.deepEqual(capture(identified).options.map(row=>[row.name,row.packaging.weightG]),names.map(name=>[name,10]));
 assert.throws(()=>capture(identified.replace('data-sku-id="synthetic-0"','data-sku-id="unknown-sku"')),/포장 표의 옵션명·SKU/);
 assert.throws(()=>capture(identified.replace('data-sku-id="synthetic-0"','data-sku-id="synthetic-0" data-skuid="synthetic-1"')),/속성·포장 표/);
});

test('recommendations, reviews, shop and nav sections cannot contribute product facts',()=>{
 for(const wrapper of ['<div class="recommendations">','<div id="review-zone">','<aside>','<nav>','<div class="shop-card">']){
  const tag=wrapper.includes('aside')?'aside':wrapper.includes('nav')?'nav':'div';
  assert.deepEqual(capture(wrapper+attributes+table(['颜色','重量(g)'],[[names[0],'999']])+`</${tag}>`+table()).options.map(row=>row.packaging.weightG),[10,10,10]);
 }
 assert.equal(capture('<div><table><tr><th>颜色</th><th>重量(g)</th></tr><tr><td>'+names[0]+'</td><td>999</td></tr></table></div>').options[0].packaging,undefined);
});

test('unverified or mismatched current-offer IDs cannot authorise DOM facts',()=>{
 for(const invalid of [[],[JSON.stringify({skuModel:{...skuModel,offerId:'700000000795'}})],[JSON.stringify({globalData:{offerBaseInfo:{offerId:'700000000795'},tempModel:{offerId}},skuModel})],
  [scripts[0].replace(`"offerId":"${offerId}"`,`"offerId":"700000000795","offerId":"${offerId}"`)],
  [scripts[0].replace('"tempModel":{','"isPricePrivate":true,"tempModel":{')]])assert.throws(()=>capture(table(),invalid),/옵션 영역|속성 원문/);
 const direct=[JSON.stringify({skuModel,offerImgList:[image]})];assert.equal(capture(table(),direct).options[0].packaging.weightG,10);
});

test('unknown or duplicate option identities, contradictory observations and malformed measurements fail explicitly',()=>{
 for(const html of [
  table(['颜色','重量(g)'],[['不在当前商品中的颜色','10']]),
  table(['颜色','重量(g)'],[[names[0],'10'],[names[0],'11']]),
  table(['颜色','SKU','重量(g)'],[[names[0],'synthetic-1','10']]),
  ...['0','-1','10-20','约10','10kg','0.5'].map(value=>table(['颜色','重量(g)'],[[names[0],value]])),
  table(['颜色','重量(g)','重量(g)'],[[names[0],'10','10']]),
  table(['颜色','重量(g)'],[[names[0],'10','unexpected']]),
  table(['颜色','重量'],[[names[0],'10']]),
  '<section><h2>包装信息</h2><p>折叠的包装表</p></section>',
 ])assert.throws(()=>capture(html),/속성·포장 표|포장 표의 옵션명·SKU/);
 assert.throws(()=>capture(attributes+'<section><h2>商品属性</h2><table><tr><th>材质</th><td>棉</td></tr></table></section>'),/속성·포장 표/);
});

test('unknown optional cells and old snapshots stay readable, while forged package metadata is rejected',()=>{
 const source=capture(table(['颜色','重量(g)','宽(mm)'],[[names[0],'10',''],[names[1],'10','--'],[names[2],'10','暂无']]));
 assert.ok(source.options.every(row=>row.packaging.weightG===10&&!Object.hasOwn(row.packaging,'widthMm')));
 const legacy=extractPageSource({sourceUrl,scripts,title:'合成后跟贴',priceText:'¥0.28'});assert.deepEqual(validatePageSource(legacy),legacy);
 for(const packaging of [null,{}, {source:'package-table'}, {source:'product-dimensions',weightG:10}, {source:'package-table',weightG:10,guessed:true},{source:'package-table',weightG:0}]){
  const bad=structuredClone(source);bad.options[0].packaging=packaging;assert.throws(()=>validatePageSource(bad),/속성·포장 표/);
 }
});

for(const company of [{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}])test(company.code+': capture → validated receipt → SQLite new draft preserves physical unit basis and manual retry edits',async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const source=capture(attributes+table()),receipt=h.load('app/source-inbox.ts').pageSourceCollectionResult(source),before=JSON.stringify(receipt);
  const old=await h.load('db/queries.ts').insertProduct({id:'protected-work-794',owner_id:'owner',source_url:'synthetic://protected-work-794',title:'기존 작업 보존',source_price_cny:1,exchange_rate:350,supply_margin:50,coupang_margin:40,supply_price:350,sale_price:600,msrp:780,options_count:1,seo_status:'완료',image_status:'완료',quote_status:'대기',registration_status:'대기',supplier_hub_status:'미전송',image_keys:'[]',goal_stage:'work',created_at:new Date().toISOString(),updated_at:new Date().toISOString()});
  void old;const protectedBefore=JSON.stringify(h.sqlite.prepare('SELECT * FROM products WHERE id=?').get('protected-work-794'));
  h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=? WHERE id=?').run(offerId,sourceUrl,'job');
  await h.load('db/collection-results.ts').storeCollectionResult('owner','job',receipt);
  const job=await h.load('db/collection-jobs.ts').findCollectionJob('owner','job'),saved=await h.load('db/collection-products.ts').promoteCollection('owner',job,receipt);
  const options=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(saved.product_id).payload);
  for(const row of options.rows){assert.equal(row.packagedWeightG,10);assert.equal(row.provenance.packagedWeightG,'collected');assert.equal(row.packagingUnitsPerPack,1);assert.equal(row.minimumOrderQuantity,1);assert.equal(row.widthCm,null);assert.equal(row.weightKg,null);assert.equal(row.packagedWidthMm,null);}
  const product=h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(saved.product_id),content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(saved.product_id).payload);
  assert.equal(content.label.material.value,'海绵');assert.equal(content.label.material.provenance,'collected');
  const resolve=h.load('app/quotation-schema.ts').resolveQuotationFields,quote=resolve({categoryId:'80719',product,content,options,settings:h.settings});
  assert.equal(quote.rows.find(row=>row.optionId).fields.packagedWeightG.value,'10');assert.equal(quote.rows.find(row=>row.optionId).fields.packagedDimensionsMm.value,'');
  const bundled={...options,rows:options.rows.map(row=>({...row,unitsPerPack:3}))},bundleQuote=resolve({categoryId:'80719',product,content,options:bundled,settings:h.settings});
  assert.ok(bundleQuote.rows.find(row=>row.optionId).fields.packagedWeightG.issues.some(issue=>issue.includes('1개입 기준')));
  options.rows[0].packagedWeightG=777;options.rows[0].provenance.packagedWeightG='manual';
  h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(options),saved.product_id);
  await h.load('db/collection-products.ts').promoteCollection('owner',job,receipt);
  assert.equal(JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(saved.product_id).payload).rows[0].packagedWeightG,777);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM products WHERE id=?').get('protected-work-794')),protectedBefore);assert.equal(JSON.stringify(receipt),before);
  assert.equal(h.network.length,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n,0);
 }finally{h.close();}
});

test('collection result separately rejects malformed packaging without trusting page validation',()=>{
 const h=mobileIntakeHarness();try{
  const receipt=h.load('app/source-inbox.ts').pageSourceCollectionResult(capture(table())),{offerId:ignored,...raw}=receipt;void ignored;
  for(const packaging of [{source:'package-table',weightG:-1},{source:'package-table',widthMm:1.2},{source:'package-table',weightG:'10'},{source:'estimate',weightG:10}])assert.throws(()=>h.load('app/collection-result.ts').validateCollectionResult({...raw,options:[{...raw.options[0],packaging}]},offerId));
 }finally{h.close();}
});

const bundled=await build({entryPoints:[fileURLToPath(new URL('../deployment/extension-page-collector.mjs',import.meta.url))],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120'});
test('trusted collection button reads visible package facts and preserves click-only/no-network delivery',async()=>{
 const document=documentFromHtml(attributes+table()),hostDom=pageCollectorDom(),elements=hostDom.elements,messages=[];
 const queryAll=document.querySelectorAll;document.querySelectorAll=selector=>selector.includes(' img')?[]:queryAll(selector);
 document.getElementById=hostDom.document.getElementById;document.documentElement=hostDom.document.documentElement;document.title='合成后跟贴';document.scripts=scripts.map(textContent=>({textContent}));
 document.querySelector=selector=>selector==='.price-container'?{textContent:'¥0.28 1双起批'}:null;
 document.createElement=hostDom.document.createElement;
 const window={};window.top=window;
 vm.runInNewContext(bundled.outputFiles[0].text,{window,document,location:{href:sourceUrl},URL,Date,Error,TextEncoder,chrome:{runtime:{sendMessage:async message=>{messages.push(message);return{ok:true,delivered:true};}}},fetch(){assert.fail('No source request');}});
 const button=elements.find(node=>node.tag==='button');await button.click({isTrusted:false});assert.equal(messages.length,0);await button.click({isTrusted:true});
 assert.equal(messages.length,1,elements.find(node=>node.tag==='p').textContent);assert.deepEqual(JSON.parse(JSON.stringify(messages[0].snapshot.options.map(row=>row.packaging.weightG))),[10,10,10]);assert.equal(button.textContent,'수집 완료');
});

test('trusted button keeps virtualized attributes, package table and later detail images across one viewport sweep',async()=>{
 const early=documentFromHtml(attributes),middle=documentFromHtml(table()),late=documentFromHtml(''),hostDom=pageCollectorDom(),messages=[];
 const document=hostDom.document,view={scrollX:0,scrollY:0,innerHeight:800,addEventListener(){},removeEventListener(){}};view.top=view;view.scrollTo=position=>{view.scrollX=position.left;view.scrollY=position.top;};
 document.scrollingElement={scrollHeight:6000};document.visibilityState='visible';document.addEventListener=()=>{};document.removeEventListener=()=>{};document.defaultView=view;
 document.title='合成后跟贴';document.scripts=scripts.map(textContent=>({textContent}));
 const imageUrl='https://cbu01.alicdn.com/synthetic-virtual-detail.png',virtualImage={tagName:'IMG',currentSrc:imageUrl,getAttribute:name=>name==='src'?imageUrl:null};
 document.querySelectorAll=selector=>{
  if(selector==='#desc-lazyload-container img,.offer-description img')return view.scrollY>=1600?[virtualImage]:[];
  if(selector==='#desc-lazyload-container,.offer-description,.detail-desc-decorate-richtext,[data-module-name="description"],[data-plg-name="description"]')return[];
  return (view.scrollY<600?early:view.scrollY<1400?middle:late).querySelectorAll(selector);
 };
 document.querySelector=selector=>selector==='.price-container'?{textContent:'¥0.28 1双起批'}:null;
 vm.runInNewContext(bundled.outputFiles[0].text,{window:view,document,location:{href:sourceUrl},URL,Date,Error,TextEncoder,setTimeout:callback=>{callback();return 1;},clearTimeout(){},
  chrome:{runtime:{sendMessage:async message=>{messages.push(message);return{ok:true,delivered:true};}}},fetch(){assert.fail('No source request');}});
 const button=hostDom.elements.find(node=>node.tag==='button');await button.click({isTrusted:true});
 assert.equal(messages.length,1,hostDom.elements.find(node=>node.tag==='p').textContent);
 assert.deepEqual(JSON.parse(JSON.stringify(messages[0].snapshot.attributes)),[{name:'材质',value:'海绵'},{name:'产品类别',value:'后跟贴'}]);
 assert.deepEqual(JSON.parse(JSON.stringify(messages[0].snapshot.options.map(row=>row.packaging.weightG))),[10,10,10]);
 assert.deepEqual(JSON.parse(JSON.stringify(messages[0].snapshot.images.filter(row=>row.role==='detail').map(row=>row.url))),[imageUrl]);
 assert.equal(view.scrollY,0);assert.equal(button.textContent,'수집 완료');
});
