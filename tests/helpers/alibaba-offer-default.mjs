import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import * as parse5 from 'parse5';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './mobile-intake.mjs';

// Entirely synthetic offer facts. No source endpoint, Chrome tab, production
// database or Supplier Hub is contacted by these tests.
export const offerId='90000000691';
export const sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
export const originalTitle='单层运动收纳保护带';
export const plain=value=>JSON.parse(JSON.stringify(value));
export const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};

export function offerDefaultPayload({images=['https://cbu01.alicdn.com/default-main.jpg','https://cbu01.alicdn.com/default-additional.jpg','https://cbu01.alicdn.com/default-detail.jpg'],stock=0}={}){
 return {result:{success:true,result:{offerId,subject:originalTitle,subjectTrans:'Unverified provider translation',minOrderQuantity:'2',
  productSkuInfos:[],productSaleInfo:{amountOnSale:stock,priceRangeList:[{startQuantity:100,price:'4.5'},{startQuantity:1,price:'0.3'}]},
  productImage:{images:images.slice(0,2)},description:`<p>运动收纳保护带原文说明</p><img src="${images[2]}">`,
  productAttribute:[{attributeName:'material',value:'PP'},{attributeName:'model',value:'DEFAULT-691'},{attributeName:'product dimensions',value:'20 x 15 x 10 cm'}]}}};
}

export function offerDefaultRuntime(){
 const cache=new Map(),native=createRequire(import.meta.url);
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
   {exports,Error,URL,URLSearchParams,Date,TextEncoder,TextDecoder,Uint8Array,AbortController,AbortSignal,setTimeout,clearTimeout,crypto:webcrypto,structuredClone,
    require(name){if(name==='parse5')return parse5;if(name==='react/jsx-runtime')return native(name);if(name.startsWith('./')||name.startsWith('../'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');assert.ok(name.startsWith('@/'),name);return load(name.slice(2)+'.ts');}});
  return exports;
 }
 return load;
}

export function offerDefaultApiHarness(company){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,
  sourceFetcher:async()=>assert.fail('A saved synthetic receipt must never contact a source endpoint')});
 // The shared helper only serves synthetic PNGs for its allowlisted fixture
 // CDN addresses. Reuse those addresses as inert identifiers, not real media.
 const mobile=JSON.parse(fs.readFileSync(new URL('../fixtures/1688-mobile-813724060928.json',import.meta.url),'utf8'));
 const images=Object.values(mobile.data).find(value=>value?.data?.offerImgList).data.offerImgList.slice(0,3);
 const payload=offerDefaultPayload({images});
 h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=?,goal=? WHERE id=?').run(offerId,sourceUrl,'work','job');
 h.context.keywords='수납,보호대';
 h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
 h.bindings.AI.run=async(_model,input)=>{
  const source=JSON.parse(input.messages[1].content);h.aiSources.push(source);
  assert.equal(source.title,originalTitle);assert.equal(source.category.id,'80719');
  return {response:{title:'단일 수납 보호대',description:'수집 원문에 따른 단일 상품 설명',keywords:['수납','보호대'],warnings:[],
   attributes:source.attributes.map((pair,sourceIndex)=>({sourceIndex,name:pair.name.startsWith('option:')?'옵션명':pair.name.replace('상품속성: ',''),value:pair.name.startsWith('option:')?'기본 보호대':pair.value}))}};
 };
 const requests=[];let latest;
 const route=async(path,options={})=>{
  const response=await h.route(path,options);requests.push({path,method:options.method??'GET',status:response.status,
   ...(path.endsWith('/images')||path.endsWith('/images-batch')?{response:await response.clone().json()}:{})});return response;
 };
 const intake=async()=>h.load('app/intake-collection.ts').collectIntakeProduct(await h.load('db/collection-jobs.ts').findCollectionJob('owner','job'),{
  signal:new AbortController().signal,fetcher:(path,init)=>route(path,{method:init?.method??'GET',body:init?.body}),onJob:job=>{latest=job;},onProgress:()=>{},
 });
 return {...h,payload,images,requests,route,intake,get latest(){return latest;}};
}
