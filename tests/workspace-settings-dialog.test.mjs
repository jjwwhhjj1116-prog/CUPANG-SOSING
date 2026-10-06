import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const text=t=>Array.isArray(t)?t.map(text).join(''):t&&typeof t==='object'?text(t.props?.children):String(t??'');
function harness(fetcher,{workspaceOwnerId}={}){
 const slots=[],effects=[],calls=[],saved=[];let index=0,closed=false,late=0,saves=0;
 const Editor=()=>null;
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{if(closed)late++;slots[i]=typeof v==='function'?v(slots[i]):v;}];},useEffect(fn,deps){const i=index++;if(!slots[i]||JSON.stringify(slots[i].deps)!==JSON.stringify(deps)){slots[i]?.cleanup?.();effects.push(()=>{slots[i]={deps,cleanup:fn()};});}}};
 function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,fetch:(url,init)=>{calls.push({url,init});return fetcher(url,init);},require(name){if(name==='react')return hooks;if(name==='@/app/components/workspace-settings-editor')return{WorkspaceSettingsEditor:Editor};if(name.startsWith('@/'))return load(name.slice(2)+'.ts');return native(name);}});return exports;}
 const Component=load('app/components/workspace-settings-dialog.tsx').WorkspaceSettingsDialog;
 const render=()=>{index=0;const tree=Component({workspaceOwnerId,onSave:async(value,scope)=>{saves++;saved.push({value,scope});},onClose:()=>{}});effects.splice(0).forEach(fn=>fn());return tree;};
 render();return{render,calls,saved,editor:()=>nodes(render()).find(n=>n.type===Editor),switchOwner(value){workspaceOwnerId=value;return render();},close(){closed=true;slots.forEach(slot=>slot?.cleanup?.());},get late(){return late;},get saves(){return saves;}};
}
test('settings editor stays absent until a fresh successful read and displays saved facts',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);const h=harness(()=>pending);
 assert.equal(h.editor(),undefined);assert.equal(h.calls[0].url,'/api/settings');assert.equal(h.calls[0].init.cache,'no-store');
 resolve(Response.json({settings:{brand:'저장 브랜드',exchangeRate:350}}));await settle();
 assert.equal(h.editor().props.value.brand,'저장 브랜드');assert.equal(h.editor().props.value.exchangeRate,350);assert.equal(h.editor().props.value.manufacturer,'');assert.equal(h.saves,0);
});
test('failed or malformed reads cannot expose fallback editor and retry can recover',async()=>{
 for(const result of [()=>Response.json({error:'읽기 실패'},{status:503}),()=>Response.json({}),()=>Response.json({settings:{exchangeRate:-1}})]){
  let attempt=0;const h=harness(async()=>++attempt===1?result():Response.json({settings:null}));await settle();assert.equal(h.editor(),undefined);
  nodes(h.render()).find(n=>n.type==='button'&&n.props.children==='기본설정 다시 불러오기').props.onClick();h.render();assert.equal(h.editor(),undefined);await settle();assert.equal(h.editor().props.value.brand,'');assert.equal(h.saves,0);
 }
});
test('closing the settings read aborts the request and ignores late data',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);const h=harness(()=>pending);h.close();assert.equal(h.calls[0].init.signal.aborted,true);resolve(Response.json({settings:{brand:'late'}}));await settle();assert.equal(h.late,0);assert.equal(h.saves,0);
});

const accountScope=(ownerId,code='A01526306')=>({ownerId,company:{code,name:code==='A01526306'?'유앤채':'와이홉'}});
test('account-bound settings display their company and save with the scope that loaded the draft',async()=>{
 for(const [ownerId,code,brand] of [['admin','A01526306','유앤채'],['member','A01464742','와이홉']]){
  const scope=accountScope(ownerId,code),h=harness(async()=>Response.json({settings:{brand,manufacturer:'',importer:brand},scope}),{workspaceOwnerId:ownerId});await settle();
  const editor=h.editor();assert.equal(editor.props.value.brand,brand);assert.equal(editor.props.value.manufacturer,'');assert.equal(editor.key,ownerId);
  assert.ok(nodes(h.render()).some(n=>n.type==='strong'&&text(n)===brand+' 기본설정'));
  await editor.props.onSave(editor.props.value);assert.equal(h.saves,1);assert.deepEqual(JSON.parse(JSON.stringify(h.saved[0].scope)),scope);h.close();
 }
});
test('wrong or missing account scope cannot reveal an editable other-account draft',async()=>{
 for(const scope of [undefined,accountScope('member','A01464742'),{ownerId:'admin',company:{code:'A01464742',name:'유앤채'}}]){
  const h=harness(async()=>Response.json({settings:{brand:'다른 계정 입력'},...(scope?{scope}:{})}),{workspaceOwnerId:'admin'});await settle();
  assert.equal(h.editor(),undefined);assert.equal(h.saves,0);assert.ok(nodes(h.render()).some(n=>n.props?.role==='alert'));h.close();
 }
});
test('switching the page owner clears the former editor and ignores its late settings response',async()=>{
 const deferred=[],h=harness(()=>new Promise(resolve=>deferred.push(resolve)),{workspaceOwnerId:'admin'});
 assert.equal(h.calls.length,1);h.switchOwner('member');assert.equal(h.editor(),undefined);assert.equal(h.calls[0].init.signal.aborted,true);assert.equal(h.calls.length,2);
 deferred[0](Response.json({settings:{brand:'유앤채'},scope:accountScope('admin')}));await settle();assert.equal(h.editor(),undefined);
 deferred[1](Response.json({settings:{brand:'와이홉'},scope:accountScope('member','A01464742')}));await settle();assert.equal(h.editor().props.value.brand,'와이홉');assert.equal(h.editor().key,'member');assert.equal(h.saves,0);h.close();
});

test('basic settings notice and logistics inputs save the reviewed values, including zero and opt-in month', async () => {
 const slots=[];let index=0,saved;
 function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,require(name){
  if(name==='react')return{useRef(initial){const i=index++;return slots[i]??(slots[i]={current:initial});},useState(initial){const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];}};
  if(name==='@/app/components/settings-price-preview')return{SettingsPricePreview:()=>null};
  if(name.startsWith('@/'))return load(name.slice(2)+'.ts');return native(name);
 }});return exports;}
 const initial=load('app/workspace-settings.ts').newWorkspaceSettings,Editor=load('app/components/workspace-settings-editor.tsx').WorkspaceSettingsEditor;
 const render=()=>{index=0;return Editor({value:initial,onSave:async value=>{saved=value;},onClose:()=>{}});};
 const input=label=>nodes(nodes(render()).find(node=>node.type==='label'&&nodes(node.props.children).some(child=>child.type==='span'&&child.props.children===label))).find(node=>['input','select'].includes(node.type));
 assert.equal(input('유통기간 · 식품의 경우 소비기간 (일)').props.value,'0');
 assert.equal(input('취급주의 사유').props.value,'해당사항없음');
 input('세탁방법').props.onChange({target:{value:'손세탁'}});
 input('취급시 주의사항').props.onChange({target:{value:'화기 주의'}});
 input('제조년월 · 전월 자동 입력').props.onChange({target:{checked:true}});
 input('취급주의 사유').props.onChange({target:{value:'유리'}});
 await render().props.onSubmit({preventDefault(){}});
 assert.equal(saved.washingMethod,'손세탁');assert.equal(saved.handlingPrecautions,'화기 주의');assert.equal(saved.manufactureDatePreviousMonth,true);assert.equal(saved.shelfLifeDays,0);assert.equal(saved.handlingReason,'유리');
 input('유통기간 · 식품의 경우 소비기간 (일)').props.onChange({target:{value:''}});
 await render().props.onSubmit({preventDefault(){}});assert.equal(saved.shelfLifeDays,null);
 input('유통기간 · 식품의 경우 소비기간 (일)').props.onChange({target:{value:'-1'}});
 await render().props.onSubmit({preventDefault(){}});assert.equal(saved.shelfLifeDays,null);assert.ok(nodes(render()).some(node=>node.props?.role==='alert'));
});
