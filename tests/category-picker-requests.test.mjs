import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {hubSchemaSnapshot} from './helpers/hub-schema.mjs';
const native=createRequire(import.meta.url);
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
const pending=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
function harness(request,existing=false,{readProfiles=async()=>Response.json({profiles:[]}),readSchema=async()=>undefined,readTemplate=async()=>({template:{name:'auto.xlsx'},mappings:[{column:0,field:'title'}]})}={}){
 const slots=[],cleanup=[],calls=[],selected=[];let index=0,first=true,closed=false,late=0;
 const choice={key:'saved',profileId:existing?'saved':null,path:['test'],categoryId:'80719',isLeaf:true};
 const fetcher=(url,init)=>{calls.push({...init,url});return !existing&&!init?.method?readProfiles(url,init):request(url,init);};
 const hooks={useMemo:fn=>fn(),useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{if(closed)late++;slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(initial){const i=index++;return slots[i]??(slots[i]={current:initial});},useEffect(fn){if(first)cleanup.push(fn());}};
 const exports={};const file='app/components/category-picker.tsx';
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,crypto,AbortController,fetch:fetcher,require(name){
  if(name==='@/app/load-category-profiles'){const loaded={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/load-category-profiles.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:loaded,Error,fetch:fetcher});return loaded;}
  if(name==='react')return hooks;
  if(name.endsWith('.css'))return{};
  if(name==='@/app/category-profiles')return{usableCategoryCode:()=>true};
  if(name==='@/app/quotation-schema')return{getQuotationSchema:()=>({fields:[],status:'observed'})};
  if(name==='@/app/components/intake-quotation-preview')return{IntakeQuotationPreview:()=>null};
  if(name==='@/app/components/category-quotation-preview')return{CategoryQuotationPreview:()=>null};
  if(name==='@/app/components/supplier-hub-category-browser')return{SupplierHubCategoryBrowser:()=>null};
  if(name==='@/app/supplier-hub-catalog')return{loadLiveHubCategorySchema:readSchema,loadLiveHubCategoryTemplate:readTemplate};
  if(name==='@/app/category-catalog')return{categoryChoices:profiles=>[...profiles.map(profile=>({...choice,key:profile.id,profileId:profile.id,path:profile.categoryPath,categoryId:profile.categoryId})),...(existing?[]:[choice])],canConfirmCategory:choice=>Boolean(choice),categoryAdvancedSeed:()=>({}),categoryChoicesAtPath:(choices,path)=>choices.filter(choice=>JSON.stringify(choice.path)===JSON.stringify(path)),categoryProfilesForChoice:(profiles,target)=>profiles.filter(profile=>profile.categoryId===target.categoryId&&JSON.stringify(profile.categoryPath)===JSON.stringify(target.path)),categoryLevel:()=>[],categoryObservationScope:{},categoryProfileForChoice:()=>({categoryId:'80719'}),searchCategoryChoices:choices=>choices};
  return native(name);
 }});
 const render=()=>{index=0;const tree=exports.CategoryPicker({profiles:existing?[{id:'saved',categoryId:'80719',categoryPath:['test'],revision:1}]:[],selectedId:'saved',onSelected:p=>selected.push(p),onAdvanced(){}});first=false;return tree;};
 const confirm=()=>nodes(render()).find(n=>n.type==='button'&&String(n.props.children).includes('URL 입력')).props.onClick;
 return{calls,selected,render,confirm,chooseLive(){nodes(render()).find(node=>node.type?.name==='SupplierHubCategoryBrowser').props.onChoice({...choice,key:'live',supplierHub:{trail:[],ownerId:'owner',company:{code:'A01464742',name:'와이홉'}}});},close(){closed=true;cleanup.forEach(fn=>fn?.());},get late(){return late;}};
}

test('live category confirmation saves detailed schema in a new profile before URL entry',async()=>{
 const snapshot={...hubSchemaSnapshot(undefined,'80719'),categoryPath:['test']};let reads=0,templates=0;
 const h=harness(async(_url,init)=>Response.json({profile:{...JSON.parse(init.body),id:'new',categoryPath:['test'],revision:1}}),false,{readSchema:async(choice,signal)=>{assert.equal(choice.categoryId,'80719');assert.equal(signal.aborted,false);reads++;return snapshot;},readTemplate:async(choice,raw,signal)=>{assert.equal(choice.categoryId,'80719');assert.equal(raw,snapshot);assert.equal(signal.aborted,false);templates++;return{template:{name:'official-auto.xlsx'},mappings:[{column:0,field:'title'}]};}});
 h.chooseLive();const click=h.confirm();click();click();await settle();assert.equal(reads,1);assert.equal(templates,1);assert.equal(h.calls.filter(call=>call.method==='POST').length,1);assert.equal(h.selected.length,1);assert.equal(h.selected[0].hubSchema.schemaString,snapshot.schemaString);assert.equal(h.selected[0].template.name,'official-auto.xlsx');
});
test('existing template and manually mapped columns survive a live schema refresh, conflict stops URL entry',async()=>{
 const snapshot={...hubSchemaSnapshot(undefined,'80719'),categoryPath:['test']},profile={id:'saved',categoryId:'80719',categoryPath:['test'],revision:3,template:{id:'official'},mappings:[{column:0,field:'title',required:true}]};
 for(const conflict of [false,true]){const h=harness(async(_url,init)=>{const body=JSON.parse(init.body);assert.equal(body.expectedRevision,3);assert.deepEqual(body.profile.template,profile.template);assert.deepEqual(body.profile.mappings,profile.mappings);return conflict?Response.json({error:'충돌'},{status:409}):Response.json({profile:{...body.profile,revision:4}});},false,{readProfiles:async()=>Response.json({profiles:[profile]}),readSchema:async()=>snapshot,readTemplate:async()=>{throw Error('Existing template must never be downloaded or replaced');}});
  h.chooseLive();h.confirm()();await settle();assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);assert.equal(h.calls.filter(call=>call.method==='POST').length,0);assert.equal(h.selected.length,conflict?0:1);if(!conflict)assert.deepEqual(h.selected[0].template,profile.template);
 }
});
test('empty live profile acquires official Excel once with revision protection before URL entry',async()=>{
 const snapshot={...hubSchemaSnapshot(undefined,'80719'),categoryPath:['test']},profile={id:'empty',categoryId:'80719',categoryPath:['test'],revision:3,hubSchema:snapshot,template:null,mappings:[]};let reads=0;
 for(const conflict of [false,true]){const h=harness(async(_url,init)=>{const input=JSON.parse(init.body);assert.equal(input.id,profile.id);assert.equal(input.expectedRevision,3);assert.equal(input.profile.template.name,'official.xlsx');return conflict?Response.json({error:'다른 화면 변경'},{status:409}):Response.json({profile:{...input.profile,revision:4}});},false,{readProfiles:async()=>Response.json({profiles:[profile]}),readSchema:async()=>snapshot,readTemplate:async()=>{reads++;return{template:{name:'official.xlsx'},mappings:[{column:0,field:'title'}]};}});
  h.chooseLive();h.confirm()();await settle();assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);assert.equal(h.calls.filter(call=>call.method==='POST').length,0);assert.equal(h.selected.length,conflict?0:1);
 }assert.equal(reads,2);assert.equal(profile.template,null);assert.deepEqual(profile.mappings,[]);
});
test('failed/cancelled official download leaves category profiles and URL intake untouched',async()=>{
 const snapshot={...hubSchemaSnapshot(undefined,'80719'),categoryPath:['test']};
 const bad=harness(async()=>{throw Error('unexpected save');},false,{readSchema:async()=>snapshot,readTemplate:async()=>{throw Error('official workbook unavailable');}});bad.chooseLive();bad.confirm()();await settle();assert.equal(bad.selected.length,0);assert.ok(bad.calls.every(call=>!call.method));assert.match(JSON.stringify(bad.render()),/official workbook unavailable/);
 const wait=pending(),cancelled=harness(async()=>{throw Error('unexpected save');},false,{readSchema:async()=>snapshot,readTemplate:()=>wait.promise});cancelled.chooseLive();cancelled.confirm()();await settle();cancelled.close();wait.resolve({template:{name:'late.xlsx'},mappings:[]});await settle();assert.equal(cancelled.selected.length,0);assert.ok(cancelled.calls.every(call=>!call.method));assert.equal(cancelled.late,0);
});
test('failed or cancelled detailed schema retrieval never writes a profile or enters URL intake',async()=>{
 const bad=harness(async()=>{throw Error('unexpected save');},false,{readSchema:async()=>{throw Error('schema unavailable');}});bad.chooseLive();bad.confirm()();await settle();assert.equal(bad.calls.length,0);assert.equal(bad.selected.length,0);
 const wait=pending(),cancelled=harness(async()=>{throw Error('unexpected save');},false,{readSchema:()=>wait.promise});cancelled.chooseLive();cancelled.confirm()();cancelled.close();wait.resolve(hubSchemaSnapshot());await settle();assert.equal(cancelled.calls.length,0);assert.equal(cancelled.selected.length,0);assert.equal(cancelled.late,0);
});
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
