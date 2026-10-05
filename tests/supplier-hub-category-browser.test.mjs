import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url),plain=value=>JSON.parse(JSON.stringify(value));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
const root={categoryId:'100',name:'시험 대분류',isLeaf:false},child={categoryId:'200',name:'시험 최종분류',isLeaf:true};
const company={code:'A01464742',name:'와이홉'};
function harness(reply){
  const slots=[],effects=[],cleanup=[],calls=[],selected=[];let cursor=0,closed=false,late=0;
  const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return[slots[index],value=>{if(closed)late++;slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useCallback(fn,deps){const index=cursor++,previous=slots[index];if(!previous||deps.some((dep,i)=>dep!==previous.deps[i]))slots[index]={fn,deps};return slots[index].fn;},useEffect(fn,deps){const index=cursor++,previous=slots[index];if(!previous||deps.some((dep,i)=>dep!==previous[i])){slots[index]=deps;effects.push(fn);}}};
  const cache=new Map();
  function load(file){const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,Date,AbortController,TextDecoder,require:name=>{
    if(name==='react')return hooks;
    if(name==='@/app/supplier-hub-handoff')return{exchange:async(type,payload,signal)=>{calls.push({type,payload:plain(payload),signal});if(type==='PING')return{categoryCatalog:true};const trail=payload.trail;const branch={trail,children:trail.length?[child]:[root],ownerId:'owner',company,source:'supplier-hub-category-api',fullCatalogVerified:false,observedAt:Date.now()};return reply?reply(branch,signal,calls):{branch};}};
    if(name.startsWith('@/'))return cache.get(name.slice(2)+'.ts')??load(name.slice(2)+'.ts');return native(name);
  }});return exports;}
  const Component=load('app/components/supplier-hub-category-browser.tsx').SupplierHubCategoryBrowser,props={disabled:false,onChoice:choice=>selected.push(plain(choice)),onNavigating(){}};
  const render=()=>{cursor=0;const tree=Component(props);while(effects.length){const fn=effects.shift();const dispose=fn();if(dispose)cleanup.push(dispose);}return tree;};
  const click=name=>{const button=nodes(render()).find(node=>node.type==='button'&&nodes(node).some(part=>part.props?.children===name));assert.ok(button,'Button unavailable: '+name);assert.equal(button.props.disabled,false);return button.props.onClick();};
  return{render,click,calls,selected,get late(){return late;},close(){closed=true;cleanup.forEach(dispose=>dispose());}};
}
test('live category browser reads children on selection and emits only the final exact code and breadcrumb',async()=>{
  const h=harness();h.render();await settle();h.render();assert.deepEqual(h.calls.filter(call=>call.type==='CATEGORIES').map(call=>call.payload.trail),[[]]);
  h.click(root.name);await settle();h.render();assert.equal(h.selected.length,0);assert.deepEqual(h.calls.at(-1).payload.trail,[root]);
  h.click(child.name);assert.equal(h.selected.length,1);assert.equal(h.selected[0].categoryId,child.categoryId);assert.deepEqual(h.selected[0].path,[root.name,child.name]);assert.equal(h.calls.filter(call=>call.type==='CATEGORIES').length,2);h.close();
});
test('failed child requests retry the same parent and member changes clear the old tree',async()=>{
  let failure=true;const h=harness(branch=>{if(branch.trail.length&&failure){failure=false;throw Error('목록 일시 오류');}return{branch};});h.render();await settle();h.render();h.click(root.name);await settle();h.render();assert.match(JSON.stringify(h.render()),/일시 오류/);
  h.click('다시 불러오기');await settle();h.render();assert.deepEqual(h.calls.filter(call=>call.type==='CATEGORIES').at(-1).payload.trail,[root]);h.click(child.name);assert.equal(h.selected.length,1);h.close();
  const changed=harness(branch=>({branch:{...branch,...(branch.trail.length?{ownerId:'other'}:{})}}));changed.render();await settle();changed.render();changed.click(root.name);await settle();assert.match(JSON.stringify(changed.render()),/회원 또는 회사가 변경/);assert.equal(changed.selected.length,0);assert.equal(nodes(changed.render()).filter(node=>node.type==='section').length,0);changed.close();
});
test('closing the product-add picker cancels the pending read and ignores a late category reply',async()=>{
  let finish;const h=harness(branch=>new Promise(resolve=>{finish=()=>resolve({branch});}));h.render();await settle();h.close();assert.equal(h.calls.at(-1).signal.aborted,true);finish();await settle();assert.equal(h.selected.length,0);assert.equal(h.late,0);
});
