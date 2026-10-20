import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { optionPriceTableUI, priceTableCompanies, priceTableNodes as nodes, priceTableText as text } from './helpers/option-price-table-ui.mjs';

const change=(h,label,value)=>h.node(label).props.onChange({target:{value,valueAsNumber:Number(value)}});
const select=(h,index,checked=true)=>h.node(`가격 옵션 ${index} 선택`).props.onChange({target:{checked}});
const dialog=h=>nodes(h.render()).find(node=>node.props?.role==='dialog');
const submit=h=>{const form=nodes(dialog(h)).find(node=>node.type==='form');assert.ok(form,'controlled confirmation form');return form.props.onSubmit;};
const confirm=h=>submit(h)({preventDefault(){}});
const cancel=h=>{const button=nodes(dialog(h)).find(node=>node.type==='button'&&text(node)==='취소');assert.ok(button);button.props.onClick();};
const alerts=h=>nodes(h.render()).filter(node=>node.props?.role==='alert').map(text).join(' ');
const quote=async h=>(await h.request(`/api/products/${h.product.id}/quotation-fields`)).json();
const metadata=async h=>(await h.request(`/api/products/${h.product.id}/options`)).json();
const plain=value=>JSON.parse(JSON.stringify(value));

test('actual controlled dialog focuses safe controls, traps both Tab directions, ignores busy Escape and restores connected focus',()=>{
 for(const kind of ['bundle','remove']){
  const document={activeElement:null},effects=[],focused=[];
  class Element{constructor(name,disabled=false){this.name=name;this.disabled=disabled;this.tabIndex=0;this.isConnected=true;}focus(){document.activeElement=this;focused.push(this.name);}hasAttribute(name){return name==='disabled'&&this.disabled;}}
  const previous=new Element('background'),input=new Element('quantity'),cancelButton=new Element('cancel'),confirmButton=new Element('confirm'),controls=kind==='bundle'?[input,cancelButton,confirmButton]:[cancelButton,confirmButton];
  document.activeElement=previous;let controlsDisabled=false;const root=new Element('dialog');root.querySelector=selector=>selector==='input'?input:cancelButton;root.querySelectorAll=()=>controls.map(control=>{control.disabled=controlsDisabled;return control;});
  const ref={current:null},exports={},hooks={useRef:()=>ref,useLayoutEffect:effect=>effects.push(effect)};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/price-selection-dialog.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {exports,document,HTMLElement:Element,require:name=>name==='react'?hooks:name==='react/jsx-runtime'?{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}:(()=>{throw Error(name);})()});
  let cancelled=0;const props={kind,count:2,value:'2',busy:false,onChange:()=>{},onConfirm:()=>{},onCancel:()=>{cancelled++;}};
  const view=exports.PriceSelectionDialog(props),section=nodes(view).find(node=>node.props?.role==='dialog');ref.current=root;const cleanup=effects.shift()();assert.equal(document.activeElement,kind==='bundle'?input:cancelButton,'delete opens on cancel, not irreversible submit');
  let prevented=false;section.props.onKeyDown({key:'Tab',shiftKey:true,preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(document.activeElement,confirmButton);
  prevented=false;section.props.onKeyDown({key:'Tab',shiftKey:false,preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(document.activeElement,controls[0]);
  document.activeElement=previous;prevented=false;section.props.onKeyDown({key:'Tab',shiftKey:false,preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(document.activeElement,controls[0],'external focus returns inside confirmation');
  section.props.onKeyDown({key:'Escape',preventDefault(){}});assert.equal(cancelled,1);
  controlsDisabled=true;const busy=nodes(exports.PriceSelectionDialog({...props,busy:true})).find(node=>node.props?.role==='dialog');busy.props.onKeyDown({key:'Escape',preventDefault(){throw Error('busy Escape must not cancel');}});assert.equal(cancelled,1);
  busy.props.onKeyDown({key:'Tab',preventDefault(){}});assert.equal(document.activeElement,root,'while requests disable controls, Tab stays on dialog');
  cleanup();assert.equal(document.activeElement,previous);previous.isConnected=false;document.activeElement=cancelButton;cleanup();assert.equal(document.activeElement,cancelButton,'unmounted background is not refocused');assert.ok(focused.length>3);
 }
});

for(const company of priceTableCompanies){
 test(`bundle/delete cancel and Escape preserve full source, prices and exact selected identity (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   const before=JSON.stringify(await h.rows());select(h,2);h.button('번들 적용').props.onClick();assert.equal(h.node('적용할 번들 수량').props.value,'2');
   change(h,'적용할 번들 수량','5');cancel(h);assert.equal(dialog(h),undefined);assert.equal(h.node('가격 옵션 2 구성 수량').props.value,1);assert.equal(h.writes.length,0);
   h.button('선택 삭제 (1)').props.onClick();assert.match(text(dialog(h)),/선택한 1개 옵션/);cancel(h);assert.equal(h.node('가격 옵션 2 선택').props.checked,true);
   h.button('번들 적용').props.onClick();let prevented=false;dialog(h).props.onKeyDown({key:'Escape',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(dialog(h),undefined);
   assert.equal(JSON.stringify(await h.rows()),before);assert.equal(h.protectedSnapshot(),h.before);assert.equal(h.writes.length,0);
  }finally{h.close();}
 });
 test(`filtered selected UUID bundle applies parseInt quantity and direct-minimum prices through full source and latest quote CAS (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:73,integrated:true});try{
   const before=await h.rows(),numbers=(await metadata(h)).optionRegistrationNumbers;change(h,'가격 옵션 검색','fixture-sku-62');select(h,62);h.button('번들 적용').props.onClick();change(h,'적용할 번들 수량','3.9');
   const send=submit(h);send({preventDefault(){}});send({preventDefault(){}});await h.settle();assert.equal(alerts(h),'');assert.equal(dialog(h),undefined);assert.equal(h.saved,1);
   assert.deepEqual(h.writes.map(value=>value.kind),['stage-two-pricing']);assert.equal(h.writes[0].rows.length,73);assert.equal(h.writes[0].rows[61].id,'price-062');
   const after=await h.rows();assert.equal(after.rows[61].unitsPerPack,3);assert.equal(after.rows[61].translatedName,'합성 옵션 62 (3개묶음)');
   for(let i=0;i<73;i++)if(i!==61)assert.deepEqual(after.rows[i],before.rows[i]);
   for(const key of ['id','supplierSku','originalName','unitCostCny','stock','minimumOrderQuantity','imageKey','widthCm','lengthCm','heightCm','weightKg','packagedWeightG','packagedWidthMm','packagedLengthMm','packagedHeightMm'])assert.equal(after.rows[61][key],before.rows[61][key],key);
   const expected=h.load('app/product-options.ts').calculateOptionPrices(h.load('app/product-options.ts').optionInputs(after),{...h.policy,recalculationMode:'couplus-stage-two-v1'})[61].calculation;
   const result=await quote(h);for(const key of ['supplyPrice','salePrice','msrp'])assert.equal(result.overrides.options['price-062'][key],String(expected[key]));
   assert.equal(result.optionRevision,after.revision);assert.deepEqual(plain((await metadata(h)).optionRegistrationNumbers),plain(numbers));assert.equal(h.protectedSnapshot(),h.before);
   assert.equal(h.apiCalls.filter(call=>call.method==='POST'&&call.url.endsWith('/stage-two-pricing')).length,1);assert.equal(h.apiCalls.filter(call=>call.method==='PATCH'||call.method==='PUT').length,0);
  }finally{h.close();}
 });
 test(`selected bundle recalculates its old manual prices and preserves unselected synchronous prices plus explicit MSRP blank (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   change(h,'가격 옵션 1 공급가','9100');change(h,'가격 옵션 1 판매가','15900');change(h,'가격 옵션 1 권장소비자가','');
   change(h,'가격 옵션 2 공급가','9300');change(h,'가격 옵션 2 판매가','16100');change(h,'가격 옵션 2 권장소비자가','');
   select(h,1);h.button('번들 적용').props.onClick();change(h,'적용할 번들 수량','2');confirm(h);await h.settle();assert.equal(alerts(h),'');
   assert.deepEqual(h.writes.map(value=>value.kind),['stage-two-pricing']);const after=await h.rows(),result=await quote(h);
   const expected=h.load('app/product-options.ts').calculateOptionPrices(h.load('app/product-options.ts').optionInputs(after),{...h.policy,recalculationMode:'couplus-stage-two-v1'})[0].calculation;
   for(const key of ['supplyPrice','salePrice','msrp'])assert.equal(result.overrides.options['price-001'][key],String(expected[key]));
   assert.deepEqual(plain(result.overrides.options['price-002']),{supplyPrice:'9300',salePrice:'16100',msrp:''});assert.equal(after.rows[1].unitsPerPack,1);assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
 test(`selected deletion saves complete surviving source and unselected pending quotation intent, with stable option numbers (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   const before=await h.rows(),numbers=(await metadata(h)).optionRegistrationNumbers;
   change(h,'가격 옵션 1 공급가','9000');change(h,'가격 옵션 1 판매가','15000');change(h,'가격 옵션 1 권장소비자가','');select(h,2);h.button('선택 삭제 (1)').props.onClick();
   const send=submit(h);send({preventDefault(){}});send({preventDefault(){}});await h.settle();assert.equal(alerts(h),'');assert.equal(dialog(h),undefined);
   assert.deepEqual(h.writes.map(value=>value.kind),['stage-two-pricing']);const after=await h.rows();assert.deepEqual(after.rows,before.rows.filter(row=>row.id!=='price-002'));
   const kept=(await metadata(h)).optionRegistrationNumbers;assert.equal(kept['price-001'],numbers['price-001']);assert.equal(kept['price-003'],numbers['price-003']);assert.equal(kept['price-002'],undefined);
   const result=await quote(h);assert.deepEqual(plain(result.overrides.options['price-001']),{supplyPrice:'9000',salePrice:'15000',msrp:''});assert.equal(result.resolved.rows.some(row=>row.optionId==='price-002'),false);assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
 test(`deletion refuses selected unsaved quotation prices and keeps their blank/manual intent until explicit save (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   const before=JSON.stringify(await h.rows());change(h,'가격 옵션 2 공급가','9000');change(h,'가격 옵션 2 판매가','15000');change(h,'가격 옵션 2 권장소비자가','');select(h,2);h.button('선택 삭제 (1)').props.onClick();confirm(h);await h.settle();
   assert.match(text(dialog(h)),/저장하지 않은 직접 가격/);assert.equal(h.writes.length,0);assert.equal(h.node('가격 옵션 2 공급가').props.value,'9000');assert.equal(h.node('가격 옵션 2 권장소비자가').props.value,'');assert.equal(JSON.stringify(await h.rows()),before);
   cancel(h);h.button('옵션 가격 저장하기').props.onClick();await h.settle();assert.equal(h.writes.length,1);assert.equal(h.writes[0].kind,'stage-two-pricing');assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
 test(`invalid bundle bounds retain dialog text and make no writes; stale source edits cannot apply an old confirmation (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   const before=JSON.stringify(await h.rows());select(h,1);h.button('번들 적용').props.onClick();for(const value of ['0','1000001','bad']){change(h,'적용할 번들 수량',value);confirm(h);await h.settle();assert.equal(h.node('적용할 번들 수량').props.value,value);assert.match(text(dialog(h)),/1~1,000,000/);assert.equal(h.writes.length,0);}
   change(h,'적용할 번들 수량','5');const retained=submit(h);change(h,'가격 옵션 1 개당 원가','5.99');retained({preventDefault(){}});await h.settle();assert.equal(h.writes.length,0);assert.match(text(dialog(h)),/옵션 또는 가격 기준이 변경/);assert.equal(h.node('가격 옵션 1 개당 원가').props.value,5.99);assert.equal(JSON.stringify(await h.rows()),before);
  }finally{h.close();}
 });
 for(const withPriorManual of [false,true])test(`unknown atomic bundle ACK retains full quantity/manual intent and coherent GET recovers once, prior manual=${withPriorManual} (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   let lost=true;h.controls.response=(url,init,response)=>{if(lost&&init.method==='POST'&&url.includes('/stage-two-pricing')){lost=false;return Response.json({error:'atomic bundle ACK lost'},{status:503});}return response;};
   if(withPriorManual){change(h,'가격 옵션 2 공급가','9300');change(h,'가격 옵션 2 판매가','16100');change(h,'가격 옵션 2 권장소비자가','');}
   select(h,1);h.button('번들 적용').props.onClick();change(h,'적용할 번들 수량','3');const send=submit(h);send({preventDefault(){}});await h.settle();send({preventDefault(){}});await h.settle();
   assert.equal(h.node('적용할 번들 수량').props.value,'3');assert.deepEqual(h.writes.map(value=>value.kind),['stage-two-pricing']);assert.equal((await h.rows()).rows[0].unitsPerPack,3);assert.equal(h.node('가격 옵션 1 구성 수량').props.disabled,true);
   cancel(h);h.button('입력 유지 · 저장 결과 확인').props.onClick();await h.settle();assert.equal(alerts(h),'');assert.equal(h.saved,1);assert.deepEqual(h.writes.map(value=>value.kind),['stage-two-pricing']);assert.equal(h.button('옵션 가격 저장하기').props.disabled,true);assert.equal((await quote(h)).overrides.options['price-001'].salePrice,h.node('가격 옵션 1 판매가').props.value);if(withPriorManual)assert.equal((await quote(h)).overrides.options['price-002'].msrp,'');assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
 test(`retained confirmation respects policy/file/source locks and profile ABA resets its identity (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   select(h,1);h.button('번들 적용').props.onClick();change(h,'적용할 번들 수량','4');const send=submit(h);
   for(const locks of [{policy:true},{policy:false,files:true},{files:false,allowed:false}]){h.locks(locks);send({preventDefault(){}});await h.settle();assert.equal(h.writes.length,0);assert.equal(h.node('적용할 번들 수량').props.value,'4');assert.equal(h.node('가격 옵션 1 구성 수량').props.value,1);}
   h.locks({policy:false,files:false,allowed:true});h.selectProfile('missing');await h.settle();assert.equal(dialog(h),undefined);h.selectProfile(undefined);await h.settle();send({preventDefault(){}});await h.settle();assert.equal(h.writes.length,0);assert.equal(h.node('가격 옵션 1 구성 수량').props.value,1);assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
 test(`bundle save acquires a synchronous duplicate lock before network and no retained delete applies in flight (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   select(h,1);const remove=h.button('선택 삭제 (1)').props.onClick;h.button('번들 적용').props.onClick();const send=submit(h),hold=h.holdSave();send({preventDefault(){}});send({preventDefault(){}});remove();
   await Promise.race([hold.arrived,new Promise((_,reject)=>setTimeout(()=>reject(Error('bundle source PATCH did not start')),5000))]);assert.equal(h.writes.length,1);assert.equal(h.writes[0].rows.length,3);hold.release();await h.settle();assert.deepEqual(h.writes.map(value=>value.kind),['stage-two-pricing']);assert.equal((await h.rows()).rows.length,3);assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
 test(`same-tick quotation refresh rejects a retained delete confirmation before React's busy render (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   select(h,2);h.button('선택 삭제 (1)').props.onClick();const send=submit(h);let release,arrive;const started=new Promise(done=>{arrive=done;}),held=new Promise(done=>{release=done;});
   h.controls.before=async(url,init)=>{if(!init.method&&url.endsWith('/quotation-fields')){arrive();await held;}};
   h.button('저장 가격 다시 조회').props.onClick();send({preventDefault(){}});await started;assert.equal(h.writes.length,0);release();await h.settle();assert.equal((await h.rows()).rows.length,3);assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
 test(`generic bulk preview and undo are retained when the parent's current lock rejects apply (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   select(h,1);change(h,'일괄 편집 변경값','4');h.button('변경 미리보기').props.onClick();const apply=h.button('편집 내용에 적용').props.onClick;
   h.locks({policy:true});apply();await h.settle();assert.equal(h.node('가격 옵션 1 구성 수량').props.value,1);assert.ok(h.button('편집 내용에 적용'));assert.match(alerts(h),/미리보기와 입력을 유지/);
   h.locks({policy:false});h.button('편집 내용에 적용').props.onClick();await h.settle();assert.equal(h.node('가격 옵션 1 구성 수량').props.value,4);const undo=h.button('최근 일괄 변경 되돌리기').props.onClick;
   h.locks({files:true});undo();await h.settle();assert.equal(h.node('가격 옵션 1 구성 수량').props.value,4);assert.ok(h.button('최근 일괄 변경 되돌리기'));
   h.locks({files:false});h.button('최근 일괄 변경 되돌리기').props.onClick();await h.settle();assert.equal(h.node('가격 옵션 1 구성 수량').props.value,1);assert.equal(h.writes.length,0);assert.equal(h.protectedSnapshot(),h.before);
  }finally{h.close();}
 });
 test(`source-only selected deletion commits immediately from live draft without a preceding price edit (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   select(h,2);h.button('선택 삭제 (1)').props.onClick();confirm(h);await h.settle();assert.equal(alerts(h),'');assert.equal(dialog(h),undefined);assert.equal(h.saved,1);assert.deepEqual(h.writes.map(value=>value.kind),['stage-two-pricing']);assert.deepEqual(plain((await h.rows()).rows.map(row=>row.id)),['price-001','price-003']);assert.equal((await quote(h)).resolved.rows.some(row=>row.optionId==='price-002'),false);
  }finally{h.close();}
 });
 test(`manual bundle apply uses the current unsaved policy; a later policy edit invalidates old confirmation (${company.code})`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true,detail:true});try{
   change(h,'적용 환율 (CNY → KRW)','400');await h.settle();select(h,1);h.button('번들 적용').props.onClick();const old=submit(h);change(h,'공급 마진율 (%)','45');old({preventDefault(){}});await h.settle();assert.equal(h.writes.length,0);assert.match(text(dialog(h)),/옵션 또는 가격 기준이 변경/);cancel(h);h.button('번들 적용').props.onClick();change(h,'적용할 번들 수량','2');confirm(h);await h.settle();assert.equal(alerts(h),'');assert.equal(h.writes.length,1);assert.equal(h.writes[0].policy.exchangeRate,400);assert.equal(h.writes[0].policy.supplyMargin,45);const after=await h.rows(),expected=h.load('app/product-options.ts').calculateOptionPrices(after.rows,h.writes[0].policy)[0].calculation;assert.equal((await quote(h)).overrides.options['price-001'].salePrice,String(expected.salePrice));
  }finally{h.close();}
 });

}
