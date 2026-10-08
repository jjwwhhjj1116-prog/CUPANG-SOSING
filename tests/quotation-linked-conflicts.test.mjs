import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';

const native=createRequire(import.meta.url),cache=new Map();
function load(file,replacements={}){
 const cached=!Object.keys(replacements).length;if(cached&&cache.has(file))return cache.get(file);
 const exports={};if(cached)cache.set(file,exports);
 const output=ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(output,{exports,Error,TextEncoder,URLSearchParams,structuredClone,AbortController,fetch:replacements.fetch??fetch,document:replacements.document,require(name){
  if(Object.hasOwn(replacements,name))return replacements[name];
  if(name.endsWith('.css'))return{};
  if(name.startsWith('@/')){const base=name.slice(2);return load(base+(fs.existsSync(new URL('../'+base+'.ts',import.meta.url))?'.ts':'.tsx'));}
  return native(name);
 }});return exports;
}
const editor=load('app/components/quotation-fields-editor.tsx');
const plain=value=>JSON.parse(JSON.stringify(value));
const edit=(fieldKey,value,optionId='red')=>({fieldKey,value,optionId});
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const inputs=['supplyPrice','salePrice','msrp'],wireNames=['purchasePrice','coupangSalePrice','msrp'];
const weight=['packagedWeightG','wire-weight'];
function fixture(overrides={common:{},options:{}},transform=fields=>fields){
 let fields=inputs.map(id=>({id,label:id,type:'number',integer:true,min:1,section:'product',visibility:'common',required:false}));
 fields.push(...inputs.map((id,index)=>({...fields[index],id:'wire-'+id,label:'wire-'+id,type:'text',numericText:true,hubInput:id,hubWire:{path:['productPage','commonAttributes',wireNames[index]]}})));
 fields.push({...fields[5],id:'wire-osrp',label:'wire-osrp',hubWire:{path:['productPage','commonAttributes','osrp']}},{id:'brand',label:'brand',section:'product',type:'text',visibility:'common',required:false},
  {id:weight[0],label:weight[0],type:'number',integer:true,min:1,unit:'g',section:'logistics',visibility:'common',required:false},
  {id:weight[1],label:weight[1],type:'text',numericText:true,integer:true,min:1,unit:'g',section:'logistics',visibility:'common',required:false,hubInput:weight[0],hubWire:{path:['logisticsPage','skuUnitBoxWeight']}});
 fields=transform(fields);
 const schema={fields,categoryId:'69900',categoryPath:['선글라스'],status:'observed',salePriceMustCoverSupply:true};
 const automaticValues={supplyPrice:'100','wire-supplyPrice':'100',salePrice:'200','wire-salePrice':'200',msrp:'300','wire-msrp':'300','wire-osrp':'700',brand:'자동 브랜드',packagedWeightG:'100','wire-weight':'100'};
 const rows=state=>[null,'red','blue','excluded'].map(optionId=>({optionId,optionLabel:optionId??'공통',included:optionId!==null&&optionId!=='excluded',fields:Object.fromEntries(fields.map(field=>{
  const specific=state.options[optionId]??{},own=optionId!==null&&Object.hasOwn(specific,field.id),shared=Object.hasOwn(state.common,field.id);
  return[field.id,{value:own?specific[field.id]:shared?state.common[field.id]:automaticValues[field.id]??'',source:own?'manual-option':shared?'manual-common':'pricing',validationIssues:[],issues:[],needsReview:false}];
 }))}));
 return{revision:1,inputFingerprint:'a'.repeat(64),productVersion:'2026-10-08T00:00:00.000Z',contentRevision:1,optionRevision:1,imageKeys:[],overrides,
  resolved:{schema,rows:rows(overrides),issues:[]},automatic:{schema,rows:rows({common:{},options:{}})},categoryContext:{source:'collection',profileId:'p',categoryId:'69900',categoryPath:['선글라스']}};
}
const savedPair=(pair,first='100',second=first)=>fixture({common:{brand:'공통 보존'},options:{red:{[pair[0]]:first,[pair[1]]:second},blue:{brand:'다른 옵션 보존'}}});
const retained=[edit('brand','수정 보존'),edit('brand','다른 옵션 수정','blue'),edit('brand','공통 수정',null),edit('wire-osrp','777')];
const pairChanges=(pair,value)=>pair.map(id=>edit(id,value));

for(const input of inputs)for(const changedIndex of [0,1])for(const value of ['175','',null])test(`price ${input} decision covers both peers after peer ${changedIndex} changes (${String(value)})`,()=>{
 const pair=[input,'wire-'+input],before=savedPair(pair),after=savedPair(pair);after.overrides.options.red[pair[changedIndex]]='180';
 const draft=[...pairChanges(pair,value),...retained],snapshot=JSON.stringify([before,after,draft]);
 const reconciled=editor.reconcileQuotationEditorDraft(before,after,draft);
 assert.equal(reconciled.conflicts.length,2);
 for(const key of pair){
  const accepted=editor.resolveQuotationEditorConflict(after,reconciled.changes,reconciled.conflicts,editor.quotationEditorKey('red',key),'saved');
  assert.deepEqual(plain(accepted.changes),retained);assert.equal(accepted.conflicts.length,0);
  assert.ok(editor.quotationSavePlan(after,accepted.changes,'red',false).changes.every(change=>!pair.includes(change.fieldKey)));
  const kept=editor.resolveQuotationEditorConflict(after,reconciled.changes,reconciled.conflicts,editor.quotationEditorKey('red',key),'draft');
  assert.deepEqual(plain(kept.changes),draft);assert.equal(kept.conflicts.length,0);
 }
 assert.equal(JSON.stringify([before,after,draft]),snapshot);
});

for(const changedIndex of [0,1])test(`weight literal review detects changes to peer ${changedIndex} and discards the whole paired draft`,()=>{
 const before=savedPair(weight),after=savedPair(weight);after.overrides.options.red[weight[changedIndex]]='130';
 for(const draftPair of [pairChanges(weight,'120'),[edit(weight[1-changedIndex],'120')]]){
  const changes=[...draftPair,...retained],reconciled=editor.reconcileQuotationEditorDraft(before,after,changes);
  assert.equal(reconciled.conflicts.length,draftPair.length);
  for(const conflict of reconciled.conflicts){
   const accepted=editor.resolveQuotationEditorConflict(after,changes,reconciled.conflicts,conflict.key,'saved');
   assert.deepEqual(plain(accepted.changes),retained);assert.equal(accepted.conflicts.length,0);
   assert.ok(editor.quotationSavePlan(after,accepted.changes,'red',false).changes.every(change=>!weight.includes(change.fieldKey)));
   const kept=editor.resolveQuotationEditorConflict(after,changes,reconciled.conflicts,conflict.key,'draft');
   assert.equal(kept.conflicts.length,0);assert.deepEqual(plain(kept.changes),changes);
   assert.equal(editor.quotationSavePlan(after,kept.changes,'red',false).changes.filter(change=>weight.includes(change.fieldKey)&&change.value==='120').length,2);
  }
 }
});

test('weight null reset stays exact and a discarded reset cannot make its retained literal re-pair over the accepted value',()=>{
 const before=savedPair(weight,'100','110'),peerChanged=savedPair(weight,'100','130'),reset=[edit(weight[0],null)];
 const unchanged=editor.reconcileQuotationEditorDraft(before,peerChanged,reset);
 assert.equal(unchanged.conflicts.length,0);assert.deepEqual(plain(unchanged.changes),reset);
 assert.deepEqual(plain(editor.quotationSavePlan(peerChanged,reset,'red',false).changes),reset);
 const ownChanged=savedPair(weight,'130','110'),mixed=[...reset,edit(weight[1],'120'),...retained];
 const reconciled=editor.reconcileQuotationEditorDraft(before,ownChanged,mixed);
 assert.equal(reconciled.conflicts.length,1);assert.equal(reconciled.conflicts[0].change.fieldKey,weight[0]);
 const kept=editor.resolveQuotationEditorConflict(ownChanged,mixed,reconciled.conflicts,reconciled.conflicts[0].key,'draft');
 assert.deepEqual(plain(editor.quotationSavePlan(ownChanged,kept.changes,'red',false).changes.filter(change=>weight.includes(change.fieldKey))),mixed.slice(0,2));
 const accepted=editor.resolveQuotationEditorConflict(ownChanged,mixed,reconciled.conflicts,reconciled.conflicts[0].key,'saved');
 assert.deepEqual(plain(accepted.changes),retained);assert.equal(accepted.conflicts.length,0);
 assert.ok(editor.quotationSavePlan(ownChanged,accepted.changes,'red',false).changes.every(change=>!weight.includes(change.fieldKey)));
});

test('decisions preserve other option scopes and independent OSRP while a changed MSRP binding retains former peer identities',()=>{
 const pair=['msrp','wire-msrp'],before=savedPair(pair,'300'),after=savedPair(pair,'350');
 const changes=[...pairChanges(pair,'400'),...pair.map(id=>edit(id,'500','blue')),edit('wire-osrp','777')];
 const conflict=editor.reconcileQuotationEditorDraft(before,after,changes);
 const saved=editor.resolveQuotationEditorConflict(after,changes,conflict.conflicts,editor.quotationEditorKey('red','msrp'),'saved');
 assert.deepEqual(plain(saved.changes),changes.slice(2));
 const moved=fixture(after.overrides,fields=>fields.filter(field=>field.id!=='wire-msrp'));
 const first=editor.reconcileQuotationEditorDraft(before,moved,changes),repeated=editor.reconcileQuotationEditorDraft(moved,moved,first.changes,first.conflicts);
 const removed=editor.resolveQuotationEditorConflict(moved,repeated.changes,repeated.conflicts,editor.quotationEditorKey('red','msrp'),'saved');
 assert.ok(!removed.changes.some(change=>change.optionId==='red'));
 assert.deepEqual(plain(removed.changes),changes.slice(2,4));
});

test('ambiguous, readonly and removed peers remain reviewable and accepting saved values excludes their paired drafts',()=>{
 const pair=['supplyPrice','wire-supplyPrice'],before=savedPair(pair),changes=[...pairChanges(pair,'120'),...retained];
 for(const transform of [
  fields=>[...fields,{...fields.find(field=>field.id===pair[1]),id:'duplicate-price'}],
  fields=>fields.map(field=>field.id===pair[1]?{...field,readOnly:true}:field),
  fields=>fields.filter(field=>field.id!==pair[1]),
 ]){
  const after=fixture(before.overrides,transform),first=editor.reconcileQuotationEditorDraft(before,after,changes);
  assert.ok(first.conflicts.filter(conflict=>pair.includes(conflict.change.fieldKey)).every(conflict=>conflict.schemaChanged||conflict.unavailable));
  const repeated=editor.reconcileQuotationEditorDraft(after,after,first.changes,first.conflicts);
  if(!after.resolved.schema.fields.some(field=>field.id===pair[1]&&!field.readOnly))assert.ok(repeated.conflicts.filter(conflict=>pair.includes(conflict.change.fieldKey)).every(conflict=>conflict.unavailable),'removed or readonly former peers cannot become available after another refresh');
  const saved=editor.resolveQuotationEditorConflict(after,repeated.changes,repeated.conflicts,editor.quotationEditorKey('red',pair[1]),'saved');
  assert.deepEqual(plain(saved.changes),retained);
  assert.ok(saved.conflicts.every(conflict=>!pair.includes(conflict.change.fieldKey)));
 }
 const stale=editor.resolveQuotationEditorConflict(before,changes,[],editor.quotationEditorKey('red',pair[0]),'saved');
 assert.deepEqual(plain(stale.changes),changes);assert.deepEqual(plain(stale.conflicts),[]);
});

function renderedEditor(view){
 const states=[],refs=[];let cursor=0,refCursor=0,responseView=view;
 const react={useState(initial){const index=cursor++;if(!(index in states))states[index]=index===0?view:index===3?false:typeof initial==='function'?initial():initial;return[states[index],value=>states[index]=typeof value==='function'?value(states[index]):value];},useRef(initial){const index=refCursor++;return refs[index]??={current:initial};},useEffect(){},useCallback:fn=>fn,useId:()=> 'linked-conflict'};
 const form=load('app/components/quotation-fields-editor.tsx',{react,fetch:async()=>Response.json(responseView),document:{getElementById:()=>null}});
 const render=()=>{cursor=0;refCursor=0;const root=form.QuotationFieldsEditor({productId:'p'});return root.type(root.props);};
 const button=(tree,label)=>nodes(tree).find(node=>node.type==='button'&&text(node.props.children)===label);
 render();return{render,get changes(){return states[1];},get conflicts(){return states[2];},
  select(){nodes(render()).find(node=>node.type==='select').props.onChange({target:{value:'red'}});},
  field(id){return nodes(render()).find(node=>node.type==='input'&&node.props.id==='linked-conflict-'+id);},
  async refresh(next){responseView=next;button(render(),'기본값 다시 반영').props.onClick();await new Promise(resolve=>setImmediate(resolve));assert.equal(states[3],false);},
  choose(field,label){const conflict=nodes(render()).find(node=>node.type==='li'&&text(node.props.children).startsWith(field+' · '));assert.ok(conflict);const action=button(conflict,label);assert.ok(action);assert.equal(action.props.disabled,false);action.props.onClick();},
 };
}

for(const pair of [['supplyPrice','wire-supplyPrice'],weight])for(const changedIndex of [0,1])for(const choice of ['저장된 값 사용','내 입력 유지'])test(`rendered ${pair[0]} ${choice} resolves both peer conflicts when peer ${changedIndex} changes`,async()=>{
 const before=savedPair(pair),after=savedPair(pair);after.overrides.options.red[pair[changedIndex]]='130';
 const ui=renderedEditor(before);ui.select();ui.field(pair[1]).props.onChange({target:{value:'120'}});
 ui.field('brand').props.onChange({target:{value:'수정 보존'}});await ui.refresh(after);
 assert.equal(ui.conflicts.length,2);assert.match(text(ui.render()),/연결된 항목에도 같은 선택/);
 ui.choose(pair[1-changedIndex],choice);assert.equal(ui.conflicts.length,0);
 if(choice==='저장된 값 사용'){
  assert.deepEqual(plain(ui.changes),[edit('brand','수정 보존')]);
  assert.ok(editor.quotationSavePlan(after,ui.changes,'red',false).changes.every(change=>!pair.includes(change.fieldKey)));
 }else{
  assert.equal(editor.quotationSavePlan(after,ui.changes,'red',false).changes.filter(change=>pair.includes(change.fieldKey)&&change.value==='120').length,2);
 }
});

test('rendered exclusion removes a deleted exact pair together while retaining another field draft',async()=>{
 const before=savedPair(weight),after=fixture(before.overrides,fields=>fields.filter(field=>field.id!==weight[1]));
 const ui=renderedEditor(before);ui.select();ui.field(weight[1]).props.onChange({target:{value:'120'}});ui.field('brand').props.onChange({target:{value:'수정 보존'}});
 await ui.refresh(after);ui.choose(weight[1],'이 입력 제외');
 assert.equal(ui.conflicts.length,0);assert.deepEqual(plain(ui.changes),[edit('brand','수정 보존')]);
});

test('weight restore preview resolves complete explicit resets while one selected field keeps its per-field semantics',()=>{
 const view=fixture({common:{packagedWeightG:'400','wire-weight':'500',brand:'공통 보존'},options:{red:{packagedWeightG:'600','wire-weight':'610',brand:'빨강 보존'},blue:{packagedWeightG:'','wire-weight':'710'},excluded:{packagedWeightG:'900','wire-weight':'950'}}});
 const changes=[edit('brand','미저장 보존')],snapshot=JSON.stringify([view,changes]);
 for(const selected of [[weight[0]],[weight[1]],weight]){
  const preview=editor.previewQuotationEditorRestore(view,changes,selected,true),draft=editor.applyQuotationEditorBulk(view,changes,preview),plan=editor.quotationSavePlan(view,draft,'red',false);
  assert.equal(preview.rows.length,selected.length*2);
  assert.ok(preview.rows.every(row=>['red','blue'].includes(row.optionId)));
  assert.deepEqual(new Set(preview.changes.map(change=>change.fieldKey)),new Set(selected));
  for(const row of preview.rows){
   const after=editor.resolveQuotationEditorCell(view,plan.changes,row.optionId,row.fieldKey);
   assert.equal(row.after,after.value,'reviewed after-value agrees with the complete save plan');
   if(selected.length===2)assert.equal(row.after,row.fieldKey===weight[0]?'400':'500');
   else assert.equal(row.after,view.overrides.options[row.optionId][row.fieldKey===weight[0]?weight[1]:weight[0]]);
  }
  assert.ok(plan.changes.every(change=>change.optionId!=='excluded'&&change.optionId!==null));
  assert.ok(plan.changes.some(change=>change.fieldKey==='brand'&&change.value==='미저장 보존'));
 }
 assert.equal(JSON.stringify([view,changes]),snapshot);
});
