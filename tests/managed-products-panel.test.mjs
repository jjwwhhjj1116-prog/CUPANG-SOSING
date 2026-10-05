import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {managedProductHarness,managedFixture,managedHeaders} from './helpers/managed-products.mjs';
const native=createRequire(import.meta.url),nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>typeof tree==='string'||typeof tree==='number'?String(tree):Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):'';
function ui(fetcher){
 const slots=[],effects=[],cleanups=new Map();let cursor=0;
 const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return[slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useEffect(fn,deps){const index=cursor++,prior=slots[index];if(!prior||deps.some((dep,i)=>dep!==prior[i])){slots[index]=deps;effects.push(()=>{cleanups.get(index)?.();cleanups.set(index,fn());});}}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/managed-products-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,URL,URLSearchParams,FormData,AbortController,Error,queueMicrotask,fetch:fetcher,require:name=>name==='react'?hooks:name.endsWith('.css')?{}:native(name)});
 const render=()=>{cursor=0;const tree=exports.ManagedProductsPanel();while(effects.length)effects.shift()();return tree;};
 return{render,async settle(){for(let i=0;i<12;i++){render();await new Promise(resolve=>setImmediate(resolve));}},close(){for(const cleanup of cleanups.values())cleanup?.();},button(label){const result=nodes(render()).find(n=>n.type==='button'&&text(n)===label);assert.ok(result,'missing button '+label);return result;}};
}
test('actual component previews owner file, requires company confirmation, imports once and exposes every exported field',async()=>{
 const h=managedProductHarness(),panel=ui(h.fetcher);try{
  await panel.settle();const file=new File([managedFixture(3,rows=>{rows[0].latestImportPrice='0';rows[0].priceHistory='[{"price":8000}]';rows[0]['판매링크']='javascript:alert(1)';})],'상품DB.xlsx');
  nodes(panel.render()).find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[file]}});
  const previewButton=panel.button('파일 미리보기');previewButton.props.onClick();previewButton.props.onClick();await panel.settle();
  assert.equal(h.state.calls.filter(c=>c.method==='POST').length,1);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_products').get().n,0);
  assert.equal(panel.button('상품 DB 3개 가져오기').props.disabled,true);
  const companyCheck=nodes(panel.render()).find(n=>n.type==='label'&&text(n).includes('이 파일은 와이홉'));nodes(companyCheck).find(n=>n.type==='input').props.onChange({target:{checked:true}});
  const importButton=panel.button('상품 DB 3개 가져오기');assert.equal(importButton.props.disabled,false);importButton.props.onClick();importButton.props.onClick();await panel.settle();
  assert.equal(h.state.calls.filter(c=>c.method==='POST').length,2);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM managed_products').get().n,3);
  const tree=panel.render();assert.match(text(tree),/신규 3개/);assert.match(text(tree),/2026-08-07/);assert.ok(!nodes(tree).some(n=>n.type==='a'&&n.props.href?.startsWith('javascript:')));
  const columnBox=nodes(tree).find(n=>n.props?.className==='managed-columns'),labels=nodes(columnBox).filter(n=>n.type==='label').map(text);
  assert.deepEqual(new Set([...labels,'상품명','썸네일']),new Set(managedHeaders));
  const historyLabel=nodes(columnBox).find(n=>n.type==='label'&&text(n)==='priceHistory');nodes(historyLabel).find(n=>n.type==='input').props.onChange({target:{checked:true}});
  assert.ok(nodes(panel.render()).some(n=>n.type==='pre'&&text(n)==='[{"price":8000}]'));
 }finally{panel.close();h.close();}
});
