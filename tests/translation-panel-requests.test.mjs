import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const label=t=>Array.isArray(t)?t.map(label).join(''):typeof t==='string'||typeof t==='number'?String(t):'';
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function harness(handler,status='completed',failInitial=false){
 const slots=[],effects=[],cleanup=[],calls=[];let index=0,first=true,closed=false,late=0,saved=0;
 const content={revision:1,seo:Object.fromEntries(['title','description','keywords'].map(k=>[k,{value:k==='keywords'?[]:'manual'}]))};
 const job={id:'j',status,productVersion:'v',contentRevision:1,review:{model:'mock',inputCharacters:1,maxOutputTokens:1000,expiresAt:'2026-09-24',source:{}},result:status==='completed'?{draft:{title:'초안',description:'설명',keywords:[],attributes:[{name:'색상',value:'검정'}],warnings:[]}}:null};
 const view={jobs:[job],configuration:{configured:true,issues:[]}};
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{if(closed)late++;slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(initial){const i=index++;return slots[i]??(slots[i]={current:initial});},useEffect(fn){if(first)effects.push(fn);}};
 let initial=0;
 const fetcher=async(url,init)=>{if(initial<2){initial++;return failInitial?Response.json({error:'초기 조회 실패'},{status:503}):Response.json(url.endsWith('/translation')?view:{content});}calls.push({url,init});return handler(url,init,{content,job,view});};
 const exports={};const file='app/components/translation-panel.tsx';
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,crypto,fetch:fetcher,require(name){if(name==='react')return hooks;if(name==='@/app/option-translation')return{optionTranslationAttributes:()=>[],adoptOptionTranslations:()=>({rows:[],changed:1})};if(name==='@/app/translation-adoption')return{translationSeoFields:['title','description','keywords'],translationAdoptionInput:()=>({patch:'mock'})};if(name==='@/app/collected-translation-attributes')return{collectedTranslationAttributes:()=>[]};return native(name);}});
 const render=()=>{index=0;const wrapper=exports.default({productId:'p',version:'v',title:'원문',onContentSaved(){saved++;}});const tree=wrapper.type(wrapper.props);first=false;return tree;};
 const buttons=()=>nodes(render()).filter(n=>n.type==='button');
 render();effects.forEach(fn=>cleanup.push(fn()));
 return{calls,render,button(name){const button=buttons().find(n=>label(n.props.children)===name);assert.ok(button,name);return button.props.onClick;},close(){closed=true;cleanup.forEach(fn=>fn?.());},get late(){return late;},get saved(){return saved;}};
}
const collect='수집 원문 불러오기 · 상품명·설명·상품 속성 입력 교체';
const options='미번역 옵션 불러오기 · 속성 입력 교체';
const prepare='번역 요청 검토하기 · 무료';
const execute='승인한 번역 1회 실행 · 비용 발생';
const adopt='검토한 초안을 이 항목에 적용 · 기존 내용 교체';
const adoptOptions='검토한 옵션 번역 적용 · 미번역 이름·수집 속성';

test('translation actions lock before rerender across prepare, execute, source and adoption; failures permit explicit retry',async()=>{
 for(const [action,status] of [[prepare,'completed'],[execute,'approved'],[adopt,'completed']]){
  const pending=deferred();let attempt=0;
  const h=harness(async(_url,_init,data)=>++attempt===1?pending.promise:Response.json({job:data.job,content:data.content}),status);await settle();
  const click=h.button(action),other=h.button(collect);click();click();other();assert.equal(h.calls.length,1);
  pending.resolve(Response.json({error:'일시 실패'},{status:503}));await settle();assert.match(JSON.stringify(h.render()),/일시 실패/);
  h.button(action)();await settle();assert.equal(h.calls.length,2);
 }
});

test('closing during source reads, paid action or content save ignores late responses and callbacks',async()=>{
 for(const [action,status] of [[collect,'completed'],[options,'completed'],[execute,'approved'],[adopt,'completed']]){
  const pending=deferred();const h=harness(()=>pending.promise,status);await settle();h.button(action)();h.close();
  assert.equal(h.calls[0].init.signal.aborted,true);
  pending.resolve(Response.json({title:'지연',description:'',attributes:[],productVersion:'v',job:{id:'late'},content:{revision:2},options:{}}));await settle();
  assert.equal(h.late,0);assert.equal(h.saved,0);assert.equal(h.calls.length,1);
 }
});

test('closing during option adoption lookup prevents a subsequent PATCH',async()=>{
 const pending=deferred();const h=harness(()=>pending.promise);await settle();const click=h.button(adoptOptions);click();click();assert.equal(h.calls.length,1);h.close();pending.resolve(Response.json({productVersion:'v',options:{revision:1}}));await settle();assert.equal(h.calls.length,1);assert.equal(h.saved,0);assert.equal(h.late,0);
});

const refresh='작업 상태 다시 조회 · 무료';
test('refresh moves a running job to completed with GET only and preserves edited source and guidance',async()=>{
 const h=harness(async(url,_init,{content,job,view})=>Response.json(url.endsWith('/content')?{content}:{...view,jobs:[{...job,status:'completed',result:{draft:{title:'서버 완료',description:'설명',keywords:[],attributes:[],warnings:[]}}}]}),'running');await settle();
 const fields=nodes(h.render()).filter(n=>n.type==='input'||n.type==='textarea');
 fields.find(n=>n.props.maxLength===1000).props.onChange({target:{value:'수동 원문'}});
 fields.find(n=>n.props.maxLength===2000).props.onChange({target:{value:'수동 참고'}});
 h.button(refresh)();await settle();
 assert.equal(h.calls.length,2);assert.ok(h.calls.every(c=>!c.init.method&&c.init.cache==='no-store'));
 assert.match(JSON.stringify(h.render()),/서버 완료/);assert.match(JSON.stringify(h.render()),/수동 원문/);assert.match(JSON.stringify(h.render()),/수동 참고/);assert.equal(h.saved,0);
});

test('refresh recovers initial failure and partial failures preserve the prior job without releasing overlapping work',async()=>{
 let fail=false;const h=harness(async(url,_init,{view,content})=>fail&&url.endsWith('/content')?Response.json({error:'콘텐츠 조회 실패'},{status:503}):Response.json(url.endsWith('/content')?{content}:view),'completed',true);await settle();assert.match(JSON.stringify(h.render()),/초기 조회 실패/);
 h.button(refresh)();await settle();assert.match(JSON.stringify(h.render()),/초안 생성 완료/);assert.doesNotMatch(JSON.stringify(h.render()),/초기 조회 실패/);
 fail=true;h.button(refresh)();await settle();assert.match(JSON.stringify(h.render()),/콘텐츠 조회 실패/);assert.match(JSON.stringify(h.render()),/초안 생성 완료/);assert.equal(h.saved,0);
});

test('refresh shares request lock and closing ignores both late state reads',async()=>{
 const pending=deferred();const h=harness(()=>pending.promise);await settle();const click=h.button(refresh);click();click();h.button(prepare)();assert.equal(h.calls.length,2);h.close();assert.ok(h.calls.every(c=>c.init.signal.aborted));pending.resolve(Response.json({jobs:[],configuration:{},content:{revision:2}}));await settle();assert.equal(h.late,0);assert.equal(h.saved,0);
});
