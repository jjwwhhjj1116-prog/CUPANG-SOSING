import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';

const native=createRequire(import.meta.url),plain=value=>JSON.parse(JSON.stringify(value));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
const oldSha='a'.repeat(64),currentSha='b'.repeat(64),oldId=column=>`workbook_81452_${oldSha}_${column}`,currentId=column=>`workbook_81452_${currentSha}_${column}`;
const sourceKey=(optionId,column)=>JSON.stringify([optionId,oldId(column)]);
const change=(optionId,fieldKey,value)=>({optionId,fieldKey,value});
function fixture(extraRows=0){
 const fields=[{id:currentId(5),label:'검토 대상',section:'product',type:'text',visibility:'common',required:false,maxLength:50,workbookWire:{sha256:currentSha,sheetName:'현재 합성 양식',column:5,requirement:'optional'}},
  {id:currentId(6),label:'현재 선택 방식',section:'product',type:'select',visibility:'common',required:false,maxLength:50,choices:[{value:'가능',label:'가능'}],workbookWire:{sha256:currentSha,sheetName:'현재 합성 양식',column:6,requirement:'optional'}},
  {id:'brand',label:'브랜드',section:'product',type:'text',visibility:'common',required:false,maxLength:50}];
 const scopes=[{optionId:null,optionLabel:'상품 공통값',included:false},{optionId:'red',optionLabel:'빨강 옵션',included:true},{optionId:'excluded',optionLabel:'제외 옵션',included:false},...Array.from({length:extraRows},(_,i)=>({optionId:'extra-'+i,optionLabel:'추가 옵션 '+i,included:true}))];
 const rows=scopes.map(row=>({...row,fields:Object.fromEntries(fields.map(field=>[field.id,{value:'자동 입력',source:'content',issues:[],needsReview:false}]))}));
 const resolved={schema:{version:1,categoryId:'81452',categoryPath:['합성 카테고리'],status:'observed',evidence:'합성 검수 자료',submissionReady:false,fields},rows,issues:[]};
 return{revision:4,inputFingerprint:'c'.repeat(64),productVersion:'2026-10-18T00:00:00.000Z',contentRevision:1,optionRevision:1,updatedAt:null,categoryContext:{source:'profile',profileId:'synthetic-profile',categoryId:'81452',categoryPath:['합성 카테고리']},imageKeys:[],submissionReady:false,
  retainedWorkbook:{name:'이전 합성 양식',sha256:oldSha,fields:[{id:oldId(5),column:5,label:'검토 대상*',type:'text',requirement:'optional',help:''},{id:oldId(6),column:6,label:'이전 방식',type:'text',requirement:'optional',help:''}]},
  overrides:{common:{[oldId(5)]:'이전 공통값',[currentId(5)]:'저장 공통값'},options:Object.fromEntries(scopes.filter(row=>row.optionId!==null).map(row=>[row.optionId,{[oldId(5)]:row.optionId==='red'?'':row.optionId==='excluded'?'  ':'원본 '+row.optionId,...(row.optionId==='red'?{[oldId(6)]:'옛 규칙 값',[currentId(5)]:'저장 빨강값'}:{})}]))},automatic:plain(resolved),resolved};
}

// Real component functions, hooks with dependency/cleanup semantics, local
// request ACKs only. No browser, provider, product database or network exists.
function runtime(fetcher=()=>{throw Error('Unexpected request');}){
 const cache=new Map();let active,late=0;
 const changed=(previous,deps)=>!previous||!deps||deps.length!==previous.deps?.length||deps.some((item,i)=>!Object.is(item,previous.deps[i]));
 const effect=(callback,deps)=>{const i=active.index++,instance=active,previous=instance.slots[i];if(changed(previous,deps))instance.effects.push(()=>{previous?.cleanup?.();instance.slots[i]={kind:'effect',deps,cleanup:callback()};});};
 const hooks={useState(initial){const i=active.index++,instance=active;if(!(i in instance.slots))instance.slots[i]={kind:'state',value:typeof initial==='function'?initial():initial};return[instance.slots[i].value,value=>{if(!instance.alive){late++;return;}instance.slots[i].value=typeof value==='function'?value(instance.slots[i].value):value;}];},
  useRef(initial){const i=active.index++;return active.slots[i]??(active.slots[i]={current:initial});},useEffect:effect,useLayoutEffect:effect,
  useMemo(factory,deps){const i=active.index++,previous=active.slots[i];if(changed(previous,deps))active.slots[i]={kind:'memo',deps,value:factory()};return active.slots[i].value;},
  useCallback(fn,deps){return hooks.useMemo(()=>fn,deps);},useId(){return hooks.useMemo(()=> 'local-review-'+active.id,[]);}};
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
   {exports,Error,TextEncoder,TextDecoder,AbortController,URL,URLSearchParams,structuredClone,fetch:fetcher,window:{addEventListener(){},removeEventListener(){}},document:{getElementById(){return null;}},
    require(name){if(name==='react')return hooks;if(name.endsWith('.css'))return{};if(name.startsWith('@/app/components/')&&!name.endsWith('/quotation-fields-editor')&&!name.endsWith('/quotation-workbook-review'))return new Proxy({},{get:(_target,key)=>typeof key==='string'?function OmittedLeaf(){return null;}:undefined});
     if(name.startsWith('@/')){const path=name.slice(2);return load(path+(fs.existsSync(new URL('../'+path+'.ts',import.meta.url))?'.ts':'.tsx'));}return native(name);}});
  return exports;
 }
 let ids=0;
 function mount(Component,props){const instance={slots:[],index:0,effects:[],alive:true,id:++ids};return{instance,props,render(){active=instance;instance.index=0;instance.effects=[];const tree=Component(this.props);instance.effects.splice(0).forEach(commit=>commit());return tree;},unmount(){if(!instance.alive)return;instance.alive=false;instance.slots.forEach(slot=>{if(slot?.kind==='effect')slot.cleanup?.();});}};}
 return{load,mount,get late(){return late;}};
}
const settle=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
function panelHarness(view=fixture(),changes=[]){
 const r=runtime(),applications=[],onApply=(selected,basis)=>{applications.push({selected:plain(selected),basis});return true;};
 const Component=r.load('app/components/quotation-workbook-review.tsx').QuotationWorkbookReview;
 let panel=r.mount(Component,{view,changes,disabled:false,onApply});panel.render();
 const checkbox=(option,label='검토 대상*')=>nodes(panel.render()).find(node=>node.type==='input'&&node.props['aria-label']===`${option} ${label} 이전 입력 가져오기`);
 const select=(option,label='검토 대상*')=>nodes(panel.render()).find(node=>node.type==='select'&&node.props['aria-label']===`${option} ${label} 현재 대상 항목`);
 const button=()=>nodes(panel.render()).find(node=>node.type==='button'&&text(node).startsWith('선택한 이전 Excel 입력'));
 const mount=(props)=>{panel.unmount();panel=r.mount(Component,{...panel.props,...props});panel.render();};
 return{r,applications,checkbox,select,button,render:()=>panel.render(),update(props){panel.props={...panel.props,...props};return panel.render();},remount:mount,unmount:()=>panel.unmount()};
}

test('real review starts unchecked, shows pending target and literal blanks, and applies only an explicit selection without requests',()=>{
 const view=fixture(),changes=[change('red',currentId(5),'미저장 새 값')],before=JSON.stringify({view,changes}),h=panelHarness(view,changes);
 const preview=text(h.render());assert.match(preview,/이전 합성 양식/);assert.match(preview,/미저장 새 값/);assert.match(preview,/직접 입력한 공란/);assert.match(preview,/공백 2자/);
 assert.match(preview,/공통값은 별도 옵션 입력이 없는 옵션에 상속/);assert.match(preview,/모든 옵션에 적용.*끕니다/);assert.match(preview,/중간 양식.*복구하지/);
 assert.ok(nodes(h.render()).filter(node=>node.type==='input').every(node=>node.props.checked===false));assert.equal(h.button().props.disabled,true);
 assert.equal(h.select('빨강 옵션').props.value,currentId(5));assert.equal(h.applications.length,0);
 h.checkbox('빨강 옵션').props.onChange({target:{checked:true}});assert.equal(h.button().props.disabled,false);h.button().props.onClick();
 assert.deepEqual(h.applications[0].selected,[{sourceKey:sourceKey('red',5),targetFieldKey:currentId(5)}]);assert.equal(h.applications.length,1);assert.equal(JSON.stringify({view,changes}),before);h.unmount();
});

test('current incompatible choices stay unselected and display the actual current-rule issue; changing target clears a prior selection',()=>{
 const h=panelHarness(),option='빨강 옵션',label='이전 방식';
 assert.equal(h.select(option,label).props.value,'','a different header cannot receive a guessed suggestion');
 h.select(option,label).props.onChange({target:{value:currentId(6)}});assert.match(text(h.render()),/지원하는 선택값/);assert.equal(h.checkbox(option,label).props.disabled,true);
 h.select(option,label).props.onChange({target:{value:currentId(5)}});h.checkbox(option,label).props.onChange({target:{checked:true}});assert.equal(h.checkbox(option,label).props.checked,true);
 h.select(option,label).props.onChange({target:{value:currentId(6)}});assert.equal(h.checkbox(option,label).props.checked,false);assert.equal(h.button().props.disabled,true);h.unmount();
});

test('changed help, requirement and choices are visible beside neutral automatic blank and reviewable required manual blank',()=>{
 const view=fixture();view.retainedWorkbook.fields[0].requirement='optional';view.retainedWorkbook.fields[0].help='이전에는 설치를 제공할 때 작성';
 view.resolved.schema.fields[0].required=true;view.resolved.schema.fields[0].workbookWire.requirement='required';view.resolved.schema.fields[0].help='현재는 설치 여부와 무관하게 제공 방식 확인';
 delete view.overrides.common[currentId(5)];delete view.overrides.options.red[currentId(5)];
 for(const resolved of [view.resolved,view.automatic])for(const row of resolved.rows)row.fields[currentId(5)]={value:'',source:'empty',issues:[],needsReview:false};
 const h=panelHarness(view);h.select('빨강 옵션','이전 방식').props.onChange({target:{value:currentId(6)}});const preview=text(h.render());
 assert.match(preview,/이전에는 설치를 제공할 때 작성/);assert.match(preview,/현재는 설치 여부와 무관하게 제공 방식 확인/);assert.match(preview,/이전:.*선택.*현재:.*필수/);
 assert.match(preview,/옛 규칙 값/);assert.match(preview,/선택값: 가능/);assert.match(preview,/필수 값이 비어 있습니다.*저장 후 검토 필요/);assert.doesNotMatch(preview,/현재 입력 규칙에 맞음/);
 const redRow=nodes(h.render()).find(node=>node.type==='tr'&&nodes(node).some(child=>child.type==='input'&&child.props['aria-label']==='빨강 옵션 검토 대상* 이전 입력 가져오기'));
 const cells=nodes(redRow.props.children).filter(node=>node.type==='td');assert.equal(text(cells[2]),'(직접 입력한 공란)');assert.equal(text(cells[4]),'(공란)');
 assert.equal(h.checkbox('빨강 옵션').props.disabled,false,'blank remains a valid manual draft while its required presence is flagged for review');h.checkbox('빨강 옵션').props.onChange({target:{checked:true}});h.button().props.onClick();assert.equal(h.applications.length,1);h.unmount();
});

test('duplicate current target choices are shown and rejected rather than silently overwriting one selected source',()=>{
 const h=panelHarness();h.checkbox('빨강 옵션').props.onChange({target:{checked:true}});
 h.select('빨강 옵션','이전 방식').props.onChange({target:{value:currentId(5)}});h.checkbox('빨강 옵션','이전 방식').props.onChange({target:{checked:true}});
 assert.match(text(h.render()),/대상 항목이 중복/);h.button().props.onClick();assert.equal(h.applications.length,0);assert.match(text(h.render()),/중복 선택/);h.unmount();
});

test('paging accounts for every old value and preserves explicit selections across pages without silent truncation',()=>{
 const h=panelHarness(fixture(30));assert.match(text(h.render()),/전체 34개.*1\/2페이지/);assert.equal(nodes(h.render()).filter(node=>node.type==='input').length,25);
 h.checkbox('상품 공통값').props.onChange({target:{checked:true}});nodes(h.render()).find(node=>node.type==='button'&&text(node)==='다음 비교 페이지').props.onClick();
 assert.match(text(h.render()),/2\/2페이지/);assert.equal(nodes(h.render()).filter(node=>node.type==='input').length,9);assert.match(text(h.render()),/선택 1개/);
 const last=nodes(h.render()).find(node=>node.type==='input'&&!node.props.disabled);last.props.onChange({target:{checked:true}});h.button().props.onClick();assert.equal(h.applications[0].selected.length,2);assert.equal(h.applications[0].selected[0].sourceKey,sourceKey(null,5));h.unmount();
});

test('busy, updated view/draft and unmount reject retained real checkbox, target and apply callbacks',()=>{
 const view=fixture(),h=panelHarness(view);h.checkbox('빨강 옵션').props.onChange({target:{checked:true}});
 const oldCheck=h.checkbox('상품 공통값').props.onChange,oldTarget=h.select('빨강 옵션').props.onChange,oldApply=h.button().props.onClick;
 h.update({disabled:true});oldCheck({target:{checked:true}});oldTarget({target:{value:currentId(6)}});oldApply();assert.equal(h.applications.length,0);assert.equal(h.checkbox('상품 공통값').props.checked,false);
 h.update({disabled:false});oldApply();assert.equal(h.applications.length,0,'false→true→false must retire old publishers');
 const enabledApply=h.button().props.onClick;h.update({view:{...view,revision:5,inputFingerprint:'d'.repeat(64)}});enabledApply();assert.equal(h.applications.length,0);
 h.remount({view,changes:[change('red',currentId(5),'수정한 새 초안')]});assert.equal(h.checkbox('빨강 옵션').props.checked,false,'parent revision/fingerprint/draft key remount resets selection');
 h.checkbox('빨강 옵션').props.onChange({target:{checked:true}});const unmountedApply=h.button().props.onClick,unmountedCheck=h.checkbox('상품 공통값').props.onChange;h.unmount();unmountedApply();unmountedCheck({target:{checked:true}});assert.equal(h.applications.length,0);assert.equal(h.r.late,0);
});

function parentHarness(initial,company='local-yun'){
 const calls=[],model=providedOptionModule('app/quotation-schema.ts');let server=plain(initial),saved=0;
 const r=runtime(async(url,init={})=>{calls.push({url,method:init.method??'GET',body:init.body?JSON.parse(init.body):null});if(init.method==='PUT'){
  const next=plain(server);next.overrides=plain(model.applyQuotationChanges(server.overrides,JSON.parse(init.body).changes));next.revision++;next.inputFingerprint='f'.repeat(64);next.productVersion='2026-10-18T00:00:00.001Z';next.updatedAt=next.productVersion;
  for(const row of next.resolved.rows)for(const field of next.resolved.schema.fields){const own=row.optionId===null?undefined:next.overrides.options[row.optionId],common=next.overrides.common;
   row.fields[field.id]=own&&Object.hasOwn(own,field.id)?{value:own[field.id],source:'manual-option',needsReview:false,issues:[]}:Object.hasOwn(common,field.id)?{value:common[field.id],source:'manual-common',needsReview:false,issues:[]}:plain(next.automatic.rows.find(item=>item.optionId===row.optionId).fields[field.id]);}
  server=next;
 }return Response.json(server);});
 const Editor=r.load('app/components/quotation-fields-editor.tsx').QuotationFieldsEditor,wrapper=Editor({productId:company+'-product',onSaved(){saved++;}}),form=r.mount(wrapper.type,wrapper.props);
 const render=()=>form.render(),panel=()=>nodes(render()).find(node=>node.type?.name==='QuotationWorkbookReview'),primary=()=>nodes(render()).find(node=>node.type==='input'&&node.props.role==='switch'),save=()=>nodes(render()).find(node=>node.type==='button'&&text(node).startsWith('견적 입력 저장'));
 return{r,calls,render,panel,primary,save,form,get server(){return server;},get saved(){return saved;},async ready(){render();await settle();render();assert.ok(panel());},unmount:()=>form.unmount()};
}

for(const company of ['local-yun','local-yhop'])test(`actual editor stages only explicit common/option imports, disables broad propagation and saves once on explicit Save (${company})`,async()=>{
 const initial=fixture(),before=JSON.stringify(initial),h=parentHarness(initial,company);await h.ready();
 const selector=nodes(h.render()).find(node=>node.type==='select'&&nodes(node.props.children).some(child=>child.type==='option'&&child.props.value==='red'));
 selector.props.onChange({target:{value:'red'}});h.primary().props.onChange({target:{checked:true}});assert.equal(h.primary().props.checked,true);
 const props=h.panel().props,basis=providedOptionModule('app/quotation-workbook-review.ts').quotationWorkbookReviewBasis(props.view,props.changes);
 const oldSave=h.save().props.onClick;assert.equal(props.onApply([{sourceKey:sourceKey('red',5),targetFieldKey:currentId(5)},{sourceKey:sourceKey(null,5),targetFieldKey:currentId(5)}],basis),true);
 assert.equal(h.calls.filter(call=>call.method==='PUT').length,0);oldSave();await settle();assert.equal(h.calls.filter(call=>call.method==='PUT').length,0,'retained pre-import Save cannot submit a different draft');
 assert.equal(props.onApply([{sourceKey:sourceKey('excluded',5),targetFieldKey:currentId(5)}],basis),false,'retained importer cannot overwrite the newer unsaved draft');
 assert.equal(h.primary().props.checked,false);assert.match(text(h.render()),/모든 옵션에 적용을 껐습니다/);
 const staged=h.panel().props.changes;assert.deepEqual(plain(staged),[change('red',currentId(5),''),change(null,currentId(5),'이전 공통값')]);
 h.save().props.onClick();await settle();h.render();assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);assert.equal(h.saved,1);
 assert.deepEqual(h.calls.find(call=>call.method==='PUT').body.changes,plain(staged));assert.equal(h.server.overrides.options.red[currentId(5)],'');assert.equal(h.server.overrides.common[currentId(5)],'이전 공통값');
 assert.equal(Object.hasOwn(h.server.overrides.options.excluded,currentId(5)),false);assert.equal(h.server.overrides.options.excluded[oldId(5)],'  ');assert.equal(JSON.stringify(initial),before);h.unmount();assert.equal(h.r.late,0);
});

test('actual parent rejects retained imports while another operation is busy and after unmount',async()=>{
 const h=parentHarness(fixture());await h.ready();const panel=h.panel().props,helper=providedOptionModule('app/quotation-workbook-review.ts'),basis=helper.quotationWorkbookReviewBasis(panel.view,panel.changes),selection=[{sourceKey:sourceKey('red',5),targetFieldKey:currentId(5)}];
 nodes(h.render()).find(node=>node.type?.name==='OmittedLeaf'&&node.props.onBusyChange&&node.props.optionId===null).props.onBusyChange(true);
 assert.equal(panel.onApply(selection,basis),false);assert.equal(h.calls.filter(call=>call.method==='PUT').length,0);h.unmount();assert.equal(panel.onApply(selection,basis),false);assert.equal(h.r.late,0);
});
