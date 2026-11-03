import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from 'parse5';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {extractPageSource,readPageSourceDescriptionReference,readPageSourceDomFacts} from '../extensions/supplier-hub/page-source.mjs';
import {readPageContextLiteral} from '../extensions/supplier-hub/page-context-literal.mjs';
import {pageDescriptionUrl} from '../extensions/supplier-hub/page-description.mjs';
import {pageCollectorDom} from './helpers/page-collector-dom.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {productDocument} from './helpers/product-document.mjs';

// Redacted, supplied offline HTML; never execute the script or fetch its URLs.
// Original artifact SHA256: 58ae93b1bad3677825beaf7d3e7682e4defbdadce95bce500ecd213258f64520.
const html=fs.readFileSync(new URL('./fixtures/1688-context-965495834905.html',import.meta.url),'utf8');
const sourceUrl='https://detail.1688.com/offer/965495834905.html';
const scripts=[];function walk(node){if(node.tagName==='script')scripts.push((node.childNodes??[]).map(child=>child.value??'').join(''));for(const child of node.childNodes??[])walk(child);}walk(parse(html));
function capture(input=scripts){return extractPageSource({sourceUrl,title:'离线原文',scripts:input,priceText:'¥1.18'});}
const prefix=scripts[0].slice(0,scripts[0].indexOf('{"result"'));
const wrap=literal=>prefix+literal+');';
const original=readPageContextLiteral(scripts[0]).value;
const changed=mutate=>{const value=structuredClone(original);mutate(value);return [wrap(JSON.stringify(value))];};
const nodes=value=>({json:value.result.data.Root.fields.dataJson,global:value.result.global.globalData,detail:value.result.global.globalData.model.offerDetail,pack:value.result.data.productPackInfo.fields.pieceWeightScale,description:value.result.data.description.fields});
function tradeFacts(value){
 const trade=nodes(value).global.model.tradeModel={offerId:965495834905,beginAmount:1,offerPriceModel:{currentPrices:[{beginAmount:1,price:'1.18'}]}};
 const main=value.result.data.mainPrice={fields:{uiType:'od_main_price',finalPriceModel:{tradeWithoutPromotion:{offerBeginAmount:1}},priceModel:{currentPrices:[{beginAmount:1,price:'1.18'}]}}};
 return {trade,main:main.fields};
}

test('context literal decimal keys are normalized only in object key positions; strings/array values retain bytes',()=>{
 const result=readPageContextLiteral(wrap('{"map":{5908770696567:0.05},"text":"5908770696567: 0.05","array":[98,0.05]}'));
 assert.deepEqual(result.value,{map:{'5908770696567':0.05},text:'5908770696567: 0.05',array:[98,0.05]});
 assert.match(result.literal,/"5908770696567":0.05/u);
});

test('context literal rejects duplicate semantic keys, prototype keys, computed/executable keys and changed wrappers',()=>{
 for(const literal of ['{98:1,"98":2}','{"offerId":1,"offer\\u0049d":2}','{"__proto__":{}}','{"protot\\u0079pe":{}}','{"constructor":{}}',
  '{["result"]:{}}','{result:{}}','{...{}}','{get "result"(){return {}}}','{"result":function(){}}','{-1:0}','{1.5:0}','{1e2:0}','{0x10:0}',"{'result':{}}"])
  assert.throws(()=>readPageContextLiteral(wrap(literal)),undefined,literal);
 assert.throws(()=>readPageContextLiteral(wrap('{}').replace('return d}','d.result={};return d}')));
 assert.equal(readPageContextLiteral('const note='+JSON.stringify(wrap('{}'))+';'),null);
});

test('context literal bounds UTF8 bytes, nesting and entry counts before accepting data',()=>{
 for(const literal of ['{"x":'+ '['.repeat(65)+'0'+']'.repeat(65)+'}',JSON.stringify({x:'中'.repeat(700000)}),'{"x":['+Array(50002).fill('0').join(',')+']}'])
  assert.throws(()=>readPageContextLiteral(wrap(literal)));
});

test('recorded context carrier preserves all23 attributes and8 declared SKU weights without inventing dimensions or BODY',()=>{
 const result=capture();assert.equal(result.options.length,8);assert.equal(result.attributes.length,23);
 assert.deepEqual(result.attributes[0],{name:'面料名称',value:'涤棉'});
 assert.ok(result.options.every(row=>row.packaging?.weightG===50));
 for(const row of result.options)assert.deepEqual(row.packaging,{source:'package-table',weightG:50});
 assert.equal(result.images.filter(row=>row.role==='detail').length,0,'A reference is not downloaded BODY content');
 assert.equal(result.description,'');
});

test('live Korean color display header preserves the same machine-keyed SKU weights and detail reference',()=>{
 const input=changed(value=>nodes(value).pack.columnList.find(row=>row.name==='sku1').label='색상');
 const result=capture(input);
 assert.equal(result.attributes.length,23);assert.equal(result.options.length,8);
 assert.ok(result.options.every(row=>row.packaging?.weightG===50));
 assert.deepEqual(readPageSourceDescriptionReference(sourceUrl,input),readPageSourceDescriptionReference(sourceUrl,scripts));
 for(const label of ['사이즈','重量(g)',''])assert.throws(()=>capture(changed(value=>nodes(value).pack.columnList.find(row=>row.name==='sku1').label=label)));
});

test('context retains explicit supplier MOQ and per-SKU available stock without inferring currency or retail pack size',()=>{
 const input=changed(value=>{tradeFacts(value);for(const row of Object.values(nodes(value).json.skuModel.skuInfoMap))row.priceAmount=12;});
 const result=extractPageSource({sourceUrl,scripts:input});
 assert.ok(result.options.every(row=>row.minimumOrder===1&&row.currency===null));
 const expected=original.result.data.Root.fields.dataJson.skuModel.skuInfoMap;
 assert.ok(result.options.every(row=>row.stock===expected[row.name].canBookCount));
 assert.ok(result.options.every(row=>!Object.hasOwn(row,'quantity')&&!Object.hasOwn(row,'packQuantity')));
 const zero=capture(changed(value=>Object.values(nodes(value).json.skuModel.skuInfoMap)[0].canBookCount=0));
 assert.equal(zero.options[0].stock,0);
});

test('context stock and minimum declarations reject invalid or conflicting supplied facts but leave absent facts unknown',()=>{
 for(const bad of [-1,0.5,Number.MAX_SAFE_INTEGER+1,'100',false])assert.throws(()=>capture(changed(value=>Object.values(nodes(value).json.skuModel.skuInfoMap)[0].canBookCount=bad)));
 assert.throws(()=>capture(changed(value=>Object.values(nodes(value).json.skuModel.skuInfoMap)[0].stock=1)));
 for(const mutate of [
  ({trade})=>trade.offerId=1,({trade})=>trade.beginAmount=0,({trade})=>trade.beginAmount=1.5,
  ({trade})=>trade.beginAmount=false,({main})=>main.finalPriceModel.tradeWithoutPromotion.offerBeginAmount=2,
  ({trade})=>trade.offerPriceModel.currentPrices[0].beginAmount=2,
  ({main})=>main.priceModel.currentPrices[0].beginAmount=2,
 ])assert.throws(()=>capture(changed(value=>mutate(tradeFacts(value)))));
 const unknown=capture(changed(value=>{for(const row of Object.values(nodes(value).json.skuModel.skuInfoMap))delete row.canBookCount;}));
 assert.ok(unknown.options.every(row=>row.minimumOrder===null&&row.stock===null));
});

test('recorded current offer identity authorizes the exact matching primary detail reference only',()=>{
 assert.deepEqual(readPageSourceDescriptionReference(sourceUrl,scripts),{sourceUrl,offerId:'965495834905',detailUrl:'https://itemcdn.tmall.com/1688offer/icoss3467382834d6c537f06e19a9e2'});
 assert.equal(pageDescriptionUrl(readPageSourceDescriptionReference(sourceUrl,scripts).detailUrl,'965495834905'),'https://itemcdn.tmall.com/1688offer/icoss3467382834d6c537f06e19a9e2');
 for(const url of ['https://itemcdn.tmall.com.evil.test/1688offer/a','https://itemcdn.tmall.com/1688offer/a#hash','https://itemcdn.tmall.com/other/a','https://itemcdn.tmall.com/1688offer/a?offerId=1'])assert.throws(()=>pageDescriptionUrl(url,'965495834905'));
});

test('each primary identity/privacy link and the two description references must agree, without borrowing recommendation data',()=>{
 const mutations=[
  value=>nodes(value).json.tempModel.offerId=1,value=>nodes(value).json.offerBaseInfo.offerId=1,
  value=>nodes(value).global.parametersMap.offerId='1',value=>nodes(value).detail.offerId=1,
  value=>nodes(value).json.isPicPrivate=true,value=>nodes(value).json.isPricePrivate=true,
  value=>nodes(value).detail.isDetailForbidden=true,value=>nodes(value).global.isPicPrivate=true,
  value=>nodes(value).json.skuModel.offerId=1,value=>nodes(value).detail.subject='other title',
  value=>nodes(value).json.skuModel.productId='700000000002',
  value=>nodes(value).description.detailUrl+='Different',
  value=>{value.recommendations={featureAttributes:nodes(value).detail.featureAttributes};delete nodes(value).detail.featureAttributes;},
 ];
 for(const mutation of mutations){const input=changed(mutation);assert.throws(()=>capture(input));assert.throws(()=>readPageSourceDescriptionReference(sourceUrl,input));}
 assert.throws(()=>capture([scripts[0],scripts[0]]));
});

test('verified context also binds DOM observations and conflicts cannot overwrite the declared source table',()=>{
 const document=weight=>productDocument(`<section><h3>商品属性</h3><table><tr><th>面料名称</th><td>涤棉</td></tr></table></section><section><h3>包装信息</h3><table><tr><th>颜色</th><th>重量(g)</th></tr><tr data-sku-id="5908770696567"><td>白色</td><td>${weight}</td></tr></table></section>`);
 const facts=readPageSourceDomFacts(document(50),sourceUrl,scripts);
 const result=extractPageSource({sourceUrl,scripts,priceText:'¥1.18',domFacts:facts});
 assert.equal(result.attributes.length,23);assert.ok(result.options.every(row=>row.packaging.weightG===50));
 const conflict=readPageSourceDomFacts(document(100),sourceUrl,scripts);
 assert.throws(()=>extractPageSource({sourceUrl,scripts,priceText:'¥1.18',domFacts:conflict}));
});

test('declared table units, exact unique SKU/color joins and zero-as-unknown stay enforced',()=>{
 for(const mutate of [value=>nodes(value).pack.columnList.find(row=>row.name==='weight').label='重量',
  value=>nodes(value).pack.columnList.find(row=>row.name==='weight').label='重量(kg)',
  value=>nodes(value).pack.pieceWeightScaleInfo[0].skuId=1,
  value=>nodes(value).pack.pieceWeightScaleInfo[0].sku1='foreign color',
  value=>nodes(value).pack.pieceWeightScaleInfo[1]=structuredClone(nodes(value).pack.pieceWeightScaleInfo[0]),
  value=>nodes(value).pack.pieceWeightScaleInfo.pop(),
  value=>nodes(value).pack.pieceWeightScaleInfo[0].weight=-1,
  value=>nodes(value).pack.pieceWeightScaleInfo[0].weight=0.05,
  value=>nodes(value).pack.columnList.push(structuredClone(nodes(value).pack.columnList[0])),
 ])assert.throws(()=>capture(changed(mutate)));
 const data=changed(value=>{for(const row of nodes(value).pack.pieceWeightScaleInfo){row.length=1.2;row.width=0;row.height=0;row.weight=0;}});
 assert.ok(capture(data).options.every(row=>JSON.stringify(row.packaging)===JSON.stringify({source:'package-table',lengthMm:12})));
 const zero=changed(value=>{for(const row of nodes(value).pack.pieceWeightScaleInfo)row.weight=0;});
 assert.ok(capture(zero).options.every(row=>row.packaging===undefined));
});

test('the actual trusted collector emits the recorded facts and only the existing bound description request',async()=>{
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../deployment/extension-page-collector.mjs',import.meta.url))],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120'});
 const messages=[],{document,elements}=pageCollectorDom({scripts:scripts.map(textContent=>({textContent})),querySelector:selector=>selector==='.price-container'?{textContent:'¥1.18'}:null}),window={};window.top=window;
 vm.runInNewContext(bundle.outputFiles[0].text,{window,document,location:{href:sourceUrl},URL,Date,Error,TextEncoder,chrome:{runtime:{sendMessage:async message=>{messages.push(structuredClone(message));return message.type==='YOOFAM_READ_PAGE_DESCRIPTION'?{ok:false}:{ok:true,delivered:true};}}},fetch:()=>assert.fail('No recorded URL may be requested')});
 await elements.find(node=>node.tag==='button').click({isTrusted:true});
 assert.equal(messages.filter(row=>row.type==='YOOFAM_READ_PAGE_DESCRIPTION').length,1);
 const saves=messages.filter(row=>row.type==='YOOFAM_SAVE_PAGE_SOURCE');assert.equal(saves.length,1);
 const snapshot=saves[0].snapshot;assert.equal(snapshot.attributes.length,23);assert.equal(snapshot.options.filter(row=>row.packaging?.weightG===50).length,8);assert.equal(snapshot.images.filter(row=>row.role==='detail').length,0);
 const h=mobileIntakeHarness();try{
  const receipt=h.load('app/source-inbox.ts').pageSourceCollectionResult(snapshot),draft=h.load('app/collection-product.ts').prepareCollectionProduct('owner',{offer_id:snapshot.offerId,source_url:sourceUrl,context:h.context},receipt,'synthetic-context-product',new Date().toISOString());
  assert.equal(receipt.attributes.length,23);assert.ok(draft.options.rows.every(row=>row.packagedWeightG===50&&row.packagedWidthMm===null&&row.packagedLengthMm===null&&row.packagedHeightMm===null));assert.equal(h.network.length,0);
 }finally{h.close();}
});
