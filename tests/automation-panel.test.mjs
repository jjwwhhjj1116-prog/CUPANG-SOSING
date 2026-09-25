import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const code=ts.transpileModule(fs.readFileSync(new URL('../app/components/automation-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const version='2026-09-25T00:00:00.000Z';
const workflow={productId:'one',productVersion:version,revision:1,status:'blocked',stages:[]};
function mount(fetcher){
 const slots=[];let cursor=0,cleanup,updates=0;
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{updates++;slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(effect){const i=cursor++;if(!(i in slots)){slots[i]=true;cleanup=effect();}}};
 const exports={};let keys=0;
 vm.runInNewContext(code,{exports,AbortController,fetch:fetcher,crypto:{randomUUID:()=>`key-${++keys}`},require:name=>name==='react'?hooks:native(name)});
 const root=exports.AutomationPanel({productId:'one',version});
 return{render(){cursor=0;return root.type(root.props);},close(){cleanup();},get updates(){return updates;},wrapper:exports.AutomationPanel};
}
const run=tree=>nodes(tree).find(n=>n.type==='button'&&n.props.children==='실행 가능한 단계 처리').props.onClick();

test('automation screen isolates product versions and suppresses late execution results after close',async()=>{
 let finish,signal;const panel=mount(async(_url,init)=>{
  if(init.method!=='POST')return Response.json({workflow:null});
  signal=init.signal;return new Promise(resolve=>{finish=resolve;});
 });
 assert.notEqual(panel.wrapper({productId:'one',version}).key,panel.wrapper({productId:'one',version:'new'}).key);
 assert.notEqual(panel.wrapper({productId:'one',version}).key,panel.wrapper({productId:'two',version}).key);
 panel.render();await flush();run(panel.render());await flush();panel.close();const before=panel.updates;
 assert.equal(signal.aborted,true);finish(Response.json({workflow}));await flush();assert.equal(panel.updates,before);
});

test('same-render repeated click sends one request and uncertain retry reuses its key',async()=>{
 let finish;const sent=[];const panel=mount(async(_url,init)=>{
  if(init.method!=='POST')return Response.json({workflow:null});
  sent.push(JSON.parse(init.body));return new Promise(resolve=>{finish=resolve;});
 });
 panel.render();await flush();const tree=panel.render();run(tree);run(tree);assert.equal(sent.length,1);
 finish(Response.json({workflow:{...workflow,productId:'wrong'}}));await flush();
 run(panel.render());assert.equal(sent[1].idempotencyKey,sent[0].idempotencyKey);
 finish(Response.json({workflow}));await flush();run(panel.render());assert.notEqual(sent[2].idempotencyKey,sent[1].idempotencyKey);
 finish(Response.json({workflow}));await flush();panel.close();
});

test('late initial read never updates a closed screen',async()=>{
 let finish;const panel=mount(()=>new Promise(resolve=>{finish=resolve;}));panel.render();panel.close();
 const before=panel.updates;finish(Response.json({workflow}));await flush();assert.equal(panel.updates,before);
});
