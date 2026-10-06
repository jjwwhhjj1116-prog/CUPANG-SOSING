import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
// Actual dashboard render/state wiring; child components and initial workspace
// effects are isolated here. The seeded queue and real API have separate tests.
function fixture(){
 const slots=[],cache=new Map();let index=0;
 const draft={rows:[{id:'existing',url:'https://detail.1688.com/offer/1.html',features:'직접 입력',keywords:'수동',status:'draft'}],goal:'work',ready:true,loading:false,saving:false,dirty:true,message:'직접 입력 보존',setRows(fn){this.rows=fn(this.rows);},setGoal(value){this.goal=value;},save(){},load(){}};
 const hooks={useState(initial){const slot=index++;if(!(slot in slots))slots[slot]=typeof initial==='function'?initial():initial;return[slots[slot],value=>slots[slot]=typeof value==='function'?value(slots[slot]):value];},useRef(initial){const slot=index++;return slots[slot]??(slots[slot]={current:initial});},useCallback(fn){return fn;},useEffect(){}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,URL,AbortController,crypto,structuredClone,window:{confirm:()=>false},require(name){
  if(name==='react')return hooks;
  if(name==='@/app/components/use-intake-draft')return{useIntakeDraft:()=>draft};
  if(name.startsWith('@/app/components/')){const component=()=>null;component.displayName=name.slice('@/app/components/'.length);return new Proxy({default:component},{get(target,key){return key in target?target[key]:component;}});}
  if(name==='@/app/load-category-profiles')return{loadCategoryProfiles:async()=>[]};
  return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);
 }});return exports;}
 const Dashboard=load('app/components/dashboard-client.tsx').default;
 const render=()=>{index=0;return Dashboard({userName:'와이홉'});};
 const component=name=>nodes(render()).find(node=>node.type?.displayName===name);
 const modal=()=>nodes(render()).find(node=>node.type?.name==='Modal'&&node.props.title==='상품 대기열');
 const target={sourceUrl:'https://detail.1688.com/offer/813724060928.html',registrationId:'260719001001',company:{code:'A01464742',name:'와이홉'},accountContext:'verified-owner-company'};
 return{draft,render,component,modal,target,reuse(signal=new AbortController().signal){return component('historical-ai-registrations-panel').props.onReuseUrl(target,signal);}};
}

test('historical URL opens category-first intake without altering pending rows or the selected goal',()=>{
 const h=fixture(),before=JSON.stringify(h.draft);assert.equal(h.modal(),undefined);h.reuse();
 const queue=h.component('intake-queue-panel');assert.ok(h.modal());assert.equal(queue.props.sourceSeed.sourceUrl,h.target.sourceUrl);assert.equal(queue.props.sourceSeed.id.length,36);
 assert.deepEqual(Object.keys(queue.props.sourceSeed).sort(),['id','sourceUrl']);assert.equal(JSON.stringify(h.draft),before);assert.equal(queue.props.goal,'work');
 assert.throws(()=>h.reuse(),/현재 상품 대기열/);
});

test('aborted, loading, saving and full-queue callbacks do not open the intake modal',()=>{
 for(const mode of ['aborted','loading','saving','not-ready','full']){
  const h=fixture(),controller=new AbortController();if(mode==='aborted')controller.abort();if(mode==='loading')h.draft.loading=true;if(mode==='saving')h.draft.saving=true;if(mode==='not-ready')h.draft.ready=false;if(mode==='full')h.draft.rows=Array.from({length:50},()=>({url:'preserved'}));
  const before=JSON.stringify(h.draft);
  if(mode==='aborted')h.reuse(controller.signal);else assert.throws(()=>h.reuse(),mode==='full'?/최대 50행/:/현재 상품 대기열/);
  assert.equal(h.modal(),undefined);assert.equal(JSON.stringify(h.draft),before);
 }
});

test('cancel removes a pending URL and a stale consumed callback cannot clear a later selection',()=>{
 const h=fixture();h.reuse();const first=h.component('intake-queue-panel'),id=first.props.sourceSeed.id;
 h.modal().props.onClose();assert.equal(h.modal(),undefined);h.reuse();const next=h.component('intake-queue-panel');assert.notEqual(next.props.sourceSeed.id,id);
 first.props.onSourceConsumed(id);assert.equal(h.component('intake-queue-panel').props.sourceSeed.id,next.props.sourceSeed.id);
 next.props.onSourceConsumed(next.props.sourceSeed.id);assert.equal(h.component('intake-queue-panel').props.sourceSeed,undefined);assert.equal(h.draft.rows.length,1);
});
