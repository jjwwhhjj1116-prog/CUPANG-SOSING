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
function route(overrides={},mode='development') {let calls=0,writes=0;const deps={'cloudflare:workers':{env:{}},'@/app/chatgpt-auth':{getChatGPTUser:async()=>null,getWorkspaceOwnerId:async()=>'owner'},'@/db/collection-jobs':{findCollectionJob:async(owner)=>{assert.equal(owner,'owner');return {offer_id:'813724060928',source_url:url,status:'awaiting_connector'};}},'@/db/collection-results':{readCollectionResult:async()=>null,storeCollectionResult:async(owner,id,result)=>{writes++;assert.equal(owner,'owner');return {status:'stored',result,receivedAt:new Date().toISOString()};}},'@/app/public-product-collector':{collectPublicProduct:async()=>{calls++;return parsePublicProduct(html(product()),url);}},...overrides};return {...load('app/api/collection-jobs/[id]/collect/route.ts',deps,mode),calls:()=>calls,writes:()=>writes};}
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

test('intake retries a partially imported product from its receipt without recollecting or declaring early success',async()=>{
 let attempts=0;const updates=[],progress=[];
 const {collectIntakeProduct}=load('app/intake-collection.ts',{'@/app/collection-batch':{importReceivedJobs:async(jobs,options)=>{
  assert.equal(jobs[0].product_id,'existing-product');assert.equal(jobs[0].received_at,'2026-09-26T00:00:00Z');attempts++;
  options.onResult('job',attempts===1?{status:'failed',productId:'existing-product',completedImages:1,error:'image failed'}:{status:'completed',productId:'existing-product',completedImages:2});
 }}});
 const job={id:'job',offer_id:'813724060928',source_url:url,status:'awaiting_connector',product_id:'existing-product',received_at:'2026-09-26T00:00:00Z'};
 const options={signal:new AbortController().signal,fetcher:async()=>{throw Error('must not recollect');},onJob:j=>updates.push(j),onProgress:m=>progress.push(m)};
 await assert.rejects(collectIntakeProduct(job,options),/image failed/);assert.equal(attempts,1);
 assert.match(await collectIntakeProduct(job,options),/초안 저장됨/);assert.equal(attempts,2);
 assert.ok(updates.every(j=>j.product_id==='existing-product'));assert.ok(!progress.includes('상품 페이지에서 정보 가져오는 중'));
 const controller=new AbortController();controller.abort();await collectIntakeProduct(job,{...options,signal:controller.signal});assert.equal(attempts,2);
 await assert.rejects(collectIntakeProduct({...job,status:'cancelled'},options),/취소/);assert.equal(attempts,2);
 await assert.rejects(collectIntakeProduct({...job,received_at:'bad-date'},options),/시각/);assert.equal(attempts,2);
});

test('public product attributes reach SEO source with explicit units and isolated seller names',()=>{
 const p=product();p.additionalProperty=[{'@type':'PropertyValue',name:'材质',value:'棉'}, {'@type':'https://schema.org/PropertyValue',name:'重量',value:0.375,unitText:'kg'}, {'@type':'PropertyValue',name:'含附件',value:false}, {'@type':'PropertyValue',name:'option:injected',value:'原文'}, {'@type':'PropertyValue',name:'长度',value:38,unitCode:'CMT'}];
 p.hasVariant[0].additionalProperty={'@type':'PropertyValue',name:'variant-only',value:'must not become common'};
 const before=JSON.stringify(p);const receipt=parsePublicProduct(html(p),url);
 assert.deepEqual(JSON.parse(JSON.stringify(receipt.attributes)),[{name:'材质',value:'棉'},{name:'重量',value:'0.375 kg'},{name:'含附件',value:'false'},{name:'option:injected',value:'原文'},{name:'长度',value:'38 CMT'}]);
 const {collectedSeoSource}=load('app/collected-seo-source.ts');
 const source=collectedSeoSource(receipt,{id:'j',offer_id:receipt.offerId,context:{category:{categoryId:'80719',categoryPath:['주방용품']},features:'',keywords:''}},{rows:[]}).source;
 assert.equal(source.attributes[0].name,'상품속성: 材质');assert.equal(source.attributes[1].value,'0.375 kg');
 assert.equal(source.attributes[3].name,'상품속성: option:injected');assert.equal(JSON.stringify(p),before);
});

test('unreadable or excessive public attributes are rejected rather than silently omitted',()=>{
 for(const additionalProperty of [null,{'@type':'PropertyValue',name:'size',value:{value:1}}, {'@type':'PropertyValue',name:'size',value:1,unitText:[]}, {'@type':'PropertyValue',name:'x'.repeat(191),value:'v'}, Array.from({length:51},()=>({'@type':'PropertyValue',name:'x',value:'v'}))]) {
  assert.throws(()=>parsePublicProduct(html({...product(),additionalProperty}),url));
 }
 assert.equal(parsePublicProduct(html(product()),url).attributes,undefined);
});

test('image failure preserves the saved product and still prepares SEO without reporting import success',async()=>{
 const updates=[],calls=[];
 const {collectIntakeProduct}=load('app/intake-collection.ts',{'@/app/collection-batch':{importReceivedJobs:async(jobs,options)=>options.onResult('job',{status:'failed',productId:'saved-product',completedImages:1,error:'원본 이미지 다운로드 실패',warnings:['원본 주소 보존']})}});
 const job={id:'job',offer_id:'813724060928',source_url:url,status:'awaiting_connector',received_at:'2026-09-26T00:00:00Z'};
 await assert.rejects(collectIntakeProduct(job,{signal:new AbortController().signal,onJob:j=>updates.push(j),onProgress:()=>{},fetcher:async(path,init)=>{
  calls.push(path);assert.equal(JSON.parse(init.body).action,'prepare-collected');return Response.json({job:{productId:'saved-product',status:'prepared'}});
 }}),error=>/이미지 다운로드 실패/.test(error.message)&&/SEO 요청을 준비/.test(error.message)&&/원본 주소 보존/.test(error.message));
 assert.deepEqual(calls,['/api/products/saved-product/translation']);assert.equal(updates.at(-1).product_id,'saved-product');
});

test('failed product creation and stopped import never prepare SEO',async()=>{
 for(const outcome of [{status:'failed',productId:null,error:'상품 저장 실패',completedImages:0},{status:'stopped',productId:'saved-product',completedImages:0}]){
  const {collectIntakeProduct}=load('app/intake-collection.ts',{'@/app/collection-batch':{importReceivedJobs:async(jobs,options)=>options.onResult('job',outcome)}});
  let requests=0;const run=()=>collectIntakeProduct({id:'job',offer_id:'813724060928',source_url:url,status:'awaiting_connector',received_at:'2026-09-26T00:00:00Z'},{signal:new AbortController().signal,onJob:()=>{},onProgress:()=>{},fetcher:async()=>{requests++;throw Error('unexpected SEO request');}});
  if(outcome.status==='failed')await assert.rejects(run(),/상품 저장 실패/);else assert.equal(await run(),undefined);
  assert.equal(requests,0);
 }
});


test('add-only intake stops after import without requiring or preparing SEO, including retries',async()=>{
 for(const status of ['completed','failed']){
  const updates=[],progress=[];let requests=0;
  const {collectIntakeProduct}=load('app/intake-collection.ts',{'@/app/collection-batch':{importReceivedJobs:async(jobs,options)=>options.onResult('job',{status,productId:'saved-product',completedImages:1,error:status==='failed'?'이미지 실패':undefined,warnings:['원문 보존']})}});
  const options={signal:new AbortController().signal,onJob:j=>updates.push(j),onProgress:m=>progress.push(m),fetcher:async()=>{requests++;throw Error('unexpected SEO request');}};
  for(const product_id of [undefined,'saved-product']){
   const run=()=>collectIntakeProduct({id:'job',offer_id:'813724060928',source_url:url,goal:'collect',product_id,status:'awaiting_connector',received_at:'2026-09-26T00:00:00Z'},options);
   if(status==='completed')assert.match(await run(),/상품 추가 완료.*원문 보존/);
   else await assert.rejects(run(),/이미지 실패.*원문 보존/);
  }
  assert.equal(requests,0);assert.equal(updates.at(-1).product_id,'saved-product');assert.ok(!progress.some(m=>m.includes('SEO')));
 }
});
