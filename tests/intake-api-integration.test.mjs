import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';
import {webcrypto} from 'node:crypto';
import {memoryDatabase,runtimeDDL} from '../scripts/check-db-schema.mjs';

// Real route handlers and persistence; only auth, Alibaba and R2 are fixtures.
// This is not evidence of a live Alibaba or Supplier Hub transaction.
for(const automatic of [false,true,'many'])test(`URL intake persists a category-scoped editable quotation (automatic=${automatic})`,async()=>{
 const sqlite=memoryDatabase();for(const statement of runtimeDDL())sqlite.exec(statement.sql);
 const db={prepare(sql){let args=[];const q={bind(...v){args=v;return q;},execute(){return sqlite.prepare(sql).all(...args);},async all(){return {results:q.execute()};},async first(){return q.execute()[0]??null;},async run(){return sqlite.prepare(sql).run(...args);}};return q;},async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(s=>({results:s.execute()}));sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const objects=new Map(),network=[],calls=[],cache=new Map();
 const sourceUrl='https://detail.1688.com/offer/813724060928.html';
 const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
 const payload={result:{success:true,result:{offerId:'813724060928',subject:'原文商品',minOrderQuantity:2,productImage:{images:['https://cbu01.alicdn.com/main.jpg']},description:'<p>원문 설명</p><img src="https://cbu01.alicdn.com/detail.jpg">',productSkuInfos:[{skuId:'5627721589407',price:'25.6',amountOnSale:'12',skuAttributes:[{attributeName:'颜色',value:'黑色',skuImageUrl:'https://cbu01.alicdn.com/black.jpg'}]}]}}};
 if(automatic===true)payload.result.result.productAttribute=[{attributeName:'形状',value:'方形'}];
 if(automatic==='many'){
  const original=payload.result.result.productSkuInfos[0];payload.result.result.productSkuInfos=Array.from({length:60},(_,i)=>({...structuredClone(original),skuId:String(5627721589407+i)}));
  payload.result.result.productAttribute=Array.from({length:50},(_,i)=>({attributeName:'属性'+i,value:'原文'}));
 }
 const deps={'cloudflare:workers':{env:{DB:db,FILES:{head:async key=>objects.has(key)?{size:objects.get(key).length}:null,put:async(key,bytes)=>{objects.set(key,new Uint8Array(bytes));return {};}},OPENAI_API_KEY:'fixture-key',SOURCEFLOW_TEXT_MODEL:'fixture-model',SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS:'2000',ALIBABA_PRODUCT_API_ENABLED:'true',ALIBABA_APP_KEY:'12345',ALIBABA_APP_SECRET:'fixture-secret',ALIBABA_ACCESS_TOKEN:'fixture-token'}},'@/app/chatgpt-auth':{getChatGPTUser:async()=>({verifiedAccess:true}),getWorkspaceOwnerId:async()=>'owner'},'next/server':{NextResponse:Response},parse5};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,URLSearchParams,Date,Response,Request,TextEncoder,TextDecoder,Uint8Array,DataView,AbortController,AbortSignal,setTimeout,clearTimeout,structuredClone,crypto:webcrypto,process:{env:{NODE_ENV:'production'}},fetch:async (target,init)=>{const host=new URL(target).hostname;network.push(host);if(host==='gw.open.1688.com')return Response.json(payload);if(host==='api.openai.com'){
 const request=JSON.parse(init.body);assert.equal(request.model,'fixture-model');assert.equal(request.store,false);
 const source=JSON.parse(request.input[0].content[0].text);assert.equal(source.category.id,'80719');assert.equal(source.title,'原文商品');
 const draft={title:'한국어 수납 상품',description:'검토한 한국어 설명',keywords:['추천 검색어'],warnings:[],attributes:source.attributes.map((pair,sourceIndex)=>({sourceIndex,name:pair.name.startsWith('option-color:')?'색상':'옵션명',value:pair.name.startsWith('option-color:')?'검정':'검정 옵션'}))};
 return Response.json({id:'fixture-response',status:'completed',model:'fixture-model',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(draft)}]}],usage:{input_tokens:100,output_tokens:50,total_tokens:150}});
 }assert.equal(host,'cbu01.alicdn.com');return new Response(png);},require(name){if(name in deps)return deps[name];assert.ok(name.startsWith('@/'),name);return load(name.slice(2)+'.ts');}});return exports;}
 try{
  const now=new Date().toISOString();
  const settings=load('app/observed-price-preset.ts').applyObservedPricePreset({...load('app/workspace-settings.ts').defaultSettings,brand:'저장 브랜드'});
  const context={category:{id:'cat',name:'바스켓',categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓'],mappings:[],template:null},settings,features:'',keywords:'수납,바스켓',capturedAt:now};
  sqlite.prepare('INSERT INTO collection_jobs VALUES (?,?,?,?,?,?,?,?)').run('job','owner','813724060928',sourceUrl,'price','awaiting_connector',now,now);
  sqlite.prepare('INSERT INTO collection_context VALUES (?,?)').run('job',JSON.stringify(context));
  const fetcher=async(path,init)=>{calls.push(path);if(path.endsWith('/translation-apply'))return load('app/api/products/[id]/translation-apply/route.ts').POST(new Request('https://app.test'+path,init),{params:Promise.resolve({id:path.split('/')[3]})});if(path.endsWith('/translation'))return load('app/api/products/[id]/translation/route.ts').POST(new Request('https://app.test'+path,init),{params:Promise.resolve({id:path.split('/')[3]})});const match=/^\/api\/collection-jobs\/job\/(collect|result|capacity|product|images)$/.exec(path);assert.ok(match,`unexpected request ${path}`);const response=await load(`app/api/collection-jobs/[id]/${match[1]}/route.ts`)[init?.method??'GET'](new Request('https://app.test'+path,init),{params:Promise.resolve({id:'job'})});if(!response.ok)assert.fail(`${path}: ${response.status} ${await response.text()}`);return response;};
  let latest;const run=async()=>load('app/intake-collection.ts').collectIntakeProduct(await load('db/collection-jobs.ts').findCollectionJob('owner','job'),{signal:new AbortController().signal,fetcher,onJob:job=>{latest=job;},onProgress:()=>{}});
  // The add-only goal must work with no model credentials and leave no AI job.
  sqlite.prepare('UPDATE collection_jobs SET goal=? WHERE id=?').run('collect','job');
  delete deps['cloudflare:workers'].env.OPENAI_API_KEY;
  assert.match(await run(),/상품 추가 완료/);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,0);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM products').get().n,1);
  assert.match(await run(),/상품 추가 완료/);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,0);
  sqlite.prepare('UPDATE collection_jobs SET goal=? WHERE id=?').run('price','job');
  deps['cloudflare:workers'].env.OPENAI_API_KEY='fixture-key';
  if(automatic){
   const bindings=deps['cloudflare:workers'].env;delete bindings.OPENAI_API_KEY;
   bindings.SOURCEFLOW_TEXT_PROVIDER='workers-ai';bindings.SOURCEFLOW_TEXT_MODEL='@cf/meta/llama-3.1-8b-instruct';
   const expectedGenerations=automatic==='many'?4:1;
   if(automatic===true){
    const field=load('app/quotation-schema.ts').getQuotationSchema('80719').fields.find(f=>f.id==='basketShape');
    const rules={format:'sourceflow-attribute-rules-v1',categoryId:'80719',rules:[{sourceName:'상품속성: 形状',fieldId:field.id,fieldSignature:JSON.stringify(field)}]};
    sqlite.prepare('INSERT INTO quotation_attribute_rules(owner_id,category_id,payload,revision,updated_at) VALUES(?,?,?,?,?)').run('owner','80719',JSON.stringify(rules),1,new Date().toISOString());
   }
   let generations=0;bindings.AI={run:async(model,input)=>{generations++;assert.equal(model,bindings.SOURCEFLOW_TEXT_MODEL);const source=JSON.parse(input.messages[1].content);assert.equal(source.category.id,'80719');return {response:{title:generations===1?'자동 생성 수납 상품':'후속 요청 상품명',description:'검토용 설명',keywords:['수납'],warnings:[],attributes:source.attributes.map((pair,sourceIndex)=>({sourceIndex,name:pair.name.startsWith('상품속성:')?(automatic===true?'상품 모양':'바구니 형태'):'옵션',value:pair.name.startsWith('상품속성:')?'사각형':pair.name.startsWith('option-color:')?'검정':'검정 옵션'}))}};}};
   assert.match(await run(),/SEO·옵션 초안을 생성해 반영/);assert.equal(generations,expectedGenerations);
   const content=JSON.parse(sqlite.prepare('SELECT payload FROM product_content').get().payload);
   if(automatic==='many'){assert.equal(content.categoryAttributes.categoryId,'80719');assert.equal(content.categoryAttributes.values.length,50);}
   assert.equal(content.seo.title.value,'자동 생성 수납 상품');assert.equal(content.label.productName.value,'자동 생성 수납 상품');
   const rows=JSON.parse(sqlite.prepare('SELECT payload FROM product_options').get().payload).rows;
   assert.equal(rows[0].translatedName,'검정 옵션');assert.equal(rows[0].color,'검정');assert.equal(rows[0].unitCostCny,25.6);
   const qr=load('app/api/products/[id]/quotation-fields/route.ts'),qc={params:Promise.resolve({id:latest.product_id})},qu='https://app.test/api/products/'+latest.product_id+'/quotation-fields';
   const view=await (await qr.GET(new Request(qu),qc)).json();const row=view.resolved.rows.find(r=>r.optionId==='collected-1');assert.equal(row.fields.title.value,'자동 생성 수납 상품');assert.equal(row.fields.supplyPrice.value,'17920');if(automatic===true){assert.equal(row.fields.basketShape.value,'사각형');assert.equal(row.fields.basketShape.source,'content');}
   const edit=await qr.PUT(new Request(qu,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:'salePrice',optionId:'collected-1',value:'35000'}]})}),qc);assert.equal(edit.status,200);
   assert.match(await run(),/저장된 SEO·옵션값/);assert.equal(generations,expectedGenerations);assert.equal(sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,expectedGenerations);
   assert.ok(rows.every(r=>r.translatedName==='검정 옵션'&&r.color==='검정'));
   const after=await (await qr.GET(new Request(qu),qc)).json();assert.equal(after.resolved.rows.find(r=>r.optionId==='collected-1').fields.salePrice.value,'35000');
   assert.equal(sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');return;
  }
  assert.match(await run(),/SEO 요청을 준비/);assert.ok(latest.product_id);const seo=sqlite.prepare('SELECT * FROM translation_jobs').get();assert.equal(seo.status,'prepared');const review=JSON.parse(seo.review);assert.equal(review.source.category.id,'80719');assert.equal(review.source.title,'原文商品');assert.equal(review.source.guidance.keywords,'수납,바스켓');assert.ok(review.source.attributes.some(pair=>pair.name==='option:collected-1'));assert.equal(seo.result,null);
  await run();assert.equal(sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,1);
  const prepareRoute=load('app/api/products/[id]/translation/route.ts');
  const injected=await prepareRoute.POST(new Request(`https://app.test/api/products/${latest.product_id}/translation`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'prepare-collected',source:{title:'다른 원문'}})}),{params:Promise.resolve({id:latest.product_id})});assert.equal(injected.status,400);assert.equal(sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,1);
  const quoteRoute=load('app/api/products/[id]/quotation-fields/route.ts');
  const quoteUrl=`https://app.test/api/products/${latest.product_id}/quotation-fields`,quoteContext={params:Promise.resolve({id:latest.product_id})};
  const quote=await quoteRoute.GET(new Request(quoteUrl),quoteContext);
  const view=await quote.json();assert.equal(quote.status,200,JSON.stringify(view));assert.equal(view.categoryContext.categoryId,'80719');
  const optionRow=view=>view.resolved.rows.find(row=>row.optionId==='collected-1');
  const row=optionRow(view);assert.equal(row.fields.supplyPrice.value,'17920');assert.equal(row.fields.salePrice.value,'29870');assert.equal(row.fields.msrp.value,'38830');
  assert.equal(objects.size,3);assert.equal(view.submissionReady,false);
  const content=JSON.parse(sqlite.prepare('SELECT payload FROM product_content').get().payload);
  assert.equal(content.seo.title.value,'原文商品');assert.deepEqual(content.seo.keywords.value,['수납','바스켓']);
  const options=JSON.parse(sqlite.prepare('SELECT payload FROM product_options').get().payload);assert.equal(options.rows[0].supplierSku,'5627721589407');assert.equal(options.rows[0].stock,12);assert.ok(options.rows[0].imageKey);
  assert.equal(row.fields.mainImage.value,options.rows[0].imageKey);assert.ok(row.fields.additionalImages.value);assert.ok(row.fields.detailImages.value);
  const edit={expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:'salePrice',optionId:options.rows[0].id,value:'35000'}]};
  const save=await quoteRoute.PUT(new Request(quoteUrl,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(edit)}),quoteContext);
  const saved=await save.json();assert.equal(save.status,200,JSON.stringify(saved));assert.equal(optionRow(saved).fields.salePrice.value,'35000');
  sqlite.prepare('UPDATE products SET title=? WHERE id=?').run('검토 후 수정한 상품명',latest.product_id);
  const previousRequests=network.length;assert.match(await run(),/초안 저장/);assert.equal(network.length,previousRequests);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM products').get().n,1);const product=sqlite.prepare('SELECT * FROM products').get();assert.equal(product.title,'검토 후 수정한 상품명');assert.equal(product.supplier_hub_status,'미전송');
  const resumed=await (await quoteRoute.GET(new Request(quoteUrl),quoteContext)).json();assert.equal(optionRow(resumed).fields.salePrice.value,'35000');assert.equal(resumed.categoryContext.categoryId,'80719');
  const stale=await quoteRoute.PUT(new Request(quoteUrl,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(edit)}),quoteContext);assert.equal(stale.status,409);
  // Editing the quotation advances the product version and requires a fresh review.
  assert.equal(sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,2);await run();assert.equal(sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,2);
  const before=network.length;delete deps['cloudflare:workers'].env.OPENAI_API_KEY;
  assert.match(await run(),/SEO 요청 준비는 완료되지/);assert.equal(network.length,before);assert.equal(sqlite.prepare('SELECT count(*) n FROM products').get().n,1);
  assert.equal(calls.filter(path=>path.endsWith('/collect')).length,1);assert.equal(network.filter(host=>host==='gw.open.1688.com').length,1);
  // Exercise approval, execution claim, provider validation and persistence
  // through real handlers. Only the external model response is a fixture.
  deps['cloudflare:workers'].env.OPENAI_API_KEY='fixture-key';
  const current=sqlite.prepare('SELECT * FROM products').get();
  const prepared=sqlite.prepare('SELECT * FROM translation_jobs WHERE product_version=?').get(current.updated_at);
  const reviewed=JSON.parse(prepared.review);
  const translation=body=>prepareRoute.POST(new Request('https://app.test/api/products/'+latest.product_id+'/translation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),quoteContext);
  const rejected=await translation({action:'execute',jobId:prepared.id});assert.equal(rejected.status,409);assert.equal(network.length,before);
  const approved=await translation({action:'approve',jobId:prepared.id,reviewFingerprint:reviewed.fingerprint,confirmPaid:true});assert.equal(approved.status,200,await approved.clone().text());
  const executed=await translation({action:'execute',jobId:prepared.id}),execution=await executed.json();assert.equal(executed.status,200,JSON.stringify(execution));
  assert.equal(execution.job.status,'completed');assert.equal(execution.job.result.responseId,'fixture-response');assert.equal(execution.job.result.usage.totalTokens,150);
  assert.equal(network.length,before+1);assert.equal(sqlite.prepare('SELECT status FROM translation_jobs WHERE id=?').get(prepared.id).status,'completed');
  const repeated=await translation({action:'execute',jobId:prepared.id});assert.equal(repeated.status,200);assert.equal((await repeated.json()).replayed,true);assert.equal(network.length,before+1);
  const applyRoute=load('app/api/products/[id]/translation-apply/route.ts');
  const apply=body=>applyRoute.POST(new Request('https://app.test/api/products/'+latest.product_id+'/translation-apply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId:prepared.id,expectedVersion:current.updated_at,...body})}),quoteContext);
  const previewResponse=await apply({action:'preview'}),preview=await previewResponse.json();assert.equal(previewResponse.status,200,JSON.stringify(preview));
  assert.ok(preview.preview.some(item=>item.name==='품명 · SEO 상품명 연동'&&item.after==='한국어 수납 상품'));
  const applied=await apply({action:'apply',fingerprint:preview.fingerprint});assert.equal(applied.status,200,await applied.clone().text());
  const afterContent=JSON.parse(sqlite.prepare('SELECT payload FROM product_content').get().payload),afterOptions=JSON.parse(sqlite.prepare('SELECT payload FROM product_options').get().payload);
  assert.equal(afterContent.seo.title.value,'한국어 수납 상품');assert.equal(afterContent.label.productName.value,'한국어 수납 상품');assert.equal(afterContent.labelProductNameLinked,true);
  assert.deepEqual(afterContent.seo.keywords.value,['수납','바스켓']);assert.equal(afterOptions.rows[0].translatedName,'검정 옵션');assert.equal(afterOptions.rows[0].color,'검정');
  const afterQuote=await (await quoteRoute.GET(new Request(quoteUrl),quoteContext)).json();assert.equal(optionRow(afterQuote).fields.title.value,'한국어 수납 상품');assert.equal(optionRow(afterQuote).fields.salePrice.value,'35000');assert.equal(optionRow(afterQuote).fields.mainImage.value,options.rows[0].imageKey);
  assert.equal((await apply({action:'apply',fingerprint:preview.fingerprint})).status,409);assert.equal(network.length,before+1);
 }finally{sqlite.close();}
});
