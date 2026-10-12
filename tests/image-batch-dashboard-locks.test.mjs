import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
function harness(){
 const slots=[],cache=new Map(),components=new Map();let cursor=0,allowed=true,checks=0;
 const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>slots[index]=typeof value==='function'?value(slots[index]):value];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useMemo:fn=>fn(),useCallback:fn=>fn,useEffect(){}};
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  const source=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8')+(file.endsWith('dashboard-client.tsx')?'\nexport {DetailPanel};':'');
  vm.runInNewContext(ts.transpileModule(source,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,TextEncoder,crypto,require(name){
   if(name==='react')return hooks;
   if(name==='react/jsx-runtime')return{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
   if(name.startsWith('@/app/components/')){if(!components.has(name))components.set(name,new Proxy({},{get:(_,key)=>{const label=name+':'+String(key);if(!components.has(label))components.set(label,Object.assign(()=>null,{label}));return components.get(label);}}));return components.get(name);}
   return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);
  }});return exports;
 }
 const Detail=load('app/components/dashboard-client.tsx').DetailPanel;
 const product={id:'p',title:'상품',source_price_cny:2,image_keys:'["owner/a.png"]',updated_at:'2026-10-13T00:00:00Z'};
 const settings=load('app/workspace-settings.ts').defaultSettings;
 function render(tab='추가 이미지'){cursor=0;return Detail({tab,product,settings,focusedOptionId:'red',preferredProfileId:'cat',onUpload(){},onSaved(){},onManageCategories(){},onSavePrice:async()=>{},onBeforeFreeImageApply(){checks++;return allowed;}});}
 const aliases={FreeImageTranslationPanel:'free-image-translation-panel:default',ImageGenerationPanel:'image-generation-panel:default'};
 const component=(name,tab,stage)=>nodes(render(tab)).find(node=>node.type?.label?.endsWith(aliases[name]??':'+name)&&(stage===undefined||node.props.stage===stage));
 return{render,component,get checks(){return checks;},permission(value){allowed=value;}};
}
test('stage-four and stage-five batch views target distinct roles and only the current stage is active',()=>{
 const h=harness(),additional=h.component('DetailImageBatchPanel','추가 이미지','additional'),detail=h.component('DetailImageBatchPanel','추가 이미지','detail');
 assert.equal(additional.props.active,true);assert.equal(detail.props.active,false);assert.notEqual(additional.key,detail.key);
 assert.equal(additional.props.productId,'p');assert.equal(additional.props.optionId,'red');assert.equal(additional.props.profileId,'cat');
 assert.equal(h.component('DetailImageBatchPanel','상세 이미지','additional').props.active,false);
 assert.equal(h.component('DetailImageBatchPanel','상세 이미지','detail').props.active,true);
});
test('an inactive batch releasing its lock cannot unlock an active additional or detail operation',()=>{
 const h=harness(),additional=h.component('DetailImageBatchPanel','추가 이미지','additional'),detail=h.component('DetailImageBatchPanel','추가 이미지','detail');
 additional.props.onBusyChange(true);detail.props.onBusyChange(false);
 assert.equal(h.component('OptionImageEditor','추가 이미지','additional').props.disabled,true);
 assert.equal(h.component('DetailImageBatchPanel','상세 이미지','detail').props.disabled,true);
 assert.equal(detail.props.beforeApply(),false);assert.equal(h.checks,0);
 assert.equal(nodes(h.render()).find(node=>node.props?.inert===true)?.props.className,'panel-stack');
 assert.equal(h.component('FreeImageTranslationPanel').props.beforeApply(),false);
 additional.props.onBusyChange(false);detail.props.onBusyChange(true);additional.props.onBusyChange(false);
 assert.equal(h.component('OptionImageEditor','상세 이미지','detail').props.disabled,true);
 assert.equal(additional.props.beforeApply(),false);assert.equal(h.component('FreeImageTranslationPanel').props.beforeApply(),false);
 detail.props.onBusyChange(false);assert.equal(h.component('OptionImageEditor','추가 이미지','additional').props.disabled,false);
 assert.equal(additional.props.beforeApply(),true);assert.equal(h.checks,1);
});
test('paid/free processing and unsaved quotation edits block both batch roles before any application',()=>{
 const h=harness(),additional=h.component('DetailImageBatchPanel','추가 이미지','additional'),detail=h.component('DetailImageBatchPanel','상세 이미지','detail');
 const paid=h.component('ImageGenerationPanel'),free=h.component('FreeImageTranslationPanel');
 paid.props.onBusyChange(true);assert.equal(additional.props.beforeApply(),false);assert.equal(detail.props.beforeApply(),false);
 assert.equal(h.component('DetailImageBatchPanel','추가 이미지','additional').props.disabled,true);
 paid.props.onBusyChange(false);free.props.onBusyChange(true);assert.equal(additional.props.beforeApply(),false);assert.equal(detail.props.beforeApply(),false);
 free.props.onBusyChange(false);h.permission(false);assert.equal(additional.props.beforeApply(),false);assert.equal(detail.props.beforeApply(),false);
 h.permission(true);assert.equal(additional.props.beforeApply(),true);assert.equal(detail.props.beforeApply(),true);
});
