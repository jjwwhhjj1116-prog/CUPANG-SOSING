import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { optionPriceTableUI, priceTableCompanies, priceTableNodes as nodes, priceTableText as text } from './helpers/option-price-table-ui.mjs';

const change=(h,label,value)=>h.node(label).props.onChange({target:{value,valueAsNumber:Number(value)}});
const select=(h,index,checked=true)=>h.node(`가격 옵션 ${index} 선택`).props.onChange({target:{checked}});
const dialog=h=>nodes(h.render()).find(node=>node.props?.role==='dialog');
const submit=h=>{const form=nodes(dialog(h)).find(node=>node.type==='form');assert.ok(form,'bundle confirmation form');return form.props.onSubmit;};
const send=h=>submit(h)({preventDefault(){}});
const cancel=h=>nodes(dialog(h)).find(node=>node.type==='button'&&text(node)==='취소').props.onClick();
const alerts=h=>nodes(h.render()).filter(node=>node.props?.role==='alert').map(text).join(' ');
const plain=value=>JSON.parse(JSON.stringify(value));
const getOptions=async h=>(await h.request(`/api/products/${h.product.id}/options`)).json();
const getQuote=async h=>(await h.request(`/api/products/${h.product.id}/quotation-fields`)).json();

test('bundle confirmation keeps keyboard focus inside when busy or unknown outcome disables its quantity',()=>{
 const document={activeElement:null},slots=[],effects=[],native=createRequire(import.meta.url);let cursor=0;
 class Element{constructor(name){this.name=name;this.disabled=false;this.tabIndex=0;this.isConnected=true;}focus(){document.activeElement=this;}hasAttribute(name){return name==='disabled'&&this.disabled;}}
 const outside=new Element('outside'),input=new Element('quantity'),recover=new Element('recover'),cancelButton=new Element('cancel'),confirmButton=new Element('confirm'),section=new Element('dialog'),controls=[input,recover,cancelButton,confirmButton];section.querySelector=()=>input;section.querySelectorAll=()=>controls;section.contains=element=>element===section||controls.includes(element);document.activeElement=outside;
 const hooks={useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useLayoutEffect(fn,deps){const index=cursor++,before=slots[index];if(!before||deps.some((value,i)=>!Object.is(value,before.deps[i]))){slots[index]={deps,cleanup:before?.cleanup};effects.push(()=>{slots[index].cleanup?.();slots[index].cleanup=fn();});}}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/price-selection-dialog.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,document,HTMLElement:Element,require:name=>name==='react'?hooks:name==='react/jsx-runtime'?{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}:native(name)});
 const render=(props={})=>{cursor=0;const tree=exports.PriceSelectionDialog({kind:'addBundle',count:1,value:'2',busy:false,onChange:()=>{},onConfirm:()=>{},onCancel:()=>{},onRecover:()=>{},...props});const node=nodes(tree).find(node=>node.props?.role==='dialog');node.props.ref.current=section;effects.splice(0).forEach(fn=>fn());return node;};
 render();assert.equal(document.activeElement,input);controls.forEach(control=>{control.disabled=true;});render({busy:true});assert.equal(document.activeElement,section,'disabling focused quantity does not release focus to background');
 input.disabled=true;recover.disabled=false;cancelButton.disabled=false;confirmButton.disabled=true;document.activeElement=outside;const unknown=render({quantityLocked:true,confirmationBlocked:true});assert.equal(document.activeElement,recover,'unknown outcome exposes read recovery as an enabled focus target');let prevented=false;unknown.props.onKeyDown({key:'Tab',shiftKey:true,preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(document.activeElement,cancelButton);slots.forEach(slot=>slot?.cleanup?.());assert.equal(document.activeElement,outside);
});

test('editable price grid rejects a forged legacy bundle choice while noneditable embeddings retain their original draft-only tool',async()=>{
 const h=await optionPriceTableUI(priceTableCompanies[0],{count:3,integrated:true});try{
  select(h,1);const chooser=nodes(h.render()).find(node=>node.type==='select'&&nodes(node).some(child=>child.type==='option'&&child.props.value==='unitsPerPack'));chooser.props.onChange({target:{value:'addBundle'}});change(h,'일괄 편집 변경값','2');h.button('변경 미리보기').props.onClick();assert.match(alerts(h),/가격표의 번들 추가 버튼/);assert.equal(h.writes.length,0);assert.equal((await h.rows()).rows.length,3);
 }finally{h.close();}
 const legacy=await optionPriceTableUI(priceTableCompanies[0],{count:3});try{assert.ok(nodes(legacy.render()).some(node=>node.type==='option'&&node.props.value==='addBundle'));assert.equal(legacy.writes.length,0);}finally{legacy.close();}
});

for(const company of priceTableCompanies){
 test(`price toolbar order and bundle cancel preserve original options/selection and quotation (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   select(h,2);const toolbar=nodes(h.render()).filter(node=>node.type==='button'&&['선택 삭제 (1)','번들 추가','번들 적용'].includes(text(node))).map(text);assert.deepEqual(toolbar,['선택 삭제 (1)','번들 추가','번들 적용']);assert.equal(nodes(h.render()).some(node=>node.type==='option'&&node.props.value==='addBundle'),false,'editable quotation grid exposes only atomic bundle creation');
   const before=await getOptions(h),quote=await getQuote(h);h.button('번들 추가').props.onClick();assert.equal(h.node('추가할 번들 수량').props.value,'2');change(h,'추가할 번들 수량','5');cancel(h);
   assert.equal(dialog(h),undefined);assert.equal(h.node('가격 옵션 2 선택').props.checked,true);assert.equal(h.writes.length,0);assert.deepEqual(await getOptions(h),before);assert.deepEqual(await getQuote(h),quote);assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
 test(`filtered bundle uses one atomic POST with frozen new UUID and leaves originals unchanged (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:73,integrated:true});try{
   const before=await getOptions(h),quote=await getQuote(h);change(h,'가격 옵션 검색','fixture-sku-62');select(h,62);h.button('번들 추가').props.onClick();change(h,'추가할 번들 수량','5.9');
   const confirm=submit(h);confirm({preventDefault(){}});confirm({preventDefault(){}});await h.settle();assert.equal(alerts(h),'');assert.equal(dialog(h),undefined);assert.equal(h.saved,1);assert.equal(h.writes.length,1);assert.equal(h.writes[0].kind,'option-bundles');assert.equal(h.writes[0].method,'POST');
   const request=h.writes[0];assert.equal(request.quantity,5);assert.deepEqual(Object.keys(request).filter(key=>!['kind','method'].includes(key)).sort(),['additions','expectedInputFingerprint','expectedOptionRevision','expectedProductVersion','expectedQuotationRevision','quantity']);
   assert.equal(request.additions.length,1);assert.equal(request.additions[0].sourceOptionId,'price-062');assert.match(request.additions[0].optionId,/^[a-f0-9-]{36}$/);assert.equal(request.expectedQuotationRevision,quote.revision);assert.equal(request.expectedInputFingerprint,quote.inputFingerprint);
   const after=await getOptions(h),child=after.options.rows.at(-1);assert.deepEqual(after.options.rows.slice(0,73),before.options.rows);assert.equal(after.options.rows.length,74);assert.equal(child.id,request.additions[0].optionId);assert.equal(child.unitsPerPack,5);assert.equal(child.translatedName,'합성 옵션 62 (5개묶음)');assert.equal(child.supplierSku,'');assert.equal(child.stock,Math.floor(before.options.rows[61].stock/5));
   assert.equal(after.optionRegistrationNumbers[child.id],before.optionRegistrationNumbers['price-062']+'B5');assert.equal(after.options.bundleSources[child.id].sourceOptionId,'price-062');assert.equal(h.node('가격 옵션 62 선택').props.checked,false);const current=await getQuote(h);assert.equal(current.optionRevision,after.options.revision);assert.equal(current.productVersion,after.productVersion);assert.equal(current.revision,quote.revision+1);
   assert.equal(h.protectedSnapshot(),h.before);assert.ok(h.apiCalls.filter(call=>call.method!=='GET').every(call=>call.method==='POST'&&call.url.endsWith('/option-bundles')));
  }finally{h.close();}
 });
 test(`pending source and manual price drafts must be saved before adding and remain intact (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   select(h,1);change(h,'가격 옵션 1 개당 원가','5.99');h.button('번들 추가').props.onClick();assert.equal(dialog(h),undefined);assert.match(alerts(h),/먼저 옵션·가격을 저장/);assert.equal(h.writes.length,0);assert.equal(h.node('가격 옵션 1 개당 원가').props.value,5.99);
   change(h,'가격 옵션 1 개당 원가','2.99');change(h,'가격 옵션 2 공급가','9000');change(h,'가격 옵션 2 판매가','15000');change(h,'가격 옵션 2 권장소비자가','');h.button('번들 추가').props.onClick();assert.equal(dialog(h),undefined);assert.equal(h.node('가격 옵션 2 권장소비자가').props.value,'');assert.equal(h.writes.length,0);
   h.button('옵션 가격 저장하기').props.onClick();await h.settle();select(h,1);h.button('번들 추가').props.onClick();send(h);await h.settle();assert.equal(alerts(h),'');assert.deepEqual(h.writes.map(value=>value.kind),['stage-two-pricing','option-bundles']);const quote=await getQuote(h);assert.deepEqual(plain(quote.overrides.options['price-002']),{supplyPrice:'9000',salePrice:'15000',msrp:''});assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
 test(`invalid quantities, selection source changes and stale policy/file handlers create no bundle intent (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   select(h,1);h.button('번들 추가').props.onClick();for(const value of ['1','1000001','bad']){change(h,'추가할 번들 수량',value);send(h);await h.settle();assert.equal(h.node('추가할 번들 수량').props.value,value);assert.equal(h.writes.length,0);}
   change(h,'추가할 번들 수량','5');const confirm=submit(h);for(const locks of [{policy:true},{policy:false,files:true},{files:false,allowed:false}]){h.locks(locks);confirm({preventDefault(){}});await h.settle();assert.equal(h.writes.length,0);}
   h.locks({policy:false,files:false,allowed:true});change(h,'가격 옵션 1 개당 원가','5.99');confirm({preventDefault(){}});await h.settle();assert.equal(h.writes.length,0);assert.equal(h.node('가격 옵션 1 개당 원가').props.value,5.99);assert.match(text(dialog(h)),/옵션 또는 가격 입력이 변경/);assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
 test(`committed atomic ACK loss blocks all writes and GET recovery confirms without another POST (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   let lost=true;h.controls.response=(url,init,response)=>{if(lost&&init.method==='POST'&&url.endsWith('/option-bundles')){lost=false;return Response.json({error:'committed bundle ACK lost'},{status:503});}return response;};
   select(h,1);const oldSave=h.button('옵션 가격 저장하기').props.onClick,oldApply=h.button('번들 적용').props.onClick,oldDelete=h.button('선택 삭제 (1)').props.onClick,oldPrice=h.node('가격 옵션 1 공급가').props.onChange;
   h.button('번들 추가').props.onClick();change(h,'추가할 번들 수량','3');const confirm=submit(h);confirm({preventDefault(){}});await h.settle();confirm({preventDefault(){}});oldSave();oldApply();oldDelete();oldPrice({target:{value:'99999'}});await h.settle();assert.equal(h.writes.length,1);assert.equal(h.node('추가할 번들 수량').props.value,'3');assert.equal(h.node('추가할 번들 수량').props.disabled,true);assert.equal(h.node('가격 옵션 1 선택').props.checked,true);assert.equal(h.saved,0);
   h.button('입력 유지 · 번들 저장 결과 확인').props.onClick();await h.settle();assert.equal(alerts(h),'');assert.equal(dialog(h),undefined);assert.equal(h.writes.length,1);assert.equal(h.saved,1);assert.equal((await h.rows()).rows.length,4);assert.equal(h.node('가격 옵션 1 선택').props.checked,false);assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
 test(`uncommitted unknown POST proves unchanged bases then retries exact same new IDs (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   let lost=true;h.controls.before=(url,init)=>{if(lost&&init.method==='POST'&&url.endsWith('/option-bundles')){lost=false;throw Error('network failed before route');}};
   select(h,2);h.button('번들 추가').props.onClick();change(h,'추가할 번들 수량','4');send(h);await h.settle();assert.equal(h.writes.length,1);const intent=plain(h.writes[0]);assert.equal((await h.rows()).rows.length,3);
   h.button('입력 유지 · 번들 저장 결과 확인').props.onClick();await h.settle();assert.match(text(dialog(h)),/아직 저장되지 않은 원본 상태/);assert.equal(h.node('추가할 번들 수량').props.disabled,true);send(h);send(h);await h.settle();assert.equal(alerts(h),'');assert.equal(h.writes.length,2);assert.deepEqual(h.writes[1],intent);assert.equal((await h.rows()).rows.length,4);assert.equal(h.saved,1);assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
 test(`verified unchanged retry can be cancelled without losing selection or allocating a bundle (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   let lost=true;h.controls.before=(url,init)=>{if(lost&&init.method==='POST'){lost=false;throw Error('not sent');}};
   select(h,1);h.button('번들 추가').props.onClick();send(h);await h.settle();cancel(h);assert.equal(dialog(h),undefined);h.button('입력 유지 · 번들 저장 결과 확인').props.onClick();await h.settle();assert.ok(dialog(h));cancel(h);assert.equal(dialog(h),undefined);assert.equal(h.node('가격 옵션 1 선택').props.checked,true);assert.equal(h.button('번들 추가').props.disabled,false);assert.equal((await h.rows()).rows.length,3);assert.equal(h.writes.length,1);assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
 test(`profile ABA aborts the old POST callback, preserves its unknown intent and recovers original scope once (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   select(h,1);h.button('번들 추가').props.onClick();change(h,'추가할 번들 수량','3');const confirm=submit(h),hold=h.holdSave();confirm({preventDefault(){}});await hold.arrived;h.selectProfile('missing');await h.settle();assert.equal(h.apiCalls.find(call=>call.method==='POST').signal.aborted,true);assert.equal(dialog(h),undefined);hold.release();await h.settle();confirm({preventDefault(){}});await h.settle();assert.equal(h.writes.length,1);assert.equal(h.saved,0);
   h.selectProfile(undefined);await h.settle();h.button('입력 유지 · 번들 저장 결과 확인').props.onClick();await h.settle();assert.equal(alerts(h),'');assert.equal(h.writes.length,1);assert.equal(h.saved,1);assert.equal((await h.rows()).rows.length,4);assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
 test(`a parent clock change fences late atomic ACK and keeps GET recovery visible in the same grid scope (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   select(h,1);h.button('번들 추가').props.onClick();const confirm=submit(h),hold=h.holdSave();confirm({preventDefault(){}});await hold.arrived;
   h.changeProductVersion(new Date(Date.parse(h.product.updated_at)+1).toISOString());await h.settle();hold.release();await h.settle();confirm({preventDefault(){}});assert.equal(h.writes.length,1);assert.equal(h.saved,0);assert.equal(h.node('추가할 번들 수량').props.disabled,true);
   h.button('입력 유지 · 번들 저장 결과 확인').props.onClick();await h.settle();assert.equal(alerts(h),'');assert.equal(h.saved,1);assert.equal(h.writes.length,1);assert.equal((await h.rows()).rows.length,4);assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
 test(`a forged atomic receipt remains unknown until GET proves the original complete committed result (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   let forged=true;h.controls.response=async(url,init,response)=>{if(forged&&init.method==='POST'){forged=false;const body=await response.json();body.quotation.overrides.options['price-002']={salePrice:'99999'};return Response.json(body);}return response;};
   select(h,1);h.button('번들 추가').props.onClick();send(h);await h.settle();assert.ok(dialog(h));assert.equal(h.saved,0);assert.equal(h.writes.length,1);assert.match(text(dialog(h)),/번들 견적서/);h.button('입력 유지 · 번들 저장 결과 확인').props.onClick();await h.settle();assert.equal(h.saved,1);assert.equal(dialog(h),undefined);assert.equal(h.writes.length,1);assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
 test(`a temporary quotation read failure after atomic ACK keeps identifiers and recovers without source/quote rewrite (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   let failed=false;h.controls.response=(url,init,response)=>{if(!failed&&h.writes.length&&init.method===undefined&&url.endsWith('/quotation-fields')){failed=true;return Response.json({error:'quote read unavailable'},{status:503});}return response;};
   select(h,1);h.button('번들 추가').props.onClick();send(h);await h.settle();assert.equal(h.saved,0);assert.ok(dialog(h));assert.equal(h.node('가격 옵션 1 선택').props.checked,true);assert.equal(h.writes.length,1);h.button('입력 유지 · 번들 저장 결과 확인').props.onClick();await h.settle();assert.equal(h.saved,1);assert.equal(dialog(h),undefined);assert.equal(h.writes.length,1);assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
}

test('an empty-scope price controller accepts only coordinated exact receipt clocks, while ordinary or partial-clock reads reject newer parent data',async()=>{
 const h=await optionPriceTableUI(priceTableCompanies[0],{count:2,integrated:true});try{
  change(h,'가격 옵션 1 공급가','9500');change(h,'가격 옵션 1 판매가','15000');h.button('옵션 가격 저장하기').props.onClick();await h.settle();const latest=await getQuote(h);assert.notEqual(latest.productVersion,h.product.updated_at);
  const slots=[],effects=[],layouts=[],cache=new Map(),calls=[],native=createRequire(import.meta.url);let cursor=0,controller;
  const schedule=(queue,fn,deps)=>{const index=cursor++,before=slots[index];if(!before||deps.some((value,i)=>!Object.is(value,before.deps[i]))){slots[index]={deps,cleanup:before?.cleanup};queue.push(()=>{slots[index].cleanup?.();slots[index].cleanup=fn();});}};
  const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useMemo(fn,deps){const index=cursor++,before=slots[index];if(!before||deps.some((value,i)=>!Object.is(value,before.deps[i])))slots[index]={deps,value:fn()};return slots[index].value;},useEffect(fn,deps){schedule(effects,fn,deps);},useLayoutEffect(fn,deps){schedule(layouts,fn,deps);}};
  function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,structuredClone,TextEncoder,fetch:async(url,init)=>{calls.push({url,init});return Response.json(latest);},require:name=>name==='react'?hooks:name.startsWith('@/')?load(name.slice(2)+'.ts'):name.startsWith('.')?load(path.posix.join(path.posix.dirname(file),name)+'.ts'):native(name)});return exports;}
  const Component=load('app/components/option-quotation-prices.tsx').OptionQuotationPrices,render=()=>{cursor=0;const tree=Component({productId:h.product.id,version:h.product.updated_at,renderGrid:value=>{controller=value;return null;}});layouts.splice(0).forEach(fn=>fn());effects.splice(0).forEach(fn=>fn());return tree;};
  render();for(let i=0;i<6;i++){await new Promise(done=>setImmediate(done));render();}assert.equal(controller.snapshot().view,null,'ordinary no-base GET must respect the original parent clock');
  assert.equal(await controller.refresh(false,false,{coordinated:true,expectedProductVersion:latest.productVersion}),null,'one clock is insufficient');
  assert.equal(await controller.refresh(false,false,{expectedProductVersion:latest.productVersion,expectedOptionRevision:latest.optionRevision}),null,'exact clocks without coordination are insufficient');
  assert.equal(await controller.refresh(false,false,{coordinated:true,expectedProductVersion:latest.productVersion,expectedOptionRevision:latest.optionRevision+1}),null,'wrong receipt clock remains rejected');
  assert.ok(await controller.refresh(false,false,{coordinated:true,expectedProductVersion:latest.productVersion,expectedOptionRevision:latest.optionRevision}));assert.equal(controller.snapshot().view.productVersion,latest.productVersion);assert.equal(controller.snapshot().view.optionRevision,latest.optionRevision);assert.ok(calls.every(call=>!call.init.method));slots.forEach(slot=>slot?.cleanup?.());
 }finally{h.close();}
});
