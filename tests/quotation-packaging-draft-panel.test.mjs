import test from 'node:test';import assert from 'node:assert/strict';
import {providedOptionModule as load} from './helpers/provided-option-quotation.mjs';
import {aiFixture} from './helpers/quotation-ai.mjs';
import {quotationAiUI,nodes} from './helpers/quotation-ai-ui.mjs';
import {apiFixture,companies} from './helpers/supplier-hub-single-projection.mjs';
import {quotationLabelFormUI} from './helpers/quotation-label-form-ui.mjs';
import {packagingResponse,packagingItem,legacyPackagingDraft} from './helpers/quotation-packaging-provider.mjs';
const helper=load('app/quotation-packaging-draft.ts'),schema=load('app/quotation-schema.ts');
const component='app/components/quotation-packaging-draft-panel.tsx',exportName='QuotationPackagingDraftPanel';
function setup(){const f=aiFixture(),resolved=schema.resolveQuotationFields({categoryId:f.profile.categoryId,categoryPath:f.profile.categoryPath,product:f.product,content:f.content,settings:f.saved.settings,options:f.options,overrides:f.state.overrides,hubSchema:f.snapshot});
 const view={revision:0,inputFingerprint:'a'.repeat(64),overrides:f.state.overrides,resolved,automatic:resolved,categoryContext:f.saved.categoryContext,productVersion:f.product.updated_at,contentRevision:f.content.revision,optionRevision:f.options.revision,updatedAt:null,imageKeys:[],submissionReady:false,optionPackQuantities:Object.fromEntries(f.options.rows.map(row=>[row.id,row.unitsPerPack]))};
 const props={productId:f.product.id,view,optionId:f.options.rows[0].id,disabled:false,onApply:()=>true};
 const reply=body=>legacyPackagingDraft(helper,helper.buildQuotationPackagingDraftPlan(view,f.options,{title:'合成后跟贴',description:'',attributes:[]},{optionId:body.optionId,applyToAllOptions:body.applyToAllOptions}));
 return{f,view,props,reply};}
test('panel starts with no request and only stages clearly labelled reviewed estimates without autosave',async()=>{
 const f=setup(),applied=[],busy=[];const ui=quotationAiUI({...f.props,onApply:changes=>{applied.push(changes);return true;},onBusyChange:value=>busy.push(value)},async(_url,init)=>Response.json(f.reply(JSON.parse(init.body))),component,exportName);
 try{ui.flush();assert.equal(ui.calls.length,0);await ui.click('포장 규격 초안 작성');assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].method,'POST');assert.ok(ui.calls[0].url.endsWith('/quotation-packaging-draft'));
  assert.equal(ui.button('확인한 초안을 입력란에 적용').props.disabled,true);assert.match(JSON.stringify(ui.render()),/실측값이 아닙니다/);
  ui.checkbox(1).props.onChange({target:{checked:true}});await ui.click('확인한 초안을 입력란에 적용');assert.equal(applied.length,1);assert.equal(applied[0].length,4);assert.equal(ui.calls.length,1);assert.deepEqual(busy,[true,false]);assert.equal(ui.button('확인한 초안을 입력란에 적용'),undefined);
 }finally{ui.unmount();}
});

test('empty-draft UI distinguishes explicit AI abstention from malformed responses without applying values',async()=>{
 const f=setup(),applied=[];
 const plan=helper.buildQuotationPackagingDraftPlan(f.view,f.f.options,{title:'PRIVATE_PRODUCT_TEXT',description:'PRIVATE_DESCRIPTION',attributes:[]},{optionId:f.props.optionId,applyToAllOptions:true});
 const text=tree=>nodes(tree).map(node=>node.props.children).flat(Infinity).filter(value=>['string','number'].includes(typeof value)).join(' ').replace(/\s+/gu,' ').trim();
 for(const valid of [true,false]){
  const response=helper.completeQuotationPackagingDraft(plan,packagingResponse(valid?plan.targets.map((_,index)=>packagingItem({index,requested:{weight:true,dimensions:true}},{})):[]),1);
  const ui=quotationAiUI({...f.props,onApply:changes=>{applied.push(changes);return true;}},async()=>Response.json(response),component,exportName);
  try{
   await ui.click('포장 규격 초안 작성');const rendered=text(ui.render());
   assert.match(rendered,/packaging-estimate-v4/);assert.match(rendered,/응답 계약 V 2/);
   if(valid){assert.match(rendered,/AI 응답 확인: 요청 2 개 · 응답 2 개/);assert.match(rendered,/AI가 상품 종류·형태 정보 부족 사유로 포장 사이즈 추정을 보류했다고 응답/);assert.match(rendered,/사이즈 보류: 상품 종류·형태 정보 부족/);}
   else{assert.match(rendered,/invalid-package-count/);assert.match(rendered,/응답 형식 오류/);assert.doesNotMatch(rendered,/보류했다고 응답/);}
   assert.doesNotMatch(rendered,/PRIVATE_PRODUCT_TEXT|PRIVATE_DESCRIPTION/);assert.equal(ui.button('확인한 초안을 입력란에 적용').props.disabled,true);assert.equal(applied.length,0);assert.equal(ui.calls.length,1);
  }finally{ui.unmount();}
 }
 const response=helper.completeQuotationPackagingDraft(plan,packagingResponse([]),1),forged={...response,diagnostics:{...response.diagnostics,raw:'PRIVATE_PROVIDER_TEXT'}};
 const rejected=quotationAiUI(f.props,async()=>Response.json(forged),component,exportName);
 try{await rejected.click('포장 규격 초안 작성');assert.match(rejected.alerts().join(' '),/진단 형식/);assert.doesNotMatch(text(rejected.render()),/PRIVATE_PROVIDER_TEXT/);assert.equal(rejected.button('확인한 초안을 입력란에 적용'),undefined);}
 finally{rejected.unmount();}
});
test('scope switching discards previous drafts and selected-only requests cannot copy estimates to other options',async()=>{
 const f=setup(),applied=[];const ui=quotationAiUI({...f.props,onApply:changes=>{applied.push(changes);return true;}},async(_url,init)=>Response.json(f.reply(JSON.parse(init.body))),component,exportName);
 try{await ui.click('포장 규격 초안 작성');ui.checkbox(0).props.onChange({target:{checked:false}});assert.equal(ui.button('확인한 초안을 입력란에 적용'),undefined);
  await ui.click('포장 규격 초안 작성');assert.equal(ui.calls[1].body.applyToAllOptions,false);ui.checkbox(1).props.onChange({target:{checked:true}});await ui.click('확인한 초안을 입력란에 적용');assert.ok(applied[0].every(row=>row.optionId===f.props.optionId));
 }finally{ui.unmount();}
});
test('source change during request aborts and ignores the old response without adding editor changes',async()=>{
 const f=setup(),applied=[],busy=[];let resolve;const waiting=new Promise(done=>{resolve=done;});
 const props={...f.props,onApply:changes=>{applied.push(changes);return true;},onBusyChange:value=>busy.push(value)},ui=quotationAiUI(props,()=>waiting,component,exportName);
 try{ui.flush();ui.button('포장 규격 초안 작성').props.onClick();assert.equal(ui.calls.length,1);
  ui.render({...props,view:{...f.view,revision:1}});resolve(Response.json(f.reply(ui.calls[0].body)));await ui.idle();assert.equal(applied.length,0);assert.equal(ui.button('확인한 초안을 입력란에 적용'),undefined);assert.deepEqual(busy,[true,false]);
 }finally{ui.unmount();}
});
test('disabled/manual-edited state cannot generate or apply a cached proposal',async()=>{
 const f=setup(),applied=[],props={...f.props,onApply:changes=>{applied.push(changes);return true;}},ui=quotationAiUI(props,async(_url,init)=>Response.json(f.reply(JSON.parse(init.body))),component,exportName);
 try{await ui.click('포장 규격 초안 작성');ui.checkbox(1).props.onChange({target:{checked:true}});ui.render({...props,disabled:true});assert.equal(ui.button('포장 규격 초안 작성').props.disabled,true);assert.equal(ui.button('확인한 초안을 입력란에 적용').props.disabled,true);ui.button('확인한 초안을 입력란에 적용').props.onClick();assert.equal(applied.length,0);assert.equal(ui.calls.length,1);
 }finally{ui.unmount();}
});
test('actual editor entry stages exact option changes and only explicit Save persists them with pack-basis guards',async()=>{
 const f=await apiFixture(companies[0],aiFixture({company:companies[0]}).snapshot);let ui;
 try{
  const read=()=>f.h.route(f.base+'/quotation-fields'+f.query),view=await(await read()).json();
  ui=quotationLabelFormUI({productId:f.id,load:f.h.load,request:(path,init={})=>f.h.route(path.startsWith(f.base+'/quotation-fields')&&!path.includes('?')?path+f.query:path,{method:init.method??'GET',body:init.body}),renderDocument:()=>assert.fail('packaging never renders images')});await ui.idle();ui.selectOption('synthetic-one');
  const boundary=nodes(ui.render().tree).find(node=>node.type==='@/app/components/quotation-packaging-draft-panel');assert.ok(boundary,'real editor exposes the packaging draft entry '+JSON.stringify({alerts:ui.alerts(),types:nodes(ui.render().tree).map(node=>node.type).filter(value=>typeof value==='string'&&value.includes('packag'))}));
  const selectedView=boundary.props.view,options=await f.h.load('db/product-options.ts').readProductOptions('owner',f.id),plan=f.h.load('app/quotation-packaging-draft.ts').buildQuotationPackagingDraftPlan(selectedView,options,{title:'合成后跟贴',description:'',attributes:[]},{optionId:null,applyToAllOptions:true}),draft=legacyPackagingDraft(f.h.load('app/quotation-packaging-draft.ts'),plan);
  const changes=f.h.load('app/quotation-packaging-draft.ts').quotationPackagingDraftChanges(selectedView,draft,f.id,{optionId:null,applyToAllOptions:true}),drafts=f.h.load('app/quotation-packaging-draft.ts').quotationPackagingDraftInputs(selectedView,draft,f.id,{optionId:null,applyToAllOptions:true}),before=f.state();
  assert.equal(boundary.props.onApply(changes,drafts),true);assert.equal(f.state(),before,'apply writes to the unsaved editor only');assert.equal(ui.button('견적 입력 저장').props.disabled,false);
  await ui.click('견적 입력 저장');assert.equal(ui.savedNotifications,1);const saved=await(await read()).json();
  for(const change of changes)assert.equal(saved.resolved.rows.find(row=>row.optionId===change.optionId).fields[change.fieldKey].value,change.value);
  assert.ok(saved.packagingBasis);assert.equal((await f.h.load('db/product-options.ts').readProductOptions('owner',f.id)).rows[0].packagedWeightG,null,'draft adoption never rewrites supplier physical facts');
  for(const change of changes){assert.deepEqual(saved.packagingBasis.options[change.optionId][change.fieldKey].nonMeasuredDraft,{origin:'couplus-fallback',measured:false});assert.ok(saved.resolved.rows.find(row=>row.optionId===change.optionId).fields[change.fieldKey].reviewMessages.some(message=>message.includes('실측값이 아닙니다')));}
  assert.equal(view.optionPackQuantities['synthetic-one'],1);
 }finally{ui?.close();f.close();}
});
test('lost Save acknowledgement recovers exact alias metadata from readback without a second write',async()=>{
 const f=await apiFixture(companies[0],aiFixture({company:companies[0]}).snapshot);let ui,puts=0;
 try{
  ui=quotationLabelFormUI({productId:f.id,load:f.h.load,request:async(path,init={})=>{const response=await f.h.route(path.startsWith(f.base+'/quotation-fields')&&!path.includes('?')?path+f.query:path,{method:init.method??'GET',body:init.body});if(init.method==='PUT'){puts++;throw new TypeError('synthetic lost acknowledgement');}return response;},renderDocument:()=>assert.fail('no image rendering')});await ui.idle();ui.selectOption('synthetic-one');
  const boundary=nodes(ui.render().tree).find(node=>node.type==='@/app/components/quotation-packaging-draft-panel'),view=boundary.props.view,options=await f.h.load('db/product-options.ts').readProductOptions('owner',f.id),helper=f.h.load('app/quotation-packaging-draft.ts'),scope={optionId:null,applyToAllOptions:true};
  const result=legacyPackagingDraft(helper,helper.buildQuotationPackagingDraftPlan(view,options,{title:'合成包装',description:'',attributes:[]},scope)),changes=helper.quotationPackagingDraftChanges(view,result,f.id,scope),drafts=helper.quotationPackagingDraftInputs(view,result,f.id,scope);
  assert.equal(boundary.props.onApply(changes,drafts),true);await ui.click('견적 입력 저장');assert.equal(ui.savedNotifications,0);assert.equal(puts,1);assert.equal(ui.button('견적 입력 저장').props.disabled,false);
  await ui.click('기본값 다시 반영');assert.equal(ui.button('견적 입력 저장').props.disabled,true);assert.equal(puts,1);assert.match(JSON.stringify(ui.render().tree),/실측값이 아닙니다/);
 }finally{ui?.close();f.close();}
});
for(const sourceAction of ['edit','reset'])test(`real bulk copy seals target draft provenance before source ${sourceAction}`,async()=>{
 const f=await apiFixture(companies[0],aiFixture({company:companies[0]}).snapshot);let ui;const writes=[];
 try{
  const optionModel=f.h.load('app/product-options.ts'),store=f.h.load('db/product-options.ts'),old=await store.readProductOptions('owner',f.id),product=await f.h.load('db/queries.ts').findProduct('owner',f.id);
  const inputs=optionModel.optionInputs(old);inputs.push({...inputs[0],id:'synthetic-two',originalName:'白色',translatedName:'흰색',supplierSku:'SYNTHETIC-TWO',unitsPerPack:3});
  const updated=optionModel.applyOptionRows(old,inputs,new Date(Date.parse(product.updated_at)+1).toISOString());assert.ok(await store.saveProductOptions('owner',updated,old.revision,product.updated_at));
  ui=quotationLabelFormUI({productId:f.id,load:f.h.load,request:(path,init={})=>{if(init.method==='PUT')writes.push(JSON.parse(init.body));return f.h.route(path.startsWith(f.base+'/quotation-fields')&&!path.includes('?')?path+f.query:path,{method:init.method??'GET',body:init.body});},renderDocument:()=>assert.fail('no image rendering')});await ui.idle();ui.selectOption('synthetic-one');
  const boundary=nodes(ui.render().tree).find(node=>node.type==='@/app/components/quotation-packaging-draft-panel'),view=boundary.props.view,helper=f.h.load('app/quotation-packaging-draft.ts'),scope={optionId:'synthetic-one',applyToAllOptions:false};
  const result=legacyPackagingDraft(helper,helper.buildQuotationPackagingDraftPlan(view,updated,{title:'合成包装',description:'',attributes:[]},scope)),changes=helper.quotationPackagingDraftChanges(view,result,f.id,scope),drafts=helper.quotationPackagingDraftInputs(view,result,f.id,scope),weight=changes.find(change=>!change.value.includes('*'));
  assert.equal(boundary.props.onApply(changes,drafts),true);
  const card=()=>nodes(ui.render().tree).find(node=>node.type==='div'&&node.props.className?.startsWith('quotation-field ')&&nodes(node).some(input=>input.props.id?.endsWith('-'+weight.fieldKey)));
  const checkbox=nodes(card()).find(node=>node.type==='input'&&node.props.type==='checkbox');assert.ok(checkbox);checkbox.props.onChange({target:{checked:true}});
  await ui.click('적용 범위 미리보기');await ui.click('확인한 범위에 적용');
  if(sourceAction==='edit')ui.field(weight.fieldKey).props.onChange({target:{value:'110'}});
  else{const reset=nodes(card()).find(node=>node.type==='button'&&String(node.props.children).startsWith('수정 해제'));assert.ok(reset);reset.props.onClick();}
  await ui.idle();await ui.click('견적 입력 저장');assert.equal(ui.savedNotifications,1);assert.equal(writes.length,1);
  const targetMetadata=writes[0].packagingDrafts.filter(item=>item.optionId==='synthetic-two');assert.ok(targetMetadata.length);assert.ok(targetMetadata.every(item=>item.value==='100'&&item.unitsPerPack===3&&item.measured===false));
  const saved=await(await f.h.route(f.base+'/quotation-fields'+f.query)).json(),target=saved.resolved.rows.find(row=>row.optionId==='synthetic-two');
  for(const metadata of targetMetadata){assert.equal(target.fields[metadata.fieldKey].value,'100');assert.deepEqual(saved.packagingBasis.options['synthetic-two'][metadata.fieldKey].nonMeasuredDraft,{origin:'couplus-fallback',measured:false});assert.ok(target.fields[metadata.fieldKey].reviewMessages.some(message=>message.includes('실측값이 아닙니다')));}
  assert.equal((await store.readProductOptions('owner',f.id)).rows.find(row=>row.id==='synthetic-two').packagedWeightG,null);assert.equal(f.h.aiSources.length,0);
 }finally{ui?.close();f.close();}
});
