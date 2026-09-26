import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,deps={},mode='development') {const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,Response,TextDecoder,TextEncoder,AbortController,setTimeout,clearTimeout,process:{env:{NODE_ENV:mode}},require:name=>deps[name]??(name==='next/server'?{NextResponse:Response}:load(name.slice(2)+'.ts',deps,mode))});return exports;}
const url='https://detail.1688.com/offer/813724060928.html';
const product=()=>({'@type':'ProductGroup',url,name:'原文商品',image:['https://cbu01.alicdn.com/a.jpg'],hasVariant:[{'@type':'Product',name:'黑色',sku:'real-sku',color:'黑色',image:'https://cbu01.alicdn.com/b.jpg',offers:{'@type':'Offer',price:'25.6',priceCurrency:'CNY',eligibleQuantity:{minValue:2}}}]});
const html=p=>`<html><script type="application/ld+json">${JSON.stringify(p)}</script></html>`;
const {parsePublicProduct,collectPublicProduct}=load('app/public-product-collector.ts');
test('explicit public data produces original SKU, image relation and price without inventing stock',()=>{
 const r=parsePublicProduct(html(product()),url);assert.equal(r.options[0].sku,'real-sku');assert.equal(r.options[0].unitPriceCny,25.6);assert.equal(r.options[0].minimumOrder,2);assert.equal(r.options[0].stock,null);assert.equal(r.options[0].imageIndex,1);assert.equal(r.images[0].role,'main');assert.equal(r.title,'原文商品');
 assert.equal(parsePublicProduct(html({'@graph':[product()]}),url).offerId,'813724060928');
});
test('login, unrelated and ambiguous products or incomplete option data never become drafts',()=>{
 for(const input of ['<html>Login</html>',html({...product(),url:'https://detail.1688.com/offer/999.html'}),html([product(),product()])])assert.throws(()=>parsePublicProduct(input,url));
 for(const mutate of [p=>delete p.hasVariant[0].sku,p=>delete p.hasVariant[0].offers.eligibleQuantity,p=>p.hasVariant[0].offers.priceCurrency='USD',p=>p.hasVariant[0].offers['@type']='AggregateOffer',p=>p.hasVariant[0].offers.price='25-30',p=>p.image='https://127.0.0.1/a']){const p=product();mutate(p);assert.throws(()=>parsePublicProduct(html(p),url));}
});
test('network fetch is canonical, credentialless, bounded and does not follow login redirects',async()=>{
 let calls=0;const r=await collectPublicProduct(url+'?tracking=1',{fetcher:async(target,init)=>{calls++;assert.equal(target,url);assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');assert.equal(init.headers.cookie,undefined);return new Response(html(product()),{headers:{'content-type':'text/html'}});}});assert.equal(calls,1);assert.equal(r.offerId,'813724060928');
 for(const response of [new Response('',{status:302,headers:{location:'https://login.1688.com'}}),new Response('{}',{headers:{'content-type':'application/json'}}),new Response('x'.repeat(2*1024*1024+1),{headers:{'content-type':'text/html'}})])await assert.rejects(collectPublicProduct(url,{fetcher:async()=>response}));
 await assert.rejects(collectPublicProduct('https://localhost/offer/1.html',{fetcher:async()=>{throw Error('must not fetch');}}));
});
function route(overrides={},mode='development') {let calls=0,writes=0;const deps={'@/app/chatgpt-auth':{getChatGPTUser:async()=>null,getWorkspaceOwnerId:async()=>'owner'},'@/db/collection-jobs':{findCollectionJob:async(owner)=>{assert.equal(owner,'owner');return {offer_id:'813724060928',source_url:url,status:'awaiting_connector'};}},'@/db/collection-results':{readCollectionResult:async()=>null,storeCollectionResult:async(owner,id,result)=>{writes++;assert.equal(owner,'owner');return {status:'stored',result,receivedAt:new Date().toISOString()};}},'@/app/public-product-collector':{collectPublicProduct:async()=>{calls++;return parsePublicProduct(html(product()),url);}},...overrides};return {...load('app/api/collection-jobs/[id]/collect/route.ts',deps,mode),calls:()=>calls,writes:()=>writes};}
const request=()=>new Request('http://localhost/collect',{method:'POST'}),context={params:Promise.resolve({id:'job'})};
test('collection route uses owner-scoped job and returns a persisted receipt',async()=>{const api=route();const r=await api.POST(request(),context);assert.equal(r.status,200);const body=await r.json();assert.equal(body.jobId,'job');assert.equal(body.receipt.result.options[0].sku,'real-sku');assert.equal(api.calls(),1);assert.equal(api.writes(),1);});
test('access, cancelled and missing jobs never fetch; failed collection never writes',async()=>{
 for(const [api,status] of [[route({},'production'),503],[route({'@/db/collection-jobs':{findCollectionJob:async()=>null}}),404],[route({'@/db/collection-jobs':{findCollectionJob:async()=>({status:'cancelled'})}}),409]]){assert.equal((await api.POST(request(),context)).status,status);assert.equal(api.calls(),0);assert.equal(api.writes(),0);}
 const failed=route({'@/app/public-product-collector':{collectPublicProduct:async()=>{throw Error('source missing');}}});assert.equal((await failed.POST(request(),context)).status,422);assert.equal(failed.writes(),0);
});
test('retry reuses existing original without replacing it or re-fetching a changed page',async()=>{const receipt={result:parsePublicProduct(html(product()),url),receivedAt:new Date().toISOString()};const api=route({'@/db/collection-results':{readCollectionResult:async()=>receipt}});const r=await api.POST(request(),context);assert.equal(r.status,200);assert.equal((await r.json()).receipt.result.title,'原文商品');assert.equal(api.calls(),0);assert.equal(api.writes(),0);});

test('collection is called only after matching intake persistence and failed rows remain retryable',async()=>{
 const {submitIntakeQueue,intakeRow}=load('app/intake-queue.ts');
 const profile={id:'00000000-0000-0000-0000-000000000001',revision:1,categoryId:'80719'};
 const row={...intakeRow(profile,'row'),url};const states=[];let collected=0;
 const job={id:'job',offer_id:'813724060928',source_url:url,status:'awaiting_connector'};
 const options={signal:new AbortController().signal,fetcher:async()=>Response.json({jobs:[job],preservedRequests:[]}),onRow:(_id,state)=>states.push(state),onJobs(){},collect:async(j,onProgress)=>{assert.equal(j.id,'job');collected++;onProgress('fetching');throw Error('missing options');}};
 await submitIntakeQueue([row],'price',options);assert.equal(collected,1);assert.equal(states.at(-1).status,'error');assert.match(states.at(-1).message,/missing options/);assert.equal(row.url,url);
 await submitIntakeQueue([row],'price',{...options,fetcher:async()=>Response.json({jobs:[job],preservedRequests:[{differences:['카테고리']} ]})});assert.equal(collected,1);
 await submitIntakeQueue([row],'price',{...options,collect:async()=> '초안 저장됨'});assert.equal(states.at(-1).status,'saved');
});
test('user URL collection forwards the confirmed receipt to draft import and reports product only after import',async()=>{
 const source=parsePublicProduct(html(product()),url),updates=[],messages=[];let imported=0;
 const {collectIntakeProduct}=load('app/intake-collection.ts',{'@/app/collection-batch':{importReceivedJobs:async(jobs,options)=>{imported++;assert.equal(jobs[0].received_at,'2026-09-26T00:00:00Z');options.onResult('job',{status:'completed',productId:'product',completedImages:2});}}});
 const job={id:'job',offer_id:'813724060928',source_url:url,status:'awaiting_connector'};
 const options={signal:new AbortController().signal,fetcher:async(path,init)=>{assert.equal(path,'/api/collection-jobs/job/collect');assert.equal(init.method,'POST');return Response.json({jobId:'job',offerId:job.offer_id,receipt:{result:source,receivedAt:'2026-09-26T00:00:00Z'}});},onJob:j=>updates.push(j),onProgress:m=>messages.push(m)};
 const message=await collectIntakeProduct(job,options);assert.equal(imported,1);assert.equal(updates[0].product_id,undefined);assert.equal(updates[1].product_id,'product');assert.match(message,/초안/);
 await assert.rejects(collectIntakeProduct(job,{...options,fetcher:async()=>Response.json({error:'login required'},{status:422})}),/login required/);assert.equal(imported,1);
 await assert.rejects(collectIntakeProduct(job,{...options,fetcher:async()=>Response.json({jobId:'other',offerId:job.offer_id,receipt:{result:source}})}));assert.equal(imported,1);
});

test('declared page charset is decoded and oversized parsed receipts are rejected',async()=>{
 const p=product();p.name='caf\u00e9';p.hasVariant[0].name='Black';p.hasVariant[0].color='Black';
 const result=await collectPublicProduct(url,{fetcher:async()=>new Response(Buffer.from(html(p),'latin1'),{headers:{'content-type':'text/html; charset=windows-1252'}})});assert.equal(result.title,'caf\u00e9');
 p.image=[];p.hasVariant=Array.from({length:200},(_,i)=>({...p.hasVariant[0],sku:String(i)+'s'.repeat(150),name:'n'.repeat(500),color:'c'.repeat(190),size:'s'.repeat(190),image:`https://cbu01.alicdn.com/${i}/${'a'.repeat(1850)}.jpg`}));
 assert.throws(()=>parsePublicProduct(html(p),url),/크기/);
});
