import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';

// Synthetic offer, real handlers and in-memory SQLite. No supplier page,
// production model or existing user product is accessed by this suite.
const offerId='624000000001',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`,title='Synthetic source basket',sku='624000000010';
const companies=[{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];
function capture(){
 const main='https://cbu01.alicdn.com/624000000001-main.png',detail='https://cbu01.alicdn.com/624000000001-detail.png';
 const mobile={globalData:{offerBaseInfo:{offerId},tempModel:{offerId,offerTitle:title},offerSigns:{},detailModel:{offerId,
  detailUrl:'https://air.1688.com/detail?'+new URLSearchParams({offerId,url:'https://itemcdn.tmall.com/1688offer/Step624Synthetic'})}},
  data:{gallery:{data:{offerId,offerImgList:[main]}},attributes:{data:{offerId,propsList:[{name:'material',value:'PP'}]}}}};
 const skuPayload={ret:['SUCCESS::OK'],data:{result:{data:{offerBaseInfo:{offerId,title,picUrl:main},orderParamModel:{orderParam:{beginNum:3,skuParam:{skuPriceType:'skuPrice'}}},
  skuModel:{skuProps:[],skuInfoMap:{'':{skuId:sku,specAttrs:'',price:'12.5',canBookCount:0}}}}}}};
 return{format:'1688-public-mobile-capture-v1',sourceUrl,mobileHtml:'<script>window.__INIT_DATA='+JSON.stringify(mobile)+';</script>',skuPayload,
  detailSource:'var offer_details='+JSON.stringify({content:`<p>새로 받은 상품 원문 상세</p><img src="${detail}">`})+';'};
}
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
async function fixture(company=companies[0]){
 const h=mobileIntakeHarness(company);
 h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=?,goal=?').run(offerId,sourceUrl,'work');
 h.context.keywords='수납,바스켓';h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));
 h.bindings.AI.run=async(_model,input)=>{const source=JSON.parse(input.messages[1].content);h.aiSources.push(source);return{response:{title:'합성 수납 바스켓',description:'이전 원문으로 만든 설명',keywords:['수납'],warnings:[],
  attributes:source.attributes.map((pair,sourceIndex)=>({sourceIndex,name:pair.name.startsWith('option:')?'옵션명':pair.name.replace('상품속성: ',''),value:pair.name.startsWith('option:')?'단일 바스켓':pair.value}))}};};
 const source={schemaVersion:1,sourceUrl,provider:'public-product-jsonld-v1',collectedAt:new Date().toISOString(),title,description:'',
  options:[{sku,name:title,unitPriceCny:12.5,minimumOrder:3,stock:0}],images:[]};
 await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body:source}));
 const {productId}=await json(await h.route('/api/collection-jobs/job/product',{method:'POST'})),base='/api/products/'+productId;
 const post=(path,body)=>h.route(base+path,{method:'POST',body});
 async function execute(prepared){
  let job=prepared.job;job=(await json(await post('/translation',{action:'approve',jobId:job.id,reviewFingerprint:job.review.fingerprint,confirmPaid:true}))).job;
  job=(await json(await post('/translation',{action:'execute',jobId:job.id}))).job;assert.equal(job.status,'completed');return job;
 }
 const job=await execute(await json(await post('/translation',{action:'prepare-collected',intake:true}),201));
 const product=()=>h.sqlite.prepare('SELECT * FROM products').get();
 const preview=(scope='all')=>post('/translation-apply',{action:'preview',jobId:job.id,expectedVersion:product().updated_at,...(scope==='options'?{scope}:{})});
 const supplement=()=>h.route('/api/collection-jobs/job/source-supplement',{method:'POST',body:{capture:capture(),expectedProductVersion:product().updated_at}});
 const snapshot=()=>JSON.stringify({content:h.sqlite.prepare('SELECT * FROM product_content').get(),options:h.sqlite.prepare('SELECT * FROM product_options').get(),jobs:h.sqlite.prepare('SELECT * FROM translation_jobs').all()});
 return{h,source,base,job,post,execute,product,preview,supplement,snapshot};
}

for(const company of companies)test(`a supplemented canonical SEO result cannot preview or apply facts from its older source (${company.companyCode})`,async()=>{
 const f=await fixture(company),{h}=f;
 try{
  const oldPlan=await json(await f.preview());assert.ok(oldPlan.preview.some(row=>row.name==='상품 설명'&&row.after==='이전 원문으로 만든 설명'));
  await json(await f.supplement());const before=f.snapshot();
  const resume=await json(await f.post('/translation',{action:'prepare-collected',intake:true}));assert.equal(resume.intakeSourceChanged,true);
  const blocked=await json(await f.preview(),409);assert.match(blocked.error,/원문.*변경|새.*번역|다시.*준비/);
  const applied=await json(await f.post('/translation-apply',{action:'apply',jobId:f.job.id,expectedVersion:f.product().updated_at,fingerprint:oldPlan.fingerprint}),409);
  assert.match(applied.error,/원문.*변경|새.*번역|다시.*준비/);assert.equal(f.snapshot(),before);
  assert.equal(h.aiSources.length,1);assert.deepEqual(h.network,[]);assert.equal(h.objects.size,0);
 }finally{h.close();}
});

for(const company of companies)test(`an unchanged canonical source can fill pending options while preserving edited SEO, notice blanks and prices (${company.companyCode})`,async()=>{
 const f=await fixture(company),{h}=f;
 try{
  const content=(await json(await h.route(f.base+'/content'))).content;
  await json(await h.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'검토한 수납 상품',description:'',keywords:[]},label:{material:''}}}}));
  const view=await json(await h.route(f.base+'/options')),rows=h.load('app/product-options.ts').optionInputs(view.options);
  rows[0].unitCostCny=8;rows[0].unitsPerPack=2;
  await json(await h.route(f.base+'/options',{method:'PATCH',body:{expectedRevision:view.options.revision,expectedProductVersion:view.productVersion,rows}}));
  const plan=await json(await f.preview());assert.ok(plan.preview.some(row=>row.name.includes('옵션명')));assert.ok(!plan.preview.some(row=>['상품명','상품 설명','검색어'].includes(row.name)));
  await json(await f.post('/translation-apply',{action:'apply',jobId:f.job.id,expectedVersion:f.product().updated_at,fingerprint:plan.fingerprint}));
  const saved=(await json(await h.route(f.base+'/content'))).content,options=(await json(await h.route(f.base+'/options'))).options.rows;
  assert.equal(saved.seo.title.value,'검토한 수납 상품');assert.equal(saved.seo.description.value,'');assert.deepEqual(saved.seo.keywords.value,[]);assert.equal(saved.label.material.value,'');
  assert.equal(options[0].unitCostCny,8);assert.equal(options[0].unitsPerPack,2);assert.equal(options[0].translatedName,'단일 바스켓');assert.equal(options[0].supplierSku,sku);
  assert.equal(h.aiSources.length,1);assert.deepEqual(h.network,[]);
 }finally{h.close();}
});

function appendWithoutClock(f){
 const {h}=f,original=JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload),captured=h.load('app/browser-product-capture.ts').parseBrowserProductCapture(capture(),sourceUrl),
  merged=h.load('app/collection-source-supplement.ts').supplementCollectionSource(original,captured);
 // Isolate receipt proof from product clocks: model a same-clock/legacy writer
 // with a validated immutable base and capture, only in this synthetic database.
 h.sqlite.prepare('INSERT INTO collection_source_supplements VALUES(?,?,?,?,?,?)').run('job','owner',JSON.stringify(original),JSON.stringify(captured),JSON.stringify(merged),new Date().toISOString());
}

for(const company of companies)test(`the exact effective receipt is checked inside the save transaction even when a concurrent append leaves product clocks unchanged (${company.companyCode})`,async()=>{
 const f=await fixture(company),{h}=f;
 try{
  const plan=await json(await f.preview()),before=f.snapshot(),clock=f.product().updated_at;
  const prepare=h.db.prepare.bind(h.db),batch=h.db.batch.bind(h.db);let injected=false;
  h.db.prepare=sql=>Object.assign(prepare(sql),{fixtureSql:sql});
  h.db.batch=async statements=>{if(!injected&&statements[0]?.fixtureSql?.startsWith('UPDATE products SET updated_at=')){injected=true;appendWithoutClock(f);}return batch(statements);};
  const saved=await json(await f.post('/translation-apply',{action:'apply',jobId:f.job.id,expectedVersion:clock,fingerprint:plan.fingerprint}),409);
  assert.match(saved.error,/변경|다시 검토/);assert.equal(injected,true);assert.equal(f.product().updated_at,clock);assert.equal(f.snapshot(),before);
  assert.equal((await h.load('db/collection-results.ts').readCollectionResult('owner','job')).result.description,'새로 받은 상품 원문 상세');
  assert.equal(h.aiSources.length,1);assert.deepEqual(h.network,[]);
 }finally{h.close();}
});

test('a same-version canonical source still rejects an effective receipt that changed before preview',async()=>{
 const f=await fixture(),{h}=f;
 try{const clock=f.product().updated_at;appendWithoutClock(f);const before=f.snapshot();const response=await json(await f.preview(),409);
  assert.match(response.error,/원문.*변경|새.*번역|다시.*준비/);assert.equal(f.product().updated_at,clock);assert.equal(f.snapshot(),before);assert.deepEqual(h.network,[]);
 }finally{h.close();}
});

test('options-only canonical adoption remains scoped to exact pending option originals after unrelated supplier detail enrichment',async()=>{
 for(const changedName of [false,true]){
  const f=await fixture(),{h}=f;
  try{
   await json(await f.supplement());
   if(changedName){const view=await json(await h.route(f.base+'/options')),rows=h.load('app/product-options.ts').optionInputs(view.options);rows[0].originalName='수동으로 바꾼 다른 원문';
    await json(await h.route(f.base+'/options',{method:'PATCH',body:{expectedRevision:view.options.revision,expectedProductVersion:view.productVersion,rows}}));}
   const before=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
   const response=await f.preview('options');
   if(changedName){assert.equal(response.status,409);continue;}
   const plan=await json(response);assert.equal(plan.scope,'options');assert.ok(plan.preview.every(row=>row.name.includes('옵션명')));
   await json(await f.post('/translation-apply',{action:'apply',scope:'options',jobId:f.job.id,expectedVersion:f.product().updated_at,fingerprint:plan.fingerprint}));
   const after=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
   assert.deepEqual(after.seo,before.seo);assert.deepEqual(after.label,before.label);assert.equal(h.aiSources.length,1);assert.deepEqual(h.network,[]);
  }finally{h.close();}
 }
});

test('a new user-supplied translation request remains independent of an older canonical receipt',async()=>{
 const f=await fixture(),{h}=f;
 try{
  await json(await f.supplement());
  const source={title:'Manual source title',description:'Manual source description',attributes:[],provenance:'manual',reference:'Explicit user supplied text'};
  const job=await f.execute(await json(await f.post('/translation',{action:'prepare',expectedVersion:f.product().updated_at,idempotencyKey:'manual-source-624',source}),201));
  const request={jobId:job.id,expectedVersion:f.product().updated_at},plan=await json(await f.post('/translation-apply',{action:'preview',...request}));
  assert.ok(plan.preview.length>0);await json(await f.post('/translation-apply',{action:'apply',...request,fingerprint:plan.fingerprint}));
  assert.equal(h.aiSources.length,2);assert.deepEqual(h.network,[]);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,2);
 }finally{h.close();}
});

test('image-only enrichment preserves canonical text coverage without regenerating or losing its exact receipt guard',async()=>{
 for(const company of companies){const f=await fixture(company),{h}=f;
  try{
   const raw=capture(),mobile=JSON.parse(raw.mobileHtml.slice('<script>window.__INIT_DATA='.length,-';</script>'.length));
   mobile.data.attributes.data.propsList=[];raw.mobileHtml='<script>window.__INIT_DATA='+JSON.stringify(mobile)+';</script>';
   raw.detailSource='var offer_details='+JSON.stringify({content:'<img src="https://cbu01.alicdn.com/624000000001-detail.png">'})+';';
   await json(await h.route('/api/collection-jobs/job/source-supplement',{method:'POST',body:{capture:raw,expectedProductVersion:f.product().updated_at}}));
   const plan=await json(await f.preview());assert.ok(plan.preview.some(row=>row.name==='상품 설명'));
   await json(await f.post('/translation-apply',{action:'apply',jobId:f.job.id,expectedVersion:f.product().updated_at,fingerprint:plan.fingerprint}));
   assert.equal(h.aiSources.length,1);assert.equal((await h.load('db/collection-results.ts').readCollectionResult('owner','job')).result.description,'');assert.deepEqual(h.network,[]);
  }finally{h.close();}
 }
});

for(const company of companies)test(`a recorded generic-category company cannot be borrowed after changing the approved company (${company.companyCode})`,async()=>{
 const f=await fixture(company),{h}=f;
 try{
  const other=companies.find(value=>value.companyCode!==company.companyCode),before=f.snapshot();
  h.setCompany({code:other.companyCode,name:other.companyName});
  const response=await json(await f.preview(),409);assert.match(response.error,/회사/);assert.equal(f.snapshot(),before);
  assert.equal(h.aiSources.length,1);assert.deepEqual(h.network,[]);
 }finally{h.close();}
});

test('legacy generic intake with no recorded company retains its existing valid source rather than inventing company evidence',async()=>{
 const f=await fixture({...companies[0],capturedCompany:false}),{h}=f;
 try{
  assert.equal(Object.hasOwn(h.context,'company'),false);const plan=await json(await f.preview());assert.ok(plan.preview.length>0);
  await json(await f.post('/translation-apply',{action:'apply',jobId:f.job.id,expectedVersion:f.product().updated_at,fingerprint:plan.fingerprint}));
  assert.equal(Object.hasOwn(JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_context').get().payload),'company'),false);
  assert.equal(h.aiSources.length,1);assert.deepEqual(h.network,[]);
 }finally{h.close();}
});

for(const company of companies)test(`shared source reader protects explicit SEO prepare, approval, claim and application after a company change (${company.companyCode})`,async()=>{
 for(const phase of ['prepare','approve','claim','apply']){
  const calls=[],f=await fixture({...company,translationFetcher:async url=>{calls.push(String(url));return Response.json([[['합성 수납 바스켓',title,null,null]],null,'en']);}}),{h}=f;
  try{
   h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';delete h.bindings.AI;
   let prepared;
   if(phase!=='prepare')prepared=await json(await f.post('/translation',{action:'prepare-seo-retry',expectedVersion:f.product().updated_at,retryKey:crypto.randomUUID()}),201);
   if(phase==='claim')await json(await f.post('/translation',{action:'approve',jobId:prepared.job.id,reviewFingerprint:prepared.job.review.fingerprint,confirmPaid:true}));
   let plan;
   if(phase==='apply'){
    prepared.job=await f.execute(prepared);
    plan=await json(await f.post('/translation-apply',{action:'preview',jobId:prepared.job.id,expectedVersion:f.product().updated_at}));
   }
   const before=f.snapshot(),requests=calls.length,other=companies.find(value=>value.companyCode!==company.companyCode);
   h.setCompany({code:other.companyCode,name:other.companyName});
   const response=phase==='prepare'?await f.post('/translation',{action:'prepare-seo-retry',expectedVersion:f.product().updated_at,retryKey:crypto.randomUUID()})
    :phase==='approve'?await f.post('/translation',{action:'approve',jobId:prepared.job.id,reviewFingerprint:prepared.job.review.fingerprint,confirmPaid:true})
     :phase==='claim'?await f.post('/translation',{action:'execute',jobId:prepared.job.id})
      :await f.post('/translation-apply',{action:'apply',jobId:prepared.job.id,expectedVersion:f.product().updated_at,fingerprint:plan.fingerprint});
   const rejected=await json(response,409);assert.ok(rejected.error);if(phase==='prepare')assert.equal(rejected.code,'COLLECTION_COMPANY_MISMATCH');
   assert.equal(f.snapshot(),before);assert.equal(calls.length,requests,'changing the company cannot invoke a new translation provider request');
   assert.ok(h.network.every(host=>host==='translate.googleapis.com'),'all translation HTTP is intercepted local fixture data');
  }finally{h.close();}
 }
});
