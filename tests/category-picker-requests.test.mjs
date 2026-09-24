import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
const pending=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
function harness(request,existing=false){
 const slots=[],cleanup=[],calls=[],selected=[];let index=0,first=true,closed=false,late=0;
 const choice={key:'saved',profileId:existing?'saved':null,path:['test'],categoryId:'80719',isLeaf:true};
 const hooks={useMemo:fn=>fn(),useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{if(closed)late++;slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(initial){const i=index++;return slots[i]??(slots[i]={current:initial});},useEffect(fn){if(first)cleanup.push(fn());}};
 const exports={};const file='app/components/category-picker.tsx';
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,fetch:(url,init)=>{calls.push(init);return request(url,init);},require(name){
  if(name==='react')return hooks;
  if(name.endsWith('.css'))return{};
  if(name==='@/app/category-profiles')return{usableCategoryCode:()=>true};
  if(name==='@/app/quotation-schema')return{getQuotationSchema:()=>({fields:[],status:'observed'})};
  if(name==='@/app/components/category-quotation-preview')return{CategoryQuotationPreview:()=>null};
  if(name==='@/app/category-catalog')return{categoryChoices:()=>[choice],canConfirmCategory:()=>true,categoryAdvancedSeed:()=>({}),categoryChoicesAtPath:()=>[choice],categoryLevel:()=>[],categoryObservationScope:{},categoryProfileForChoice:()=>({categoryId:'80719'}),searchCategoryChoices:()=>[]};
  return native(name);
 }});
 const render=()=>{index=0;const tree=exports.CategoryPicker({profiles:existing?[{id:'saved',categoryPath:['test']}]:[],selectedId:'saved',onSelected:p=>selected.push(p),onAdvanced(){}});first=false;return tree;};
 const confirm=()=>nodes(render()).find(n=>n.type==='button'&&String(n.props.children).includes('URL 입력')).props.onClick;
 return{calls,selected,render,confirm,close(){closed=true;cleanup.forEach(fn=>fn?.());},get late(){return late;}};
}
test('category confirmation creates one profile and reports one selection despite repeated clicks',async()=>{
 const wait=pending(),h=harness(()=>wait.promise),click=h.confirm();click();click();assert.equal(h.calls.length,1);
 wait.resolve(Response.json({profile:{id:'new',categoryId:'80719'}}));await settle();click();assert.equal(h.calls.length,1);assert.equal(h.selected.length,1);
 const saved=harness(()=>{throw Error('existing profile must not write');},true),choose=saved.confirm();choose();choose();assert.equal(saved.selected.length,1);assert.equal(saved.calls.length,0);
});
test('failed category save unlocks retry while closing the picker ignores a late successful response',async()=>{
 let attempt=0;const h=harness(async()=>++attempt===1?Response.json({error:'저장 실패'},{status:500}):Response.json({profile:{id:'new'}}));
 h.confirm()();await settle();assert.match(JSON.stringify(h.render()),/저장 실패/);h.confirm()();await settle();assert.equal(h.selected.length,1);assert.equal(h.calls.length,2);
 const wait=pending(),closed=harness(()=>wait.promise);closed.confirm()();closed.close();assert.equal(closed.calls[0].signal.aborted,true);
 wait.resolve(Response.json({profile:{id:'late'}}));await settle();assert.equal(closed.selected.length,0);assert.equal(closed.late,0);
});
