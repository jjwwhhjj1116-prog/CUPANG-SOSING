import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
function harness(handler, readHandler){
 const state=[],refs=[],effects=[],cleanups=[],cache=new Map();let si=0,ri=0,first=true,saves=0;
 const hooks={useState(initial){const i=si++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;}];},useRef(initial){const i=ri++;return refs[i]??(refs[i]={current:initial});},useMemo:fn=>fn(),useCallback:fn=>fn,useEffect(fn){if(first)effects.push(fn);}};
 let body;
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,structuredClone,TextEncoder,crypto,fetch:async(url,init)=>init?.method==='PATCH'?handler(url,init,body):readHandler?readHandler(body):Response.json(body),require(name){if(name==='react')return hooks;if(name.startsWith('@/'))return load(name.slice(2)+(name.includes('/components/')?'.tsx':'.ts'));return native(name);}});return exports;}
 const model=load('app/product-options.ts');body={options:{...model.emptyProductOptions('p'),revision:1,rows:[{...model.emptyOptionInput('a'),unitCostCny:2,included:true,updatedAt:'before',provenance:{}}]},productVersion:'2026-09-24T00:00:00Z',pricing:{policy:{exchangeRate:100,supplyMargin:0,coupangMargin:0,minimumMargin:0,msrpMultiple:1,roundingUnit:1},policySource:'saved-product',rows:[]}};
 const component=load('app/components/product-options-editor.tsx').ProductOptionsEditor;
 const product={id:'p',title:'상품',image_keys:'["owner/a.png","owner/b.png"]',updated_at:body.productVersion};
 const render=()=>{si=0;ri=0;const root=component({product,onSaved(){saves++;}});const tree=root.type(root.props);first=false;return tree;};
 const button=()=>nodes(render()).find(n=>n.type==='button'&&n.props.children==='옵션 저장·가격 계산');
 const image=()=>nodes(render()).find(n=>n.type==='select'&&n.props['aria-label']==='옵션 1 이미지');
 return{render,button,image,product,get saves(){return saves;},async start(){render();effects.forEach(fn=>cleanups.push(fn()));await settle();},unmount(){cleanups.forEach(fn=>fn?.());}};
}

test('option image save is single-flight and next edit uses the returned revision and product version',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});const requests=[];
 const h=harness(async(_url,init,base)=>{const request=JSON.parse(init.body);requests.push(request);if(requests.length===1)await pending;return Response.json({...base,options:{...base.options,revision:request.expectedRevision+1,rows:request.rows.map(row=>({...row,provenance:{imageKey:'manual'}}))},productVersion:'2026-09-24T00:01:00Z'});});
 await h.start();h.image().props.onChange({target:{value:'owner/a.png'}});const click=h.button().props.onClick;click();click();assert.equal(requests.length,1);finish();await settle();assert.equal(h.saves,1);
 h.product.updated_at='2026-09-24T00:01:00Z';h.image().props.onChange({target:{value:'owner/b.png'}});assert.equal(h.button().props.disabled,false);h.button().props.onClick();await settle();
 assert.equal(requests.length,2);assert.equal(requests[1].expectedRevision,2);assert.equal(requests[1].expectedProductVersion,h.product.updated_at);assert.equal(requests[1].rows[0].imageKey,'owner/b.png');
});

test('late option save after unmount does not report success and failed save preserves image draft for retry',async()=>{
 let finish,signal;const pending=new Promise(resolve=>{finish=resolve;});
 const closed=harness(async(_url,init,body)=>{signal=init.signal;await pending;return Response.json(body);});await closed.start();closed.image().props.onChange({target:{value:'owner/a.png'}});closed.button().props.onClick();closed.unmount();assert.equal(signal.aborted,true);finish();await settle();assert.equal(closed.saves,0);
 let fail=true;const h=harness(async(_url,init,body)=>fail?Response.json({error:'저장 실패'},{status:503}):Response.json({...body,options:{...body.options,revision:2,rows:JSON.parse(init.body).rows}}));await h.start();h.image().props.onChange({target:{value:'owner/b.png'}});h.button().props.onClick();await settle();assert.equal(h.image().props.value,'owner/b.png');assert.equal(h.saves,0);fail=false;h.button().props.onClick();await settle();assert.equal(h.saves,1);
});

test('explicit merge keeps local image and remote stock, then saves against the latest revision',async()=>{
 let reads=0;const requests=[];
 const h=harness(async(_url,init,base)=>{
  const request=JSON.parse(init.body);requests.push(request);
  if(requests.length===1)return Response.json({error:'다른 작업에서 변경됨'},{status:409});
  return Response.json({...base,options:{...base.options,revision:3,rows:request.rows},productVersion:'2026-09-24T00:02:00Z'});
 },base=>{reads++;return Response.json(reads===1?base:{...base,options:{...base.options,revision:2,rows:base.options.rows.map(row=>({...row,stock:20}))},productVersion:'2026-09-24T00:01:00Z'});});
 await h.start();h.image().props.onChange({target:{value:'owner/b.png'}});h.button().props.onClick();await settle();
 assert.equal(h.button().props.disabled,true);
 const merge=nodes(h.render()).find(n=>n.type==='button'&&n.props.children==='입력 유지 · 서버 변경 합치기');
 assert.ok(merge);merge.props.onClick();await settle();
 assert.equal(requests.length,1,'merge itself does not save');assert.equal(h.image().props.value,'owner/b.png');
 h.product.updated_at='2026-09-24T00:01:00Z';assert.equal(h.button().props.disabled,false);h.button().props.onClick();await settle();
 assert.equal(requests.length,2);assert.equal(requests[1].expectedRevision,2);assert.equal(requests[1].expectedProductVersion,h.product.updated_at);
 assert.equal(requests[1].rows[0].imageKey,'owner/b.png');assert.equal(requests[1].rows[0].stock,20);
});