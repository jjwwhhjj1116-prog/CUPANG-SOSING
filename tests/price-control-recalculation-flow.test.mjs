import test from 'node:test';
import assert from 'node:assert/strict';
import {componentUI,nodes,text,plain,companies,available,zeroMinimumFixture,json} from './helpers/pricing-stage-two-zero-minimum.mjs';

const initial={exchangeRate:350,supplyMargin:50,coupangMargin:40,minimumMargin:3000,msrpMultiple:1.3,roundingUnit:10,roundingMode:'nearest',arithmeticMode:'couplus-number-v1'};
const field=(ui,label)=>nodes(ui.render()).find(node=>node.type==='label'&&nodes(node.props.children).some(child=>child.type==='span'&&child.props.children===label)).props.children[1];
const preview=ui=>nodes(ui.render()).find(node=>node.type?.name==='OptionPricePreview').props;
const submit=ui=>ui.render().props.onSubmit({preventDefault(){}});

test('a price control change stages the observed 11000/18330 calculation and replacement intent without a separate button or write',async()=>{
 const writes=[],states=[],props={initial,sourcePrice:20,productId:'local',version:'local-version',onSave:async(policy,options)=>{writes.push(plain({policy,options}));props.initial=policy;},onDraftStateChange:state=>states.push(state)};
 const ui=componentUI('app/components/price-editor.tsx','PriceEditor',{props});
 assert.equal(preview(ui).policy.recalculationMode,undefined);assert.equal(preview(ui).replaceReviewedPrices,false);assert.match(text(ui.render()),/14,000원/);
 field(ui,'환율 (원/CNY)').props.onChange({target:{value:'400'}});
 assert.deepEqual(writes,[]);assert.equal(preview(ui).replaceReviewedPrices,true);assert.equal(preview(ui).policy.recalculationMode,'couplus-stage-two-v1');assert.equal(preview(ui).policy.exchangeRate,400);
 assert.match(text(ui.render()),/11,000원/);assert.match(text(ui.render()),/18,330원/);assert.match(text(ui.render()),/직접 입력한 공급가·판매가·권장소비자가도 새 계산값/);assert.equal(states.at(-1).dirty,true);
 await submit(ui);assert.equal(writes.length,1);assert.equal(writes[0].options.recalculate,true);assert.equal(writes[0].policy.recalculationMode,'couplus-stage-two-v1');assert.equal(ui.render().props['data-workspace-dirty'],false);
});

test('all pricing controls share the staged trigger, preserve the selected rounding mode, and retain explicit ON zero',()=>{
 const cases=[['환율 (원/CNY)',{value:'400'}],['목표 공급 마진 (%)',{value:'65'}],['쿠팡 마진 (%)',{value:'35'}],['최소 공급 마진 (원)',{value:'0'}],['시장가격 배수',{value:'1.5'}],['가격 처리 단위',{value:'100'}],['가격 처리 방식',{value:'up'}],['통합통관 환율 사용',{checked:true}],['통합통관 적용환율 (CNY → KRW)',{value:'330'}],['최소 공급 마진 보장',{checked:false}]];
 for(const [label,target]of cases){
  const props={initial:{...initial,...(label==='통합통관 적용환율 (CNY → KRW)'?{useIntegratedRate:true,integratedRate:300}:{})},sourcePrice:20,productId:'local',version:'v1',onSave:async()=>assert.fail('editing is local')};
  const ui=componentUI('app/components/price-editor.tsx','PriceEditor',{props});field(ui,label).props.onChange({target});
  const p=preview(ui);assert.equal(p.replaceReviewedPrices,true,label);assert.equal(p.policy.recalculationMode,'couplus-stage-two-v1',label);
  if(label==='최소 공급 마진 (원)'){assert.equal(p.policy.recalculationMinimumEnabled,true);assert.match(text(ui.render()),/7,000원/);}
  if(label==='최소 공급 마진 보장'){assert.equal(p.policy.minimumMargin,0);assert.equal(p.policy.recalculationMinimumEnabled,false);assert.match(text(ui.render()),/14,000원/);}
  if(label==='가격 처리 방식')assert.equal(p.policy.roundingMode,'up');
 }
});

test('disabled, stale-scope and in-flight control callbacks cannot create replacement intent; invalid input cannot save',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve),writes=[],props={initial,sourcePrice:20,productId:'first',version:'v1',onSave:async(policy,options)=>{writes.push(plain({policy,options}));await pending;props.initial=policy;}};
 const ui=componentUI('app/components/price-editor.tsx','PriceEditor',{props}),retained=field(ui,'환율 (원/CNY)').props.onChange;
 ui.update({productId:'second'});ui.render();retained({target:{value:'999'}});assert.equal(preview(ui).replaceReviewedPrices,false);assert.equal(preview(ui).policy.exchangeRate,350);
 const retainedCurrent=field(ui,'환율 (원/CNY)').props.onChange,retainedSubmit=ui.render().props.onSubmit,retainedButton=nodes(ui.render()).find(node=>node.type==='button'&&node.props.children==='일괄 재계산').props.onClick;
 ui.update({disabled:true});ui.render();retainedCurrent({target:{value:'999'}});field(ui,'환율 (원/CNY)').props.onChange({target:{value:'999'}});retainedButton();await retainedSubmit({preventDefault(){}});assert.equal(preview(ui).replaceReviewedPrices,false);assert.equal(writes.length,0);
 ui.update({disabled:false});field(ui,'환율 (원/CNY)').props.onChange({target:{value:''}});await submit(ui);assert.equal(writes.length,0);assert.ok(nodes(ui.render()).some(node=>node.props?.role==='alert'));
 const change=field(ui,'환율 (원/CNY)').props.onChange;change({target:{value:'400'}});const save=submit(ui);change({target:{value:'999'}});await submit(ui);assert.equal(writes.length,1);assert.equal(preview(ui).policy.exchangeRate,400);
 release();await save;assert.equal(preview(ui).replaceReviewedPrices,false);assert.equal(ui.render().props['data-workspace-dirty'],false);
});

for(const company of companies)for(const integrated of [false,true])test(`policy input alone reaches reviewed options, stage seven and official price columns (${company.code}, ${integrated?'integrated':'normal'})`,{skip:!available},async()=>{
 const f=await zeroMinimumFixture(company,{pack:2,integrated}),{h}=f;
 try{
  const product=await f.product(),savedPolicy=JSON.parse(product.pricing_policy),beforeQuote=await f.read(),targets=h.load('app/quotation-price-targets.ts').quotationPriceTargets(beforeQuote.resolved.schema.fields);
  const changes=beforeQuote.resolved.rows.filter(row=>row.optionId!==null).flatMap(row=>['supplyPrice','salePrice','msrp'].flatMap(key=>targets[key].linked.map(fieldKey=>({fieldKey,optionId:row.optionId,value:key==='msrp'?'':key==='salePrice'?'199000':'99000'}))));
  changes.push({fieldKey:'brand',optionId:null,value:'직접 검토한 회사별 브랜드 '+company.name});
  await json(await h.route(f.base+'/quotation-fields',{method:'PUT',body:{expectedRevision:beforeQuote.revision,expectedInputFingerprint:beforeQuote.inputFingerprint,changes}}));
  const stable=f.immutable(),allBefore=f.allTables(),objects=f.objectSnapshot(),writes=[],props={initial:savedPolicy,sourcePrice:product.source_price_cny,productId:f.productId,profileId:f.profile.id,version:product.updated_at,onSave:async(policy,options)=>{
   const current=await f.product();writes.push(plain({policy,options}));await json(await h.route(f.base+'/pricing',{method:'POST',body:{policy,expectedVersion:current.updated_at,...options}}));props.initial=policy;props.version=(await f.product()).updated_at;
  }};
  const ui=componentUI('app/components/price-editor.tsx','PriceEditor',{props,loader:h.load});
  field(ui,'환율 (원/CNY)').props.onChange({target:{value:'400'}});assert.equal(f.allTables(),allBefore);assert.equal(f.objectSnapshot(),objects);assert.equal(writes.length,0);
  await submit(ui);assert.equal(writes.length,1);assert.equal(writes[0].options.recalculate,true);assert.equal(writes[0].options.profileId,f.profile.id);
  const quote=await f.read(),options=await json(await h.route(f.base+'/options')),book=await f.workbook(),expected=integrated?[['20230','33720','43840'],['5060','8430','10960']]:[['23480','39130','50870'],['5090','8480','11020']];
  assert.deepEqual(book.preview.report.company,company);assert.equal(JSON.parse((await f.product()).pricing_policy).recalculationMode,'couplus-stage-two-v1');
  for(let index=0;index<2;index++){
   const fields=quote.resolved.rows.find(row=>row.optionId===options.options.rows[index].id).fields;
   assert.deepEqual(['supplyPrice','salePrice','msrp'].map(key=>fields[targets[key].primary].value),expected[index]);
   assert.deepEqual(plain(book.cells[index].slice(29,32)),expected[index]);
   for(const key of ['supplyPrice','salePrice','msrp'])assert.equal(String(options.pricing.rows[index].calculation[key]),fields[targets[key].primary].value);
  }
  assert.equal(quote.overrides.common.brand,'직접 검토한 회사별 브랜드 '+company.name);assert.equal(f.immutable(),stable);assert.equal(f.objectSnapshot(),objects);
  assert.equal(h.network.length,0);assert.equal(h.aiSources.length,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n,0);assert.equal((await f.product()).supplier_hub_status,'미전송');
 }finally{h.close();}
});
