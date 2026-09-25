import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,overrides={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,structuredClone,TextEncoder,require:name=>overrides[name]??load(name.slice(2)+'.ts',overrides)});return exports;}
function view(){return {imageKeys:[],categoryContext:{categoryId:'80719'},resolved:{schema:{categoryId:'80719',categoryPath:['주방'],fields:[{id:'title',label:'상품명',section:'start'},{id:'model',label:'모델명',section:'product'}]},rows:[{optionId:'a',optionLabel:'옵션',included:true,fields:{title:{value:'상품'},model:{value:'모델'}}}]}};}
test('multi-product label retries reuse files only for identical category and rendered content',async()=>{
 let current=view(),fail=true;const observed=[];
 const {runProductLabels:run}=load('app/batch-labels.ts',{'@/app/quotation-label-batch':{attachQuotationLabels:async input=>{observed.push({product:input.productId,reused:input.uploaded.get('a')});input.uploaded.set('a','owner/'+input.productId+'.png');if(fail)throw Error('lost response');return {completed:1,total:1};}}});
 const options={cache:new Map(),render:async()=>{throw Error('not called by mock')},shouldStop:()=>false,onProgress:()=>{},fetcher:async(url,init)=>{assert.equal(init.cache,'no-store');assert.ok(url.endsWith('/quotation-fields'));return Response.json(current);}};
 await assert.rejects(()=>run('p',options),/lost response/);fail=false;await run('p',options);
 assert.equal(observed[1].reused,'owner/p.png');
 await run('other',options);assert.equal(observed[2].reused,undefined);
 current.resolved.rows[0].fields.model.value='새 모델';await run('p',options);assert.equal(observed[3].reused,undefined);
 current.categoryContext.categoryId='81452';await run('p',options);assert.equal(observed[4].reused,undefined);
});
test('missing category, empty inclusion and failed reads do not enter attachment writes',async()=>{
 let writes=0,current=view(),status=200;
 const {runProductLabels:run}=load('app/batch-labels.ts',{'@/app/quotation-label-batch':{attachQuotationLabels:async()=>{writes++;}}});
 const options={cache:new Map(),render:async()=>{},shouldStop:()=>false,onProgress:()=>{},fetcher:async()=>Response.json(current,{status})};
 status=503;await assert.rejects(()=>run('p',options));status=200;current.resolved.schema.categoryId=null;await assert.rejects(()=>run('p',options));
 current=view();current.resolved.rows[0].included=false;await assert.rejects(()=>run('p',options));assert.equal(writes,0);
});
test('stop before or during source read prevents generation and upload',async()=>{
 let stopped=true,reads=0,writes=0;
 const {runProductLabels:run}=load('app/batch-labels.ts',{'@/app/quotation-label-batch':{attachQuotationLabels:async()=>{writes++;}}});
 const options={cache:new Map(),render:async()=>{},shouldStop:()=>stopped,onProgress:()=>{},fetcher:async()=>{reads++;stopped=true;return Response.json(view());}};
 assert.equal(await run('p',options),null);assert.equal(reads,0);stopped=false;assert.equal(await run('p',options),null);assert.equal(reads,1);assert.equal(writes,0);
});

import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));};
function panel(run){const slots=[],effects=[];let index=0,first=true;const hooks={useState(initial){const i=index++;slots[i]??=typeof initial==='function'?initial():initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(initial){return slots[index++]??(slots[index-1]={current:initial});},useEffect(fn){if(first)effects.push(fn);}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/batch-label-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,require(name){if(name==='react')return hooks;if(name==='@/app/batch-labels')return{runProductLabels:run};if(name==='@/app/document-image-render')return{renderDocument:async()=>{}};return native(name);}});
 const render=()=>{index=0;const tree=exports.BatchLabelPanel({products:[{id:'a',title:'첫 상품'},{id:'b',title:'둘째 상품'}],onOpen:()=>{}});if(first){first=false;effects.forEach(fn=>fn());}return tree;};return {render,button:name=>nodes(render()).find(n=>n.type==='button'&&n.props.children===name)};
}
test('batch label UI isolates product failures and rejects overlapping runs',async()=>{
 const calls=[];let finish;const pending=new Promise(resolve=>{finish=resolve;});const h=panel(async id=>{calls.push(id);if(id==='a'){await pending;throw Error('첫 상품 실패');}return{completed:2,total:2,stopped:false};});
 const start=h.button('선택 상품 라벨 생성·연결').props.onClick;start();start();assert.deepEqual(calls,['a']);finish();await settle();assert.deepEqual(calls,['a','b']);assert.match(JSON.stringify(h.render()),/첫 상품 실패/);assert.match(JSON.stringify(h.render()),/2개 옵션 라벨 생성/);
});

