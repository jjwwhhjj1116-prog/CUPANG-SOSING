import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {extractPageSource} from '../extensions/supplier-hub/page-source.mjs';
import {pageCollectorDom} from './helpers/page-collector-dom.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

// Explicit synthetic candidate shape, not a retained response/DOM from a live
// offer. In particular the shipping row join/unit schema is not established.
const offerId='700000000001',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const img=name=>`https://cbu01.alicdn.com/synthetic-structured-${name}.jpg`;
const attributes=[{attributeName:'材质',value:'硅胶'},{attributeName:'型号',value:'SYNTHETIC-MODEL'}];
function primary(){return {offerId,subject:'合成结构化原文',offerImgList:[img('main'),img('gallery')],
 skuModel:{offerId,beginAmount:1,skuInfoMap:{red:{skuId:'synthetic-red',specAttrs:'红色',price:'5.30',imageUrl:img('option')}}},
 productAttribute:attributes,description:`<p>原文 &amp; 说明</p><img src="${img('body-first')}?a=1&amp;b=2"><img src="${img('main')}"><img data-src="${img('body-last')}" src="data:placeholder">`,
 productShippingInfo:{skuShippingInfoList:[{skuId:'synthetic-red',weightKg:0.12,lengthCm:12,widthCm:8,heightCm:2}]}};}
function capture(value=primary(),extra={}){return extractPageSource({sourceUrl,priceText:'¥5.30',scripts:[typeof value==='string'?value:JSON.stringify(value)],...extra});}
const expectedAttributes=attributes.map(({attributeName:name,value})=>({name,value}));
const expectedDetails=[img('body-first')+'?a=1&b=2',img('main'),img('body-last')];

test('exact current primary structured data preserves attributes, BODY order and distinct gallery/SKU roles',()=>{
 const value=primary(),before=JSON.stringify(value),result=capture(value);
 assert.deepEqual(result.attributes,expectedAttributes);
 assert.equal(result.description,'原文 & 说明');
 assert.deepEqual(result.images.filter(row=>row.role==='detail').map(row=>row.url),expectedDetails);
 assert.deepEqual(result.sourceGallery.imageIndices,[0,1]);
 assert.deepEqual(result.options.map(row=>[row.supplierSku,row.imageUrl,row.packaging]),[['synthetic-red',img('option'),undefined]]);
 assert.equal(result.images.find(row=>row.url===img('option')).role,'additional');
 assert.equal(JSON.stringify(value),before);
});

test('nested, foreign, executable and double-encoded containers cannot authorize embedded facts',()=>{
 const current=primary(),base={offerId,subject:current.subject,skuModel:current.skuModel,offerImgList:current.offerImgList};
 const carriers=[{...base,shop:{...current}},{...base,recommendations:[current]},
  {...base,nested:{productAttribute:attributes,description:current.description}},
 ];
 for(const carrier of carriers){const result=capture(carrier);assert.deepEqual(result.attributes,[]);assert.deepEqual(result.images.filter(row=>row.role==='detail'),[]);}
 assert.throws(()=>capture({...base,shop:{...current,offerId:'700000000002'}}),/상품 번호/);
 for(const text of [JSON.stringify(JSON.stringify(current)),`const text=${JSON.stringify(JSON.stringify(current))};`,
  `/* ${JSON.stringify(current)} */`, `function unexecuted(){window.__INIT_DATA=${JSON.stringify(current)};}`]){
  const result=capture(text,{title:'合成',gallery:[img('main')]});assert.deepEqual(result.attributes,[]);assert.deepEqual(result.images.filter(row=>row.role==='detail'),[]);
 }
});

test('bound structured fields reject malformed, duplicate, private and contradictory supplier metadata',()=>{
 const current=primary(),raw=JSON.stringify(current);
 const invalid=[
  {...current,productId:'700000000002'},
  {...current,isPicPrivate:true}, {...current,isPricePrivate:'false'},
  {...current,skuModel:{...current.skuModel,isDetailForbidden:true}},
  {...current,productAttribute:null}, {...current,productAttribute:{}},
  {...current,productAttribute:[{attributeName:'材质',value:3}]},
  {...current,productAttribute:[{attributeName:'x'.repeat(191),value:'ok'}]},
  {...current,productAttribute:[{attributeName:'材质',value:'x'.repeat(1001)}]},
  {...current,productAttribute:[{attributeName:'材质',value:'硅胶'},{attributeName:'材质',value:'wrong'}]},
  {...current,description:{prodImage:[img('body-first')]}},
  {...current,description:'<img src="https://alicdn.com.evil.test/foreign.jpg">'},
  {...current,description:'<img src="https://cbu01.alicdn.com/a.jpg#hash">'},
  {...current,description:`<img src="https://cbu01.alicdn.com/${'x'.repeat(2048)}.jpg">`},
  raw.replace('"offerId":',`"offerId":"700000000002","offerId":`),
  raw.replace('"productAttribute":','"productAttribute":[],"productAttribute":'),
  raw.replace('"attributeName":"材质"',String.raw`"attributeName":"wrong","attribute\u004eame":"材质"`),
  raw.replace('"value":"硅胶"','"value":"wrong","value":"硅胶"'),
  raw.replace('"description":','"description":"wrong","description":'),
  raw.replace('"skuModel":','"skuModel":{},"skuModel":'),
 ];
 for(const value of invalid)assert.throws(()=>capture(value),undefined,JSON.stringify(value).slice(0,180));
 assert.throws(()=>capture(current,{scripts:[raw,raw]}));
});

test('literal initialization and numeric/product identity remain exact, with no shipping-to-measurement inference',()=>{
 for(const raw of [primary(),{...primary(),offerId:Number(offerId)},{...primary(),offerId:undefined,productId:offerId}]){
  for(const text of [JSON.stringify(raw),'window.__INIT_DATA = '+JSON.stringify(raw)+';']){
   const result=capture(text,{detailImages:[img('dom-only')],description:'partial DOM text'});
   assert.deepEqual(result.attributes,expectedAttributes);
   assert.equal(result.description,'原文 & 说明');
   assert.deepEqual(result.images.filter(row=>row.role==='detail').map(row=>row.url),[...expectedDetails,img('dom-only')]);
   assert.ok(result.options.every(row=>row.packaging===undefined));
  }
 }
 const missing=primary();delete missing.skuModel.offerId;assert.throws(()=>capture(missing));
 const mismatch=primary();mismatch.skuModel.productId='700000000002';assert.throws(()=>capture(mismatch));
});

test('structured attrs merge with existing propsList only when duplicate names agree, never truncate',()=>{
 const value=primary();value.propsList=[...expectedAttributes,{name:'原产地',value:'中国'}];
 assert.deepEqual(capture(value).attributes,[...expectedAttributes,{name:'原产地',value:'中国'}]);
 value.propsList=[{name:'材质',value:'wrong'}];assert.throws(()=>capture(value));
 const many=primary();many.productAttribute=Array.from({length:51},(_,i)=>({attributeName:'attr'+i,value:'v'}));assert.throws(()=>capture(many));
 const images=primary();images.description=Array.from({length:201},(_,i)=>`<img src="${img('limit-'+i)}">`).join('');assert.throws(()=>capture(images));
});

test('structured attribute rows preserve all 50 exact source pairs and collapse identical repeated facts',()=>{
 const value=primary();value.productAttribute=Array.from({length:50},(_,i)=>({attributeName:'attr'+i,value:'v'+i}));
 assert.deepEqual(capture(value).attributes,value.productAttribute.map(({attributeName:name,value})=>({name,value})));
 value.productAttribute=Array.from({length:50},()=>({attributeName:'Material',value:'silicone'}));
 assert.deepEqual(capture(value).attributes,[{name:'Material',value:'silicone'}]);
});

test('the shared API HTML parser remains inert and decodes description text only once',()=>{
 const value=primary();value.description=`<script><img src="${img('script')}"></script><template><img src="${img('template')}"></template><p>safe &lt;img&gt;</p><img src="${img('kept')}">`;
 const result=capture(value);assert.equal(result.description,'safe <img>');
 assert.deepEqual(result.images.filter(row=>row.role==='detail'),[{url:img('kept'),role:'detail'}]);
});

test('the actual trusted collector entry delivers embedded structured facts without source requests',async()=>{
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../deployment/extension-page-collector.mjs',import.meta.url))],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120'});
 const messages=[],{document,elements}=pageCollectorDom({scripts:[{textContent:JSON.stringify(primary())}],querySelector:selector=>selector==='.price-container'?{textContent:'¥5.30 1件起批'}:null}),window={};window.top=window;
 vm.runInNewContext(bundle.outputFiles[0].text,{document,window,location:{href:sourceUrl},URL,Date,Error,TextEncoder,chrome:{runtime:{sendMessage:async message=>{messages.push(structuredClone(message));return {ok:true,delivered:true};}}},fetch:()=>assert.fail('No external request is authorized')});
 await elements.find(row=>row.tag==='button').click({isTrusted:true});
 assert.equal(messages.length,1);assert.equal(messages[0].type,'YOOFAM_SAVE_PAGE_SOURCE');
 const snapshot=messages[0].snapshot;
 assert.deepEqual(snapshot.attributes,expectedAttributes);
 assert.deepEqual(snapshot.images.filter(row=>row.role==='detail').map(row=>row.url),expectedDetails);
 for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}]){
  const h=mobileIntakeHarness(company);try{
   const receipt=h.load('app/source-inbox.ts').pageSourceCollectionResult(snapshot);
   const draft=h.load('app/collection-product.ts').prepareCollectionProduct('owner',{offer_id:offerId,source_url:sourceUrl,context:h.context},receipt,'synthetic-structured-product',new Date().toISOString());
   assert.equal(draft.content.label.material.value,'硅胶');
   assert.equal(draft.content.label.model.value,'SYNTHETIC-MODEL');
   assert.equal(draft.options.rows[0].supplierSku,'synthetic-red');
   assert.equal(h.network.length,0);
  }finally{h.close();}
 }
});
