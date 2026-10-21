import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {extractPageSource} from '../extensions/supplier-hub/page-source.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

// Synthetic current-page documents only. No source network request is made.
const offerId='700000000001',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const gallery=['https://cbu01.alicdn.com/synthetic-attributes.jpg'];
const skuModel={offerId,beginAmount:1,skuInfoMap:{black:{specAttrs:'黑色',skuId:'synthetic-black',price:'5.30'}}};
const pairs=[{name:'材质',value:'硅胶'},{name:'型号',value:'MODEL-SYNTHETIC'}];
function page(data=[],extra={}){
 return extractPageSource({sourceUrl,title:'合成测试商品',gallery,priceText:'¥5.30',scripts:[JSON.stringify({skuModel}),...data.map(value=>typeof value==='string'?value:JSON.stringify(value))],...extra});
}

test('current-offer propsList survives capture as exact supplier attributes',()=>{
 const source=page([{offerId,propsList:pairs}]);
 assert.deepEqual(source.attributes,pairs);
 assert.equal(source.options[0].supplierSku,'synthetic-black');
 assert.deepEqual(page([{productId:offerId,propsList:pairs}]).attributes,pairs);
 assert.deepEqual(page([{offerId:Number(offerId),propsList:pairs}]).attributes,pairs);
 assert.deepEqual(page([{skuModel,propsList:pairs}]).attributes,pairs);
});

test('attributes are bound to their immediate literal container, never an outer page identity',()=>{
 const unrelated={offerId:'700000000002',propsList:[{name:'材质',value:'Wrong recommendation material'}]};
 const source=page([{offerId,shop:{propsList:[{name:'店铺',value:'Wrong shop fact'}]},recommendations:[unrelated],current:{offerId,propsList:pairs}}]);
 assert.deepEqual(source.attributes,pairs);
 assert.deepEqual(page([{propsList:pairs},unrelated]).attributes,[]);
 assert.deepEqual(page([{offerId,nested:{propsList:pairs}}]).attributes,[]);
 assert.deepEqual(page([{offerId:[offerId],propsList:pairs}]).attributes,[]);
});

test('separate current product components merge unique facts and collapse identical repeated facts',()=>{
 const source=page([{offerId,propsList:[pairs[0]]},{offerId,propsList:[...pairs,{name:'Material',value:'silicone'}]},{productId:offerId,propsList:[{name:'material',value:'silicone'}]}]);
 assert.deepEqual(source.attributes,[...pairs,{name:'Material',value:'silicone'}]);
 assert.deepEqual(page([{offerId,propsList:[]},{offerId,propsList:pairs}]).attributes,pairs);
});

test('conflicting current-product attributes and identities fail instead of silently choosing a value',()=>{
 for(const data of [
  [{offerId,propsList:pairs},{offerId,propsList:[{name:'材质',value:'Wrong second material'}]}],
  [{offerId,productId:'700000000002',propsList:pairs}],
  [{offerId,productId:[offerId],propsList:pairs}],
  [{offerId,skuModel:{...skuModel,offerId:'700000000002'},propsList:pairs}],
  [`{"offerId":"${offerId}","propsList":[{"name":"材质","value":"first"}],"propsList":[{"name":"材质","value":"second"}]}`],
 ])assert.throws(()=>page(data),/속성 원문|상품 번호|옵션 원문이 여러 개/);
});

test('malformed current product lists, pairs and oversized facts never produce a partial capture',()=>{
 for(const propsList of [null,{},'not a list',1,[null],[{name:'材质',value:42}],[{name:' ',value:'silicone'}],[{name:'material',value:'\u0000hidden'}],[{name:'x'.repeat(191),value:'silicone'}],[{name:'material',value:'x'.repeat(1001)}],Array.from({length:51},(_,index)=>({name:`field${index}`,value:'value'}))])assert.throws(()=>page([{offerId,propsList}]),/속성 원문/);
 const groups=[{offerId,propsList:Array.from({length:30},(_,index)=>({name:`first${index}`,value:'value'}))},{offerId,propsList:Array.from({length:21},(_,index)=>({name:`second${index}`,value:'value'}))}];
 assert.throws(()=>page(groups),/속성 원문/);
});

test('unrelated malformed attributes and executable expressions cannot contribute supplier facts',()=>{
 assert.deepEqual(page([{offerId:'700000000002',propsList:null},{propsList:'unbound'},`window.untrusted={"offerId":"${offerId}","propsList":(()=>{throw Error('must never run')})()};`]).attributes,[]);
 const literal=JSON.stringify({offerId,propsList:pairs});
 for(const text of [`const expression = / ${literal} /;`,`const expression = / ; ${literal} /;`])assert.deepEqual(page([text]).attributes,[]);
});

test('binding identity and pair fields reject duplicate semantic JSON keys, including escaped spellings',()=>{
 const props=JSON.stringify(pairs);
 for(const text of [
  `{"offerId":"700000000002","offerId":"${offerId}","propsList":${props}}`,
  `{"offerId":"${offerId}","offerId":"700000000002","propsList":${props}}`,
  String.raw`{"offerId":"700000000002","offer\u0049d":"700000000001","propsList":${props}}`,
  `{"skuModel":{"offerId":"700000000002","offerId":"${offerId}"},"propsList":${props}}`,
  `{"offerId":"${offerId}","propsList":[{"name":"材质","name":"型号","value":"silicone"}]}`,
  `{"offerId":"${offerId}","propsList":[{"name":"材质","value":"wrong","value":"silicone"}]}`,
  String.raw`{"offerId":"700000000001","propsList":[{"name":"材质","na\u006de":"型号","value":"silicone"}]}`,
  String.raw`{"offerId":"700000000001","propsList":[{"name":"材质","value":"wrong","val\u0075e":"silicone"}]}`,
  String.raw`{"offerId":"700000000001","propsList":[],"props\u004cist":[{"name":"材质","value":"silicone"}]}`,
 ])assert.throws(()=>page([text]),/속성 원문|옵션 원문|상품 번호/);
});

test('unrelated nested duplicate properties do not invalidate verified current-product facts',()=>{
 const text=`{"offerId":"${offerId}","shop":{"propsList":[{"name":"wrong","name":"shop","value":"one","value":"two"}]},"recommendations":[{"offerId":"700000000002","offerId":"700000000003","propsList":[{"name":"wrong","value":"one","value":"two"}]}],"current":{"offerId":"${offerId}","propsList":${JSON.stringify(pairs)}}}`;
 assert.deepEqual(page([text]).attributes,pairs);
});

const recordedEnvelope=JSON.parse(fs.readFileSync(new URL('./fixtures/1688-mobile-813724060928.json',import.meta.url),'utf8'));
function mobileEnvelope(){
 const value=structuredClone(recordedEnvelope);
 value.globalData.offerBaseInfo.offerId=Number(offerId);value.globalData.tempModel.offerId=offerId;value.globalData.detailModel.offerId=offerId;
 return value;
}
test('recorded product-attribute component uses both exact global offer IDs, with no arbitrary ancestor authorization',()=>{
 const envelope=mobileEnvelope(),expected=envelope.data['590893002003'].data.propsList.map(({name,value})=>({name,value}));
 assert.equal(expected.length,24);
 assert.deepEqual(page(['window.__INIT_DATA = '+JSON.stringify(envelope)+';']).attributes,expected);
 for(const prefix of ['/* note */ ','// note\n','const unrelated = "safe"; /* note */ '])assert.deepEqual(page([prefix+'window.__INIT_DATA = '+JSON.stringify(envelope)+';']).attributes,expected);
 envelope.data['590893002003'].data.propsList=pairs;
 envelope.data.unrelated={data:{propsList:[{name:'Wrong outer-envelope fact',value:'never import'}]}};
 assert.deepEqual(page(['window.__INIT_DATA = '+JSON.stringify(envelope)+';']).attributes,pairs);
 for(const part of ['offerBaseInfo','tempModel']){
  const wrong=structuredClone(envelope);wrong.globalData[part].offerId='700000000002';
  assert.throws(()=>page(['window.__INIT_DATA = '+JSON.stringify(wrong)+';']),/속성 원문|상품 번호/);
 }
 // A matching ancestor in arbitrary JSON is not the recorded assignment contract.
 assert.deepEqual(page([{globalData:envelope.globalData,data:envelope.data}]).attributes,[]);
 for(const text of [`function unexecuted(){window.__INIT_DATA = ${JSON.stringify(envelope)};}`,`/* window.__INIT_DATA = ${JSON.stringify(envelope)}; */`,`const text = ${JSON.stringify('window.__INIT_DATA = '+JSON.stringify(envelope)+';')};`,`other = window.__INIT_DATA = ${JSON.stringify(envelope)};`,`const expression = / window.__INIT_DATA = ${JSON.stringify(envelope)}; /;`,`const expression = / ; window.__INIT_DATA = ${JSON.stringify(envelope)}; /;`])assert.deepEqual(page([text]).attributes,[]);
});

test('known envelope rejects ambiguous binding paths, duplicate supplier facts and private flags',()=>{
 const envelope=mobileEnvelope();envelope.data['590893002003'].data.propsList=pairs;
 const raw=JSON.stringify(envelope),base=JSON.stringify(envelope.globalData.offerBaseInfo);
 for(const value of [
  raw.replace(base,`{"offerId":"700000000002","offerId":"${offerId}"}`),
  raw.replace('"name":"材质"',String.raw`"name":"wrong","na\u006de":"材质"`),
  raw.replace('"value":"硅胶"',String.raw`"value":"wrong","val\u0075e":"硅胶"`),
  raw.replace('"isPricePrivate":false','"isPricePrivate":true,"isPricePrivate":false'),
  raw.replace('"globalData":','"globalData":{},"globalData":'),
  raw.replace('"590893002003":','"590893002003":{},"590893002003":'),
 ])assert.throws(()=>page(['window.__INIT_DATA = '+value+';']),/속성 원문|상품 번호/);
});

test('bounded whitespace is trimmed without translating, guessing or truncating supplier facts',()=>{
 const source=page([{offerId,propsList:[{name:' 材质 ',value:' 硅胶 '},{name:'x'.repeat(190),value:'v'.repeat(1000)}]}]);
 assert.deepEqual(source.attributes,[pairs[0],{name:'x'.repeat(190),value:'v'.repeat(1000)}]);
});

const bundle=await build({entryPoints:[fileURLToPath(new URL('../deployment/extension-page-collector.mjs',import.meta.url))],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120'});
test('trusted page button retains separate attribute scripts and the known envelope without fetching the source',async()=>{
 const envelope=mobileEnvelope(),cases=[
  {script:JSON.stringify({offerId,propsList:pairs}),expected:pairs},
  {script:'window.__INIT_DATA = '+JSON.stringify(envelope)+';',expected:envelope.data['590893002003'].data.propsList.map(({name,value})=>({name,value}))},
 ];
 for(const entry of cases){
 const elements=[],messages=[];
 const create=tag=>{const node={tag,style:{},textContent:'',setAttribute(){},append(){},attachShadow(){return{append(){}};},addEventListener(type,listener){if(type==='click')node.click=listener;}};elements.push(node);return node;};
 const document={getElementById:()=>null,createElement:create,documentElement:{append(){}},title:'合成测试商品',scripts:[{textContent:JSON.stringify({skuModel,offerImgList:gallery})},{textContent:entry.script}],querySelector(selector){return selector==='.price-container'?{textContent:'¥5.30 1件起批'}:null;},querySelectorAll:()=>[]};
 const window={};window.top=window;
 vm.runInNewContext(bundle.outputFiles[0].text,{window,document,location:{href:sourceUrl},URL,Date,Error,TextEncoder,chrome:{runtime:{sendMessage:async message=>{messages.push(message);return{ok:true,delivered:true};}}},fetch:()=>assert.fail('A click capture cannot request the product endpoint')});
 await elements.find(node=>node.tag==='button').click({isTrusted:true});
 assert.equal(messages.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(messages[0].snapshot.attributes)),entry.expected);
 }
});

test('captured attributes reach the owned collection receipt and new stage-six label draft unchanged',()=>{
 const h=mobileIntakeHarness();try{
  const source=page([{offerId,propsList:pairs}]);
  const receipt=h.load('app/source-inbox.ts').pageSourceCollectionResult(source);
  assert.deepEqual(JSON.parse(JSON.stringify(receipt.attributes)),pairs);
  const job={id:'synthetic-attribute-job',owner_id:'owner',offer_id:offerId,source_url:sourceUrl,goal:'work',status:'awaiting_connector',context:h.context};
  const draft=h.load('app/collection-product.ts').prepareCollectionProduct('owner',job,receipt,'synthetic-attribute-product',new Date().toISOString());
  assert.equal(draft.content.label.material.value,'硅胶');
  assert.equal(draft.content.label.material.provenance,'collected');
  assert.equal(draft.content.label.model.value,'MODEL-SYNTHETIC');
  assert.equal(draft.product.supplier_hub_status,'미전송');
  assert.equal(h.network.length,0);
 }finally{h.close();}
});
