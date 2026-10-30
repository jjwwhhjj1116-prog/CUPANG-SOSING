import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
function load(file,scope={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,...scope,require:name=>scope.overrides?.[name]??(name.startsWith('@/')?load(name.slice(2)+'.ts',scope):require(name))});return exports;}
const {matchesRegistrationColumnFilter:match,registrationFilterChoices:choices}=load('app/registration-column-filter.ts');
const native=value=>JSON.parse(JSON.stringify(value)),condition=(operator,value)=>({mode:'conditions',conditions:[{operator,value}]}),list=values=>({mode:'values',values});
test('value filters distinguish exact saved text, blank and explicit none and do not mutate data',()=>{
 const source=['입력됨','미입력','', '입력됨','SKU ID 확인'],before=JSON.stringify(source);
 assert.deepEqual(native(choices(source)),[{value:'',count:1},{value:'미입력',count:1},{value:'입력됨',count:2},{value:'SKU ID 확인',count:1}]);
 assert.equal(match('',list([''])),true);assert.equal(match('입력됨',list([])),false);assert.equal(match('입력됨',list(['입력'])),false);
 assert.equal(match('입력됨',undefined),true);assert.equal(match('SKU ID 확인',list(['SKU ID 확인'])),true);assert.equal(JSON.stringify(source),before);
});
test('two numeric image bounds are AND and unknown image counts do not become zero or completed',()=>{
 const filter={mode:'conditions',conditions:[{operator:'gte',value:'2'},{operator:'lte',value:'10장'}]};
 assert.equal(match('2장',filter,true),true);assert.equal(match('10장',filter,true),true);for(const value of ['0장','1장','11장','확인 필요',''])assert.equal(match(value,filter,true),false);
 assert.equal(match('2장',condition('eq','2'),true),true);assert.equal(match('2장',condition('ne','2장'),true),false);assert.equal(match('확인 필요',condition('eq','확인 필요'),true),true);
 assert.equal(match('0장',condition('gte',''),true),false);assert.equal(match('',condition('eq',''),true),true);
});
test('text and registration numbers support natural bounds and exact equality without regex interpretation',()=>{
 assert.equal(match('YP-10',condition('gte','YP-2')),true);assert.equal(match('YP-1',condition('gte','YP-2')),false);
 assert.equal(match('YP-10',condition('lte','YP-2')),false);assert.equal(match('가',condition('eq',' 가 ')),true);
 assert.equal(match('상품 (A)',condition('eq','상품 (A)')),true);assert.equal(match('상품 (A)',condition('eq','상품.*')),false);
});
function popupHarness(input={}){
 const values=[],effects=[],listeners=new Map(),removed=[],calls={apply:[],sort:[],close:0};let cursor=0;
 class Node{}
 const document={body:{},addEventListener:(name,handler)=>listeners.set(name,handler),removeEventListener:(name,handler)=>removed.push([name,handler])};
 const window={addEventListener:(name,handler)=>listeners.set(name,handler),removeEventListener:(name,handler)=>removed.push([name,handler])};
 const react={...require('react'),useState(initial){const at=cursor++;if(!(at in values))values[at]=typeof initial==='function'?initial():initial;return[values[at],next=>values[at]=typeof next==='function'?next(values[at]):next];},useRef(initial){const at=cursor++;if(!(at in values))values[at]={current:initial};return values[at];},useEffect(fn,deps){const at=cursor++;if(!(at in values)){values[at]=deps;effects.push(fn);}}};
 const {RegistrationFilterPopover:Popup}=load('app/components/registration-filter-popover.tsx',{document,window,Node,overrides:{react,'react-dom':{createPortal:tree=>tree}}});
 const props={label:'상품명',choices:[{value:'가',count:2},{value:'나',count:1},{value:'',count:1}],allValues:['가','나',''],position:{left:20,top:50},onApply:value=>calls.apply.push(native(value??null)),onSort:value=>calls.sort.push(value),onClose:()=>calls.close++, ...input};
 const cleanup=[];return{calls,listeners,Node,removed,props,render(){cursor=0;const tree=Popup(props);while(effects.length)cleanup.push(effects.shift()());return tree;},cleanup(){cleanup.forEach(fn=>fn?.());}};
}
function nodes(tree,predicate){const found=[];function visit(node){if(Array.isArray(node))return node.forEach(visit);if(!node||typeof node!=='object')return;if(predicate(node))found.push(node);visit(node.props?.children);}visit(tree);return found;}
const control=(tree,label)=>nodes(tree,node=>node.props?.['aria-label']===label)[0];
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):typeof node==='string'?node:'';
const button=(tree,label)=>nodes(tree,node=>node.type==='button'&&text(node)===label)[0];
test('searched value selection preserves invisible selected values and can exclude all visible values',()=>{
 const h=popupHarness();let tree=h.render();control(tree,'값 검색').props.onChange({target:{value:'가'}});tree=h.render();
 control(tree,'전체 2').props.onChange({target:{checked:false}});tree=h.render();button(tree,'적용').props.onClick();
 assert.deepEqual(h.calls.apply,[{mode:'values',values:['나','']}]);assert.equal(h.calls.close,0);
});
test('unchanged filter under another column or global search is not silently cleared',()=>{
 const h=popupHarness({choices:[{value:'가',count:1}],allValues:['가','나'],filter:list(['가'])});button(h.render(),'적용').props.onClick();
 assert.deepEqual(h.calls.apply,[{mode:'values',values:['가']}]);
 const all=popupHarness({choices:[{value:'가',count:1}],allValues:['가','나']});button(all.render(),'적용').props.onClick();assert.deepEqual(all.calls.apply,[null]);
});
test('condition tab edits require explicit apply, supports a blank equality and validates ranges',()=>{
 const h=popupHarness();let tree=h.render();button(tree,'조건').props.onClick();tree=h.render();control(tree,'조건 1').props.onChange({target:{value:'gte'}});tree=h.render();button(tree,'적용').props.onClick();
 assert.equal(h.calls.apply.length,0);assert.match(text(h.render()),/조건의 값을 입력/);
 control(h.render(),'조건 1 값').props.onChange({target:{value:'2'}});control(h.render(),'조건 2').props.onChange({target:{value:'lte'}});control(h.render(),'조건 2 값').props.onChange({target:{value:'10'}});button(h.render(),'적용').props.onClick();
 assert.deepEqual(h.calls.apply,[{mode:'conditions',conditions:[{operator:'gte',value:'2'},{operator:'lte',value:'10'}]}]);
 const blank=popupHarness({filter:condition('eq','')});button(blank.render(),'적용').props.onClick();assert.deepEqual(blank.calls.apply,[condition('eq','')]);
});
test('close, escape, outside click and scroll cancel pending filters while explicit clear and sort invoke only their callbacks',()=>{
 const h=popupHarness();const tree=h.render();control(tree,'상품명 열 필터 닫기').props.onClick();
 const inside=new h.Node();tree.props.ref.current={contains:node=>node===inside};h.listeners.get('mousedown')({target:inside});assert.equal(h.calls.close,1);
 h.listeners.get('mousedown')({target:new h.Node()});h.listeners.get('scroll')({target:inside});h.listeners.get('scroll')({target:new h.Node()});
 assert.equal(h.calls.close,3);assert.deepEqual(h.calls.apply,[]);
 const escape=popupHarness();escape.render();let prevented=false,stopped=false;escape.listeners.get('keydown')({key:'Escape',preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
 assert.equal(escape.calls.close,1);assert.equal(prevented,true);assert.equal(stopped,true);assert.deepEqual(escape.calls.apply,[]);escape.cleanup();
 button(tree,'해제').props.onClick();button(tree,'↑ 오름차순').props.onClick();button(tree,'↓ 내림차순').props.onClick();assert.deepEqual(h.calls.apply,[null]);assert.deepEqual(h.calls.sort,['ascending','descending']);
 h.cleanup();assert.equal(h.removed.length,7);
});
test('the same header trigger does not close on mousedown before its click can toggle the popover',()=>{
 const h=popupHarness(),trigger=new h.Node(),icon=new h.Node();trigger.contains=target=>target===trigger||target===icon;h.props.trigger=trigger;h.render();
 h.listeners.get('mousedown')({target:trigger});h.listeners.get('mousedown')({target:icon});assert.equal(h.calls.close,0);
 h.listeners.get('mousedown')({target:new h.Node()});assert.equal(h.calls.close,1);assert.deepEqual(h.calls.apply,[]);
});

test('filter focus can move among choices and its trigger; leaving cancels without applying the edited draft',()=>{
 const h=popupHarness(),inside=new h.Node(),second=new h.Node(),trigger=new h.Node();trigger.contains=target=>target===trigger;h.props.trigger=trigger;
 let tree=h.render();tree.props.ref.current={contains:target=>target===inside||target===second};control(tree,'가 2').props.onChange({target:{checked:false}});tree=h.render();
 h.listeners.get('focusout')({target:inside,relatedTarget:second});h.listeners.get('focusin')({target:second});h.listeners.get('focusout')({target:second,relatedTarget:trigger});h.listeners.get('focusin')({target:trigger});assert.equal(h.calls.close,0);
 h.listeners.get('focusin')({target:new h.Node()});assert.equal(h.calls.close,1);assert.deepEqual(h.calls.apply,[]);h.cleanup();
});
