import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {nativeReviewFixture,companies,plain,json} from './helpers/native-source-review.mjs';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
import {quotationTitleUI,quotationPresentationFixture} from './helpers/quotation-form-presentation.mjs';
const native=createRequire(import.meta.url),origin='https://sourceflow.jjwwhhjj1116.workers.dev';
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};

async function fixture(company=companies[0]){
 const f=await nativeReviewFixture(company),legal=f.h.load('app/api/products/[id]/legal-documents/route.ts');
 const send=(method,body)=>legal[method](new Request(origin+f.base+'/legal-documents',{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})}),f.context);
 const before=await json(await send('GET'));await json(await send('PATCH',{expectedRevision:before.revision,applicability:'unconfirmed'}));
 return {...f,send,legal,view:await f.fields(),plan:await f.source()};
}

/** Expand the actual native panel, legal review and legal editor with their
 * own hooks, mount keys and cleanup. All legal writes use the real local API. */
function ui(f,{holdPatch,holdHistory,blockedHistory=false}={}){
 const modules=new Map(),instances=new Map(),effects=[],layouts=[],calls=[],locks=[],storage=new Map();let active,tree,closed=false,lateWrites=0,changed=0,sourceLocked=false;
 let props={productId:f.id,profileId:f.profile.id,view:f.view,disabled:false,onLockChange:(value)=>{sourceLocked=value;},onSourceChanged:()=>{changed++;}};
 const hooks={useState(initial){const owner=active,i=owner.index++;if(!(i in owner.slots))owner.slots[i]=typeof initial==='function'?initial():initial;return[owner.slots[i],value=>{if(!owner.mounted){lateWrites++;return;}owner.slots[i]=typeof value==='function'?value(owner.slots[i]):value;}];},useRef(initial){const i=active.index++;return active.slots[i]??(active.slots[i]={current:initial});},useCallback(fn,deps){const i=active.index++,old=active.slots[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j])))active.slots[i]={fn,deps};return active.slots[i].fn;},useEffect(fn,deps){effect(fn,deps,effects);},useLayoutEffect(fn,deps){effect(fn,deps,layouts);}};
 function effect(fn,deps,queue){const owner=active,i=owner.index++,old=owner.slots[i];if(!old||!deps||deps.some((value,j)=>!Object.is(value,old.deps[j]))){const slot={deps,cleanup:old?.cleanup};owner.slots[i]=slot;queue.push(()=>{slot.cleanup?.();slot.cleanup=fn();});}}
 const browser={location:{origin},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},navigator:{locks:{request:async(key,options,run)=>{locks.push(key);assert.equal(options.mode,'exclusive');options.signal.throwIfAborted();return run();}}}};
 const request=async(path,init={})=>{
  calls.push({path,init});
  if(path===f.base+'/legal-documents'){
   if(init.method==='PATCH'&&holdPatch){holdPatch.signal=init.signal;holdPatch.started=true;await holdPatch.promise;}
   return f.legal[init.method](new Request(origin+path,init),f.context);
  }
  if(path==='/api/supplier-hub/catalog-context')return f.h.load('app/api/supplier-hub/catalog-context/route.ts').GET();
  if(path===f.base)return Response.json({product:{...plain(f.h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.id)),removal_policy:{blocked:false,code:null,reason:'',receipt:null}}});
  if(path===f.fieldsPath)return f.h.route(path);
  throw Error('Unexpected request '+path);
 };
 const history=async()=>{if(holdHistory){holdHistory.started=true;await holdHistory.promise;}return{records:[],blocked:blockedHistory};};
 function load(file){if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
   {exports,Error,AbortController,FormData,Uint8Array,TextDecoder,TextEncoder,URL,Date,setTimeout,clearTimeout,fetch:request,window:browser,require(name){
    if(name==='react')return hooks;
    if(name==='@/app/supplier-hub-native-product-document')return{readCurrentNativeAssetSource:async()=>plain(f.plan),reviewCurrentNativeSupplierHubProductDocument:()=>assert.fail('No preparation while legal blocked')};
    if(name==='@/app/supplier-hub-handoff')return{getSupplierHubProductHistory:history};
    if(name==='@/app/components/supplier-hub-product-transport')return{SupplierHubProductTransport:()=>assert.fail('No transport')};
    if(name.startsWith('@/app/components/'))return load(name.slice(2)+'.tsx');
    if(['@/app/supplier-hub-legal-edit-scope','@/app/supplier-hub-product-pending'].includes(name))return load(name.slice(2)+'.ts');
    return name.startsWith('@/')?providedOptionModule(name.slice(2)+'.ts'):native(name);
   }});return exports;
 }
 const Root=load('app/components/supplier-hub-native-source-review.tsx').SupplierHubNativeSourceReview;
 const cleanup=owner=>{owner.mounted=false;owner.slots.forEach(slot=>slot?.cleanup?.());};
 function expand(value,path,seen){if(Array.isArray(value))return value.map((child,i)=>expand(child,path+'/'+i,seen));if(!value||typeof value!=='object')return value;
  if(typeof value.type==='function'){const key=path+'/'+value.type.name+':'+(value.key??'');let owner=instances.get(key);if(!owner){owner={index:0,slots:[],mounted:true};instances.set(key,owner);}seen.add(key);owner.index=0;active=owner;return expand(value.type(value.props),key,seen);}
  return{...value,props:{...value.props,children:expand(value.props?.children,path+'/children',seen)}};
 }
 function render(next={}){if(closed)return tree;props={...props,...next};const seen=new Set();tree=expand({type:Root,props},'root',seen);for(const[key,owner]of instances)if(!seen.has(key)){cleanup(owner);instances.delete(key);}layouts.splice(0).forEach(run=>run());effects.splice(0).forEach(run=>run());return tree;}
 async function settle(){for(let i=0;i<30;i++){render();await new Promise(resolve=>setImmediate(resolve));}}
 const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label);
 return{render,settle,calls,locks,button,async click(label){const found=button(label);assert.ok(found,label);assert.equal(Boolean(found.props.disabled),false,label);found.props.onClick();await settle();},select:()=>nodes(render()).find(node=>node.type==='select'),close(){closed=true;for(const owner of instances.values())cleanup(owner);},get changed(){return changed;},get lateWrites(){return lateWrites;},get sourceLocked(){return sourceLocked;}};
}

for(const company of companies)test(`${company.code}: step-seven legal action opens the existing editor, preserves unconfirmed until explicit selection and refreshes after one real CAS save`,async()=>{
 const f=await fixture(company);let h;try{
  h=ui(f);await h.settle();const before=f.state(),originals=f.objectState();assert.equal(h.select(),undefined);await h.click('서류 해당 여부 확인');
  const details=nodes(h.render()).find(node=>node.type==='details'&&text(node).includes('법적 필수서류'));assert.equal(details.props.open,true);assert.equal(h.select(),undefined);assert.equal(f.state(),before);assert.ok(h.calls.every(call=>(call.init.method??'GET')==='GET'));
  await h.click('서류 목록 불러오기');assert.equal(h.select().props.value,'unconfirmed');assert.equal(h.sourceLocked,false);
  h.select().props.onChange({target:{value:'not-applicable'}});assert.equal(h.sourceLocked,true);await h.settle();assert.equal(h.changed,1);assert.equal(h.sourceLocked,false);assert.equal(h.select(),undefined);
  const after=await json(await f.send('GET'));assert.equal(after.documents.applicability,'not-applicable');assert.deepEqual(after.documents.files,[]);assert.equal(h.calls.filter(call=>call.init.method==='PATCH').length,1);assert.equal(h.locks.length,1);assert.equal((await f.source()).metadataValid,true);assert.equal(f.objectState(),originals);assert.deepEqual(f.h.network,[]);
 }finally{h?.close();f.close();}
});

test('closing inline legal review ignores late policy and saved replies without reviving a scope or notifying the parent',async()=>{
 for(const phase of ['policy','save']){const f=await fixture(),gate=deferred();let h;try{
  h=ui(f,phase==='policy'?{holdHistory:gate}:{holdPatch:gate});await h.settle();await h.click('서류 해당 여부 확인');
  if(phase==='save'){await h.click('서류 목록 불러오기');h.select().props.onChange({target:{value:'required'}});await h.settle();assert.equal(gate.started,true);}else assert.equal(gate.started,true);
  h.close();if(phase==='save')assert.equal(gate.signal.aborted,true);gate.resolve();await h.settle();assert.equal(h.changed,0);assert.equal(h.lateWrites,0);assert.equal(h.sourceLocked,false);
 }finally{gate.resolve();h?.close();f.close();}}
});

test('blocked transmission history leaves inline applicability unavailable and cannot write',async()=>{
 const f=await fixture();let h;try{h=ui(f,{blockedHistory:true});await h.settle();await h.click('서류 해당 여부 확인');assert.equal(h.button('서류 목록 불러오기').props.disabled,true);assert.match(text(h.render()),/원래 전송 결과를 먼저 확인/);assert.ok(h.calls.every(call=>(call.init.method??'GET')==='GET'));assert.equal(h.changed,0);}finally{h?.close();f.close();}
});

test('quotation form keeps its legal child enabled during its own source lock and reloads after release without losing manual drafts',async()=>{
 const view=quotationPresentationFixture(),fresh=plain(view);fresh.contentRevision++;fresh.inputFingerprint='b'.repeat(64);let replies=0,saved=0;
 const h=quotationTitleUI({view,props:{submissionActive:true,onSaved(){saved++;}},request:async()=>Response.json(replies++?fresh:view)});try{
  await h.idle();const child=()=>h.nodes().find(node=>node.type?.name==='SupplierHubSingleReview');const old=child();assert.equal(old.props.disabled,false);old.props.onLockChange(true,true);h.render();assert.equal(child().props.disabled,false,'own source lock must not disable and abort legal writes');old.props.onLockChange(false,false);old.props.onSourceChanged();await h.idle();assert.equal(saved,1);assert.equal(child().props.view.contentRevision,fresh.contentRevision);
  h.field('model').props.onChange({target:{value:'보존할 수동 초안'}});h.render();const calls=h.calls.length;old.props.onSourceChanged();await h.idle();assert.equal(h.calls.length,calls);assert.equal(h.field('model').props.value,'보존할 수동 초안');
 }finally{h.close();}
});
