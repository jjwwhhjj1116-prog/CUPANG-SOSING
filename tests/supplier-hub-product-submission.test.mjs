import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {assetApiFixture,companies,module,plain} from './helpers/supplier-hub-single-assets.mjs';
const native=createRequire(import.meta.url),origin='https://sourceflow.jjwwhhjj1116.workers.dev';
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
function load({hooks={},fetcher=()=>assert.fail('Unexpected request'),timers={setTimeout,clearTimeout},window:browser={location:{origin}},history=async()=>({records:[],blocked:false})}={}){
 const cache=new Map();
 const pending={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/supplier-hub-product-pending.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:pending,window:browser,Error,Date});
 function loadFile(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,Error,AbortController,Uint8Array,TextDecoder,...timers,window:browser,fetch:fetcher,require(name){if(name==='react')return hooks;if(name==='@/app/components/supplier-hub-single-review')return{SupplierHubSingleReview:'native-review'};if(name==='@/app/components/legal-documents-editor')return{LegalDocumentsEditor:'legal-editor'};if(name==='@/app/supplier-hub-legal-edit-scope')return loadFile('app/supplier-hub-legal-edit-scope.ts');if(name==='@/app/supplier-hub-handoff')return{getSupplierHubProductHistory:history};if(name==='@/app/supplier-hub-product-pending')return pending;return name.startsWith('@/')?module(name.slice(2)+'.ts'):native(name);}});return exports;}
 return loadFile('app/components/supplier-hub-product-submission.tsx');
}
const reader=load().readSupplierHubProductSubmissionView;
async function sample(company=companies[0]){
 const f=await assetApiFixture(company);try{
  const response=await f.h.route(f.base+'/quotation-fields'+f.query);assert.equal(response.status,200);
  return{view:await response.json(),product:plain(f.h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.id)),actor:{ownerId:'owner',company},productId:f.id,profileId:f.profile.id};
 }finally{f.close();}
}
function responder(value,{change}={}){
 const calls=[];let actorReads=0,productReads=0,fieldReads=0;
 const request=async(path,init)=>{
  const kind=path==='/api/supplier-hub/catalog-context'?'actor':path.includes('/quotation-fields')?'fields':'product';
  const count=kind==='actor'?++actorReads:kind==='product'?++productReads:++fieldReads;
  let body=plain(kind==='actor'?value.actor:kind==='fields'?value.view:{product:value.product});
  const replacement=change?.({path,kind,count,body,init,calls});if(replacement instanceof Response){calls.push({path,init});return replacement;}if(replacement!==undefined)body=replacement;
  calls.push({path,init});return Response.json(body);
 };
 return{request,calls};
}

for(const company of companies)test(`primary submission reads the current owned full snapshot without changing values (${company.code})`,async()=>{
 const f=await assetApiFixture(company);try{
  const before=f.state(),objects=f.objectState(),calls=[];
  const request=async(path,init)=>{
   calls.push({path,init});assert.equal(init.method??'GET','GET');assert.equal(init.cache,'no-store');assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.body,undefined);
   if(path==='/api/supplier-hub/catalog-context')return f.h.load('app/api/supplier-hub/catalog-context/route.ts').GET();
   if(path===f.base)return Response.json({product:plain(f.h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.id))});
   return f.h.route(path);
  };
  const view=await reader({productId:f.id,profileId:f.profile.id,expectedCategoryId:f.profile.categoryId},new AbortController().signal,request);
  assert.deepEqual(calls.map(call=>call.path),['/api/supplier-hub/catalog-context',f.base,f.base+'/quotation-fields'+f.query,f.base+'/quotation-fields'+f.query,f.base,'/api/supplier-hub/catalog-context']);
  assert.equal(view.resolved.rows.filter(row=>row.included).length,2);assert.equal(view.resolved.rows.find(row=>row.optionId==='synthetic-excluded').included,false);
  assert.equal(view.resolved.rows.find(row=>row.optionId==='synthetic-two').fields.model.value,'');
  assert.equal(view.submissionReady,false);assert.equal(f.state(),before);assert.equal(f.objectState(),objects);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('captured default stays queryless even when its recorded saved profile ID exists',async()=>{
 const value=await sample();value.view.categoryContext.source='collection';const fake=responder(value);
 const view=await reader({productId:value.productId},new AbortController().signal,fake.request);
 assert.equal(view.categoryContext.profileId,value.profileId);assert.equal(view.categoryContext.source,'collection');
 assert.ok(fake.calls.filter(call=>call.path.includes('quotation-fields')).every(call=>!call.path.includes('?')));
 assert.ok(fake.calls.every(call=>!call.path.includes('category-profiles')));
});

test('owner, company, category, profile and saved snapshot changes fail before native review can render',async()=>{
 const value=await sample(),cases=[
  ({kind,body})=>{if(kind==='product')body.product.owner_id='other-owner';},
  ({kind,body})=>{if(kind==='product')body.product.id='other-product';},
  ({kind,count,body})=>{if(kind==='product'&&count===2)body.product.updated_at='later';},
  ({kind,count,body})=>{if(kind==='actor'&&count===2)body.ownerId='other-owner';},
  ({kind,count,body})=>{if(kind==='actor'&&count===2)body.company=companies[1];},
  ({kind,count,body})=>{if(kind==='fields'&&count===2)body.resolved.rows[1].fields.model.value='changed';},
  ({kind,body})=>{if(kind==='fields')body.categoryContext.profileId='another-profile';},
  ({kind,body})=>{if(kind==='fields')body.categoryContext.categoryId='another-category';},
  ({kind,body})=>{if(kind==='fields')body.inputFingerprint='not-a-sha';},
  ({kind,body})=>{if(kind==='fields')body.optionRegistrationNumbers={'unknown-option':'261019001001'};},
  ({kind,body})=>{if(kind==='fields')body.resolved.rows[1].optionId=body.resolved.rows[0].optionId;},
 ];
 for(const mutate of cases){const fake=responder(value,{change:input=>{mutate(input);return input.body;}});await assert.rejects(reader({productId:value.productId,profileId:value.profileId,expectedCategoryId:value.view.categoryContext.categoryId},new AbortController().signal,fake.request));assert.ok(fake.calls.every(call=>(call.init.method??'GET')==='GET'));}
});

test('aborted, redirected, HTML, malformed and oversized reads never post or silently fall back',async()=>{
 const value=await sample(),controller=new AbortController(),none=responder(value);controller.abort();await assert.rejects(reader(value,controller.signal,none.request));assert.equal(none.calls.length,0);
 for(const response of [new Response('bad',{headers:{'content-type':'text/html'}}),new Response('{bad',{headers:{'content-type':'application/json'}}),Response.json({error:'not allowed'},{status:403}),new Response(' '.repeat(6*1024*1024+1),{headers:{'content-type':'application/json'}})]){
  const fake=responder(value,{change:({kind})=>kind==='fields'?response:undefined});await assert.rejects(reader(value,new AbortController().signal,fake.request));assert.ok(fake.calls.every(call=>(call.init.method??'GET')==='GET'));
 }
 const redirect=Response.json(value.view);Object.defineProperty(redirect,'redirected',{value:true});
 await assert.rejects(reader(value,new AbortController().signal,responder(value,{change:({kind})=>kind==='fields'?redirect:undefined}).request));
 const middle=new AbortController(),fake=responder(value,{change:({kind})=>{if(kind==='fields')middle.abort();}});await assert.rejects(reader(value,middle.signal,fake.request));assert.equal(fake.calls.length,3);
});

function ui(initial,fetcher,timers,options={}){
 const slots=[],effects=[],layouts=[];let cursor=0,props=initial,mountedKey=null;
 const hook=(fn,deps,layout)=>{const index=cursor++,old=slots[index];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps?.[i]))){old?.cleanup?.();slots[index]={deps};const run=()=>{slots[index].cleanup=fn();};if(layout){if(options.childLayoutFirst)layouts.push(run);else run();}else effects.push(run);}};
 const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return[slots[index],value=>slots[index]=typeof value==='function'?value(slots[index]):value];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useMemo(fn,deps){const index=cursor++,old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps?.[i])))slots[index]={deps,value:fn()};return slots[index].value;},useCallback(fn,deps){const index=cursor++,old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps?.[i])))slots[index]={deps,value:fn};return slots[index].value;},useLayoutEffect:(fn,deps)=>hook(fn,deps,true),useEffect:(fn,deps)=>hook(fn,deps,false)};
 const Component=load({hooks,fetcher,timers,...options}).SupplierHubProductSubmission;
 function render(next={}){props={...props,...next};cursor=0;const outer=Component(props);if(mountedKey!==null&&outer.key!==mountedKey){slots.forEach(slot=>slot?.cleanup?.());slots.length=0;effects.length=0;layouts.length=0;}mountedKey=outer.key;cursor=0;const tree=outer.type(outer.props);options.beforeLayout?.(tree);layouts.splice(0).forEach(run=>run());effects.splice(0).forEach(run=>run());return tree;}
 return{render,unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}
test('primary native UI receives the real view, queryless scope and current callback only after stable reads',async()=>{
 const value=await sample(),fake=responder(value);let saved=0;
 const h=ui({productId:value.productId,onReceiptSaved(){saved++;}},fake.request);let tree=h.render();assert.equal(nodes(tree).filter(node=>node.type==='native-review').length,0);await settle();tree=h.render();
 const child=nodes(tree).find(node=>node.type==='native-review');assert.ok(child);assert.equal(child.props.primaryProduct,true);assert.equal(child.props.profileId,undefined);assert.deepEqual(plain(child.props.view),value.view);assert.equal(child.props.disabled,false);
 child.props.onReceiptSaved();assert.equal(saved,1);h.unmount();child.props.onReceiptSaved();assert.equal(saved,1);
 const disabled=responder(value),blocked=ui({productId:value.productId,disabled:true},disabled.request);assert.equal(nodes(blocked.render()).filter(node=>node.type==='native-review').length,0);await settle();assert.equal(disabled.calls.length,0);blocked.unmount();
});

test('profile changes abort old reads and old receipt callbacks cannot notify the new scope',async()=>{
 const value=await sample(),fake=responder(value);let release,oldSignal,saved=0;
 const request=async(path,init)=>{if(path.includes('quotation-fields')&&!release){oldSignal=init.signal;return new Promise(resolve=>{release=resolve;});}return fake.request(path,init);};
 const h=ui({productId:value.productId,profileId:value.profileId,onReceiptSaved(){saved++;}},request);h.render();await settle();assert.ok(release);
 h.render({profileId:undefined});assert.equal(oldSignal.aborted,true);release(Response.json(value.view));await settle();const child=nodes(h.render()).find(node=>node.type==='native-review');assert.equal(child.props.profileId,undefined);assert.equal(saved,0);
 h.render({disabled:true});child.props.onReceiptSaved();assert.equal(saved,0);assert.equal(nodes(h.render()).filter(node=>node.type==='native-review').length,0);h.unmount();
});

test('a timed-out current read settles with an explicit retry and cannot revive after a late reply',async()=>{
 const value=await sample(),fake=responder(value),timers=[];let release,signal;
 const request=async(path,init)=>{if(path.includes('quotation-fields')&&!release){signal=init.signal;return new Promise(resolve=>{release=resolve;});}return fake.request(path,init);};
 const h=ui({productId:value.productId},request,{setTimeout(fn,ms){const timer={fn,ms};timers.push(timer);return timer;},clearTimeout(timer){timer.cleared=true;}});
 h.render();await settle();assert.ok(release);const timeout=timers.find(timer=>timer.ms===30000);timeout.fn();assert.equal(signal.aborted,true);
 let tree=h.render();assert.equal(tree.props['aria-busy'],false);assert.ok(nodes(tree).find(node=>node.type==='button'&&node.props.children==='전체 상품 견적 다시 확인'));
 release(Response.json(value.view));await settle();assert.equal(nodes(h.render()).filter(node=>node.type==='native-review').length,0);
 nodes(tree).find(node=>node.type==='button').props.onClick();h.render();await settle();tree=h.render();assert.equal(nodes(tree).filter(node=>node.type==='native-review').length,1);assert.ok(fake.calls.every(call=>(call.init.method??'GET')==='GET'));h.unmount();
});

function legalBrowser(){
 const data=new Map(),locks=[];
 const browser={location:{origin},localStorage:{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)},navigator:{locks:{request:async(key,options,run)=>{locks.push(key);assert.equal(options.mode,'exclusive');if(options.signal.aborted)throw Error('aborted');return run();}}}};
 return {browser,data,locks,key(value){return 'yoofam-product-document-pending:'+JSON.stringify([origin,value.actor.ownerId,value.actor.company.code,value.actor.company.name,value.productId]);}};
}
function clearLegalHistory(value){value.product.removal_policy={blocked:false,code:null,reason:'',receipt:null};return value;}
for(const company of companies)test(`primary legal editor checks exact company and all-history scope without writes (${company.code})`,async()=>{
 const value=clearLegalHistory(await sample(company)),h=legalBrowser(),fake=responder(value),calls=[];
 const history=async(identity,signal)=>{assert.equal(signal.aborted,false);calls.push(identity);return{records:[],blocked:false};};
 const scope=await load({window:h.browser,history}).readSupplierHubLegalEditScope({productId:value.productId},value.view,new AbortController().signal,fake.request);
 assert.deepEqual(plain(scope),{identity:{ownerId:value.actor.ownerId,company,productId:value.productId}});
 assert.deepEqual(plain(calls),[{productId:value.productId,categoryId:value.view.categoryContext.categoryId,fingerprint:value.view.inputFingerprint}]);
 assert.ok(fake.calls.every(call=>(call.init.method??'GET')==='GET'));assert.equal(h.data.size,0);assert.equal(h.locks.length,0);
});
test('primary legal edit never treats missing, corrupt, pending or unknown transmission history as editable',async()=>{
 const value=clearLegalHistory(await sample());
 for(const mode of ['server-pending','server-unknown','server-missing','local-pending','local-corrupt','rejection-corrupt','extension-pending','extension-error','account-changed','source-changed']){
  const current=plain(value),h=legalBrowser();let actorReads=0;
  if(mode==='server-pending')current.product.removal_policy={blocked:true,code:'PRODUCT_HUB_EVIDENCE_UNCONFIRMED',reason:'전송 기록을 확인하지 못해 삭제할 수 없습니다. 등록 상태를 다시 확인해주세요.',receipt:null};
  if(mode==='server-unknown')current.product.removal_policy={blocked:false,code:'unknown',reason:'',receipt:null};
  if(mode==='server-missing')delete current.product.removal_policy;
  if(mode==='local-corrupt')h.data.set(h.key(current),'{bad');
  if(mode==='rejection-corrupt')h.data.set(h.key(current).replace('-pending:','-rejections:'),'[]');
  if(mode==='local-pending')h.data.set(h.key(current),JSON.stringify({format:'yoofam-product-document-pending-v1',origin,ownerId:current.actor.ownerId,companyCode:current.actor.company.code,companyName:current.actor.company.name,productId:current.productId,requestId:'00000000-0000-4000-8000-000000000751',createdAt:Date.now(),reviewDigest:'a'.repeat(64),originalBodySha256:'b'.repeat(64),preparedBodySha256:'c'.repeat(64),identityDigest:'d'.repeat(64),appTabId:7,windowId:9}));
  const fake=responder(current,{change:({kind,body})=>{if(kind==='actor'&&++actorReads>2&&mode==='account-changed')body.ownerId='changed-owner';if(kind==='fields'&&mode==='source-changed')body.inputFingerprint='d'.repeat(64);}});
  const history=async()=>{if(mode==='extension-error')throw Error('Chrome unavailable');return{records:[],blocked:mode==='extension-pending'};};
  await assert.rejects(load({window:h.browser,history}).readSupplierHubLegalEditScope({productId:current.productId},current.view,new AbortController().signal,fake.request),undefined,mode);
  assert.ok(fake.calls.every(call=>(call.init.method??'GET')==='GET'),mode);
 }
});
test('primary legal editor is reachable, locks native preparation during use, and rereads saved source after mutation',async()=>{
 const value=clearLegalHistory(await sample()),h=legalBrowser(),fake=responder(value);let writes=0;
 const mounted=ui({productId:value.productId},fake.request,undefined,{window:h.browser});
 mounted.render();await settle();mounted.render();await settle();let tree=mounted.render();
 let editor=nodes(tree).find(node=>node.type==='legal-editor'),review=nodes(tree).find(node=>node.type==='native-review');
 assert.ok(editor);assert.equal(editor.props.disabled,false);assert.equal(review.props.disabled,false);
 editor.props.onBusyChange(true);tree=mounted.render();assert.equal(nodes(tree).find(node=>node.type==='native-review').props.disabled,true);
 const response=await editor.props.guardWrite(async()=>{writes++;value.view.contentRevision++;value.view.inputFingerprint='e'.repeat(64);return Response.json({saved:true});},new AbortController().signal);
 assert.equal(response.status,200);assert.equal(writes,1);assert.equal(h.locks.length,1);assert.equal(h.locks[0],h.key(value));
 editor.props.onBusyChange(false);editor.props.onMutationSettled();tree=mounted.render();assert.equal(nodes(tree).filter(node=>node.type==='native-review').length,0);
 await settle();mounted.render();await settle();tree=mounted.render();review=nodes(tree).find(node=>node.type==='native-review');
 assert.equal(review.props.view.inputFingerprint,'e'.repeat(64));assert.equal(nodes(tree).find(node=>node.type==='legal-editor').props.disabled,false);
 editor=nodes(tree).find(node=>node.type==='legal-editor');review.props.onLockChange(true);tree=mounted.render();assert.equal(nodes(tree).find(node=>node.type==='legal-editor').props.disabled,true);
 await assert.rejects(editor.props.guardWrite(async()=>{writes++;return Response.json({});},new AbortController().signal));assert.equal(writes,1);
 mounted.unmount();await assert.rejects(editor.props.guardWrite(async()=>{writes++;return Response.json({});},new AbortController().signal));assert.equal(writes,1);
});

for(const company of companies)test(`${company.code}: native locks propagate source/close separately and child-first reports survive view/token changes while old releases stay isolated`,async()=>{
 const value=clearLegalHistory(await sample(company)),browser=legalBrowser(),fake=responder(value),locks=[],children=[];
 const mounted=ui({productId:value.productId,onLockChange:(...args)=>locks.push(args)},fake.request,undefined,{window:browser.browser,childLayoutFirst:true,beforeLayout(tree){const child=nodes(tree).find(node=>node.type==='native-review');if(child&&!child.props.disabled){children.push(child);child.props.onLockChange(true,true);}}});
 mounted.render();await settle();let tree=mounted.render();await settle();tree=mounted.render();assert.deepEqual(locks.at(-1),[true,true]);assert.equal(nodes(tree).find(node=>node.type==='legal-editor').props.disabled,true,'child layout report must not be overwritten by parent layout');
 const old=children.at(-1),editor=nodes(tree).find(node=>node.type==='legal-editor');old.props.onLockChange(true,false);assert.deepEqual(locks.at(-1),[true,false]);
 // A legal busy/unbusy cycle remounts the native child and creates a new
 // capability even when the same saved view returns (A/B/A).
 old.props.onLockChange(false,false);editor.props.onBusyChange(true);mounted.render();editor.props.onBusyChange(false);tree=mounted.render();await settle();tree=mounted.render();assert.deepEqual(locks.at(-1),[true,true]);
 const current=children.at(-1),count=locks.length;assert.notEqual(current.props.onLockChange,old.props.onLockChange);old.props.onLockChange(false,false);assert.equal(locks.length,count,'old child cleanup cannot release the new token');assert.equal(nodes(tree).find(node=>node.type==='legal-editor').props.disabled,true);
 mounted.unmount();assert.deepEqual(locks.at(-1),[false,false]);const closed=locks.length;current.props.onLockChange(true,true);current.props.onLockChange(false,false);assert.equal(locks.length,closed);
});
test('legal mutation guard repeats pending check inside the native Web Lock and retains failed save uncertainty',async()=>{
 const value=clearLegalHistory(await sample()),h=legalBrowser(),fake=responder(value);let writes=0;
 h.browser.navigator.locks.request=async(_key,_options,run)=>{h.data.set(h.key(value),'{new pending}');return run();};
 const mounted=ui({productId:value.productId},fake.request,undefined,{window:h.browser});mounted.render();await settle();mounted.render();await settle();let tree=mounted.render();
 const editor=nodes(tree).find(node=>node.type==='legal-editor');assert.equal(editor.props.disabled,false);
 await assert.rejects(editor.props.guardWrite(async()=>{writes++;return Response.json({});},new AbortController().signal));assert.equal(writes,0);assert.equal(h.data.get(h.key(value)),'{new pending}');
 editor.props.onMutationSettled('저장 응답을 확인하지 못했습니다.');tree=mounted.render();assert.equal(nodes(tree).filter(node=>node.type==='native-review').length,0);
 await settle();mounted.render();await settle();tree=mounted.render();assert.equal(nodes(tree).find(node=>node.type==='legal-editor').props.disabled,true);mounted.unmount();
});
