import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationLabelFormUI} from './helpers/quotation-label-form-ui.mjs';

const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const plain=value=>JSON.parse(JSON.stringify(value));
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/quotation-brand-input.tsx',import.meta.url),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
}).outputText,{exports,require(name){assert.equal(name,'react/jsx-runtime');return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};}});
const Input=exports.QuotationBrandInput;
const cell=value=>({value,source:'manual-option',needsReview:false,issues:[]});

test('brand choices are product settings suggestions, never inferred from attribute labels or used over enums',()=>{
 const h=mobileIntakeHarness();try{
  const model=h.load('app/quotation-brand-choices.ts'),base={id:'brand',type:'text',readOnly:false};
  assert.deepEqual(plain(model.registrationBrandChoices(' 첫 브랜드 , 둘째, , 첫 브랜드 ')),['첫 브랜드','둘째','첫 브랜드']);
  assert.deepEqual(plain(model.registrationBrandChoices(null)),[]);
  assert.equal(model.usesRegistrationBrandChoices(base),true);
  assert.equal(model.usesRegistrationBrandChoices({...base,id:'original-wire',hubInput:'brand'}),true);
  assert.equal(model.usesRegistrationBrandChoices({...base,hubWire:{path:['productPage','brand']}},['productPage / brand']),false);
  assert.equal(model.usesRegistrationBrandChoices({...base,hubWire:{path:['productPage','brand']}},['productPage']),false);
  assert.equal(model.usesRegistrationBrandChoices(base,['productPage / modelNumber']),true);
  for(const field of [{...base,readOnly:true},{...base,type:'select',choices:[{value:'',label:'공식 미입력'}]},
   {...base,choices:[{value:'CONST',label:'고정'}]},{...base,id:'material',label:'브랜드 관련 소재'}])assert.equal(model.usesRegistrationBrandChoices(field),false);
 }finally{h.close();}
});

test('malformed or excessive optional brand suggestions cannot crash or replace a retained value',()=>{
 for(const brands of [null,{},'not-an-array',[1],['x'.repeat(501)],Array(501).fill('brand')]){
  const changes=[],input=Input({brands,cell:cell('저장한 브랜드'),id:'brand',disabled:false,onChange:value=>changes.push(value)});
  assert.equal(input.props.value,'retained');assert.equal(nodes(input).filter(node=>node.type==='option').length,2);assert.deepEqual(changes,[]);
 }
});

test('empty, default-list and retained values render without changing anything; only explicit valid choices emit exact text',()=>{
 const changes=[],props={brands:['와이홉','유앤채'],id:'brand',disabled:false,onChange:value=>changes.push(value)};
 for(const value of ['', '와이홉', '목록 밖 직접 브랜드']){
  const tree=Input({...props,cell:cell(value)});
  assert.equal(changes.length,0);assert.equal(tree.props.value,value===''?'none':value==='와이홉'?'brand-0':'retained');
  const options=nodes(tree).filter(node=>node.type==='option');assert.equal(options[0].props.children,'브랜드 없음');
  if(value.startsWith('목록'))assert.match(options.find(option=>option.props.value==='retained').props.children.join(''),/목록 밖 직접 브랜드/);
 }
 const input=Input({...props,cell:cell('목록 밖 직접 브랜드')});
 input.props.onChange({target:{value:'brand-1'}});input.props.onChange({target:{value:'none'}});
 input.props.onChange({target:{value:'retained'}});input.props.onChange({target:{value:'brand-20'}});
 assert.deepEqual(changes,['유앤채','']);
 Input({...props,cell:cell(''),disabled:true}).props.onChange({target:{value:'brand-0'}});assert.equal(changes.length,2);
});

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test('current product captured brands enter the real quotation form; explicit save persists None/selected brand and keeps another option ('+company.companyCode+')',async()=>{
 const h=mobileIntakeHarness(company);let ui;
 try{
  h.context.settings.brand=company.companyName+', 다른 등록 브랜드';
  h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  await h.load('db/category-profiles.ts').createCategoryProfile('owner',h.context.category,'cat');
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,endpoint=base+'/quotation-fields';
  let view=await json(await h.route(endpoint));assert.deepEqual(view.registrationBrandChoices,[company.companyName,'다른 등록 브랜드']);
  const optionId=view.resolved.rows.find(row=>row.optionId!==null).optionId,otherId=view.resolved.rows.find(row=>row.optionId!==null&&row.optionId!==optionId).optionId;
  await json(await h.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,
   changes:[{fieldKey:'brand',optionId,value:'목록 밖 기존 수동 브랜드'},{fieldKey:'brand',optionId:otherId,value:'다른 옵션 전용 브랜드'}]}}));
  const beforeOther=h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(product.id).payload,requests=[],recordedIntakeCalls=[...h.network];
  const request=async(path,init={})=>{requests.push({path,method:init.method??'GET'});return h.route(path,{method:init.method??'GET',...(init.body?{body:init.body}:{})});};
  ui=quotationLabelFormUI({productId:product.id,load:h.load,request,renderDocument:async()=>{throw Error('brand edits never render an image');}});await ui.idle();ui.selectOption(optionId);ui.section('상품 정보');
  const brand=()=>nodes(ui.render().tree).find(node=>node.type==='@/app/components/quotation-brand-input');
  assert.ok(brand(),'real form uses brand selector');assert.equal(brand().props.cell.value,'목록 밖 기존 수동 브랜드');
  const writes=()=>requests.filter(entry=>entry.method!=='GET');assert.equal(writes().length,0);
  const retired=Input(brand().props);
  ui.selectOption(otherId);retired.props.onChange({target:{value:'brand-1'}});
  assert.equal(writes().length,0);assert.equal(brand().props.cell.value,'다른 옵션 전용 브랜드');
  ui.selectOption(optionId);retired.props.onChange({target:{value:'none'}});
  assert.equal(brand().props.cell.value,'목록 밖 기존 수동 브랜드');assert.equal(ui.button('견적 입력 저장').props.disabled,true);
  Input(brand().props).props.onChange({target:{value:'none'}});assert.equal(writes().length,0);assert.equal(brand().props.cell.value,'');
  await ui.click('견적 입력 저장');assert.equal(writes().length,1);
  view=await json(await h.route(endpoint));assert.equal(view.overrides.options[optionId].brand,'');assert.equal(view.overrides.options[otherId].brand,'다른 옵션 전용 브랜드');
  Input(brand().props).props.onChange({target:{value:'brand-1'}});await ui.click('견적 입력 저장');
  assert.equal(writes().length,2);view=await json(await h.route(endpoint));assert.equal(view.overrides.options[optionId].brand,'다른 등록 브랜드');
  assert.equal(view.overrides.options[otherId].brand,'다른 옵션 전용 브랜드');
  assert.equal(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(product.id).payload,beforeOther);assert.deepEqual(h.network,recordedIntakeCalls);
 }finally{ui?.close();h.close();}
});
