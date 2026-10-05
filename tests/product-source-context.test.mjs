import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>nodes(tree).map(node=>typeof node.props?.children==='string'?node.props.children:JSON.stringify(node.props?.children??'')).join(' ');
const sourceUrl='https://detail.1688.com/offer/813724060928.html';
const context=(productId='one')=>({productId,sourceUrl,sourceGaps:[
 {fieldId:'detailHtml',label:'상세 설명',step:'상세 이미지'},
 {fieldId:'detailImages',label:'상세 이미지',step:'상세 이미지'},
 {fieldId:'noticeMaterial',label:'일반 상품 속성',step:'표시사항'},
],requestContext:{categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓']}});
function ui(handle,options={}){
 const states=[],effects=[],dependencies=[],cleanups=[],cache=new Map(),calls=[],navigation=[];let index=0,effectIndex=0;
 const hooks={useState(initial){const i=index++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
  useRef(initial){const i=index++;return states[i]??(states[i]={current:initial});},
  useEffect(fn,deps){const i=effectIndex++;if(!dependencies[i]||deps.some((value,j)=>!Object.is(value,dependencies[i][j]))){dependencies[i]=deps;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
   {exports,URL,AbortController,Error,fetch:async(url,init)=>{calls.push({url,init});return handle(url,init);},require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return native(name);if(name==='@/app/collection-supplement-client')return{completeCollectionSupplement:options.supplement??(()=>assert.fail('explicit click required'))};if(name.endsWith('.css'))return {};if(name.startsWith('@/'))return load(name.slice(2)+'.ts');throw Error(name);}});return exports;}
 const component=load('app/components/product-source-context.tsx').ProductSourceContext;
 const render=(step='SEO',productId='one',productVersion=undefined)=>{index=0;effectIndex=0;return component({productId,productVersion,sourceUrl,step,onNavigate:step=>navigation.push(step),onBusy:options.onBusy,onBeforeSupplement:options.onBeforeSupplement,onSaved:options.onSaved});};
 const flush=async()=>{effects.splice(0).forEach(fn=>fn());for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
 return {render,flush,calls,navigation,unmount:()=>cleanups.forEach(fn=>fn?.())};
}

test('the selected category stays visible across seven stages; source gaps navigate to saved detail/label editors without writes',async()=>{
 const h=ui(async()=>Response.json(context()));h.render();await h.flush();
 for(const step of ['SEO','가격','대표 이미지','추가 이미지','상세 이미지','표시사항','견적서'])assert.match(text(h.render(step)),/80719/);
 assert.equal(nodes(h.render('가격')).filter(node=>node.type==='button').length,0);
 const quote=h.render('견적서');const buttons=nodes(quote).filter(node=>node.type==='button');assert.equal(buttons.length,3);
 buttons.forEach(button=>button.props.onClick());assert.deepEqual(h.navigation,['상세 이미지','상세 이미지','표시사항']);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'/api/products/one/translation-source');
 assert.equal(h.calls[0].init.method,undefined);assert.equal(h.calls[0].init.cache,'no-store');h.unmount();
});

test('explicit supplement is single-flight, protects dirty inputs, and releases busy state even when product refresh fails',async()=>{
 const value={...context(),jobId:'job',provider:'1688-public-sku-v1',productVersion:'2026-10-05T01:00:00.000Z'};
 let dirty=true,resolve,captures=0;const busy=[];
 const h=ui(async()=>Response.json(value),{onBeforeSupplement:()=>!dirty,onBusy:value=>busy.push(value),onSaved:async()=>{throw Error('workspace GET unavailable');},supplement:async input=>{assert.equal(input.productId,'one');assert.equal(input.jobId,'job');assert.equal(input.sourceUrl,sourceUrl);captures++;await new Promise(done=>{resolve=done;});return '원문 보완됨';}});
 h.render();await h.flush();const button=()=>nodes(h.render()).find(node=>node.type==='button'&&node.props.children==='Chrome에서 상세 원문 보완');
 button().props.onClick();assert.equal(captures,0);dirty=false;
 const click=button().props.onClick;click();click();assert.equal(captures,1);assert.deepEqual(busy,[true]);
 resolve();await h.flush();assert.deepEqual(busy,[true,false]);assert.equal(button().props.disabled,false);assert.match(text(h.render()),/상품 목록을 새로 읽지 못했습니다/);h.unmount();
});

test('stale results are discarded on product changes and after closing the workspace',async()=>{
 const pending=[];const h=ui((url,init)=>new Promise(resolve=>pending.push({url,init,resolve})));
 h.render();await h.flush();h.render('SEO','two');await h.flush();assert.equal(pending[0].init.signal.aborted,true);
 pending[0].resolve(Response.json(context()));await h.flush();assert.equal(h.render('SEO','two'),null);
 pending[1].resolve(Response.json(context('two')));await h.flush();assert.match(text(h.render('SEO','two')),/80719/);
 h.render('SEO','three');await h.flush();h.unmount();pending[2].resolve(Response.json(context('three')));await h.flush();
 assert.equal(h.render('SEO','three'),null);assert.ok(pending.every(item=>item.init.signal.aborted));
});

test('wrong product, wrong offer and malformed category never display another draft; legacy products stay editable',async()=>{
 for(const body of [context('other'),{...context(),sourceUrl:'https://detail.1688.com/offer/999.html'},
  {...context(),requestContext:{categoryId:'80719',categoryPath:[]}}, {...context(),sourceGaps:[{fieldId:'title',label:'허위',step:'SEO'}]}]){
  const h=ui(async()=>Response.json(body));h.render();await h.flush();
  assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'));assert.doesNotMatch(text(h.render()),/주방수납바구니/);h.unmount();
 }
 const legacy=ui(async()=>Response.json({error:'no linked source'},{status:404}));legacy.render();await legacy.flush();assert.equal(legacy.render(),null);legacy.unmount();
});

test('source retry recovers read errors without creating collection jobs or changing product values',async()=>{
 let attempts=0;const h=ui(async()=>++attempts===1?Response.json({error:'일시적 조회 실패'},{status:503}):Response.json(context()));
 h.render();await h.flush();nodes(h.render()).find(node=>node.type==='button').props.onClick();h.render();await h.flush();
 assert.match(text(h.render()),/80719/);assert.equal(h.calls.length,2);assert.ok(h.calls.every(call=>call.init.method===undefined));h.unmount();
});

test('saving manual product edits refreshes the supplement version without losing the saved source identity',async()=>{
 let version='2026-10-05T01:00:00.000Z',received;
 const h=ui(async()=>Response.json({...context(),jobId:'job',provider:'1688-public-sku-v1',productVersion:version}),{supplement:async input=>{received=input;return 'saved';}});
 h.render('SEO','one',version);await h.flush();version='2026-10-05T01:01:00.000Z';h.render('SEO','one',version);await h.flush();
 nodes(h.render('SEO','one',version)).find(node=>node.type==='button'&&node.props.children==='Chrome에서 상세 원문 보완').props.onClick();await h.flush();
 assert.equal(received.productVersion,version);assert.equal(received.productId,'one');assert.equal(received.jobId,'job');h.unmount();
});
