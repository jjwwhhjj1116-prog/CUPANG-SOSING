import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/quotation-mapping-review.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require});
const render=exports.QuotationMappingReview;
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return[];return[tree,...nodes(tree.props?.children)];}
const findings=[{fieldId:'altText',label:'대체 텍스트',required:false,manualOptions:[{optionId:'red',optionLabel:'빨강'}],automaticOptions:[{optionId:'red',optionLabel:'빨강'},{optionId:'blue',optionLabel:'<script>파랑</script>'}]},{fieldId:'model',label:'모델명',required:true,manualOptions:[]}];
test('mapping findings open exact option and field, deduplicate references and retain empty-required common navigation',()=>{
 const before=JSON.stringify(findings);const targets=[];let managed=0;
 const tree=render({findings,disabled:false,onInspect:target=>targets.push(target),onManage:()=>managed++});
 const buttons=nodes(tree).filter(n=>n.type==='button');assert.equal(buttons.length,4);
 buttons.forEach(button=>button.props.onClick());
 assert.deepEqual(JSON.parse(JSON.stringify(targets)),[{optionId:'red',fieldId:'altText'},{optionId:'blue',fieldId:'altText'},{optionId:null,fieldId:'model'}]);assert.equal(managed,1);
 const html=renderToStaticMarkup(tree);assert.match(html,/&lt;script&gt;파랑&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>/);
 assert.equal(JSON.stringify(findings),before);
});
test('busy or unsaved mapping review cannot navigate or manage, and empty findings render nothing',()=>{
 let calls=0;const tree=render({findings,disabled:true,onInspect:()=>calls++,onManage:()=>calls++});
 for(const button of nodes(tree).filter(n=>n.type==='button')){assert.equal(button.props.disabled,true);button.props.onClick();}
 assert.equal(calls,0);assert.equal(render({findings:[],disabled:false,onInspect(){},onManage(){}}),null);
});
