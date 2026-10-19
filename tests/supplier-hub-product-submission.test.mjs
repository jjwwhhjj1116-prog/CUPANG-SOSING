import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {assetApiFixture,companies,module,plain} from './helpers/supplier-hub-single-assets.mjs';
const native=createRequire(import.meta.url),origin='https://app.test';
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
function load({hooks={},fetcher=()=>assert.fail('Unexpected request'),timers={setTimeout,clearTimeout}}={}){
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/supplier-hub-product-submission.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,Error,AbortController,Uint8Array,TextDecoder,...timers,window:{location:{origin}},fetch:fetcher,require(name){if(name==='react')return hooks;if(name==='@/app/components/supplier-hub-single-review')return{SupplierHubSingleReview:'native-review'};return name.startsWith('@/')?module(name.slice(2)+'.ts'):native(name);}});
 return exports;
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

function ui(initial,fetcher,timers){
 const slots=[],effects=[];let cursor=0,props=initial,mountedKey=null;
 const hook=(fn,deps,layout)=>{const index=cursor++,old=slots[index];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps?.[i]))){old?.cleanup?.();slots[index]={deps};const run=()=>{slots[index].cleanup=fn();};if(layout)run();else effects.push(run);}};
 const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return[slots[index],value=>slots[index]=typeof value==='function'?value(slots[index]):value];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useLayoutEffect:(fn,deps)=>hook(fn,deps,true),useEffect:(fn,deps)=>hook(fn,deps,false)};
 const Component=load({hooks,fetcher,timers}).SupplierHubProductSubmission;
 function render(next={}){props={...props,...next};cursor=0;const outer=Component(props);if(mountedKey!==null&&outer.key!==mountedKey){slots.forEach(slot=>slot?.cleanup?.());slots.length=0;effects.length=0;}mountedKey=outer.key;cursor=0;const tree=outer.type(outer.props);effects.splice(0).forEach(run=>run());return tree;}
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
