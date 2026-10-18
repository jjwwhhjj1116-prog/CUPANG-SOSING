import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));

/** Actual TSX siblings, with the Dashboard's reciprocal busy/disabled wiring.
 * Transport results and DOM/storage are inert fixtures. Hook state uses
 * Object.is, render-phase restarts, and shared layout-before-passive commits;
 * this specifically covers coupling missed by isolated child hook fixtures.
 * It does not claim native React/browser or backend handler execution. */
function harness({familyStatus=200,batchStatus=200,disabled=false,held=[]}={}){
 const props={productId:'idle-product',optionId:'idle-option',profileId:'idle-profile',stage:'detail',version:'2026-10-18T01:00:00.000Z',refreshToken:'0',active:true,disabled};
 const busy={batch:false,family:false},reads=[],callbacks=[],gates=new Map(held.map(kind=>[kind,deferred()])),components=[];
 let epoch=0,closed=false,late=0;
 const change=kind=>value=>{callbacks.push([kind,value]);if(!Object.is(busy[kind],value)){busy[kind]=value;epoch++;}};
 const onBatchBusy=change('batch'),onFamilyBusy=change('family');
 async function read(kind,basis,signal){
  const row={kind,basis:{...basis},version:props.version,signal,number:reads.length+1};reads.push(row);
  const gate=gates.get(kind);if(gate){gates.delete(kind);row.gate=gate;await gate.promise;}
  // Let the reciprocal parent busy state commit before the HTTP-like reply.
  // An immediately resolved promise hides the real browser's lock transition.
  await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
  const status=kind==='batch'?batchStatus:familyStatus;
  if(status!==200)throw Error(kind+' HTTP '+status);
  return kind==='batch'?{productVersion:row.version,marker:row.number}:{format:'detail-family-catalog-v1',sourceProductId:basis.productId,sourceVersion:row.version,inputFingerprint:'a'.repeat(64),company:{code:'A01464742',name:'합성 회사'},familyId:'idle-family',sourceReady:false,targets:[]};
 }
 function leaf(file,name,dependencies){
  const slots=[],pending=new Map();let cursor=0,rendering=false,restart=false,tree;
  const state=initial=>{const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};
   return[slots[index].value,value=>{if(closed){late++;return;}const next=typeof value==='function'?value(slots[index].value):value;
    if(Object.is(next,slots[index].value))return;slots[index].value=next;epoch++;if(rendering)restart=true;}];};
  const effect=(kind,fn,deps)=>{const index=cursor++,old=slots[index];if(!old||!same(old.deps,deps))pending.set(index,{kind,fn,deps});};
  const hooks={useState:state,useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useId(){const index=cursor++;return slots[index]??(slots[index]='idle-'+index);},useEffect:(fn,deps)=>effect('passive',fn,deps),useLayoutEffect:(fn,deps)=>effect('layout',fn,deps)};
  class Element{focus(){}get isConnected(){return true;}querySelectorAll(){return[];}}
  const jsx=(type,childProps)=>{if(childProps?.ref&&!childProps.ref.current)childProps.ref.current=new Element();return{type,props:childProps??{}};};
  const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
   {exports,Error,Date,AbortController,Blob,URL,HTMLElement:Element,document:{activeElement:null},sessionStorage:{getItem:()=>null},window:{addEventListener(){},removeEventListener(){}},
    require(module){if(module==='react')return hooks;if(module==='react/jsx-runtime')return{jsx,jsxs:jsx};if(module in dependencies)return dependencies[module];throw Error(module);}});
  const component={render(value){let passes=0;do{restart=false;pending.clear();cursor=0;rendering=true;tree=exports[name](value);rendering=false;assert.ok(++passes<10,'render-phase state must settle');}while(restart);return tree;},
   commit(kind){for(const[index,next]of [...pending])if(next.kind===kind){slots[index]?.cleanup?.();slots[index]={deps:next.deps,cleanup:next.fn()};pending.delete(index);}},
   close(){for(const slot of slots)slot?.cleanup?.();},get tree(){return tree;}};components.push(component);return component;
 }
 const batch=leaf('app/components/detail-image-batch-panel.tsx','DetailImageBatchPanel',{'@/app/detail-image-batch':{
  readDetailBatchView:(basis,signal)=>read('batch',basis,signal),detailBatchTranslationSlots:()=>({slots:[],protectedSlots:[]}),detailBatchCapacity:()=>5,
  prepareDetailImageBatch(){throw Error('No OCR or preparation authorized');},applyDetailBatchResult(){throw Error('No write authorized');},recoverDetailBatchResult(){throw Error('No write authorized');},
 }});
 const family=leaf('app/components/detail-family-apply-panel.tsx','DetailFamilyApplyForm',{'@/app/detail-family-client':{
  readDetailFamilyCatalog:(productId,profileId,signal)=>read('family',{productId,profileId},signal),
  commitDetailFamily(){throw Error('No write authorized');},createDetailFamilyInput(){throw Error('No preparation authorized');},previewDetailFamily(){throw Error('No preparation authorized');},recoverDetailFamily(){throw Error('No write authorized');},restoredDetailFamilyAttempt(){throw Error('No restored pending fixture');},
 }});
 function render(){if(closed)return;const snapshot={...busy};
  batch.render({...props,disabled:props.disabled||snapshot.family,onBusyChange:onBatchBusy});
  family.render({...props,disabled:props.disabled||snapshot.batch,onBusyChange:onFamilyBusy});
  for(const kind of ['layout','passive'])for(const component of components)component.commit(kind);
 }
 async function tick(count=1){for(let i=0;i<count;i++){render();await new Promise(resolve=>setImmediate(resolve));}render();}
 async function idle(){let quiet=0;for(let i=0;i<45;i++){const before=epoch,count=reads.length;await tick();quiet=before===epoch&&count===reads.length&&!busy.batch&&!busy.family?quiet+1:0;if(quiet===3)return;}
  throw Error('co-mounted panels did not settle: '+JSON.stringify({reads:reads.length,busy,callbacks:callbacks.slice(-12)}));}
 function button(kind,label){return nodes((kind==='batch'?batch:family).tree).find(node=>node.type==='button'&&text(node)===label);}
 return{props,busy,reads,callbacks,render,tick,idle,button,get late(){return late;},get batchTree(){return batch.tree;},get familyTree(){return family.tree;},
  status(kind,value){if(kind==='batch')batchStatus=value;else familyStatus=value;},release(kind){reads.find(row=>row.kind===kind&&row.gate)?.gate.resolve();},
  async click(kind,label){render();const value=button(kind,label);assert.ok(value&&!value.props.disabled,label);value.props.onClick();await idle();},
  close(){if(closed)return;for(const component of components)component.close();closed=true;},
 };
}

for(const familyStatus of [200,403])test(`co-mounted initial image/family reads settle without a busy/unlock GET loop (family ${familyStatus})`,async()=>{
 const h=harness({familyStatus});try{await h.idle();const counts=h.reads.map(row=>row.kind);assert.equal(counts.filter(kind=>kind==='batch').length,1);assert.ok(counts.filter(kind=>kind==='family').length>=1&&counts.filter(kind=>kind==='family').length<=2);
  assert.deepEqual(h.busy,{batch:false,family:false});const before=h.reads.length;await h.tick(12);assert.equal(h.reads.length,before);
  if(familyStatus===403){assert.match(text(h.familyTree),/family HTTP 403/);h.status('family',200);await h.click('family','분할 대상 다시 확인');assert.equal(h.reads.length,before+1);assert.doesNotMatch(text(h.familyTree),/HTTP 403/);}
 }finally{h.close();}
});
test('same basis stays cached across busy/active changes; exact option/profile/stage/version/refresh changes reload only their own source',async()=>{
 const h=harness();try{await h.idle();const before=h.reads.length;for(const patch of [{disabled:true},{disabled:false},{active:false},{active:true}]){Object.assign(h.props,patch);await h.idle();}assert.equal(h.reads.length,before);
  for(const[field,value]of [['optionId','other-option'],['stage','additional'],['profileId','other-profile'],['productId','other-product'],['version','2026-10-18T02:00:00.000Z'],['refreshToken','1']]){
   const start=h.reads.length;h.props[field]=value;await h.idle();const added=h.reads.slice(start);assert.equal(added.filter(row=>row.kind==='batch').length,1,field);
   assert.equal(added.some(row=>row.kind==='family'),!['optionId','stage'].includes(field),field+' family scope');
  }
 }finally{h.close();}
});
test('initially blocked reads resume on unlock, and failed batch reads require an explicit retry',async()=>{
 const h=harness({disabled:true,batchStatus:503});try{await h.idle();assert.equal(h.reads.length,0);h.props.disabled=false;await h.idle();assert.match(text(h.batchTree),/batch HTTP 503/);
  const before=h.reads.length;await h.tick(8);assert.equal(h.reads.length,before);h.status('batch',200);await h.click('batch','저장 이미지 다시 확인');assert.equal(h.reads.length,before+1);assert.doesNotMatch(text(h.batchTree),/HTTP 503/);
 }finally{h.close();}
});
test('held old source reads are aborted and discarded, then the new basis resumes without repeated GETs',async()=>{
 const h=harness({held:['batch','family']});try{await h.tick(2);assert.ok(h.reads.some(row=>row.kind==='batch'));
  const before=[...h.reads];h.props.version='2026-10-18T03:00:00.000Z';await h.tick(2);assert.ok(before.every(row=>row.signal.aborted));h.release('batch');h.release('family');await h.idle();
  assert.ok(h.reads.some(row=>row.kind==='batch'&&row.version===h.props.version));assert.ok(h.reads.some(row=>row.kind==='family'&&row.version===h.props.version));
  assert.doesNotMatch(text(h.batchTree)+text(h.familyTree),/상품 저장 상태가 변경|원본 저장 상태가 바뀌/);const count=h.reads.length;await h.tick(8);assert.equal(h.reads.length,count);
 }finally{h.release('batch');h.release('family');h.close();}
});
test('unmount aborts held sibling reads and late completions do not publish state or start another request',async()=>{
 const h=harness({held:['batch','family']});await h.tick(2);const before=h.reads.length;h.close();assert.ok(h.reads.every(row=>row.signal.aborted));h.release('batch');h.release('family');await new Promise(resolve=>setImmediate(resolve));assert.equal(h.late,0);assert.equal(h.reads.length,before);assert.deepEqual(h.busy,{batch:false,family:false});
});
