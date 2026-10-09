import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const plain=value=>JSON.parse(JSON.stringify(value)),deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const version='2026-10-10T00:00:00.000Z';
function ui({allowed=true,storageValue=null,pending=null,registrationError=false,preparedAi=false}={}){
 const slots=[],effects=[],layouts=[],calls=[],runs=[],creates=[],storage=new Map(storageValue?[['yoofam-seo-workspace:p',storageValue]]:[]);let cursor=0,closed=false,lateWrites=0;
 const schedule=(queue,fn,deps)=>{const i=cursor++;if(!slots[i]||JSON.stringify(slots[i].deps)!==JSON.stringify(deps)){const before=slots[i];slots[i]={deps,cleanup:before?.cleanup};queue.push(()=>{before?.cleanup?.();slots[i].cleanup=fn();});}};
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{if(closed){lateWrites++;return;}slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(fn,deps){schedule(effects,fn,deps);},useLayoutEffect(fn,deps){schedule(layouts,fn,deps);}};
 const source={productId:'p',productVersion:version,jobId:'source-job',sourceUrl:'https://detail.1688.com/offer/123456789012.html',title:'黑色手套',description:'棉',attributes:[{name:'材质',value:'棉'}],requestContext:{categoryId:'82533',categoryPath:['장갑'],features:'보온',keywords:'면장갑'}};
 const helper={createSeoWorkspaceDraftState(input){creates.push(plain(input));return{...input,memo:plain(input.memo),idempotencyKey:'key'};},parseSeoWorkspaceDraftState(){return null;},
  async runSeoWorkspaceDraft(state,controls){runs.push({state:plain(state),controls});controls.onState(state);await pending?.promise;if(controls.signal.aborted||!controls.isContextCurrent())throw Error('중단');const job=preparedAi?{id:'job',productId:'p',productVersion:version,status:'prepared',startedAt:null,result:null,error:null}:{id:'job',productId:'p',productVersion:version,status:'completed',result:{draft:{title:'검정 면장갑',keywords:['면장갑'],warnings:[]}}};controls.onJob(job);return{job,closed:!preparedAi,message:preparedAi?'생성 요청 준비':'초안 작성 완료'};},async refreshSeoWorkspaceDraft(){throw Error('Unexpected refresh');}};
 const api=async(url,init)=>{calls.push({url,init});if(url.endsWith('/translation'))return Response.json({configuration:{configured:true,model:preparedAi?'@cf/meta/llama-3.3-70b-instruct-fp8-fast':'google-translate-gtx',maxOutputTokens:preparedAi?2000:0,issues:[]},jobs:[]});
  if(url.endsWith('/content'))return Response.json({content:{productId:'p',revision:2}});if(url.endsWith('/translation-source'))return Response.json(source);
  if(url.endsWith('/registration-settings'))return registrationError?Response.json({error:'로그인 회사와 수집 회사가 다릅니다.'},{status:409}):Response.json({productId:'p',settings:{brand:'와이홉'}});
  if(url.endsWith('/options'))return Response.json({productVersion:version,options:{productId:'p',rows:[]}});throw Error(url);};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/seo-workspace-generator.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,fetch:api,AbortController,structuredClone,sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
   if(name.endsWith('.css'))return{};if(name==='@/app/seo-workspace-draft')return helper;if(name==='@/app/components/translation-integrated-preview')return{TranslationIntegratedPreview:()=>null};
   if(name==='@/app/collected-translation-attributes')return{collectedTranslationAttributes:value=>value.map(item=>({name:'상품속성: '+item.name,value:item.value}))};
   if(name==='@/app/option-translation')return{optionTranslationBatch:()=>({attributes:[],remaining:0})};if(name==='@/app/sourcing')return{collectionSourceReference:(id,url)=>id+' '+url};throw Error(name);}});
 const render=()=>{cursor=0;const root=exports.SeoWorkspaceGenerator({productId:'p',version,brand:'와이홉',active:true,beforeGenerate:()=>allowed,onSaved(){throw Error('Unexpected product save');}}),tree=root.type(root.props);layouts.splice(0).forEach(fn=>fn());effects.splice(0).forEach(fn=>fn());return tree;};
 const idle=async()=>{for(let i=0;i<10;i++){render();await new Promise(resolve=>setImmediate(resolve));}};
 render();return{render,idle,calls,runs,creates,storage,input:label=>nodes(render()).find(node=>node.type==='input'&&node.props['aria-label']===label),button:label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label),close(){closed=true;slots.forEach(slot=>slot?.cleanup?.());},get lateWrites(){return lateWrites;},setAllowed(value){allowed=value;}};
}

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
