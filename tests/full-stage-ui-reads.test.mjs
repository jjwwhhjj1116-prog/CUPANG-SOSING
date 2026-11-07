import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {stageDOM,repo} from './helpers/cold-price-main-dom.mjs';
const {mobileIntakeHarness}=await import(pathToFileURL(path.join(repo,'tests/helpers/mobile-intake.mjs')).href),packet=process.env.FULL_STAGE_UI_EVIDENCE_DIR??null;
const sourceOverrides=process.env.FULL_STAGE_BEFORE?new Map(JSON.parse(fs.readFileSync(path.join(process.env.FULL_STAGE_BEFORE,'before-hashes.json'),'utf8')).files.map(({path:relative})=>[relative,fs.readFileSync(path.join(process.env.FULL_STAGE_BEFORE,'before',relative),'utf8')])):undefined;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const gate=()=>{let resolve;return{promise:new Promise(done=>resolve=done),resolve:()=>resolve()};};

test('the registration source disclosure reads only on first open in each workspace',async()=>{
 const {seoWorkspaceHarness}=await import('./helpers/seo-workspace.mjs');
 const api=seoWorkspaceHarness(),sourceUrl='https://detail.1688.com/offer/999999990016.html',product={...api.product,source_url:sourceUrl},sourceReads=[];
 let h;
 try{
  h=await stageDOM(async(url,init={})=>{
   assert.equal(init.method??'GET','GET');
   if(url==='/api/products')return Response.json({products:[product]});
   if(url==='/api/settings')return Response.json({settings:null,scope:{ownerId:'owner',company:null}});
   if(url==='/api/category-profiles')return Response.json({profiles:[]});
   if(url==='/api/collection-jobs')return Response.json({jobs:[]});
   if(url===`/api/products/${product.id}/translation-source`){
    sourceReads.push(init);
    return Response.json({productId:product.id,sourceUrl,sourceGaps:[],requestContext:{categoryId:'991234',categoryPath:['합성 분류']}});
   }
   return Response.json({error:'unexpected synthetic request'},{status:404});
  },{components:{'product-source-context':true}});
  const Dashboard=h.load('app/components/dashboard-client.tsx').default;
  await h.render(Dashboard,{userName:'합성 테스트',workspaceOwnerId:'owner'});
  const openProduct=async()=>{await h.React.act(async()=>h.records.get('registration-board').onOpen(product,'SEO'));await h.settle();};
  const setOpen=async(selector,open)=>{
   const disclosure=h.container.querySelector(selector);assert.ok(disclosure);
   await h.React.act(async()=>{disclosure.open=open;disclosure.dispatchEvent(new h.window.Event('toggle'));});
   await h.settle();
  };
  await openProduct();
  assert.equal(sourceReads.length,0,'a closed source menu must not read the product');
  await setOpen('.registration-context-menu',true);
  assert.equal(sourceReads.length,0,'opening the outer menu does not open the source disclosure');
  await setOpen('.registration-source-context',true);
  assert.equal(sourceReads.length,1);
  assert.equal(sourceReads[0].cache,'no-store');
  assert.match(h.container.querySelector('.product-source-context').textContent,/합성 분류/);
  await setOpen('.registration-source-context',false);
  assert.equal(sourceReads[0].signal.aborted,false,'closing the menu must not unmount its source operations');
  await setOpen('.registration-source-context',true);
  assert.equal(sourceReads.length,1);
  await h.React.act(async()=>h.container.querySelector('[aria-label="상품 작업 공간 닫기"]').click());
  await h.settle();
  assert.equal(sourceReads[0].signal.aborted,true);
  await openProduct();
  assert.equal(sourceReads.length,1,'the next drawer starts with an unopened source disclosure');
 }finally{if(h)await h.close();api.close();}
});

for(const required of [true,false])test(`actual schema-driven ${required?'eight':'seven'} ordinary stages share full UI DTOs while size and label proofs stay native`,async()=>{
 const api=mobileIntakeHarness(),calls=[],gates=[];let h,phase='setup';
 try{
  const {sizeChartSnapshot,companies:schemaCompanies}=await import('./helpers/supplier-hub-single-size-chart.mjs'),snapshot=sizeChartSnapshot(schemaCompanies.find(company=>company.code==='A01464742')),raw=JSON.parse(snapshot.schemaString);
  api.context.category.categoryId=snapshot.categoryId;api.context.category.categoryPath=snapshot.categoryPath;
  raw.properties.imagePage.properties.images.required=required?['sizeChartImage']:[];
  api.context.category.hubSchema={...snapshot,categoryPath:api.context.category.categoryPath,schemaString:JSON.stringify(raw)};
  api.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(api.context),'job');await api.intake();
  const product=await api.load('db/queries.ts').findProduct('owner',api.latest.product_id),base='/api/products/'+product.id,options=await api.load('db/product-options.ts').readProductOptions('owner',product.id),focusedOptionId=options.rows.find(row=>row.included).id;
  const layoutResponse=await api.route(base+'/registration-layout'),layout=await layoutResponse.json();assert.equal(layoutResponse.status,200);assert.equal(layout.sizeChartRequired,required);
  const nav=api.load('app/registration-navigation.ts'),stages=[...nav.registrationStepsForLayout(layout)];assert.equal(stages.length,required?8:7);assert.equal(stages.includes('사이즈표'),required);
  const unchanged=JSON.stringify(Object.fromEntries(['products','product_content','product_options','product_quotation_fields'].map(table=>[table,api.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));
  const actual=['seo-workspace-generator','seo-workspace-editor','option-seo-editor','product-content-editor','product-options-editor','option-main-image-editor','option-quotation-prices','option-price-table','option-image-editor','detail-image-batch-panel','product-label-editor','size-chart-workspace','quotation-panel','quotation-fields-editor','option-label-editor'];
  h=await stageDOM(async(url,init={})=>{
   url=String(url);const parsed=new URL(url,'https://app.test'),resource=parsed.pathname===base?'product':parsed.pathname.startsWith(base+'/')?parsed.pathname.slice(base.length+1):null,stack=new Error().stack;
   const proof=stack.includes('readCurrentProductLabelResult')?'label-result':stack.includes('readProductLabelReferences')?'label-references':stack.includes('snapshot (app/components/size-chart-workspace')?'size-snapshot':null;
   const call={phase,url,resource,proof,stack,method:init.method??'GET',cache:init.cache,finished:false};calls.push(call);init.signal?.addEventListener('abort',()=>{call.aborted=true;call.abortAfterFinish=call.finished;},{once:true});assert.equal(call.method,'GET');
   try{
    const response=parsed.pathname===base?await api.load('app/api/products/[id]/route.ts').GET(new Request(parsed),{params:Promise.resolve({id:product.id})}):parsed.pathname.startsWith(base+'/')?await api.route(url):await api.load('app'+parsed.pathname+'/route.ts').GET(new Request(parsed));call.status=response.status;
    assert.equal(response.status,200,JSON.stringify({url,body:await response.clone().json()}));
    if(['content','options','quotation-fields'].includes(resource)){call.hash=hash(await response.clone().json());const wait=gate();gates.push(wait);await wait.promise;}
    return response;
   }catch(cause){call.error=String(cause);throw cause;}finally{call.finished=true;}
  },{components:Object.fromEntries(actual.map(name=>[name,true])),sourceOverrides});
  const Detail=h.load('app/components/dashboard-client.tsx').DetailPanel,props={product,workspaceOwnerId:'owner',focusedOptionId,settings:api.settings,uiReadScope:{company:schemaCompanies.find(company=>company.code==='A01464742'),settingsEpoch:0,profileEpoch:0,profileCatalog:{}},onSaved(){assert.fail('read-only navigation cannot save');},onUpload(){assert.fail('no upload');},onSavePrice:async()=>assert.fail('no price write'),onManageCategories(){},onProfileSelected(){},onBeforeFreeImageApply:()=>true,onBeforeSeoGenerate:()=>true,onPrepareSubmission(){},onReviewPackaging(){},onReceiptSaved(){}};
  async function drain(){let quiet=0,last=-1;for(let i=0;i<100;i++){await h.React.act(async()=>gates.forEach(item=>item.resolve()));await h.settle();if(calls.every(call=>call.finished)&&calls.length===last)quiet++;else quiet=0;last=calls.length;if(quiet===3)return;}assert.fail('unsettled '+phase+' '+JSON.stringify(calls.filter(call=>!call.finished)));}
  for(const stage of stages){phase=stage;await h.render(Detail,{...props,tab:stage});await drain();}
  assert.deepEqual(calls.filter(call=>call.error),[]);assert.ok(h.container.querySelector('.quotation-fields'));assert.equal(h.container.querySelector('.quotation-fields').getAttribute('aria-busy'),'false');
  const ordinary=calls.filter(call=>!call.proof),counts=Object.fromEntries(['content','options','quotation-fields'].map(resource=>[resource,ordinary.filter(call=>call.resource===resource).length]));
  const abortedProofs=calls.filter(call=>call.proof&&call.aborted).map(({proof,resource,abortAfterFinish})=>({proof,resource,abortAfterFinish}));
  const sizeProof=calls.filter(call=>call.proof==='size-snapshot').map(call=>call.resource),labels=calls.filter(call=>call.proof==='label-references'&&!call.aborted).map(call=>call.resource),labelResult=calls.filter(call=>call.proof==='label-result').map(call=>call.resource);
  assert.deepEqual(sizeProof,required?['product','content','product']:[],'native size attestation is separate from cached ordinary content');
  assert.deepEqual(labels,['product-labels','quotation-fields','product-labels'],'reference choices retain their complete three-read proof');assert.equal(JSON.parse(product.image_keys).some(key=>/\/quotation-label-[a-f0-9]{64}\.png$/.test(key)),false);assert.deepEqual(labelResult,[],'no canonical generated PNG exists, so its receipt path is not claimed as exercised');
  assert.ok(calls.every(call=>call.cache==='no-store'));assert.equal(JSON.stringify(Object.fromEntries(['products','product_content','product_options','product_quotation_fields'].map(table=>[table,api.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]))),unchanged);
  if(packet)fs.writeFileSync(path.join(packet,`logical-${stages.length}-current-evidence.json`),JSON.stringify({layout,stages,counts,sizeProof,labelReferenceProofs:labels,labelResultProof:labelResult,abortedProofs,calls,actualModules:actual,limits:'Offline genuine API DTOs and actual stage consumers. Synthetic schema contract selects size requirement; no commercial category/PNG/native/Hub execution or wire-time claim.'},null,2)+'\n');
  assert.deepEqual(counts,{content:1,options:1,'quotation-fields':1});
 }finally{gates.forEach(item=>item.resolve());if(h)await h.close();api.close();}
});

test('R10 actual focused SEO→price→main→quotation first views share one genuine full DTO per exact URL',async()=>{
 const api=mobileIntakeHarness(),calls=[],gates=[],bodies=new Map();let h,phase='setup';
 try{
  await api.intake();const product=await api.load('db/queries.ts').findProduct('owner',api.latest.product_id),options=await api.load('db/product-options.ts').readProductOptions('owner',product.id),focusedOptionId=options.rows.find(row=>row.included).id,base='/api/products/'+product.id,unchanged=JSON.stringify(api.sqlite.prepare('SELECT * FROM products WHERE id=?').get(product.id));
  const modules=['seo-workspace-generator','seo-workspace-editor','option-seo-editor','product-content-editor','product-options-editor','option-main-image-editor','option-quotation-prices','option-price-table','quotation-panel','quotation-fields-editor','option-label-editor'];
  h=await stageDOM(async(url,init={})=>{
   url=String(url);assert.equal(init.method??'GET','GET','ordinary stage visits do not write');const parsed=new URL(url,'https://app.test'),resource=parsed.pathname===base?'product':parsed.pathname.startsWith(base+'/')?parsed.pathname.slice(base.length+1):null,request={phase,url,resource,method:init.method??'GET',cache:init.cache,finished:false,aborted:false,stack:new Error().stack};calls.push(request);init.signal?.addEventListener('abort',()=>{request.aborted=true;request.abortAfterFinish=request.finished;},{once:true});
   try{const response=parsed.pathname===base?await api.load('app/api/products/[id]/route.ts').GET(new Request(parsed),{params:Promise.resolve({id:product.id})}):parsed.pathname.startsWith(base+'/')?await api.route(url,{method:'GET'}):await api.load('app'+parsed.pathname+'/route.ts').GET(new Request(parsed)),body=await response.clone().json();request.status=response.status;assert.equal(response.status,200,JSON.stringify({url,body}));
   if(['content','options','quotation-fields'].includes(resource)){const old=bodies.get(url);if(old)assert.equal(hash(body),old.hash,'same exact-URL unchanged full API DTO');else bodies.set(url,{body,hash:hash(body)});request.hash=hash(body);const wait=gate();gates.push({phase:request.phase,wait});await wait.promise;}
   return response;}catch(cause){request.error=cause instanceof Error?cause.message:String(cause);throw cause;}finally{request.finished=true;}
  },{components:Object.fromEntries(modules.map(name=>[name,true])),sourceOverrides});
  const Detail=h.load('app/components/dashboard-client.tsx').DetailPanel,props={product,workspaceOwnerId:'owner',focusedOptionId,settings:api.settings,uiReadScope:{company:{code:'A01464742',name:'와이홉'},settingsEpoch:0,profileEpoch:0,profileCatalog:{}},onSaved(){throw Error('navigation cannot save');},onUpload(){throw Error('no upload');},onSavePrice:async()=>{throw Error('no price write');},onManageCategories(){},onProfileSelected(){},onBeforeFreeImageApply:()=>true,onBeforeSeoGenerate:()=>true,onPrepareSubmission(){},onReviewPackaging(){},onReceiptSaved(){}};
  async function drain(){let quiet=0,last=-1;for(let i=0;i<80;i++){await h.React.act(async()=>{for(const item of gates.filter(item=>item.phase===phase))item.wait.resolve();});await h.settle();const count=calls.length,pending=calls.some(call=>call.phase===phase&&!call.finished);if(!pending&&count===last)quiet++;else quiet=0;last=count;if(quiet>=3)return;}assert.fail('actual initial stage requests settled: '+phase);}
  for(const stage of ['SEO','가격','대표 이미지','견적서']){phase=stage;await h.render(Detail,{...props,tab:stage});await drain();await drain();}
  const errors=calls.filter(call=>call.error);if(errors.length&&packet)fs.writeFileSync(path.join(packet,'initial-diagnostic.json'),JSON.stringify({errors,calls,text:h.container.textContent.slice(-3500)},null,2)+'\n');assert.deepEqual(errors.map(({url,status,error})=>({url,status,error})),[],'all actual fixture endpoints must complete before counting duplicates');
  assert.ok(h.container.querySelector('[aria-label="SEO 상품명"]'),'actual common SEO editor retained');assert.ok(h.container.querySelector('[aria-label="최종 대표이미지 옵션"]'),'actual main-image editor mounted');assert.ok(h.container.querySelector('.quotation-fields'),'actual fields child mounted');assert.equal(h.container.querySelector('.quotation-fields').getAttribute('aria-busy'),'false');assert.ok(h.container.querySelector('[data-stub="option-label-editor"]')===null,'collapsed notice reader is actual');assert.equal(JSON.stringify(api.sqlite.prepare('SELECT * FROM products WHERE id=?').get(product.id)),unchanged);
  const quoteCounts=Object.fromEntries([...bodies.keys()].filter(url=>url.includes('/quotation-fields')).map(url=>[url,calls.filter(call=>call.url===url&&!call.phase.startsWith('proof:')).length]));
  const ordinary={content:calls.filter(call=>call.resource==='content').length,options:calls.filter(call=>call.resource==='options').length,quotationByExactUrl:quoteCounts};
  phase='proof:size';await h.render(h.load('app/components/size-chart-workspace.tsx').SizeChartWorkspace,{productId:product.id,version:product.updated_at,active:true});await drain();assert.deepEqual(calls.filter(call=>call.phase===phase).map(call=>call.resource),['product','content','product']);
  phase='proof:label';await h.render(h.load('app/components/product-label-editor.tsx').ProductLabelReferenceEditor,{productId:product.id,version:product.updated_at,active:true});await drain();assert.deepEqual(calls.filter(call=>call.phase===phase).map(call=>call.resource),['product-labels','quotation-fields','product-labels']);
  const evidence={basis:'Root-provided R10 3a080769d7c1a8cfb299e22484ba77792f920126',scenario:'actual focused first SEO→price→main→quotation, all same owner/company/version and no edits',actualModules:modules,ordinary,fullResponseHashes:Object.fromEntries([...bodies].map(([url,value])=>[url,value.hash])),calls,proofPolicy:'Size3 and label-reference3 remain fresh native calls. Native/PNG/unknown/save paths are not executed by this read-only scenario and are not counted as removed.',limitations:'Bounded 4 initial views, not complete 1–8/live totals; global background inbox and hidden activation/input-gate changes are outside this task; optional size step does not become an 8-stage completion claim.'};if(packet)fs.writeFileSync(path.join(packet,'initial-current-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
  assert.deepEqual(ordinary,{content:1,options:1,quotationByExactUrl:Object.fromEntries(Object.keys(quoteCounts).map(url=>[url,1]))},'same-episode first views still duplicate genuine full content/options/quote');
 }finally{for(const item of gates)item.wait.resolve();if(h)await h.close();api.close();}
});
