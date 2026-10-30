import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
function consumedUploadControl(node){
 // Dashboard children are retained stubs. Follow only the slots rendered by
 // these components, not every ReactNode-valued prop passed through a wrapper.
 const label=node.type?.label??'';
 if(label.endsWith(':OptionImageEditor'))return node.props?.uploadControl;
 if(label.endsWith(':ProductOptionsEditor'))return node.props?.mainImageUploadControl;
}
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children),...nodes(consumedUploadControl(value))]:[];
function harness(){
 const slots=[],cache=new Map(),components=new Map(),effects=[],layouts=[],sourceChecks=[];let cursor=0,allowed=true,checks=0;
 const sameDeps=(before,after)=>Array.isArray(before)&&Array.isArray(after)&&before.length===after.length&&after.every((value,index)=>Object.is(value,before[index]));
 const effect=(queue,callback,deps)=>{const index=cursor++,previous=slots[index];if(!previous||!sameDeps(previous.deps,deps)){const next={deps,cleanup:previous?.cleanup};slots[index]=next;queue.push(()=>{next.cleanup?.();next.cleanup=callback();});}};
 const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>slots[index]=typeof value==='function'?value(slots[index]):value];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},
  useMemo(fn,deps){const index=cursor++,previous=slots[index];if(!previous||!sameDeps(previous.deps,deps))slots[index]={deps,value:fn()};return slots[index].value;},useCallback(fn,deps){return hooks.useMemo(()=>fn,deps);},
  useEffect(callback,deps){effect(effects,callback,deps);},useLayoutEffect(callback,deps){effect(layouts,callback,deps);}};
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
 function render(tab='추가 이미지',overrides={}){cursor=0;const tree=Detail({tab,product,settings,focusedOptionId:'red',preferredProfileId:'cat',onUpload(){},onSaved(){},onManageCategories(){},onSavePrice:async()=>{},onBeforeFreeImageApply(){checks++;return allowed;},onBeforeSourceWrite(source){sourceChecks.push(source);return allowed;},...overrides});layouts.splice(0).forEach(callback=>callback());effects.splice(0).forEach(callback=>callback());return tree;}
 const aliases={FreeImageTranslationPanel:'free-image-translation-panel:default',ImageGenerationPanel:'image-generation-panel:default'};
 const component=(name,tab,stage)=>{const found=nodes(render(tab)).filter(node=>node.type?.label?.endsWith(aliases[name]??':'+name)&&(stage===undefined||node.props.stage===stage));assert.equal(found.length,1,'Expected one '+name+(stage?' for '+stage:''));return found[0];};
 return{render,component,sourceChecks,get checks(){return checks;},permission(value){allowed=value;}};
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

test('family detail approval retains its own dialog while locking other image and price work, and independent locks survive release',()=>{
 const h=harness(),family=h.component('DetailFamilyApplyPanel','상세 이미지'),additional=h.component('DetailImageBatchPanel','추가 이미지','additional'),detail=h.component('DetailImageBatchPanel','상세 이미지','detail');
 assert.equal(family.props.active,true);assert.equal(h.component('DetailFamilyApplyPanel','대표 이미지').props.active,false);
 family.props.onBusyChange(true);additional.props.onBusyChange(false);detail.props.onBusyChange(false);
 assert.equal(h.component('DetailFamilyApplyPanel','상세 이미지').props.disabled,false);
 assert.equal(h.component('OptionImageEditor','상세 이미지','detail').props.disabled,true);
 assert.equal(h.component('DetailImageBatchPanel','추가 이미지','additional').props.disabled,true);
 assert.equal(h.component('DetailImageBatchPanel','상세 이미지','detail').props.disabled,true);
 assert.equal(additional.props.beforeApply(),false);assert.equal(detail.props.beforeApply(),false);
 assert.equal(h.component('FreeImageTranslationPanel').props.beforeApply(),false);
 assert.equal(h.component('ProductOptionsEditor','가격').props.beforePriceCommit(),false);
 assert.equal(h.checks,0);
 detail.props.onBusyChange(true);family.props.onBusyChange(false);
 assert.equal(h.component('DetailFamilyApplyPanel','상세 이미지').props.disabled,true);
 assert.equal(h.component('OptionImageEditor','상세 이미지','detail').props.disabled,true);
 detail.props.onBusyChange(false);
 assert.equal(h.component('OptionImageEditor','상세 이미지','detail').props.disabled,false);
 h.permission(false);assert.equal(family.props.beforeOpen(),false);
 h.permission(true);assert.equal(family.props.beforeOpen(),true);
});

test('file uploads keep the product-wide category scope even when opened from an option, with distinct stage start policies',()=>{
 const h=harness(),additional=h.component('ProductImageUploadQueue','추가 이미지','additional'),detail=h.component('ProductImageUploadQueue','상세 이미지','detail');
 assert.equal(additional.props.target.optionId,null);assert.equal(additional.props.target.profileId,'cat');assert.equal(detail.props.target.optionId,null);assert.equal(detail.props.target.profileId,'cat');
 assert.equal(additional.props.active,true);assert.notEqual(additional.props.immediate,true);assert.equal(detail.props.immediate,true);
 assert.equal(h.component('ProductImageUploadQueue','추가 이미지','detail').props.active,false);
 assert.equal(additional.props.beforeUpload(),true);assert.equal(detail.props.beforeUpload(),true);assert.deepEqual(h.sourceChecks,['additional-upload','detail-upload']);
});

test('representative upload targets only the focused option and profile, is immediate only in its active stage, and retains the unscoped pool uploader',()=>{
 const h=harness(),main=h.component('ProductImageUploadQueue','대표 이미지','main');
 assert.equal(main.props.productId,'p');assert.equal(main.props.target.optionId,'red');assert.equal(main.props.target.profileId,'cat');assert.equal(main.props.immediate,true);assert.equal(main.props.active,true);
 for(const tab of ['가격','추가 이미지','상세 이미지','견적서'])assert.equal(h.component('ProductImageUploadQueue',tab,'main').props.active,false);
 const additional=h.component('ProductImageUploadQueue','대표 이미지','additional'),detail=h.component('ProductImageUploadQueue','대표 이미지','detail');
 assert.equal(additional.props.target.optionId,null);assert.equal(detail.props.target.optionId,null);assert.equal(additional.props.active,false);assert.equal(detail.props.active,false);
 const unscoped=nodes(h.render('대표 이미지',{focusedOptionId:undefined}));
 assert.equal(unscoped.some(node=>node.type?.label?.endsWith(':ProductImageUploadQueue')&&node.props.stage==='main'),false);
 assert.ok(unscoped.some(node=>node.type==='input'&&node.props.type==='file'&&node.props.onChange),'the existing product-pool uploader remains available without a focused option');
});

test('main upload locks retained image, price and source callbacks in the same tick, consumes only its own scope and survives an unrelated release',()=>{
 const h=harness(),main=h.component('ProductImageUploadQueue','대표 이미지','main'),additional=h.component('ProductImageUploadQueue','추가 이미지','additional'),detail=h.component('ProductImageUploadQueue','상세 이미지','detail');
 const additionalBatch=h.component('DetailImageBatchPanel','추가 이미지','additional'),detailBatch=h.component('DetailImageBatchPanel','상세 이미지','detail'),free=h.component('FreeImageTranslationPanel','대표 이미지'),price=h.component('ProductOptionsEditor','가격'),chart=h.component('SizeChartWorkspace','사이즈표'),family=h.component('DetailFamilyApplyPanel','상세 이미지');
 const image=h.component('ProductOptionsEditor','대표 이미지'),content=h.component('ProductContentEditor','대표 이미지');
 const target={kind:'quotation',profileId:'cat',optionId:'red',input:'mainImage',fieldKey:'mainImage',slotIndex:0,revision:1,inputFingerprint:'a'.repeat(64),optionRevision:1,value:'owner/a.png'};
 main.props.onBusyChange(true);
 // Do not render between acquiring the lock and invoking the retained
 // callbacks: ref guards must protect the pre-commit same-tick window.
 assert.equal(main.props.beforeUpload(),true);assert.equal(additional.props.beforeUpload(),false);assert.equal(detail.props.beforeUpload(),false);
 assert.equal(additionalBatch.props.beforeApply(),false,'retained additional batch');assert.equal(detailBatch.props.beforeApply(),false,'retained detail batch');
 assert.equal(free.props.beforeApply(),false,'retained free-image apply');assert.equal(price.props.beforePriceCommit(),false,'retained price commit');
 assert.equal(chart.props.beforeSave(),false,'retained size-chart save');assert.equal(family.props.beforeOpen(),false,'retained detail-family approval');
 image.props.onTranslate('owner/a.png','main','zh',target);image.props.onEdit('owner/a.png','main',target);content.props.onTranslateImage('owner/a.png','zh','main');
 assert.deepEqual(h.sourceChecks,['main-upload']);assert.equal(h.checks,0);
 additionalBatch.props.onBusyChange(false);detailBatch.props.onBusyChange(false);additional.props.onBusyChange(false);
 assert.equal(price.props.beforePriceCommit(),false);assert.equal(free.props.beforeApply(),false);assert.equal(main.props.beforeUpload(),true);
 assert.equal(h.component('FreeImageTranslationPanel','대표 이미지').props.translationTarget,undefined);
 assert.equal(h.component('ProductOptionsEditor','대표 이미지').props.imageProcessingBusy,true);assert.equal(h.component('ProductContentEditor','대표 이미지').props.imageProcessingBusy,true);
 assert.equal(h.component('ProductImageUploadQueue','대표 이미지','main').props.disabled,false,'the upload keeps its own recovery/commit scope');
 assert.equal(h.component('ProductImageUploadQueue','추가 이미지','additional').props.disabled,true);assert.equal(h.component('ProductImageUploadQueue','상세 이미지','detail').props.disabled,true);
 assert.equal(h.component('SizeChartWorkspace','사이즈표').props.disabled,true);assert.equal(h.component('DetailFamilyApplyPanel','상세 이미지').props.disabled,true);
 assert.ok(nodes(h.render('대표 이미지')).some(node=>node.props.inert===true&&node.props.className==='panel-stack'));
 additional.props.onBusyChange(true);main.props.onBusyChange(false);
 assert.equal(main.props.beforeUpload(),false);assert.equal(price.props.beforePriceCommit(),false,'releasing main cannot release another active upload');
 additional.props.onBusyChange(false);assert.equal(price.props.beforePriceCommit(),true);assert.equal(main.props.beforeUpload(),true);
 h.permission(false);assert.equal(main.props.beforeUpload(),false,'the outer workspace draft guard still applies to the main upload');
});

test('selected additional and detail tools are primary while their common editors remain optional',()=>{
 const h=harness();
 for(const tab of ['추가 이미지','상세 이미지']){
  const tree=h.render(tab),common=nodes(tree).find(node=>node.props?.className==='registration-common-image-editor'),options=nodes(tree).find(node=>node.props?.className==='registration-additional-primary-tools panel-stack');
  assert.equal(common.type,'details');assert.notEqual(common.props.open,true);assert.equal(options.type,'div');assert.equal(options.props.hidden,tab!=='추가 이미지');
  assert.ok(h.component('OptionImageEditor',tab,tab==='추가 이미지'?'additional':'detail'));
 }
 assert.equal(nodes(h.render('표시사항')).find(node=>node.props?.className==='registration-additional-primary-tools panel-stack').props.hidden,true);
});

test('an upload can consume its own pending batch while locking the other role, price and size-chart writes',()=>{
 const h=harness(),additional=h.component('ProductImageUploadQueue','추가 이미지','additional'),detail=h.component('ProductImageUploadQueue','상세 이미지','detail'),chart=h.component('SizeChartWorkspace','사이즈표');
 additional.props.onBusyChange(true);
 assert.equal(additional.props.beforeUpload(),true);assert.equal(detail.props.beforeUpload(),false);assert.equal(chart.props.beforeSave(),false);
 assert.equal(h.component('ProductImageUploadQueue','상세 이미지','detail').props.disabled,true);assert.equal(h.component('SizeChartWorkspace','사이즈표').props.disabled,true);
 assert.equal(h.component('ProductOptionsEditor','가격').props.beforePriceCommit(),false);
 additional.props.onBusyChange(false);detail.props.onBusyChange(true);additional.props.onBusyChange(false);
 assert.equal(detail.props.beforeUpload(),true);assert.equal(additional.props.beforeUpload(),false);assert.equal(chart.props.beforeSave(),false);
 detail.props.onBusyChange(false);assert.equal(chart.props.beforeSave(),true);
 h.permission(false);assert.equal(additional.props.beforeUpload(),false);assert.equal(detail.props.beforeUpload(),false);assert.equal(chart.props.beforeSave(),false);
});

test('size-chart commits block stale image and price callbacks without disabling their own commit scope',()=>{
 const h=harness(),chart=h.component('SizeChartWorkspace','사이즈표'),additional=h.component('ProductImageUploadQueue','추가 이미지','additional'),batch=h.component('DetailImageBatchPanel','추가 이미지','additional'),free=h.component('FreeImageTranslationPanel'),price=h.component('ProductOptionsEditor','가격');
 assert.equal(chart.props.active,true);assert.equal(h.component('SizeChartWorkspace','상세 이미지').props.active,false);assert.equal(chart.props.profileId,'cat');
 chart.props.onBusyChange(true);
 assert.equal(chart.props.beforeSave(),true);assert.equal(additional.props.beforeUpload(),false);assert.equal(batch.props.beforeApply(),false);assert.equal(free.props.beforeApply(),false);assert.equal(price.props.beforePriceCommit(),false);
 assert.equal(h.component('SizeChartWorkspace','사이즈표').props.disabled,false);assert.equal(h.component('OptionImageEditor','상세 이미지','detail').props.disabled,true);
 const paid=h.component('ImageGenerationPanel');paid.props.onBusyChange(true);chart.props.onBusyChange(false);
 assert.equal(chart.props.beforeSave(),false);assert.equal(additional.props.beforeUpload(),false);paid.props.onBusyChange(false);assert.equal(additional.props.beforeUpload(),true);
});
