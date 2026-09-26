import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,fetch:deps.fetch,require:name=>deps[name]??native(name)});return exports;}
const {readBatchTranslationTarget:read}=load('app/batch-translation.ts');
const version='2026-09-25T00:00:00.000Z';
const job={id:'11111111-1111-1111-1111-111111111111',productId:'p',productVersion:version,status:'completed',result:{},createdAt:version};
const signal=()=>new AbortController().signal;
test('batch discovery chooses newest current completed result using read requests only',async()=>{
 const newer={...job,id:'22222222-2222-2222-2222-222222222222',createdAt:'2026-09-25T01:00:00.000Z'};
 const jobs=[job,{...newer,productId:'other'},{...newer,productVersion:'old'},{...newer,status:'running'},newer,null];const before=JSON.stringify(jobs),calls=[];
 const result=await read('p',async(url,init)=>{calls.push([url,init]);return Response.json(url.endsWith('/translation')?{jobs}:{product:{id:'p',updated_at:version}});},signal());
 assert.equal(result.jobId,newer.id);assert.equal(result.version,version);assert.equal(calls.length,2);assert.ok(calls.every(([,init])=>!init.method&&!init.body));assert.equal(JSON.stringify(jobs),before);
});
test('missing completed result is distinct from failed or malformed discovery',async()=>{
 const fetcher=async url=>Response.json(url.endsWith('/translation')?{jobs:[]}:{product:{id:'p',updated_at:version}});
 assert.equal((await read('p',fetcher,signal())).jobId,null);
 for(const value of [null,{jobs:null},{jobs:{}}])await assert.rejects(()=>read('p',async url=>Response.json(url.endsWith('/translation')?value:{product:{id:'p',updated_at:version}}),signal()));
 let calls=0;await assert.rejects(()=>read('p',async()=>{calls++;return Response.json({product:{id:'other',updated_at:version}});},signal()));assert.equal(calls,1);
});
test('stopping discovery prevents follow-up calls and discards late response',async()=>{
 const controller=new AbortController();let calls=0;
 assert.equal(await read('p',async()=>{calls++;controller.abort();return Response.json({product:{id:'p',updated_at:version}});},controller.signal),null);assert.equal(calls,1);
 assert.equal(await read('p',async()=>{throw Error('must not fetch');},controller.signal),null);
});
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));};
test('batch view isolates product failures and links exact reviewed result without executing a provider',async()=>{
 const slots=[],effects=[];let cursor=0;const calls=[];function Preview(){}
 const hooks={useState(v){const i=cursor++;if(!(i in slots))slots[i]=v;return[slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},useEffect(fn,deps){const i=cursor++;if(!slots[i]||deps.some((v,j)=>v!==slots[i].deps[j]))effects.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,cleanup:fn()};});}};
 const {BatchTranslationPanel}=load('app/components/batch-translation-panel.tsx',{react:hooks,'@/app/components/batch-translation-apply':{BatchTranslationApply:()=>null},'@/app/components/translation-integrated-preview':{TranslationIntegratedPreview:Preview},'@/app/batch-translation':{readBatchTranslationTarget:async id=>{calls.push(id);if(id==='bad')throw Error('개별 조회 실패');return{productId:id,version,jobId:id==='empty'?null:job.id};}},fetch:()=>{throw Error('no provider');}});
 const products=[{id:'bad',title:'실패 상품'},{id:'p',title:'정상 상품'},{id:'empty',title:'대기 상품'}];
 const render=()=>{cursor=0;const tree=BatchTranslationPanel({products,onOpen(){}});effects.splice(0).forEach(fn=>fn());return tree;};
 render();await settle();const tree=render();assert.deepEqual(calls,['bad','p','empty']);assert.match(JSON.stringify(tree),/개별 조회 실패/);assert.match(JSON.stringify(tree),/완료 번역이 없습니다/);
 const previews=nodes(tree).filter(n=>n.type===Preview);assert.equal(previews.length,1);assert.equal(previews[0].props.productId,'p');assert.equal(previews[0].props.version,version);assert.equal(previews[0].props.jobId,job.id);assert.equal(previews[0].props.disabled,false);
 const batch=nodes(tree).find(n=>typeof n.props?.onBusyChange==='function');batch.props.onBusyChange(true);const locked=render();assert.equal(nodes(locked).find(n=>n.type===Preview).props.disabled,true);assert.ok(nodes(locked).filter(n=>n.type==='button').every(n=>n.props.disabled));
});
