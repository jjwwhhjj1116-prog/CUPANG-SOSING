import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):typeof value==='string'||typeof value==='number'?String(value):'';
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function harness(handlers={}){
 const slots=[],effects=[],cleanups=[],calls={render:0,attach:0,batch:0,attached:0,busy:[]};let index=0,first=true;
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=index++;return slots[i]??(slots[i]={current:initial});},useEffect(fn){if(first)effects.push(fn);}};
 const view={resolved:{rows:[{optionId:'one',included:true}]}};
 const exports={};const file='app/components/quotation-label-panel.tsx';
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,URL:{createObjectURL:()=> 'blob:preview',revokeObjectURL(){}},require(name){
  if(name==='react')return hooks;
  if(name==='@/app/quotation-label-plan')return{quotationLabelPlan:resolved=>({value:resolved.savedValue})};
  if(name==='@/app/document-image-render')return{renderDocument:async()=>{calls.render++;return handlers.render?handlers.render():{blob:new Blob(['png']),width:100,height:100};}};
  if(name==='@/app/quotation-label-attachment')return{attachQuotationLabel:async()=>{calls.attach++;return handlers.attach?handlers.attach():view;}};
  if(name==='@/app/quotation-label-batch')return{attachQuotationLabels:async input=>{calls.batch++;return handlers.batch?handlers.batch(input):{view};}};
  return native(name);
 }});
 const render=()=>{index=0;const tree=exports.QuotationLabelPanel({view,productId:'p',endpoint:'/quotation',optionId:'one',disabled:false,onBusyChange:value=>calls.busy.push(value),onAttached:()=>calls.attached++});first=false;return tree;};
 const buttons=()=>Object.fromEntries(nodes(render()).filter(n=>n.type==='button').map(n=>[text(n.props.children),n.props.onClick]));
 render();effects.forEach(fn=>cleanups.push(fn()));
 return{calls,view,render,buttons,unmount(){cleanups.forEach(fn=>fn?.());}};
}
const preview='저장된 견적 값으로 PNG 미리보기';
const attach='PNG 업로드·선택 옵션 견적에 연결';
const batch='전체 포함 옵션 라벨 생성·연결 (1건)';

test('quotation PNG rendering blocks repeated clicks and overlapping batch work before rerender',async()=>{
 const pending=deferred();const h=harness({render:()=>pending.promise});const buttons=h.buttons();
 buttons[preview]();buttons[preview]();buttons[batch]();assert.equal(h.calls.render,1);assert.equal(h.calls.batch,0);
 pending.resolve({blob:new Blob(['png']),width:100,height:100});await settle();assert.ok(h.buttons()[attach]);
 h.buttons()[batch]();await settle();assert.equal(h.calls.batch,1);assert.equal(h.calls.attached,1);
});

test('single and batch attachment share a synchronous lock and release it after success or failure',async()=>{
 for(const operation of ['attach','batch']){
  const pending=deferred();let attempt=0;
  const h=harness({[operation]:()=>++attempt===1?pending.promise:operation==='batch'?{view:{}}:{}});
  h.buttons()[preview]();await settle();const buttons=h.buttons();const selected=operation==='attach'?attach:batch;
  buttons[selected]();buttons[selected]();buttons[preview]();buttons[operation==='attach'?batch:attach]();
  assert.equal(h.calls[operation],1);assert.equal(h.calls[operation==='attach'?'batch':'attach'],0);assert.equal(h.calls.render,1);
  pending.reject(Error('연결 실패'));await settle();assert.match(JSON.stringify(h.render()),/연결 실패/);
  h.buttons()[selected]();await settle();assert.equal(h.calls[operation],2);assert.equal(h.calls.attached,1);assert.deepEqual(h.calls.busy,[true,false,true,false]);
 }
});

test('late rendering after panel closure cannot publish a preview',async()=>{
 const pending=deferred();const h=harness({render:()=>pending.promise});h.buttons()[preview]();h.unmount();pending.resolve({blob:new Blob(['png']),width:100,height:100});await settle();assert.equal(h.buttons()[attach],undefined);assert.equal(h.calls.attached,0);
});


test('option label retry invalidates uploaded images when saved quotation or category changes',async()=>{
 const seen=[];const h=harness({batch:input=>{seen.push(input.uploaded.get('one'));input.uploaded.set('one','uploaded.png');throw Error('retry');}});
 h.buttons()[batch]();await settle();h.buttons()[batch]();await settle();
 assert.deepEqual(seen,[undefined,'uploaded.png']);
 h.view.resolved.savedValue='수정한 표시사항';h.buttons()[batch]();await settle();
 assert.equal(seen[2],undefined);
 h.view.categoryContext={categoryId:'new'};h.buttons()[batch]();await settle();
 assert.equal(seen[3],undefined);
 h.buttons()[batch]();await settle();assert.equal(seen[4],'uploaded.png');
});
