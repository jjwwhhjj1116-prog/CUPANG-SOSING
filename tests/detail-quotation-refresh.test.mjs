import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const file=fs.readFileSync(new URL('../app/components/dashboard-client.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('dashboard.tsx',file,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const part=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='DetailPanel');
function harness(rejectPrice=false){
 let revision=0,saved=0;const exports={};
 const names=['ProductContentEditor','ImageGenerationPanel','DocumentImagePanel','TranslationPanel','PriceEditor','ProductOptionsEditor','QuotationPanel','LegacyQuotePanel','AutomationPanel'];
 vm.runInNewContext(ts.transpileModule('export '+part.getText(ast),{fileName:'test.tsx',compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require,useState:()=>[revision,fn=>{revision=fn(revision);}],imageSteps:['대표 이미지','추가 이미지','상세 이미지'],savedPricePolicy:()=>({}),...Object.fromEntries(names.map(name=>[name,name]))});
 const render=()=>exports.DetailPanel({tab:'SEO',product:{id:'p',updated_at:'unchanged',image_keys:'[]'},settings:{},onSaved:()=>{saved++;},onSavePrice:async()=>{if(rejectPrice)throw Error('save failed');}});
 const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
 const component=(type)=>nodes(render()).find(n=>n.type===type);
 return {component,saves:()=>saved};
}
test('each saved source refreshes quotation even when the product timestamp stays unchanged',()=>{
 for(const [name,callback] of [['ProductContentEditor','onSaved'],['ProductOptionsEditor','onSaved'],['DocumentImagePanel','onSaved'],['ImageGenerationPanel','onProductChanged'],['TranslationPanel','onContentSaved']]){
  const h=harness(),before=h.component('QuotationPanel').props.refreshToken;
  h.component(name).props[callback]();
  assert.notEqual(h.component('QuotationPanel').props.refreshToken,before,name);assert.equal(h.saves(),1);
 }
});
test('price save refreshes quotation only after success and never on rejection',async()=>{
 for(const failure of [false,true]){
  const h=harness(failure),before=h.component('QuotationPanel').props.refreshToken;
  const save=h.component('PriceEditor').props.onSave({});
  assert.equal(h.component('QuotationPanel').props.refreshToken,before);
  if(failure){await assert.rejects(save,/save failed/);assert.equal(h.component('QuotationPanel').props.refreshToken,before);}
  else{await save;assert.notEqual(h.component('QuotationPanel').props.refreshToken,before);}
 }
});
