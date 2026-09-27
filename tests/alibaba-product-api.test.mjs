import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto,createHmac} from 'node:crypto';
function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,URLSearchParams,crypto:webcrypto,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,Uint8Array,require(name){return load(name.slice(2)+'.ts');}});return exports;}
const {queryAlibabaProduct}=load('app/alibaba-product-api.ts');
const credentials={appKey:'12345',appSecret:'test-secret',accessToken:'test-token'};
const url='https://detail.1688.com/offer/813724060928.html';
const payload={result:{success:true,result:{productSkuInfos:[],description:'x'.repeat(6000)}}};
test('official product query signs the observed request contract and retains full response',async()=>{
 let calls=0;const result=await queryAlibabaProduct(url+'?tracking=1',credentials,{fetcher:async(target,init)=>{
  calls++;const u=new URL(target);assert.equal(u.origin,'https://gw.open.1688.com');assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');
  const p=Object.fromEntries(u.searchParams),signature=p._aop_signature;delete p._aop_signature;
  assert.deepEqual(JSON.parse(p.offerDetailParam),{offerId:'813724060928',country:'en',outMemberId:'1'});
  const expected=createHmac('sha1',credentials.appSecret).update(u.pathname.replace('/openapi/','')+Object.keys(p).sort().map(k=>k+p[k]).join('')).digest('hex').toUpperCase();assert.equal(signature,expected);
  return Response.json(payload);
 }});assert.equal(calls,1);assert.equal(result.offerId,'813724060928');assert.equal(result.payload.result.result.description.length,6000);
});
test('invalid credentials, error envelopes, redirects and malformed responses never return product data',async()=>{
 await assert.rejects(queryAlibabaProduct(url,{...credentials,appKey:''},{fetcher:()=>{throw Error('must not request');}}),/인증/);
 for(const response of [Response.json({result:{success:false}}),Response.json({}),new Response('login'),new Response('',{status:302})])await assert.rejects(queryAlibabaProduct(url,credentials,{fetcher:async()=>response}));
});
test('network errors cannot leak signed URL tokens and cancelled requests remain cancelled',async()=>{
 await assert.rejects(queryAlibabaProduct(url,credentials,{fetcher:async()=>{throw Error('https://server/?access_token=test-token');}}),error=>error.code==='API_NETWORK_ERROR'&&!error.message.includes('test-token'));
 const controller=new AbortController();controller.abort();await assert.rejects(queryAlibabaProduct(url,credentials,{signal:controller.signal,fetcher:async(_,init)=>{assert.equal(init.signal.aborted,true);throw Error('aborted');}}),error=>error.code==='API_REQUEST_ABORTED');
});
