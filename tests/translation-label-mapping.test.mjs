import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
function harness(){
 const slots=[],cache=new Map();let index=0;const applied=[];
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,structuredClone,Error,TextEncoder,require(name){if(name==='react')return{useState(initial){const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];}};if(name.startsWith('@/'))return load(name.slice(2)+'.ts');return native(name);}});return exports;}
 const content=load('app/product-content.ts').emptyProductContent('p');
 const job={productId:'p',productVersion:'v',status:'completed',review:{source:{attributes:[{name:'상품속성: 材质',value:'棉'}]}},result:{draft:{attributes:[{sourceIndex:0,name:'재질',value:'면'}]}}};
 const component=load('app/components/translation-label-mapping.tsx').TranslationLabelMappingEditor;
 return{applied,render(disabled=false){index=0;return component({content,job,version:'v',disabled,onApply:value=>applied.push(value)});}};
}
test('label UI preselects exact suggestions but saves only after review and preserves manual deselection',()=>{
 const h=harness();let tree=h.render();assert.equal(h.applied.length,0);assert.equal(nodes(tree).find(n=>n.type==='select').props.value,'material');
 assert.ok(nodes(tree).some(n=>n.type==='table'));nodes(tree).find(n=>n.type==='button').props.onClick();assert.equal(h.applied.length,1);assert.equal(h.applied[0][0].field,'material');
 nodes(tree).find(n=>n.type==='select').props.onChange({target:{value:''}});tree=h.render();assert.equal(nodes(tree).find(n=>n.type==='select').props.value,'');assert.equal(nodes(tree).find(n=>n.type==='button').props.disabled,true);
 nodes(tree).find(n=>n.type==='button').props.onClick();assert.equal(h.applied.length,1);
});
test('label UI refuses apply while another parent request is active',()=>{
 const h=harness();const tree=h.render(true);assert.equal(nodes(tree).find(n=>n.type==='fieldset').props.disabled,true);nodes(tree).find(n=>n.type==='button').props.onClick();assert.equal(h.applied.length,0);
});
