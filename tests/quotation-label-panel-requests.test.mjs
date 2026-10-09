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
function harness(handlers={},batchCache={current:{signature:null,uploaded:new Map()}},uploadCache={current:{signature:null,uploadedKey:null,rendered:null}}){
 const slots=[],effects=[],cleanups=[],calls={render:0,attach:0,batch:0,attached:0,snapshots:[],busy:[]};let index=0,first=true;
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=index++;return slots[i]??(slots[i]={current:initial});},useEffect(fn){if(first)effects.push(fn);}};
 const view={revision:1,inputFingerprint:'1'.repeat(64),productVersion:'2026-10-07T00:00:00.000Z',updatedAt:'2026-10-07T00:00:00.000Z',contentRevision:2,optionRevision:3,imageKeys:[],overrides:{common:{},options:{}},categoryContext:{source:'collection',profileId:null,categoryId:'80719',categoryPath:['주방용품']},resolved:{schema:{categoryId:'80719',categoryPath:['주방용품'],fields:[]},rows:[{optionId:'one',optionLabel:'옵션 1',included:true,fields:{}}]}};
 const props={productId:'p',endpoint:'/api/products/p/quotation-fields',optionId:'one'};
 const exports={};const file='app/components/quotation-label-panel.tsx';
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,URL:{createObjectURL:()=> 'blob:preview',revokeObjectURL(){}},require(name){
  if(name==='react')return hooks;
  if(name==='@/app/quotation-label-plan')return{quotationLabelPlan:resolved=>({value:resolved.savedValue})};
  if(name==='@/app/document-image-render')return{renderDocument:async plan=>{calls.render++;return handlers.render?handlers.render(plan):{blob:new Blob(['png']),width:100,height:100};}};
  if(name==='@/app/quotation-label-attachment')return{attachQuotationLabel:async input=>{calls.attach++;return handlers.attach?handlers.attach(input):view;}};
  if(name==='@/app/quotation-label-batch')return{attachQuotationLabels:async input=>{calls.batch++;return handlers.batch?handlers.batch(input):{view};}};
  return native(name);
 }});
 const render=()=>{index=0;const tree=exports.QuotationLabelPanel({view,...props,disabled:false,batchCache,uploadCache,onBusyChange:value=>calls.busy.push(value),onFailed:handlers.onFailed,onAttached:(saved,progress)=>{calls.attached++;calls.snapshots.push({saved,progress});}});first=false;return tree;};
 const buttons=()=>Object.fromEntries(nodes(render()).filter(n=>n.type==='button').map(n=>[text(n.props.children),n.props.onClick]));
 render();effects.forEach(fn=>cleanups.push(fn()));
 return{calls,view,props,batchCache,uploadCache,render,buttons,unmount(){cleanups.forEach(fn=>fn?.());}};
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


test('stopping after a saved option publishes the latest quotation for continued editing',async()=>{
 const current={resolved:{rows:[{optionId:'one',included:true}]},revision:3,inputFingerprint:'2'.repeat(64)};
 const h=harness({batch:async input=>{input.uploaded.set('one','saved.png');return{view:current,completed:1,total:2,stopped:true};}});
 h.buttons()[batch]();await settle();
 assert.equal(h.calls.attached,1,'the saved revision must reach the quotation editor after a stop');
 assert.equal(h.calls.snapshots[0].saved,current);
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls.snapshots[0].progress)),{completed:1,total:2,stopped:true});
 assert.deepEqual(h.calls.busy,[true,false]);
 const empty=harness({batch:async input=>({view:input.view,completed:0,total:1,stopped:true})});
 empty.buttons()[batch]();await settle();assert.equal(empty.calls.attached,0);
});

test('a stopped label batch reuses its files after the quotation panel remounts with the saved revision',async()=>{
 const cache={current:{signature:null,uploaded:new Map()}},seen=[];
 const first=harness({batch:async input=>{seen.push(input.uploaded.get('one'));input.uploaded.set('one','saved.png');return{view:input.view,completed:1,total:2,stopped:true};}},cache);
 first.buttons()[batch]();await settle();first.unmount();
 const second=harness({batch:async input=>{seen.push(input.uploaded.get('one'));return{view:input.view,completed:1,total:1,stopped:false};}},cache);
 second.view.revision=3;second.view.inputFingerprint='2'.repeat(64);second.buttons()[batch]();await settle();
 assert.deepEqual(seen,[undefined,'saved.png'],'a view refresh must not regenerate completed PNGs');
 assert.equal(second.calls.attached,1);
 second.unmount();
 const changed=harness({batch:async input=>{seen.push(input.uploaded.get('one'));return{view:input.view,completed:1,total:1,stopped:false};}},cache);
 changed.view.resolved.savedValue='changed model';changed.buttons()[batch]();await settle();
 assert.equal(seen[2],undefined,'changed label contents must not reuse the old PNG');
});


test('failed batch keeps the shared lock until saved-view recovery settles',async()=>{
 const recovery=deferred(),messages=[];
 const h=harness({batch:()=>{throw Error('batch response lost');},onFailed:message=>{messages.push(message);return recovery.promise;}});
 h.buttons()[batch]();await settle();assert.equal(messages.length,1);assert.match(messages[0],/batch response lost/);
 assert.deepEqual(h.calls.busy,[true]);h.buttons()[batch]();assert.equal(h.calls.batch,1);
 recovery.resolve();await settle();assert.deepEqual(h.calls.busy,[true,false]);
 h.buttons()[batch]();await settle();assert.equal(h.calls.batch,2);
});

test('a failed batch cannot start saved-view recovery after its panel closes',async()=>{
 const pending=deferred(),messages=[];
 const h=harness({batch:()=>pending.promise,onFailed:async message=>{messages.push(message);}});
 h.buttons()[batch]();h.unmount();pending.reject(Error('late response lost'));await settle();
 assert.deepEqual(messages,[]);assert.equal(h.calls.attached,0);assert.deepEqual(h.calls.busy,[true,false]);
});


for(const scope of ['productId','endpoint','category'])test('single label reuse rejects a different '+scope,async()=>{
 const seen=[];const h=harness({attach:input=>{input.onUploaded('single.png');throw Error('response lost');},batch:input=>{seen.push(input.uploaded.get('one'));return{view:input.view};}});
 h.buttons()[preview]();await settle();h.buttons()[attach]();await settle();
 if(scope==='category')h.view.categoryContext={categoryId:'another'};else h.props[scope]='another';
 h.buttons()[batch]();await settle();assert.deepEqual(seen,[undefined]);
});

test('an uploaded batch option can be reviewed singly without crossing option identities',async()=>{
 const seen=[];const h=harness({batch:input=>{input.uploaded.set('one','one.png');input.uploaded.set('two','two.png');return{view:input.view};},attach:input=>{seen.push(input.uploadedKey);return input.renderedView;}});
 h.view.resolved.rows.push({optionId:'two',included:true});
 h.buttons()['전체 포함 옵션 라벨 생성·연결 (2건)']();await settle();
 for(const optionId of ['one','two']){h.props.optionId=optionId;h.buttons()[preview]();await settle();h.buttons()[attach]();await settle();}
 assert.deepEqual(seen,['one.png','two.png']);
});

test('a preview-only batch reuses its Blob only for the reviewed option, even with identical plans',async()=>{
 const seen=[];const h=harness({batch:async input=>{seen.push((await input.render({value:undefined},'one')).blob);seen.push((await input.render({value:undefined},'two')).blob);return{view:input.view};}});
 h.view.resolved.rows.push({optionId:'two',included:true});
 h.buttons()[preview]();await settle();const reviewed=h.uploadCache.current.rendered.blob;
 h.buttons()['전체 포함 옵션 라벨 생성·연결 (2건)']();await settle();
 assert.equal(h.calls.render,2);assert.equal(seen[0],reviewed);assert.notEqual(seen[1],reviewed);
});

test('a late single upload cannot replace a newer option plan in either cache',async()=>{
 const pending=deferred();let upload;
 const h=harness({attach:input=>{upload=input.onUploaded;return pending.promise;}});
 h.buttons()[preview]();await settle();h.buttons()[attach]();
 h.uploadCache.current.signature='newer';h.uploadCache.current.uploadedKey='newer.png';
 h.batchCache.current.optionSignatures=new Map([['one','newer']]);h.batchCache.current.uploaded.set('one','newer.png');
 upload('old.png');pending.resolve(h.view);await settle();
 assert.equal(h.uploadCache.current.uploadedKey,'newer.png');assert.equal(h.batchCache.current.uploaded.get('one'),'newer.png');
});


test('restoring an earlier batch plan does not reuse a later single-option PNG',async()=>{
 const seen=[];const h=harness({batch:input=>{seen.push(input.uploaded.get('one'));input.uploaded.set('one','original.png');return{view:input.view};},attach:input=>{input.onUploaded('changed.png');return input.renderedView;}});
 h.buttons()[batch]();await settle();
 h.view.resolved.savedValue='changed';h.buttons()[preview]();await settle();h.buttons()[attach]();await settle();
 h.view.resolved.savedValue=undefined;h.buttons()[batch]();await settle();
 assert.deepEqual(seen,[undefined,undefined],'per-option evidence wins over an old matching batch signature');
});
