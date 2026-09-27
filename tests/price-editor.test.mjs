import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const base={exchangeRate:200,supplyMargin:50,coupangMargin:40,minimumMargin:0,msrpMultiple:1.3,roundingUnit:10};
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
function harness(){
 const slots=[];let cursor=0,changed=false,initial={...base},fail=false;
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/price-editor.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,require(name){
  if(name==='react')return{useState(value){const i=cursor++;if(!(i in slots))slots[i]=value;return[slots[i],v=>{if(!Object.is(slots[i],v))changed=true;slots[i]=v;}];}};
  if(name==='@/app/components/option-quotation-prices')return{OptionQuotationPrices:()=>null};
  if(name==='@/app/components/option-price-preview')return{OptionPricePreview:()=>null};
  if(name==='@/app/pricing')return{calculatePrice:(_cost,p)=>({supplyPrice:p.exchangeRate,salePrice:1,msrp:1,costKrw:1830.5,marginKrw:2999.5,actualMargin:1})};
  return native(name);
 }});
 const render=()=>{let tree;for(let i=0;i<10;i++){cursor=0;changed=false;tree=exports.PriceEditor({initial,sourcePrice:2,onSave:async p=>{if(fail)throw Error('save failed');initial={...p};}});if(!changed)return tree;}throw Error('render loop');};
 return{render,update(p){initial=p;},fail(){fail=true;},input(){return nodes(render()).find(n=>n.type==='input');},reset(){return nodes(render()).find(n=>n.type==='button'&&n.props.type==='button');}};
}
test('price editor refreshes clean policy after an external update',()=>{
 const h=harness();assert.equal(h.input().props.value,200);h.update({...base,exchangeRate:350});assert.equal(h.input().props.value,350);assert.equal(h.reset(),undefined);
});
test('price editor preserves unsaved policy and supports explicit reload',()=>{
 const h=harness();h.input().props.onChange({target:{value:'275'}});h.update({...base,exchangeRate:350});assert.equal(h.input().props.value,275);assert.match(JSON.stringify(h.render()),/수정 중인 입력/);h.reset().props.onClick();assert.equal(h.input().props.value,350);assert.equal(h.reset(),undefined);
});
test('successful saves establish the new policy and failed saves keep the draft',async()=>{
 for(const fail of [false,true]){const h=harness();h.input().props.onChange({target:{value:'275'}});if(fail)h.fail();await h.render().props.onSubmit({preventDefault(){}});assert.equal(h.input().props.value,275);assert.match(JSON.stringify(h.render()),fail?/save failed/:/가격을 저장했습니다/);if(fail){h.update({...base,exchangeRate:350});assert.equal(h.input().props.value,275);assert.ok(h.reset());}}
});
test('equivalent rounding defaults do not create a false conflict',()=>{
 const h=harness();h.input().props.onChange({target:{value:'275'}});h.update({...base,roundingMode:'up'});assert.equal(h.input().props.value,275);assert.equal(h.reset(),undefined);
});

test('minimum margin toggle restores the edited amount and saves disabled policy as zero',async()=>{
 const h=harness();h.update({...base,minimumMargin:4500});h.render();
 const toggle=()=>nodes(h.render()).find(n=>n.type==='input'&&n.props.type==='checkbox');
 const minimum=()=>nodes(h.render()).find(n=>n.type==='label'&&n.props.children?.[0]?.props?.children==='최소 공급 마진 (원)').props.children[1];
 assert.equal(toggle().props.checked,true);
 minimum().props.onChange({target:{value:'5500'}});
 toggle().props.onChange({target:{checked:false}});
 assert.equal(minimum().props.value,0);assert.equal(toggle().props.checked,false);
 toggle().props.onChange({target:{checked:true}});assert.equal(minimum().props.value,5500);
 toggle().props.onChange({target:{checked:false}});await h.render().props.onSubmit({preventDefault(){}});
 assert.equal(minimum().props.value,0);assert.equal(h.render().props['data-workspace-dirty'],false);
});

test('margin and converted cost retain the fractional won instead of showing false minimum attainment',()=>{
 const text=JSON.stringify(harness().render());
 assert.match(text,/2,999.5원/);assert.match(text,/1,830.5원/);assert.doesNotMatch(text,/3,000원/);
});
