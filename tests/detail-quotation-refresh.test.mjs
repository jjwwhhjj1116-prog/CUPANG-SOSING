import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const file=fs.readFileSync(new URL('../app/components/dashboard-client.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('dashboard.tsx',file,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const childModules=new Map(ast.statements.filter(node=>ts.isImportDeclaration(node)&&node.moduleSpecifier.text.startsWith('@/app/components/')).map(node=>{
 const exports={__esModule:true},clause=node.importClause;
 if(clause?.name)exports.default=clause.name.text;
 if(clause?.namedBindings&&ts.isNamedImports(clause.namedBindings))for(const item of clause.namedBindings.elements)if(!item.isTypeOnly)exports[item.propertyName?.text??item.name.text]=item.name.text;
 return [node.moduleSpecifier.text,exports];
}));
function harness(rejectPrice=false,props={}){
 let cursor=0,saved=0;const slots=[],effects=[],modules=new Map();
 const sameDeps=(before,after)=>Array.isArray(before)&&Array.isArray(after)&&before.length===after.length&&after.every((value,index)=>Object.is(value,before[index]));
 const hooks={
  useState(initial){const slot=cursor++;if(!(slot in slots))slots[slot]=typeof initial==='function'?initial():initial;return [slots[slot],next=>{slots[slot]=typeof next==='function'?next(slots[slot]):next;}];},
  useRef(initial){const slot=cursor++;return slots[slot]??(slots[slot]={current:initial});},
  useCallback(callback,deps){const slot=cursor++,previous=slots[slot];if(!previous||!sameDeps(previous.deps,deps))slots[slot]={value:callback,deps};return slots[slot].value;},
  useMemo(factory,deps){const slot=cursor++,previous=slots[slot];if(!previous||!sameDeps(previous.deps,deps))slots[slot]={value:factory(),deps};return slots[slot].value;},
  useEffect(effect,deps){const slot=cursor++,previous=slots[slot];if(!previous||!sameDeps(previous.deps,deps)){const entry={deps,cleanup:previous?.cleanup};slots[slot]=entry;effects.push(()=>{entry.cleanup?.();entry.cleanup=effect();});}},
 };
 // Run the real module and its pure imports. Child editors stay inert so these
 // callback/navigation checks cannot start a network or product operation.
 function load(path){
  if(modules.has(path))return modules.get(path);const exports={};modules.set(path,exports);
  const source=fs.readFileSync(new URL('../'+path,import.meta.url),'utf8')+(path.endsWith('dashboard-client.tsx')?'\nexport { DetailPanel };':'');
  vm.runInNewContext(ts.transpileModule(source,{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{
   exports,AbortController,URL,URLSearchParams,TextEncoder,TextDecoder,Date,Intl,crypto,structuredClone,
   fetch:async()=>{throw Error('DetailPanel refresh/navigation must not send a request.');},
   require(name){
    if(name==='react')return hooks;
    if(childModules.has(name))return childModules.get(name);
    return name.startsWith('@/')?load(name.slice(2)+'.ts'):require(name);
   },
  });return exports;
 }
 const {DetailPanel}=load('app/components/dashboard-client.tsx');
 const render=()=>{cursor=0;const tree=DetailPanel({tab:'SEO',product:{id:'p',updated_at:'unchanged',image_keys:'[]'},settings:{},onSaved:()=>{saved++;},
  onSavePrice:async()=>{if(rejectPrice)throw Error('save failed');},onBeforeSeoGenerate:()=>true,onBeforeFreeImageApply:()=>true,onPrepareSubmission(){},onReviewPackaging(){},onManageCategories(){},onUpload(){},...props});effects.splice(0).forEach(effect=>effect());return tree;};
 const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
 const component=(type,predicate=()=>true)=>{const found=nodes(render()).filter(n=>n.type===type&&predicate(n.props));assert.equal(found.length,1,'Expected one '+type);return found[0];};
 return {component,saves:()=>saved};
}
test('each saved source refreshes quotation even when the product timestamp stays unchanged',()=>{
 for(const [name,callback,predicate] of [['ProductContentEditor','onSaved'],['ProductOptionsEditor','onSaved',props=>!props.seoView],['ProductOptionsEditor','onSaved',props=>props.seoView],['DocumentImagePanel','onSaved',props=>props.section==='label'],['DocumentImagePanel','onSaved',props=>props.section==='size'],['ImageGenerationPanel','onProductChanged'],['TranslationPanel','onContentSaved']]){
  const h=harness(),before=h.component('QuotationPanel').props.refreshToken;
  h.component(name,predicate).props[callback]();
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

test('option workspace carries the same option into quotation while an explicit review target wins',()=>{
 const h=harness(false,{focusedOptionId:'blue',tab:'가격'});
 assert.equal(h.component('ProductOptionsEditor',props=>!props.seoView).props.focusedOptionId,'blue');
 const target=h.component('QuotationPanel').props.navigationTarget;
 assert.equal(target.optionId,'blue');assert.equal(target.fieldId,'title');
 h.component('ProductOptionsEditor',props=>!props.seoView).props.onSaved();assert.equal(h.component('QuotationPanel').props.navigationTarget.optionId,'blue');
 const review={optionId:'red',fieldId:'salePrice',categoryId:'80719'};
 assert.equal(harness(false,{focusedOptionId:'blue',quotationTarget:review}).component('QuotationPanel').props.navigationTarget,review);
 assert.equal(harness().component('QuotationPanel').props.navigationTarget,undefined);
});

test('stage-seven saves notify the workspace and refresh stage-two prices with an unchanged timestamp',()=>{
 const h=harness();const before=h.component('PriceEditor').props.refreshToken;
 h.component('QuotationPanel').props.onSaved();
 assert.notEqual(h.component('PriceEditor').props.refreshToken,before);
 assert.equal(h.component('PriceEditor').props.version,'unchanged');assert.equal(h.saves(),1);
});

test('stage-seven category choice reaches stage-two prices without remounting or resetting quotation selection',()=>{
 const h=harness(false,{preferredProfileId:'original'});
 assert.equal(h.component('PriceEditor').props.profileId,'original');
 h.component('QuotationPanel').props.onProfileChange('replacement');
 assert.equal(h.component('PriceEditor').props.profileId,'replacement');
 assert.equal(h.component('QuotationPanel').props.preferredProfileId,'original');
 h.component('QuotationPanel').props.onProfileChange(undefined);
 assert.equal(h.component('PriceEditor').props.profileId,undefined);
 assert.equal(h.saves(),0);
});
