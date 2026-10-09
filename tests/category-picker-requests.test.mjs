import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {hubSchemaSnapshot} from './helpers/hub-schema.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const mappingHarness=mobileIntakeHarness();
test.after(()=>mappingHarness.close());
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
  if(name==='@/app/hub-rule-version-mappings')return mappingHarness.load('app/hub-rule-version-mappings.ts');
  if(name==='@/app/category-definition-refresh-client'){
   const loaded={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/category-definition-refresh-client.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:loaded,Error,TextEncoder,crypto,fetch:fetcher,require:dependency=>mappingHarness.load(dependency.slice(2)+'.ts')});return loaded;
  }
  if(name==='@/app/components/intake-quotation-preview')return{IntakeQuotationPreview:()=>null};
  if(name==='@/app/components/category-quotation-preview')return{CategoryQuotationPreview:()=>null};
  if(name==='@/app/components/supplier-hub-category-browser')return{SupplierHubCategoryBrowser:()=>null};
  if(name==='@/app/supplier-hub-catalog')return{loadLiveHubCategorySchema:readSchema,loadLiveHubCategoryTemplate:readTemplate};
  if(name==='@/app/category-catalog')return{categoryChoices:profiles=>[...profiles.map(profile=>({...choice,key:profile.id,profileId:profile.id,path:profile.categoryPath,categoryId:profile.categoryId})),...(existing?[]:[choice])],canConfirmCategory:choice=>Boolean(choice),categoryAdvancedSeed:()=>({}),categoryChoicesAtPath:(choices,path)=>choices.filter(choice=>JSON.stringify(choice.path)===JSON.stringify(path)),categoryProfilesForChoice:(profiles,target)=>profiles.filter(profile=>profile.categoryId===target.categoryId&&JSON.stringify(profile.categoryPath)===JSON.stringify(target.path)),categoryLevel:()=>[],categoryObservationScope:{},categoryProfileForChoice:()=>({categoryId:'80719',template:null,mappings:[]}),searchCategoryChoices:choices=>choices};
  if(name==='@/app/official-workbook-evidence')return mappingHarness.load('app/official-workbook-evidence.ts');
  return native(name);
 }});
 const render=()=>{index=0;const tree=exports.CategoryPicker({profiles:existing?[{id:'saved',categoryId:'80719',categoryPath:['test'],revision:1}]:[],selectedId:'saved',onSelected:p=>selected.push(p),onAdvanced(){}});first=false;return tree;};
 const confirm=()=>nodes(nodes(render()).find(n=>n.props?.className==='modal-actions')).find(n=>n.type==='button').props.onClick;
 return{calls,selected,render,confirm,chooseLive(){nodes(render()).find(node=>node.type?.name==='SupplierHubCategoryBrowser').props.onChoice({...choice,key:'live',supplierHub:{trail:[],ownerId:'owner',company:{code:'A01464742',name:'와이홉'}}});},close(){closed=true;cleanup.forEach(fn=>fn?.());},get late(){return late;}};
}

test('live leaf selection opens URL entry with one click only after the exact schema and saved profile acknowledge',async()=>{
 const snapshot={...hubSchemaSnapshot(undefined,'80719'),categoryPath:['test']},schemaReply=pending();let reads=0;
 const h=harness(async(_url,init)=>Response.json({profile:{...JSON.parse(init.body),id:'new',categoryPath:['test'],revision:1}}),false,{readSchema:async()=>{reads++;return schemaReply.promise;}});
 h.chooseLive();h.chooseLive();assert.equal(reads,1,'one leaf click starts schema confirmation without a second confirmation button');
 assert.equal(h.selected.length,0);assert.equal(h.calls.length,0,'URL entry waits for the live company/category schema');
 schemaReply.resolve(snapshot);await settle();assert.equal(h.selected.length,1);assert.equal(h.selected[0].categoryId,'80719');assert.deepEqual(h.selected[0].categoryPath,['test']);assert.equal(h.selected[0].hubSchema.schemaString,snapshot.schemaString);
 assert.equal(h.calls.filter(call=>call.method==='POST').length,1);h.chooseLive();h.confirm()();await settle();assert.equal(h.selected.length,1);assert.equal(reads,1,'the completed selection cannot create another URL row');h.close();
});

test('one-click live selection preserves its leaf on verification failure and ignores a late closed-picker reply',async()=>{
 const snapshot={...hubSchemaSnapshot(undefined,'80719'),categoryPath:['test']};let failed=true,reads=0;
 const h=harness(async(_url,init)=>Response.json({profile:{...JSON.parse(init.body),id:'new',categoryPath:['test'],revision:1}}),false,{readSchema:async()=>{reads++;if(failed)throw Error('선택한 회사·최종 분류 변경');return snapshot;}});
 h.chooseLive();await settle();assert.equal(h.selected.length,0);assert.equal(h.calls.length,0);assert.match(JSON.stringify(h.render()),/선택한 회사·최종 분류 변경/);
 failed=false;h.confirm()();await settle();assert.equal(h.selected.length,1);assert.equal(reads,2);assert.equal(h.calls.filter(call=>call.method==='POST').length,1);h.close();
 const reply=pending();let signal;
 const closed=harness(async()=>{throw Error('closed picker must not write a profile');},false,{readSchema:async(_choice,current)=>{signal=current;return reply.promise;}});
 closed.chooseLive();closed.close();assert.equal(signal.aborted,true);reply.resolve(snapshot);await settle();assert.equal(closed.selected.length,0);assert.equal(closed.calls.length,0);assert.equal(closed.late,0);
});

test('live category confirmation saves detailed schema in a new profile before URL entry',async()=>{
 const snapshot={...hubSchemaSnapshot(undefined,'80719'),categoryPath:['test']};let reads=0,templates=0;
 const h=harness(async(_url,init)=>Response.json({profile:{...JSON.parse(init.body),id:'new',categoryPath:['test'],revision:1}}),false,{readSchema:async(choice,signal)=>{assert.equal(choice.categoryId,'80719');assert.equal(signal.aborted,false);reads++;return snapshot;},readTemplate:async(choice,raw,signal)=>{assert.equal(choice.categoryId,'80719');assert.equal(raw,snapshot);assert.equal(signal.aborted,false);templates++;return{template:{name:'official-auto.xlsx'},mappings:[{column:0,field:'title'}]};}});
 h.chooseLive();const click=h.confirm();click();click();await settle();assert.equal(reads,1);assert.equal(templates,0);assert.equal(h.calls.filter(call=>call.method==='POST').length,1);assert.equal(h.selected.length,1);assert.equal(h.selected[0].hubSchema.schemaString,snapshot.schemaString);assert.equal(h.selected[0].template,null);assert.deepEqual(h.selected[0].mappings,[]);
});
test('existing template and manually mapped columns survive a live schema refresh, conflict stops URL entry',async()=>{
 const snapshot={...hubSchemaSnapshot(undefined,'80719'),categoryPath:['test']},profile={id:'saved',categoryId:'80719',categoryPath:['test'],revision:3,template:{id:'official'},mappings:[{column:0,field:'title',required:true}]};
 for(const conflict of [false,true]){const h=harness(async(_url,init)=>{const body=JSON.parse(init.body);assert.equal(body.expectedRevision,3);assert.deepEqual(body.profile.template,profile.template);assert.deepEqual(body.profile.mappings,profile.mappings);return conflict?Response.json({error:'충돌'},{status:409}):Response.json({profile:{...body.profile,revision:4}});},false,{readProfiles:async()=>Response.json({profiles:[profile]}),readSchema:async()=>snapshot,readTemplate:async()=>{throw Error('Existing template must never be downloaded or replaced');}});
  h.chooseLive();h.confirm()();await settle();assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);assert.equal(h.calls.filter(call=>call.method==='POST').length,0);assert.equal(h.selected.length,conflict?0:1);if(!conflict)assert.deepEqual(h.selected[0].template,profile.template);
 }
});
const currentDraftRules={draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1',settingsInitialization:'couplus-options-v1'};
test('a fresh live selection refreshes each changed draft rule even when the saved raw schema and template match',async()=>{
 const snapshot={...hubSchemaSnapshot(undefined,'80719'),categoryPath:['test'],...currentDraftRules};
 for(const omitted of Object.keys(currentDraftRules)){
  const legacy=structuredClone(snapshot);delete legacy[omitted];
  const profile={id:'saved',categoryId:'80719',categoryPath:['test'],revision:3,hubSchema:legacy,template:{id:'official'},mappings:[{column:0,field:'title',required:true}]};
  for(const conflict of [false,true]){
   const h=harness(async(_url,init)=>{const body=JSON.parse(init.body);assert.equal(body.expectedRevision,3);assert.deepEqual(body.profile.hubSchema,snapshot);assert.deepEqual(body.profile.template,profile.template);assert.deepEqual(body.profile.mappings,profile.mappings);return conflict?Response.json({error:'changed'},{status:409}):Response.json({profile:{...body.profile,revision:4}});},false,{readProfiles:async()=>Response.json({profiles:[profile]}),readSchema:async()=>snapshot,readTemplate:async()=>{throw Error('Existing template must remain unchanged');}});
   h.chooseLive();h.confirm()();await settle();
   assert.equal(h.calls.filter(call=>call.method==='PUT').length,1,omitted);assert.equal(h.calls.filter(call=>call.method==='POST').length,0);
   assert.equal(h.selected.length,conflict?0:1);if(!conflict)assert.equal(h.selected[0].hubSchema[omitted],currentDraftRules[omitted]);
   assert.equal(profile.hubSchema[omitted],undefined,'the previous captured snapshot is not mutated');
  }
 }
});

test('a matching live definition reuses its profile without writing only to replace the observation timestamp',async()=>{
 const snapshot={...hubSchemaSnapshot(undefined,'80719'),categoryPath:['test'],...currentDraftRules};
 const profile={id:'saved',categoryId:'80719',categoryPath:['test'],revision:3,hubSchema:{...snapshot,observedAt:snapshot.observedAt-1000},template:{id:'official'},mappings:[]};
 const h=harness(async()=>{throw Error('Unchanged definition must not be written');},false,{readProfiles:async()=>Response.json({profiles:[profile]}),readSchema:async()=>snapshot,readTemplate:async()=>{throw Error('Existing template must remain unchanged');}});
 h.chooseLive();h.confirm()();await settle();assert.equal(h.selected.length,1);assert.equal(h.selected[0].revision,3);assert.ok(h.calls.every(call=>!call.method));
});

test('live rule upgrade preserves the manual column connection by its exact wire path',async()=>{
 const legacy={...hubSchemaSnapshot(undefined,'80719'),categoryPath:['test']},raw=JSON.parse(legacy.schemaString);
 raw.properties.productPage.properties.modelNumber={type:'string',title:'모델 번호'};legacy.schemaString=JSON.stringify(raw);
 const snapshot={...legacy,...currentDraftRules},schema=mappingHarness.load('app/quotation-schema.ts').getQuotationSchema('80719',['test'],legacy);
 const old=schema.fields.find(field=>JSON.stringify(field.hubWire?.path)===JSON.stringify(['productPage','modelNumber']));assert.match(old.id,/^live_/);
 const mappings=[{column:1,field:old.id,required:false},{column:0,field:'constant',constant:'직접 고정값',required:true}],profile={id:'saved',categoryId:'80719',categoryPath:['test'],revision:3,hubSchema:legacy,template:{id:'official'},mappings};
 const h=harness(async(_url,init)=>{const body=JSON.parse(init.body);assert.equal(init.method,'PUT');assert.deepEqual(body.profile.mappings,[{...mappings[0],field:'model'},mappings[1]]);assert.deepEqual(body.profile.template,profile.template);return Response.json({profile:{...body.profile,revision:4}});},false,{readProfiles:async()=>Response.json({profiles:[profile]}),readSchema:async()=>snapshot,readTemplate:async()=>{throw Error('No replacement workbook');}});
 h.chooseLive();h.confirm()();await settle();assert.equal(h.selected.length,1);assert.equal(h.selected[0].mappings[0].field,'model');assert.equal(profile.mappings[0].field,old.id);
});

test('category create and refresh reject a saved response that drops any captured draft rule',async()=>{
 const snapshot={...hubSchemaSnapshot(undefined,'80719'),categoryPath:['test'],...currentDraftRules};
 for(const method of ['POST','PUT'])for(const omitted of Object.keys(currentDraftRules)){
  const profile={id:'saved',categoryId:'80719',categoryPath:['test'],revision:3,template:{id:'official'},mappings:[]};
  const h=harness(async(_url,init)=>{assert.equal(init.method,method);const body=JSON.parse(init.body),saved=method==='PUT'?{...body.profile,revision:4}:{...body,id:'new',categoryPath:['test'],revision:1};delete saved.hubSchema[omitted];return Response.json({profile:saved});},false,{readProfiles:async()=>Response.json({profiles:method==='PUT'?[profile]:[]}),readSchema:async()=>snapshot});
  h.chooseLive();h.confirm()();await settle();assert.equal(h.calls.filter(call=>call.method===method).length,1);assert.equal(h.selected.length,0,method+':'+omitted);assert.match(JSON.stringify(h.render()),/확인하지 못했습니다|URL 입력을 중단/);
 }
});

test('empty live profile enters URL intake without an official workbook or a profile rewrite',async()=>{
 const snapshot={...hubSchemaSnapshot(undefined,'80719'),categoryPath:['test']},profile={id:'empty',categoryId:'80719',categoryPath:['test'],revision:3,hubSchema:snapshot,template:null,mappings:[]};
 const h=harness(async()=>{throw Error('Unchanged profile must not be written');},false,{readProfiles:async()=>Response.json({profiles:[profile]}),readSchema:async()=>snapshot,readTemplate:async()=>{throw Error('Official workbook is prepared at quotation review');}});
 h.chooseLive();h.confirm()();await settle();assert.equal(h.selected.length,1);assert.equal(h.selected[0].revision,3);assert.equal(h.selected[0].template,null);assert.ok(h.calls.every(call=>!call.method));
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
