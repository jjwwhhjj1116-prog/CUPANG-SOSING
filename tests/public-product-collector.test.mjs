import * as parse5 from 'parse5';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,deps={},mode='development') {const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,structuredClone,Error,URL,Response,TextDecoder,TextEncoder,AbortController,setTimeout,clearTimeout,process:{env:{NODE_ENV:mode}},require:name=>deps[name]??(name==='parse5'?parse5:name==='next/server'?{NextResponse:Response}:load(name.slice(2)+'.ts',deps,mode))});return exports;}
const url='https://detail.1688.com/offer/813724060928.html';
const product=()=>({'@type':'ProductGroup',url,name:'原文商品',image:['https://cbu01.alicdn.com/a.jpg'],hasVariant:[{'@type':'Product',name:'黑色',sku:'real-sku',color:'黑色',image:'https://cbu01.alicdn.com/b.jpg',offers:{'@type':'Offer',price:'25.6',priceCurrency:'CNY',eligibleQuantity:{minValue:2}}}]});
const html=p=>`<html><script type="application/ld+json">${JSON.stringify(p)}</script></html>`;
const {parsePublicProduct,collectPublicProduct}=load('app/public-product-collector.ts');
test('explicit public data produces original SKU, image relation and price without inventing stock',()=>{
 const r=parsePublicProduct(html(product()),url);assert.equal(r.options[0].sku,'real-sku');assert.equal(r.options[0].unitPriceCny,25.6);assert.equal(r.options[0].minimumOrder,2);assert.equal(r.options[0].stock,null);assert.equal(r.options[0].imageIndex,1);assert.equal(r.images[0].role,'main');assert.equal(r.title,'原文商品');
 assert.equal(parsePublicProduct(html({'@graph':[product()]}),url).offerId,'813724060928');
});
test('public product page can identify the exact offer by JSON-LD id or main entity',()=>{
 const byId=product();delete byId.url;byId['@id']=url+'?from=structured-data';
 assert.equal(parsePublicProduct(html(byId),url).options[0].sku,'real-sku');
 const byPage=product();delete byPage.url;byPage.mainEntityOfPage={'@type':'WebPage','@id':url};
 assert.equal(parsePublicProduct(html({'@graph':[byPage]}),url).title,'原文商品');
 byPage.mainEntityOfPage=url;
 assert.equal(parsePublicProduct(html(byPage),url).offerId,'813724060928');
 byPage.mainEntityOfPage={'@id':'#product-page'};
 assert.equal(parsePublicProduct(html({'@graph':[byPage,{'@type':'WebPage','@id':'#product-page',url}]}),url).title,'原文商品');
 assert.throws(()=>parsePublicProduct(html(byPage),url),/이 URL의 상품/);
 byPage.mainEntityOfPage='https://detail.1688.com/offer/999.html';
 assert.throws(()=>parsePublicProduct(html(byPage),url),/이 URL의 상품/);
 assert.throws(()=>parsePublicProduct(html([byId,{...byId,'@id':url}]),url),/이 URL의 상품/);
});
test('local JSON-LD graph references preserve exact SKU prices, images, stock and source attributes',()=>{
 const p=product(),variant=p.hasVariant[0],offer=variant.offers;
 p.hasVariant=[{'@id':'#sku'}];p.image={'@id':'#image'};p.additionalProperty={'@id':'#material'};
 const graph=[p,{'@id':'#sku',...variant,offers:{'@id':'#offer'}},{'@id':'#offer',...offer,eligibleQuantity:{'@id':'#quantity'},inventoryLevel:{'@id':'#stock'}},
  {'@id':'#quantity','@type':'QuantitativeValue',minValue:2},{'@id':'#stock','@type':'QuantitativeValue',value:0},
  {'@id':'#image','@type':'ImageObject',contentUrl:'https://cbu01.alicdn.com/a.jpg'},
  {'@id':'#material','@type':'PropertyValue',name:'材质',value:'尼龙'}];
 const result=parsePublicProduct(html({'@graph':graph}),url);
 assert.equal(result.options[0].sku,'real-sku');assert.equal(result.options[0].unitPriceCny,25.6);
 assert.equal(result.options[0].stock,0);assert.equal(result.options[0].minimumOrder,2);
 assert.equal(result.options[0].imageIndex,1);assert.equal(result.attributes[0].value,'尼龙');
 // No guessed source for missing/ambiguous local references, even when URLs look fetchable.
 for(const broken of [graph.filter(node=>node['@id']!=='#offer'),[...graph,{'@id':'#offer',...offer}], [{...p,hasVariant:[{'@id':'https://example.com/sku'}]},...graph.slice(1)]]){
  assert.throws(()=>parsePublicProduct(html({'@graph':broken}),url),/참조/);
 }
});

test('login, unrelated and ambiguous products or incomplete option data never become drafts',()=>{
 for(const input of ['<html>Login</html>',html({...product(),url:'https://detail.1688.com/offer/999.html'}),html([product(),product()])])assert.throws(()=>parsePublicProduct(input,url));
 for(const mutate of [p=>delete p.hasVariant[0].sku,p=>delete p.hasVariant[0].offers.eligibleQuantity,p=>p.hasVariant[0].offers.priceCurrency='USD',p=>p.hasVariant[0].offers['@type']='AggregateOffer',p=>p.hasVariant[0].offers.price='25-30',p=>p.image='https://127.0.0.1/a']){const p=product();mutate(p);assert.throws(()=>parsePublicProduct(html(p),url));}
});

test('public detail HTML preserves text and ordered detail images without shifting SKU image indices',()=>{
 const p=product();p.description='<div>尺寸 &amp; 材质</div><img src="//cbu01.alicdn.com/a.jpg"><p>38 cm</p><img data-src="https://cbu01.alicdn.com/detail.jpg" src="placeholder"><img src="https://cbu01.alicdn.com/detail.jpg"><script>unsafe()</script><template><img src="https://evil.test/ignore"></template>';
 const encoded=`<script type="application/ld+json">${JSON.stringify(p).replace(/</g,'\\u003c')}</script>`;
 const receipt=parsePublicProduct(encoded,url);
 assert.equal(receipt.description,'尺寸 & 材质\n\n38 cm');
 assert.equal(receipt.options[0].imageIndex,1);
 assert.deepEqual(JSON.parse(JSON.stringify(receipt.images)),[
  {url:'https://cbu01.alicdn.com/a.jpg',role:'main'},
  {url:'https://cbu01.alicdn.com/b.jpg',role:'additional'},
  {url:'https://cbu01.alicdn.com/a.jpg',role:'detail'},
  {url:'https://cbu01.alicdn.com/detail.jpg',role:'detail'},
 ]);
 const settings=load('app/workspace-settings.ts').defaultSettings;
 const job={id:'job',offer_id:receipt.offerId,goal:'seo-price',context:{category:{id:'cat',categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓']},settings,keywords:''}};
 const prepared=load('app/collection-product.ts').prepareCollectionProduct('owner',job,receipt,'p',new Date().toISOString());
 let content=prepared.content,keys=[];
 const {attachCollectedImage}=load('app/collection-image.ts');
 receipt.images.forEach((image,index)=>{const next=attachCollectedImage(content,keys,`owner/source-${index}.jpg`,image.role,new Date().toISOString());content=next.content;keys=next.keys;});
 assert.equal(content.seo.description.value,receipt.description);
 assert.deepEqual(Array.from(content.assets.detail.value),['owner/source-2.jpg','owner/source-3.jpg']);
 const resolved=load('app/quotation-schema.ts').resolveQuotationFields({categoryId:'80719',product:{...prepared.product,image_keys:JSON.stringify(keys)},content,options:prepared.options,settings});
 assert.equal(resolved.rows[0].fields.detailImages.value,'owner/source-2.jpg\nowner/source-3.jpg');
});

test('description image collection rejects unsupported sources and a combined gallery/detail overflow',()=>{
 for(const description of ['<img src="http://cbu01.alicdn.com/a.jpg">','<img src="https://evil.test/a.jpg">','<img>',123])assert.throws(()=>parsePublicProduct(html({...product(),description}),url));
 const description=Array.from({length:199},(_,i)=>`<img src="https://cbu01.alicdn.com/detail-${i}.jpg">`).join('');
 assert.throws(()=>parsePublicProduct(html({...product(),description}),url));
 assert.equal(parsePublicProduct(html({...product(),description:'原文 38 cm'}),url).description,'原文 38 cm');
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
 const job={id:'job',offer_id:'813724060928',source_url:url,status:'awaiting_connector',goal:'collect'};
 const options={signal:new AbortController().signal,fetcher:async()=>Response.json({jobs:[job],preservedRequests:[]}),onRow:(_id,state)=>states.push(state),onJobs(){},collect:async(j,onProgress)=>{assert.equal(j.id,'job');collected++;onProgress('fetching');throw Error('missing options');}};
 await submitIntakeQueue([row],'price',options);assert.equal(collected,1);assert.equal(states.at(-1).status,'error');assert.match(states.at(-1).message,/missing options/);assert.equal(row.url,url);
 await submitIntakeQueue([row],'price',{...options,fetcher:async()=>Response.json({jobs:[job],preservedRequests:[{differences:['카테고리']} ]})});assert.equal(collected,1);
 await submitIntakeQueue([row],'price',{...options,collect:async()=> '초안 저장됨'});assert.equal(states.at(-1).status,'saved');
});
test('user URL collection forwards the confirmed receipt to draft import and reports product only after import',async()=>{
 const source=parsePublicProduct(html(product()),url),updates=[],messages=[];let imported=0;
 const {collectIntakeProduct}=load('app/intake-collection.ts',{'@/app/collection-batch':{importReceivedJobs:async(jobs,options)=>{imported++;assert.equal(jobs[0].received_at,'2026-09-26T00:00:00Z');options.onResult('job',{status:'completed',productId:'product',completedImages:2});}}});
 const job={id:'job',offer_id:'813724060928',source_url:url,status:'awaiting_connector',goal:'collect'};
 const options={signal:new AbortController().signal,fetcher:async(path,init)=>{assert.equal(path,'/api/collection-jobs/job/collect');assert.equal(init.method,'POST');return Response.json({jobId:'job',offerId:job.offer_id,receipt:{result:source,receivedAt:'2026-09-26T00:00:00Z'}});},onJob:j=>updates.push(j),onProgress:m=>messages.push(m)};
 const message=await collectIntakeProduct(job,options);assert.equal(imported,1);assert.equal(updates[0].product_id,undefined);assert.equal(updates[1].product_id,'product');assert.match(message,/상품 추가 완료/);
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
 const job={id:'job',offer_id:'813724060928',source_url:url,status:'awaiting_connector',goal:'collect',product_id:'existing-product',received_at:'2026-09-26T00:00:00Z'};
 const options={signal:new AbortController().signal,fetcher:async()=>{throw Error('must not recollect');},onJob:j=>updates.push(j),onProgress:m=>progress.push(m)};
 await assert.rejects(collectIntakeProduct(job,options),/image failed/);assert.equal(attempts,1);
 assert.match(await collectIntakeProduct(job,options),/상품 추가 완료/);assert.equal(attempts,2);
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

test('incomplete SEO keeps the intake row retryable and the confirmed product editable',async()=>{
 const {collectIntakeProduct}=load('app/intake-collection.ts',{'@/app/collection-batch':{importReceivedJobs:async(jobs,options)=>options.onResult('job',{status:'completed',productId:'saved-product',completedImages:1})}});
 const {submitIntakeQueue,intakeQueueRequests}=load('app/intake-queue.ts');
 const profile={id:'00000000-0000-0000-0000-000000000001',revision:1,categoryId:'80719',categoryPath:['주방용품']};
 let rows=[{id:'row',profile,url,features:'',keywords:'',status:'draft',message:''}];
 const job={id:'job',offer_id:'813724060928',source_url:url,status:'awaiting_connector',received_at:new Date().toISOString()};
 let imports=0;
 const signal=new AbortController().signal;
 const collect=async(job,progress,linked)=>{
  imports++;
  return collectIntakeProduct(job,{signal,onJob:value=>{if(value.product_id)linked(value.product_id);},onProgress:progress,fetcher:async(_url,init)=>{
   if(imports===1)return Response.json({error:'SEO 일시 실패'},{status:503});
   const body=JSON.parse(init.body),version='2026-09-27T10:00:00Z';
   return Response.json(body.action==='prepare-collected'?{job:{productId:'saved-product',status:'completed'},intakePreserved:true,productVersion:version}:{done:true,productId:'saved-product',productVersion:version});
  }});
 };
 const settings={signal,collect,onJobs(){},onRow:(id,patch)=>{rows=rows.map(row=>row.id===id?{...row,...patch}:row);},fetcher:async()=>Response.json({jobs:[job],preservedRequests:[]})};
 await submitIntakeQueue(rows,'price',settings);
 assert.equal(rows[0].status,'error');assert.equal(rows[0].productId,'saved-product');assert.match(rows[0].message,/SEO 일시 실패/);
 assert.equal(intakeQueueRequests(rows,'price').length,1);
 await submitIntakeQueue(rows,'price',settings);assert.equal(imports,2);assert.equal(rows[0].status,'saved');
 assert.equal(rows[0].productId,'saved-product');assert.equal(intakeQueueRequests(rows,'price').length,0);
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

test('HTML parser accepts an unquoted JSON-LD type and ignores commented or text-only scripts',()=>{
 const data=JSON.stringify(product());
 assert.equal(parsePublicProduct(`<script type=application/ld+json>${data}</script>`,url).options[0].sku,'real-sku');
 for(const wrapper of [text=>`<!-- ${text} -->`,text=>`<textarea>${text}</textarea>`,text=>`<template>${text}</template>`]){
  assert.throws(()=>parsePublicProduct(wrapper(html(product())),url));
  assert.equal(parsePublicProduct(wrapper(html(product()))+html(product()),url).offerId,'813724060928');
 }
});

test('published per-offer inventory preserves zero and remains distinct across SKUs',()=>{
 const p=product();p.hasVariant.push({...structuredClone(p.hasVariant[0]),sku:'second-sku'});
 p.hasVariant[0].offers.inventoryLevel={'@type':'QuantitativeValue',value:0};
 p.hasVariant[1].offers.inventoryLevel={'@type':'https://schema.org/QuantitativeValue',value:'123'};
 const result=parsePublicProduct(html(p),url);
 assert.equal(result.options[0].stock,0);assert.equal(result.options[1].stock,123);
});
test('inventory never guesses counts from availability, ranges or measurement units',()=>{
 for(const inventory of [undefined,{'@type':'QuantitativeValue',minValue:1,maxValue:10},{'@type':'QuantitativeValue',value:3,unitCode:'KGM'},{'@type':'QuantitativeValue',value:3,unitText:'kg'},{'@type':'QuantitativeValue',value:3,minValue:1},123]){
 const p=product();p.hasVariant[0].offers.availability='https://schema.org/InStock';p.hasVariant[0].offers.inventoryLevel=inventory;
 assert.equal(parsePublicProduct(html(p),url).options[0].stock,null);
 }
 for(const value of [-1,1.5,'unknown',Number.MAX_SAFE_INTEGER+1]){
 const p=product();p.hasVariant[0].offers.inventoryLevel={'@type':'QuantitativeValue',value};
 assert.throws(()=>parsePublicProduct(html(p),url),/재고 수량/);
 }
});

test('plain local price specifications preserve explicit CNY cost and minimum order',()=>{
 const p=product(),offer=p.hasVariant[0].offers;
 delete offer.price;delete offer.priceCurrency;delete offer.eligibleQuantity;
 offer.priceSpecification={'@id':'#price'};
 const specification={'@id':'#price','@type':'PriceSpecification',price:'25.6',priceCurrency:'CNY',eligibleQuantity:{minValue:2}};
 const result=parsePublicProduct(html({'@graph':[p,specification]}),url);
 assert.equal(result.options[0].unitPriceCny,25.6);assert.equal(result.options[0].minimumOrder,2);assert.equal(result.options[0].sku,'real-sku');
 for(const patch of [{priceCurrency:'USD'},{minPrice:20},{priceType:'ListPrice'},{validForMemberTier:'member'},{'@type':'UnitPriceSpecification'},{price:'25-30'},{eligibleQuantity:{minValue:2,unitCode:'KGM'}}]){
  assert.throws(()=>parsePublicProduct(html({'@graph':[p,{...specification,...patch}]}),url));
 }
 offer.priceCurrency='USD';assert.throws(()=>parsePublicProduct(html({'@graph':[p,specification]}),url),/통화/);
 offer.priceCurrency='CNY';offer.eligibleQuantity={minValue:10};assert.throws(()=>parsePublicProduct(html({'@graph':[p,specification]}),url),/최소 주문/);
 delete offer.eligibleQuantity;offer.priceSpecification=[specification,specification];assert.throws(()=>parsePublicProduct(html(p),url),/단일/);
});

test('direct offer price stays authoritative and a measured MOQ is not treated as piece count',()=>{
 const p=product(),offer=p.hasVariant[0].offers;
 offer.priceSpecification={'@type':'PriceSpecification',price:'999',priceCurrency:'CNY'};
 assert.equal(parsePublicProduct(html(p),url).options[0].unitPriceCny,25.6);
 offer.eligibleQuantity={minValue:2,unitText:'kg'};
 assert.throws(()=>parsePublicProduct(html(p),url),/단위/);
});


test('direct common material and model reach editable labels and quotation fields',()=>{
 const p={...product(),material:'尼龙',model:'MODEL-123'};
 const result=parsePublicProduct(html(p),url);
 const settings=load('app/workspace-settings.ts').defaultSettings;
 const now=new Date().toISOString();
 const job={id:'source',offer_id:result.offerId,goal:'price',context:{category:{id:'category',categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓']},settings,features:'',keywords:''}};
 const draft=load('app/collection-product.ts').prepareCollectionProduct('owner',job,result,'draft',now);
 assert.equal(draft.content.label.material.value,'尼龙');assert.equal(draft.content.label.model.value,'MODEL-123');
 assert.equal(draft.content.label.material.provenance,'collected');
 const view=load('app/quotation-schema.ts').resolveQuotationFields({categoryId:'80719',product:draft.product,content:draft.content,options:draft.options,settings});
 assert.equal(view.rows[0].fields.noticeMaterial.value,'尼龙');assert.equal(view.rows[0].fields.model.value,'MODEL-123');
 assert.equal(draft.product.supplier_hub_status,'미전송');
});

test('direct product facts preserve conflicts and never promote variant-only material or model',()=>{
 const p={...product(),material:'尼龙',model:'A',additionalProperty:[{'@type':'PropertyValue',name:'材质',value:'棉'},{'@type':'PropertyValue',name:'model',value:'A'}]};
 let result=parsePublicProduct(html(p),url);
 const adopt=load('app/collection-label-attributes.ts').collectionLabelAttributes;
 assert.equal(adopt(result.attributes).material,undefined);assert.equal(adopt(result.attributes).model,'A');
 assert.equal(result.attributes.filter(a=>a.name==='model').length,1);
 delete p.material;delete p.model;delete p.additionalProperty;
 p.hasVariant[0].material='SKU material';p.hasVariant[0].model='SKU model';
 result=parsePublicProduct(html(p),url);assert.equal(adopt(result.attributes).material,undefined);assert.equal(adopt(result.attributes).model,undefined);
});
