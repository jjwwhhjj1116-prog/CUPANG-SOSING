import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const colors=new Map([['亮黑','유광 검정'],['砂黑','무광 검정'],['砂灰','무광 회색']]);
const sizes=new Map([['太阳镜','선글라스'],['太阳镜 加005 盒子','선글라스 + 005 케이스']]);
const plain=value=>JSON.parse(JSON.stringify(value));
async function fixture({partial=false,ai=false}={}){
 const queries=[],actions=[],states=[],jobs=[],translations=new Map([...colors,...sizes]);
 for(const [color,colorText]of colors)for(const [size,sizeText]of sizes)translations.set(color+' / '+size,colorText+' / '+sizeText);
 const h=mobileIntakeHarness({translationFetcher:async target=>{
  const url=new URL(target),q=url.searchParams.get('q');queries.push(q);assert.equal(url.origin+url.pathname,'https://translate.googleapis.com/translate_a/single');assert.equal(url.searchParams.get('client'),'gtx');assert.ok(q.length<=5000);
  if(partial&&q.startsWith('[[YFTR'))return new Response('offline quota fixture',{status:429});
  const translate=value=>{assert.ok(translations.has(value),value);return translations.get(value);};
  const value=q.startsWith('[[YFTR')?q.split('\n').map(line=>{const match=/^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line);assert.ok(match);return match[1]+' '+translate(match[2]);}).join('\n'):translate(q);
  return Response.json([[[value,q]],null,'zh-CN']);
 }});
 try{
  await json(await h.route('/api/collection-jobs/job/collect',{method:'POST'}));
  const saved=await json(await h.route('/api/collection-jobs/job/product',{method:'POST'})),id=saved.productId,base='/api/products/'+id;
  const receipt=JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload);translations.set(receipt.title,'원문 기준 선글라스');
  const content=(await json(await h.route(base+'/content'))).content;
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'직접 검토한 기존 이름',keywords:['직접 검색어'],description:''},detail:{description:'직접 작성한 상세'},label:{manufacturer:'직접 제조사'}}}}));
  if(!ai){h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';delete h.bindings.AI;}
  const source=h.load('app/automation/translation.ts').validateTranslationSource({title:receipt.title,description:receipt.description,
   attributes:h.load('app/option-translation.ts').optionTranslationBatch((await json(await h.route(base+'/options'))).options,50).attributes,
   provenance:'manual',reference:h.load('app/sourcing.ts').collectionSourceReference('job',receipt.sourceUrl),
   category:{id:h.context.category.categoryId,path:h.context.category.categoryPath},guidance:{features:'저장된 특징 메모',keywords:'저장된 키워드'}});
  if(receipt.description)translations.set(receipt.description,'기록된 판매자 설명');
  const api=h.load('app/seo-workspace-draft.ts'),product=h.sqlite.prepare('SELECT * FROM products').get(),current=(await json(await h.route(base+'/content'))).content;
  const input={productId:id,productVersion:product.updated_at,contentRevision:current.revision,source,memo:{brand:'입력 브랜드',features:'현재 특징 검토 메모',keywords:'현재 키워드'},configuration:h.load('app/automation/translation.ts').translationConfiguration(h.bindings)};
  const state=api.createSeoWorkspaceDraftState(input);
  const fetcher=(target,init={})=>{const body=init.body?JSON.parse(init.body):undefined;if(body)actions.push(body.action);return h.route(String(target),{method:init.method??'GET',body});};
  const controls={signal:new AbortController().signal,fetcher,onState:value=>states.push(plain(value)),onJob:value=>jobs.push(value),isContextCurrent:()=>true};
  const retained=()=>JSON.stringify(['products','product_content','product_options','product_price_policy','collection_results','collection_context'].map(table=>h.sqlite.prepare('SELECT * FROM '+table).all()));
  return{h,api,state,input,controls,fetcher,queries,actions,states,jobs,id,base,retained};
 }catch(error){h.close();throw error;}
}

test('one Google draft action prepares/approves/executes once, keeps memos separate and never saves existing SEO or options',async()=>{
 const f=await fixture();try{
  const before=f.retained(),source=plain(f.input.source),result=await f.api.runSeoWorkspaceDraft(f.state,f.controls);
  assert.equal(result.job.status,'completed');assert.equal(result.label,'무료 Google 번역 초안');assert.equal(result.partial,false);assert.equal(result.closed,true);assert.equal(result.needsReview,true);
  assert.deepEqual(f.actions,['prepare','approve','execute']);assert.equal(f.queries.length,2);assert.equal(f.h.aiSources.length,0);assert.equal(f.retained(),before);
  for(const field of ['title','description','attributes','reference','category'])assert.deepEqual(plain(f.state.source[field]),source[field]);
  assert.match(f.state.source.guidance.features,/저장된 특징 메모/u);assert.match(f.state.source.guidance.features,/입력 브랜드/u);assert.match(f.state.source.guidance.features,/현재 특징 검토 메모/u);
  assert.match(f.state.source.guidance.keywords,/저장된 키워드/u);assert.match(f.state.source.guidance.keywords,/현재 키워드/u);
  assert.ok(f.queries.every(q=>!q.includes('입력 브랜드')&&!q.includes('当前特点')&&!q.includes('현재 특징')&&!q.includes('현재 키워드')),'Google must not translate guidance as supplier facts');
  assert.equal(f.state.executeSubmitted,true);assert.ok(f.states.some(state=>state.executeSubmitted),'durable client flag is published before execute');
  await f.api.refreshSeoWorkspaceDraft(f.state,f.controls);await f.api.runSeoWorkspaceDraft(f.state,f.controls);
  assert.deepEqual(f.actions,['prepare','approve','execute']);assert.equal(f.retained(),before);assert.equal(f.queries.length,2);
  assert.ok(f.h.calls.every(path=>!path.endsWith('/translation-apply')));assert.equal(f.h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{f.h.close();}
});

test('AI draft is identified separately and does not execute until its service/cost review is explicitly confirmed',async()=>{
 const f=await fixture({ai:true});try{
  const before=f.retained(),prepared=await f.api.runSeoWorkspaceDraft(f.state,f.controls);
  assert.equal(prepared.label,'AI 초안');assert.equal(prepared.job.status,'prepared');assert.equal(prepared.needsReview,true);assert.match(prepared.message,/비용/u);assert.deepEqual(f.actions,['prepare']);assert.equal(f.h.aiSources.length,0);
  const result=await f.api.runSeoWorkspaceDraft(f.state,{...f.controls,confirmAi:true});assert.equal(result.job.status,'completed');assert.equal(result.label,'AI 초안');assert.equal(f.h.aiSources.length,1);assert.equal(f.queries.length,0);assert.equal(f.retained(),before);
 }finally{f.h.close();}
});

test('a typed Google quota stop returns the received title as a partial draft and never retries pending options or applies it',async()=>{
 const f=await fixture({partial:true});try{
  const before=f.retained(),result=await f.api.runSeoWorkspaceDraft(f.state,f.controls);
  assert.equal(result.job.status,'completed');assert.equal(result.job.result.draft.title,'원문 기준 선글라스');assert.equal(result.job.result.googleStoppedHttpStatus,429);
  assert.equal(result.partial,true);assert.match(result.message,/부분 결과/u);assert.match(result.message,/HTTP 429/u);assert.equal(f.retained(),before);
  await f.api.runSeoWorkspaceDraft(f.state,f.controls);assert.equal(f.queries.length,2);assert.deepEqual(f.actions,['prepare','approve','execute']);
 }finally{f.h.close();}
});

for(const delivered of [false,true])test(`lost execute acknowledgement recovers by GET only, including ${delivered?'completed service':'unconfirmed delivery'}`,async()=>{
 const f=await fixture();try{
  const fetcher=async(target,init={})=>{
   const body=init.body?JSON.parse(init.body):{};
   if(body.action==='execute'){if(delivered)await f.fetcher(target,init);else f.actions.push('execute');throw Error('offline lost execution acknowledgement');}
   return f.fetcher(target,init);
  };
  const controls={...f.controls,fetcher},before=f.retained(),result=await f.api.runSeoWorkspaceDraft(f.state,controls);
  assert.equal(result.job.status,delivered?'completed':'approved');assert.equal(f.state.executeSubmitted,true);assert.equal(f.retained(),before);
  const recovered=f.api.parseSeoWorkspaceDraftState(JSON.stringify(f.state),f.id);assert.ok(recovered);
  await f.api.runSeoWorkspaceDraft(recovered,controls);await f.api.refreshSeoWorkspaceDraft(recovered,controls);
  assert.equal(f.actions.filter(action=>action==='execute').length,1);assert.equal(f.queries.length,delivered?2:0);
 }finally{f.h.close();}
});

test('running and later approved reads never resend an execution submitted by this action',async()=>{
 const f=await fixture();try{
  const fetcher=async(target,init={})=>{
   const body=init.body?JSON.parse(init.body):{};
   if(body.action==='execute'){
    f.actions.push('execute');f.h.sqlite.prepare("UPDATE translation_jobs SET status='running',started_at=? WHERE id=?").run(new Date().toISOString(),body.jobId);
    return Response.json({job:await f.h.load('db/translation-jobs.ts').getTranslationJob('owner',f.id,body.jobId)},{status:202});
   }return f.fetcher(target,init);
  };
  const controls={...f.controls,fetcher},result=await f.api.runSeoWorkspaceDraft(f.state,controls);assert.equal(result.job.status,'running');assert.equal(result.closed,false);
  await f.api.runSeoWorkspaceDraft(f.state,controls);f.h.sqlite.prepare("UPDATE translation_jobs SET status='approved' WHERE id=?").run(f.state.jobId);
  await f.api.runSeoWorkspaceDraft(f.state,controls);assert.equal(f.actions.filter(action=>action==='execute').length,1);assert.equal(f.queries.length,0);
 }finally{f.h.close();}
});

test('prepare response loss uses only readonly recovery, then explicit same-key confirmation creates no second job',async()=>{
 const f=await fixture();try{
  let lose=true;const fetcher=async(target,init={})=>{const body=init.body?JSON.parse(init.body):{};const reply=await f.fetcher(target,init);if(lose&&body.action==='prepare'){lose=false;throw Error('offline lost prepare acknowledgement');}return reply;};
  const controls={...f.controls,fetcher},result=await f.api.runSeoWorkspaceDraft(f.state,controls);
  assert.equal(result.job,null);assert.equal(f.state.prepareSubmitted,true);assert.equal(f.state.executeSubmitted,false);assert.deepEqual(f.actions,['prepare']);assert.equal(f.queries.length,0);
  await f.api.refreshSeoWorkspaceDraft(f.state,controls);assert.deepEqual(f.actions,['prepare']);
  const sameKey=f.state.idempotencyKey,completed=await f.api.runSeoWorkspaceDraft(f.state,controls);assert.equal(completed.job.status,'completed');assert.equal(f.state.idempotencyKey,sameKey);
  assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,1);assert.equal(f.actions.filter(action=>action==='execute').length,1);
 }finally{f.h.close();}
});

test('approval acknowledgement loss queries the durable approval and does not auto-execute',async()=>{
 const f=await fixture();try{
  let lose=true;const fetcher=async(target,init={})=>{const body=init.body?JSON.parse(init.body):{};const reply=await f.fetcher(target,init);if(lose&&body.action==='approve'){lose=false;throw Error('offline lost approval acknowledgement');}return reply;};
  const result=await f.api.runSeoWorkspaceDraft(f.state,{...f.controls,fetcher});assert.equal(result.job.status,'approved');assert.equal(f.state.executeSubmitted,false);assert.deepEqual(f.actions,['prepare','approve']);assert.equal(f.queries.length,0);
 }finally{f.h.close();}
});

test('memo/context changes after preparation or approval stop all later POSTs',async()=>{
 for(const phase of ['prepare','approve']){
  const f=await fixture();try{
   let current=true;const fetcher=async(target,init={})=>{const body=init.body?JSON.parse(init.body):{};const response=await f.fetcher(target,init);if(body.action===phase)current=false;return response;};
   await assert.rejects(f.api.runSeoWorkspaceDraft(f.state,{...f.controls,fetcher,isContextCurrent:()=>current}),/참고 입력이 변경/u);
   assert.deepEqual(f.actions,phase==='prepare'?['prepare']:['prepare','approve']);assert.equal(f.queries.length,0);
  }finally{f.h.close();}
 }
});

test('abort after submitted execute ignores the late response and keeps its no-resend flag',async()=>{
 const f=await fixture();try{
  const abort=new AbortController(),entered=Promise.withResolvers(),gate=Promise.withResolvers();
  const fetcher=async(target,init={})=>{const body=init.body?JSON.parse(init.body):{};if(body.action==='execute'){f.actions.push('execute');entered.resolve();await gate.promise;return Response.json({job:await f.h.load('db/translation-jobs.ts').getTranslationJob('owner',f.id,body.jobId)});}return f.fetcher(target,init);};
  const pending=f.api.runSeoWorkspaceDraft(f.state,{...f.controls,fetcher,signal:abort.signal});await entered.promise;const published=f.jobs.length;abort.abort();gate.resolve();await assert.rejects(pending,/중단/u);
  assert.equal(f.state.executeSubmitted,true);assert.equal(f.jobs.length,published);assert.equal(f.queries.length,0);
  await f.api.runSeoWorkspaceDraft(f.state,f.controls);assert.equal(f.actions.filter(action=>action==='execute').length,1);
 }finally{f.h.close();}
});

test('duplicate clicks and cloned session state share one synchronous request lock',async()=>{
 const f=await fixture();try{
  const entered=Promise.withResolvers(),gate=Promise.withResolvers();const fetcher=async(target,init={})=>{const body=init.body?JSON.parse(init.body):{};if(body.action==='prepare'){entered.resolve();await gate.promise;}return f.fetcher(target,init);};
  const pending=f.api.runSeoWorkspaceDraft(f.state,{...f.controls,fetcher});await entered.promise;
  await assert.rejects(f.api.runSeoWorkspaceDraft(plain(f.state),f.controls),/중복 요청/u);gate.resolve();assert.equal((await pending).job.status,'completed');assert.deepEqual(f.actions,['prepare','approve','execute']);
 }finally{f.h.close();}
});

test('wrong product/version/source/service/scope review cannot approve or execute and returns a readonly unknown state',async()=>{
 const mutations=[job=>{job.productId='foreign';},job=>{job.productVersion='2020-01-01T00:00:00Z';},job=>{job.contentRevision++;},job=>{job.review.model='foreign-model';},job=>{job.review.source.title='another source';},job=>{job.review.optionsRetry={};}];
 for(const mutate of mutations){const f=await fixture();try{
  const fetcher=async(target,init={})=>{const body=init.body?JSON.parse(init.body):{},response=await f.fetcher(target,init);if(body.action==='prepare'){const value=await response.json();mutate(value.job);return Response.json(value);}return response;};
  const result=await f.api.runSeoWorkspaceDraft(f.state,{...f.controls,fetcher});assert.equal(result.job,null);assert.deepEqual(f.actions,['prepare']);assert.equal(f.queries.length,0);assert.equal(f.state.executeSubmitted,false);
 }finally{f.h.close();}}
});

test('a job missing from bounded history or a changed service never creates a replacement execution',async()=>{
 for(const changed of ['history','configuration']){const f=await fixture({ai:true});try{
  await f.api.runSeoWorkspaceDraft(f.state,f.controls);
  const fetcher=async(target,init={})=>{const response=await f.fetcher(target,init);if(!init.body){const value=await response.json();if(changed==='history')value.jobs=[];else value.configuration.model='changed-model';return Response.json(value);}return response;};
  const result=await f.api.runSeoWorkspaceDraft(f.state,{...f.controls,fetcher,confirmAi:true});assert.equal(result.closed,false);assert.deepEqual(f.actions,['prepare']);assert.equal(f.h.aiSources.length,0);
 }finally{f.h.close();}}
});

test('unchanged saved and restored memo is included once, keeping valid long initial inputs within the server limit',async()=>{
 const f=await fixture();try{
  const source=plain(f.input.source);source.guidance={features:'저장 특징 '.repeat(220),keywords:'저장 검색어 '.repeat(220)};
  const memo={brand:'입력 브랜드',features:source.guidance.features.trim(),keywords:source.guidance.keywords.trim()};
  source.guidance.features=source.guidance.features.trim();source.guidance.keywords=source.guidance.keywords.trim();
  const state=f.api.createSeoWorkspaceDraftState({...f.input,source,memo});
  assert.equal(state.source.guidance.features.split(source.guidance.features).length,2);
  assert.equal(state.source.guidance.keywords.split(source.guidance.keywords).length,2);
  assert.ok(state.source.guidance.features.length<=2000);assert.ok(state.source.guidance.keywords.length<=2000);
  assert.ok(f.api.parseSeoWorkspaceDraftState(state,f.id));assert.equal(f.queries.length,0);
 }finally{f.h.close();}
});

test('session state parsing is exact, bounded and order-independent without relaxing request identities or submission flags',async()=>{
 const f=await fixture();try{
  assert.deepEqual(plain(f.api.parseSeoWorkspaceDraftState(JSON.stringify(f.state),f.id)),plain(f.state));
  const reordered=plain(f.state);reordered.memo={keywords:reordered.memo.keywords,features:reordered.memo.features,brand:reordered.memo.brand};reordered.configuration={maxOutputTokens:0,model:'google-translate-gtx',configured:true};assert.ok(f.api.parseSeoWorkspaceDraftState(reordered,f.id));
  for(const mutate of [state=>{state.extra=true;},state=>{state.schemaVersion=2;},state=>{state.productId='other';},state=>{state.executeSubmitted=true;},state=>{state.approvalSubmitted=true;},state=>{state.memo.brand='x'.repeat(501);},state=>{state.source.attributes.push({name:'x',value:'v'.repeat(1001)});},state=>{state.configuration.extra=true;}]){
   const state=plain(f.state);mutate(state);assert.equal(f.api.parseSeoWorkspaceDraftState(state,f.id),null);
  }
  assert.equal(f.api.parseSeoWorkspaceDraftState(JSON.stringify(f.state)+' '.repeat(96*1024),f.id),null);
  assert.throws(()=>f.api.createSeoWorkspaceDraftState({...f.input,memo:{...f.input.memo,features:'x'.repeat(2000)}}),/길이|메모|입력/u,'combined saved and current guidance must not be silently truncated');
 }finally{f.h.close();}
});
