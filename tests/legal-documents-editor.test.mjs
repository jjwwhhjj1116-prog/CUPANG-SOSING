import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {assetApiFixture,companies} from './helpers/supplier-hub-single-assets.mjs';
const native=createRequire(import.meta.url),origin='https://sourceflow.jjwwhhjj1116.workers.dev';
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
function ui(initial,request){
 const slots=[],effects=[];let cursor=0,props=initial;
 const effect=(fn,deps,layout)=>{const index=cursor++,old=slots[index];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps?.[i]))){old?.cleanup?.();slots[index]={deps};const run=()=>slots[index].cleanup=fn();if(layout)run();else effects.push(run);}};
 const hooks={useState(value){const index=cursor++;if(!(index in slots))slots[index]=value;return[slots[index],next=>slots[index]=typeof next==='function'?next(slots[index]):next];},useRef(value){const index=cursor++;return slots[index]??(slots[index]={current:value});},useEffect:(fn,deps)=>effect(fn,deps,false),useLayoutEffect:(fn,deps)=>effect(fn,deps,true)};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/legal-documents-editor.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,fetch:request,AbortController,FormData,Error,require:name=>name==='react'?hooks:native(name)});
 return{render(next={}){props={...props,...next};cursor=0;const tree=exports.LegalDocumentsEditor(props);effects.splice(0).forEach(run=>run());return tree;},unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}
for(const company of companies)test(`legal editor saves applicability through the real API and invalidates the old quotation (${company.code})`,async()=>{
 const f=await assetApiFixture(company);try{
  const api=f.h.load('app/api/products/[id]/legal-documents/route.ts'),context={params:Promise.resolve({id:f.id})},calls=[],busy=[],settled=[];let saved=0;
  const before=await (await f.h.route(f.base+'/quotation-fields'+f.query)).json();
  const request=async(path,init)=>{calls.push(init.method);return api[init.method](new Request(origin+path,init),context);};
  const h=ui({productId:f.id,disabled:false,onSaved(){saved++;},onBusyChange:value=>busy.push(value),guardWrite:async(run,signal)=>{assert.equal(signal.aborted,false);return run();},onMutationSettled:message=>settled.push(message)},request);
  let tree=h.render();nodes(tree).find(node=>node.type==='button').props.onClick();await settle();tree=h.render();
  const select=nodes(tree).find(node=>node.type==='select');assert.equal(select.props.value,'unconfirmed');select.props.onChange({target:{value:'not-applicable'}});await settle();tree=h.render();
  assert.equal(nodes(tree).find(node=>node.type==='select').props.value,'not-applicable');assert.equal(saved,1);assert.deepEqual(calls,['GET','PATCH']);assert.deepEqual(busy,[true,false,true,false]);assert.deepEqual(settled,[undefined]);
  const after=await (await f.h.route(f.base+'/quotation-fields'+f.query)).json();assert.notEqual(after.inputFingerprint,before.inputFingerprint);assert.equal(after.contentRevision,before.contentRevision+1);assert.deepEqual(f.h.network,[]);h.unmount();
 }finally{f.close();}
});
test('legal editor stale disabled handlers and denied guards cannot dispatch mutations',async()=>{
 let writes=0,settled=[];const request=async(_path,init)=>{if(init.method!=='GET')writes++;return Response.json({revision:1,documents:{applicability:'unconfirmed',files:[]}});};
 const h=ui({productId:'synthetic-legal',disabled:false,onSaved:()=>assert.fail('No save'),guardWrite:async()=>{throw Error('Pending native intent');},onMutationSettled:message=>settled.push(message)},request);
 let tree=h.render();const load=nodes(tree).find(node=>node.type==='button');h.render({disabled:true});load.props.onClick();await settle();assert.equal(writes,0);assert.equal(nodes(h.render()).some(node=>node.type==='select'),false);
 h.render({disabled:false});load.props.onClick();await settle();tree=h.render();const select=nodes(tree).find(node=>node.type==='select');h.render({disabled:true});select.props.onChange({target:{value:'required'}});await settle();assert.equal(writes,0);assert.deepEqual(settled,[]);
 h.render({disabled:false});select.props.onChange({target:{value:'required'}});await settle();assert.equal(writes,0);assert.deepEqual(settled,['Pending native intent']);h.unmount();
});
test('legal editor repeats disabled check after an asynchronous guard before issuing a write',async()=>{
 let release,writes=0;const request=async(_path,init)=>{if(init.method!=='GET')writes++;return Response.json({revision:1,documents:{applicability:'unconfirmed',files:[]}});};
 const h=ui({productId:'synthetic-legal',disabled:false,onSaved:()=>assert.fail('No save'),guardWrite:async run=>{await new Promise(resolve=>{release=resolve;});return run();}},request);
 nodes(h.render()).find(node=>node.type==='button').props.onClick();await settle();nodes(h.render()).find(node=>node.type==='select').props.onChange({target:{value:'required'}});await settle();assert.ok(release);
 h.render({disabled:true});release();await settle();assert.equal(writes,0);h.unmount();
});
