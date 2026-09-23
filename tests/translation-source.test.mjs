import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync(new URL('../app/api/products/[id]/translation-source/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function route({mode='development',verified=false,product=true,link=true,receipt=true,offer='123'}={}){
 const calls=[];const exports={};
 const deps={
  'next/server':{NextResponse:Response},
  '@/app/chatgpt-auth':{getChatGPTUser:async()=>({verifiedAccess:verified}),getWorkspaceOwnerId:async()=>'owner'},
  '@/db/queries':{findProduct:async(...args)=>{calls.push(['product',...args]);return product?{source_url:'https://detail.1688.com/offer/123.html',updated_at:'version'}:null;}},
  '@/db/collection-products':{findProductCollection:async(...args)=>{calls.push(['link',...args]);return link?{job_id:'exact-job'}:null;}},
  '@/db/collection-results':{readCollectionResult:async(...args)=>{calls.push(['receipt',...args]);return receipt?{result:{offerId:offer,title:'中文商品',description:'原文说明',provider:'test',sourceUrl:'https://detail.1688.com/offer/123.html',collectedAt:'2026-09-23'}}:null;}},
  '@/app/sourcing':{parseCollectionRequest:()=>[{offerId:'123'}]},
 };
 vm.runInNewContext(code,{exports,process:{env:{NODE_ENV:mode}},require:name=>{if(!(name in deps))throw Error(name);return deps[name];}});
 return {calls,get:()=>exports.GET(new Request('http://localhost'),{params:Promise.resolve({id:'product'})})};
}
test('translation source reads the exact owner/product receipt and returns unchanged text without writes or provider calls',async()=>{
 const r=route();const response=await r.get();const body=await response.json();
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(body.title,'中文商品');assert.equal(body.description,'原文说明');assert.equal(body.jobId,'exact-job');assert.equal(body.productVersion,'version');assert.equal(body.scope,'title-description');
 assert.deepEqual(r.calls,[['product','owner','product'],['link','owner','product'],['receipt','owner','exact-job']]);
});
test('missing links never fall back to same URL receipts and mismatched offer IDs are rejected',async()=>{
 for(const [config,status] of [[{product:false},404],[{link:false},404],[{receipt:false},409],[{offer:'456'},409]])assert.equal((await route(config).get()).status,status);
 const missing=route({link:false});await missing.get();assert.equal(missing.calls.some(c=>c[0]==='receipt'),false);
});
test('production authentication precedes all product and receipt reads',async()=>{
 const blocked=route({mode:'production'});assert.equal((await blocked.get()).status,503);assert.equal(blocked.calls.length,0);
 assert.equal((await route({mode:'production',verified:true}).get()).status,200);
});
