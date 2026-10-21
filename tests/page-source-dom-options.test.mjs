import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parseFragment} from 'parse5';
import {build} from 'esbuild';
import {extractPageSource,readPageSourceDomOptions,pageSourceIssues} from '../extensions/supplier-hub/page-source.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const offerId='700000000001',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`,gallery='https://cbu01.alicdn.com/synthetic-gallery.jpg';
const identity=(patch={})=>JSON.stringify({globalData:{offerBaseInfo:{offerId,subject:'合成测试商品'},tempModel:{offerId},...patch}});
const script=identity();
const tile=(name,price='¥5.30',extra='')=>`<li class="sku-item">${name} <img src="https://cbu01.alicdn.com/synthetic-${name}.jpg"><span>${price}</span> 库存8 ${extra}</li>`;
const html=(tiles,extra='')=>`<section class="offer-sku"><span>颜色</span><ul>${tiles}</ul>${extra}</section>`;
const group=(label,tiles)=>`<span>${label}</span><ul>${tiles}</ul>`;
const groupsHtml=(groups,rows='')=>`<section class="offer-sku">${groups}${rows}</section>`;
const combination=(name,price='¥5.30')=>`<div class="sku-row">${name} <span>${price}</span> 库存8</div>`;

// Parse actual fixture HTML into a deliberately small DOM adapter. It supports
// only the retained RS tag/attribute selectors used by the production reader.
// No page scripts, external resources or browser globals execute.
function documentFromHtml(value){
 const ast=parseFragment(value);
 const match=(node,selector)=>selector.split(',').some(part=>{
  part=part.trim();if(/^[a-z]+$/u.test(part))return node.tagName===part;
  if(part==='a[href]')return node.tagName==='a'&&node.getAttribute('href')!==null;
  const attr=/^\[(class|id)\*="([^"]+)"( i)?\]$/u.exec(part);assert.ok(attr,`Unsupported fixture selector: ${part}`);
  const actual=node.getAttribute(attr[1])??'';return attr[3]?actual.toLowerCase().includes(attr[2].toLowerCase()):actual.includes(attr[2]);
 });
 const wrap=(raw,parent=null)=>{
  const element={tagName:raw.tagName,parentElement:parent,raw,children:[],getAttribute(name){return raw.attrs?.find(attr=>attr.name===name)?.value??null;},contains(other){for(let node=other;node;node=node.parentElement)if(node===element)return true;return false;},closest(selector){for(let node=element;node;node=node.parentElement)if(node.tagName&&match(node,selector))return node;return null;},querySelectorAll(selector){return descendants(element).filter(child=>match(child,selector));},querySelector(selector){return element.querySelectorAll(selector)[0]??null;}};
  Object.defineProperties(element,{textContent:{get(){const text=node=>node.value??(node.childNodes??[]).map(text).join('');return text(raw);}},currentSrc:{get(){return element.getAttribute('src')??'';}},nextElementSibling:{get(){if(!parent)return null;return parent.children[parent.children.indexOf(element)+1]??null;}}});
  element.children=(raw.childNodes??[]).filter(child=>child.tagName).map(child=>wrap(child,element));return element;
 };
 const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]),root=wrap(ast);
 return {querySelectorAll:selector=>root.querySelectorAll(selector),querySelector:selector=>root.querySelector(selector)};
}
function capture(value,{scripts=[script],url=sourceUrl,dom}={}){
 const document=documentFromHtml(value),domOptions=dom??readPageSourceDomOptions(document,url,scripts);
 return extractPageSource({sourceUrl:url,scripts,domOptions,title:'合成测试商品',gallery:[gallery],priceText:'¥999.00',minimumOrderText:'100件起批'});
}

test('one current-offer DOM group preserves observed per-option CNY prices and unknown supplier facts, and can form an editable receipt',()=>{
 const source=capture(html(tile('黑色','¥5.30')+tile('灰色','￥6.10')));
 assert.deepEqual(source.options.map(row=>({key:row.key,name:row.name,price:row.unitPriceCny,currency:row.currency,sku:row.supplierSku,minimum:row.minimumOrder,stock:row.stock})),[
  {key:'dom-row:1',name:'黑色',price:5.3,currency:'CNY',sku:null,minimum:null,stock:null},
  {key:'dom-row:2',name:'灰色',price:6.1,currency:'CNY',sku:null,minimum:null,stock:null},
 ]);
 assert.deepEqual(pageSourceIssues(source),['공급자 SKU','최소 주문 수량']);
 assert.equal(source.images.filter(image=>image.role==='additional').length,2);
 const h=mobileIntakeHarness();try{
  const result=h.load('app/source-inbox.ts').pageSourceCollectionResult(source),before=JSON.stringify(result);assert.equal(result.options[0].sku,'');assert.equal(result.pageOptionIdentity.sourceKeys[0],'dom-row:1');assert.equal(result.options[0].unitPriceCny,5.3);
  const draft=h.load('app/collection-product.ts').prepareCollectionProduct('owner',{id:'synthetic-dom-job',owner_id:'owner',offer_id:offerId,source_url:sourceUrl,goal:'work',status:'awaiting_connector',context:h.context},result,'synthetic-dom-product',new Date().toISOString());
  assert.deepEqual(Array.from(draft.options.rows,row=>[row.originalName,row.unitCostCny,row.supplierSku,row.minimumOrderQuantity,row.provenance.supplierSku]),[['黑色',5.3,'',null,'unverified'],['灰色',6.1,'',null,'unverified']]);
  assert.equal(draft.product.supplier_hub_status,'미전송');assert.equal(JSON.stringify(result),before);assert.equal(h.network.length,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);
 }finally{h.close();}
});

test('a single observed option containing image/price children remains one variant',()=>{
 assert.equal(capture(html(tile('黑色'))).options.length,1);
});

test('exact inventory rows in the same labelled SKU root retain missing prices rather than omit an unpriced variant',()=>{
 const source=capture(html('','<div class="sku-row">黑色 <span>¥4.70</span> 库存8</div><div class="sku-row">灰色 库存3</div>'));
 assert.deepEqual(source.options.map(row=>[row.name,row.unitPriceCny,row.currency]),[['黑色',4.7,'CNY'],['灰色',null,null]]);assert.ok(pageSourceIssues(source).includes('옵션 원가'));
});

test('image-only option tiles remain unknown-price variants or reject a missing name instead of disappearing',()=>{
 const source=capture(html(tile('黑色')+'<li><img src="https://cbu01.alicdn.com/synthetic-gray.jpg" alt="灰色"></li>'));
 assert.equal(source.options.length,2);assert.equal(source.options[1].name,'灰色');assert.equal(source.options[1].unitPriceCny,null);assert.ok(pageSourceIssues(source).includes('옵션 원가'));
 assert.throws(()=>capture(html(tile('黑色')+'<li><img src="https://cbu01.alicdn.com/synthetic-gray.jpg"></li>')),/옵션 영역/);
});

test('missing, ranged, duplicated or non-CNY row prices stay unknown; headline CNY and one priced row never fill other options',()=>{
 for(const uncertain of ['','5.80','₩1,000','¥5.00～6.00','¥5.00 - ¥6.00','¥5.30 起']){
  const source=capture(html(tile('黑色','¥5.30')+tile('灰色',uncertain)));
  assert.equal(source.options.length,2);assert.equal(source.options[0].unitPriceCny,5.3);assert.equal(source.options[1].unitPriceCny,null);assert.equal(source.options[1].currency,null);
  assert.ok(pageSourceIssues(source).includes('옵션 원가'));assert.ok(pageSourceIssues(source).includes('위안(CNY) 통화'));
 }
});

test('script SKU data remains authoritative and malformed or empty declarations cannot fall back to DOM',()=>{
 const dom=readPageSourceDomOptions(documentFromHtml(html(tile('DOM 黑色'))),sourceUrl,[script]);
 for(const declaration of ['"skuModel":null','"skuModel": {bad','"skuModel":(()=>({}))()']){
  const scripts=[script,declaration];assert.equal(readPageSourceDomOptions(documentFromHtml(html(tile('DOM 黑色'))),sourceUrl,scripts),null);
  assert.equal(extractPageSource({sourceUrl,scripts,domOptions:dom,title:'合成测试商品',gallery:[gallery]}).options.length,0);
 }
 const scripts=[script,JSON.stringify({skuModel:{offerId,skuInfoMap:{actual:{specAttrs:'JSON 黑色',skuId:'actual-sku',price:'7.25'}}}})];
 const source=extractPageSource({sourceUrl,scripts,domOptions:dom,title:'合成测试商品',gallery:[gallery],priceText:'¥7.25'});
 assert.equal(source.options.length,1);assert.equal(source.options[0].name,'JSON 黑色');assert.equal(source.options[0].supplierSku,'actual-sku');assert.equal(source.options[0].unitPriceCny,7.25);
 assert.throws(()=>capture(html(tile('黑色')),{scripts:[script,JSON.stringify({skuModel:{offerId:'700000000002',skuInfoMap:{}}})]}),/상품 번호/);
});

test('raw identity mismatches, duplicate aliases and private product flags reject DOM capture before publication',()=>{
 const invalid=[[],[JSON.stringify({globalData:{offerBaseInfo:{offerId:'700000000002'}}})],[identity({tempModel:{offerId:'700000000002'}})],[identity({isPricePrivate:true})],[identity({isPicPrivate:true})],[identity({offerSigns:{isDetailForbidden:true}})],['{"globalData":{"offerBaseInfo":{"offerId":"700000000002","offerId":"700000000001"}}}'],['{"globalData":{"offerBaseInfo":{"offerId":"700000000001","offerId":"700000000001"}}}']];
 for(const scripts of invalid)assert.throws(()=>capture(html(tile('黑色')),{scripts}),/옵션 영역|속성 원문/);
 const dom=readPageSourceDomOptions(documentFromHtml(html(tile('黑色'))),sourceUrl,[script]);
 assert.throws(()=>capture(html(tile('黑色')),{dom:{...dom,sourceUrl:sourceUrl.replace(offerId,'700000000002')}}),/옵션 영역/);
});

test('review/recommendation roots are excluded, competing roots and foreign offer links fail closed, and unknown SKU attributes are not trusted',()=>{
 const good=html(tile('黑色'));
 assert.equal(capture(`<div class="recommendations">${html(tile('推荐产品','¥0.10'))}</div>${good}`).options[0].name,'黑色');
 assert.equal(capture(`<div id="review-zone">${html(tile('评价产品','¥0.10'))}</div>${good}`).options.length,1);
 assert.throws(()=>capture(good+html(tile('另一个商品'))),/옵션 영역/);
 assert.throws(()=>capture(html(tile('黑色'),'<a href="https://detail.1688.com/offer/700000000002.html">另一商品</a>')),/옵션 영역/);
 assert.throws(()=>capture(html(tile('黑色')+tile('黑色','¥6.10'))),/옵션 영역/);
 const source=capture(html(tile('黑色','¥5.30','<b data-sku-id="invented">SKU</b>')));assert.equal(source.options[0].supplierSku,null);
});

test('multiple attribute groups and excessive variants never become guessed or truncated SKU combinations',()=>{
 assert.throws(()=>capture(html(tile('黑色'),'<span>尺码</span><ul><li>均码 ¥5.30 库存1</li></ul>')),/옵션 영역/);
 assert.throws(()=>capture(html(Array.from({length:201},(_,i)=>tile('颜色'+i)).join(''))),/옵션 영역/);
});

test('one varying colour axis plus actual singleton attributes yields exactly the observed hats, using only each colour tile price',()=>{
 const colors=Array.from({length:13},(_,index)=>({name:'黑色款'+index,price:index===0?'¥5.30':`¥${(5+index/10).toFixed(2)}`}));
 const source=capture(groupsHtml(group('颜色',colors.map(({name,price})=>tile(name,price)).join(''))+group('尺码','<li>均码 ¥999.00 库存9</li>')+group('材质','<li>加绒</li>')));
 assert.equal(source.options.length,13);
 assert.deepEqual(source.options.map(row=>row.name),colors.map(({name})=>`${name} / 均码 / 加绒`));
 assert.deepEqual(source.options.map(row=>row.unitPriceCny),colors.map(({price})=>Number(price.slice(1))));
 assert.ok(source.options.every(row=>row.supplierSku===null&&row.minimumOrder===null&&row.stock===null));assert.ok(!source.options.some(row=>row.unitPriceCny===999));
});

test('a singleton first axis preserves DOM name order and cannot lend its price to unpriced varying options',()=>{
 const source=capture(groupsHtml(group('尺码','<li>均码 ¥99.00 库存1</li>')+group('颜色',tile('黑色','¥5.30')+tile('灰色',''))));
 assert.deepEqual(source.options.map(row=>[row.name,row.unitPriceCny,row.currency]),[['均码 / 黑色',5.3,'CNY'],['均码 / 灰色',null,null]]);
 assert.ok(pageSourceIssues(source).includes('옵션 원가'));assert.equal(source.options.length,2);
});

test('a missing attribute value container cannot turn the next attribute header into a fixed singleton',()=>{
 const value='<section class="offer-sku"><div><span>颜色</span></div><div><span>尺码</span></div><ul><li>S ¥5.30 库存8</li><li>M ¥5.30 库存8</li></ul></section>';
 assert.throws(()=>capture(value),/옵션 영역/);
 assert.throws(()=>capture(groupsHtml(group('颜色','<li>尺码</li>')+group('尺码',tile('S')+tile('M')))),/옵션 영역/);
});

test('nested unpriced choices cannot concatenate into a false fixed singleton, while one atomic named value remains valid',()=>{
 const colors=group('颜色',tile('黑色')+tile('灰色','¥6.10'));
 for(const sizes of ['<li><ul><li>S</li><li>M</li></ul></li>','<li><span>S</span><span>M</span></li>']){
  assert.throws(()=>capture(groupsHtml(colors+group('尺码',sizes))),/옵션 영역/);
 }
 const source=capture(groupsHtml(colors+group('尺码','<li><span>均码</span><span>¥99.00</span> 库存8</li>')));
 assert.deepEqual(source.options.map(row=>[row.name,row.unitPriceCny]),[['黑色 / 均码',5.3],['灰色 / 均码',6.1]]);
});

test('explicit full rows override attribute-tile amounts even with only one varying axis, retaining unpriced rows and rejecting partial coverage',()=>{
 const axes=group('颜色',tile('黑色','¥5.30')+tile('灰色','¥6.10'))+group('尺码','<li>均码</li>');
 const source=capture(groupsHtml(axes,combination('黑色 / 均码','')+combination('灰色 / 均码','¥7.30')));
 assert.deepEqual(source.options.map(row=>[row.name,row.unitPriceCny]),[['黑色 / 均码',null],['灰色 / 均码',7.3]]);assert.ok(pageSourceIssues(source).includes('옵션 원가'));
 assert.throws(()=>capture(groupsHtml(axes,combination('灰色 / 均码','¥7.30'))),/옵션 영역/);
});

test('multiple varying axes use each explicit complete inventory tuple and its own price, preserving an unpriced combination',()=>{
 const axes=group('颜色',tile('黑色','¥999.00')+tile('灰色','¥999.00'))+group('尺码','<li>S ¥999.00 库存1</li><li>M ¥999.00 库存1</li>');
 const rows=combination('灰色 / M','¥7.30')+combination('黑色 / S','¥5.30')+combination('灰色 / S','')+combination('黑色 / M','¥6.30');
 const source=capture(groupsHtml(axes,rows));
 assert.deepEqual(source.options.map(row=>[row.name,row.unitPriceCny]),[['灰色 / M',7.3],['黑色 / S',5.3],['灰色 / S',null],['黑色 / M',6.3]]);
 assert.ok(pageSourceIssues(source).includes('옵션 원가'));assert.ok(source.options.every(row=>row.supplierSku===null));
});

test('partial, duplicate, ambiguous or unbound combination rows never produce a guessed full matrix',()=>{
 const axes=group('颜色',tile('黑色')+tile('灰色'))+group('尺码','<li>S</li><li>M</li>');
 const valid=['黑色 / S','黑色 / M','灰色 / S','灰色 / M'];
 for(const names of [valid.slice(0,3),[...valid.slice(0,3),'黑色 / S'],[...valid.slice(0,3),'灰色'],[...valid.slice(0,3),'蓝色 / M'],[...valid.slice(0,3),'M / 灰色'],[...valid.slice(0,3),'灰色/S']]){
  assert.throws(()=>capture(groupsHtml(axes,names.map(name=>combination(name)).join(''))),/옵션 영역/);
 }
 assert.throws(()=>capture(groupsHtml(axes)),/옵션 영역/,'no rows means no Cartesian variants');
});

test('all-singleton groups need one observed full row and do not combine competing attribute prices',()=>{
 const axes=group('颜色',tile('黑色','¥3.00'))+group('尺码','<li>均码 ¥9.00 库存1</li>');
 assert.throws(()=>capture(groupsHtml(axes)),/옵션 영역/);
 const source=capture(groupsHtml(axes,combination('黑色 / 均码','¥5.30')));assert.equal(source.options.length,1);assert.equal(source.options[0].unitPriceCny,5.3);
});

test('duplicate group labels, overlapping roots and multi-axis limits remain fail-closed before any combination result',()=>{
 assert.throws(()=>capture(groupsHtml(group('颜色',tile('黑色')+tile('灰色'))+group('颜色','<li>均码</li>'))),/옵션 영역/);
 assert.throws(()=>capture(groupsHtml(group('颜色',Array.from({length:15},(_,i)=>tile('颜色'+i)).join(''))+group('尺码',Array.from({length:15},(_,i)=>`<li>尺码${i}</li>`).join('')))),/옵션 영역/);
 const value=groupsHtml(group('颜色',tile('黑色')+tile('灰色'))+group('尺码','<li>均码</li>'));
 for(const scripts of [[identity({isPricePrivate:true})],[identity({tempModel:{offerId:'700000000002'}})]])assert.throws(()=>capture(value,{scripts}),/옵션 영역|속성 원문/);
 assert.throws(()=>capture(value+html(tile('无关选项'))),/옵션 영역/);
});

test('trusted current-page button captures DOM fallback in memory with no source requests, iframe access or script execution',async()=>{
 const bundle=await build({entryPoints:['deployment/extension-page-collector.mjs'],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120'}),dom=documentFromHtml(html(tile('黑色')+tile('灰色','¥6.10'))),messages=[],created=[];
 const make=tag=>{const element={tag,id:'',style:{},textContent:'',hidden:false,disabled:false,setAttribute(){},append(){},attachShadow(){return{append(){}};},addEventListener(type,handler){if(type==='click')element.click=handler;}};created.push(element);return element;};
 const document={...dom,getElementById:()=>null,createElement:make,documentElement:{append(){}},title:'合成测试商品',scripts:[{textContent:script}],querySelector(selector){return selector.startsWith('meta')?{content:'合成测试商品'}:selector==='.price-container'?{textContent:'¥999.00'}:null;},querySelectorAll(selector){if(selector.includes('.detail-gallery'))return[{currentSrc:gallery,getAttribute:()=>gallery}];if(selector.includes('#desc-lazyload-container'))return[];return dom.querySelectorAll(selector);}};
 const window={};window.top=window;
 vm.runInNewContext(bundle.outputFiles[0].text,{window,document,location:{href:sourceUrl},URL,Date,Error,chrome:{runtime:{sendMessage:async message=>{messages.push(message);return{ok:true,delivered:true};}}},fetch:()=>assert.fail('No source request is authorized by a DOM capture')});
 const button=created.find(element=>element.tag==='button');await button.click({isTrusted:false});assert.equal(messages.length,0);await button.click({isTrusted:true});assert.equal(messages.length,1);assert.equal(messages[0].snapshot.options.length,2);assert.equal(messages[0].snapshot.options[0].unitPriceCny,5.3);assert.equal(button.textContent,'수집 완료');
});
