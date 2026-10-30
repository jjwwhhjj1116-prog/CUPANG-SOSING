import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
const plain=value=>JSON.parse(JSON.stringify(value)),deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const version='2026-10-10T00:00:00.000Z';
const compositionModules=new Map();
function compositionModule(file){if(compositionModules.has(file))return compositionModules.get(file);const exports={};compositionModules.set(file,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,structuredClone,TextEncoder,crypto:globalThis.crypto,require:name=>compositionModule(name.slice(2)+'.ts')});return exports;}
function ui({allowed=true,storageValue=null,pending=null,registrationError=false,preparedAi=false,productId='p',productVersion=version,fetcher=null,draftHelper=null,sourceHelpers=null,savedSeo=null,workspaceOwnerId,brand='와이홉',onApplied,onDraft,registrationBrand=brand,workersRecovery,failedJob,recoveryResponder}={}){
 const slots=[],effects=[],layouts=[],calls=[],runs=[],creates=[],storage=new Map(storageValue?[[`yoofam-seo-workspace:${productId}`,storageValue]]:[]);let cursor=0,closed=false,lateWrites=0,lastKey,active=true;
 const schedule=(queue,fn,deps)=>{const i=cursor++;if(!slots[i]||!deps||!slots[i].deps||slots[i].deps.length!==deps.length||!deps.every((value,index)=>Object.is(value,slots[i].deps[index]))){const before=slots[i];slots[i]={deps,cleanup:before?.cleanup};queue.push(()=>{before?.cleanup?.();slots[i].cleanup=fn();});}};
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{if(closed){lateWrites++;return;}slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useMemo(fn,deps){const i=cursor++;if(!slots[i]||!(slots[i].deps?.length===deps?.length&&deps.every((value,index)=>Object.is(value,slots[i].deps[index]))))slots[i]={deps,value:fn()};return slots[i].value;},useEffect(fn,deps){schedule(effects,fn,deps);},useLayoutEffect(fn,deps){schedule(layouts,fn,deps);}};
 const source={productId,productVersion,jobId:'source-job',sourceUrl:'https://detail.1688.com/offer/123456789012.html',title:'黑色手套',description:'棉',attributes:[{name:'材质',value:'棉'}],requestContext:{categoryId:'82533',categoryPath:['장갑'],features:'보온',keywords:'면장갑'}};
 const helper={createSeoWorkspaceDraftState(input){creates.push(plain(input));return draftHelper?draftHelper.createSeoWorkspaceDraftState(input):{...input,memo:plain(input.memo),idempotencyKey:'key'};},parseSeoWorkspaceDraftState(raw,id){if(draftHelper)return draftHelper.parseSeoWorkspaceDraftState(raw,id);try{const saved=JSON.parse(raw);return saved.idempotencyKey==='key'&&saved.productId===id?saved:null;}catch{return null;}},
  async runSeoWorkspaceDraft(state,controls){runs.push({state:plain(state),controls});if(draftHelper)return draftHelper.runSeoWorkspaceDraft(state,controls);controls.onState(state);await pending?.promise;if(controls.signal.aborted||!controls.isContextCurrent())throw Error('중단');const job=preparedAi?{id:'job',productId,productVersion:state.productVersion,status:'prepared',startedAt:null,result:null,error:null}:{id:'job',productId,productVersion:state.productVersion,status:'completed',result:{draft:{title:'검정 면장갑',keywords:['면장갑'],warnings:[]}}};controls.onJob(job);return{job,closed:!preparedAi,message:preparedAi?'생성 요청 준비':'초안 작성 완료'};},async refreshSeoWorkspaceDraft(state,controls){if(draftHelper)return draftHelper.refreshSeoWorkspaceDraft(state,controls);const job={id:'job',productId,productVersion:state.productVersion,status:'completed',result:{draft:{title:'검정 면장갑',keywords:['면장갑'],warnings:[]}}};return{job,closed:true,message:'기존 초안 조회'};}};
 const api=async(url,init)=>{calls.push({url,init});if(fetcher)return fetcher(url,init);if(url.endsWith('/translation')&&init.method==='POST'&&recoveryResponder)return recoveryResponder(url,init);if(url.endsWith('/translation'))return Response.json({configuration:{configured:true,model:preparedAi?'@cf/meta/llama-3.3-70b-instruct-fp8-fast':'google-translate-gtx',maxOutputTokens:preparedAi?2000:0,issues:[]},jobs:failedJob?[failedJob]:[],workersRecovery});
  if(url.endsWith('/content'))return Response.json({content:{productId,revision:2,...(savedSeo?{seo:savedSeo}:{})}});if(url.endsWith('/translation-source'))return Response.json(source);
  if(url.endsWith('/registration-settings'))return registrationError?Response.json({error:'로그인 회사와 수집 회사가 다릅니다.'},{status:409}):Response.json({productId,settings:{brand:registrationBrand}});
  if(url.endsWith('/options'))return Response.json({productVersion,options:{productId,rows:[]}});throw Error(url);};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/seo-workspace-generator.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,fetch:api,AbortController,structuredClone,sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
   if(name.endsWith('.css'))return{};if(name==='@/app/seo-generated-draft')return sourceHelpers?.[name]??{createSeoGeneratedDraft:input=>providedOptionModule('app/seo-generated-draft.ts').createSeoGeneratedDraft(input),seoRegenerationOptionBatch:(...input)=>providedOptionModule('app/seo-generated-draft.ts').seoRegenerationOptionBatch(...input)};if(name==='@/app/automation/workers-qwen-contract')return compositionModule('app/automation/workers-qwen-contract.ts');if(name==='@/app/components/translation-panel')return{default:()=>null};if(name==='@/app/workers-translation-recovery')return compositionModule('app/workers-translation-recovery.ts');if(name==='@/app/workers-seo-recovery-client')return compositionModule('app/workers-seo-recovery-client.ts');if(name==='@/app/seo-workspace-draft')return helper;if(name==='@/app/seo-guidance-session')return compositionModule('app/seo-guidance-session.ts');if(name==='@/app/seo-guidance-composition')return compositionModule('app/seo-guidance-composition.ts');if(name==='@/app/seo-apply-focus')return compositionModule('app/seo-apply-focus.ts');if(name==='@/app/components/translation-integrated-preview')return{TranslationIntegratedPreview:()=>null};
   if(sourceHelpers?.[name])return sourceHelpers[name];if(name==='@/app/collected-translation-attributes')return{collectedTranslationAttributes:value=>value.map(item=>({name:'상품속성: '+item.name,value:item.value}))};
   if(name==='@/app/option-translation')return{optionTranslationBatch:()=>({attributes:[],remaining:0})};if(name==='@/app/sourcing')return{collectionSourceReference:(id,url)=>id+' '+url};throw Error(name);}});
 const render=(passive=true)=>{cursor=0;const root=exports.SeoWorkspaceGenerator({productId,workspaceOwnerId,version:productVersion,brand,active,beforeGenerate:()=>allowed,onApplied,onDraft,onSaved(){throw Error('Unexpected product save');}});if(lastKey!==undefined&&lastKey!==root.key){slots.forEach(slot=>slot?.cleanup?.());slots.splice(0);effects.splice(0);layouts.splice(0);}lastKey=root.key;const tree=root.type(root.props);layouts.splice(0).forEach(fn=>fn());if(passive)effects.splice(0).forEach(fn=>fn());return tree;};
 const idle=async()=>{for(let i=0;i<10;i++){render();await new Promise(resolve=>setImmediate(resolve));}};
 const until=async(predicate)=>{const deadline=Date.now()+5000;while(!predicate()){assert.ok(Date.now()<deadline,'component did not reach the expected bounded state');render();await new Promise(resolve=>setImmediate(resolve));}};
 render();return{render,idle,until,calls,runs,creates,storage,input:label=>nodes(render()).find(node=>node.type==='input'&&node.props['aria-label']===label),integrated:()=>nodes(render()).find(node=>node.props?.jobId),button:label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label),consent:()=>nodes(render()).find(node=>node.type==='input'&&node.props.type==='checkbox'),close(){closed=true;slots.forEach(slot=>slot?.cleanup?.());},get lateWrites(){return lateWrites;},setAllowed(value){allowed=value;},setRegistrationError(value){registrationError=value;},setVersion(value){productVersion=value;source.productVersion=value;},setSource(value){Object.assign(source,value);},setProduct(id,value){productId=id;productVersion=value;source.productId=id;source.productVersion=value;},setActive(value){active=value;},setOwner(value){workspaceOwnerId=value;},setRegistrationBrand(value){registrationBrand=value;}};
}

const workersRecoverySettings={configured:true,provider:'workers-ai',destination:'Cloudflare Workers AI',strategy:'m2m-text-v1',model:'@cf/meta/m2m100-1.2b',maxCalls:8,maxOutputTokens:2048,freeOnly:true,issues:[]};

test('fresh category leaf supplies an editable missing target while an explicitly finalized blank stays blank',async()=>{
 sessionCache.setSeoGuidanceSessionOwner(undefined);const options={workspaceOwnerId:'fresh-category-owner',productId:'fresh-category-product'};let h=ui(options);try{
  h.setSource({requestContext:{categoryId:'69286',categoryPath:['패션잡화','여성크로스백'],features:'',keywords:''}});await h.idle();assert.equal(h.input('SEO 타겟 키워드').props.value,'여성크로스백');assert.equal(h.button('한국어 초안 자동 작성').props.disabled,false);assert.match(text(nodes(h.render()).find(node=>node.props?.className==='seo-title-example')),/와이홉 인조가죽 여성크로스백/);assert.equal(h.input('SEO 상품 특징').props.value,'');assert.equal(h.runs.length,0);assert.ok(h.calls.every(call=>!call.init?.method));
  h.input('SEO 타겟 키워드').props.onChange({target:{value:''}});h.render();h.input('SEO 타겟 키워드').props.onBlur({target:{value:''}});h.close();h=ui(options);h.setSource({requestContext:{categoryId:'69286',categoryPath:['패션잡화','여성크로스백'],features:'',keywords:''}});await h.idle();assert.equal(h.input('SEO 타겟 키워드').props.value,'');assert.equal(h.button('한국어 초안 자동 작성').props.disabled,true);assert.equal(h.runs.length,0);
 }finally{h.close();}
});

function failedQwenRetryUi({model='@cf/qwen/qwen3-30b-a3b-fp8',recovery=false,onDraft}={}){
 const api=providedOptionModule('app/seo-workspace-draft.ts'),maxOutputTokens=model==='google-translate-gtx'?0:4096,configuration={configured:true,model,maxOutputTokens,issues:[]};
 const raw={productId:'p',productVersion:version,jobId:'source-job',sourceUrl:'https://detail.1688.com/offer/123456789012.html',title:'黑色手套',description:'棉',attributes:[{name:'材质',value:'棉'}],requestContext:{categoryId:'82533',categoryPath:['장갑'],features:'보온',keywords:'면장갑'}};
 const state=api.createSeoWorkspaceDraftState({productId:'p',productVersion:version,contentRevision:2,source:{title:raw.title,description:raw.description,attributes:[{name:'상품속성: 材质',value:'棉'}],provenance:'manual',reference:raw.jobId+' '+raw.sourceUrl,category:{id:'82533',path:['장갑']},guidance:{features:'보온',keywords:'면장갑'}},memo:{brand:'와이홉',features:'보온',keywords:'면장갑'},configuration});
 Object.assign(state,{jobId:'00000000-0000-4000-8000-000000000001',reviewFingerprint:'a'.repeat(64),prepareSubmitted:true,approvalSubmitted:true,executeSubmitted:true});
 const old={id:state.jobId,productId:'p',productVersion:version,contentRevision:2,status:'failed',startedAt:version,finishedAt:version,result:null,error:{code:'QWEN_UNTRANSLATED_TEXT',message:'합성 이전 Qwen 실패',mayHaveBeenCharged:true},review:{model,maxOutputTokens,destination:model==='google-translate-gtx'?'Google 번역':'Cloudflare Workers AI',instructionsVersion:'sourceflow-translation-v6',source:plain(state.source),fingerprint:state.reviewFingerprint,paidNotice:'합성 Qwen 사용량 비용 안내',expiresAt:'2099-01-01',...(recovery?{workersRecovery:{version:5}}:{})}};
 const requests=[];let latest=plain(old),currentConfiguration=plain(configuration),gate=null,newJob=null;
 const good={title:'검정 면장갑',keywords:['면장갑'],description:'면',attributes:[{sourceIndex:0,name:'상품속성: 소재',value:'면'}],warnings:[]};
 const fetcher=async(target,init={})=>{
  const body=init.body?JSON.parse(init.body):null;requests.push({target,body,signal:init.signal});
  if(target.endsWith('/translation')){
   if(!body){if(gate)await gate.promise;return Response.json({configuration:currentConfiguration,jobs:latest?[latest]:[]});}
   if(body.action==='prepare'){newJob={...plain(old),id:'00000000-0000-4000-8000-000000000002',status:'prepared',startedAt:null,finishedAt:null,error:null,review:{...plain(old.review),source:body.source,fingerprint:'b'.repeat(64)}};}
   else if(body.action==='approve'){assert.equal(body.jobId,newJob.id);newJob.status='approved';}
   else if(body.action==='execute'){assert.equal(body.jobId,newJob.id);newJob.status='completed';newJob.result={model,appliedToContent:false,provenance:'generated',draft:good};}
   else assert.fail(body.action);return Response.json({job:plain(newJob)});
  }
  if(target.endsWith('/content'))return Response.json({content:{...providedOptionModule('app/product-content.ts').emptyProductContent('p'),revision:2}});
  if(target.endsWith('/translation-source'))return Response.json(raw);
  if(target.endsWith('/options'))return Response.json({productVersion:version,options:providedOptionModule('app/product-options.ts').emptyProductOptions('p')});
  if(target.endsWith('/registration-settings'))return Response.json({productId:'p',settings:{brand:'와이홉'}});
  assert.fail(target);
 };
 const h=ui({workspaceOwnerId:'owner-a',storageValue:JSON.stringify(state),draftHelper:api,fetcher,onDraft});
 return{h,state,old,requests,setLatest(value){latest=value;},setConfiguration(value){currentConfiguration=value;},hold(){gate=deferred();return gate;},async ready(){await h.idle();h.button('초안 상태 조회').props.onClick();await h.idle();assert.ok(h.button('실패한 Qwen 새 초안'));h.consent().props.onChange({target:{checked:true}});await h.idle();},posts(){return requests.filter(request=>request.body);}};
}

test('the primary draft-mode AI click keeps prepare approval execution, emits editable input once and never applies or saves it',async()=>{
 const emitted=[],f=failedQwenRetryUi({onDraft:value=>emitted.push(value)}),{h}=f;try{
  await h.idle();assert.equal(h.consent(),undefined);assert.equal(f.posts().length,0);assert.equal(emitted.length,0);
  h.button('초안 상태 조회').props.onClick();await h.idle();assert.equal(f.posts().length,0);assert.equal(emitted.length,0,'a status read does not seed or execute');const click=h.button('실패한 Qwen 새 초안').props.onClick;assert.equal(h.button('실패한 Qwen 새 초안').props.disabled,false);click();click();await h.idle();
  assert.deepEqual(f.posts().map(request=>request.body.action),['prepare','approve','execute']);assert.equal(f.posts()[1].body.confirmPaid,true);assert.equal(emitted.length,1);assert.equal(emitted[0].ownerId,'owner-a');assert.equal(emitted[0].productVersion,version);assert.equal(emitted[0].values.seo.title,'와이홉 검정 면장갑');assert.equal(h.integrated(),undefined,'no intermediate apply/save preview in the primary flow');assert.equal(h.storage.size,0);assert.equal(h.input('SEO 상품 특징').props.disabled,false);assert.ok(f.requests.every(request=>!request.target.includes('translation-apply')&&!request.target.includes('seo-workspace')));
 }finally{h.close();}
});

test('an explicitly confirmed failed Qwen retry rereads the exact old job, creates one new UUID and never re-executes the failed job',async()=>{
 const f=failedQwenRetryUi(),{h}=f;try{await f.ready();const before=JSON.stringify(f.old),key=f.state.idempotencyKey,readCount=f.requests.length,click=h.button('실패한 Qwen 새 초안').props.onClick;click();click();await h.idle();
  assert.equal(f.requests[readCount].body,null,'current server failure is read before a new prepare');assert.deepEqual(f.posts().map(request=>request.body.action),['prepare','approve','execute']);assert.equal(h.creates.length,1);assert.notEqual(f.posts()[0].body.idempotencyKey,key);assert.equal(f.posts()[0].body.idempotencyKey,JSON.parse(h.storage.get('yoofam-seo-workspace:p')).idempotencyKey);assert.ok(f.posts().slice(1).every(request=>request.body.jobId!==f.old.id));assert.equal(JSON.stringify(f.old),before);assert.match(text(h.render()),/검정 면장갑/);
 }finally{h.close();}
});

test('a failed Qwen retry retains its original state when a fresh read is running, uncertain, completed, missing or has a changed configuration',async()=>{
 for(const change of ['running','uncertain','completed','missing','configuration','fingerprint']){const f=failedQwenRetryUi(),{h}=f;try{await f.ready();const before=h.storage.get('yoofam-seo-workspace:p');
   if(change==='missing')f.setLatest(null);else if(change==='configuration')f.setConfiguration({configured:true,model:'@cf/meta/llama-3.3-70b-instruct-fp8-fast',maxOutputTokens:2048,issues:[]});else{const latest=plain(f.old);if(change==='fingerprint')latest.review.fingerprint='c'.repeat(64);else{latest.status=change;latest.error=change==='uncertain'?{code:'unknown',message:'상태 확인 필요',mayHaveBeenCharged:true}:null;if(change==='completed')latest.result={model:latest.review.model,appliedToContent:false,provenance:'generated',draft:{title:'검정 면장갑',keywords:['면장갑'],description:'면',attributes:[{sourceIndex:0,name:'상품속성: 소재',value:'면'}],warnings:[]}};}f.setLatest(latest);}
   h.button('실패한 Qwen 새 초안').props.onClick();await h.idle();assert.equal(f.posts().length,0,change);assert.equal(h.creates.length,0,change);assert.equal(h.storage.get('yoofam-seo-workspace:p'),before,change);
  }finally{h.close();}}
});

test('failed Qwen renewal requires live consent and rejects dirty, owner, version and stage changes during the failure read',async()=>{
 for(const change of ['consent','dirty','owner','version','stage']){const f=failedQwenRetryUi(),{h}=f;try{await f.ready();const before=h.storage.get('yoofam-seo-workspace:p'),click=h.button('실패한 Qwen 새 초안').props.onClick;
   if(change==='consent'){h.consent().props.onChange({target:{checked:false}});await h.idle();assert.equal(h.button('실패한 Qwen 새 초안').props.disabled,true);click();await h.idle();}
   else{const gate=f.hold();click();await h.idle();if(change==='dirty')h.setAllowed(false);if(change==='owner')h.setOwner('owner-b');if(change==='version')h.setVersion('2026-10-10T00:00:01.000Z');if(change==='stage')h.setActive(false);h.render();gate.resolve();await h.idle();}
   assert.equal(f.posts().length,0,change);assert.equal(h.creates.length,0,change);assert.equal(h.storage.get('yoofam-seo-workspace:p'),before,change);
  }finally{h.close();}}
});

test('ordinary Google, Llama and historical recovery failures retain their prior same-request workflow without a new UUID',async()=>{
 for(const options of [{model:'google-translate-gtx'},{model:'@cf/meta/llama-3.3-70b-instruct-fp8-fast'},{recovery:true}]){const f=failedQwenRetryUi(options),{h}=f;try{
  await h.idle();h.button('초안 상태 조회').props.onClick();await h.idle();assert.equal(h.button('실패한 Qwen 새 초안'),undefined);const before=h.storage.get('yoofam-seo-workspace:p');h.button(options.model==='google-translate-gtx'?'한국어 초안 자동 작성':'AI로 자동 생성').props.onClick();await h.idle();assert.equal(f.posts().length,0);assert.equal(h.creates.length,0);assert.equal(h.storage.get('yoofam-seo-workspace:p'),before);
 }finally{h.close();}}
});
const failedGoogleJob={id:'failed-google',productId:'p',productVersion:version,contentRevision:2,status:'failed',result:null,error:{code:'GOOGLE_TRANSLATION_FAILED_HTTP_429',message:'Google 번역 HTTP 429 응답',mayHaveBeenCharged:false},startedAt:version,finishedAt:version,review:{destination:'Google 번역',model:'google-translate-gtx'}};
const workersReviewJob={id:'workers-review',productId:'p',productVersion:version,contentRevision:2,status:'prepared',result:null,error:null,review:{destination:'Cloudflare Workers AI',model:'@cf/meta/m2m100-1.2b',fingerprint:'a'.repeat(64),workersRecovery:{failedJobId:failedGoogleJob.id,scope:'collected',strategy:'m2m-text-v1',model:'@cf/meta/m2m100-1.2b',maxCalls:4}}};

test('SEO card prepares Workers review only by explicit click and retains typed memo and Google workflow',async()=>{
 const pending=deferred(),h=ui({allowed:false,workspaceOwnerId:'owner-a',workersRecovery:workersRecoverySettings,failedJob:failedGoogleJob,recoveryResponder:async()=>{await pending.promise;return Response.json({job:workersReviewJob,workersRecoveryReview:true});}});
 try{
  await h.idle();assert.equal(h.calls.length,5);assert.ok(h.calls.every(call=>!call.init.method));
  h.input('SEO 상품 특징').props.onChange({target:{value:'보존할 사용자 특징'}});await h.idle();
  h.button('중국어→한국어 번역 초안').props.onClick();assert.equal(h.calls.length,5,'workspace dirty guard blocks preparation');h.setAllowed(true);
  const click=h.button('중국어→한국어 번역 초안').props.onClick;click();click();assert.equal(h.calls.length,6);
  const body=JSON.parse(h.calls[5].init.body);assert.equal(body.action,'prepare-collected-m2m');assert.equal(body.failedJobId,failedGoogleJob.id);assert.equal(body.expectedVersion,version);
  pending.resolve();await h.idle();assert.equal(h.calls.length,6);assert.equal(h.input('SEO 상품 특징').props.value,'보존할 사용자 특징');assert.ok(h.button('한국어 초안 자동 작성'));
  const review=nodes(h.render()).find(node=>node.props?.initialJobId===workersReviewJob.id);assert.equal(review.props.reviewOnly,true);assert.equal(review.props.version,version);assert.equal(h.runs.length,0);
  assert.match(text(h.render()),/Cloudflare Workers AI/);assert.match(text(h.render()),/검토·승인/);
 }finally{h.close();}
});

test('Workers card refuses missing free configuration and reuses a nonce only after another explicit click',async()=>{
 const disabled=ui({workersRecovery:{...workersRecoverySettings,configured:false},failedJob:failedGoogleJob});try{await disabled.idle();const button=disabled.button('중국어→한국어 번역 초안');assert.equal(button.props.disabled,true);button.props.onClick();await disabled.idle();assert.equal(disabled.calls.length,5);}finally{disabled.close();}
 const h=ui({workersRecovery:workersRecoverySettings,failedJob:failedGoogleJob,recoveryResponder:async()=>{throw Error('synthetic lost ACK');}});try{await h.idle();h.button('중국어→한국어 번역 초안').props.onClick();await h.idle();assert.equal(h.calls.length,6);await h.idle();assert.equal(h.calls.length,6);h.button('중국어→한국어 번역 초안').props.onClick();await h.idle();assert.equal(h.calls.length,7);assert.deepEqual(JSON.parse(h.calls[5].init.body),JSON.parse(h.calls[6].init.body));assert.equal(h.runs.length,0);}finally{h.close();}
});

test('an explicitly renewed Workers review refreshes the embedded panel even when its job identifier is unchanged',async()=>{
 let preparations=0;const h=ui({workersRecovery:workersRecoverySettings,failedJob:failedGoogleJob,recoveryResponder:async()=>{const fingerprint=(++preparations===1?'a':'b').repeat(64);return Response.json({workersRecoveryReview:true,job:{...workersReviewJob,review:{...workersReviewJob.review,fingerprint}}});}});
 try{await h.idle();h.button('중국어→한국어 번역 초안').props.onClick();await h.idle();const first=nodes(h.render()).find(node=>node.props?.initialJobId===workersReviewJob.id);assert.equal(first.props.initialReviewFingerprint,'a'.repeat(64));h.button('중국어→한국어 번역 초안').props.onClick();await h.idle();const renewed=nodes(h.render()).find(node=>node.props?.initialJobId===workersReviewJob.id);assert.equal(renewed.props.initialReviewFingerprint,'b'.repeat(64));assert.equal(h.calls.length,7);assert.equal(h.runs.length,0);}finally{h.close();}
});

test('stage or account change aborts Workers preparation and cannot display its late review',async()=>{
 for(const mode of ['closed','stage-aba','owner-aba']){
  const pending=deferred(),h=ui({workspaceOwnerId:'owner-a',workersRecovery:workersRecoverySettings,failedJob:failedGoogleJob,recoveryResponder:async()=>{await pending.promise;return Response.json({job:workersReviewJob,workersRecoveryReview:true});}});
  try{
   await h.idle();h.button('중국어→한국어 번역 초안').props.onClick();const signal=h.calls[5].init.signal;
   if(mode==='closed')h.close();if(mode==='stage-aba'){h.setActive(false);await h.idle();h.setActive(true);await h.idle();}if(mode==='owner-aba'){h.setOwner('owner-b');await h.idle();h.setOwner('owner-a');await h.idle();}
   assert.equal(signal.aborted,true);pending.resolve();if(mode==='closed')await new Promise(resolve=>setImmediate(resolve));else await h.idle();
   assert.equal(h.lateWrites,0);if(mode!=='closed')assert.ok(!nodes(h.render()).some(node=>node.props?.initialJobId===workersReviewJob.id));
  }finally{h.close();}
 }
});

test('verified SEO editor handoff stays bound to the current composition job and context',async()=>{
 for(const mode of ['valid','other-job','options-only','clock-aba','owner-aba','hidden','stage-aba']){
  const events=[],h=ui({workspaceOwnerId:'owner-a',onApplied:value=>events.push(plain(value))});
  try{
   await h.idle();h.button('한국어 초안 자동 작성').props.onClick();await h.idle();
   const apply=h.integrated().props.onApplied,receipt={scope:'all',productId:'p',jobId:'job',previousVersion:version,productVersion:'2026-10-10T00:00:01.000Z',contentRevision:3,optionRevision:2};
   if(mode==='other-job')receipt.jobId='other';if(mode==='options-only')receipt.scope='options';
   if(mode==='clock-aba'){h.setVersion(receipt.productVersion);await h.idle();h.setVersion(version);await h.idle();}
   if(mode==='owner-aba'){h.setOwner('owner-b');await h.idle();h.setOwner('owner-a');await h.idle();}
   if(mode==='hidden'||mode==='stage-aba'){h.setActive(false);await h.idle();if(mode==='stage-aba'){h.setActive(true);await h.idle();}}
   apply(receipt);assert.equal(events.length,mode==='valid'?1:0,mode);if(mode==='valid')assert.deepEqual(events[0],receipt);
   assert.equal(h.calls.some(call=>call.init?.method==='POST'),false,'navigation alone cannot dispatch a save');
  }finally{h.close();}
 }
});

test('unsubmitted SEO brand, features and keyword edits survive a same-source clock refresh and stage navigation',async()=>{
 const h=ui();try{await h.idle();h.input('SEO 브랜드').props.onChange({target:{value:'직접 브랜드'}});h.input('SEO 상품 특징').props.onChange({target:{value:'직접 특징'}});h.input('SEO 타겟 키워드').props.onChange({target:{value:''}});await h.idle();
  h.setActive(false);await h.idle();h.setVersion('2026-10-10T00:00:01.000Z');await h.idle();h.setActive(true);await h.idle();
  assert.deepEqual(['SEO 브랜드','SEO 상품 특징','SEO 타겟 키워드'].map(label=>h.input(label).props.value),['직접 브랜드','직접 특징','']);
  assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(h.render().props['data-seo-generation-input'],true);
  assert.equal(h.runs.length,0);assert.equal(h.storage.size,0);assert.equal(h.calls.length,10,'the new clock refreshes the actual saved basis');
  assert.equal(h.button('한국어 초안 자동 작성').props.disabled,true);h.input('SEO 타겟 키워드').props.onChange({target:{value:'확인한 타겟'}});await h.idle();
  h.button('한국어 초안 자동 작성').props.onClick();await h.idle();assert.equal(h.creates[0].productVersion,'2026-10-10T00:00:01.000Z');assert.deepEqual(h.creates[0].memo,{brand:'직접 브랜드',features:'직접 특징',keywords:'확인한 타겟'});
  assert.equal(h.render().props['data-workspace-dirty'],false,'submitted memo now belongs to the durable request');
 }finally{h.close();}
});

test('same-value memo changes are clean, reverting edits clears dirty and a new product cannot inherit inputs',async()=>{
 const h=ui();try{await h.idle();assert.equal(h.render().props['data-workspace-dirty'],false);h.input('SEO 상품 특징').props.onChange({target:{value:'보온'}});await h.idle();assert.equal(h.render().props['data-workspace-dirty'],false);
  h.input('SEO 상품 특징').props.onChange({target:{value:'직접 특징'}});await h.idle();assert.equal(h.render().props['data-workspace-dirty'],true);h.input('SEO 상품 특징').props.onChange({target:{value:'보온'}});await h.idle();assert.equal(h.render().props['data-workspace-dirty'],false);
  h.input('SEO 브랜드').props.onChange({target:{value:''}});await h.idle();h.setProduct('another-product','2026-10-10T00:00:01.000Z');await h.idle();assert.equal(h.input('SEO 브랜드').props.value,'와이홉');assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(h.runs.length,0);
 }finally{h.close();}
});

test('a prepared old-clock request keeps its operation and memo but cannot execute after refresh',async()=>{
 const h=ui({preparedAi:true});try{await h.idle();h.input('SEO 브랜드').props.onChange({target:{value:'요청 브랜드'}});await h.idle();h.button('AI로 자동 생성').props.onClick();await h.idle();const receipt=h.storage.get('yoofam-seo-workspace:p');
  h.setVersion('2026-10-10T00:00:01.000Z');await h.idle();assert.equal(h.input('SEO 브랜드').props.value,'요청 브랜드');assert.equal(h.input('SEO 브랜드').props.disabled,true);h.button('AI로 자동 생성').props.onClick();await h.idle();assert.equal(h.runs.length,1);assert.equal(h.storage.get('yoofam-seo-workspace:p'),receipt);assert.match(text(h.render()),/이전 요청 이후 상품 원문이 변경/u);
  h.button('초안 상태 조회').props.onClick();await h.idle();assert.equal(h.runs.length,1);assert.doesNotMatch(text(h.render()),/작성된 초안/u);h.button('새 초안 입력').props.onClick();await h.idle();assert.equal(h.input('SEO 브랜드').props.value,'요청 브랜드');assert.equal(h.input('SEO 브랜드').props.disabled,false);
 }finally{h.close();}
});

test('source replacement retains submitted proof for readonly recovery and resets it only through explicit new input',async()=>{
 const h=ui({preparedAi:true});try{await h.idle();h.input('SEO 상품 특징').props.onChange({target:{value:'이전 요청 특징'}});await h.idle();h.button('AI로 자동 생성').props.onClick();await h.idle();const receipt=h.storage.get('yoofam-seo-workspace:p');
  h.setSource({description:'白色棉',attributes:[{name:'材质',value:'白色棉'}],requestContext:{categoryId:'82533',categoryPath:['장갑'],features:'새 근거 특징',keywords:'새 근거 키워드'}});h.setVersion('2026-10-10T00:00:01.000Z');await h.idle();assert.equal(h.input('SEO 상품 특징').props.value,'이전 요청 특징');assert.equal(h.input('SEO 상품 특징').props.disabled,true);assert.match(text(h.render()),/수집 원문이 변경/u);
  h.button('AI로 자동 생성').props.onClick();await h.idle();assert.equal(h.runs.length,1);assert.equal(h.storage.get('yoofam-seo-workspace:p'),receipt);h.button('초안 상태 조회').props.onClick();await h.idle();h.button('새 초안 입력').props.onClick();await h.idle();assert.equal(h.input('SEO 상품 특징').props.value,'새 근거 특징');assert.equal(h.input('SEO 타겟 키워드').props.value,'새 근거 키워드');assert.equal(h.storage.size,0);
 }finally{h.close();}
});

test('an old generation button cannot launch against its superseded clock while a late request cannot repaint the refreshed basis',async()=>{
 const pending=deferred(),h=ui({pending});try{await h.idle();const oldClick=h.button('한국어 초안 자동 작성').props.onClick;oldClick();assert.equal(h.runs.length,1);h.setVersion('2026-10-10T00:00:01.000Z');await h.idle();assert.equal(h.runs[0].controls.signal.aborted,true);oldClick();assert.equal(h.runs.length,1);pending.resolve();await h.idle();assert.doesNotMatch(text(h.render()),/검정 면장갑/u);assert.equal(h.lateWrites,0);
 }finally{h.close();}
});

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`actual saved content clock refresh preserves unsubmitted SEO inputs and prepares only the new CAS basis (${company.companyCode})`,async()=>{
 const api=mobileIntakeHarness(company);let h;try{api.sqlite.prepare("UPDATE collection_jobs SET goal='collect'").run();await api.intake();const product=api.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const json=async(response)=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
  let losePreparation=true;const preparations=[];h=ui({productId:product.id,productVersion:product.updated_at,fetcher:async(url,init={})=>{const body=init.body?JSON.parse(init.body):null,response=await api.route(url,{method:init.method??'GET',body:init.body});if(body?.action==='prepare'){preparations.push(body);if(losePreparation){losePreparation=false;throw Error('offline lost preparation acknowledgement');}}return response;},draftHelper:api.load('app/seo-workspace-draft.ts'),sourceHelpers:{'@/app/collected-translation-attributes':api.load('app/collected-translation-attributes.ts'),'@/app/option-translation':api.load('app/option-translation.ts'),'@/app/sourcing':api.load('app/sourcing.ts')}});
  await h.until(()=>!!h.button('AI로 자동 생성')&&!h.button('AI로 자동 생성').props.disabled);h.input('SEO 브랜드').props.onChange({target:{value:'수동 브랜드'}});h.input('SEO 상품 특징').props.onChange({target:{value:'저장 후 보존할 특징'}});h.input('SEO 타겟 키워드').props.onChange({target:{value:''}});await h.idle();
  const content=(await json(await api.route(base+'/content'))).content;await json(await api.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{model:'직접 검토한 모델'}}}}));const updated=api.sqlite.prepare('SELECT updated_at FROM products').get().updated_at;assert.notEqual(updated,product.updated_at);
  const retained=()=>JSON.stringify(['products','product_content','product_options','collection_results','collection_context','collection_products','collection_images'].map(table=>api.sqlite.prepare('SELECT * FROM '+table).all()));const before=retained(),objects=JSON.stringify([...api.objects].map(([key,bytes])=>[key,[...bytes]]));
  h.setVersion(updated);await h.until(()=>h.calls.length>=10&&!h.render().props['data-workspace-saving']);assert.deepEqual(['SEO 브랜드','SEO 상품 특징','SEO 타겟 키워드'].map(label=>h.input(label).props.value),['수동 브랜드','저장 후 보존할 특징','']);
  assert.equal(h.button('AI로 자동 생성').props.disabled,true);h.input('SEO 타겟 키워드').props.onChange({target:{value:'검토한 타겟'}});await h.idle();
  h.button('AI로 자동 생성').props.onClick();await h.until(()=>!!h.button('같은 초안 요청 확인')&&!h.button('같은 초안 요청 확인').props.disabled);const operation=JSON.parse(h.storage.get(`yoofam-seo-workspace:${product.id}`));assert.equal(operation.prepareSubmitted,true);assert.equal(operation.executeSubmitted,false);assert.equal(preparations.length,1);h.button('같은 초안 요청 확인').props.onClick();await h.until(()=>!!h.button('새 초안 입력')&&!h.button('새 초안 입력').props.disabled);const job=api.sqlite.prepare('SELECT * FROM translation_jobs').get(),current=(await json(await api.route(base+'/content'))).content;
  assert.equal(job.product_version,updated);assert.equal(job.content_revision,current.revision);assert.equal(job.status,'prepared');assert.equal(h.creates[0].productVersion,updated);assert.deepEqual(h.creates[0].memo,{brand:'수동 브랜드',features:'저장 후 보존할 특징',keywords:'검토한 타겟'});assert.equal(api.aiSources.length,0,'unapproved preparation makes no provider call');assert.equal(retained(),before);assert.equal(JSON.stringify([...api.objects].map(([key,bytes])=>[key,[...bytes]])),objects);
  assert.equal(h.creates.length,1);assert.equal(preparations.length,2);assert.deepEqual(preparations[0],preparations[1]);assert.equal(preparations[0].idempotencyKey,operation.idempotencyKey);assert.equal(api.sqlite.prepare('SELECT count(*) n FROM translation_jobs').get().n,1,'lost ACK confirms the same operation without a second job');
 }finally{h?.close();api.close();}
});

test('a different supplier source resets unsubmitted inputs rather than silently generating with the old source',async()=>{
 const h=ui();try{await h.idle();h.input('SEO 상품 특징').props.onChange({target:{value:'이전 원문 메모'}});await h.idle();const oldEdit=h.input('SEO 상품 특징').props.onChange;h.setSource({title:'白色手套',requestContext:{categoryId:'82533',categoryPath:['장갑'],features:'새 원문 메모',keywords:'흰 장갑'}});h.setVersion('2026-10-10T00:00:01.000Z');await h.idle();oldEdit({target:{value:'만료된 원문 메모'}});await h.idle();
  assert.equal(h.input('SEO 상품 특징').props.value,'새 원문 메모');assert.equal(h.input('SEO 타겟 키워드').props.value,'흰 장갑');assert.match(text(h.render()),/원문.*변경/u);
  h.button('한국어 초안 자동 작성').props.onClick();await h.idle();assert.equal(h.creates[0].source.title,'白色手套');assert.equal(h.creates[0].memo.features,'새 원문 메모');
 }finally{h.close();}
});

test('failed clock refresh keeps the memo, exposes a retry and requires fresh paid consent after recovery',async()=>{
 const h=ui({preparedAi:true});try{await h.idle();h.input('SEO 브랜드').props.onChange({target:{value:'보존 브랜드'}});await h.idle();const oldConsent=h.consent().props.onChange;oldConsent({target:{checked:true}});await h.idle();assert.equal(h.consent().props.checked,true);
  h.setRegistrationError(true);h.setVersion('2026-10-10T00:00:01.000Z');await h.idle();assert.equal(h.input('SEO 브랜드').props.value,'보존 브랜드');assert.equal(h.button('AI로 자동 생성').props.disabled,true);assert.equal(h.button('수집 원문 다시 조회').props.disabled,false);h.setRegistrationError(false);h.button('수집 원문 다시 조회').props.onClick();await h.idle();oldConsent({target:{checked:true}});await h.idle();assert.equal(h.consent().props.checked,false);assert.equal(h.input('SEO 브랜드').props.value,'보존 브랜드');h.button('AI로 자동 생성').props.onClick();await h.idle();assert.equal(h.runs[0].controls.confirmAi,false);
 }finally{h.close();}
});

test('SEO generation screen reads saved URL/category and shows account brand, features and keywords without product writes',async()=>{
 const h=ui();try{await h.idle();assert.equal(h.calls.length,5);assert.ok(h.calls.every(call=>!call.init.method&&call.init.cache==='no-store'));assert.equal(h.input('SEO 브랜드').props.value,'와이홉');assert.equal(h.input('SEO 상품 특징').props.value,'보온');assert.equal(h.input('SEO 타겟 키워드').props.value,'면장갑');assert.equal(h.runs.length,0);assert.match(text(h.render()),/무료 Google 번역/);}finally{h.close();}
});
test('SEO generation button blocks unsaved workspace, sends edited memo and deduplicates an in-flight click without saving products',async()=>{
 const pending=deferred(),h=ui({allowed:false,pending});try{await h.idle();h.button('한국어 초안 자동 작성').props.onClick();assert.equal(h.creates.length,0);h.setAllowed(true);
  h.input('SEO 상품 특징').props.onChange({target:{value:'직접 검토 특징'}});await h.idle();const click=h.button('한국어 초안 자동 작성').props.onClick;click();click();assert.equal(h.runs.length,1);assert.equal(h.creates[0].memo.features,'직접 검토 특징');assert.equal(h.creates[0].source.title,'黑色手套');assert.equal(h.creates[0].source.category.id,'82533');
  pending.resolve();await h.idle();assert.match(text(h.render()),/검정 면장갑/);assert.ok(h.calls.every(call=>!call.init.method));assert.equal(h.input('SEO 상품 특징').props.disabled,true);
 }finally{h.close();}
});
test('invalid persisted execution state cannot silently become a new SEO request',async()=>{
 const h=ui({storageValue:'corrupt execution record'});try{await h.idle();assert.equal(h.button('한국어 초안 자동 작성').props.disabled,true);h.button('한국어 초안 자동 작성').props.onClick();assert.equal(h.runs.length,0);assert.match(text(h.render()),/복구 정보/);}finally{h.close();}
});
test('closing a pending SEO request aborts it and suppresses late completion state',async()=>{
 const pending=deferred(),h=ui({pending});await h.idle();h.button('한국어 초안 자동 작성').props.onClick();h.close();pending.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.runs[0].controls.signal.aborted,true);assert.equal(h.lateWrites,0);
});
test('captured registration company mismatch blocks generation without replacing source or settings',async()=>{
 const h=ui({registrationError:true});try{await h.idle();assert.match(text(h.render()),/로그인 회사와 수집 회사/);assert.equal(h.button('초안 작성').props.disabled,true);h.button('초안 작성').props.onClick();assert.equal(h.creates.length,0);assert.equal(h.runs.length,0);assert.ok(h.calls.every(call=>!call.init.method));}finally{h.close();}
});
test('a prepared AI request can return to editable inputs without requiring paid execution or deleting saved history',async()=>{
 const h=ui({preparedAi:true});try{await h.idle();h.button('AI로 자동 생성').props.onClick();await h.idle();assert.equal(h.runs.length,1);assert.equal(h.runs[0].controls.confirmAi,false);
  assert.equal(h.button('새 초안 입력').props.disabled,false);h.button('새 초안 입력').props.onClick();await h.idle();assert.equal(h.input('SEO 상품 특징').props.disabled,false);assert.equal(h.runs.length,1);assert.ok(h.calls.every(call=>!call.init.method));
 }finally{h.close();}
});

test('Google result offers the edited brand, short feature and target as an explicit editable SEO composition without saving',async()=>{
 const h=ui();try{await h.idle();h.input('SEO 브랜드').props.onChange({target:{value:'현재 브랜드'}});h.input('SEO 상품 특징').props.onChange({target:{value:'보온'}});h.input('SEO 타겟 키워드').props.onChange({target:{value:'장갑, 겨울용'}});await h.idle();h.button('한국어 초안 자동 작성').props.onClick();await h.idle();
  assert.equal(h.input('SEO 구성 상품명').props.value,'현재 브랜드 보온 검정 면장갑 겨울용');assert.deepEqual(plain(h.integrated().props.seoComposition),{brand:'현재 브랜드',features:'보온',keywords:'장갑, 겨울용',title:'현재 브랜드 보온 검정 면장갑 겨울용',replaceTitle:false,replaceKeywords:false});
  assert.equal(h.integrated().props.disabled,false);assert.ok(h.calls.every(call=>!call.init.method));h.input('SEO 구성 상품명').props.onChange({target:{value:'사용자가 직접 다듬은 상품명'}});await h.idle();assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(h.integrated().props.seoComposition.title,'사용자가 직접 다듬은 상품명');
  h.setActive(false);await h.idle();h.setActive(true);await h.idle();assert.equal(h.input('SEO 구성 상품명').props.value,'사용자가 직접 다듬은 상품명');assert.equal(h.runs.length,1);
 }finally{h.close();}
});
test('long specification guidance keeps its original memo and allows a manually short composition or translation-only review',async()=>{
 const h=ui();try{await h.idle();const features='기존 사양 메모 '.repeat(120);h.input('SEO 상품 특징').props.onChange({target:{value:features}});await h.idle();h.button('한국어 초안 자동 작성').props.onClick();await h.idle();
  assert.equal(h.input('SEO 구성 상품명').props.value,'');assert.equal(h.integrated().props.disabled,true);assert.equal(h.input('SEO 상품 특징').props.value,features);
  h.input('SEO 구성 상품명').props.onChange({target:{value:'와이홉 짧게 선택한 보온 면장갑'}});await h.idle();assert.equal(h.integrated().props.disabled,false);assert.equal(h.integrated().props.seoComposition.features,features);
  h.input('SEO 구성 타겟 검색태그').props.onChange({target:{value:'가'.repeat(21)}});await h.idle();assert.equal(h.integrated().props.disabled,true);assert.match(text(h.render()),/태그별 20자/);
  h.input('사용자 SEO 구성안 적용').props.onChange({target:{checked:false}});await h.idle();assert.equal(h.integrated().props.disabled,false);assert.equal(h.integrated().props.seoComposition,undefined);
 }finally{h.close();}
});
test('saved SEO replacement defaults off, displays exact saved text/blank and locks all composition edits during child review/save',async()=>{
 const h=ui({savedSeo:{title:{value:'기존 저장 상품명',provenance:'manual'},keywords:{value:[],provenance:'manual'}}});try{await h.idle();h.button('한국어 초안 자동 작성').props.onClick();await h.idle();assert.match(text(h.render()),/기존 저장 상품명/);assert.match(text(h.render()),/직접 저장한 공란/);
  assert.equal(h.input('저장된 상품명 교체').props.checked,false);assert.equal(h.input('저장된 검색태그 교체').props.checked,false);h.input('저장된 상품명 교체').props.onChange({target:{checked:true}});await h.idle();
  const input=h.input('SEO 구성 상품명'),flag=h.input('저장된 검색태그 교체'),newRequest=h.button('새 초안 입력').props.onClick,integrated=h.integrated();integrated.props.onBusyChange(true);await h.idle();assert.equal(h.render().props['data-workspace-saving'],true);assert.equal(h.button('새 초안 입력').props.disabled,true);
  input.props.onChange({target:{value:'저장 중 변경 금지'}});flag.props.onChange({target:{checked:true}});newRequest();await h.idle();assert.equal(h.input('SEO 구성 상품명').props.value,input.props.value);assert.equal(h.input('저장된 검색태그 교체').props.checked,false);assert.equal(h.integrated().props.seoComposition.replaceTitle,true);assert.equal(h.runs.length,1);
  integrated.props.onBusyChange(false);await h.idle();assert.equal(h.render().props['data-workspace-saving'],false);h.input('저장된 검색태그 교체').props.onChange({target:{checked:true}});await h.idle();assert.equal(h.integrated().props.seoComposition.replaceKeywords,true);
 }finally{h.close();}
});

const sessionCache=compositionModule('app/seo-guidance-session.ts');
const guidanceLabels=['SEO 브랜드','SEO 상품 특징','SEO 타겟 키워드'];
const guidanceValues=h=>guidanceLabels.map(label=>h.input(label).props.value);
const guidanceEdit=(h,index,value)=>h.input(guidanceLabels[index]).props.onChange({target:{value}});
const guidanceBlur=(h,index)=>{const input=h.input(guidanceLabels[index]);input.props.onBlur({target:{value:input.props.value}});h.render();};
const assertGuidanceReadOnly=h=>{assert.ok(h.calls.every(call=>!call.init?.method||call.init.method==='GET'));assert.equal(h.runs.length,0);assert.equal(h.storage.size,0);};
const guidanceCompanies=[{owner:'waihop-owner',code:'A01464742',name:'와이홉'},{owner:'unand-owner',code:'A01526306',name:'유앤채'}];

for(const company of guidanceCompanies){
 const options={workspaceOwnerId:company.owner,brand:company.name,registrationBrand:company.name+', 기본 보조'},other=guidanceCompanies.find(value=>value.owner!==company.owner);
 test(`finalized feature and target blanks survive real generator close/reopen while default brand wins only at initialization (${company.code})`,async()=>{
  sessionCache.setSeoGuidanceSessionOwner(undefined);let h=ui(options);try{
   await h.idle();guidanceEdit(h,0,'직접 브랜드, 직접 보조');guidanceEdit(h,1,'');guidanceEdit(h,2,'');
   assert.equal(h.render().props['data-workspace-dirty'],true);for(let index=0;index<3;index++)guidanceBlur(h,index);
   assert.deepEqual(guidanceValues(h),['직접 브랜드, 직접 보조','','']);assert.equal(h.render().props['data-workspace-dirty'],false);assertGuidanceReadOnly(h);assert.equal(h.calls.length,5);
   h.close();h=ui(options);await h.idle();assert.deepEqual(guidanceValues(h),[company.name,'','']);assert.equal(h.render().props['data-workspace-dirty'],false);assertGuidanceReadOnly(h);assert.equal(h.calls.length,5);
  }finally{h.close();}
 });
 test(`without a default brand reopened input uses the finalized product brand first comma segment (${company.code})`,async()=>{
  sessionCache.setSeoGuidanceSessionOwner(undefined);let h=ui({...options,registrationBrand:''});try{
   await h.idle();assert.equal(h.input('SEO 브랜드').props.value,'');guidanceEdit(h,0,' 직접 브랜드 , 둘째');guidanceEdit(h,1,'  직접 특징\n둘째 줄  ');guidanceBlur(h,0);guidanceBlur(h,1);
   assert.equal(h.input('SEO 브랜드').props.value,' 직접 브랜드 , 둘째');h.close();h=ui({...options,registrationBrand:''});await h.idle();
   assert.deepEqual(guidanceValues(h),[' 직접 브랜드 ','  직접 특징\n둘째 줄  ','면장갑']);assertGuidanceReadOnly(h);
  }finally{h.close();}
 });
 test(`an explicit brand blank remains raw in the opened session and generation snapshot but default brand returns on reopen (${company.code})`,async()=>{
  sessionCache.setSeoGuidanceSessionOwner(undefined);let h=ui(options);try{
   await h.idle();guidanceEdit(h,0,'');guidanceBlur(h,0);assert.equal(h.input('SEO 브랜드').props.value,'');assert.equal(h.render().props['data-workspace-dirty'],false);
   h.button('한국어 초안 자동 작성').props.onClick();await h.idle();assert.equal(h.creates[0].memo.brand,'');assert.equal(h.input('SEO 브랜드').props.value,'');
   h.close();h=ui(options);await h.idle();assert.equal(h.input('SEO 브랜드').props.value,company.name);assertGuidanceReadOnly(h);
  }finally{h.close();}
 });
 test(`one blur cannot cache or clean the other unfinalized fields and old unmounted blur callbacks are inert (${company.code})`,async()=>{
  sessionCache.setSeoGuidanceSessionOwner(undefined);let h=ui(options);try{
   await h.idle();guidanceEdit(h,0,'미확정 브랜드');guidanceEdit(h,1,'확정 특징');guidanceEdit(h,2,'미확정 타겟');guidanceBlur(h,1);
   assert.equal(h.render().props['data-workspace-dirty'],true);const old=h.input('SEO 타겟 키워드').props.onBlur,first=h;h.close();h=ui(options);await h.idle();
   old({target:{value:'미확정 타겟'}});assert.equal(first.lateWrites,0);assert.deepEqual(guidanceValues(h),[company.name,'확정 특징','면장갑']);assertGuidanceReadOnly(h);
  }finally{h.close();}
 });
 test(`same-source version refresh preserves raw edits, confirmed blanks and the current raw brand until reopen (${company.code})`,async()=>{
  sessionCache.setSeoGuidanceSessionOwner(undefined);let h=ui(options);try{
   await h.idle();guidanceEdit(h,0,'현재 브랜드, 현재 보조');guidanceEdit(h,1,'확정 특징');guidanceEdit(h,2,'');guidanceBlur(h,1);guidanceBlur(h,2);const stale=h.input('SEO 브랜드').props.onBlur;
   h.setVersion('2026-10-10T00:00:02.000Z');await h.idle();stale({target:{value:'현재 브랜드, 현재 보조'}});
   assert.deepEqual(guidanceValues(h),['현재 브랜드, 현재 보조','확정 특징','']);assert.equal(h.render().props['data-workspace-dirty'],true);guidanceBlur(h,0);assert.equal(h.render().props['data-workspace-dirty'],false);
   assert.equal(h.calls.length,10);assertGuidanceReadOnly(h);h.close();h=ui({...options,productVersion:'2026-10-10T00:00:02.000Z'});await h.idle();assert.deepEqual(guidanceValues(h),[company.name,'확정 특징','']);assertGuidanceReadOnly(h);
  }finally{h.close();}
 });
 test(`changed captured guidance defaults reset both finalized and raw memo, retire old callbacks and cannot resurrect its old cache (${company.code})`,async()=>{
  sessionCache.setSeoGuidanceSessionOwner(undefined);let h=ui(options);try{
   await h.idle();guidanceEdit(h,1,'이전 확정 특징');guidanceEdit(h,2,'이전 확정 타겟');guidanceBlur(h,1);guidanceBlur(h,2);guidanceEdit(h,1,'이전 미확정 특징');const stale=h.input('SEO 상품 특징').props.onBlur;
   h.setSource({requestContext:{categoryId:'82533',categoryPath:['장갑'],features:'새 원문 특징',keywords:'새 원문 타겟'}});h.setVersion('2026-10-10T00:00:03.000Z');await h.idle();stale({target:{value:'이전 미확정 특징'}});
   assert.deepEqual(guidanceValues(h),[company.name,'새 원문 특징','새 원문 타겟']);assert.match(text(h.render()),/수집 원문이 변경/);assert.equal(h.render().props['data-workspace-dirty'],false);
   h.setSource({requestContext:{categoryId:'82533',categoryPath:['장갑'],features:'보온',keywords:'면장갑'}});h.setVersion('2026-10-10T00:00:04.000Z');await h.idle();assert.deepEqual(guidanceValues(h),[company.name,'보온','면장갑']);assertGuidanceReadOnly(h);
  }finally{h.close();}
 });
 test(`owner A/B/A retires cached memo and rejects old callbacks at the layout boundary before passive work (${company.code})`,async()=>{
  sessionCache.setSeoGuidanceSessionOwner(undefined);const h=ui(options);try{
   await h.idle();guidanceEdit(h,1,'이전 계정 특징');guidanceBlur(h,1);const old=h.input('SEO 상품 특징').props;
   h.setOwner(other.owner);h.setRegistrationBrand(other.name+', 보조');h.render(false);const count=h.calls.length;old.onChange({target:{value:'이전 계정 재입력'}});old.onBlur({target:{value:'이전 계정 특징'}});assert.equal(h.calls.length,count);await h.idle();
   assert.deepEqual(guidanceValues(h),[other.name,'보온','면장갑']);guidanceEdit(h,1,'다른 계정 특징');guidanceBlur(h,1);const foreign=h.input('SEO 상품 특징').props.onBlur;
   h.setOwner(company.owner);h.setRegistrationBrand(options.registrationBrand);h.render(false);old.onBlur({target:{value:'이전 계정 특징'}});foreign({target:{value:'다른 계정 특징'}});await h.idle();
   assert.deepEqual(guidanceValues(h),[company.name,'보온','면장갑']);assertGuidanceReadOnly(h);assert.equal(h.calls.length,15);
  }finally{h.close();}
 });
 test(`hidden-stage layout rejects an older blur while retaining its raw unfinalized field until a current blur (${company.code})`,async()=>{
  sessionCache.setSeoGuidanceSessionOwner(undefined);let h=ui(options);try{
   await h.idle();guidanceEdit(h,1,'현재 미확정 특징');const stale=h.input('SEO 상품 특징').props.onBlur;h.setActive(false);h.render(false);stale({target:{value:'현재 미확정 특징'}});
   assert.equal(h.render().props['data-workspace-dirty'],true);h.setActive(true);await h.idle();assert.equal(h.input('SEO 상품 특징').props.value,'현재 미확정 특징');guidanceBlur(h,1);assert.equal(h.render().props['data-workspace-dirty'],false);
   assert.equal(h.calls.length,5);h.close();h=ui(options);await h.idle();assert.equal(h.input('SEO 상품 특징').props.value,'현재 미확정 특징');assertGuidanceReadOnly(h);
  }finally{h.close();}
 });
 test(`started and recovered request snapshots keep their raw memo without publishing it into the blur cache (${company.code})`,async()=>{
  sessionCache.setSeoGuidanceSessionOwner(undefined);const waiting=deferred();let h=ui({...options,pending:waiting});try{
   await h.idle();guidanceEdit(h,1,'확정 세션 특징');guidanceBlur(h,1);const stale=h.input('SEO 상품 특징').props.onBlur;guidanceEdit(h,1,'시작한 요청 특징');
   h.button('한국어 초안 자동 작성').props.onClick();stale({target:{value:'시작한 요청 특징'}});assert.equal(h.runs.length,1);const proof=h.storage.get('yoofam-seo-workspace:p');assert.equal(JSON.parse(proof).memo.features,'시작한 요청 특징');
   const first=h;h.close();waiting.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(first.lateWrites,0);h=ui({...options,storageValue:proof});await h.idle();
   assert.equal(h.input('SEO 상품 특징').props.value,'시작한 요청 특징');assert.equal(h.input('SEO 상품 특징').props.disabled,true);h.input('SEO 상품 특징').props.onBlur({target:{value:'시작한 요청 특징'}});
   assert.equal(h.storage.get('yoofam-seo-workspace:p'),proof);assert.equal(h.runs.length,0);h.close();h=ui(options);await h.idle();assert.equal(h.input('SEO 상품 특징').props.value,'확정 세션 특징');assertGuidanceReadOnly(h);
  }finally{waiting.resolve();h.close();}
 });
 test(`legacy ownerless generator keeps raw edits dirty and performs no memo retention on blur (${company.code})`,async()=>{
  sessionCache.setSeoGuidanceSessionOwner(undefined);let h=ui({...options,workspaceOwnerId:undefined});try{
   await h.idle();guidanceEdit(h,1,'보관할 수 없는 입력');guidanceBlur(h,1);assert.equal(h.render().props['data-workspace-dirty'],true);assertGuidanceReadOnly(h);
   h.close();h=ui({...options,workspaceOwnerId:undefined});await h.idle();assert.equal(h.input('SEO 상품 특징').props.value,'보온');assertGuidanceReadOnly(h);
  }finally{h.close();}
 });
}
