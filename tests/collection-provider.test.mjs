import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';
import {webcrypto} from 'node:crypto';

function load(file,deps={}) {
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,Error,URL,URLSearchParams,Date,TextEncoder,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,crypto:webcrypto,fetch:deps.fetch,process:{env:{NODE_ENV:'production'}},
 require(name){if(name in deps)return deps[name];if(name==='parse5')return parse5;if(name==='next/server')return {NextResponse:Response};return load(name.slice(2)+'.ts',deps);}});return exports;
}
const bindings={ALIBABA_PRODUCT_API_ENABLED:'true',ALIBABA_APP_KEY:'12345',ALIBABA_APP_SECRET:'test-secret',ALIBABA_ACCESS_TOKEN:'test-token'};
const url='https://detail.1688.com/offer/813724060928.html';
const payload=()=>({result:{success:true,result:{offerId:'813724060928',subject:'原文商品',minOrderQuantity:2,productImage:{images:['https://cbu01.alicdn.com/main.jpg']},description:'<p>원문</p><img src="https://cbu01.alicdn.com/detail.jpg">',productSkuInfos:[{skuId:'5627721589407',price:'25.6',amountOnSale:'12',skuAttributes:[{attributeName:'颜色',value:'黑色'}]}]}}});
const {collectionProvider}=load('app/collection-provider.ts');
test('only an explicit server switch selects API; incomplete or malformed settings fail without secrets',()=>{
 assert.equal(collectionProvider({}).kind,'public-page');assert.equal(collectionProvider({...bindings,ALIBABA_PRODUCT_API_ENABLED:'false'}).kind,'public-page');
 assert.equal(collectionProvider(bindings).kind,'alibaba-api');
 for(const patch of [{ALIBABA_PRODUCT_API_ENABLED:true},{ALIBABA_APP_KEY:''},{ALIBABA_APP_SECRET:' '},{ALIBABA_ACCESS_TOKEN:'test-token\n'}])assert.throws(()=>collectionProvider({...bindings,...patch}),e=>!e.message.includes('test-token')&&!e.message.includes('test-secret'));
});
function route({env=bindings,response=payload(),verified=true,existing=null,jobStatus='awaiting_connector',networkError=false,writeStatus='stored'}={}) {
 const state={network:0,public:0,writes:0,result:null};
 const api=load('app/api/collection-jobs/[id]/collect/route.ts',{
  'cloudflare:workers':{env},'@/app/chatgpt-auth':{getChatGPTUser:async()=>({verifiedAccess:verified}),getWorkspaceOwnerId:async()=>'owner'},
  '@/db/collection-jobs':{findCollectionJob:async owner=>{assert.equal(owner,'owner');return {offer_id:'813724060928',source_url:url,status:jobStatus};}},
  '@/db/collection-results':{readCollectionResult:async()=>existing,storeCollectionResult:async(owner,id,result)=>{assert.equal(owner,'owner');assert.equal(id,'job');state.writes++;state.result=result;return {status:writeStatus,result,receivedAt:new Date().toISOString()};}},
  '@/app/public-product-collector':{collectPublicProduct:async()=>{state.public++;throw Error('public fixture unavailable');}},
  fetch:async(target,init)=>{state.network++;assert.equal(new URL(target).hostname,'gw.open.1688.com');assert.equal(init.redirect,'manual');if(networkError)throw Error('test-token');return Response.json(response);},
 });
 return {state,call:()=>api.POST(new Request('https://app.test/api/collection-jobs/job/collect',{method:'POST'}),{params:Promise.resolve({id:'job'})})};
}
test('configured URL route uses the signed API, validates/maps source and stores the immutable receipt',async()=>{
 const api=route();const response=await api.call();assert.equal(response.status,200);const body=await response.json();
 assert.equal(body.receipt.result.title,'原文商品');assert.equal(body.receipt.result.options[0].unitPriceCny,25.6);assert.equal(body.receipt.result.options[0].color,'黑色');assert.equal(body.receipt.result.images[1].role,'detail');
 assert.equal(api.state.network,1);assert.equal(api.state.public,0);assert.equal(api.state.writes,1);assert.ok(!JSON.stringify(body).includes('test-token'));
});
test('API failures never fall back to page scraping or store a fabricated receipt',async()=>{
 for(const config of [{response:{result:{success:false}}},{networkError:true},{response:{result:{success:true,result:{...payload().result.result,offerId:'999'}}}}]) {
  const api=route(config);const response=await api.call();assert.equal(response.status,422);assert.equal(api.state.writes,0);assert.equal(api.state.public,0);assert.ok(!(await response.text()).includes('test-token'));
 }
});
test('existing receipts and cancelled/auth-blocked jobs make no outbound request; missing keys fail before networking',async()=>{
 for(const [config,status] of [[{existing:{receivedAt:'now',result:{title:'saved'}}},200],[{jobStatus:'cancelled'},409],[{verified:false},503],[{env:{ALIBABA_PRODUCT_API_ENABLED:'true'}},503]]){
  const api=route(config);assert.equal((await api.call()).status,status);assert.equal(api.state.network,0);assert.equal(api.state.writes,0);assert.equal(api.state.public,0);
 }
 const disabled=route({env:{}});assert.equal((await disabled.call()).status,422);assert.equal(disabled.state.public,1);assert.equal(disabled.state.network,0);
 const race=route({writeStatus:'conflict'});assert.equal((await race.call()).status,409);
});
