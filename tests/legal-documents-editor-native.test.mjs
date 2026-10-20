import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url),hash='a'.repeat(64),oldHash='b'.repeat(64),productId='legal-original';
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
const held=()=>{let resolve;return{promise:new Promise(finish=>{resolve=finish;}),get resolve(){return resolve;}};};
const binding={format:'supplier-hub-native-legal-binding-v1',schemaSha256:hash,categoryId:'81452',nativeType:'msds'};
const certificate={format:'supplier-hub-native-legal-binding-v1',schemaSha256:hash,categoryId:'81452',nativeType:'certificate',certificate:{schemaIndex:0,fieldId:'kc_test',path:['legalPage','certificates'],nameKey:'name',valueKey:'value',name:'KC 인증',value:'확인한 번호'}};
const context={schemaSha256:hash,categoryId:'81452',targets:[{id:'bucket:msds',label:'물질안전보건자료 (MSDS)',binding},{id:'certificate:kc_test',label:'인증서 1 · KC 인증',binding:certificate}],issues:[]};
const file=(type,index)=>({key:`owner/legal/${productId}/legal-75500000-0000-4000-8000-${String(index).padStart(12,'0')}.${type}`,name:`원본${index}.${type}`,type,byteLength:1024,sha256:'c'.repeat(64)});
const response=()=>({revision:3,documents:{applicability:'unconfirmed',files:[file('pdf',1),file('pdf',2),file('png',3),file('jpg',4)]},native:structuredClone(context)});
function ui(fetcher,extra={}){
 const slots=[],effects=[],calls=[],saved=[],busy=[],settled=[];let cursor=0;
 let props={productId,disabled:false,onSaved:()=>saved.push(true),onBusyChange:value=>busy.push(value),onMutationSettled:error=>settled.push(error),...extra};
 const effect=(fn,deps,layout)=>{const index=cursor++,old=slots[index];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps?.[i]))){old?.cleanup?.();slots[index]={deps};const run=()=>slots[index].cleanup=fn();if(layout)run();else effects.push(run);}};
 const hooks={useState(value){const index=cursor++;if(!(index in slots))slots[index]=value;return[slots[index],next=>slots[index]=typeof next==='function'?next(slots[index]):next];},useRef(value){const index=cursor++;return slots[index]??(slots[index]={current:value});},useEffect:(fn,deps)=>effect(fn,deps,false),useLayoutEffect:(fn,deps)=>effect(fn,deps,true)};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/legal-documents-editor.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,fetch:async(path,init)=>{calls.push({path,init});return fetcher(path,init);},AbortController,FormData,Error,require:name=>name==='react'?hooks:native(name)});
 const render=(next={})=>{props={...props,...next};cursor=0;const tree=exports.LegalDocumentsEditor(props);effects.splice(0).forEach(run=>run());return tree;};
 const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label);
 const select=name=>nodes(render()).find(node=>node.type==='select'&&node.props['aria-label']===name+' 서플라이허브 첨부 항목');
 return{render,button,select,calls,saved,busy,settled,async load(){button('서류 목록 불러오기').props.onClick();await settle();return render();},unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}

test('GET lists immutable originals, offers targets only for PDFs, and never maps a file automatically',async()=>{
 const value=response(),original=JSON.stringify(value),h=ui(async()=>Response.json(value));
 try{
  h.render();assert.equal(h.calls.length,0);const tree=await h.load();assert.equal(h.calls.length,1);assert.equal(h.calls[0].init.method,'GET');
  for(const original of value.documents.files){const link=nodes(tree).find(node=>node.type==='a'&&text(node)===original.name);assert.equal(link.props.href,`/api/products/${productId}/legal-documents?key=${encodeURIComponent(original.key)}`);assert.equal(link.props.onClick,undefined);}
  assert.equal(nodes(tree).filter(node=>node.type==='select'&&node.props['aria-label']).length,2);assert.equal(h.select('원본1.pdf').props.value,'');assert.equal(h.select('원본1.pdf').props.disabled,false);
  assert.equal(h.select('원본3.png'),undefined);assert.equal(h.select('원본4.jpg'),undefined);assert.match(text(tree),/PDF 원본이 필요합니다/);assert.equal(JSON.stringify(value),original);
  assert.equal(h.saved.length,0);assert.equal(h.settled.length,0);
 }finally{h.unmount();}
});

test('explicit PDF mapping sends only original key, opaque target ID, current schema and CAS then invalidates preview',async()=>{
 let value=response(),guards=0,previewValid=true;
 const h=ui(async(_path,init)=>{if(init.method==='GET')return Response.json(value);const body=JSON.parse(init.body);
  assert.deepEqual(body,{expectedRevision:3,binding:{key:file('pdf',1).key,targetId:'bucket:msds',expectedSchemaSha256:hash}});
  value={...value,revision:4,documents:{...value.documents,files:value.documents.files.map(original=>original.key===body.binding.key?{...original,nativeBinding:binding}:original)}};return Response.json(value);},
 {guardWrite:async(run,signal)=>{guards++;assert.equal(signal.aborted,false);return run();},onSaved:()=>{previewValid=false;}});
 try{
  await h.load();h.select('원본1.pdf').props.onChange({target:{value:'bucket:msds'}});await settle();assert.equal(guards,1);assert.equal(previewValid,false);
  assert.equal(h.select('원본1.pdf').props.value,'bucket:msds');assert.equal(h.select('원본2.pdf').props.value,'');assert.equal(nodes(h.render()).find(node=>node.type==='select'&&!node.props['aria-label']).props.value,'unconfirmed');
  assert.deepEqual(h.calls.map(call=>call.init.method),['GET','PATCH']);assert.deepEqual(h.settled,[undefined]);assert.deepEqual(h.busy,[true,false,true,false]);
 }finally{h.unmount();}
});

test('unknown target IDs cannot dispatch arbitrary schema or binding data',async()=>{
 const h=ui(async()=>Response.json(response()));try{await h.load();h.select('원본1.pdf').props.onChange({target:{value:'attacker:target'}});await settle();assert.equal(h.calls.length,1);assert.match(text(h.render()),/현재 첨부 항목을 다시 확인/);assert.equal(h.saved.length,0);}finally{h.unmount();}
});

for(const unavailable of [false,true])test(`stale original binding can explicitly unlink using its saved schema hash, context unavailable=${unavailable}`,async()=>{
 let value=response();value.documents.files[0].nativeBinding={...binding,schemaSha256:oldHash};if(unavailable){value.native=null;value.nativeError='현재 카테고리의 첨부 항목을 확인해주세요.';}
 const h=ui(async(_path,init)=>{if(init.method==='GET')return Response.json(value);const body=JSON.parse(init.body);
  assert.deepEqual(body,{expectedRevision:3,binding:{key:file('pdf',1).key,targetId:null,expectedSchemaSha256:oldHash}});delete value.documents.files[0].nativeBinding;value.revision++;return Response.json(value);});
 try{await h.load();assert.equal(h.select('원본1.pdf').props.value,'__saved_binding__');assert.equal(h.select('원본1.pdf').props.disabled,false);assert.match(text(h.render()),/저장된 연결.*현재 양식에서 확인하지 못했습니다/);
  h.select('원본1.pdf').props.onChange({target:{value:''}});await settle();assert.equal(h.select('원본1.pdf').props.value,'');assert.equal(h.saved.length,1);assert.deepEqual(h.calls.map(call=>call.init.method),['GET','PATCH']);
 }finally{h.unmount();}
});

test('legacy GET without native context keeps originals and applicability editable but cannot create a new binding',async()=>{
 const value=response();delete value.native;const h=ui(async()=>Response.json(value));
 try{await h.load();assert.equal(h.select('원본1.pdf').props.disabled,true);assert.equal(h.select('원본1.pdf').props.value,'');assert.equal(nodes(h.render()).filter(node=>node.type==='a').length,4);
  h.select('원본1.pdf').props.onChange({target:{value:'bucket:msds'}});await settle();assert.equal(h.calls.length,1);
 }finally{h.unmount();}
});

test('guard rejection and server CAS conflict preserve the saved original and its prior selection',async()=>{
 for(const denied of [true,false]){
  const h=ui(async(_path,init)=>init.method==='GET'?Response.json(response()):Response.json({error:'다른 편집이 저장되었습니다.'},{status:409}),
   denied?{guardWrite:async()=>{throw Error('진행 중인 전송을 확인해주세요.');}}:{});
  try{await h.load();h.select('원본1.pdf').props.onChange({target:{value:'bucket:msds'}});await settle();assert.equal(h.select('원본1.pdf').props.value,'');assert.equal(h.saved.length,0);
   assert.equal(h.calls.length,denied?1:2);assert.match(text(h.render()),denied?/진행 중인 전송/:/다른 편집/);assert.equal(nodes(h.render()).filter(node=>node.type==='a').length,4);
  }finally{h.unmount();}
 }
});

test('stale disabled and old-revision mapping handlers cannot write',async()=>{
 let version=3;const h=ui(async()=>Response.json({...response(),revision:version}));
 try{await h.load();const old=h.select('원본1.pdf').props.onChange;h.render({disabled:true});old({target:{value:'bucket:msds'}});await settle();assert.equal(h.calls.length,1);
  h.render({disabled:false});version=4;h.button('목록 새로고침').props.onClick();await settle();h.render();old({target:{value:'bucket:msds'}});await settle();assert.equal(h.calls.length,2);assert.ok(h.calls.every(call=>call.init.method==='GET'));assert.equal(h.saved.length,0);
 }finally{h.unmount();}
});

test('changing product while a guarded mapping waits aborts it before dispatch and hides foreign originals',async()=>{
 const gate=held();let signal;const h=ui(async()=>Response.json(response()),{guardWrite:async(run,current)=>{signal=current;await gate.promise;return run();}});
 try{await h.load();h.select('원본1.pdf').props.onChange({target:{value:'bucket:msds'}});await settle();assert.equal(signal.aborted,false);
  h.render({productId:'different-product'});assert.equal(signal.aborted,true);assert.equal(nodes(h.render()).filter(node=>node.type==='a').length,0);gate.resolve();await settle();assert.equal(h.calls.length,1);assert.equal(h.saved.length,0);assert.equal(h.settled.length,0);
 }finally{h.unmount();}
});

for(const phase of ['headers','body'])test(`manual cancellation discards a late mapping ${phase} response without publishing success`,async()=>{
 const gate=held();let signal;const h=ui(async(_path,init)=>{if(init.method==='GET')return Response.json(response());signal=init.signal;
  return phase==='headers'?gate.promise:{ok:true,json:()=>gate.promise};});
 try{await h.load();h.select('원본1.pdf').props.onChange({target:{value:'bucket:msds'}});await settle();h.button('서류 작업 중단').props.onClick();assert.equal(signal.aborted,true);
  const value=response();value.revision=4;value.documents.files[0].nativeBinding=binding;gate.resolve(phase==='headers'?Response.json(value):value);await settle();
  assert.equal(h.select('원본1.pdf').props.value,'');assert.equal(h.saved.length,0);assert.equal(h.settled.length,1);assert.match(h.settled[0],/중단.*저장 상태를 확인/);assert.deepEqual(h.busy,[true,false,true,false]);
 }finally{h.unmount();}
});

test('product change discards an in-flight mapping body and can load the new product before that body finishes',async()=>{
 const gate=held(),next=response();next.revision=1;next.documents.files=[{...file('pdf',8),key:file('pdf',8).key.replace('/legal-original/','/different-product/'),name:'다음 상품 원본.pdf'}];let signal;
 const h=ui(async(path,init)=>{if(init.method==='GET')return Response.json(path.includes('/different-product/')?next:response());signal=init.signal;return{ok:true,json:()=>gate.promise};});
 try{
  await h.load();h.select('원본1.pdf').props.onChange({target:{value:'bucket:msds'}});await settle();h.render({productId:'different-product'});assert.equal(signal.aborted,true);
  await h.load();assert.ok(h.select('다음 상품 원본.pdf'));assert.equal(h.select('원본1.pdf'),undefined);
  const old=response();old.revision=4;old.documents.files[0].nativeBinding=binding;gate.resolve(old);await settle();assert.ok(h.select('다음 상품 원본.pdf'));assert.equal(h.select('원본1.pdf'),undefined);
  assert.equal(h.saved.length,0);assert.equal(h.settled.length,0);assert.deepEqual(h.calls.map(call=>call.init.method),['GET','PATCH','GET']);
 }finally{h.unmount();}
});

test('upload stays unbound and removal retains its original-key/CAS contract rather than sending mappings',async()=>{
 let value=response(),form;const h=ui(async(_path,init)=>{
  if(init.method==='GET')return Response.json(value);
  if(init.method==='POST'){form=init.body;assert.ok(form instanceof FormData);assert.deepEqual([...form.keys()].sort(),['expectedRevision','file']);assert.equal(form.get('expectedRevision'),'3');value={...value,revision:4,documents:{...value.documents,files:[...value.documents.files,{...file('pdf',5),name:'새 원본.pdf'}]}};return Response.json(value);}
  const body=JSON.parse(init.body);assert.deepEqual(body,{expectedRevision:4,removeKey:file('pdf',1).key});value={...value,revision:5,documents:{...value.documents,files:value.documents.files.filter(original=>original.key!==body.removeKey)}};return Response.json(value);
 });
 try{await h.load();const input=nodes(h.render()).find(node=>node.type==='input'&&node.props.type==='file'),target={files:[new File(['%PDF-test'], '새 원본.pdf',{type:'application/pdf'})],value:'selected'};
  input.props.onChange({target});await settle();assert.equal(target.value,'');assert.equal(h.select('새 원본.pdf').props.value,'');
  const first=nodes(h.render()).find(node=>node.type==='li'&&text(node).includes('원본1.pdf'));nodes(first).find(node=>node.type==='button').props.onClick();await settle();assert.equal(h.select('원본1.pdf'),undefined);
  assert.equal(h.saved.length,2);assert.deepEqual(h.calls.map(call=>call.init.method),['GET','POST','PATCH']);
 }finally{h.unmount();}
});
