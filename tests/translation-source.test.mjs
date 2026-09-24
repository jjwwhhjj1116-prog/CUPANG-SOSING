import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync(new URL('../app/api/products/[id]/translation-source/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function route({mode='development',verified=false,product=true,link=true,receipt=true,offer='123',attributes=undefined,context=null,jobOffer='123',jobExists=true}={}){
 const calls=[];const exports={};
 const deps={
  'next/server':{NextResponse:Response},
  '@/app/chatgpt-auth':{getChatGPTUser:async()=>({verifiedAccess:verified}),getWorkspaceOwnerId:async()=>'owner'},
  '@/db/queries':{findProduct:async(...args)=>{calls.push(['product',...args]);return product?{source_url:'https://detail.1688.com/offer/123.html',updated_at:'version'}:null;}},
  '@/db/collection-products':{findProductCollection:async(...args)=>{calls.push(['link',...args]);return link?{job_id:'exact-job'}:null;}},
  '@/db/collection-results':{readCollectionResult:async(...args)=>{calls.push(['receipt',...args]);return receipt?{result:{attributes,offerId:offer,title:'中文商品',description:'原文说明',provider:'test',sourceUrl:'https://detail.1688.com/offer/123.html',collectedAt:'2026-09-23'}}:null;}},
  '@/db/collection-jobs':{findCollectionJob:async(...args)=>{calls.push(['job',...args]);return jobExists?{offer_id:jobOffer,context}:null;}},
  '@/app/sourcing':{parseCollectionRequest:()=>[{offerId:'123'}]},
 };
 vm.runInNewContext(code,{exports,process:{env:{NODE_ENV:mode}},require:name=>{if(!(name in deps))throw Error(name);return deps[name];}});
 return {calls,get:()=>exports.GET(new Request('http://localhost'),{params:Promise.resolve({id:'product'})})};
}
test('translation source reads the exact owner/product receipt and returns unchanged text without writes or provider calls',async()=>{
 const r=route();const response=await r.get();const body=await response.json();
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(body.title,'中文商品');assert.equal(body.description,'原文说明');assert.equal(body.jobId,'exact-job');assert.equal(body.productVersion,'version');assert.equal(body.scope,'title-description-attributes');
 assert.deepEqual(r.calls,[['product','owner','product'],['link','owner','product'],['receipt','owner','exact-job'],['job','owner','exact-job']]);
});
test('missing links never fall back to same URL receipts and mismatched offer IDs are rejected',async()=>{
 for(const [config,status] of [[{product:false},404],[{link:false},404],[{receipt:false},409],[{offer:'456'},409]])assert.equal((await route(config).get()).status,status);
 const missing=route({link:false});await missing.get();assert.equal(missing.calls.some(c=>c[0]==='receipt'),false);
});
test('production authentication precedes all product and receipt reads',async()=>{
 const blocked=route({mode:'production'});assert.equal((await blocked.get()).status,503);assert.equal(blocked.calls.length,0);
 assert.equal((await route({mode:'production',verified:true}).get()).status,200);
});

test('translation source includes structured seller attributes without flattening or writes',async()=>{
 const attributes=[{name:'材质',value:'尼龙\n说明'},{name:'规格',value:'38×31×14 cm'}];
 const response=await route({attributes}).get();assert.equal(response.status,200);
 assert.deepEqual((await response.json()).attributes,attributes);
 assert.deepEqual((await (await route().get()).json()).attributes,[]);
});

test('collected attributes preserve line breaks and cannot bind to editable option fields',()=>{
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/collected-translation-attributes.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
 const values=[{name:'option-color:collected-1',value:'红色\n=原文'},{name:'材质',value:'尼龙'}];
 const mapped=exports.collectedTranslationAttributes(values);
 assert.equal(mapped[0].name,'상품속성: option-color:collected-1');assert.equal(mapped[0].value,values[0].value);
 assert.equal(values[0].name,'option-color:collected-1');
 assert.ok(mapped.every(pair=>!/^option(?:-(color|size))?:/.test(pair.name)));
 assert.throws(()=>exports.collectedTranslationAttributes([{name:'a'.repeat(191),value:'x'}]));
 assert.throws(()=>exports.collectedTranslationAttributes(Array.from({length:51},()=>values[0])));
});

test('request notes come only from the linked job and never replace seller text or expose workspace settings',async()=>{
 const context={category:{categoryId:'80719',categoryPath:['주방용품','바스켓'],template:{private:'template'}},settings:{brand:'private setting'},features:'가벼운 소재\n요청 메모',keywords:'수납, 바구니',capturedAt:'2026-09-24T00:00:00Z'};
 const r=route({context});const body=await (await r.get()).json();
 assert.deepEqual(body.requestContext,{categoryId:'80719',categoryPath:['주방용품','바스켓'],features:context.features,keywords:context.keywords,capturedAt:context.capturedAt});
 assert.equal(body.title,'中文商品');assert.equal(body.description,'原文说明');assert.deepEqual(body.attributes,[]);assert.equal(body.requestContext.settings,undefined);assert.equal(body.requestContext.template,undefined);
 assert.equal((await (await route().get()).json()).requestContext,null);
 for(const config of [{jobExists:false},{jobOffer:'999'}])assert.equal((await route(config).get()).status,409);
});
