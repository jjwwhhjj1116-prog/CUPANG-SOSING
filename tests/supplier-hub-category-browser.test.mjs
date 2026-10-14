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
function harness(reply,{mockRefs=false}={}){
  const slots=[],effects=[],cleanup=[],calls=[],selected=[],focused=[],revealed=[];let cursor=0,closed=false,late=0;
  const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return[slots[index],value=>{if(closed)late++;slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useCallback(fn,deps){const index=cursor++,previous=slots[index];if(!previous||deps.some((dep,i)=>dep!==previous.deps[i]))slots[index]={fn,deps};return slots[index].fn;},useEffect(fn,deps){const index=cursor++,previous=slots[index];if(!previous||deps.some((dep,i)=>dep!==previous[i])){slots[index]=deps;effects.push(fn);}}};
  const cache=new Map();
  function load(file){const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,Date,AbortController,TextDecoder,require:name=>{
    if(name==='react')return hooks;
    if(name==='@/app/supplier-hub-handoff')return{exchange:async(type,payload,signal)=>{calls.push({type,payload:plain(payload),signal});if(type==='PING')return{categoryCatalog:true};const trail=payload.trail;const branch={trail,children:trail.length?[child]:[root],ownerId:'owner',company,source:'supplier-hub-category-api',fullCatalogVerified:false,observedAt:Date.now()};return reply?reply(branch,signal,calls):{branch};}};
    if(name.startsWith('@/'))return cache.get(name.slice(2)+'.ts')??load(name.slice(2)+'.ts');return native(name);
  }});return exports;}
  const Component=load('app/components/supplier-hub-category-browser.tsx').SupplierHubCategoryBrowser,props={disabled:false,onChoice:choice=>selected.push(plain(choice)),onNavigating(){}};
  const render=()=>{cursor=0;const tree=Component(props);if(mockRefs)for(const node of nodes(tree))if(typeof node.props?.ref==='function'){
    if(node.type==='section')node.props.ref({scrollIntoView:options=>revealed.push({column:node.props['aria-label'],options:plain(options)})});
    if(node.type==='button')node.props.ref({focus:options=>focused.push({name:nodes(node).find(part=>part.type==='span')?.props.children,options:plain(options)})});
  }while(effects.length){const fn=effects.shift();const dispose=fn();if(dispose)cleanup.push(dispose);}return tree;};
  const click=name=>{const button=nodes(render()).find(node=>node.type==='button'&&nodes(node).some(part=>part.props?.children===name));assert.ok(button,'Button unavailable: '+name);assert.equal(button.props.disabled,false);return button.props.onClick();};
  const key=(name,value,modifiers={})=>{const button=nodes(render()).find(node=>node.type==='button'&&nodes(node).some(part=>part.props?.children===name));assert.ok(button,'Keyboard target unavailable: '+name);let prevented=false;button.props.onKeyDown({key:value,altKey:false,ctrlKey:false,metaKey:false,...modifiers,preventDefault(){prevented=true;}});return prevented;};
  return{render,click,key,calls,selected,focused,revealed,setProps(patch){Object.assign(props,patch);render();},get late(){return late;},close(){closed=true;cleanup.forEach(dispose=>dispose());}};
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

test('deep hierarchy retains its selected ancestors and replaces only descendants after a sibling choice',async()=>{
  const other={categoryId:'101',name:'다른 대분류',isLeaf:false},middle={categoryId:'110',name:'첫 중분류',isLeaf:false},second={categoryId:'210',name:'둘째 중분류',isLeaf:false},leaf={categoryId:'111',name:'첫 최종분류',isLeaf:true},otherLeaf={categoryId:'211',name:'둘째 최종분류',isLeaf:true};
  const h=harness(branch=>({branch:{...branch,children:branch.trail.length===0?[root,other]:branch.trail.length===1?[branch.trail[0].categoryId===root.categoryId?middle:second]:[branch.trail[1].categoryId===middle.categoryId?leaf:otherLeaf]}}));
  h.render();await settle();h.click(root.name);await settle();h.click(middle.name);await settle();
  const columns=nodes(h.render()).filter(node=>node.type==='section');assert.equal(columns.length,3);
  const pressed=nodes(h.render()).filter(node=>node.type==='button'&&node.props['aria-pressed']).map(node=>nodes(node).find(part=>part.type==='span')?.props.children);
  assert.deepEqual(pressed,[root.name,middle.name]);assert.equal(h.selected.length,0);
  const stale=nodes(h.render()).find(node=>node.type==='button'&&nodes(node).some(part=>part.props?.children===leaf.name)).props.onClick;
  h.click(other.name);await settle();assert.equal(nodes(h.render()).filter(node=>node.type==='section').length,2);
  const before=h.calls.length;stale();assert.equal(h.calls.length,before);assert.equal(h.selected.length,0,'a removed child branch cannot emit an old leaf');
  h.click(second.name);await settle();h.click(otherLeaf.name);
  assert.deepEqual(h.selected[0].path,[other.name,second.name,otherLeaf.name]);assert.equal(h.selected[0].categoryId,otherLeaf.categoryId);
  assert.deepEqual(h.selected[0].supplierHub.trail,[other,second]);h.close();
});

test('keyboard navigation reveals adjacent columns without choosing a leaf or repeating a child lookup',async()=>{
  const other={categoryId:'101',name:'둘째 대분류',isLeaf:false},secondLeaf={categoryId:'201',name:'둘째 최종분류',isLeaf:true};
  const h=harness(branch=>({branch:{...branch,children:branch.trail.length?[child,secondLeaf]:[root,other]}}),{mockRefs:true});
  h.render();await settle();h.render();assert.equal(h.focused.length,0,'initial loading does not steal focus');
  assert.equal(h.key(root.name,'ArrowDown'),true);assert.equal(h.focused.at(-1).name,other.name);
  assert.equal(h.key(other.name,'Home'),true);assert.equal(h.focused.at(-1).name,root.name);
  assert.equal(h.key(root.name,'End'),true);assert.equal(h.focused.at(-1).name,other.name);
  assert.equal(h.key(other.name,'ArrowRight'),true);await settle();h.render();
  assert.equal(h.focused.at(-1).name,child.name);assert.equal(h.revealed.at(-1).column,'2단계 카테고리');assert.equal(h.selected.length,0);
  const reads=h.calls.filter(call=>call.type==='CATEGORIES').length;
  h.key(child.name,'ArrowDown');assert.equal(h.focused.at(-1).name,secondLeaf.name);
  h.key(secondLeaf.name,'ArrowLeft');assert.equal(h.focused.at(-1).name,other.name);
  h.key(other.name,'ArrowRight');assert.equal(h.focused.at(-1).name,child.name);assert.equal(h.calls.filter(call=>call.type==='CATEGORIES').length,reads);
  assert.equal(h.key(child.name,'ArrowRight'),false,'arrow navigation alone never confirms a final category');assert.equal(h.selected.length,0);
  assert.equal(h.key(child.name,'ArrowDown',{ctrlKey:true}),false,'browser keyboard combinations stay native');
  const stops=nodes(h.render()).filter(node=>node.type==='button'&&node.props.tabIndex===0);assert.equal(stops.length,2,'each column has one normal Tab entry');
  assert.equal(stops[0].props['aria-pressed'],true);assert.equal(stops[1].props['aria-pressed'],false);
  h.click(child.name);assert.equal(h.selected.length,1);assert.equal(nodes(h.render()).filter(node=>node.type==='button'&&node.props['aria-pressed']).length,2);
  h.close();
});

test('a failed child read retains its ancestor columns and retry uses only the same approved path',async()=>{
  const middle={categoryId:'110',name:'하위 중분류',isLeaf:false};let rejected=true;
  const h=harness(branch=>{
    if(branch.trail.length===2&&rejected){rejected=false;throw Error('중분류 요청 실패');}
    return{branch:{...branch,children:branch.trail.length===0?[root]:branch.trail.length===1?[middle]:[child]}};
  },{mockRefs:true});h.render();await settle();h.click(root.name);await settle();h.click(middle.name);await settle();
  assert.equal(nodes(h.render()).filter(node=>node.type==='section').length,2);assert.match(JSON.stringify(h.render()),/중분류 요청 실패/);
  h.click('다시 불러오기');await settle();h.render();assert.equal(nodes(h.render()).filter(node=>node.type==='section').length,3);
  assert.deepEqual(h.calls.filter(call=>call.type==='CATEGORIES').map(call=>call.payload.trail),[[],[root],[root,middle],[root,middle]]);
  assert.equal(h.selected.length,0);h.close();
});

test('refreshed company identity cannot reactivate a retained leaf handler',async()=>{
  let changed=false;const nextCompany={code:'A01526306',name:'유앤채'};
  const h=harness(branch=>({branch:{...branch,company:changed?nextCompany:company}}));h.render();await settle();h.click(root.name);await settle();
  const old=nodes(h.render()).find(node=>node.type==='button'&&nodes(node).some(part=>part.props?.children===child.name)).props.onClick;
  changed=true;h.click('카테고리 목록 새로고침');await settle();const count=h.calls.length;old();assert.equal(h.selected.length,0);assert.equal(h.calls.length,count);
  h.click(root.name);await settle();h.click(child.name);assert.deepEqual(h.selected[0].supplierHub.company,nextCompany);h.close();
});

test('same-tick repeated child navigation issues one request and a late cancelled child cannot publish',async()=>{
  let finish;const h=harness(branch=>branch.trail.length?new Promise(resolve=>{finish=()=>resolve({branch});}):{branch},{mockRefs:true});
  h.render();await settle();const button=nodes(h.render()).find(node=>node.type==='button'&&nodes(node).some(part=>part.props?.children===root.name));
  button.props.onClick();button.props.onClick();button.props.onKeyDown({key:'ArrowRight',preventDefault(){assert.fail('pending navigation must not handle another key');}});
  await settle();assert.equal(h.calls.filter(call=>call.type==='CATEGORIES').length,2,'one root and one child lookup');assert.equal(h.selected.length,0);
  const before=h.focused.length;h.close();assert.equal(h.calls.at(-1).signal.aborted,true);finish();await settle();
  assert.equal(h.focused.length,before);assert.equal(h.selected.length,0);assert.equal(h.late,0);
});

test('disabled or unmounted navigation cannot start a read, move focus or confirm a retained leaf',async()=>{
  const h=harness(undefined,{mockRefs:true});h.render();await settle();h.click(root.name);await settle();
  const leaf=nodes(h.render()).find(node=>node.type==='button'&&nodes(node).some(part=>part.props?.children===child.name)),callback=leaf.props.onClick,key=leaf.props.onKeyDown;
  h.setProps({disabled:true});const before=h.calls.length,focus=h.focused.length;
  h.key(child.name,'ArrowUp');assert.equal(h.calls.length,before);assert.equal(h.focused.length,focus);assert.equal(h.selected.length,0);
  h.close();callback();key({key:'Home',preventDefault(){assert.fail('a closed category tree has no keyboard action');}});
  assert.equal(h.selected.length,0);assert.equal(h.calls.length,before);assert.equal(h.late,0);
});
