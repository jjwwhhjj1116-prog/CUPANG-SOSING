import {parseProductJsonLd} from '../extensions/supplier-hub/product-jsonld.mjs';
import {capture1688Product} from '../extensions/supplier-hub/capture-1688.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import * as parse5 from 'parse5';
import {webcrypto} from 'node:crypto';
import {memoryDatabase,runtimeDDL} from '../scripts/check-db-schema.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

// Real route handlers and persistence; only auth, Alibaba and R2 are fixtures.
// This is not evidence of a live Alibaba or Supplier Hub transaction.
for(const automatic of [false,true,'hidden-off-direct','hidden-off-rule','many','maximum','resume-options','resume-completed-options','stale','completed','fresh','browser-source'])test(`URL intake persists a category-scoped editable quotation (automatic=${automatic})`,async()=>{
 const sqlite=memoryDatabase();for(const statement of runtimeDDL())sqlite.exec(statement.sql);
 const db={prepare(sql){let args=[];const q={bind(...v){args=v;return q;},execute(){return sqlite.prepare(sql).all(...args);},async all(){return {results:q.execute()};},async first(){return q.execute()[0]??null;},async run(){return sqlite.prepare(sql).run(...args);}};return q;},async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(s=>({results:s.execute()}));sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const objects=new Map(),network=[],calls=[],cache=new Map();
 const sourceUrl='https://detail.1688.com/offer/813724060928.html';
 const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
 const payload={result:{success:true,result:{offerId:'813724060928',subject:'原文商品',minOrderQuantity:2,productImage:{images:['https://cbu01.alicdn.com/main.jpg']},description:'<p>원문 설명</p><img src="https://cbu01.alicdn.com/detail.jpg">',productSkuInfos:[{skuId:'5627721589407',price:'25.6',amountOnSale:'12',skuAttributes:[{attributeName:'颜色',value:'黑色',skuImageUrl:'https://cbu01.alicdn.com/black.jpg'}]}]}}};
 if(automatic===true||String(automatic).startsWith('hidden-off'))payload.result.result.productAttribute=[{attributeName:'形状',value:'方形'}];
 if(automatic==='many'||automatic==='maximum'||(automatic==='resume-options'||automatic==='resume-completed-options')){
  const original=payload.result.result.productSkuInfos[0];payload.result.result.productSkuInfos=Array.from({length:automatic==='maximum'?200:60},(_,i)=>({...structuredClone(original),skuId:String(5627721589407+i),...(automatic==='maximum'?{skuAttributes:[...original.skuAttributes,{attributeName:'尺码',value:'大号'}]}:{})}));
  payload.result.result.productAttribute=Array.from({length:50},(_,i)=>({attributeName:'属性'+i,value:'原文'}));
 }
 const deps={'cloudflare:workers':{env:{DB:db,FILES:{head:async key=>objects.has(key)?{size:objects.get(key).length,httpMetadata:{contentType:'image/png'}}:null,put:async(key,bytes)=>{objects.set(key,new Uint8Array(bytes));return {};}},OPENAI_API_KEY:'fixture-key',SOURCEFLOW_TEXT_MODEL:'fixture-model',SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS:'2000',ALIBABA_PRODUCT_API_ENABLED:'true',ALIBABA_APP_KEY:'12345',ALIBABA_APP_SECRET:'fixture-secret',ALIBABA_ACCESS_TOKEN:'fixture-token'}},'@/app/chatgpt-auth':{getChatGPTUser:async()=>({verifiedAccess:true,userId:'owner',membership:{id:'owner',status:'approved',companyCode:'A01464742',companyName:'와이홉'}}),getWorkspaceOwnerId:async()=>'owner'},'next/server':{NextResponse:Response},parse5,'@/extensions/supplier-hub/product-jsonld.mjs':{parseProductJsonLd}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,URLSearchParams,Date,Response,Request,Blob,CompressionStream,DecompressionStream,TextEncoder,TextDecoder,Uint8Array,DataView,AbortController,AbortSignal,setTimeout,clearTimeout,structuredClone,crypto:webcrypto,process:{env:{NODE_ENV:'production'}},fetch:async (target,init)=>{const host=new URL(target).hostname;network.push(host);if(host==='detail.1688.com')return new Response('<html>fixture: metadata not available on the public server page</html>',{headers:{'content-type':'text/html'}});if(host==='gw.open.1688.com')return Response.json(payload);if(host==='api.openai.com'){
 const request=JSON.parse(init.body);assert.equal(request.model,'fixture-model');assert.equal(request.store,false);
 const source=JSON.parse(request.input[0].content[0].text);assert.equal(source.category.id,'80719');assert.equal(source.title,'原文商品');
 const draft={title:'한국어 수납 상품',description:'검토한 한국어 설명',keywords:['추천 검색어'],warnings:[],attributes:source.attributes.map((pair,sourceIndex)=>({sourceIndex,name:pair.name.startsWith('option-color:')?'색상':'옵션명',value:pair.name.startsWith('option-color:')?'검정':'검정 옵션'}))};
 return Response.json({id:'fixture-response',status:'completed',model:'fixture-model',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(draft)}]}],usage:{input_tokens:100,output_tokens:50,total_tokens:150}});
 }assert.equal(host,'cbu01.alicdn.com');return new Response(png);},require(name){if(name in deps)return deps[name];if(name.startsWith('./')||name.startsWith('../'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');assert.ok(name.startsWith('@/'),name);return load(name.slice(2)+'.ts');}});return exports;}
 try{
  if(automatic==='browser-source')deps['cloudflare:workers'].env.ALIBABA_PRODUCT_API_ENABLED='false';
  const now=new Date().toISOString();
  const settings=load('app/observed-price-preset.ts').applyObservedPricePreset({...load('app/workspace-settings.ts').defaultSettings,brand:'저장 브랜드',hiddenAttributes:automatic===true});
  const context={company:{code:'A01464742',name:'와이홉'},category:{id:'cat',name:'바스켓',categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓'],mappings:[],template:null},settings,features:'',keywords:'수납,바스켓',capturedAt:now};
  sqlite.prepare('INSERT INTO collection_jobs VALUES (?,?,?,?,?,?,?,?)').run('job','owner','813724060928',sourceUrl,'price','awaiting_connector',now,now);
  sqlite.prepare('INSERT INTO collection_context VALUES (?,?)').run('job',JSON.stringify(context));
  let interruptOptions=false;
  const fetcher=async(path,init)=>{calls.push(path);if(interruptOptions&&((automatic==='resume-options'&&path.endsWith('/translation')&&JSON.parse(init.body).action==='approve')||(automatic==='resume-completed-options'&&path.endsWith('/translation-apply')&&JSON.parse(init.body).scope==='options'))){const pending=sqlite.prepare('SELECT id FROM translation_jobs WHERE id=? AND idempotency_key LIKE ?').get(JSON.parse(init.body).jobId,'intake-options-%');if(pending){interruptOptions=false;throw Error('fixture connection interrupted before option approval');}}if(path.endsWith('/translation-apply'))return load('app/api/products/[id]/translation-apply/route.ts').POST(new Request('https://app.test'+path,init),{params:Promise.resolve({id:path.split('/')[3]})});if(path.endsWith('/translation'))return load('app/api/products/[id]/translation/route.ts').POST(new Request('https://app.test'+path,init),{params:Promise.resolve({id:path.split('/')[3]})});const match=/^\/api\/collection-jobs\/job\/(collect|browser-capture|result|capacity|product|images|images-batch)$/.exec(path);assert.ok(match,`unexpected request ${path}`);const response=await load(`app/api/collection-jobs/[id]/${match[1]}/route.ts`)[init?.method??'GET'](new Request('https://app.test'+path,init),{params:Promise.resolve({id:'job'})});if(!response.ok&&!(automatic==='browser-source'&&match[1]==='collect'&&response.status===422))assert.fail(`${path}: ${response.status} ${await response.text()}`);return response;};
  let browserReads=0;
  const captureFromBrowser=async value=>{
   assert.equal(value,sourceUrl);
   const product=payload.result.result;
   const metadata={'@type':'ProductGroup',url:value,name:product.subject,image:product.productImage.images,description:product.description,
    hasVariant:product.productSkuInfos.map(sku=>({'@type':'Product',sku:sku.skuId,name:sku.skuAttributes[0].value,color:sku.skuAttributes[0].value,image:sku.skuAttributes[0].skuImageUrl,offers:{'@type':'Offer',price:sku.price,priceCurrency:'CNY',eligibleQuantity:{minValue:product.minOrderQuantity},inventoryLevel:{'@type':'QuantitativeValue',value:Number(sku.amountOnSale)}}}))};
   const tabs=new Map([[7,{id:7,windowId:17,url:'http://localhost:3000/'}],[9,{id:9,windowId:17,url:value,status:'complete',active:false}]]);
   const api={tabs:{get:async id=>tabs.get(id),query:async()=>[],create:async()=>tabs.get(9),remove:async id=>tabs.delete(id)},scripting:{executeScript:async()=>{browserReads++;return [{frameId:0,result:{pageUrl:value,scripts:browserReads<2?[]:[JSON.stringify(metadata)]}}];}}};
   return capture1688Product({type:'YOOFAM_CAPTURE_1688',requestId:'00000000-0000-4000-8000-000000000003',sourceUrl:value},{tab:tabs.get(7),frameId:0,url:tabs.get(7).url},api,{wait:async()=>{}});
  };
  let latest;const run=async()=>load('app/intake-collection.ts').collectIntakeProduct(await load('db/collection-jobs.ts').findCollectionJob('owner','job'),{signal:new AbortController().signal,fetcher,...(automatic==='browser-source'?{captureFromBrowser}:{}),onJob:job=>{latest=job;},onProgress:()=>{}});
  // The add-only goal must work with no model credentials and leave no AI job.
  if(automatic!=='fresh'&&automatic!=='resume-options'&&automatic!=='resume-completed-options'){
  sqlite.prepare('UPDATE collection_jobs SET goal=? WHERE id=?').run('collect','job');
  delete deps['cloudflare:workers'].env.OPENAI_API_KEY;
  assert.match(await run(),/상품 추가 완료/);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,0);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM products').get().n,1);
  assert.match(await run(),/상품 추가 완료/);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,0);
  }
  sqlite.prepare('UPDATE collection_jobs SET goal=? WHERE id=?').run('price','job');
  deps['cloudflare:workers'].env.OPENAI_API_KEY='fixture-key';
  if(automatic){
   const bindings=deps['cloudflare:workers'].env;delete bindings.OPENAI_API_KEY;
   bindings.SOURCEFLOW_TEXT_PROVIDER='workers-ai';bindings.SOURCEFLOW_TEXT_MODEL='@cf/meta/llama-3.3-70b-instruct-fp8-fast';
   const expectedGenerations=automatic==='maximum'?13:(automatic==='many'||(automatic==='resume-options'||automatic==='resume-completed-options'))?4:1;
   if(automatic===true||automatic==='hidden-off-rule'){
    const field=load('app/quotation-schema.ts').getQuotationSchema('80719').fields.find(f=>f.id==='basketShape');
    const rules={format:'sourceflow-attribute-rules-v1',categoryId:'80719',rules:[{sourceName:'상품속성: 形状',fieldId:field.id,fieldSignature:JSON.stringify(field)}]};
    sqlite.prepare('INSERT INTO quotation_attribute_rules(owner_id,category_id,payload,revision,updated_at) VALUES(?,?,?,?,?)').run('owner','80719',JSON.stringify(rules),1,new Date().toISOString());
   }
   let generations=0;bindings.AI={run:async(model,input)=>{generations++;assert.equal(model,bindings.SOURCEFLOW_TEXT_MODEL);const source=JSON.parse(input.messages[1].content);assert.equal(source.category.id,'80719');return {response:{title:generations===1?'자동 생성 수납 상품':'후속 요청 상품명',description:'검토용 설명',keywords:['수납'],warnings:[],attributes:source.attributes.map((pair,sourceIndex)=>({sourceIndex,name:pair.name.startsWith('상품속성:')?(automatic===true||automatic==='hidden-off-rule'?'상품 모양':'바구니 형태'):'옵션',value:pair.name.startsWith('상품속성:')?'사각형':pair.name.startsWith('option-color:')?'검정':'검정 옵션'}))}};}};
   let expiredJobId;
   if(automatic===true||automatic==='stale'||automatic==='completed'){
    const productId=sqlite.prepare('SELECT id FROM products').get().id;
    const prepared=await fetcher(`/api/products/${productId}/translation`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'prepare-collected',intake:true})});
    assert.equal(prepared.status,201);
    const oldJob=(await prepared.json()).job;expiredJobId=oldJob.id;
    if(automatic==='completed'){
     const post=body=>fetcher('/api/products/'+productId+'/translation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
     const approved=await post({action:'approve',jobId:oldJob.id,reviewFingerprint:oldJob.review.fingerprint,confirmPaid:true});assert.equal(approved.status,200);
     const executed=await post({action:'execute',jobId:oldJob.id});assert.equal(executed.status,200);assert.equal((await executed.json()).job.status,'completed');
    }
    if(automatic==='stale'||automatic==='completed')sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run(new Date(Date.now()+1000).toISOString(),productId);
    oldJob.review.expiresAt='2026-01-01T00:00:00.000Z';
    if(automatic!=='completed')sqlite.prepare('UPDATE translation_jobs SET review=?,expires_at=? WHERE id=?').run(JSON.stringify(oldJob.review),oldJob.review.expiresAt,oldJob.id);
   }
   let pendingOptionsId;
   if((automatic==='resume-options'||automatic==='resume-completed-options')){interruptOptions=true;await assert.rejects(run(),/fixture connection interrupted/);pendingOptionsId=sqlite.prepare("SELECT id FROM translation_jobs WHERE idempotency_key LIKE 'intake-options-%'").get().id;assert.equal(generations,automatic==='resume-completed-options'?2:1);assert.equal(objects.size,3);}
   if(automatic==='resume-completed-options'){
    const productId=latest.product_id;
    const contentRoute=load('app/api/products/[id]/content/route.ts');
    const saved=JSON.parse(sqlite.prepare('SELECT payload FROM product_content').get().payload);
    const response=await contentRoute.PATCH(new Request('https://app.test/api/products/'+productId+'/content',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:saved.revision,patch:{seo:{title:'검토자가 고친 상품명'},label:{material:'직접 확인한 재질'}}})}),{params:Promise.resolve({id:productId})});
    assert.equal(response.status,200,await response.clone().text());
   }
   const expectedTitle=automatic==='resume-completed-options'?'검토자가 고친 상품명':'저장 브랜드 자동 생성 수납 상품';
   const start=calls.length;
   assert.match(await run(),/SEO·옵션 초안을 생성해 반영/);assert.equal(generations,expectedGenerations);
   if(pendingOptionsId)assert.equal(sqlite.prepare('SELECT status FROM translation_jobs WHERE id=?').get(pendingOptionsId).status,'completed');
   const sequence=calls.slice(start);
   const firstImage=sequence.findIndex(path=>path.endsWith('/images')||path.endsWith('/images-batch'));
   const lastDraft=sequence.findLastIndex(path=>path.endsWith('/translation')||path.endsWith('/translation-apply'));
   assert.ok(lastDraft>=0 && firstImage>lastDraft, 'draft writes must finish before image attachment mutations');
   if(expiredJobId){const saved=sqlite.prepare('SELECT id,status FROM translation_jobs WHERE idempotency_key=?').get('intake-auto-v1');assert.equal(saved.id,expiredJobId);assert.equal(saved.status,'completed');}
   const content=JSON.parse(sqlite.prepare('SELECT payload FROM product_content').get().payload);
   if(automatic==='many'){assert.equal(content.categoryAttributes.categoryId,'80719');assert.equal(content.categoryAttributes.values.length,50);}
   assert.equal(content.seo.title.value,expectedTitle);assert.equal(content.label.productName.value,expectedTitle);if(automatic==='resume-completed-options')assert.equal(content.label.material.value,'직접 확인한 재질');
   const rows=JSON.parse(sqlite.prepare('SELECT payload FROM product_options').get().payload).rows;
   if(automatic==='maximum'){assert.equal(rows.length,200);assert.ok(rows.every(row=>row.size==='검정 옵션'&&row.provenance.size==='translated'));}
   assert.equal(rows[0].translatedName,'검정 옵션');assert.equal(rows[0].color,'검정');assert.equal(rows[0].unitCostCny,25.6);
   assert.ok(rows.every(option=>option.imageKey===null),'intake source images are not selected option representatives');
   for(const role of ['main','additional','detail'])assert.deepEqual(content.assets[role].value,[],`intake keeps stage ${role} pending`);
   const qr=load('app/api/products/[id]/quotation-fields/route.ts'),qc={params:Promise.resolve({id:latest.product_id})},qu='https://app.test/api/products/'+latest.product_id+'/quotation-fields';
   let view=await (await qr.GET(new Request(qu),qc)).json();const row=view.resolved.rows.find(r=>r.optionId==='collected-1');assert.equal(row.fields.title.value,expectedTitle);assert.equal(row.fields.supplyPrice.value,'17920');if(automatic===true){assert.equal(row.fields.basketShape.value,'사각형');assert.equal(row.fields.basketShape.source,'content');}
   for(const field of ['mainImage','additionalImages','detailImages'])assert.equal(row.fields[field].value,'',`unselected originals stay out of quotation ${field}`);
   assert.equal(content.detailDescriptionLinked,true);
   assert.equal(row.fields.detailHtml.value,'<p>검토용 설명</p>','new URL draft follows its saved SEO explanation until stage five is saved');assert.equal(row.fields.altText.value,'','fresh alternate text stays blank');
   if(String(automatic).startsWith('hidden-off')){
    assert.equal(content.categoryAttributes.hiddenAttributes,false);
    assert.equal(row.fields.basketShape.value,'');assert.equal(row.fields.basketShape.source,'couplus-default');
    assert.equal(rows[0].translatedName,'검정 옵션');assert.equal(rows[0].color,'검정');
   }
   if(automatic==='fresh'){
    const contentRoute=load('app/api/products/[id]/content/route.ts');
    const keys=[...objects.keys()];assert.equal(keys.length,3);
    for(let i=0;i<4;i++){const key='owner/stage-image-'+i+'.png';objects.set(key,png);keys.push(key);}
    sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify(keys),latest.product_id);
    const savedContent=await contentRoute.PATCH(new Request('https://app.test/api/products/'+latest.product_id+'/content',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:content.revision,patch:{seo:{title:'1단계 수정 상품명',keywords:['1단계 검색어'],description:'SEO 설명은 상세페이지와 별개'},detail:{description:'수정 설명 & 줄바꿈\n둘째 줄',altText:'확인한 상세 이미지 설명'},label:{material:'6단계 재질',countryOfOrigin:'중국'},assets:{main:[keys[0]],additional:[keys[2],keys[1]],detailTop:[keys[3]],detail:[keys[4]],detailBottom:[keys[5]],label:[keys[6]]}}})}),qc);
    assert.equal(savedContent.status,200,await savedContent.clone().text());
    view=await (await qr.GET(new Request(qu),qc)).json();
    const stageRow=view.resolved.rows.find(r=>r.optionId==='collected-1');
    for(const [field,value] of Object.entries({title:'1단계 수정 상품명',searchTags:'1단계 검색어',noticeMaterial:'6단계 재질',noticeCountryOfOrigin:'중국',additionalImages:[keys[2],keys[1]].join('\n'),detailImages:[keys[3],keys[4],keys[5]].join('\n'),labelImages:keys[6],detailHtml:'<p>수정 설명 &amp; 줄바꿈<br>둘째 줄</p>'}))assert.equal(stageRow.fields[field].value,value,'source-stage edit '+field);
   }
   const edit=await qr.PUT(new Request(qu,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:'salePrice',optionId:'collected-1',value:'35000'},...(automatic==='fresh'?[{fieldKey:'title',optionId:null,value:'검토 완료 상품명'},{fieldKey:'searchTags',optionId:null,value:'검토 검색어'},{fieldKey:'additionalImages',optionId:'collected-1',value:''},{fieldKey:'detailHtml',optionId:null,value:'<p>직접 수정한 상세 설명</p>'},{fieldKey:'noticeMaterial',optionId:null,value:'검토 재질'},{fieldKey:'packagedWeightG',optionId:'collected-1',value:'420'},{fieldKey:'packagedDimensionsMm',optionId:'collected-1',value:'100*200*300'}]:[])]})}),qc);assert.equal(edit.status,200);
   assert.match(await run(),/저장된 SEO·옵션값/);assert.equal(generations,expectedGenerations);assert.equal(sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,expectedGenerations);
   assert.ok(rows.every(r=>r.translatedName==='검정 옵션'&&r.color==='검정'));
   const after=await (await qr.GET(new Request(qu),qc)).json();assert.equal(after.resolved.rows.find(r=>r.optionId==='collected-1').fields.salePrice.value,'35000');
   if(automatic==='fresh'){
    const expected={title:'검토 완료 상품명',searchTags:'검토 검색어',salePrice:'35000',additionalImages:'',detailHtml:'<p>직접 수정한 상세 설명</p>',altText:'확인한 상세 이미지 설명',noticeMaterial:'검토 재질',packagedWeightG:'420',packagedDimensionsMm:'100*200*300'};
    const finalRow=after.resolved.rows.find(row=>row.optionId==='collected-1');
    for(const [field,value] of Object.entries(expected))assert.equal(finalRow.fields[field].value,value,`reviewed ${field} survives intake retry`);
    const sourceModule=load('app/exports/quotation-source.ts');
    const exportedSource=await sourceModule.readQuotationExportSource('owner',latest.product_id,null);
    const resolved=sourceModule.resolveQuotationExport(exportedSource);
    const assets=[...objects.keys()].map((key,index)=>({key,name:`assets/review-${index}.png`,bytes:png}));
    const output=load('app/exports/quotation-fields.ts').resolvedQuotationRows(exportedSource,resolved,assets)[0];
    for(const [field,value] of Object.entries(expected))assert.equal(String(output[field]),value,`export retains ${field}`);
    assert.equal(output.material,'검토 재질');
    assert.equal(output.sourceUrl,sourceUrl);
    assert.equal(output.skuId,'5627721589407');
    assert.match(output.mainImage,/^review-\d+\.png$/);
    assert.ok(exportedSource.content.assets.additional.value.length>0,'excluding quotation images must not delete source images');
    // Carry the same reviewed draft through the real XLSX route, R2 reads,
    // ZIP manifest and stale-review guard. This workbook is deliberately synthetic.
    const fields=['categoryId','category','title','searchTags','supplyPrice','salePrice','msrp','mainImage','additionalImages','detailHtml','altText','noticeMaterial','packagedWeightG','packagedDimensionsMm','detailImages','labelImages','noticeCountryOfOrigin'];
    const workbook=quotationWorkbook(fields);
    const sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
    const storageKey=load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');
    objects.set(storageKey,workbook);
    deps['cloudflare:workers'].env.FILES.get=async key=>{
      const bytes=objects.get(key);return bytes?{size:bytes.byteLength,arrayBuffer:async()=>bytes.slice().buffer}:null;
    };
    const profile={name:'테스트 양식',categoryId:'80719',categoryPath:context.category.categoryPath,
      template:{name:'synthetic.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},
      mappings:fields.map((field,column)=>({field,column,required:false}))};
    await load('db/category-profiles.ts').createCategoryProfile('owner',profile,'cat');
    const exportRoute=load('app/api/products/[id]/quotation/route.ts');
    const exportRequest=body=>exportRoute.POST(new Request('https://app.test/api/products/'+latest.product_id+'/quotation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),qc);
    const previewResponse=await exportRequest({action:'preview'}),preview=await previewResponse.json();
    assert.equal(previewResponse.status,200,JSON.stringify(preview));
    assert.equal(preview.report.profileId,'cat');assert.equal(preview.report.categoryId,'80719');
    const download=await exportRequest({action:'download',fingerprint:preview.fingerprint});
    assert.equal(download.status,200,await download.clone().text());
    const reader=load('app/xlsx-template.ts');
    const archive=await reader.readXlsxArchive(await download.arrayBuffer());
    const cells=reader.xlsxHeaders(reader.inspectXlsxArchive(archive),'견적서',2);
    const actual=Object.fromEntries(fields.map((field,index)=>[field,cells[index]]));
    for(const [field,value] of Object.entries(expected))assert.equal(actual[field],value,`XLSX retains reviewed ${field}`);
    assert.equal(actual.noticeCountryOfOrigin,'중국');
    assert.equal(actual.categoryId,'80719');assert.equal(actual.category,context.category.categoryPath.join(' > ')+' (80719)');assert.equal(actual.supplyPrice,'17920');assert.equal(actual.msrp,'38830');
    assert.match(actual.mainImage,/^image-\d+\.png$/);
    const packaged=await exportRequest({action:'export',fingerprint:preview.fingerprint});
    assert.equal(packaged.status,200,await packaged.clone().text());
    const bundle=await reader.readXlsxArchive(await packaged.arrayBuffer());
    assert.deepEqual(Buffer.from(bundle.get(preview.filename)),Buffer.from(await (await exportRequest({action:'download',fingerprint:preview.fingerprint})).arrayBuffer()));
    const plan=JSON.parse(new TextDecoder().decode(bundle.get('supplier-hub-upload-plan.json'))); assert.deepEqual(plan.company,{code:'A01464742',name:'와이홉'});
    const originalIdentity=deps['@/app/chatgpt-auth'].getChatGPTUser;
    deps['@/app/chatgpt-auth'].getChatGPTUser=async()=>({verifiedAccess:true,userId:'owner',membership:{id:'owner',status:'approved',companyCode:'A01526306',companyName:'유앤채'}});
    assert.equal((await exportRequest({action:'export',fingerprint:preview.fingerprint})).status,409,'company change invalidates reviewed package');
    deps['@/app/chatgpt-auth'].getChatGPTUser=originalIdentity;
    assert.equal(plan.categoryId,'80719');assert.equal(plan.quotation.file.filename,preview.filename);
    assert.ok(plan.productImages.some(image=>image.filename===actual.mainImage));
    assert.ok(plan.productImages.every(image=>bundle.has(image.archivePath)));
    for(const [field,group,keys] of [['detailImages',plan.productImages,exportedSource.content.assets.detailTop.value.concat(exportedSource.content.assets.detail.value,exportedSource.content.assets.detailBottom.value)],['labelImages',plan.labelImages,exportedSource.content.assets.label.value]]){
     const names=actual[field].split('\n');assert.equal(names.length,keys.length);
     keys.forEach((key,index)=>{const image=group.find(image=>image.key===key);assert.ok(image);assert.equal(names[index],image.filename);assert.ok(bundle.has(image.archivePath));assert.ok(image.references.some(ref=>ref.fieldId===field&&ref.position===index+1));});
    }
    const changed=await qr.PUT(new Request(qu,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:after.revision,expectedInputFingerprint:after.inputFingerprint,changes:[{fieldKey:'salePrice',optionId:'collected-1',value:'36000'}]})}),qc);
    assert.equal(changed.status,200,await changed.clone().text());
    assert.equal((await exportRequest({action:'export',fingerprint:preview.fingerprint})).status,409);
    const refreshed=await (await exportRequest({action:'preview'})).json();
    assert.equal(refreshed.rows[0][fields.indexOf('salePrice')],36000);
    assert.notEqual(refreshed.fingerprint,preview.fingerprint);
    const contentRoute=load('app/api/products/[id]/content/route.ts');
    const sourceEdit=await contentRoute.PATCH(new Request('https://app.test/api/products/'+latest.product_id+'/content',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:exportedSource.content.revision,patch:{seo:{title:'다시 바꾼 1단계 이름'},label:{countryOfOrigin:'대한민국'}}})}),qc);
    assert.equal(sourceEdit.status,200,await sourceEdit.clone().text());
    assert.equal((await exportRequest({action:'export',fingerprint:refreshed.fingerprint})).status,409,'editing a source stage invalidates a prepared package');
    const finalPreview=await(await exportRequest({action:'preview'})).json();
    assert.equal(finalPreview.rows[0][fields.indexOf('title')],'검토 완료 상품명','final quotation override survives later source edits');
    assert.equal(finalPreview.rows[0][fields.indexOf('noticeCountryOfOrigin')],'대한민국','unoverridden source edit reaches Excel');
    assert.equal(finalPreview.rows[0][fields.indexOf('salePrice')],36000);
    assert.notEqual(finalPreview.fingerprint,refreshed.fingerprint);
    // Editing the selling pack after reviewing a quotation must recalculate
    // automatic prices while preserving explicitly reviewed quotation cells.
    // Exercise persistence and the generated workbook, not a pricing-only mock.
    const optionRoute=load('app/api/products/[id]/options/route.ts');
    const optionUrl='https://app.test/api/products/'+latest.product_id+'/options';
    const optionState=await(await optionRoute.GET(new Request(optionUrl),qc)).json();
    const packRows=load('app/product-options.ts').optionInputs(optionState.options);
    packRows[0].unitsPerPack=2;
    packRows[0].translatedName='직접 수정한 2개입';
    packRows.push({...packRows[0],id:'manual-second',supplierSku:'manual-second-sku',unitsPerPack:1,translatedName:'추가한 1개입'});
    const packSave=await optionRoute.PATCH(new Request(optionUrl,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:optionState.options.revision,expectedProductVersion:optionState.productVersion,rows:packRows})}),qc);
    assert.equal(packSave.status,200,await packSave.clone().text());
    assert.equal((await exportRequest({action:'export',fingerprint:finalPreview.fingerprint})).status,409);
    const packPreviewResponse=await exportRequest({action:'preview'}),packPreview=await packPreviewResponse.json();
    assert.equal(packPreviewResponse.status,200,JSON.stringify(packPreview));
    assert.equal(packPreview.rows[0][fields.indexOf('supplyPrice')],35840);
    assert.equal(packPreview.rows[0][fields.indexOf('salePrice')],36000,'manual sale price survives pack recalculation');
    assert.equal(packPreview.rows[0][fields.indexOf('msrp')],77650);
    assert.equal(packPreview.rows.length,2);
    assert.equal(packPreview.rows[1][fields.indexOf('supplyPrice')],17920);
    assert.equal(packPreview.rows[1][fields.indexOf('salePrice')],29870,'first option override must not leak into the new option');
    const packSource=await sourceModule.readQuotationExportSource('owner',latest.product_id,null);
    const packOutput=load('app/exports/quotation-fields.ts').resolvedQuotationRows(packSource,sourceModule.resolveQuotationExport(packSource),assets)[0];
    assert.equal(packOutput.sourcePriceCny,51.2);assert.equal(packOutput.skuName,'직접 수정한 2개입');
    const packDownload=await exportRequest({action:'download',fingerprint:packPreview.fingerprint});
    assert.equal(packDownload.status,200,await packDownload.clone().text());
    const packArchive=await reader.readXlsxArchive(await packDownload.arrayBuffer());
    const packCells=reader.xlsxHeaders(reader.inspectXlsxArchive(packArchive),'견적서',2);
    assert.equal(packCells[fields.indexOf('supplyPrice')],'35840');
    assert.equal(packCells[fields.indexOf('salePrice')],'36000');
    assert.equal(packCells[fields.indexOf('msrp')],'77650');
    const secondCells=reader.xlsxHeaders(reader.inspectXlsxArchive(packArchive),'견적서',3);
    assert.equal(secondCells[fields.indexOf('salePrice')],'29870');
    assert.equal(secondCells[fields.indexOf('title')],'검토 완료 상품명','common review applies to a new option');
    const currentOptions=await(await optionRoute.GET(new Request(optionUrl),qc)).json();
    const excludedRows=load('app/product-options.ts').optionInputs(currentOptions.options).map(row=>({...row,included:false}));
    const exclude=await optionRoute.PATCH(new Request(optionUrl,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:currentOptions.options.revision,expectedProductVersion:currentOptions.productVersion,rows:excludedRows})}),qc);
    assert.equal(exclude.status,200,await exclude.clone().text());
    const emptyExport=await exportRequest({action:'preview'});
    assert.notEqual(emptyExport.status,200,'excluded options must not become a common product row');
    assert.match(await emptyExport.text(),/옵션/);
    assert.equal((await exportRequest({action:'export',fingerprint:packPreview.fingerprint})).status,409);
   }
   assert.equal(sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
   if(automatic==='browser-source'){
    assert.equal(browserReads,4);assert.equal(calls.filter(path=>path.endsWith('/collect')).length,1);
    assert.equal(calls.filter(path=>path.endsWith('/browser-capture')).length,1);
    assert.equal(network.filter(host=>host==='gw.open.1688.com').length,0);
    assert.equal(network.filter(host=>host==='detail.1688.com').length,1);
    const receipt=await load('db/collection-results.ts').readCollectionResult('owner','job');assert.equal(receipt.result.provider,'chrome-product-jsonld-v1');
   }
   return;
  }
  await assert.rejects(run(),/SEO 요청을 준비/);assert.ok(latest.product_id);const seo=sqlite.prepare('SELECT * FROM translation_jobs').get();assert.equal(seo.status,'prepared');const review=JSON.parse(seo.review);assert.equal(review.source.category.id,'80719');assert.equal(review.source.title,'原文商品');assert.equal(review.source.guidance.keywords,'수납,바스켓');assert.ok(review.source.attributes.some(pair=>pair.name==='option:collected-1'));assert.equal(seo.result,null);
  await assert.rejects(run());assert.equal(sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,1);
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
  const options=JSON.parse(sqlite.prepare('SELECT payload FROM product_options').get().payload);assert.equal(options.rows[0].supplierSku,'5627721589407');assert.equal(options.rows[0].stock,12);assert.equal(options.rows[0].imageKey,null);
  for(const field of ['mainImage','additionalImages','detailImages'])assert.equal(row.fields[field].value,'');
  assert.equal(JSON.parse(sqlite.prepare('SELECT image_keys FROM products').get().image_keys).length,3,'original files remain available for image editing');
  const edit={expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:'salePrice',optionId:options.rows[0].id,value:'35000'}]};
  const save=await quoteRoute.PUT(new Request(quoteUrl,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(edit)}),quoteContext);
  const saved=await save.json();assert.equal(save.status,200,JSON.stringify(saved));assert.equal(optionRow(saved).fields.salePrice.value,'35000');
  sqlite.prepare('UPDATE products SET title=? WHERE id=?').run('검토 후 수정한 상품명',latest.product_id);
  const previousRequests=network.length;await assert.rejects(run(),/SEO 요청을 준비/);assert.equal(network.length,previousRequests);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM products').get().n,1);const product=sqlite.prepare('SELECT * FROM products').get();assert.equal(product.title,'검토 후 수정한 상품명');assert.equal(product.supplier_hub_status,'미전송');
  const resumed=await (await quoteRoute.GET(new Request(quoteUrl),quoteContext)).json();assert.equal(optionRow(resumed).fields.salePrice.value,'35000');assert.equal(resumed.categoryContext.categoryId,'80719');
  const stale=await quoteRoute.PUT(new Request(quoteUrl,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(edit)}),quoteContext);assert.equal(stale.status,409);
  // Editing the quotation advances the product version and requires a fresh review.
  assert.equal(sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,2);await assert.rejects(run());assert.equal(sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,2);
  const before=network.length;delete deps['cloudflare:workers'].env.OPENAI_API_KEY;
  await assert.rejects(run(),/SEO 요청 준비는 완료되지/);assert.equal(network.length,before);assert.equal(sqlite.prepare('SELECT count(*) n FROM products').get().n,1);
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
  assert.ok(preview.preview.some(item=>item.name==='품명 · SEO 상품명 연동'&&item.after==='저장 브랜드 한국어 수납 상품'));
  const applied=await apply({action:'apply',fingerprint:preview.fingerprint});assert.equal(applied.status,200,await applied.clone().text());
  const afterContent=JSON.parse(sqlite.prepare('SELECT payload FROM product_content').get().payload),afterOptions=JSON.parse(sqlite.prepare('SELECT payload FROM product_options').get().payload);
  assert.equal(afterContent.seo.title.value,'저장 브랜드 한국어 수납 상품');assert.equal(afterContent.label.productName.value,'저장 브랜드 한국어 수납 상품');assert.equal(afterContent.labelProductNameLinked,true);
  assert.deepEqual(afterContent.seo.keywords.value,['추천 검색어']);assert.equal(afterContent.intakeKeywordSeed,undefined);assert.equal(afterOptions.rows[0].translatedName,'검정 옵션');assert.equal(afterOptions.rows[0].color,'검정');
  const afterQuote=await (await quoteRoute.GET(new Request(quoteUrl),quoteContext)).json();assert.equal(optionRow(afterQuote).fields.title.value,'저장 브랜드 한국어 수납 상품');assert.equal(optionRow(afterQuote).fields.salePrice.value,'35000');assert.equal(optionRow(afterQuote).fields.mainImage.value,'');
  assert.equal((await apply({action:'apply',fingerprint:preview.fingerprint})).status,409);assert.equal(network.length,before+1);
 }finally{sqlite.close();}
});
