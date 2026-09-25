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
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,crypto,AbortController,fetch:(url,init)=>{calls.push(init);return request(url,init);},require(name){
  if(name==='react')return hooks;
  if(name.endsWith('.css'))return{};
  if(name==='@/app/category-profiles')return{usableCategoryCode:()=>true};
  if(name==='@/app/quotation-schema')return{getQuotationSchema:()=>({fields:[],status:'observed'})};
  if(name==='@/app/components/category-quotation-preview')return{CategoryQuotationPreview:()=>null};
  if(name==='@/app/category-catalog')return{categoryChoices:profiles=>existing?profiles.map(profile=>({...choice,path:profile.categoryPath,categoryId:profile.categoryId})): [choice],canConfirmCategory:()=>true,categoryAdvancedSeed:()=>({}),categoryChoicesAtPath:()=>[choice],categoryLevel:()=>[],categoryObservationScope:{},categoryProfileForChoice:()=>({categoryId:'80719'}),searchCategoryChoices:()=>[]};
  return native(name);
 }});
 const render=()=>{index=0;const tree=exports.CategoryPicker({profiles:existing?[{id:'saved',categoryId:'80719',categoryPath:['test'],revision:1}]:[],selectedId:'saved',onSelected:p=>selected.push(p),onAdvanced(){}});first=false;return tree;};
 const confirm=()=>nodes(render()).find(n=>n.type==='button'&&String(n.props.children).includes('URL 입력')).props.onClick;
 return{calls,selected,render,confirm,close(){closed=true;cleanup.forEach(fn=>fn?.());},get late(){return late;}};
}
test('category confirmation creates one profile and reports one selection despite repeated clicks',async()=>{
 const wait=pending(),h=harness(()=>wait.promise),click=h.confirm();click();click();assert.equal(h.calls.length,1);
 wait.resolve(Response.json({profile:{id:'new',categoryId:'80719',categoryPath:['test'],revision:1}}));await settle();click();assert.equal(h.calls.length,1);assert.equal(h.selected.length,1);
 const saved=harness(async()=>Response.json({profiles:[{id:'saved',categoryId:'80719',categoryPath:['test'],revision:2,template:{id:'latest-template'}}]}),true),choose=saved.confirm();choose();choose();await settle();assert.equal(saved.selected.length,1);assert.equal(saved.calls.length,1);assert.equal(saved.calls[0].method,undefined);assert.equal(saved.selected[0].revision,2);assert.equal(saved.selected[0].template.id,'latest-template');
});
test('failed category save unlocks retry while closing the picker ignores a late successful response',async()=>{
 let attempt=0;const h=harness(async()=>++attempt===1?Response.json({error:'저장 실패'},{status:500}):Response.json({profile:{id:'new',categoryId:'80719',categoryPath:['test'],revision:1}}));
 h.confirm()();await settle();assert.match(JSON.stringify(h.render()),/저장 실패/);h.confirm()();await settle();assert.equal(h.selected.length,1);assert.equal(h.calls.length,2);
 const wait=pending(),closed=harness(()=>wait.promise);closed.confirm()();closed.close();assert.equal(closed.calls[0].signal.aborted,true);
 wait.resolve(Response.json({profile:{id:'late'}}));await settle();assert.equal(closed.selected.length,0);assert.equal(closed.late,0);
});

test('changed category is shown for review and only a second confirmation selects the refreshed profile',async()=>{
 const latest={id:'saved',categoryId:'77442',categoryPath:['changed'],revision:3};
 const h=harness(async()=>Response.json({profiles:[latest]}),true);
 h.confirm()();await settle();assert.equal(h.selected.length,0);assert.match(JSON.stringify(h.render()),/카테고리가 변경/);
 h.confirm()();await settle();assert.equal(h.selected.length,1);assert.equal(h.selected[0].categoryId,'77442');assert.equal(h.selected[0].revision,3);
});

test('deleted or unreadable saved profiles never fall back to stale settings or create replacements',async()=>{
 for(const response of [Response.json({profiles:[]}),Response.json({error:'조회 실패'},{status:503}),Response.json({profiles:[{id:'saved',categoryId:'80719',categoryPath:['test'],revision:0}]})]){
  const h=harness(async()=>response,true);h.confirm()();await settle();assert.equal(h.selected.length,0);assert.equal(h.calls.length,1);assert.equal(h.calls[0].method,undefined);
 }
 const wait=pending(),h=harness(()=>wait.promise,true);h.confirm()();h.close();assert.equal(h.calls[0].signal.aborted,true);
 wait.resolve(Response.json({profiles:[{id:'saved',categoryId:'80719',categoryPath:['test'],revision:2}]}));await settle();assert.equal(h.selected.length,0);assert.equal(h.late,0);
});

test('new category confirmation rejects missing or mismatched saved identities before URL entry',async()=>{
 const valid={id:'new',categoryId:'80719',categoryPath:['test'],revision:1};
 for(const profile of [undefined,null,{}, {...valid,id:''},{...valid,revision:0},{...valid,revision:1.5},{...valid,categoryId:'77442'},{...valid,categoryPath:['another']},{...valid,categoryPath:null}]){
  let attempt=0;
  const h=harness(async()=>Response.json({profile:++attempt===1?profile:valid}));
  h.confirm()();await settle();assert.equal(h.selected.length,0);assert.match(JSON.stringify(h.render()),/URL 입력을 중단/);
  h.confirm()();await settle();assert.equal(h.selected.length,1);assert.equal(h.selected[0].categoryId,'80719');
 }
});

test('category create retry keeps the same request key and serialized selection',async()=>{
 let attempt=0;
 const h=harness(async()=>{if(++attempt===1)throw new Error('response lost');return Response.json({profile:{id:'new',categoryId:'80719',categoryPath:['test'],revision:1}});});
 h.confirm()();await settle();h.confirm()();await settle();
 assert.equal(h.selected.length,1);assert.equal(h.calls.length,2);
 assert.match(h.calls[0].headers['Idempotency-Key'],/^[0-9a-f-]{36}$/);
 assert.equal(h.calls[0].headers['Idempotency-Key'],h.calls[1].headers['Idempotency-Key']);
 assert.equal(h.calls[0].body,h.calls[1].body);
});
