import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const plain=value=>JSON.parse(JSON.stringify(value)),deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const version='2026-10-10T00:00:00.000Z';
const compositionModules=new Map();
function compositionModule(file){if(compositionModules.has(file))return compositionModules.get(file);const exports={};compositionModules.set(file,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,structuredClone,TextEncoder,crypto:globalThis.crypto,require:name=>compositionModule(name.slice(2)+'.ts')});return exports;}
function ui({allowed=true,storageValue=null,pending=null,registrationError=false,preparedAi=false,productId='p',productVersion=version,fetcher=null,draftHelper=null,sourceHelpers=null,savedSeo=null}={}){
 const slots=[],effects=[],layouts=[],calls=[],runs=[],creates=[],storage=new Map(storageValue?[[`yoofam-seo-workspace:${productId}`,storageValue]]:[]);let cursor=0,closed=false,lateWrites=0,lastKey,active=true;
 const schedule=(queue,fn,deps)=>{const i=cursor++;if(!slots[i]||JSON.stringify(slots[i].deps)!==JSON.stringify(deps)){const before=slots[i];slots[i]={deps,cleanup:before?.cleanup};queue.push(()=>{before?.cleanup?.();slots[i].cleanup=fn();});}};
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{if(closed){lateWrites++;return;}slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(fn,deps){schedule(effects,fn,deps);},useLayoutEffect(fn,deps){schedule(layouts,fn,deps);}};
 const source={productId,productVersion,jobId:'source-job',sourceUrl:'https://detail.1688.com/offer/123456789012.html',title:'黑色手套',description:'棉',attributes:[{name:'材质',value:'棉'}],requestContext:{categoryId:'82533',categoryPath:['장갑'],features:'보온',keywords:'면장갑'}};
 const helper={createSeoWorkspaceDraftState(input){creates.push(plain(input));return draftHelper?draftHelper.createSeoWorkspaceDraftState(input):{...input,memo:plain(input.memo),idempotencyKey:'key'};},parseSeoWorkspaceDraftState(raw,id){if(draftHelper)return draftHelper.parseSeoWorkspaceDraftState(raw,id);try{const saved=JSON.parse(raw);return saved.idempotencyKey==='key'&&saved.productId===id?saved:null;}catch{return null;}},
  async runSeoWorkspaceDraft(state,controls){runs.push({state:plain(state),controls});if(draftHelper)return draftHelper.runSeoWorkspaceDraft(state,controls);controls.onState(state);await pending?.promise;if(controls.signal.aborted||!controls.isContextCurrent())throw Error('중단');const job=preparedAi?{id:'job',productId,productVersion:state.productVersion,status:'prepared',startedAt:null,result:null,error:null}:{id:'job',productId,productVersion:state.productVersion,status:'completed',result:{draft:{title:'검정 면장갑',keywords:['면장갑'],warnings:[]}}};controls.onJob(job);return{job,closed:!preparedAi,message:preparedAi?'생성 요청 준비':'초안 작성 완료'};},async refreshSeoWorkspaceDraft(state,controls){if(draftHelper)return draftHelper.refreshSeoWorkspaceDraft(state,controls);const job={id:'job',productId,productVersion:state.productVersion,status:'completed',result:{draft:{title:'검정 면장갑',keywords:['면장갑'],warnings:[]}}};return{job,closed:true,message:'기존 초안 조회'};}};
 const api=async(url,init)=>{calls.push({url,init});if(fetcher)return fetcher(url,init);if(url.endsWith('/translation'))return Response.json({configuration:{configured:true,model:preparedAi?'@cf/meta/llama-3.3-70b-instruct-fp8-fast':'google-translate-gtx',maxOutputTokens:preparedAi?2000:0,issues:[]},jobs:[]});
  if(url.endsWith('/content'))return Response.json({content:{productId,revision:2,...(savedSeo?{seo:savedSeo}:{})}});if(url.endsWith('/translation-source'))return Response.json(source);
  if(url.endsWith('/registration-settings'))return registrationError?Response.json({error:'로그인 회사와 수집 회사가 다릅니다.'},{status:409}):Response.json({productId,settings:{brand:'와이홉'}});
  if(url.endsWith('/options'))return Response.json({productVersion,options:{productId,rows:[]}});throw Error(url);};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/seo-workspace-generator.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,fetch:api,AbortController,structuredClone,sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
   if(name.endsWith('.css'))return{};if(name==='@/app/seo-workspace-draft')return helper;if(name==='@/app/seo-guidance-composition')return compositionModule('app/seo-guidance-composition.ts');if(name==='@/app/components/translation-integrated-preview')return{TranslationIntegratedPreview:()=>null};
   if(sourceHelpers?.[name])return sourceHelpers[name];if(name==='@/app/collected-translation-attributes')return{collectedTranslationAttributes:value=>value.map(item=>({name:'상품속성: '+item.name,value:item.value}))};
   if(name==='@/app/option-translation')return{optionTranslationBatch:()=>({attributes:[],remaining:0})};if(name==='@/app/sourcing')return{collectionSourceReference:(id,url)=>id+' '+url};throw Error(name);}});
 const render=()=>{cursor=0;const root=exports.SeoWorkspaceGenerator({productId,version:productVersion,brand:'와이홉',active,beforeGenerate:()=>allowed,onSaved(){throw Error('Unexpected product save');}});if(lastKey!==undefined&&lastKey!==root.key){slots.forEach(slot=>slot?.cleanup?.());slots.splice(0);effects.splice(0);layouts.splice(0);}lastKey=root.key;const tree=root.type(root.props);layouts.splice(0).forEach(fn=>fn());effects.splice(0).forEach(fn=>fn());return tree;};
 const idle=async()=>{for(let i=0;i<10;i++){render();await new Promise(resolve=>setImmediate(resolve));}};
 const until=async(predicate)=>{const deadline=Date.now()+5000;while(!predicate()){assert.ok(Date.now()<deadline,'component did not reach the expected bounded state');render();await new Promise(resolve=>setImmediate(resolve));}};
 render();return{render,idle,until,calls,runs,creates,storage,input:label=>nodes(render()).find(node=>node.type==='input'&&node.props['aria-label']===label),integrated:()=>nodes(render()).find(node=>node.props?.jobId),button:label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label),consent:()=>nodes(render()).find(node=>node.type==='input'&&node.props.type==='checkbox'),close(){closed=true;slots.forEach(slot=>slot?.cleanup?.());},get lateWrites(){return lateWrites;},setAllowed(value){allowed=value;},setRegistrationError(value){registrationError=value;},setVersion(value){productVersion=value;source.productVersion=value;},setSource(value){Object.assign(source,value);},setProduct(id,value){productId=id;productVersion=value;source.productId=id;source.productVersion=value;},setActive(value){active=value;}};
}

test('unsubmitted SEO brand, features and keyword edits survive a same-source clock refresh and stage navigation',async()=>{
 const h=ui();try{await h.idle();h.input('SEO 브랜드').props.onChange({target:{value:'직접 브랜드'}});h.input('SEO 상품 특징').props.onChange({target:{value:'직접 특징'}});h.input('SEO 타겟 키워드').props.onChange({target:{value:''}});await h.idle();
  h.setActive(false);await h.idle();h.setVersion('2026-10-10T00:00:01.000Z');await h.idle();h.setActive(true);await h.idle();
  assert.deepEqual(['SEO 브랜드','SEO 상품 특징','SEO 타겟 키워드'].map(label=>h.input(label).props.value),['직접 브랜드','직접 특징','']);
  assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(h.render().props['data-seo-generation-input'],true);
  assert.equal(h.runs.length,0);assert.equal(h.storage.size,0);assert.equal(h.calls.length,10,'the new clock refreshes the actual saved basis');
  h.button('한국어 초안 자동 작성').props.onClick();await h.idle();assert.equal(h.creates[0].productVersion,'2026-10-10T00:00:01.000Z');assert.deepEqual(h.creates[0].memo,{brand:'직접 브랜드',features:'직접 특징',keywords:''});
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
  h.setVersion(updated);await h.until(()=>!!h.button('AI로 자동 생성')&&!h.button('AI로 자동 생성').props.disabled);assert.deepEqual(['SEO 브랜드','SEO 상품 특징','SEO 타겟 키워드'].map(label=>h.input(label).props.value),['수동 브랜드','저장 후 보존할 특징','']);
  h.button('AI로 자동 생성').props.onClick();await h.until(()=>!!h.button('같은 초안 요청 확인')&&!h.button('같은 초안 요청 확인').props.disabled);const operation=JSON.parse(h.storage.get(`yoofam-seo-workspace:${product.id}`));assert.equal(operation.prepareSubmitted,true);assert.equal(operation.executeSubmitted,false);assert.equal(preparations.length,1);h.button('같은 초안 요청 확인').props.onClick();await h.until(()=>!!h.button('새 초안 입력')&&!h.button('새 초안 입력').props.disabled);const job=api.sqlite.prepare('SELECT * FROM translation_jobs').get(),current=(await json(await api.route(base+'/content'))).content;
  assert.equal(job.product_version,updated);assert.equal(job.content_revision,current.revision);assert.equal(job.status,'prepared');assert.equal(h.creates[0].productVersion,updated);assert.deepEqual(h.creates[0].memo,{brand:'수동 브랜드',features:'저장 후 보존할 특징',keywords:''});assert.equal(api.aiSources.length,0,'unapproved preparation makes no provider call');assert.equal(retained(),before);assert.equal(JSON.stringify([...api.objects].map(([key,bytes])=>[key,[...bytes]])),objects);
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
