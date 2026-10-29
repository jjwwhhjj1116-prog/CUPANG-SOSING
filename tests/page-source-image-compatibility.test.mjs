import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parseFragment} from 'parse5';
import {build} from 'esbuild';
import {extractPageSource,readPageSourceDomOptions} from '../extensions/supplier-hub/page-source.mjs';
import {pageCollectorDom} from './helpers/page-collector-dom.mjs';

const offerId='700000000001',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const main='https://cbu01.alicdn.com/synthetic-compat-main.jpg',black='https://cbu01.alicdn.com/synthetic-compat-black.jpg',gray='https://cbu01.alicdn.com/synthetic-compat-gray.jpg',selected='https://cbu01.alicdn.com/synthetic-compat-selected.jpg';
const model=()=>({offerId,beginAmount:2,skuInfoMap:{black:{specAttrs:'黑色',skuId:'original-black',price:'5.30',stock:7},gray:{specAttrs:'灰色',skuId:'original-gray',price:'6.10',stock:8}}});
const script=value=>JSON.stringify({offerId,subject:'合成原文',skuModel:value,offerImgList:[main],propsList:[{name:'材质',value:'PP'}]});
const input=(skuModel=model(),patch={})=>({sourceUrl,scripts:[script(skuModel)],priceText:'人民币 2件起批',...patch});
const facts=source=>source.options.map(row=>{const result={...row};delete result.imageUrl;return result;});

// Inert fixture DOM: only the production reader's bounded tag/attribute
// selectors are supported. No scripts, resources or browser APIs execute.
function documentFromHtml(html){
 const match=(node,selector)=>selector.split(',').some(raw=>{
  const part=raw.trim();if(/^[a-z][a-z0-9]*$/u.test(part))return node.tagName===part.toUpperCase();
  if(part==='a[href]')return node.tagName==='A'&&node.getAttribute('href')!==null;
  const descendant=/^(.*) (img)$/u.exec(part);if(descendant){if(node.tagName!=='IMG')return false;for(let parent=node.parentElement;parent;parent=parent.parentElement)if(match(parent,descendant[1]))return true;return false;}
  if(part.startsWith('#'))return node.getAttribute('id')===part.slice(1);
  if(part.startsWith('.'))return (node.getAttribute('class')??'').split(/\s/u).includes(part.slice(1));
  const exact=/^\[([\w-]+)(?:="([^"]*)")?\]$/u.exec(part);if(exact)return exact[2]===undefined?node.getAttribute(exact[1])!==null:node.getAttribute(exact[1])===exact[2];
  const attr=/^\[(class|id)\*="([^"]+)"( i)?\]$/u.exec(part);assert.ok(attr,`Unsupported fixture selector: ${part}`);
  const value=node.getAttribute(attr[1])??'';return attr[3]?value.toLowerCase().includes(attr[2].toLowerCase()):value.includes(attr[2]);
 });
 const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
 const wrap=(raw,parent=null)=>{
  const node={tagName:raw.tagName?.toUpperCase(),parentElement:parent,children:[],getAttribute:name=>raw.attrs?.find(attr=>attr.name===name)?.value??null,
   contains(other){for(let current=other;current;current=current.parentElement)if(current===node)return true;return false;},
   closest(selector){for(let current=node;current;current=current.parentElement)if(current.tagName&&match(current,selector))return current;return null;},
   querySelectorAll(selector){return descendants(node).filter(child=>match(child,selector));},querySelector(selector){return node.querySelectorAll(selector)[0]??null;}};
  Object.defineProperties(node,{textContent:{get(){const text=value=>value.value??(value.childNodes??[]).map(text).join('');return text(raw);}},currentSrc:{get(){return node.getAttribute('src')??'';}},nextElementSibling:{get(){return parent?.children[parent.children.indexOf(node)+1]??null;}}});
  node.children=(raw.childNodes??[]).filter(child=>child.tagName).map(child=>wrap(child,node));return node;
 };
 const root=wrap(parseFragment(html));return{querySelectorAll:selector=>root.querySelectorAll(selector),querySelector:selector=>root.querySelector(selector)};
}
const tile=(name,url=black,extra='')=>`<li>${name}<img src="${url}"><span>¥999.00</span> 库存999 ${extra}</li>`;
const root=(tiles,extra='',attrs='')=>`<section class="offer-sku" data-offer-id="${offerId}" ${attrs}><span>颜色</span><ul>${tiles}</ul>${extra}</section>`;
function capture(html,skuModel=model(),patch={}){
 const source=input(skuModel),domOptions=readPageSourceDomOptions(documentFromHtml(html),sourceUrl,source.scripts);
 return{source:extractPageSource({...source,domOptions,...patch}),domOptions};
}

test('RS gallery URI spellings retain main/additional order and never replace a selected valid source',()=>{
 for(const key of ['fullPathImageURI','fullPathImageUri','image']){
  const value=input(model(),{scripts:[JSON.stringify({offerId,skuModel:model(),offerImgList:[{[key]:main},{[key]:gray}]})],title:'合成原文'});
  const source=extractPageSource(value);assert.deepEqual(source.images,[{url:main,role:'main'},{url:gray,role:'additional'}]);
  assert.deepEqual(facts(source),facts(extractPageSource(input())));
 }
 const source=extractPageSource(input(model(),{scripts:[JSON.stringify({offerId,skuModel:model(),offerImgList:[{originalImageURI:main,fullPathImageURI:gray,image:selected}]})],title:'合成原文'}));
 assert.deepEqual(source.images,[{url:main,role:'main'}]);
 const prior=extractPageSource(input(model(),{scripts:[JSON.stringify({offerId,skuModel:model(),offerImgList:[{imageURI:main,fullPathImageURI:gray}]})],title:'合成原文'}));assert.deepEqual(prior.images,[{url:main,role:'main'}]);
});

test('empty or invalid preferred script image fields yield to the next valid CDN field without changing source facts',()=>{
 for(const empty of ['',null,'data:image/gif;base64,placeholder','https://foreign.invalid/unrelated.jpg']){
  const skuModel=model();skuModel.skuProps=[{value:[{name:'黑色',imageUrl:empty,image:black}]}];skuModel.skuInfoMap.gray.imageUrl=empty;skuModel.skuInfoMap.gray.image=gray;
  const source=extractPageSource(input(skuModel));assert.deepEqual(source.options.map(row=>row.imageUrl),[black,gray]);assert.deepEqual(facts(source),facts(extractPageSource(input())));
  const gallery=extractPageSource(input(model(),{scripts:[JSON.stringify({skuModel:model(),offerImgList:[{originalImageURI:empty,imageURI:main}]})],title:'合成原文'}));assert.deepEqual(gallery.images,[{url:main,role:'main'}]);
 }
 const skuModel=model();skuModel.skuInfoMap.black.imageUrl=selected;skuModel.skuInfoMap.black.image=black;skuModel.skuProps=[{value:[{name:'黑色',imageUrl:gray}]}];
 assert.equal(extractPageSource(input(skuModel)).options[0].imageUrl,selected);
});

test('entity and fullwidth SKU separators match script swatches while preserving exact option names, IDs, prices and order',()=>{
 for(const separator of ['>','&gt;','＞']){
  const skuModel=model();skuModel.skuInfoMap.black.specAttrs='黑色'+separator+'S';skuModel.skuInfoMap.gray.specAttrs='灰色'+separator+'M';
  const before=JSON.stringify(skuModel);skuModel.skuProps=[{value:[{name:'黑色',imageUrl:black},{name:'灰色',imageUrl:gray}]}];
  const source=extractPageSource(input(skuModel));assert.deepEqual(source.options.map(row=>[row.name,row.supplierSku,row.unitPriceCny,row.imageUrl]),[['黑色'+separator+'S','original-black',5.3,black],['灰色'+separator+'M','original-gray',6.1,gray]]);
  assert.equal(JSON.stringify({...skuModel,skuProps:undefined}),before);
 }
});

test('one uniquely named same-offer DOM swatch fills only missing script images, preserving every script fact and selection',()=>{
 const skuModel=model();skuModel.skuInfoMap.gray.imageUrl=selected;const before=JSON.stringify(skuModel),baseline=extractPageSource(input(skuModel));
 const {source,domOptions}=capture(root(tile('灰色',gray)+tile('黑色',black)+tile('其他产品',gray)),skuModel);
 assert.equal(domOptions.format,'yoofam-page-dom-option-images-v1');assert.deepEqual(source.options.map(row=>row.imageUrl),[black,selected]);assert.deepEqual(facts(source),facts(baseline));assert.deepEqual(source.attributes,baseline.attributes);assert.equal(JSON.stringify(skuModel),before);
 assert.ok(!source.images.some(row=>row.url===gray));
});

test('DOM supplementation requires a unique full name and cannot lend an axis image to multiple script combinations',()=>{
 const duplicate=model();duplicate.skuInfoMap.gray.specAttrs='黑色';
 assert.deepEqual(capture(root(tile('黑色',black)),duplicate).source.options.map(row=>row.imageUrl),[null,null]);
 assert.equal(capture(root(tile('黑色',black)+tile('黑色',black))).source.options[0].imageUrl,null);
 assert.equal(capture(root(tile('黑色',black)+`<li>黑色<img src="${gray}"><img src="${black}"></li>`)).source.options[0].imageUrl,null);
 const combined=model();combined.skuInfoMap.black.specAttrs='黑色 / S';combined.skuInfoMap.gray.specAttrs='黑色 / M';
 assert.deepEqual(capture(root(tile('黑色',black)),combined).source.options.map(row=>row.imageUrl),[null,null]);
 assert.deepEqual(capture(root(tile('黑色 / M',gray)+tile('黑色 / S',black)),combined).source.options.map(row=>row.imageUrl),[black,gray]);
});

test('foreign, ambiguous and malformed DOM image evidence preserves script-only results without filling images',()=>{
 const invalid=[root(tile('黑色',black))+root(tile('灰色',gray)),root(tile('黑色',black),'<a href="https://detail.1688.com/offer/700000000002.html">foreign</a>'),
  root(tile('黑色',black)).replace('data-offer-id="'+offerId+'"','data-offer-id="700000000002"'),`<div class="recommendations">${root(tile('黑色',black))}</div>`,
  `<a href="https://detail.1688.com/offer/700000000002.html">${root(tile('黑色',black))}</a>`,root(tile('黑色','https://foreign.invalid/unrelated.jpg')),
  root(`<li title="黑色">灰色<img src="${black}"></li>`),root(`<li>黑色<img src="${black}" alt="灰色"></li>`)];
 for(const html of invalid){const {source}=capture(html);assert.deepEqual(source.options.map(row=>row.imageUrl),[null,null]);assert.deepEqual(facts(source),facts(extractPageSource(input())));}
 const valid=capture(root(tile('黑色',black))).domOptions;
 for(const mutate of [value=>value.sourceUrl=sourceUrl+'?foreign=1',value=>value.offerId='700000000002',value=>value.extra=true,value=>value.images.push({...value.images[0]}),value=>value.images[0].imageUrl='https://foreign.invalid/image.jpg',value=>value.images[0].price=0.01,value=>value.images=[null],value=>value.images=new Array(1)]){
  const evidence=structuredClone(valid);mutate(evidence);const source=extractPageSource(input(model(),{domOptions:evidence}));assert.deepEqual(source.options.map(row=>row.imageUrl),[null,null]);assert.deepEqual(facts(source),facts(extractPageSource(input())));
 }
 for(const extra of ['"skuModel":null','"skuModel": {bad'])assert.deepEqual(extractPageSource(input(model(),{scripts:[script(model()),extra],domOptions:valid})).options.map(row=>row.imageUrl),[null,null]);
 for(const scripts of [[JSON.stringify({skuModel:{skuInfoMap:model().skuInfoMap}})],[JSON.stringify({skuModel:{...model(),offerId:'700000000002'}})],['"skuModel":null'],['"skuModel": {bad'],[script(model()),'"skuModel":null'],[script(model()),'"skuModel": {bad']])assert.equal(readPageSourceDomOptions(documentFromHtml(root(tile('黑色',black))),sourceUrl,scripts),null);
 assert.equal(readPageSourceDomOptions(documentFromHtml(root(tile('黑色',black))),sourceUrl.replace(offerId,'700000000002'),[script(model())]),null);
});

test('the trusted collector button wires image-only supplementation into one immutable source save without source requests',async()=>{
 const data=script(model()),dom=documentFromHtml(root(tile('灰色',gray)+tile('黑色',black))),messages=[];
 const bundle=await build({entryPoints:['deployment/extension-page-collector.mjs'],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120'});
 const {document,elements}=pageCollectorDom({scripts:[{textContent:data}],querySelector:selector=>selector==='.price-container'?{textContent:'人民币 2件起批'}:null,querySelectorAll:selector=>dom.querySelectorAll(selector)});
 const window={};window.top=window;
 vm.runInNewContext(bundle.outputFiles[0].text,{window,document,location:{href:sourceUrl},URL,Date,Error,TextEncoder,chrome:{runtime:{sendMessage:async message=>{messages.push(structuredClone(message));return{ok:true,delivered:true};}}},fetch:()=>assert.fail('No source request')});
 const button=elements.find(element=>element.tag==='button');await button.click({isTrusted:true});assert.equal(messages.length,1,elements.find(element=>element.tag==='p')?.textContent);assert.equal(messages[0].type,'YOOFAM_SAVE_PAGE_SOURCE');assert.deepEqual(messages[0].snapshot.options.map(row=>row.imageUrl),[black,gray]);assert.deepEqual(facts(messages[0].snapshot),facts(extractPageSource(input())));
});
