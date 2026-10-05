import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);

// Actual settings form, configured-ratio display and compound-price preview.
// Saves are captured at the parent boundary; no account settings are written.
function harness(overrides={}){
 const cache=new Map(),instances=new Map(),saves=[];let active,closed=0;
 const hooks={useRef(initial){const index=active.index++;return active.slots[index]??(active.slots[index]={current:initial});},useState(initial){const index=active.index++,slots=active.slots;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,require(name){if(name==='react')return hooks;if(name.startsWith('@/')){const path=name.slice(2);return load(path+(path.includes('/components/')?'.tsx':'.ts'));}return native(name);}});return exports;}
 const initial={...load('app/workspace-settings.ts').newWorkspaceSettings,...overrides};
 const Editor=load('app/components/workspace-settings-editor.tsx').WorkspaceSettingsEditor;
 function expand(tree){
  if(Array.isArray(tree))return tree.map(expand);if(!tree||typeof tree!=='object')return tree;
  if(typeof tree.type==='function'){const instance=instances.get(tree.type)??{slots:[]};instances.set(tree.type,instance);instance.index=0;active=instance;return expand(tree.type(tree.props));}
  return{...tree,props:{...tree.props,children:expand(tree.props?.children)}};
 }
 const render=()=>expand({type:Editor,props:{value:initial,onSave:async value=>saves.push(value),onClose:()=>closed++}});
 const control=label=>{const all=nodes(render()),named=all.find(node=>node.props?.['aria-label']===label);if(named)return named;const parent=all.find(node=>node.type==='label'&&nodes(node.props.children).some(child=>child.type==='span'&&child.props.children===label));assert.ok(parent,'label '+label);return nodes(parent).find(node=>['input','select','textarea'].includes(node.type));};
 return{initial,saves,render,control,get closed(){return closed;},ratios:()=>nodes(render()).filter(node=>node.props?.role==='progressbar').map(node=>node.props['aria-valuenow']),
  button:label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label),edit(label,value){control(label).props.onChange({target:typeof value==='boolean'?{checked:value}:{value:String(value)}});},
  save:()=>render().props.onSubmit({preventDefault(){}})};
}

test('four settings cards keep registration and pricing first while the same controls preserve explicit saved values',async()=>{
 for(const action of ['cancel','save']){
 const h=harness({brand:'직접 입력 브랜드',manufacturer:'제조사 확인값',boxSkuQuantity:7,roundingMode:'up',topImageEnabled:true,topImageKey:'owner/selected-banner.png',washingMethod:'손세탁'}),before=JSON.stringify(h.initial);
 const sections=h.render().props.children.filter(node=>node?.type==='section');
 assert.deepEqual(Array.from(sections,node=>text(nodes(node).find(child=>child.type==='h3'))),['기본 등록 정보','가격설정 방법','이미지 작업 설정','AI 설정']);
 const details=nodes(h.render()).filter(node=>node.type==='details');
 assert.ok(details.some(node=>text(node.props.children[0]).startsWith('추가 설정')&&!node.props.open));
 assert.ok(details.some(node=>text(node.props.children[0]).includes('세부 미리보기')&&!node.props.open));
 assert.deepEqual(h.ratios(),[10,50,40]);
 h.edit('브랜드명','');h.edit('제조사','');h.edit('유통기간 · 식품의 경우 소비기간 (일)','');h.edit('과세여부','');h.edit('상단 이미지 사용',false);
 h.edit('공급 마진율 (%) 조절',55);assert.equal(h.control('공급 마진율 (%)').props.value,55);assert.deepEqual(h.ratios(),[5,55,40]);
 h.edit('쿠팡 마진율 (%)',30);assert.equal(h.control('쿠팡 마진율 (%) 조절').props.value,30);
 h.edit('세탁방법','');h.edit('최소 공급 마진 보장',false);h.edit('비노출속성 자동 생성',true);
 if(action==='cancel'){h.button('취소').props.onClick();assert.equal(h.closed,1);assert.equal(h.saves.length,0);assert.equal(JSON.stringify(h.initial),before);continue;}
 await h.save();const saved=h.saves[0];
 for(const key of ['brand','manufacturer','taxType','washingMethod'])assert.equal(saved[key],'',key);
 assert.equal(saved.shelfLifeDays,null);assert.equal(saved.boxSkuQuantity,7);assert.equal(saved.roundingMode,'up');
 assert.equal(saved.supplyMargin,55);assert.equal(saved.coupangMargin,30);assert.equal(saved.minimumMarginEnabled,false);assert.equal(saved.minimumMargin,3000);
 assert.equal(saved.topImageEnabled,false);assert.equal(saved.topImageKey,'owner/selected-banner.png');assert.equal(saved.hiddenAttributes,true);
 assert.equal(JSON.stringify(h.initial),before);
 }
});

test('display-only ratio handles unfinished and overlapping margins without changing save validation',async()=>{
 const h=harness();h.edit('공급 마진율 (%)','');assert.equal(h.control('공급 마진율 (%)').props.value,'');assert.deepEqual(h.ratios(),[]);
 await h.save();assert.equal(h.saves.length,0);assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'));
 h.edit('공급 마진율 (%)',70);h.edit('쿠팡 마진율 (%)',40);assert.deepEqual(h.ratios(),[]);
 await h.save();assert.equal(h.saves.length,1);assert.equal(h.saves[0].supplyMargin,70);assert.equal(h.saves[0].coupangMargin,40);
 h.edit('공급 마진율 (%)',-1);assert.deepEqual(h.ratios(),[]);await h.save();assert.equal(h.saves.length,1);
 h.edit('공급 마진율 (%)',50);assert.deepEqual(h.ratios(),[10,50,40]);
 assert.equal(h.initial.brand,'');assert.equal(h.initial.manufacturer,'');assert.equal(h.initial.boxSkuQuantity,1);
});

test('configured ratio stays 10/50/40 while the retained price preview uses unchanged compound arithmetic',()=>{
 const h=harness();assert.deepEqual(h.ratios(),[10,50,40]);
 const cost=()=>nodes(h.render()).find(node=>node.type==='label'&&text(node.props.children[0])==='미리보기 원가 (CNY)').props.children[1];
 const preview=()=>nodes(h.render()).find(node=>node.props?.['aria-label']==='기본 가격 미리보기');
 for(const [value,amounts]of [['5.23',['4,830원','8,050원','10,470원']],['25.6',['17,920원','29,870원','38,830원']]]){
  cost().props.onChange({target:{value}});const rendered=text(preview());for(const amount of amounts)assert.ok(rendered.includes(amount),amount);
  assert.deepEqual(h.ratios(),[10,50,40]);
 }
 assert.equal(h.saves.length,0);
});
