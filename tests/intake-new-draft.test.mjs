import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url),companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const text=t=>Array.isArray(t)?t.map(text).join(''):t&&typeof t==='object'?text(t.props?.children):t==null?'':String(t);
function fixture(company,{lost=false,failCollect=false,matchingOldContext=false,fresh=false}={}){
 const modules=new Map(),slots=[],effects=[],layouts=[],calls=[],collections=[],selectedCaptures=[],opened=[],busy=[],jobs=[];let cursor=0,owner='owner-'+company.code,created,paused=false,resolvePreview,props;
 const effect=(queue,fn,deps)=>{const i=cursor++,old=slots[i];if(!old||!deps||deps.some((value,index)=>!Object.is(value,old.deps[index]))){const next={deps,cleanup:old?.cleanup};slots[i]=next;queue.push(()=>{old?.cleanup?.();next.cleanup=fn();});}};
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,value=>slots[i].value=typeof value==='function'?value(slots[i].value):value];},useRef(value){const i=cursor++;return slots[i]??(slots[i]={current:value});},useEffect(fn,deps){effect(effects,fn,deps);},useLayoutEffect(fn,deps){effect(layouts,fn,deps);}};
 function load(file){if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,URL,URLSearchParams,Date,AbortController,crypto,queueMicrotask,setTimeout,clearTimeout,fetch:fetcher,require(name){if(name==='react')return hooks;if(name==='@/app/components/category-picker')return{CategoryPicker:()=>null};if(name==='@/app/components/collection-result-panel')return{CollectionResultPanel:()=>null};if(name==='@/app/components/intake-quotation-preview')return{IntakeQuotationPreview:()=>null};if(name==='@/app/intake-collection')return{collectIntakeProduct:async(job,options)=>{collections.push(job);selectedCaptures.push(options.selectedCapture);if(failCollect){failCollect=false;throw Error('합성 이미지 처리 오류');}options.onJob(job);return'새 상품 초안 작성됨';}};if(name==='@/app/browser-product-bridge')return{capture1688FromChrome:()=>assert.fail('stored original does not capture a browser product')};if(name.startsWith('@/'))return load(name.slice(2)+'.ts');if(name.startsWith('./')||name.startsWith('../'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');return native(name);}});return exports;}
 const settings=load('app/workspace-settings.ts').savedRegistrationSettings({brand:company.name,exchangeRate:350});
 const profile={id:'00000000-0000-0000-0000-000000000634',revision:2,categoryId:'80719',categoryPath:['검수용','새 양식'],template:{name:'synthetic-official.xlsx'},hubSchema:{company}};
 let rows=[{id:'r',profile,url:'https://detail.1688.com/offer/634000000001.html',features:'검수 특징',keywords:'검수 키워드',status:'draft',message:''}];
 const capture={format:'yoofam-saved-page-capture-v1',sourceUrl:rows[0].url,captureId:'63400000-0000-4000-8000-000000000001',fingerprint:'c'.repeat(64),revision:2},sourceSeed=fresh?{id:'fresh-capture-seed',sourceUrl:rows[0].url,title:'새 수집 상품',sourceCapture:capture,forkJobId:'63400000-0000-4000-8000-000000000002'}:undefined;
 if(fresh)rows[0]={...rows[0],status:'saved',productId:'old-product',message:'기존 작업 보존'};
 const active=()=>rows.find(row=>row.forkJobId)??rows[0];
 const preview=()=>({format:'collection-new-draft-v1',executionStarted:false,baseFingerprint:'a'.repeat(64),source:{jobId:fresh?sourceSeed.forkJobId:'old-job',productId:'old-product',sourceUrl:active().url,offerId:'634000000001',company,collectedAt:'2026-10-01T00:00:00.000Z',receivedAt:'2026-10-01T00:00:01.000Z',productVersion:'2026-10-02T00:00:00.000Z',contentRevision:2,optionRevision:1,quotationRevision:1,imageCount:fresh?3:0},target:{profileId:profile.id,profileRevision:profile.revision,categoryId:profile.categoryId,categoryPath:profile.categoryPath,category:profile,goal:'price',features:active().features,keywords:active().keywords,settings,...(fresh?{sourceCapture:capture}:{})},warnings:['이전 원문 수집 시각을 유지합니다.']});
 async function fetcher(url,init={}){
  calls.push({url,method:init.method??'GET',body:init.body?JSON.parse(init.body):undefined});
  if(url==='/api/collection-jobs')return Response.json({jobs:[{id:'old-job',product_id:'old-product',source_url:rows[0].url,offer_id:'634000000001',status:'awaiting_connector',...(matchingOldContext?{context:{category:profile,features:rows[0].features,keywords:rows[0].keywords}}:{})}],preservedRequests:[{differences:['카테고리·견적서 설정']}]});
  if(url.includes('/new-draft')&&init.method==='POST'){
   const request=JSON.parse(init.body),plan=preview();created={format:'collection-new-draft-created-v1',requestId:request.requestId,baseFingerprint:plan.baseFingerprint,executionStarted:false,reused:false,source:{jobId:plan.source.jobId,productId:plan.source.productId,collectedAt:plan.source.collectedAt},productId:'new-product',job:{id:request.requestId,product_id:'new-product',source_url:plan.source.sourceUrl,offer_id:plan.source.offerId,goal:plan.target.goal,status:'awaiting_connector',context:{category:profile,settings,company,features:plan.target.features,keywords:plan.target.keywords,forkedFrom:{kind:'stored-source-new-draft-v1',sourceJobId:plan.source.jobId,sourceProductId:plan.source.productId,baseFingerprint:plan.baseFingerprint,requestId:request.requestId,collectedAt:plan.source.collectedAt,...(fresh?{sourceCapture:capture}:{})}}}};
   if(lost){lost=false;throw Error('합성 응답 유실');}return Response.json(created,{status:201});
  }
  if(url.includes('requestId='))return Response.json({...created,reused:true});
  if(paused)return new Promise(resolve=>{resolvePreview=()=>resolve(Response.json(preview()));});
  return Response.json(preview());
 }
 const Component=load('app/components/intake-queue-panel.tsx').IntakeQueuePanel;
 const render=()=>{cursor=0;props={rows,settings,workspaceOwnerId:owner,profiles:[],jobs,sourceSeed,goal:'price',onGoal(){},onRows:update=>rows=update(rows),onProfile(){},onAdvanced(){},onJobs:values=>jobs.push(...values),onBusy:value=>busy.push(value),onSettingsReloaded(){},onOpenProduct:async id=>opened.push(id)};const tree=Component(props);layouts.splice(0).forEach(fn=>fn());effects.splice(0).forEach(fn=>fn());return tree;};
 const idle=async()=>{for(let i=0;i<30;i++){render();await new Promise(resolve=>setImmediate(resolve));}};
 const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node).includes(label));
 render();return{calls,collections,selectedCaptures,opened,busy,load,preview,render,button,profile,capture,sourceSeed,get rows(){return rows;},async click(label){const node=button(label);assert.ok(node&&!node.props.disabled,label);node.props.onClick();await idle();},async idle(){await idle();},pause(){paused=true;},release(){resolvePreview();},owner(value){owner=value;render();},close(){slots.forEach(slot=>slot?.cleanup?.());}};
}

for(const company of companies)test(`a fresh capture selects a category then explicitly forks without enqueueing or changing its saved same-URL product (${company.code})`,async()=>{
 const f=fixture(company,{fresh:true});try{const before=JSON.stringify(f.rows[0]);assert.equal(f.calls.length,0);const picker=nodes(f.render()).find(node=>typeof node.props?.onSelected==='function');assert.ok(picker);picker.props.onSelected(f.profile);await f.idle();
  assert.equal(f.rows.length,2);assert.equal(JSON.stringify(f.rows[0]),before);const fresh=f.rows[1];assert.equal(fresh.status,'error');assert.equal(fresh.forkJobId,f.sourceSeed.forkJobId);assert.deepEqual(JSON.parse(JSON.stringify(fresh.sourceCapture)),f.capture);
  assert.equal(f.button('이 상품 초안 작성'),undefined);const batch=f.button('시작 (');assert.equal(batch.props.disabled,true);batch.props.onClick();await f.idle();assert.equal(f.calls.length,0,'ordinary start cannot enqueue a fork row');
  nodes(f.render()).find(node=>node.props?.['aria-label']==='2번째 특징').props.onChange({target:{value:'새 수집본 설명'}});assert.equal(f.rows[1].forkJobId,f.sourceSeed.forkJobId);assert.equal(f.rows[1].status,'error');
  await f.click('새 수집본으로 별도 초안 작성');assert.equal(f.calls.length,1);assert.deepEqual(JSON.parse(new URL(f.calls[0].url,'https://app.test').searchParams.get('sourceCapture')),f.capture);assert.equal(f.calls[0].method,'GET');assert.match(text(f.render()),/사진 3개/);
  const action=f.button('새 초안 생성').props.onClick;action();action();await f.idle();assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.deepEqual(f.calls.find(call=>call.method==='POST').body.sourceCapture,f.capture);assert.ok(f.calls.every(call=>call.url!=='/api/collection-jobs'));
  assert.equal(JSON.stringify(f.rows[0]),before);assert.equal(f.rows[1].productId,'new-product');assert.deepEqual(f.opened,['new-product']);assert.equal(f.collections.length,1);assert.ok(f.selectedCaptures.every(value=>value===undefined),'new fork already owns its source receipt; never import onto the old job with selectedCapture');
 }finally{f.close();}
});

test('fresh-capture input, preview and creation acknowledgements reject another capture, revision, fingerprint or source mode',async()=>{
 const f=fixture(companies[0],{fresh:true});try{
  nodes(f.render()).find(node=>typeof node.props?.onSelected==='function').props.onSelected(f.profile);await f.idle();
  const model=f.load('app/intake-new-draft.ts'),row=f.rows[1],preview=f.preview(),settings=preview.target.settings,signal=new AbortController().signal;
  assert.deepEqual(JSON.parse(JSON.stringify(model.intakeNewDraftInput(row,'price').sourceCapture)),f.capture);
  for(const patch of [{captureId:'63400000-0000-4000-8000-000000000009'},{fingerprint:'d'.repeat(64)},{revision:3},{sourceUrl:'https://detail.1688.com/offer/634000000009.html'},{format:'yoofam-saved-query-capture-v1'}]){
   const sourceCapture={...f.capture,...patch};assert.notEqual(model.intakeNewDraftInputKey({...row,sourceCapture},'price',settings),model.intakeNewDraftInputKey(row,'price',settings));
   await assert.rejects(model.previewIntakeNewDraft(row,'price',settings,signal,async()=>Response.json({...preview,target:{...preview.target,sourceCapture}})));
  }
  await assert.rejects(model.previewIntakeNewDraft(row,'price',settings,signal,async()=>Response.json({...preview,target:{...preview.target,sourceCapture:undefined}})));
  assert.throws(()=>model.intakeNewDraftInput({...row,sourceCapture:{...f.capture,format:'yoofam-saved-query-capture-v1'}},'price'));
  assert.throws(()=>model.intakeNewDraftInput({...row,pendingSourceMode:'pending-source-urls-v1',pendingSourceHash:'b'.repeat(64)},'price'));
  const created=await model.createIntakeNewDraft(preview,crypto.randomUUID(),signal);
  for(const sourceCapture of [undefined,{...f.capture,revision:3},{...f.capture,captureId:'63400000-0000-4000-8000-000000000009'}])assert.throws(()=>model.validateIntakeNewDraftCreated({...created,job:{...created.job,context:{...created.job.context,forkedFrom:{...created.job.context.forkedFrom,sourceCapture}}}},preview,created.requestId));
  assert.equal(f.collections.length,0);assert.equal(f.opened.length,0);
 }finally{f.close();}
});
for(const company of companies)test(`new draft is explicitly reviewed and created from retained source, then opens only its new product (${company.code})`,async()=>{
 const f=fixture(company);try{await f.click('시작 (');assert.equal(f.rows[0].status,'error');assert.equal(f.rows[0].forkJobId,'old-job');assert.equal(f.collections.length,0);assert.equal(f.calls.length,1);
  await f.click('저장 원문으로 새 초안');assert.equal(f.calls.filter(call=>call.method==='POST').length,1,'preview sends no creation request');assert.match(text(f.render()),/2026-10-01T00:00:00/);assert.match(text(f.render()),/기존 상품의 수정 내용과 전송 기록은 보존/);
  const clicked=f.button('새 초안 생성').props.onClick;clicked();clicked();await f.idle();
  assert.equal(f.calls.filter(call=>call.url.includes('/new-draft')&&call.method==='POST').length,1);assert.equal(f.collections.length,1);assert.equal(f.collections[0].product_id,'new-product');assert.deepEqual(f.opened,['new-product']);assert.equal(f.rows[0].status,'saved');assert.equal(f.rows[0].productId,'new-product');assert.equal(f.rows[0].url,'https://detail.1688.com/offer/634000000001.html');assert.ok(!f.collections.some(job=>job.id==='old-job'));
 }finally{f.close();}
});
test('a settings or goal conflict offers an explicit new draft while the matching previous product remains reviewable',async()=>{
 const f=fixture(companies[0],{matchingOldContext:true});try{await f.click('시작 (');assert.ok(f.button('초안 확인·수정'));assert.ok(f.button('저장 원문으로 새 초안'));await f.click('저장 원문으로 새 초안');await f.click('새 초안 생성');assert.deepEqual(f.opened,['new-product']);assert.ok(!f.collections.some(job=>job.id==='old-job'));}finally{f.close();}
});
for(const company of companies)test(`uncertain creation is recovered read-only by the same request ID; partial draft resumes without creation (${company.code})`,async()=>{
 const f=fixture(company,{lost:true,failCollect:true});try{await f.click('시작 (');await f.click('저장 원문으로 새 초안');await f.click('새 초안 생성');assert.equal(f.collections.length,0);assert.ok(f.button('새 초안 저장 결과 확인'));
  await f.click('새 초안 저장 결과 확인');assert.equal(f.rows[0].productId,'new-product');assert.equal(f.rows[0].status,'error');assert.ok(f.button('새 초안 작성 이어가기'));await f.click('새 초안 작성 이어가기');
  const writes=f.calls.filter(call=>call.url.includes('/new-draft')&&call.method==='POST'),reads=f.calls.filter(call=>call.url.includes('requestId='));assert.equal(writes.length,1);assert.equal(reads.length,1);assert.equal(new URL(reads[0].url,'https://app.test').searchParams.get('requestId'),writes[0].body.requestId);assert.equal(f.collections.length,2);assert.ok(f.collections.every(job=>job.id===writes[0].body.requestId));assert.deepEqual(f.opened,['new-product']);assert.equal(f.rows[0].status,'saved');
 }finally{f.close();}
});
for(const company of companies)test(`scope changes and input edits invalidate new-draft confirmation without POST or stale callbacks (${company.code})`,async()=>{
 for(const scenario of ['owner','edit']){const f=fixture(company);try{await f.click('시작 (');if(scenario==='owner'){f.pause();f.button('저장 원문으로 새 초안').props.onClick();await f.idle();f.owner('another-owner');f.release();await f.idle();assert.equal(f.button('새 초안 생성'),undefined);assert.equal(f.rows[0].productId,undefined);assert.deepEqual(f.busy,[true,false,true,false]);}
  else{await f.click('저장 원문으로 새 초안');const old=f.button('새 초안 생성').props.onClick;nodes(f.render()).find(node=>node.props?.['aria-label']==='1번째 특징').props.onChange({target:{value:'변경한 특징'}});old();await f.idle();assert.equal(f.button('새 초안 생성'),undefined);assert.equal(f.rows[0].features,'변경한 특징');}
  assert.equal(f.calls.filter(call=>call.url.includes('/new-draft')&&call.method==='POST').length,0);assert.equal(f.collections.length,0);assert.deepEqual(f.opened,[]);
 }finally{f.close();}}
});
test('new-draft client rejects mismatched source, target, settings and creation acknowledgements',async()=>{
 const f=fixture(companies[0]);try{await f.click('시작 (');const model=f.load('app/intake-new-draft.ts'),original=f.preview(),row=f.rows[0],settings=original.target.settings;
  for(const changed of [{...original,executionStarted:true},{...original,source:{...original.source,sourceUrl:'https://detail.1688.com/offer/2.html'}},{...original,source:{...original.source,contentRevision:-1}},{...original,target:{...original.target,category:{...original.target.category,revision:3}}}])await assert.rejects(model.previewIntakeNewDraft(row,'price',settings,new AbortController().signal,async()=>Response.json(changed)));
  await assert.rejects(model.previewIntakeNewDraft(row,'price',settings,new AbortController().signal,async()=>Response.json({...original,target:{...original.target,settings:{...settings,exchangeRate:351}}})),/기본설정/);
  assert.throws(()=>model.intakeNewDraftInput(row,'transmit'));
  const requestId=crypto.randomUUID(),created=await model.createIntakeNewDraft(original,requestId,new AbortController().signal);
  for(const context of [{...created.job.context,company:companies[1]},{...created.job.context,forkedFrom:{...created.job.context.forkedFrom,collectedAt:'2026-10-02T00:00:00.000Z'}},{...created.job.context,forkedFrom:undefined}])assert.throws(()=>model.validateIntakeNewDraftCreated({...created,job:{...created.job,context}},original,requestId));
 }finally{f.close();}
});
