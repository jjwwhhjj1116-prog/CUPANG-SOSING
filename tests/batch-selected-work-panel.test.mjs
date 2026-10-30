import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const defer=()=>{let resolve;return{promise:new Promise(done=>{resolve=done;}),resolve:value=>resolve(value)};};
const stages=['seo','pricing','mainImage','additionalImages','detailImage','sizeChart','koreanLabel','quotation'];
const product=id=>({id,title:'상품 '+id,updated_at:'2026-10-23T00:00:00.000Z'});
test('the frozen full mode reaches each product runner without expanding selected stages',async()=>{
 const h=harness(async id=>({productId:id,stages:[]}),{products:[product('a')],runRequest:{id:'full-mode',ownerId:'owner',mode:'full',stages:['pricing'],keys:new Map()}});
 try{h.render();await tick();assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.mode,'full');assert.deepEqual([...h.calls[0].options.stages],['pricing']);assert.equal(h.calls[0].options.retryFailedQwen,false);}finally{h.close();}
});
function harness(runner,{selected=stages,products=[product('a'),product('b')],runRequest={id:'run-one',ownerId:'owner',stages:selected,keys:new Map()}}={}){
 const slots=[],effects=[],layouts=[],calls=[],locks=[],opened=[],activity=[];let cursor=0,closed=false,lateWrites=0,props={products,runRequest,onOpen:(...values)=>opened.push(values),onBusyChange:value=>locks.push(value),onActivity:event=>activity.push(event)};
 const same=(before,after)=>Array.isArray(before)&&before.length===after?.length&&after.every((value,index)=>Object.is(value,before[index]));
 const effect=(queue,fn,deps)=>{const index=cursor++,old=slots[index];if(!old||!same(old.deps,deps)){const next={deps,fn,cleanup:old?.cleanup};slots[index]=next;queue.push(()=>{next.cleanup?.();next.cleanup=fn();});}};
 const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>{if(closed){lateWrites++;return;}slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useEffect:(fn,deps)=>effect(effects,fn,deps),useLayoutEffect:(fn,deps)=>effect(layouts,fn,deps)};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/batch-work-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,crypto,fetch:()=>assert.fail('The panel test cannot perform network requests'),require:name=>name==='react'?hooks:name==='react/jsx-runtime'?{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})}:name==='@/app/batch-selected-work'?{runSelectedBatchProduct:async(id,options)=>{calls.push({id,options});return runner(id,options,calls.length);}}:new Proxy({},{get:()=>()=>null})});
 const render=()=>{cursor=0;const tree=exports.SelectedBatchWorkPanel(props);layouts.splice(0).forEach(fn=>fn());effects.splice(0).forEach(fn=>fn());return tree;};
 return{calls,locks,opened,activity,render,button:label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label),replace(value){props={...props,...value};return render();},replayEffects(){for(const slot of slots)if(slot?.fn){slot.cleanup?.();slot.cleanup=slot.fn();}},close(){closed=true;slots.forEach(slot=>slot?.cleanup?.());},get lateWrites(){return lateWrites;}};
}

test('the selected queue starts directly once, passes only chosen stages and displays actual draft/complete/blocked results',async()=>{
 const h=harness(async(id,options)=>{for(const [index,stage]of options.stages.entries())options.onStage({id:stage,status:index?'blocked':'draft',message:index?'확인할 원문이 필요합니다':'저장된 검토 초안'});options.onStage({id:'pricing',status:'complete',message:'must not leak'});return{productId:id,stages:options.stages.map((stage,index)=>({id:stage,status:index?'blocked':'draft',message:index?'확인할 원문이 필요합니다':'저장된 검토 초안'}))};},{selected:['seo','detailImage'],products:[product('a')]});
 try{h.render();await tick();h.render();await tick();assert.equal(h.calls.length,1);assert.deepEqual([...h.calls[0].options.stages],['seo','detailImage']);assert.equal(h.calls[0].options.expectedOwnerId,'owner');
  const rendered=nodes(h.render()).filter(node=>node.props?.['data-stage']);assert.deepEqual(rendered.map(node=>[node.props['data-stage'],node.props['data-stage-status']]),[['seo','draft'],['detailImage','blocked']]);assert.doesNotMatch(rendered.map(text).join(''),/must not leak|저장 완료/);
  h.button('SEO 검토 열기').props.onClick();h.button('상세 이미지 검토 열기').props.onClick();assert.deepEqual(h.opened,[['a','SEO'],['a','상세 이미지']]);assert.equal(h.locks.at(-1),false);
 }finally{h.close();}
});

test('stop finishes only the current product; explicit retries retain keys and reject callbacks from an earlier attempt',async()=>{
 const gate=defer();let oldProgress;const h=harness(async(id,options,index)=>{options.keys.set('uncertain-key','exact-key');options.onStage({id:'seo',status:'running',message:'진행 중'});if(index===1){oldProgress=options.onStage;await gate.promise;}return{productId:id,stages:[{id:'seo',status:'draft',message:'초안 보관됨'}]};},{selected:['seo']});
 try{h.render();await tick();const oldOpen=h.button('SEO 검토 열기').props.onClick;h.button('현재 상품 후 중지').props.onClick();oldOpen();assert.equal(h.opened.length,0);gate.resolve();await tick();assert.deepEqual(h.calls.map(call=>call.id),['a']);
  h.button('선택 작업 다시 시도').props.onClick();oldOpen();assert.equal(h.opened.length,0);oldProgress({id:'seo',status:'complete',message:'late stale success'});await tick();assert.deepEqual(h.calls.map(call=>call.id),['a','a','b']);assert.equal(h.calls[0].options.keys,h.calls[1].options.keys);assert.equal(h.calls[1].options.keys.get('uncertain-key'),'exact-key');assert.equal(h.calls[1].options.retryFailedQwen,true);assert.doesNotMatch(text(h.render()),/late stale success/);
 }finally{h.close();}
});

test('owner/run replacement aborts the old request and ignores its late progress, result and unlock',async()=>{
 const first=defer(),second=defer(),h=harness(async(id,options,index)=>{await(index===1?first.promise:second.promise);options.onStage({id:'seo',status:'complete',message:index===1?'old owner':'current owner'});return{productId:id,stages:[{id:'seo',status:'complete',message:index===1?'old owner':'current owner'}]};},{selected:['seo'],products:[product('a')]});
 try{h.render();await tick();h.replace({runRequest:{id:'run-two',ownerId:'new-owner',stages:['seo'],keys:new Map()}});await tick();assert.equal(h.calls[0].options.signal.aborted,true);assert.equal(h.calls[1].options.expectedOwnerId,'new-owner');first.resolve();await tick();assert.equal(h.locks.at(-1),true);assert.doesNotMatch(text(h.render()),/old owner/);second.resolve();await tick();assert.match(text(h.render()),/current owner/);
 }finally{h.close();}
});

test('unmount aborts processing and prevents late writes, next products and retained review navigation',async()=>{
 const gate=defer(),h=harness(async(id,options)=>{await gate.promise;options.onStage({id:'seo',status:'draft',message:'late'});return{productId:id,stages:[]};},{selected:['seo']});
 h.render();await tick();const oldOpen=h.button('SEO 검토 열기').props.onClick;h.close();assert.equal(h.calls[0].options.signal.aborted,true);gate.resolve();await tick();oldOpen();assert.equal(h.calls.length,1);assert.equal(h.opened.length,0);assert.equal(h.lateWrites,0);
});

test('development effect replay before kickoff cannot issue two nondurable generation requests',async()=>{
 const h=harness(async id=>({productId:id,stages:[{id:'pricing',status:'complete',message:'저장된 가격'}]}),{selected:['pricing'],products:[product('a')]});try{h.render();h.replayEffects();await tick();assert.equal(h.calls.length,1);assert.equal(h.calls[0].id,'a');}finally{h.close();}
});

test('a remounted run does not auto-resend and an explicit retry keeps the original pending ledger',async()=>{
 const runRequest={id:'retained-run',ownerId:'owner',stages:['seo'],keys:new Map()},gate=defer();
 const first=harness(async(id,options)=>{options.keys.set('owner:a:pending:seo','submitted');await gate.promise;return{productId:id,stages:[]};},{products:[product('a')],runRequest});
 first.render();await tick();assert.equal(first.calls.length,1);first.close();
 const second=harness(async(id,options)=>{assert.equal(options.keys.get('owner:a:pending:seo'),'submitted');return{productId:id,stages:[{id:'seo',status:'blocked',message:'이전 실행 결과 확인 필요'}]};},{products:[product('a')],runRequest});
 try{second.render();await tick();assert.equal(second.calls.length,0);assert.match(text(second.render()),/이전 실행이 있습니다/);second.button('선택 작업 다시 시도').props.onClick();await tick();assert.equal(second.calls.length,1);assert.equal(second.calls[0].options.keys,first.calls[0].options.keys);gate.resolve();await tick();assert.equal(first.lateWrites,0);}finally{second.close();}
});

test('a failed product still exposes its stage editor and never gains a fabricated completed state',async()=>{
 const h=harness(async()=>{throw Error('저장 응답을 확인하지 못했습니다.');},{selected:['koreanLabel','quotation'],products:[product('a')]});try{h.render();await tick();assert.match(text(h.render()),/저장 응답을 확인하지/);assert.equal(nodes(h.render()).some(node=>node.props?.['data-stage-status']==='complete'),false);h.button('표시사항 검토 열기').props.onClick();h.button('견적서 검토 열기').props.onClick();assert.deepEqual(h.opened,[['a','표시사항'],['a','견적서']]);}finally{h.close();}
});

test('quotation handoff opens only the same product review after processing and never submits from the batch panel',async()=>{
 const gate=defer(),h=harness(async(id,options)=>{options.onStage({id:'quotation',status:'running',message:'견적 작성 중'});await gate.promise;return{productId:id,stages:[{id:'quotation',status:'blocked',message:'필수 항목을 검토해주세요.'}]};},{selected:['quotation'],products:[product('a')]});
 try{
  h.render();await tick();const during=h.button('견적서 검토·등록 전송');assert.equal(during.props.disabled,true);during.props.onClick();assert.equal(h.opened.length,0);
  gate.resolve();await tick();const finished=h.button('견적서 검토·등록 전송');assert.equal(finished.props.disabled,false);finished.props.onClick();assert.deepEqual(h.opened,[['a','견적서']]);assert.equal(h.calls.length,1);
  h.close();finished.props.onClick();assert.equal(h.opened.length,1,'closed panel cannot reopen a retained product');
 }finally{h.close();}
});

test('the displayed SEO configuration snapshot reaches every runner and cannot change with parent props',async()=>{
 const configuration={configured:true,model:'@cf/meta/llama-3.3-70b-instruct-fp8-fast',maxOutputTokens:2048,freeOnly:true,destination:'Cloudflare Workers AI',issues:[],notice:'현재 무료 SEO 실행 안내',translationConfig:{configured:true,provider:'workers-ai',model:'@cf/qwen/qwen3-30b-a3b-fp8',maxOutputTokens:4096,freeOnly:false,destination:'Cloudflare Workers AI',issues:[],notice:'현재 Qwen 사용량 비용 안내'}},expected=JSON.parse(JSON.stringify(configuration));
 const request={id:'seo-consent-run',ownerId:'owner',stages:['seo'],keys:new Map(),seoGenerationConsent:configuration},h=harness(async id=>({productId:id,stages:[]}),{runRequest:request});
 try{
  h.render();configuration.notice='부모의 변경된 안내';configuration.issues.push('늦은 변경');configuration.translationConfig.notice='늦은 Qwen 안내';configuration.translationConfig.maxOutputTokens=8000;configuration.translationConfig.issues.push('늦은 Qwen 오류');await tick();await tick();
  assert.equal(h.calls.length,2);for(const call of h.calls){assert.deepEqual(JSON.parse(JSON.stringify(call.options.seoGenerationConsent)),expected);assert.notEqual(call.options.seoGenerationConsent,configuration);assert.notEqual(call.options.seoGenerationConsent.issues,configuration.issues);assert.notEqual(call.options.seoGenerationConsent.translationConfig,configuration.translationConfig);assert.notEqual(call.options.seoGenerationConsent.translationConfig.issues,configuration.translationConfig.issues);assert.equal(call.options.seoGenerationConsent.translationConfig.freeOnly,false);}
  assert.equal(h.calls[0].options.seoGenerationConsent.freeOnly,true);
 }finally{h.close();}
});

test('an owner/run replacement never inherits the previous SEO consent',async()=>{
 const configuration={configured:true,model:'@cf/meta/llama-3.3-70b-instruct-fp8-fast',maxOutputTokens:2048,freeOnly:true,destination:'Cloudflare Workers AI',issues:[],notice:'이전 계정 안내'},h=harness(async id=>({productId:id,stages:[]}),{products:[product('a')],runRequest:{id:'old-seo-consent',ownerId:'owner',stages:['seo'],keys:new Map(),seoGenerationConsent:configuration}});
 try{h.render();await tick();h.replace({runRequest:{id:'new-no-consent',ownerId:'new-owner',stages:['pricing'],keys:new Map()}});await tick();assert.equal(h.calls.length,2);assert.equal(h.calls[1].options.expectedOwnerId,'new-owner');assert.equal(h.calls[1].options.seoGenerationConsent,undefined);}finally{h.close();}
});

test('board feedback carries its exact run attempt and verified source while stale callbacks cannot replace it',async()=>{
 const gate=defer(),source={productVersion:product('a').updated_at,sourceFingerprint:'verified-source'},events=[];let oldProgress;
 const h=harness(async(id,options,index)=>{options.onStage({id:'mainImage',status:'running',message:'reading'});if(index===1){oldProgress=options.onStage;await gate.promise;}return{productId:id,stages:[{id:'mainImage',status:'failed',message:'원래 추론 응답 미확정',boardSource:source}]};},{products:[{...product('a'),boardSource:source}],selected:['mainImage']});
 try{
  h.render();await tick();assert.equal(h.activity[0].kind,'start');assert.equal(h.activity[0].attempt,1);assert.equal(h.activity[1].kind,'stage');assert.deepEqual(JSON.parse(JSON.stringify(h.activity[1].result.boardSource)),source);assert.notEqual(h.activity[1].result.boardSource,source);
  gate.resolve();await tick();assert.equal(h.activity.at(-1).kind,'finish');assert.equal(h.activity.at(-2).result.status,'failed');
  h.button('선택 작업 다시 시도').props.onClick();oldProgress({id:'mainImage',status:'complete',message:'late success',boardSource:source});await tick();
  events.push(...h.activity);assert.equal(events.filter(event=>event.kind==='start').length,2);assert.equal(events.filter(event=>event.kind==='stage'&&event.result.message==='late success').length,0);assert.equal(events.at(-1).attempt,2);
  const count=events.length;h.close();oldProgress({id:'mainImage',status:'failed',message:'after close'});assert.equal(h.activity.filter(event=>event.kind==='stage').length,events.filter(event=>event.kind==='stage').length);assert.ok(h.activity.length>=count);
 }finally{h.close();}
});
