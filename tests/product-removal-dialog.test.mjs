import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const removed=(id='removed-a',owner='test-owner')=>({id,owner_id:owner,title:'보관 상품 '+id,source_url:'https://source.example.test/product/'+id,updated_at:'2026-10-06T00:00:00.000Z',removed_at:'2026-10-06T00:01:00.000Z'});

/** The actual dialog and effects; HTTP is supplied at the response boundary. */
function harness(fetcher,{workspaceOwnerId='test-owner',onRestored=async()=>{}}={}){
 const slots=[],effects=[],requests=[],busyChanges=[];let index=0,closed=false,lateWrites=0,restored=0;
 const props={workspaceOwnerId,onRestored:async()=>{restored++;await onRestored();},onBusyChange:value=>busyChanges.push(value)};
 const hooks={
  useState(initial){const slot=index++;if(!(slot in slots))slots[slot]=typeof initial==='function'?initial():initial;return[slots[slot],value=>{if(closed){lateWrites++;return;}slots[slot]=typeof value==='function'?value(slots[slot]):value;}];},
  useRef(initial){const slot=index++;return slots[slot]??(slots[slot]={current:initial});},
  useEffect(fn,deps){const slot=index++,old=slots[slot];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i]))){const next={deps,cleanup:old?.cleanup};slots[slot]=next;effects.push(()=>{next.cleanup?.();next.cleanup=fn();});}},
 };
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/product-removal-dialog.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,Date,fetch:async(url,init)=>{requests.push({url,init});return fetcher(url,init);},require:name=>name==='react'?hooks:native(name)});
 const Component=exports.ProductRemovalDialog;
 const render=()=>{index=0;const tree=Component(props);effects.splice(0).forEach(fn=>fn());return tree;};
 const settle=async()=>{for(let i=0;i<8;i++){if(!closed)render();await new Promise(resolve=>setImmediate(resolve));}};
 render();
 return{render,settle,requests,busyChanges,buttons:()=>nodes(render()).filter(node=>node.type==='button'&&text(node)==='복원'),refresh(){nodes(render()).find(node=>node.type==='button'&&text(node)==='새로고침').props.onClick();render();},changeOwner(owner){props.workspaceOwnerId=owner;render();},close(){closed=true;slots.forEach(slot=>slot?.cleanup?.());},get restored(){return restored;},get lateWrites(){return lateWrites;}};
}

test('removed-product dialog exposes restore only after a fresh response belonging to the workspace owner',async()=>{
 const pending=deferred(),row=removed();const h=harness(()=>pending.promise);try{
  assert.equal(h.buttons().length,0);assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/products?removed=only');assert.equal(h.requests[0].init.cache,'no-store');
  pending.resolve(Response.json({products:[row]}));await h.settle();assert.equal(h.buttons().length,1);assert.match(text(h.render()),/보관 상품 removed-a/);assert.equal(h.requests.length,1);assert.equal(h.restored,0);
 }finally{h.close();}
});

test('foreign-owner and malformed removal lists expose no restore controls and can recover through a fresh read',async()=>{
 for(const body of [{products:[removed('foreign','other-owner')]},{products:[removed(),removed('foreign','other-owner')]},{products:null},{},{products:[null]},{products:[{...removed(),updated_at:''}]},{products:[{...removed(),removed_at:''}]}]){
  let attempt=0;const h=harness(async()=>Response.json(++attempt===1?body:{products:[removed()]}));try{
   await h.settle();assert.equal(h.buttons().length,0);assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'));assert.equal(h.restored,0);
   h.refresh();await h.settle();assert.equal(h.buttons().length,1);assert.ok(h.requests.every(request=>!request.init.method));
  }finally{h.close();}
 }
});

test('restore sends the exact product/version/removal timestamp once and keeps other removed rows',async()=>{
 const row=removed(),other=removed('removed-b'),pending=deferred();const h=harness(async(_url,init)=>init.method==='DELETE'?pending.promise:Response.json({products:[row,other]}));try{
  await h.settle();const clicked=h.buttons()[0].props.onClick;clicked();clicked();await h.settle();
  const writes=h.requests.filter(request=>request.init.method==='DELETE');assert.equal(writes.length,1);assert.equal(writes[0].url,'/api/products/'+row.id);assert.deepEqual(JSON.parse(writes[0].init.body),{action:'restore',expectedVersion:row.updated_at,expectedRemovedAt:row.removed_at});assert.equal(writes[0].init.headers['content-type'],'application/json');
  assert.ok(nodes(h.render()).filter(node=>node.type==='button').every(node=>node.props.disabled));assert.deepEqual(h.busyChanges,[true]);
  pending.resolve(Response.json({productId:row.id,restored:true}));await h.settle();assert.equal(h.restored,1);assert.deepEqual(h.busyChanges,[true,false]);assert.equal(h.buttons().length,1);assert.match(text(h.render()),/보관 상품 removed-b/);assert.doesNotMatch(text(h.render()),/보관 상품 removed-a/);assert.equal(h.buttons()[0].props.disabled,false);
 }finally{h.close();}
});

test('failed or malformed restore results preserve the row and release the lock for retry',async()=>{
 const row=removed();for(const reply of [()=>Response.json({error:'버전 변경'},{status:409}),()=>Response.json({productId:'wrong-product',restored:true}),()=>Response.json({productId:row.id,restored:false}),()=>Response.json({}),()=>Response.json(null),()=>new Response('not-json',{headers:{'content-type':'application/json'}})]){
  let writes=0;const h=harness(async(_url,init)=>init.method==='DELETE'?(++writes===1?reply():Response.json({productId:row.id,restored:true})):Response.json({products:[row]}));try{
   await h.settle();h.buttons()[0].props.onClick();await h.settle();assert.equal(h.restored,0);assert.equal(h.buttons().length,1);assert.equal(h.buttons()[0].props.disabled,false);assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'));assert.deepEqual(h.busyChanges,[true,false]);
   h.buttons()[0].props.onClick();await h.settle();assert.equal(h.restored,1);assert.equal(h.buttons().length,0);assert.equal(writes,2);
  }finally{h.close();}
 }
});

test('closing aborts an outstanding read and ignores its late response',async()=>{
 const pending=deferred(),h=harness(()=>pending.promise);h.close();assert.equal(h.requests[0].init.signal.aborted,true);pending.resolve(Response.json({products:[removed()]}));await h.settle();assert.equal(h.lateWrites,0);assert.equal(h.restored,0);assert.deepEqual(h.busyChanges,[false]);
});

test('closing aborts an outstanding restore and emits busy cleanup without late state or parent updates',async()=>{
 const pending=deferred(),h=harness(async(_url,init)=>init.method==='DELETE'?pending.promise:Response.json({products:[removed()]}));await h.settle();h.buttons()[0].props.onClick();await h.settle();h.close();
 assert.equal(h.requests.find(request=>request.init.method==='DELETE').init.signal.aborted,true);assert.deepEqual(h.busyChanges,[true,false]);pending.resolve(Response.json({productId:'removed-a',restored:true}));await h.settle();assert.equal(h.restored,0);assert.equal(h.lateWrites,0);assert.deepEqual(h.busyChanges,[true,false]);
});

test('changing owner aborts the old restore and releases its busy state before loading the new account',async()=>{
 const pending=deferred();let owner='test-owner';const h=harness(async(_url,init)=>init.method==='DELETE'?pending.promise:Response.json({products:[removed(owner==='test-owner'?'removed-a':'removed-b',owner)]}));try{
  await h.settle();h.buttons()[0].props.onClick();await h.settle();owner='other-owner';h.changeOwner(owner);await h.settle();
  assert.equal(h.requests.find(request=>request.init.method==='DELETE').init.signal.aborted,true);assert.deepEqual(h.busyChanges,[true,false]);assert.equal(h.buttons().length,1);assert.equal(h.buttons()[0].props.disabled,false);
  pending.resolve(Response.json({productId:'removed-a',restored:true}));await h.settle();assert.equal(h.restored,0);assert.match(text(h.render()),/보관 상품 removed-b/);assert.deepEqual(h.busyChanges,[true,false]);
 }finally{h.close();}
});
