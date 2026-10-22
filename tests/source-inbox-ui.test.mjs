import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {sourceReviewModule,reviewSourceFixture} from './helpers/source-review-intake.mjs';
const require=createRequire(import.meta.url),turn=()=>new Promise(resolve=>setImmediate(resolve));
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
function fixture(fetcher,{initialItem,onReviewed,onChanged,existingProducts=[]}={}){
 const states=[],effects=[],cleanups=[],calls=[],added=[];let cursor=0,first=true;
 let ownerId='owner';
 const hooks={useState(initial){const index=cursor++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;return[states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];},useRef(initial){const index=cursor++;return states[index]??(states[index]={current:initial});},useMemo(fn,deps){const index=cursor++,previous=states[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i])))states[index]={deps,value:fn()};return states[index].value;},useLayoutEffect(fn){effects.push(fn);},useEffect(fn){if(first)effects.push(fn);}};
 const events=new Map(),window={addEventListener:(type,fn)=>events.set(type,fn),removeEventListener:(type,fn)=>{if(events.get(type)===fn)events.delete(type);}},exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/source-inbox-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,Error,structuredClone,window,location:{origin:'https://app.test'},fetch:async(path,init)=>{calls.push({path,init});return fetcher(path,init);},require:name=>name==='react'?hooks:name.startsWith('@/app/')?sourceReviewModule(name.slice(2)+'.ts'):require(name)});
 const render=()=>{cursor=0;const tree=exports.SourceInboxPanel({ownerId,disabled:false,initialItem,onReviewed,onChanged,existingProducts,onAdd:item=>added.push(item)});effects.splice(0).forEach(fn=>cleanups.push(fn()));first=false;return tree;};
 return {calls,added,render,button:label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label),owner(value){ownerId=value;render();},open:()=>render().props.onToggle({currentTarget:{open:true}}),close:()=>cleanups.forEach(fn=>fn?.())};
}
const item={...reviewSourceFixture().before,issues:[]};

test('an existing same-offer product labels recapture as a separate draft and delegates only the exact selected item',()=>{
 const existingProducts=[{source_url:item.snapshot.sourceUrl+'?tracking=old'}],before=JSON.stringify(existingProducts),h=fixture(()=>assert.fail('choosing a capture does not fetch or write'),{initialItem:item,existingProducts});
 try{const add=h.button('카테고리 선택·별도 초안 작성');assert.ok(add);assert.equal(add.props.disabled,false);assert.match(text(h.render()),/기존 작업을 유지/);add.props.onClick();assert.deepEqual(h.added,[item]);assert.equal(h.calls.length,0);assert.equal(JSON.stringify(existingProducts),before);}finally{h.close();}
});
test('inbox stays lazy, and adding a reviewed source delegates category selection without creating/updating a product',async()=>{
 const h=fixture(async()=>Response.json({ownerId:'owner',items:[item]}));try{
  h.render();assert.equal(h.calls.length,0);h.open();await turn();assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/source-inbox');
  const add=h.button('카테고리 선택·초안 작성');assert.equal(add.props.disabled,false);add.props.onClick();assert.equal(h.added.length,1);assert.equal(h.added[0].id,item.id);assert.equal(h.calls.length,1);assert.equal(h.calls.some(call=>call.init?.method==='POST'),false);
 }finally{h.close();}
});
test('closing the view aborts the pending load and cannot publish a late member response',async()=>{
 let release;const h=fixture(()=>new Promise(resolve=>{release=resolve;}));h.render();h.open();assert.equal(h.calls.length,1);h.close();assert.equal(h.calls[0].init.signal.aborted,true);release(Response.json({ownerId:'owner',items:[item]}));await turn();assert.equal(h.button('카테고리 선택·초안 작성'),undefined);assert.equal(h.added.length,0);
});

test('a partial capture may choose a category before reviewing missing source facts',async()=>{
 const partial={...item,issues:['공급자 SKU','위안 원가']};
 const h=fixture(async()=>Response.json({ownerId:'owner',items:[partial]}));try{
  h.render();h.open();await turn();const button=h.button('카테고리 선택·초안 작성');
  assert.equal(button.props.disabled,false);button.props.onClick();assert.equal(h.added[0].id,partial.id);
  assert.equal(h.calls.length,1);assert.ok(h.calls.every(call=>!call.init.method));
 }finally{h.close();}
});

test('same-offer recaptures remain separate choices with their own source, revision and version label',async()=>{
 const previous={...structuredClone(item),id:'original',captureVersion:1,revision:3,receivedAt:'2026-10-20T00:00:00.000Z',fingerprint:'a'.repeat(64),reviewed:{...structuredClone(item.snapshot),title:'직접 검토한 이전 원문'}};
 const latest={...structuredClone(item),id:'recapture',captureVersion:2,revision:1,receivedAt:'2026-10-20T00:01:00.000Z',fingerprint:'b'.repeat(64),snapshot:{...structuredClone(item.snapshot),title:'새로 수집한 상품'}};
 const h=fixture(async()=>Response.json({ownerId:'owner',items:[latest,previous]}));try{
  h.render();h.open();await turn();const entries=nodes(h.render()).filter(node=>node.type==='li');assert.equal(entries.length,2);
  assert.match(text(entries[0]),/새로 수집한 상품.*수집본 2/);assert.match(text(entries[1]),/직접 검토한 이전 원문.*수집본 1/);
  for(const entry of [entries[1],entries[0]])nodes(entry).find(node=>node.type==='button'&&text(node)==='카테고리 선택·초안 작성').props.onClick();
  assert.deepEqual(h.added.map(value=>[value.id,value.revision,value.fingerprint]),[['original',3,'a'.repeat(64)],['recapture',1,'b'.repeat(64)]]);
  assert.equal(h.calls.length,1);assert.ok(h.calls.every(call=>!call.init?.method),'choosing a source does not write or replace either version');
 }finally{h.close();}
});

test('unknown supplier MOQ warns alongside draft readiness and continues to category selection with only a GET',async()=>{
 const warning='공급자 최소 주문 수량 미확인 · 초안 작성 후 가격 설정에서 확인하세요.';
 const unknown={...structuredClone(item),warnings:[warning],snapshot:{...structuredClone(item.snapshot),options:[{key:'black',name:'黑色',supplierSku:'supplier-black',unitPriceCny:2.99,currency:'CNY',minimumOrder:null,stock:null,imageUrl:null}]}};
 const h=fixture(async()=>Response.json({ownerId:'owner',items:[unknown]}));
 try{
  h.render();h.open();await turn();const view=text(h.render());assert.match(view,/상품정보 준비됨 · 견적서 전송 전 검토 필요/);assert.ok(view.includes(warning));assert.doesNotMatch(view,/전송 완료|접수 완료|등록 완료/);
  const button=h.button('카테고리 선택·초안 작성');assert.equal(button.props.disabled,false);button.props.onClick();
  assert.equal(h.added.length,1);assert.deepEqual(h.added[0],unknown);assert.equal(h.added[0].snapshot.options[0].minimumOrder,null);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/source-inbox');assert.equal(h.calls[0].init.method,undefined);
 }finally{h.close();}
});

test('review keeps MOQ blank as null without inventing required SKU, price or currency values',async()=>{
 const warning='공급자 최소 주문 수량 미확인 · 초안 작성 후 가격 설정에서 확인하세요.';
 const unknown={...structuredClone(item),warnings:[warning],snapshot:{...structuredClone(item.snapshot),options:[{key:'black',name:'黑色',supplierSku:'supplier-black',unitPriceCny:2.99,currency:'CNY',minimumOrder:null,stock:null,imageUrl:null}]}};
 let payload;
 const h=fixture(async(_path,init)=>{if(init.method==='PUT'){payload=JSON.parse(init.body);return Response.json({ownerId:'owner',item:{...unknown,revision:2,reviewed:{...unknown.snapshot,options:unknown.snapshot.options.map(row=>({...row,...payload.review.options.find(option=>option.key===row.key)}))}}});}
  return Response.json({ownerId:'owner',items:[unknown]});});
 try{
  h.render();h.open();await turn();h.button('상품정보 확인').props.onClick();
  const control=()=>nodes(h.render()).find(node=>node.props?.['aria-label']==='1번째 최소 주문 수량');assert.equal(control().props.value,'');assert.match(control().props.placeholder,/미확인.*공란/);
  assert.match(text(h.render()),/최소 주문 수량은 미확인이면 공란으로 두고 초안을 작성할 수 있습니다/);
  control().props.onChange({target:{value:'3'}});assert.equal(control().props.value,3);control().props.onChange({target:{value:''}});assert.equal(control().props.value,'');
  const save=h.button('검토한 상품정보 저장');assert.equal(save.props.disabled,false);save.props.onClick();await turn();
  assert.equal(payload.review.options[0].minimumOrder,null);assert.equal(payload.review.options[0].supplierSku,'supplier-black');assert.equal(payload.review.options[0].unitPriceCny,2.99);assert.equal(payload.review.options[0].currency,'CNY');
  assert.deepEqual(h.calls.map(call=>call.init.method??'GET'),['GET','PUT']);assert.equal(h.added.length,0);
 }finally{h.close();}
});

test('review UI delivers the strict saved acknowledgement before list refresh without creating a product',async()=>{
 const {before,saved}=reviewSourceFixture(),events=[];
 const h=fixture(async(_path,init)=>{assert.equal(init.method,'PUT');return Response.json({ownerId:'owner',item:saved});},
  {initialItem:before,onReviewed:(result,original)=>events.push({type:'reviewed',result,original}),onChanged:()=>events.push({type:'changed'})});
 try{h.button('검토한 상품정보 저장').props.onClick();await turn();assert.deepEqual(events.map(value=>value.type),['reviewed','changed']);
  assert.deepEqual(events[0].result,saved);assert.deepEqual(events[0].original,before);assert.equal(h.calls.length,1);assert.equal(h.added.length,0);assert.match(text(h.render()),/저장했습니다/);
 }finally{h.close();}
});

test('invalid review ACK cannot publish a callback, refresh the parent or close the review',async()=>{
 const {before,saved}=reviewSourceFixture();
 for(const patch of [{revision:3},{ownerId:'other'},{fingerprint:'b'.repeat(64)},{snapshot:{...saved.snapshot,title:'바뀐 최초 원문'}},{company:{code:'A01526306',name:'유앤채'}}]){
  const events=[],h=fixture(async()=>Response.json({ownerId:'owner',item:{...saved,...patch}}),{initialItem:before,onReviewed:()=>events.push('reviewed'),onChanged:()=>events.push('changed')});
  try{h.button('검토한 상품정보 저장').props.onClick();await turn();assert.deepEqual(events,[]);assert.ok(h.button('검토한 상품정보 저장'));assert.match(text(h.render()),/저장을 확인하지 못했습니다/);}
  finally{h.close();}
 }
});

test('old review handlers and responses cannot act after account changes or the review closes',async()=>{
 const {before,saved}=reviewSourceFixture(),events=[];let release;
 const h=fixture(()=>new Promise(resolve=>{release=resolve;}),{initialItem:before,onReviewed:()=>events.push('reviewed'),onChanged:()=>events.push('changed')});
 try{const save=h.button('검토한 상품정보 저장');save.props.onClick();h.owner('other');release(Response.json({ownerId:'owner',item:saved}));await turn();assert.deepEqual(events,[]);assert.equal(h.calls.length,1);
  save.props.onClick();assert.equal(h.calls.length,1);
 }finally{h.close();}
 const closed=fixture(async()=>{throw Error('no stale write');},{initialItem:before});try{const save=closed.button('검토한 상품정보 저장');closed.button('닫기').props.onClick();closed.render();save.props.onClick();assert.equal(closed.calls.length,0);}finally{closed.close();}
});
