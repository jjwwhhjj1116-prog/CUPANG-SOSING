import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),turn=()=>new Promise(resolve=>setImmediate(resolve));
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
function fixture(fetcher){
 const states=[],effects=[],cleanups=[],calls=[],added=[];let cursor=0,first=true;
 const hooks={useState(initial){const index=cursor++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;return[states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];},useRef(initial){const index=cursor++;return states[index]??(states[index]={current:initial});},useEffect(fn){if(first)effects.push(fn);}};
 const events=new Map(),window={addEventListener:(type,fn)=>events.set(type,fn),removeEventListener:(type,fn)=>{if(events.get(type)===fn)events.delete(type);}},exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/source-inbox-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,Error,structuredClone,window,location:{origin:'https://app.test'},fetch:async(path,init)=>{calls.push({path,init});return fetcher(path,init);},require:name=>name==='react'?hooks:require(name)});
 const render=()=>{cursor=0;const tree=exports.SourceInboxPanel({ownerId:'owner',disabled:false,onAdd:item=>added.push(item)});effects.splice(0).forEach(fn=>cleanups.push(fn()));first=false;return tree;};
 return {calls,added,render,button:label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label),open:()=>render().props.onToggle({currentTarget:{open:true}}),close:()=>cleanups.forEach(fn=>fn?.())};
}
const item={id:'source',ownerId:'owner',company:{code:'A01464742',name:'와이홉'},issues:[],revision:1,snapshot:{sourceUrl:'https://detail.1688.com/offer/700000000001.html',offerId:'700000000001',title:'합성 상품',options:[{key:'black',name:'黑色'}],images:[{}]},reviewed:null};
test('inbox stays lazy, and adding a reviewed source delegates category selection without creating/updating a product',async()=>{
 const h=fixture(async()=>Response.json({ownerId:'owner',items:[item]}));try{
  h.render();assert.equal(h.calls.length,0);h.open();await turn();assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/source-inbox');
  const add=h.button('카테고리 선택·초안 작성');assert.equal(add.props.disabled,false);add.props.onClick();assert.equal(h.added.length,1);assert.equal(h.added[0].id,item.id);assert.equal(h.calls.length,1);assert.equal(h.calls.some(call=>call.init?.method==='POST'),false);
 }finally{h.close();}
});
test('closing the view aborts the pending load and cannot publish a late member response',async()=>{
 let release;const h=fixture(()=>new Promise(resolve=>{release=resolve;}));h.render();h.open();assert.equal(h.calls.length,1);h.close();assert.equal(h.calls[0].init.signal.aborted,true);release(Response.json({ownerId:'owner',items:[item]}));await turn();assert.equal(h.button('카테고리 선택·초안 작성'),undefined);assert.equal(h.added.length,0);
});
