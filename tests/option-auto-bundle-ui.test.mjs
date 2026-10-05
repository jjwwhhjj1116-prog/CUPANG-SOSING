import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url),nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
function harness(fetcher){
 const state=[],refs=[],effects=[],cleanups=[],cache=new Map(),requests=[];let si=0,ri=0,first=true,applied=0;
 const hooks={useState(initial){const i=si++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},useRef(initial){const i=ri++;return refs[i]??(refs[i]={current:initial});},useEffect(fn){if(first)effects.push(fn);}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  const text=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8')+(file.endsWith('product-options-editor.tsx')?'\nexport {OptionBulkTools};':'');
  vm.runInNewContext(ts.transpileModule(text,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,crypto,fetch:async(url,init)=>{requests.push({url,init});return fetcher(url,init);},require:name=>name==='react'?hooks:name.startsWith('@/')?load(name.slice(2)+(name.includes('/components/')?'.tsx':'.ts')):native(name)});return exports;
 }
 const model=load('app/product-options.ts'),component=load('app/components/product-options-editor.tsx').OptionBulkTools;
 const original=[{...model.emptyOptionInput('a'),originalName:'원문',translatedName:'',supplierSku:'sku-a',stock:25,minimumOrderQuantity:50,unitCostCny:3.6,included:true},{...model.emptyOptionInput('b'),unitCostCny:5.5,unitsPerPack:2}];
 const props={productId:'p',rows:original,images:[],selected:['a'],onSelect:ids=>{props.selected=ids;},policy:{exchangeRate:350,supplyMargin:50,coupangMargin:40,minimumMargin:3000,msrpMultiple:1.3,roundingUnit:10,roundingMode:'nearest'},onApply:rows=>{props.rows=rows;applied++;}};
 const render=()=>{si=0;ri=0;const tree=component(props);if(first){first=false;effects.forEach(fn=>cleanups.push(fn()));}return tree;};
 const button=label=>nodes(render()).find(n=>n.type==='button'&&n.props.children===label);
 const input=label=>nodes(render()).find(n=>n.props['aria-label']===label);
 const operation=()=>nodes(render()).find(n=>n.type==='select');
 return {render,props,original,requests,button,input,operation,load,get applied(){return applied;},unmount(){cleanups.forEach(fn=>fn?.());}};
}

test('automatic bundle UI loads only criteria, previews frozen-price quantities, cancels and applies without saving',async()=>{
 const h=harness(async()=>Response.json({settings:{bundleCriterion:'coupangMargin',bundleMinimumSupplyMargin:3000,bundleMinimumCoupangMargin:9000,exchangeRate:999,supplyMargin:5,coupangMargin:5,roundingUnit:1000}}));
 h.operation().props.onChange({target:{value:'autoBundle'}});
 h.button('저장한 번들 기준 불러오기').props.onClick();await settle();
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/settings');assert.equal(h.requests[0].init.method,undefined);
 assert.equal(h.input('번들 수량 기준').props.value,'coupangMargin');assert.equal(h.input('번들 최소 쿠팡 마진액').props.value,'9000');
 assert.equal(h.props.rows,h.original);assert.equal(h.props.policy.exchangeRate,350);
 h.button('변경 미리보기').props.onClick();h.button('미리보기 취소').props.onClick();assert.equal(h.applied,0);assert.equal(h.props.rows,h.original);
 h.button('변경 미리보기').props.onClick();h.input('번들 최소 쿠팡 마진액').props.onChange({target:{value:'4000'}});assert.equal(h.button('편집 내용에 적용'),undefined);
 h.button('변경 미리보기').props.onClick();h.button('편집 내용에 적용').props.onClick();
 assert.equal(h.applied,1);assert.equal(h.props.rows[0].unitsPerPack,3);assert.equal(h.props.rows[1].unitsPerPack,2);
 for(const key of ['id','translatedName','supplierSku','stock','minimumOrderQuantity','size','imageKey'])assert.equal(h.props.rows[0][key],h.original[0][key]);
 assert.equal(h.requests.length,1,'applying a preview does not save or refetch the product');
 h.button('최근 일괄 변경 되돌리기').props.onClick();assert.deepEqual(JSON.parse(JSON.stringify(h.props.rows)),JSON.parse(JSON.stringify(h.original)));
});

test('reading bundle defaults blocks duplicate reads and stale control clicks; failure and unmount preserve entered criteria',async()=>{
 let finish;const h=harness(()=>new Promise(resolve=>{finish=resolve;}));
 h.operation().props.onChange({target:{value:'autoBundle'}});
 h.input('번들 최소 공급 마진액').props.onChange({target:{value:'5000'}});
 const staleInput=h.input('번들 최소 공급 마진액').props.onChange,stalePreview=h.button('변경 미리보기').props.onClick,read=h.button('저장한 번들 기준 불러오기').props.onClick;
 read();read();staleInput({target:{value:'1000'}});stalePreview();
 assert.equal(h.requests.length,1);assert.equal(h.input('번들 최소 공급 마진액').props.value,'5000');assert.equal(h.button('편집 내용에 적용'),undefined);
 finish(Response.json({error:'일시적 읽기 실패'},{status:503}));await settle();
 assert.equal(h.input('번들 최소 공급 마진액').props.value,'5000');assert.ok(nodes(h.render()).some(n=>n.props.role==='alert'));
 h.button('변경 미리보기').props.onClick();h.button('편집 내용에 적용').props.onClick();assert.equal(h.props.rows[0].unitsPerPack,5,'read failure did not discard explicit criteria');
 h.button('저장한 번들 기준 불러오기').props.onClick();h.unmount();assert.equal(h.requests[1].init.signal.aborted,true);
 finish(Response.json({settings:{bundleCriterion:'coupangMargin',bundleMinimumSupplyMargin:9000,bundleMinimumCoupangMargin:9000}}));await settle();
 assert.equal(h.input('번들 수량 기준').props.value,'supplyMargin');assert.equal(h.input('번들 최소 공급 마진액').props.value,'5000');assert.equal(h.applied,1);
});
