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

test('context stock and minimum declarations reject invalid supplied facts but leave absent facts unknown',()=>{
 for(const bad of [-1,0.5,Number.MAX_SAFE_INTEGER+1,'100',false])assert.throws(()=>capture(changed(value=>Object.values(nodes(value).json.skuModel.skuInfoMap)[0].canBookCount=bad)));
 assert.throws(()=>capture(changed(value=>Object.values(nodes(value).json.skuModel.skuInfoMap)[0].stock=1)));
 for(const mutate of [
  ({trade})=>trade.offerId=1,({trade})=>trade.beginAmount=0,({trade})=>trade.beginAmount=1.5,
  ({trade})=>trade.beginAmount=false,({main})=>main.finalPriceModel.tradeWithoutPromotion.offerBeginAmount=0,
  ({trade})=>trade.offerPriceModel.currentPrices[0].beginAmount=0,
  ({main})=>main.priceModel.currentPrices[0].beginAmount=0,
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

// Public structural reproduction of offer920067392251: color + size columns,
// entity-separated specAttrs, and per-SKU 200g/zero-dimension source rows.
// Reuse the sanitized carrier; do not publish the private live page carrier.
function twoDimensionContext(value){
 const {json,pack}=nodes(value);
 pack.skuDimensionCount=2;
 json.skuModel.skuProps.push({fid:446,prop:'尺寸',value:[{name:'100*200cm'}]});
 pack.columnList.splice(1,0,{fid:446,precision:0,name:'sku2',label:'尺寸'});
 const map={};
 for(const [name,row] of Object.entries(json.skuModel.skuInfoMap)){
  const label=name+'&gt;100*200cm';row.specAttrs=label;map[label]=row;
 }
 json.skuModel.skuInfoMap=map;
 for(const row of pack.pieceWeightScaleInfo){row.sku2='100*200cm';row.weight=200;}
}

test('recorded two-dimension color/size structure keeps each bound SKU and 200g without inferring package dimensions',()=>{
 const result=capture(changed(twoDimensionContext));
 assert.equal(result.options.length,8);
 assert.equal(result.attributes.length,23);
 assert.ok(result.options.every(row=>row.name.endsWith('&gt;100*200cm')));
 assert.ok(result.options.every(row=>JSON.stringify(row.packaging)===JSON.stringify({source:'package-table',weightG:200})));
 assert.equal(result.options.find(row=>row.supplierSku==='5908770696567').name,'白色&gt;100*200cm');
});

test('two-dimension source rejects mismatched size, color, columns, SKU identity and source conflicts',()=>{
 for(const mutation of [
  value=>nodes(value).pack.skuDimensionCount=3,
  value=>nodes(value).pack.columnList.find(row=>row.name==='sku2').label='重量(g)',
  value=>nodes(value).pack.columnList.splice(1,1),
  value=>nodes(value).pack.columnList.push({name:'sku2',label:'尺寸'}),
  value=>nodes(value).pack.pieceWeightScaleInfo[0].sku2='200*300cm',
  value=>delete nodes(value).pack.pieceWeightScaleInfo[0].sku2,
  value=>nodes(value).pack.pieceWeightScaleInfo[0].sku1='other',
  value=>nodes(value).pack.pieceWeightScaleInfo[0].skuId=1,
  value=>nodes(value).json.tempModel.offerId=1,
  value=>nodes(value).json.isPicPrivate=true,
 ])assert.throws(()=>capture(changed(value=>{twoDimensionContext(value);mutation(value);})));
 const conflict=readPageSourceDomFacts(productDocument('<section><h3>包装信息</h3><table><tr><th>颜色</th><th>重量(g)</th></tr><tr data-sku-id="5908770696567"><td>白色&gt;100*200cm</td><td>100</td></tr></table></section>'),sourceUrl,changed(twoDimensionContext));
 assert.throws(()=>extractPageSource({sourceUrl,scripts:changed(twoDimensionContext),priceText:'¥1.18',domFacts:conflict}));
});

test('two-dimension table components remain source strings instead of coercing numeric size labels',()=>{
 const input=changed(value=>{
  twoDimensionContext(value);const {json,pack}=nodes(value),row=pack.pieceWeightScaleInfo[0];
  const old=row.sku1+'&gt;100*200cm',label=row.sku1+'&gt;200';
  const sku=json.skuModel.skuInfoMap[old];delete json.skuModel.skuInfoMap[old];
  sku.specAttrs=label;json.skuModel.skuInfoMap[label]=sku;row.sku2=200;
 });
 assert.throws(()=>capture(input));
});

function commonContext(value,count=8,weight=178){
 const {json,pack}=nodes(value);pack.skuDimensionCount=0;pack.columnList=pack.columnList.filter(row=>!row.name.startsWith('sku'));
 pack.pieceWeightScaleInfo=[{length:0,width:0,height:0,volume:0,weight}];
 const originalRow=Object.values(json.skuModel.skuInfoMap)[0];
 json.skuModel.skuInfoMap=Object.fromEntries(Array.from({length:count},(_,i)=>['选项'+i,{...originalRow,skuId:6000000000000+i,specAttrs:'选项'+i}]));
}

test('common table preserves offer scope and all324 source SKUs without copying common weight into SKU packaging',()=>{
 const result=capture(changed(value=>commonContext(value,324,400)));
 assert.equal(result.options.length,324);assert.ok(result.options.every(row=>row.packaging===undefined));
 assert.deepEqual(result.sourceEvidence.commonPackaging,{scope:'offer-common',packaging:{source:'package-table',weightG:400}});
 assert.equal(capture(changed(value=>commonContext(value,500))).options.length,500);
 assert.throws(()=>capture(changed(value=>commonContext(value,501))));
 for(const mutate of [value=>nodes(value).pack.pieceWeightScaleInfo.push({weight:178}),value=>nodes(value).pack.pieceWeightScaleInfo[0].skuId=1,value=>nodes(value).pack.columnList.push({name:'sku1',label:'颜色',fid:3216}),value=>Object.values(nodes(value).json.skuModel.skuInfoMap)[323].stock=1])assert.throws(()=>capture(changed(value=>{commonContext(value,324);mutate(value);})));
});

test('SKU package headers bind to the matching declared prop and field ID rather than hardcoded color names',()=>{
 for(const [prop,fid] of [['规格',1234],['封面颜色',100019517]]){
  const modify=value=>{const {json,pack}=nodes(value);json.skuModel.skuProps[0].prop=prop;json.skuModel.skuProps[0].fid=fid;Object.assign(pack.columnList[0],{label:prop,fid});};
  assert.equal(capture(changed(modify)).options.length,8);
  assert.throws(()=>capture(changed(value=>{modify(value);nodes(value).pack.columnList[0].fid=999;})));
 }
});

test('order declarations and tier starts stay separate while conflicting order declarations keep MOQ null',()=>{
 const input=changed(value=>{const {trade,main}=tradeFacts(value);trade.beginAmount=10;trade.tradeWithoutPromotion={offerBeginAmount:10};main.finalPriceModel.tradeWithoutPromotion.offerBeginAmount=10;trade.offerPriceModel.currentPrices=[{beginAmount:2,price:'1.18'}];main.priceModel.currentPrices=[{beginAmount:2,price:'1.18'}];});
 const result=capture(input);assert.ok(result.options.every(row=>row.minimumOrder===10));
 assert.deepEqual(result.sourceEvidence.orderMinimums.map(row=>row.value),[10,10,10]);
 assert.deepEqual(result.sourceEvidence.priceTierStarts.map(row=>row.values),[[2],[2]]);
 const conflict=capture(changed(value=>{const {trade,main}=tradeFacts(value);trade.beginAmount=2;trade.tradeWithoutPromotion={offerBeginAmount:1};main.finalPriceModel.tradeWithoutPromotion.offerBeginAmount=1;}));
 assert.ok(conflict.options.every(row=>row.minimumOrder===null));
 assert.deepEqual(conflict.sourceEvidence.orderMinimums.map(row=>row.value),[2,1,1]);
});

test('324 capture remains immutable through storage and explicit five-key review, with full-source validation before selection',async()=>{
 const snapshot=capture(changed(value=>commonContext(value,324,400)));for(const row of snapshot.options)row.currency='CNY';
 const h=mobileIntakeHarness();try{
  const app=h.load('app/source-inbox.ts'),before=JSON.stringify(snapshot),fingerprint=await app.pageSourceFingerprint(snapshot);
  assert.throws(()=>app.pageSourceCollectionResult(snapshot),/200.*선택/);
  const review={title:snapshot.title,options:snapshot.options.filter((_,i)=>[3,41,99,203,320].includes(i)).map(({key})=>({key}))};
  const reviewed=app.reviewPageSource(snapshot,review);assert.equal(reviewed.options.length,5);assert.equal(JSON.stringify(snapshot),before);
  assert.equal(JSON.stringify(reviewed.sourceEvidence),JSON.stringify(snapshot.sourceEvidence));assert.equal(app.pageSourceCollectionResult(reviewed,true).options.length,5);
  const bad=structuredClone(snapshot);bad.options[323].stock=-1;assert.throws(()=>app.reviewPageSource(bad,review));
  assert.throws(()=>app.reviewPageSource(snapshot,{...review,options:[review.options[0],review.options[0]]}));
  assert.throws(()=>app.reviewPageSource(snapshot,{...review,options:[{key:'unknown'}]}));
  const db=h.load('db/source-inbox.ts');const saved=await db.storeSourceInbox('owner',{code:'A01464742',name:'와이홉'},'capture-324',fingerprint,snapshot);
  assert.equal(saved.item.snapshot.options.length,324);assert.match(saved.item.issues.join(' '),/200.*선택/);
  const result=await db.reviewSourceInbox('owner','capture-324',1,reviewed);assert.equal(result.reviewed.options.length,5);assert.equal(JSON.stringify(result.snapshot),before);
  const listed=JSON.parse(await db.listSourceInboxJson('owner',{code:'A01464742',name:'와이홉'}));assert.equal(listed[0].snapshot.options.length,324);assert.equal(listed[0].snapshot.sourceEvidence.commonPackaging.packaging.weightG,400);
  const altered=structuredClone(snapshot);altered.sourceEvidence.commonPackaging.packaging.weightG=178;assert.notEqual(await app.pageSourceFingerprint(altered),fingerprint);
 }finally{h.close();}
});

test('source-bound common DOM table equal-checks declared measurements and rejects conflicts without inventing SKU joins',()=>{
 const input=changed(value=>commonContext(value,12,178));
 const document=weight=>productDocument(`<section><h3>包装信息</h3><table><tr><th>长(cm)</th><th>宽(cm)</th><th>高(cm)</th><th>体积(cm³)</th><th>重量(g)</th></tr><tr><td>0</td><td>0</td><td>0</td><td>0</td><td>${weight}</td></tr></table></section>`);
 const facts=readPageSourceDomFacts(document(178),sourceUrl,input);
 const result=extractPageSource({sourceUrl,scripts:input,domFacts:facts,priceText:'¥1.18'});
 assert.equal(result.sourceEvidence.commonPackaging.packaging.weightG,178);assert.ok(result.options.every(row=>!row.packaging));
 assert.throws(()=>readPageSourceDomFacts(document(200),sourceUrl,input));
 assert.throws(()=>readPageSourceDomFacts(document(178),sourceUrl,scripts));
});

test('deployment collector entry chain captures324/common400 from a matching bound DOM table without source requests',async()=>{
 const input=changed(value=>commonContext(value,324,400));
 const sourceDocument=productDocument('<section><h3>包装信息</h3><table><tr><th>长(cm)</th><th>宽(cm)</th><th>高(cm)</th><th>体积(cm³)</th><th>重量(g)</th></tr><tr><td>0</td><td>0</td><td>0</td><td>0</td><td>400</td></tr></table></section>');
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../deployment/extension-page-collector.mjs',import.meta.url))],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120'});
 const messages=[],{document,elements}=pageCollectorDom({scripts:input.map(textContent=>({textContent})),querySelector:selector=>selector==='.price-container'?{textContent:'¥1.18'}:null,querySelectorAll:selector=>sourceDocument.querySelectorAll(selector)}),window={};window.top=window;
 vm.runInNewContext(bundle.outputFiles[0].text,{window,document,location:{href:sourceUrl},URL,Date,Error,TextEncoder,chrome:{runtime:{sendMessage:async message=>{messages.push(structuredClone(message));return message.type==='YOOFAM_READ_PAGE_DESCRIPTION'?{ok:false}:{ok:true,delivered:true};}}},fetch:()=>assert.fail('No supplier URLs requested')});
 await elements.find(node=>node.tag==='button').click({isTrusted:true});
 const saved=messages.filter(row=>row.type==='YOOFAM_SAVE_PAGE_SOURCE');assert.equal(saved.length,1,elements.find(node=>node.tag==='button').textContent);
 assert.equal(saved[0].snapshot.options.length,324);assert.equal(saved[0].snapshot.sourceEvidence.commonPackaging.packaging.weightG,400);assert.ok(saved[0].snapshot.options.every(row=>!row.packaging));
});

test('typed source evidence rejects unknown paths, extra facts, duplicate declarations, invalid quantities and oversized tiers',()=>{
 const snapshot=capture(changed(value=>{commonContext(value,12,178);tradeFacts(value);}));
 const h=mobileIntakeHarness();try{const validate=h.load('app/source-inbox.ts').reviewPageSource;
  for(const mutate of [
   value=>value.sourceEvidence.extra=true,
   value=>value.sourceEvidence.orderMinimums[0].path='recommendations.minimumOrder',
   value=>value.sourceEvidence.orderMinimums.push(value.sourceEvidence.orderMinimums[0]),
   value=>value.sourceEvidence.orderMinimums[0].value=0,
   value=>value.sourceEvidence.priceTierStarts[0].values=Array(201).fill(1),
   value=>value.sourceEvidence.priceTierStarts[0].values=[1.5],
   value=>value.sourceEvidence.commonPackaging.scope='sku',
   value=>value.sourceEvidence.commonPackaging.packaging.verified=true,
  ]){const bad=structuredClone(snapshot);mutate(bad);assert.throws(()=>validate(bad,{title:snapshot.title,options:[{key:snapshot.options[0].key}]}));}
 }finally{h.close();}
});
