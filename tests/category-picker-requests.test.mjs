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
function harness(request,existing=false,{readProfiles=async()=>Response.json({profiles:[]})}={}){
 const slots=[],cleanup=[],calls=[],selected=[];let index=0,first=true,closed=false,late=0;
 const choice={key:'saved',profileId:existing?'saved':null,path:['test'],categoryId:'80719',isLeaf:true};
 const fetcher=(url,init)=>{calls.push({...init,url});return !existing&&!init?.method?readProfiles(url,init):request(url,init);};
 const hooks={useMemo:fn=>fn(),useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{if(closed)late++;slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(initial){const i=index++;return slots[i]??(slots[i]={current:initial});},useEffect(fn){if(first)cleanup.push(fn());}};
 const exports={};const file='app/components/category-picker.tsx';
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,crypto,AbortController,fetch:fetcher,require(name){
  if(name==='@/app/load-category-profiles'){const loaded={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/load-category-profiles.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:loaded,Error,fetch:fetcher});return loaded;}
  if(name==='react')return hooks;
  if(name.endsWith('.css'))return{};
  if(name==='@/app/category-profiles')return{usableCategoryCode:()=>true};
  if(name==='@/app/quotation-schema')return{getQuotationSchema:()=>({fields:[],status:'observed'})};
  if(name==='@/app/components/intake-quotation-preview')return{IntakeQuotationPreview:()=>null};
  if(name==='@/app/components/category-quotation-preview')return{CategoryQuotationPreview:()=>null};
  if(name==='@/app/category-catalog')return{categoryChoices:profiles=>[...profiles.map(profile=>({...choice,key:profile.id,profileId:profile.id,path:profile.categoryPath,categoryId:profile.categoryId})),...(existing?[]:[choice])],canConfirmCategory:choice=>Boolean(choice),categoryAdvancedSeed:()=>({}),categoryChoicesAtPath:(choices,path)=>choices.filter(choice=>JSON.stringify(choice.path)===JSON.stringify(path)),categoryProfilesForChoice:(profiles,target)=>profiles.filter(profile=>profile.categoryId===target.categoryId&&JSON.stringify(profile.categoryPath)===JSON.stringify(target.path)),categoryLevel:()=>[],categoryObservationScope:{},categoryProfileForChoice:()=>({categoryId:'80719'}),searchCategoryChoices:choices=>choices};
  return native(name);
 }});
 const render=()=>{index=0;const tree=exports.CategoryPicker({profiles:existing?[{id:'saved',categoryId:'80719',categoryPath:['test'],revision:1}]:[],selectedId:'saved',onSelected:p=>selected.push(p),onAdvanced(){}});first=false;return tree;};
 const confirm=()=>nodes(render()).find(n=>n.type==='button'&&String(n.props.children).includes('URL 입력')).props.onClick;
 return{calls,selected,render,confirm,close(){closed=true;cleanup.forEach(fn=>fn?.());},get late(){return late;}};
}
test('category confirmation creates one profile and reports one selection despite repeated clicks',async()=>{
 const wait=pending(),h=harness(()=>wait.promise),click=h.confirm();click();click();assert.equal(h.calls.length,1);
 wait.resolve(Response.json({profile:{id:'new',categoryId:'80719',categoryPath:['test'],revision:1}}));await settle();click();assert.equal(h.calls.length,2);assert.equal(h.calls.filter(call=>call.method==='POST').length,1);assert.equal(h.selected.length,1);
 const saved=harness(async()=>Response.json({profiles:[{id:'saved',categoryId:'80719',categoryPath:['test'],revision:1,template:{id:'latest-template'}}]}),true),choose=saved.confirm();choose();choose();await settle();assert.equal(saved.selected.length,1);assert.equal(saved.calls.length,1);assert.equal(saved.calls[0].method,undefined);assert.equal(saved.selected[0].revision,1);assert.equal(saved.selected[0].template.id,'latest-template');
});

test('a newly available exact category profile retains its linked quotation instead of creating a blank replacement',async()=>{
 const profile={id:'ready',categoryId:'80719',categoryPath:['test'],revision:3,template:{name:'current.xlsx'},mappings:[{column:0,field:'category'}]};
 const h=harness(async()=>Response.json({profile:{id:'blank',categoryId:'80719',categoryPath:['test'],revision:1}}),false,{readProfiles:async()=>Response.json({profiles:[profile]})});
 h.confirm()();await settle();
 assert.equal(h.selected.length,1);assert.equal(h.selected[0].id,'ready');assert.equal(h.selected[0].revision,3);
 assert.equal(h.selected[0].template.name,'current.xlsx');assert.equal(h.selected[0].mappings[0].field,'category');
 assert.equal(h.calls.filter(call=>call.method==='POST').length,0);
});

test('ambiguous newly available quotations refresh the picker without choosing or creating a profile',async()=>{
 const profiles=['one','two'].map(id=>({id,categoryId:'80719',categoryPath:['test'],revision:1,template:{name:id+'.xlsx'}}));
 const h=harness(async()=>Response.json({profile:{id:'blank',categoryId:'80719',categoryPath:['test'],revision:1}}),false,{readProfiles:async()=>Response.json({profiles})});
 h.confirm()();await settle();assert.equal(h.selected.length,0);assert.equal(h.calls.filter(call=>call.method==='POST').length,0);
 assert.match(JSON.stringify(h.render()),/여러 개/);
 assert.ok(nodes(h.render()).some(node=>node.type==='option'&&node.props.value==='one'));
 assert.ok(nodes(h.render()).some(node=>node.type==='option'&&node.props.value==='two'));
});
test('failed category save unlocks retry while closing the picker ignores a late successful response',async()=>{
 let attempt=0;const h=harness(async()=>++attempt===1?Response.json({error:'저장 실패'},{status:500}):Response.json({profile:{id:'new',categoryId:'80719',categoryPath:['test'],revision:1}}));
 h.confirm()();await settle();assert.match(JSON.stringify(h.render()),/저장 실패/);h.confirm()();await settle();assert.equal(h.selected.length,1);assert.equal(h.calls.length,4);assert.equal(h.calls.filter(call=>call.method==='POST').length,2);
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
 assert.equal(h.selected.length,1);assert.equal(h.calls.length,4);
 const writes=h.calls.filter(call=>call.method==='POST');assert.equal(writes.length,2);
 assert.match(writes[0].headers['Idempotency-Key'],/^[0-9a-f-]{36}$/);
 assert.equal(writes[0].headers['Idempotency-Key'],writes[1].headers['Idempotency-Key']);
 assert.equal(writes[0].body,writes[1].body);
});

test('same category with a changed quotation revision displays its new mapping before selection',async()=>{
 let revision=2;
 const h=harness(async()=>Response.json({profiles:[{id:'saved',categoryId:'80719',categoryPath:['test'],revision,template:{name:'updated.xlsx'},mappings:[{column:0,field:'constant',constant:'updated default'}]}]}),true);
 h.confirm()();await settle();assert.equal(h.selected.length,0);assert.match(JSON.stringify(h.render()),/견적 설정이 변경/);
 const preview=nodes(h.render()).find(n=>n.props?.profile?.template?.name==='updated.xlsx');
 assert.equal(preview.props.profile.revision,2);assert.equal(preview.props.profile.mappings[0].constant,'updated default');
 revision=3;h.confirm()();await settle();assert.equal(h.selected.length,0);
 h.confirm()();await settle();assert.equal(h.selected.length,1);assert.equal(h.selected[0].revision,3);
});


test('search leaf opens URL entry with one click while retaining identity validation and duplicate protection',async()=>{
 const wait=pending(),h=harness(()=>wait.promise);
 nodes(h.render()).find(n=>n.type==='input'&&n.props.type==='search').props.onChange({target:{value:'test'}});
 const search=()=>nodes(h.render()).find(n=>n.type==='div'&&n.props.className==='category-search-results').props.children[0][0].props.onClick;
 const click=search();click();click();assert.equal(h.calls.length,1);assert.equal(h.selected.length,0);
 wait.resolve(Response.json({profile:{id:'new',categoryId:'80719',categoryPath:['test'],revision:1}}));await settle();
 assert.equal(h.selected.length,1);click();assert.equal(h.selected.length,1);assert.equal(h.calls.length,2);assert.equal(h.calls.filter(call=>call.method==='POST').length,1);
 const invalid=harness(async()=>Response.json({profile:{id:'new',categoryId:'wrong',categoryPath:['test'],revision:1}}));
 nodes(invalid.render()).find(n=>n.type==='input'&&n.props.type==='search').props.onChange({target:{value:'test'}});
 nodes(invalid.render()).find(n=>n.type==='div'&&n.props.className==='category-search-results').props.children[0][0].props.onClick();await settle();
 assert.equal(invalid.selected.length,0);assert.match(JSON.stringify(invalid.render()),/URL 입력을 중단/);
});

test('fresh profile lookup reads all pages before reusing the exact category or deciding there are several',async()=>{
 const ready={id:'z',categoryId:'80719',categoryPath:['test'],revision:2,template:{name:'ready.xlsx'}};
 for(const firstMatches of [false,true]){
  const first={id:'a',categoryId:firstMatches?'80719':'999',categoryPath:firstMatches?['test']:['another'],revision:1,template:{name:'first.xlsx'}};
  const h=harness(async()=>{throw Error('No new profile should be written');},false,{readProfiles:async url=>url.includes('?after=')?Response.json({profiles:[ready]}):Response.json({profiles:[first],nextCursor:'a'})});
  h.confirm()();await settle();assert.equal(h.calls.length,2);assert.ok(h.calls.every(call=>call.method===undefined));assert.match(h.calls[1].url,/after=a$/);
  assert.equal(h.selected.length,firstMatches?0:1);
  if(!firstMatches)assert.equal(h.selected[0].template.name,'ready.xlsx');
 }
});

test('failed, malformed or cancelled fresh lookup never creates a replacement',async()=>{
 const ready={id:'ready',categoryId:'80719',categoryPath:['test'],revision:1};
 for(const response of [Response.json({error:'조회 실패'},{status:503}),Response.json({profiles:null}),Response.json({profiles:[{...ready,revision:0}]}),Response.json({profiles:[ready],nextCursor:'wrong'})]){
  const h=harness(async()=>{throw Error('No new profile should be written');},false,{readProfiles:async()=>response});
  h.confirm()();await settle();assert.equal(h.selected.length,0);assert.equal(h.calls.filter(call=>call.method==='POST').length,0);assert.match(JSON.stringify(h.render()),/alert/);
 }
 const wait=pending(),h=harness(async()=>{throw Error('No new profile should be written');},false,{readProfiles:()=>wait.promise});
 h.confirm()();h.close();assert.equal(h.calls[0].signal.aborted,true);
 wait.resolve(Response.json({profiles:[ready]}));await settle();assert.equal(h.selected.length,0);assert.equal(h.late,0);assert.equal(h.calls.length,1);
});
