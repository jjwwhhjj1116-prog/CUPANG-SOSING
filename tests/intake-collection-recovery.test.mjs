import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const sourceUrl='https://detail.1688.com/offer/813724060928.html';
const originalJob={id:'job',offer_id:'813724060928',source_url:sourceUrl,goal:'collect',status:'awaiting_connector',created_at:'2026-10-01T00:00:00.000Z',updated_at:'2026-10-01T00:00:00.000Z',context:null};
const plain=value=>JSON.parse(JSON.stringify(value));
const receivedAt='2026-10-01T00:00:01.000Z';
const receipt=()=>({jobId:'job',offerId:'813724060928',receipt:{receivedAt,result:{schemaVersion:1,sourceUrl,offerId:'813724060928',provider:'1688-public-mobile-v1',collectedAt:'2026-10-01T00:00:00.000Z',title:'확인한 원문',description:'확인한 설명',options:[{sku:'source-sku',name:'검정',unitPriceCny:10,minimumOrder:1,stock:null}],images:[]}}});
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const compiled=ts.transpileModule(fs.readFileSync(new URL('../app/intake-collection.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;

function unit(fetcher,{signal=new AbortController().signal,captureFromBrowser,job=originalJob}={}){
 const imports=[],jobs=[],progress=[],seo=[];
 const exports={};
 vm.runInNewContext(compiled,{exports,Error,AbortSignal,require(name){
  if(name==='@/app/collection-batch')return{importReceivedJobs:async(values,options)=>{imports.push(plain(values));await options.onProductSaved(values[0].id,'saved-product');options.onResult(values[0].id,{status:'completed',productId:'saved-product',completedImages:0});}};
  if(name==='@/app/intake-seo')return{prepareIntakeSeoOutcome:async(...args)=>{seo.push(args);return{completed:true,message:'확인한 초안'};}};
  return providedOptionModule(name.slice(2)+'.ts');
 }});
 return{imports,jobs,progress,seo,run:()=>exports.collectIntakeProduct(job,{signal,fetcher,captureFromBrowser,onJob:value=>jobs.push(plain(value)),onProgress:value=>progress.push(value)})};
}

for(const variant of ['network','body-stream','html-200','html-502','json-500','json-503'])test(`uncertain collect ${variant} reads exactly one same-job receipt before import`,async()=>{
 const requests=[],controller=new AbortController();
 const f=unit(function(path,init){
  assert.equal(this,undefined,'native-shaped fetch must receive no dependency object');requests.push({path,init});
  if(path.endsWith('/result'))return Promise.resolve(Response.json(receipt()));
  if(variant==='network')throw Error('unsafe <html> original proxy content');
  if(variant==='body-stream')return Promise.resolve({ok:true,status:200,json:async()=>{throw Error('body interrupted');}});
  if(variant.startsWith('html'))return Promise.resolve(new Response('<html>proxy upstream error</html>',{status:variant==='html-200'?200:502}));
  return Promise.resolve(Response.json({error:'저장 응답 중단'},{status:variant==='json-500'?500:503}));
 },{signal:controller.signal});
 const before=JSON.stringify(originalJob),message=await f.run();
 assert.match(message,/상품 추가 완료/);assert.equal(f.imports.length,1);assert.equal(f.imports[0][0].received_at,receivedAt);
 assert.equal(f.jobs.at(-1).product_id,'saved-product');assert.equal(f.seo.length,0);assert.equal(JSON.stringify(originalJob),before);
 assert.deepEqual(requests.map(item=>[item.path,item.init.method]),[['/api/collection-jobs/job/collect','POST'],['/api/collection-jobs/job/result','GET']]);
 assert.equal(requests[1].init.cache,'no-store');assert.ok(requests.every(item=>item.init.signal!==controller.signal&&!item.init.signal.aborted));
 assert.notEqual(requests[0].init.signal,requests[1].init.signal,'Each bounded request has an independent cancellation scope');assert.equal(controller.signal.aborted,false);
});

for(const variant of ['null','wrong-job','wrong-offer','wrong-source','changed-source-url','invalid-source','invalid-time','get-failure','get-html','get-network'])test(`failed receipt recovery ${variant} never imports or captures`,async()=>{
 const requests=[];let captures=0;
 const f=unit(async(path,init)=>{
  requests.push({path,init});if(path.endsWith('/collect'))throw Error('private network <html>fragment</html>');
  if(variant==='get-network')throw Error('recovery response lost');
  if(variant==='get-failure')return Response.json({error:'unavailable'},{status:503});
  if(variant==='get-html')return new Response('<html>recovery proxy detail</html>');
  const body=receipt();
  if(variant==='null')body.receipt=null;
  if(variant==='wrong-job')body.jobId='another-job';
  if(variant==='wrong-offer')body.offerId='813724060929';
  if(variant==='wrong-source')body.receipt.result.sourceUrl='https://detail.1688.com/offer/813724060929.html';
  if(variant==='changed-source-url')body.receipt.result.sourceUrl+='?changed=1';
  if(variant==='invalid-source')body.receipt.result.options=[];
  if(variant==='invalid-time')body.receipt.receivedAt='not-a-time';
  return Response.json(body);
 },{captureFromBrowser:async()=>{captures++;assert.fail('uncertain collection must not open Chrome');}});
 const before=JSON.stringify(originalJob);
 await assert.rejects(f.run,error=>{assert.match(error.message,/저장된 원문도 확인하지 못했습니다.*입력은 유지/);assert.doesNotMatch(error.message,/<html>|private|proxy detail/u);return true;});
 assert.equal(requests.length,2);assert.equal(f.imports.length,0);assert.equal(f.jobs.length,0);assert.equal(f.seo.length,0);assert.equal(captures,0);
 assert.equal(JSON.stringify(originalJob),before);
});

for(const status of [400,401,403,404,409,422])for(const malformed of [false,true])test(`definite HTTP ${status} ${malformed?'HTML':'JSON'} stays terminal without receipt recovery`,async()=>{
 let requests=0,captures=0;
 const f=unit(async()=>{requests++;return malformed?new Response('<html>do not display this</html>',{status}):Response.json({error:'명시적 요청 거절'},{status});},{captureFromBrowser:async()=>{captures++;assert.fail('terminal rejection must not capture');}});
 await assert.rejects(f.run,error=>{assert.doesNotMatch(error.message,/<html>|do not display/u);return true;});
 assert.equal(requests,1);assert.equal(captures,0);assert.equal(f.imports.length,0);assert.equal(f.jobs.length,0);
});

test('known configuration 503 remains terminal and preserves its safe error',async()=>{
 let calls=0;const f=unit(async()=>{calls++;return Response.json({code:'SOURCE_CONFIGURATION_REQUIRED',error:'서버 설정을 확인해야 합니다.'},{status:503});},{captureFromBrowser:async()=>assert.fail('configuration failure never captures')});
 await assert.rejects(f.run,/서버 설정을 확인해야 합니다/);assert.equal(calls,1);assert.equal(f.imports.length,0);assert.equal(f.jobs.length,0);
});

test('provider and candidate failures remain terminal without opening Chrome, receipt recovery or import',async()=>{
 for(const code of ['SOURCE_PROVIDER_FAILED','SOURCE_CANDIDATE_INVALID']){
  let requests=0,captures=0;const f=unit(async()=>{requests++;return Response.json({code,error:'원문 확인 실패'},{status:422});},{captureFromBrowser:async()=>{captures++;assert.fail('terminal source rejection never captures');}});
  await assert.rejects(f.run(),/원문 확인 실패/);assert.equal(requests,1);assert.equal(captures,0);assert.equal(f.imports.length,0);assert.equal(f.jobs.length,0);
 }
});

for(const variant of ['wrong-job','wrong-offer','wrong-source','changed-source-url','null','invalid-time','invalid-content','json-string'])test(`valid JSON success with ${variant} is never healed by a receipt GET`,async()=>{
 let calls=0;const body=receipt();
 if(variant==='wrong-job')body.jobId='other';
 if(variant==='wrong-offer')body.receipt.result.offerId='813724060929';
 if(variant==='wrong-source')body.receipt.result.sourceUrl='https://detail.1688.com/offer/813724060929.html';
 if(variant==='changed-source-url')body.receipt.result.sourceUrl+='?changed=1';
 if(variant==='null')body.receipt=null;
 if(variant==='invalid-time')body.receipt.receivedAt='invalid';
 if(variant==='invalid-content')body.receipt.result.title='';
 const f=unit(async()=>{calls++;return Response.json(variant==='json-string'?'<html>not a receipt</html>':body);});
 await assert.rejects(f.run);assert.equal(calls,1);assert.equal(f.imports.length,0);assert.equal(f.jobs.length,0);
});

test('only parsed collect SOURCE_NOT_COLLECTED 422 uses explicit browser fallback and recovers its lost ACK',async()=>{
 const requests=[],capture={format:'synthetic-test-capture'};let captures=0;
 const f=unit(async(path,init)=>{
  requests.push({path,init});
  if(path.endsWith('/collect'))return Response.json({code:'SOURCE_NOT_COLLECTED',error:'현재 브라우저 확인 필요'},{status:422});
  if(path.endsWith('/browser-capture'))throw Error('capture ACK lost');
  return Response.json(receipt());
 },{captureFromBrowser:async(url,signal)=>{captures++;assert.equal(url,sourceUrl);assert.equal(signal.aborted,false);return capture;}});
 await f.run();assert.equal(captures,1);assert.equal(f.imports.length,1);
 assert.deepEqual(requests.map(item=>[item.path.split('/').at(-1),item.init.method]),[['collect','POST'],['browser-capture','POST'],['result','GET']]);
 assert.deepEqual(JSON.parse(requests[1].init.body),capture);
});

test('browser-capture explicit validation rejection never recaptures or reads around it',async()=>{
 let requests=0,captures=0;const f=unit(async()=>{requests++;return Response.json({code:'SOURCE_NOT_COLLECTED',error:'잘못된 캡처'},{status:422});},{captureFromBrowser:async()=>{captures++;return{format:'synthetic-test-capture'};}});
 await assert.rejects(f.run,/잘못된 캡처/);assert.equal(requests,2);assert.equal(captures,1);assert.equal(f.imports.length,0);assert.equal(f.jobs.length,0);
});

test('an unserializable browser capture fails before a write and cannot trigger receipt recovery',async()=>{
 let requests=0,captures=0;const capture={sourceUrl};capture.self=capture;
 const f=unit(async()=>{requests++;return Response.json({code:'SOURCE_NOT_COLLECTED'},{status:422});},{captureFromBrowser:async()=>{captures++;return capture;}});
 await assert.rejects(f.run,/circular|cyclic/u);assert.equal(requests,1);assert.equal(captures,1);assert.equal(f.imports.length,0);assert.equal(f.jobs.length,0);
});

for(const phase of ['before','post','post-body','recovery','recovery-body'])test(`abort during ${phase} stops recovery and late publication`,async()=>{
 const controller=new AbortController(),requests=[];let release,atAbort;
 if(phase==='before')controller.abort();
 const f=unit(async(path,init)=>{
  requests.push({path,init});
  if(path.endsWith('/collect')){
   if(phase==='post'){controller.abort();throw Error('aborted');}
   if(phase==='post-body')return{ok:true,status:200,json:async()=>{controller.abort();throw Error('aborted body');}};
   throw Error('ACK lost');
  }
  if(phase==='recovery')await new Promise(resolve=>release=resolve);
  if(phase==='recovery-body')return{ok:true,status:200,json:async()=>{await new Promise(resolve=>release=resolve);return receipt();}};
  return Response.json(receipt());
 },{signal:controller.signal,captureFromBrowser:async()=>assert.fail('abort cannot capture')});
 const promise=f.run();
 if(['recovery','recovery-body'].includes(phase)){
  for(let i=0;i<20&&!release;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(release);atAbort={jobs:f.jobs.length,progress:f.progress.length};controller.abort();release();
 }
 assert.equal(await promise,undefined);assert.equal(f.imports.length,0);assert.equal(f.jobs.length,0);assert.equal(f.seo.length,0);
 assert.equal(requests.length,phase==='before'?0:['post','post-body'].includes(phase)?1:2);
 if(atAbort){assert.equal(f.jobs.length,atAbort.jobs);assert.equal(f.progress.length,atAbort.progress);}
});

const tables=h=>JSON.stringify(h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,h.sqlite.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));
const objects=h=>JSON.stringify([...h.objects].map(([key,value])=>[key,Buffer.from(value).toString('base64')]));
async function localFixture(){
 const h=mobileIntakeHarness();h.sqlite.prepare("UPDATE collection_jobs SET goal='collect' WHERE id='job'").run();
 const job=await h.load('db/collection-jobs.ts').findCollectionJob('owner','job'),requests=[],jobs=[],progress=[];
 const run=(fetcher,captureFromBrowser)=>h.load('app/intake-collection.ts').collectIntakeProduct(job,{signal:new AbortController().signal,fetcher,captureFromBrowser,onJob:value=>jobs.push(value),onProgress:value=>progress.push(value)});
 return{h,job,requests,jobs,progress,run,close:()=>h.close()};
}

test('actual collect candidate is parsed locally, owner-scoped and immutable on a later retry',async()=>{
 const f=await localFixture(),{h}=f;
 try{
  const candidate={sourceUrl,scripts:[JSON.stringify({'@type':'ProductGroup',url:sourceUrl,name:'로컬 후보 원문',hasVariant:[{'@type':'Product',name:'검정',sku:'local-candidate-sku',offers:{'@type':'Offer',price:'2.99',priceCurrency:'CNY',eligibleQuantity:{minValue:1}}}]})]};
  const response=await h.route('/api/collection-jobs/job/collect',{method:'POST',body:{browserCapture:candidate}}),body=await json(response);
  assert.equal(body.receipt.result.provider,'chrome-product-jsonld-v1');assert.equal(body.receipt.result.options[0].sku,'local-candidate-sku');assert.equal(body.receipt.result.options[0].unitPriceCny,2.99);
  assert.equal(h.network.length,0);const before=tables(h),files=objects(h);
  const again=await json(await h.route('/api/collection-jobs/job/collect',{method:'POST',body:{browserCapture:{invalid:true}}}));
  assert.deepEqual(again,body);assert.equal(tables(h),before);assert.equal(objects(h),files);assert.equal(h.network.length,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_results').get().n,1);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n,0);
 }finally{f.close();}
});

for(const variant of ['network','html'])test(`actual collect receipt survives ${variant} ACK loss and imports once`,async()=>{
 const f=await localFixture(),{h}=f;
 try{
  let receiptBytes;
  const message=await f.run(async(path,init)=>{
   f.requests.push({path,method:init?.method??'GET'});const response=await h.route(path,{method:init?.method??'GET',body:init?.body});
   if(path.endsWith('/collect')){assert.equal(response.status,200);receiptBytes=JSON.stringify(h.sqlite.prepare('SELECT * FROM collection_results').all());if(variant==='network')throw Error('durable collect ACK lost');return new Response('<html>proxy body instead of acknowledgement</html>');}
   return response;
  });
  assert.match(message,/상품 추가 완료/);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM collection_results').all()),receiptBytes);
  assert.equal(f.requests.filter(item=>item.path.endsWith('/collect')).length,1);
  assert.equal(f.requests.filter(item=>item.path.endsWith('/result')).length,2,'one recovery read, then the existing importer source read');
  assert.equal(f.requests.filter(item=>item.path.endsWith('/product')).length,1);assert.equal(h.aiSources.length,0);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n,0);assert.equal(f.jobs.at(-1).product_id,h.sqlite.prepare('SELECT id FROM products').get().id);
 }finally{f.close();}
});

test('actual browser-capture durable ACK loss recovers once without recapturing or recollecting',async()=>{
 const f=await localFixture(),{h}=f;
 try{
  const read=name=>fs.readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8');
  const capture={format:'1688-public-mobile-capture-v1',sourceUrl,mobileHtml:'<script>window.__INIT_DATA='+read('1688-mobile-813724060928.json')+';</script>',skuPayload:JSON.parse(read('1688-skus-813724060928.json')),detailSource:read('1688-description-813724060928.txt')};
  let captures=0,receiptBytes;
  const message=await f.run(async(path,init)=>{
   f.requests.push({path,method:init?.method??'GET'});
   if(path.endsWith('/collect'))return Response.json({code:'SOURCE_NOT_COLLECTED',error:'합성 서버 수집 실패'},{status:422});
   const response=await h.route(path,{method:init?.method??'GET',body:init?.body});
   if(path.endsWith('/browser-capture')){assert.equal(response.status,200,await response.clone().text());receiptBytes=JSON.stringify(h.sqlite.prepare('SELECT * FROM collection_results').all());throw Error('durable browser-capture ACK lost');}
   return response;
  },async()=>{captures++;return capture;});
  assert.match(message,/상품 추가 완료/);assert.equal(captures,1);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM collection_results').all()),receiptBytes);assert.equal(h.aiSources.length,0);
  for(const action of ['collect','browser-capture','product'])assert.equal(f.requests.filter(item=>item.path.endsWith('/'+action)).length,1);
  assert.equal(f.requests.filter(item=>item.path.endsWith('/result')).length,2);assert.equal(f.requests.some(item=>item.path.endsWith('/source-supplement')),false);
 }finally{f.close();}
});

for(const variant of ['null','mismatch','unavailable'])test(`actual durable source remains untouched after ${variant} recovery`,async()=>{
 const f=await localFixture(),{h}=f;
 try{
  let durable,storedFiles;
  await assert.rejects(()=>f.run(async(path,init)=>{
   f.requests.push({path,method:init?.method??'GET'});
   if(path.endsWith('/collect')){const response=await h.route(path,{method:'POST'});assert.equal(response.status,200);durable=tables(h);storedFiles=objects(h);throw Error('lost ACK');}
   const response=await h.route(path,{method:init?.method??'GET',body:init?.body}),body=await json(response);
   if(variant==='null')body.receipt=null;if(variant==='mismatch')body.jobId='another-job';
   return Response.json(body,{status:variant==='unavailable'?503:200});
  }),/저장된 원문도 확인하지 못했습니다/);
  assert.equal(tables(h),durable);assert.equal(objects(h),storedFiles);assert.equal(f.requests.length,2);assert.equal(f.jobs.length,0);assert.equal(h.aiSources.length,0);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);
 }finally{f.close();}
});

test('a stale intake job recovers the same receipt without replacing newer saved product work',async()=>{
 const f=await localFixture(),{h}=f;
 try{
  await f.run((path,init)=>h.route(path,{method:init?.method??'GET',body:init?.body}));
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const content=await json(await h.route(base+'/content'));
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.content.revision,patch:{seo:{title:'나중에 검토한 제목',keywords:[]},assets:{main:[]}}}}));
  const view=await json(await h.route(base+'/quotation-fields'));
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:'title',optionId:null,value:'나중에 검토한 견적 제목'}]}}));
  const before=JSON.stringify(['products','product_content','product_options','product_quotation_fields','product_price_policy','collection_results','collection_context'].map(name=>[name,h.sqlite.prepare('SELECT * FROM '+name).all()])),files=objects(h),network=h.network.length;
  await f.run(async(path,init)=>{f.requests.push({path,method:init?.method??'GET'});const response=await h.route(path,{method:init?.method??'GET',body:init?.body});if(path.endsWith('/collect'))throw Error('existing receipt ACK lost');return response;});
  assert.equal(JSON.stringify(['products','product_content','product_options','product_quotation_fields','product_price_policy','collection_results','collection_context'].map(name=>[name,h.sqlite.prepare('SELECT * FROM '+name).all()])),before);
  assert.equal(objects(h),files);assert.equal(h.network.length,network);assert.equal(h.aiSources.length,0);assert.equal(f.jobs.at(-1).product_id,product.id);
  assert.equal(f.requests.filter(item=>item.path.endsWith('/collect')).length,1);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);
 }finally{f.close();}
});
