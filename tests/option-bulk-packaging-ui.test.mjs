import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
test('bulk packaging UI requires all measurements, invalidates edits and supports apply and undo without saving',()=>{
 const state=[],cache=new Map();let cursor=0,applied=0;
 const hooks={useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
 const code=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8')+(file.endsWith('product-options-editor.tsx')?'\nexport {OptionBulkTools};':'');
 vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,crypto,require:name=>name==='react'?hooks:name.startsWith('@/')?load(name.slice(2)+(name.includes('/components/')?'.tsx':'.ts')):native(name)});return exports;
 }
 const model=load('app/product-options.ts');const component=load('app/components/product-options-editor.tsx').OptionBulkTools;
 const original=[{...model.emptyOptionInput('a'),originalName:'옵션',included:true,unitCostCny:2}];
 const props={rows:original,images:[],selected:['a'],onSelect:()=>{},policy:{exchangeRate:100,supplyMargin:0,coupangMargin:0,minimumMargin:0,msrpMultiple:1,roundingUnit:1},onApply:rows=>{props.rows=rows;applied++;}};
 const render=()=>{cursor=0;return component(props);};
 const click=text=>{const button=nodes(render()).find(n=>n.type==='button'&&n.props.children===text);assert.ok(button,text);button.props.onClick();};
 const change=(label,value)=>nodes(render()).find(n=>n.type==='input'&&n.props['aria-label']===label).props.onChange({target:{value}});
 nodes(render()).find(n=>n.type==='select').props.onChange({target:{value:'packaging'}});
 click('변경 미리보기');assert.equal(applied,0);assert.ok(nodes(render()).some(n=>n.props?.role==='alert'));
 for(const [label,value] of [['포장 무게 g','480'],['포장 가로 mm','400'],['포장 세로 mm','320'],['포장 높이 mm','90']])change('일괄 '+label,value);
 click('변경 미리보기');change('일괄 포장 무게 g','500');assert.ok(!nodes(render()).some(n=>n.type==='button'&&n.props.children==='편집 내용에 적용'));
 click('변경 미리보기');click('편집 내용에 적용');assert.equal(applied,1);assert.equal(props.rows[0].packagedWeightG,500);assert.equal(props.rows[0].packagingConfirmed,true);
 click('최근 일괄 변경 되돌리기');assert.equal(applied,2);assert.deepEqual(JSON.parse(JSON.stringify(props.rows)),JSON.parse(JSON.stringify(original)));
});
