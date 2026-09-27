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
test('URL intake persists a category-scoped editable quotation and resumes without replacing edits',async()=>{
 const sqlite=memoryDatabase();for(const statement of runtimeDDL())sqlite.exec(statement.sql);
 const db={prepare(sql){let args=[];const q={bind(...v){args=v;return q;},execute(){return sqlite.prepare(sql).all(...args);},async all(){return {results:q.execute()};},async first(){return q.execute()[0]??null;},async run(){return sqlite.prepare(sql).run(...args);}};return q;},async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(s=>({results:s.execute()}));sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const objects=new Map(),network=[],calls=[],cache=new Map();
 const sourceUrl='https://detail.1688.com/offer/813724060928.html';
 const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
 const payload={result:{success:true,result:{offerId:'813724060928',subject:'原文商品',minOrderQuantity:2,productImage:{images:['https://cbu01.alicdn.com/main.jpg']},description:'<p>원문 설명</p><img src="https://cbu01.alicdn.com/detail.jpg">',productSkuInfos:[{skuId:'5627721589407',price:'25.6',amountOnSale:'12',skuAttributes:[{attributeName:'颜色',value:'黑色',skuImageUrl:'https://cbu01.alicdn.com/black.jpg'}]}]}}};
 const deps={'cloudflare:workers':{env:{DB:db,FILES:{head:async key=>objects.has(key)?{size:objects.get(key).length}:null,put:async(key,bytes)=>{objects.set(key,new Uint8Array(bytes));return {};}},OPENAI_API_KEY:'fixture-key',SOURCEFLOW_TEXT_MODEL:'fixture-model',SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS:'2000',ALIBABA_PRODUCT_API_ENABLED:'true',ALIBABA_APP_KEY:'12345',ALIBABA_APP_SECRET:'fixture-secret',ALIBABA_ACCESS_TOKEN:'fixture-token'}},'@/app/chatgpt-auth':{getChatGPTUser:async()=>({verifiedAccess:true}),getWorkspaceOwnerId:async()=>'owner'},'next/server':{NextResponse:Response},parse5};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,URLSearchParams,Date,Response,Request,TextEncoder,TextDecoder,Uint8Array,DataView,AbortController,setTimeout,clearTimeout,structuredClone,crypto:webcrypto,process:{env:{NODE_ENV:'production'}},fetch:async target=>{const host=new URL(target).hostname;network.push(host);if(host==='gw.open.1688.com')return Response.json(payload);assert.equal(host,'cbu01.alicdn.com');return new Response(png);},require(name){if(name in deps)return deps[name];assert.ok(name.startsWith('@/'),name);return load(name.slice(2)+'.ts');}});return exports;}
 try{
  const now=new Date().toISOString();
  const settings=load('app/observed-price-preset.ts').applyObservedPricePreset({...load('app/workspace-settings.ts').defaultSettings,brand:'저장 브랜드'});
  const context={category:{id:'cat',name:'바스켓',categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓'],mappings:[],template:null},settings,features:'',keywords:'수납,바스켓',capturedAt:now};
  sqlite.prepare('INSERT INTO collection_jobs VALUES (?,?,?,?,?,?,?,?)').run('job','owner','813724060928',sourceUrl,'price','awaiting_connector',now,now);
  sqlite.prepare('INSERT INTO collection_context VALUES (?,?)').run('job',JSON.stringify(context));
  const fetcher=async(path,init)=>{calls.push(path);if(path.endsWith('/translation'))return load('app/api/products/[id]/translation/route.ts').POST(new Request('https://app.test'+path,init),{params:Promise.resolve({id:path.split('/')[3]})});const match=/^\/api\/collection-jobs\/job\/(collect|result|capacity|product|images)$/.exec(path);assert.ok(match,`unexpected request ${path}`);const response=await load(`app/api/collection-jobs/[id]/${match[1]}/route.ts`)[init?.method??'GET'](new Request('https://app.test'+path,init),{params:Promise.resolve({id:'job'})});if(!response.ok)assert.fail(`${path}: ${response.status} ${await response.text()}`);return response;};
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
  // A synthetic completed AI result lets the actual apply and quotation APIs
  // verify stage linkage without claiming a live provider response.
  const current=sqlite.prepare('SELECT * FROM products').get();
  const prepared=sqlite.prepare('SELECT * FROM translation_jobs WHERE product_version=?').get(current.updated_at);
  const reviewed=JSON.parse(prepared.review);
  const result={draft:{title:'한국어 수납 상품',description:'검토한 한국어 설명',keywords:['추천 검색어'],warnings:[],attributes:reviewed.source.attributes.map((pair,sourceIndex)=>({sourceIndex,name:pair.name.startsWith('option-color:')?'색상':'옵션명',value:pair.name.startsWith('option-color:')?'검정':'검정 옵션'}))}};
  sqlite.prepare("UPDATE translation_jobs SET status='completed',result=? WHERE id=?").run(JSON.stringify(result),prepared.id);
  const applyRoute=load('app/api/products/[id]/translation-apply/route.ts');
  const apply=body=>applyRoute.POST(new Request('https://app.test/api/products/'+latest.product_id+'/translation-apply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId:prepared.id,expectedVersion:current.updated_at,...body})}),quoteContext);
  const previewResponse=await apply({action:'preview'}),preview=await previewResponse.json();assert.equal(previewResponse.status,200,JSON.stringify(preview));
  assert.ok(preview.preview.some(item=>item.name==='품명 · SEO 상품명 연동'&&item.after==='한국어 수납 상품'));
  const applied=await apply({action:'apply',fingerprint:preview.fingerprint});assert.equal(applied.status,200,await applied.clone().text());
  const afterContent=JSON.parse(sqlite.prepare('SELECT payload FROM product_content').get().payload),afterOptions=JSON.parse(sqlite.prepare('SELECT payload FROM product_options').get().payload);
  assert.equal(afterContent.seo.title.value,'한국어 수납 상품');assert.equal(afterContent.label.productName.value,'한국어 수납 상품');assert.equal(afterContent.labelProductNameLinked,true);
  assert.deepEqual(afterContent.seo.keywords.value,['수납','바스켓']);assert.equal(afterOptions.rows[0].translatedName,'검정 옵션');assert.equal(afterOptions.rows[0].color,'검정');
  const afterQuote=await (await quoteRoute.GET(new Request(quoteUrl),quoteContext)).json();assert.equal(optionRow(afterQuote).fields.title.value,'한국어 수납 상품');assert.equal(optionRow(afterQuote).fields.salePrice.value,'35000');assert.equal(optionRow(afterQuote).fields.mainImage.value,options.rows[0].imageKey);
  assert.equal((await apply({action:'apply',fingerprint:preview.fingerprint})).status,409);assert.equal(network.length,before);
 }finally{sqlite.close();}
});
