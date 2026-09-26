import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,structuredClone,AbortController,Error,fetch:deps.fetch,require:name=>deps[name]??(()=>{throw Error(name);})()});return exports;}
const model=load('app/batch-translation-apply.ts');
const version='2026-09-26T00:00:00.000Z',next='2026-09-26T00:00:01.000Z';
function item(id='p'){return {target:{productId:id,version,jobId:'11111111-1111-1111-1111-111111111111'},plan:{productId:id,productVersion:version,contentRevision:1,optionRevision:2,fingerprint:'a'.repeat(64),preview:[{name:'품명',before:'原文',after:'한국어'}],skipped:['수동값 유지']}};}
const receipt=id=>({productId:id,productVersion:next,contentRevision:2,optionRevision:3,applied:1});
test('batch previews do not apply or call a paid provider and validate target, scope and plan',async()=>{
 const data=item(),calls=[];
 const result=await model.previewBatchTranslation(data.target,async(url,init)=>{calls.push([url,JSON.parse(init.body)]);return Response.json(data.plan);});
 assert.equal(result.plan.fingerprint,data.plan.fingerprint);assert.equal(calls.length,1);assert.equal(calls[0][1].action,'preview');
 for(const patch of [{productId:'other'},{productVersion:next},{scope:'options'},{fingerprint:'bad'},{contentRevision:-1},{preview:[null]},{skipped:[1]}])await assert.rejects(()=>model.previewBatchTranslation(data.target,async()=>Response.json({...data.plan,...patch})));
});
test('batch applies exact reviewed fingerprints serially and checks every receipt',async()=>{
 const items=[item('a'),item('b'),item('empty')];items[2].plan.preview=[];const before=JSON.stringify(items),calls=[],saved=[];
 const result=await model.applyBatchTranslations(items,{shouldStop:()=>false,onSaved:(id,count)=>saved.push([id,count]),fetcher:async(url,init)=>{const id=url.split('/')[3];calls.push(JSON.parse(init.body));return Response.json(receipt(id));}});
 assert.equal(result.status,'completed');assert.deepEqual([...result.saved],['a','b']);assert.deepEqual(saved,[['a',1],['b',1]]);assert.equal(calls.length,2);assert.ok(calls.every(body=>body.action==='apply'&&body.fingerprint==='a'.repeat(64)&&body.expectedVersion===version));assert.equal(JSON.stringify(items),before);
});
test('partial failure or uncertain receipt stops subsequent products without retrying prior saves',async()=>{
 for(const failure of ['http','network','receipt']){
  const calls=[],saved=[];
  const result=await model.applyBatchTranslations([item('a'),item('b'),item('c')],{shouldStop:()=>false,onSaved:id=>saved.push(id),fetcher:async url=>{const id=url.split('/')[3];calls.push(id);if(id==='b'){if(failure==='network')throw Error('lost response');return failure==='http'?Response.json({error:'conflict'},{status:409}):Response.json({...receipt(id),optionRevision:99});}return Response.json(receipt(id));}});
  assert.equal(result.status,'failed');assert.equal(result.failedProductId,'b');assert.deepEqual(calls,['a','b']);assert.deepEqual(saved,['a']);
 }
});
test('stop finishes in-flight write and preserves its receipt but never starts next product',async()=>{
 let stop=false;const saved=[],calls=[];
 const result=await model.applyBatchTranslations([item('a'),item('b')],{shouldStop:()=>stop,onSaved:id=>saved.push(id),fetcher:async url=>{calls.push(url);stop=true;return Response.json(receipt('a'));}});
 assert.equal(result.status,'stopped');assert.equal(calls.length,1);assert.deepEqual(saved,['a']);
 await assert.rejects(()=>model.applyBatchTranslations([item('a'),item('a')],{shouldStop:()=>false,onSaved(){},fetcher:()=>{throw Error('must not call');}}),/중복/);
});
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const text=t=>typeof t==='string'||typeof t==='number'?String(t):Array.isArray(t)?t.map(text).join(''):t&&typeof t==='object'?text(t.props?.children):'';
function harness(){
 const slots=[],effects=[];let cursor=0;const busy=[],calls=[];
 const hooks={useState(v){const i=cursor++;if(!(i in slots))slots[i]=v;return[slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},useRef(v){const i=cursor++;return slots[i]??(slots[i]={current:v});},useEffect(fn){const i=cursor++;if(!slots[i]){slots[i]=true;effects.push(fn);}}};
 const fetcher=async(url,init)=>{const id=url.split('/')[3],body=JSON.parse(init.body);calls.push([id,body.action]);return Response.json(body.action==='preview'?item(id).plan:receipt(id));};
 const {BatchTranslationApply}=load('app/components/batch-translation-apply.tsx',{react:hooks,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'@/app/batch-translation':{readBatchTranslationTarget:async id=>item(id).target},'@/app/batch-translation-apply':model,fetch:fetcher});
 const props={products:[{id:'a',title:'첫 상품'},{id:'b',title:'둘째 상품'}],disabled:false,onBusyChange:v=>busy.push(v)};
 const render=()=>{cursor=0;return BatchTranslationApply(props);};render();const cleanup=effects.map(fn=>fn());
 return {render,calls,busy,close:()=>cleanup.forEach(fn=>fn?.()),button:label=>nodes(render()).find(n=>n.type==='button'&&text(n).includes(label))};
}
test('batch UI shows reviewed changes and one action saves all without duplicate clicks',async()=>{
 const h=harness();assert.equal(h.button('함께 저장').props.disabled,true);
 await h.button('전체 적용 미리보기').props.onClick();await new Promise(r=>setImmediate(r));
 assert.match(text(h.render()),/한국어/);assert.equal(h.button('함께 저장').props.disabled,false);
 h.button('함께 저장').props.onClick();h.button('함께 저장').props.onClick();await new Promise(r=>setImmediate(r));
 assert.deepEqual(h.calls,[['a','preview'],['b','preview'],['a','apply'],['b','apply']]);assert.match(text(h.render()),/2개 상품의 번역을 저장/);assert.equal(h.button('함께 저장').props.disabled,true);assert.deepEqual(h.busy,[true,false,true,false]);h.close();
});
