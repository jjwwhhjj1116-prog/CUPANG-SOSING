import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const native=createRequire(import.meta.url),companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
const payload=(h,table)=>JSON.parse(h.sqlite.prepare('SELECT payload FROM '+table).get().payload);
const product=h=>h.sqlite.prepare('SELECT * FROM products').get();
const preserved=h=>JSON.stringify(['products','product_content','product_options','product_price_policy','collection_results','collection_context','translation_jobs'].map(table=>h.sqlite.prepare('SELECT * FROM '+table).all()));

// Actual intake component, queue helper, collection and translation routes, and
// SQLite. Authentication, supplier/image bytes and Google HTTP are fixtures.
async function fixture(company,goal='work',providerFailure=true,translationResponse){
 let googleCalls=0;const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,translationFetcher:(target,init)=>{googleCalls++;return translationResponse?.(target,init)??new Response('upstream fixture body is private',{status:429});}});
 try{
  if(providerFailure)h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';
  const categoryPath=['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'];
  const hubSchema={format:'supplier-hub-schema-v1',categoryId:'69900',categoryPath,company,observedAt:Date.now(),inputBindings:'couplus-paths-v1',settingsInitialization:'couplus-options-v1',draftInitialization:'couplus-required-v1',metadata:{displayCategoryCode:'69900',kanCategoryId:2624,scopeType:'Retail_Categorized_Single',noticeNumber:4,version:188},schemaString:JSON.stringify({type:'object',properties:{startPage:{type:'object',properties:{productName:{type:'string',title:'상품명'}}},productPage:{type:'object',properties:{brand:{type:'string',title:'브랜드'}}},legalPage:{type:'object',properties:{}}}})};
  const profile=(await json(await h.load('app/api/category-profiles/route.ts').POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'선글라스 초안',categoryId:'69900',categoryPath,hubSchema,template:null,mappings:[]})})),201)).profile;
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));h.sqlite.prepare('UPDATE collection_jobs SET goal=?').run(goal);await h.load('db/queries.ts').saveSettings('owner',JSON.stringify(h.settings));
  const calls=[],opened=[],busy=[],slots=[],cleanups=[];let cursor=0,first=true,rows=[{...h.load('app/intake-queue.ts').intakeRow(profile,'row'),url:h.sourceUrl,keywords:h.context.keywords}],jobs=[];
  let intercept=null;
  const request=async(path,init={})=>{
   calls.push({path,method:init.method??'GET',body:typeof init.body==='string'?JSON.parse(init.body):null});
   if(intercept){const response=await intercept(path,init);if(response)return response;}
   if(path==='/api/collection-jobs')return h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test'+path,init));
   return h.route(path,{method:init.method??'GET',body:init.body});
  };
  const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(fn){if(first){const cleanup=fn();if(cleanup)cleanups.push(cleanup);}}};
  const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/intake-queue-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,crypto,fetch:request,require(name){
   if(name==='react')return hooks;if(name==='@/app/components/category-picker')return{CategoryPicker:()=>null};if(name==='@/app/components/intake-quotation-preview')return{IntakeQuotationPreview:()=>null};
   return name.startsWith('@/')?h.load(name.slice(2)+'.ts'):native(name);
  }});
  function render(){cursor=0;const tree=exports.IntakeQueuePanel({rows,jobs,settings:h.settings,profiles:[profile],goal,onGoal(){},onSettingsReloaded(){},onRows:update=>rows=update(rows),onProfile(){},onAdvanced(){},onJobs:values=>jobs=values,onBusy:value=>busy.push(value),onOpenProduct:async(id,signal)=>{
   assert.equal(signal.aborted,false);const body=await json(await h.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test/api/products/'+id),{params:Promise.resolve({id})}));
   const content=await json(await h.route('/api/products/'+id+'/content')),options=await json(await h.route('/api/products/'+id+'/options')),quotation=await json(await h.route('/api/products/'+id+'/quotation-fields'));
   opened.push({product:body.product,content:content.content,options:options.options,quotation});
  }});first=false;return tree;}
  const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node).includes(label));
  async function start(){const node=button('시작 (');assert.equal(node.props.disabled,false);node.props.onClick();const deadline=Date.now()+20000;while(busy.at(-1)!==false){render();if(Date.now()>deadline)throw Error('Intake UI timeout');await new Promise(resolve=>setTimeout(resolve,1));}render();}
  return{h,calls,opened,busy,render,button,start,get rows(){return rows;},get googleCalls(){return googleCalls;},set intercept(value){intercept=value;},restorePending(){rows=rows.map(row=>({...row,status:'draft',message:'',productId:undefined}));},close(){cleanups.forEach(fn=>fn());h.close();}};
 }catch(error){h.close();throw error;}
}

for(const [index,company]of companies.entries())test(`Google 429 keeps an editable source draft, opens stages 1–7 and cannot recreate or translate it on resume (${company.code})`,async()=>{
 const f=await fixture(company,index?'price':'work');const {h}=f;try{
  await f.start();
  assert.equal(f.rows[0].status,'saved','confirmed source/image import is a saved manual draft, not a failed intake');
  assert.match(f.rows[0].message,/번역 미완료/);assert.match(f.rows[0].message,/HTTP 429/);assert.doesNotMatch(f.rows[0].message,/upstream fixture|생성해 반영/);
  assert.equal(f.opened.length,1,'one URL should immediately open its actual editable product');assert.equal(f.opened[0].product.id,product(h).id);
  assert.equal(f.opened[0].options.rows.length,6);assert.equal(h.objects.size,19);assert.equal(h.stats.maxDownloads,3);assert.equal(f.googleCalls,1);
  assert.equal(f.opened[0].quotation.resolved.schema.categoryId,'69900');assert.equal(f.opened[0].quotation.categoryContext.profileId,h.context.category.id);
  assert.ok(f.opened[0].quotation.resolved.rows.filter(row=>row.included).every(row=>Number(row.fields.supplyPrice.value)>0));
  assert.ok(f.opened[0].options.rows.every(row=>row.provenance.translatedName!=='translated'));assert.equal(product(h).supplier_hub_status,'미전송');
  assert.equal(payload(h,'product_content').assets.main.value.length,index?0:1);
  const failed=h.sqlite.prepare('SELECT * FROM translation_jobs').get();assert.equal(failed.status,'failed');assert.equal(failed.result,null);assert.match(failed.error,/HTTP 429/);
  assert.equal(f.calls.filter(call=>call.body?.action==='execute').length,1);assert.equal(f.calls.filter(call=>call.path.endsWith('/translation-apply')).length,0);
  assert.equal(f.button('시작 (').props.disabled,true,'saved source is not offered as another pending collect');

  const base='/api/products/'+product(h).id,content=payload(h,'product_content'),options=payload(h,'product_options');
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'',description:'',keywords:[]},label:{material:''},labelClears:['material'],assets:{main:[],additional:[],detail:[]}}}}));
  const inputs=h.load('app/product-options.ts').optionInputs(options);inputs[0].included=false;inputs[1].translatedName='직접 검토한 옵션';inputs[1].imageKey=null;
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:options.revision,expectedProductVersion:product(h).updated_at,rows:inputs}}));
  const imageKeys=JSON.parse(product(h).image_keys),removed=imageKeys.at(-1);
  await json(await h.load('app/api/products/[id]/route.ts').PATCH(new Request('https://app.test'+base,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedVersion:product(h).updated_at,image_keys:JSON.stringify(imageKeys.slice(0,-1))})}),{params:Promise.resolve({id:product(h).id})}));
  const before=preserved(h);f.restorePending();await f.start();
  assert.equal(f.rows[0].status,'saved');assert.match(f.rows[0].message,/번역 미완료/);assert.equal(f.opened.length,2);assert.equal(f.googleCalls,1);
  assert.equal(f.calls.filter(call=>call.body?.action==='prepare-intake-options').length,0);assert.equal(f.calls.filter(call=>call.body?.action==='execute').length,1);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_jobs').get().n,1);assert.equal(preserved(h),before);
  assert.equal(f.opened[1].content.seo.title.value,'');assert.equal(f.opened[1].content.seo.title.provenance,'manual');assert.deepEqual(f.opened[1].content.seo.keywords.value,[]);assert.equal(f.opened[1].options.rows[0].included,false);
  assert.deepEqual(f.opened[1].content.assets.main.value,[]);assert.equal(f.opened[1].content.assets.main.provenance,'manual');assert.equal(f.opened[1].options.rows[1].imageKey,null);assert.ok(!JSON.parse(product(h).image_keys).includes(removed));assert.equal(h.stats.downloads,19,'resuming never downloads or restores the removed original');
 }finally{f.close();}
});

test('Google failure never hides image import failure, source failure, lost execution acknowledgement or an apply CAS conflict',async()=>{
 for(const mode of ['image','source','execute-ack','apply-conflict']){
  const f=await fixture(companies[0],'price',mode!=='apply-conflict');try{
   if(mode==='image')f.h.stats.failImageIndex=4;
   if(mode==='source')f.intercept=path=>path.endsWith('/collect')?Response.json({error:'원문 시험 오류'},{status:422}):null;
   if(mode==='execute-ack')f.intercept=async(path,init)=>{if(path.endsWith('/translation')&&JSON.parse(init.body).action==='execute'){await f.h.route(path,{method:'POST',body:init.body});throw Error('번역 실행 응답 시험 유실');}return null;};
   if(mode==='apply-conflict')f.intercept=path=>path.endsWith('/translation-apply')?Response.json({error:'초안 반영 시험 충돌'},{status:409}):null;
   await f.start();assert.equal(f.rows[0].status,'error',mode);assert.equal(f.opened.length,0,mode);
   if(mode==='image'){assert.ok(product(f.h));assert.equal(f.h.objects.size,18);assert.equal(f.googleCalls,1);assert.match(f.rows[0].message,/이미지/);}
   if(mode==='source'){assert.equal(product(f.h),undefined);assert.equal(f.googleCalls,0);assert.match(f.rows[0].message,/원문 시험 오류/);}
   if(mode==='apply-conflict'){assert.ok(product(f.h));assert.equal(f.h.aiSources.length,1);assert.match(f.rows[0].message,/초안 반영 시험 충돌/);}
   if(mode==='execute-ack'){assert.match(f.rows[0].message,/번역 실행 응답 시험 유실/);assert.equal(f.googleCalls,1);f.intercept=null;f.restorePending();await f.start();assert.equal(f.rows[0].status,'saved');assert.equal(f.opened.length,1);assert.equal(f.googleCalls,1);}
  }finally{f.close();}
 }
});

test('an acknowledged running job can resolve to the same saved Google failure without another execute or apply',async()=>{
 const f=await fixture(companies[0],'price');try{
  f.intercept=async(path,init)=>{
   if(path.endsWith('/translation')&&init.method==='POST'&&JSON.parse(init.body).action==='execute'){
    const body=await json(await f.h.route(path,{method:'POST',body:init.body}));
    assert.equal(body.job.status,'failed');
    return Response.json({...body,job:{...body.job,status:'running',result:null,error:null,finishedAt:null}},{status:202});
   }
   return null;
  };
  await f.start();
  assert.equal(f.rows[0].status,'saved');assert.match(f.rows[0].message,/번역 미완료/);assert.equal(f.opened.length,1);
  assert.equal(f.calls.filter(call=>call.path.endsWith('/translation')&&call.method==='GET').length,1);
  assert.equal(f.calls.filter(call=>call.body?.action==='execute').length,1);assert.equal(f.googleCalls,1);
  assert.equal(f.calls.filter(call=>call.path.endsWith('/translation-apply')).length,0);
  const before=preserved(f.h);f.intercept=null;f.restorePending();await f.start();
  assert.equal(f.rows[0].status,'saved');assert.equal(f.opened.length,2);assert.equal(f.googleCalls,1);
  assert.equal(f.calls.filter(call=>call.body?.action==='execute').length,1);assert.equal(preserved(f.h),before);
 }finally{f.close();}
});

test('a completed initial draft plus a Google options-only quota stop keeps a reusable partial draft after image saves',async()=>{
 let failOptions=false;
 const f=await fixture(companies[0],'price',true,target=>failOptions?new Response('upstream fixture body is private',{status:429})
  :Response.json([[['원문 기준 선글라스',new URL(target).searchParams.get('q'),null,null]],null,'zh-CN']));try{
  let seeded=false;
  f.intercept=(path,init)=>{
   if(path.endsWith('/translation')&&init.method==='POST'){
    const body=JSON.parse(init.body);
    if(body.action==='prepare-collected'&&!seeded){
     // A synthetic full attribute budget leaves all six recorded SKU rows for
     // a separate options-only batch, without extending the shared harness.
     const receipt=payload(f.h,'collection_results');receipt.attributes=Array.from({length:50},(_,index)=>({name:'검토 속성 '+index,value:'검토 원문'}));
     f.h.sqlite.prepare('UPDATE collection_results SET payload=?').run(JSON.stringify(receipt));seeded=true;
    }
    if(body.action==='prepare-intake-options')failOptions=true;
   }
   return null;
  };
  await f.start();
  assert.equal(f.rows[0].status,'saved');assert.match(f.rows[0].message,/검토 필요/);assert.equal(f.opened.length,1);
  const jobs=f.h.sqlite.prepare('SELECT * FROM translation_jobs ORDER BY created_at,id').all();assert.equal(jobs.length,2);
  const initial=jobs.find(job=>job.idempotency_key==='intake-auto-v1'),options=jobs.find(job=>job.idempotency_key.startsWith('intake-options-'));
  assert.equal(initial.status,'completed');assert.equal(options.status,'completed');assert.equal(options.error,null);
  assert.equal(JSON.parse(options.result).googleStoppedHttpStatus,429);assert.equal(JSON.parse(options.result).draft.attributes.length,0);
  assert.equal(f.h.aiSources.length,0);const googleCalls=f.googleCalls;assert.ok(googleCalls>=2);assert.equal(f.opened[0].options.rows.length,6);
  assert.ok(f.opened[0].options.rows.every(row=>row.provenance.translatedName!=='translated'));
  assert.equal(f.calls.filter(call=>call.body?.action==='execute').length,2);
  assert.ok(f.calls.filter(call=>call.body?.action==='apply').every(call=>call.body.jobId===initial.id&&call.body.scope===undefined));
  assert.ok(f.calls.some(call=>call.body?.action==='preview'&&call.body.jobId===options.id&&call.body.scope==='options'));
  // Image import advances the product clock. The acknowledged partial result
  // remains reviewable and reusable without requesting the service again.
  const before=preserved(f.h),callCount=f.calls.length;f.restorePending();await f.start();
  assert.equal(f.rows[0].status,'saved');assert.match(f.rows[0].message,/검토 필요/);assert.equal(f.opened.length,2);
  assert.equal(f.h.aiSources.length,0);assert.equal(f.googleCalls,googleCalls);assert.equal(f.calls.filter(call=>call.body?.action==='execute').length,2);
  assert.equal(f.calls.slice(callCount).filter(call=>call.body?.action==='apply').length,0);
  assert.equal(preserved(f.h),before);assert.equal(product(f.h).supplier_hub_status,'미전송');
 }finally{f.close();}
});

for(const company of companies)for(const status of [429,503])test(`Google HTTP ${status} in description stops later automatic option batches despite retained Korean attributes (${company.code})`,async()=>{
 const f=await fixture(company,'price',true,target=>new URL(target).searchParams.get('q').startsWith('太阳眼镜')
  ?Response.json([[['원문 기준 선글라스',new URL(target).searchParams.get('q'),null,null]],null,'zh-CN'])
  :new Response('private limit body',{status,headers:{'retry-after':'3600'}}));try{
  let seeded=false;
  f.intercept=(path,init)=>{
   if(path.endsWith('/translation')&&init.method==='POST'&&JSON.parse(init.body).action==='prepare-collected'&&!seeded){
    const receipt=payload(f.h,'collection_results');receipt.attributes=Array.from({length:50},(_,index)=>({name:'검토 속성 '+index,value:'확인한 값'}));receipt.description='原文说明';
    f.h.sqlite.prepare('UPDATE collection_results SET payload=?').run(JSON.stringify(receipt));seeded=true;
   }
   return null;
  };
  await f.start();
  assert.equal(f.calls.filter(call=>call.body?.action==='prepare-intake-options').length,0,'a service stop cannot start another automatic request batch');
  assert.equal(f.calls.filter(call=>call.body?.action==='execute').length,1);assert.equal(f.googleCalls,2);
  assert.equal(f.rows[0].status,'saved');assert.match(f.rows[0].message,new RegExp(`HTTP ${status}.*중단|중단.*HTTP ${status}`));assert.equal(f.opened.length,1);
  assert.ok(f.opened[0].options.rows.every(row=>row.provenance.translatedName!=='translated'));
  const saved=f.h.sqlite.prepare('SELECT * FROM translation_jobs').get();assert.equal(saved.status,'completed');assert.equal(JSON.parse(saved.result).googleStoppedHttpStatus,status);assert.equal(JSON.parse(saved.result).draft.attributes.length,50);
  const before=preserved(f.h);f.restorePending();await f.start();assert.equal(f.rows[0].status,'saved');assert.equal(f.opened.length,2);assert.equal(f.googleCalls,2);
  assert.equal(f.calls.filter(call=>call.body?.action==='prepare-intake-options').length,0);assert.equal(f.calls.filter(call=>call.body?.action==='execute').length,1);assert.equal(preserved(f.h),before);
 }finally{f.close();}
});

test('historical warnings, foreign-provider markers and malformed statuses cannot become Google stop evidence',async()=>{
 const h=mobileIntakeHarness();try{
  const version='2026-10-06T00:00:00Z',prepare=h.load('app/intake-seo.ts').prepareIntakeSeoOutcome;
  const job={id:'job',productId:'product',productVersion:version,contentRevision:0,status:'completed',review:{destination:'Google 번역',model:'google-translate-gtx',instructionsVersion:'sourceflow-translation-v6',source:{attributes:[]}},result:{model:'google-translate-gtx',draft:{title:'한국어 상품',description:'',keywords:[],attributes:[],warnings:['Google 번역 HTTP 429 응답으로 남은 요청을 중단했습니다.']}}};
  for(const change of [value=>value,value=>({...value,review:{...value.review,destination:'Cloudflare Workers AI'},result:{...value.result,googleStoppedHttpStatus:429}}),
   value=>({...value,review:{...value.review,instructionsVersion:'sourceflow-translation-v5'},result:{...value.result,googleStoppedHttpStatus:429}}),
   value=>({...value,result:{...value.result,model:'other-model',googleStoppedHttpStatus:429}}),
   value=>({...value,result:{...value.result,googleStoppedHttpStatus:'429'}}),value=>({...value,result:{...value.result,googleStoppedHttpStatus:400}})]){
   const current=change(job),actions=[];
   const result=await prepare('product',async(path,init)=>{
    const body=JSON.parse(init.body);actions.push(body.action);
    if(path.endsWith('/translation-apply'))return Response.json({productId:'product',productVersion:version,preview:[],fingerprint:'a'.repeat(64)});
    return body.action==='prepare-intake-options'?Response.json({done:true,productId:'product',productVersion:version}):Response.json({job:current,autoDraft:true,productVersion:version});
   },new AbortController().signal);
   assert.equal(result.completed,true);assert.equal(result.reviewRequired,false);assert.equal(actions.filter(action=>action==='prepare-intake-options').length,1);
  }
 }finally{h.close();}
});

test('a saved Google failure cannot hide a failed, foreign-product or unprepared work image-draft acknowledgement',async()=>{
 for(const mode of ['http','product','prepared']){
  const f=await fixture(companies[0],'work');try{
   let before;
   f.intercept=path=>{
    if(!path.endsWith('/image-draft'))return null;
    assert.equal(f.h.sqlite.prepare('SELECT status FROM translation_jobs').get().status,'failed');
    before=preserved(f.h);
    return mode==='http'?Response.json({error:'이미지 초안 시험 오류'},{status:503})
     :Response.json({productId:mode==='product'?'other':product(f.h).id,prepared:mode!=='prepared'});
   };
   await f.start();
   assert.equal(f.rows[0].status,'error',mode);assert.equal(f.opened.length,0,mode);assert.match(f.rows[0].message,/이미지 초안/,mode);
   assert.equal(f.googleCalls,1);assert.equal(f.h.objects.size,19);assert.equal(preserved(f.h),before);
   assert.equal(f.calls.filter(call=>call.path.endsWith('/translation-apply')).length,0);
   f.intercept=null;f.restorePending();await f.start();
   assert.equal(f.rows[0].status,'saved',mode);assert.match(f.rows[0].message,/번역 미완료/,mode);assert.equal(f.opened.length,1,mode);
   assert.equal(f.googleCalls,1);assert.equal(f.calls.filter(call=>call.body?.action==='execute').length,1);
   assert.equal(payload(f.h,'product_content').assets.main.value.length,1);
   const recovered=preserved(f.h);f.restorePending();await f.start();assert.equal(preserved(f.h),recovered);
   assert.equal(f.googleCalls,1);assert.equal(product(f.h).supplier_hub_status,'미전송');
  }finally{f.close();}
 }
});

test('manual draft outcome accepts only an acknowledged Google terminal failure, never pending, uncertain, foreign-provider or CAS errors',async()=>{
 const h=mobileIntakeHarness();try{
  const failed={id:'job',productId:'product',productVersion:'2026-10-06T00:00:00Z',contentRevision:1,status:'failed',result:null,error:{code:'GOOGLE_TRANSLATION_FAILED',message:'Google 번역 HTTP 429',mayHaveBeenCharged:false},startedAt:'2026-10-06T00:00:00Z',finishedAt:'2026-10-06T00:00:01Z',review:{destination:'Google 번역',model:'google-translate-gtx',instructionsVersion:'sourceflow-translation-v6'}};
  const prepare=h.load('app/intake-seo.ts').prepareIntakeSeoOutcome;
  const cases=[{job:failed,expected:true},...['prepared','approved','running','uncertain','unknown'].map(status=>({job:{...failed,status},expected:false})),
   ...[{result:{}},{finishedAt:null},{startedAt:'invalid'},{error:null},{productId:'other'},
    {review:{...failed.review,destination:'Cloudflare Workers AI'}},{review:{...failed.review,destination:'OpenAI Responses API'}},
    {review:{...failed.review,model:'other-model'}},{review:{...failed.review,instructionsVersion:'sourceflow-translation-v5'}}].map(patch=>({job:{...failed,...patch},expected:false})),
   {job:failed,status:409,expected:false},{job:failed,status:503,expected:false}];
  for(const {job,status=200,expected}of cases){let requests=0;const result=await prepare('product',async()=>{requests++;return Response.json({job,autoDraft:false,error:'검토 충돌'},{status});},new AbortController().signal);assert.equal(result.manualReady,expected,JSON.stringify({status,jobStatus:job.status,review:job.review}));assert.equal(result.completed,false);assert.equal(result.reviewRequired,false);assert.equal(requests,1);}
 }finally{h.close();}
});
