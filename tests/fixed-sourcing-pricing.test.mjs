import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule as load} from './helpers/provided-option-quotation.mjs';
const {calculatePrice,pricePolicy}=load('app/pricing.ts');
const base={exchangeRate:310,supplyMargin:50,coupangMargin:45,minimumMargin:3000,msrpMultiple:1.3,roundingUnit:10,roundingMode:'nearest',arithmeticMode:'couplus-number-v1',useIntegratedRate:true,integratedRate:290};
const basis=(referenceCny,salePrice,supplyPrice,purchaseCost)=>({...base,fixedSourcing:{version:1,referenceCny,salePrice,supplyPrice,purchaseCost,sourceUnitsPerPack:1}});
const cases=[[[4.8,4.8,4.8,4.8,4.8,4.8],9800,5390,2499],[[3.9],6900,3795,2021],[[3.63],8600,4730,2126],[[2.7],8580,4719,1252],[[5.89,5.89,5.89,5.89,5.89],9700,5335,2563],[[4.15],9900,5445,2148],[[3.3,4.6,5.6,2.6,3.6],8900,4895,1957],[[6,6,6,6,6],9900,5445,2569],[[7,14,21,27,31],17300,9515,4206],[[4.8,4.8,4.8,4.8,4.8,4.8],10500,5775,2738]];
test('ten recorded fixed bases reproduce all 36 native supply/sale/MSRP and selected costs',()=>{
 let count=0;
 for(const [index,[cny,sale,supply,cost]] of cases.entries())for(const [position,value] of cny.entries()){
  const expected=index===6?[[2181,6220,11300,14690],[2595,8660,15750,20480],[2914,10540,19170,24920],[1957,4895,8900,11570],[2276,6780,12330,16030]][position]:index===8?[[4206,9515,17300,22490],[6439,19030,34600,44980],[8672,28550,51900,67470],[10586,36700,66730,86750],[11862,42140,76620,99610]][position]:[cost,supply,sale,Math.round(sale*1.3/10)*10];
  const actual=calculatePrice(value,basis(Math.min(...cny),sale,supply,cost));
  assert.deepEqual([actual.costKrw,actual.supplyPrice,actual.salePrice,actual.msrp],expected,`case ${index+1} option ${position+1}`);count++;
 }
 assert.equal(count,36);
});
test('fixed margin gate uses 25 percent of selling and keeps exact explicit supply',()=>{
 assert.equal(calculatePrice(2.7,basis(2.7,8580,4719,1252)).supplyPrice,4719);
 assert.throws(()=>calculatePrice(2,basis(2,10000,5000,2501)),/25%/);
 assert.equal(calculatePrice(2,basis(2,10000,5000,2500)).costKrw,2500);
});
test('fixed purchase cost scales source pack first then adds independently rounded integrated pack delta',()=>{
 const p=basis(2.6,30000,16500,1957);p.fixedSourcing.sourceUnitsPerPack=2;
 assert.equal(calculatePrice(3.3,p,3).costKrw,Math.round(1957/2*3)+Math.round((3.3*3*290+300)*1.1)-Math.round((2.6*3*290+300)*1.1));
 const missing=basis(2.6,30000,16500,1957);delete missing.fixedSourcing.purchaseCost;
 assert.equal(calculatePrice(3.3,missing,2).costKrw,Math.round((3.3*2*290+300)*1.1));
});
test('fixed basis is validated and retained while absent policy remains identical',()=>{
 const p=basis(4.8,9800,5390,2499);assert.equal(JSON.stringify(pricePolicy(p).fixedSourcing),JSON.stringify(p.fixedSourcing));
 for(const patch of [{version:2},{referenceCny:0},{salePrice:-1},{supplyPrice:0},{purchaseCost:NaN},{sourceUnitsPerPack:1.5},{unknown:1}])assert.throws(()=>pricePolicy({...p,fixedSourcing:{...p.fixedSourcing,...patch}}));
 assert.equal(Object.hasOwn(pricePolicy(base),'fixedSourcing'),false);
 assert.throws(()=>calculatePrice(1e308,p,Number.MAX_SAFE_INTEGER));
});
test('fixed reference survives single-option consumers and auto-bundle preserves explicit current quantity',()=>{
 const {calculateOptionPrices,emptyOptionInput}=load('app/product-options.ts'),{recalculateStageTwoRows}=load('app/stage-two-pricing.ts');
 const p={...basis(2.6,8900,4895,1957),bundleEnabled:true,bundleCriterion:'supplyMargin',bundleMinimumSupplyMargin:3000,bundleMinimumCoupangMargin:3000};
 const row={...emptyOptionInput('a'),unitCostCny:3.3,included:true};
 assert.equal(calculateOptionPrices([row],p)[0].calculation.salePrice,11300);
 assert.equal(recalculateStageTwoRows([row],p)[0].unitsPerPack,1);
});

test('bulk preview invalidates when only selected fixed sourcing basis changes',()=>{
 const tools=load('app/option-editor-tools.ts'),p=basis(2.6,8900,4895,1957);
 assert.notEqual(tools.optionBulkPriceBase(p),tools.optionBulkPriceBase({...p,fixedSourcing:{...p.fixedSourcing,purchaseCost:1958}}));
});
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {stageTwoFixture,json,plain} from './helpers/stage-two-pricing.mjs';
function policyUI(initial,referenceCny){
 let policy=initial,saved,ref;
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/stage-two-price-policy-fields.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require(name){if(name==='react')return{useRef:value=>ref??(ref={current:value})};if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(name.endsWith('.css'))return{};if(name==='@/app/pricing')return load('app/pricing.ts');throw Error(name);}});
 const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
 const tree=()=>exports.StageTwoPricePolicyFields({policy,referenceCny,onChange:next=>policy=next,onRecalculate(){},onSave(){saved=pricePolicy(policy);},dirty:true,busy:false});
 return{field(label){const field=nodes(tree()).find(value=>value.props?.['aria-label']===label);assert.ok(field,label);return field;},policy:()=>policy,saved:()=>saved};
}
test('fixed stage-two controls bind lowest selected CNY once and retain optional blanks through save and reload',()=>{
 const ui=policyUI(base,2.6);ui.field('고정 소싱가격 사용').props.onChange({target:{checked:true}});
 ui.field('소싱 판매가 (원)').props.onChange({target:{value:'8900'}});ui.field('소싱 공급가 (원)').props.onChange({target:{value:'4895'}});ui.field('선택 매입원가 (원)').props.onChange({target:{value:'1957'}});
 ui.field('가격 설정 저장하기').props.onClick();assert.equal(ui.saved().fixedSourcing.referenceCny,2.6);assert.equal(calculatePrice(3.3,ui.saved()).costKrw,2181);
 const reload=policyUI(JSON.parse(JSON.stringify(ui.saved())),3.3);assert.equal(reload.field('소싱 기준 CNY').props.value,2.6);
 reload.field('소싱 공급가 (원)').props.onChange({target:{value:''}});assert.equal(Object.hasOwn(reload.policy().fixedSourcing,'supplyPrice'),false);
 reload.field('고정 소싱가격 사용').props.onChange({target:{checked:false}});assert.equal(Object.hasOwn(reload.policy(),'fixedSourcing'),false);
});
test('fixed policy atomic receipt, next read and review retain basis and reject basis tampering',async()=>{
 const h=await stageTwoFixture();try{
  const before=await json(await h.get()),request=h.body(before);request.policy=basis(2.99,9800,5390,2499);request.recalculate=true;
  const after=await json(await h.post(request));h.load('app/stage-two-pricing.ts').verifyStageTwoPricingReceipt(before.options,before.quotation,request,after);
  assert.deepEqual(after.options.pricing.policy.fixedSourcing,request.policy.fixedSourcing);assert.deepEqual(await json(await h.get()),after);
  assert.equal(after.options.pricing.rows[0].calculation.costKrw,2499);assert.equal(after.quotation.automatic.rows.find(row=>row.optionId==='row-a').fields.supplyPrice.value,'5390');
  const tamper=plain(after);tamper.options.pricing.policy.fixedSourcing.referenceCny=3;assert.throws(()=>h.load('app/stage-two-pricing.ts').verifyStageTwoPricingReceipt(before.options,before.quotation,request,tamper));
  const next=h.body(after);next.rows[0].unitCostCny=4;const changed=await json(await h.post(next));assert.equal(changed.options.pricing.policy.fixedSourcing.referenceCny,2.99);assert.ok(changed.options.pricing.rows[0].calculation.salePrice>9800);
 }finally{h.close();}
});
test('fixed basis recalculation preserves existing manual quote prices and explicit blanks',async()=>{
 const h=await stageTwoFixture();try{
  const old={schemaVersion:1,productId:h.id,revision:1,overrides:{common:{supplyPrice:'5391'},options:{'row-a':{salePrice:'12000',msrp:''}}},updatedAt:h.product.updated_at};h.sqlite.prepare('INSERT INTO product_quotation_fields VALUES(?,?,?,?,?)').run(h.id,h.owner,1,JSON.stringify(old),old.updatedAt);
  const before=await json(await h.get()),request=h.body(before);request.policy=basis(2.99,9800,5390,2499);request.recalculate=true;
  const result=await json(await h.post(request));assert.deepEqual(result.quotation.overrides,old.overrides);
  h.load('app/stage-two-pricing.ts').verifyStageTwoPricingReceipt(before.options,before.quotation,request,result);
 }finally{h.close();}
});
import {syntheticSnapshot,projectionFixture} from './helpers/supplier-hub-single-projection.mjs';
test('all 36 saved option prices flow through quotation resolver, direct one-row export and actual native serializer',async()=>{
 const snap=syntheticSnapshot(),model=load('app/product-options.ts'),content=load('app/product-content.ts').emptyProductContent('fixed-quote'),settings=load('app/workspace-settings.ts').newWorkspaceSettings;
 const resolver=load('app/quotation-schema.ts'),serializer=load('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument;
 let count=0;
 for(const [cny,sale,supply,cost] of cases){
  const policy=basis(Math.min(...cny),sale,supply,cost),product={id:'fixed-quote',title:'합성 상품',source_url:'synthetic://fixed',source_price_cny:Math.min(...cny),pricing_policy:JSON.stringify(policy),exchange_rate:310,supply_margin:50,coupang_margin:45,supply_price:supply,sale_price:sale,msrp:Math.round(sale*1.3/10)*10,image_keys:'[]'};
  const rows=model.applyOptionRows(model.emptyProductOptions(product.id),cny.map((value,index)=>({...model.emptyOptionInput('fixed-'+index),originalName:'옵션',translatedName:'합성 옵션',unitCostCny:value,included:true})),'2026-11-06T00:00:00.000Z').rows;
  const resolved=resolver.resolveQuotationFields({product,content,settings,options:rows,categoryId:snap.categoryId,categoryPath:snap.categoryPath,hubSchema:snap});
  for(const row of resolved.rows.filter(row=>row.optionId!==null)){
   const index=rows.findIndex(option=>option.id===row.optionId),expected=calculatePrice(cny[index],policy),fixture=projectionFixture(snap);fixture.input.resolved={...resolved,rows:[row]};
   const native=(await serializer(fixture.input)).payload.jsonDocument[0].productPage.commonAttributes;
   assert.deepEqual([Number(native.purchasePrice),Number(native.coupangSalePrice),Number(native.msrp)],[expected.supplyPrice,expected.salePrice,expected.msrp]);
   const exported=load('app/exports/quotation-data.ts').quotationData(product,content,settings,[rows[index]],[])[0];
   assert.deepEqual([exported.supplyPrice,exported.salePrice,exported.msrp],[expected.supplyPrice,expected.salePrice,expected.msrp]);count++;
  }
 }
 assert.equal(count,36);
});
test('automation consumes the persisted fixed basis and same-clock source-policy races prevent atomic write',async()=>{
 const h=await stageTwoFixture();try{
  let before=await json(await h.get()),request=h.body(before);request.policy=basis(2.99,9800,5390,2499);const saved=await json(await h.post(request));
  const settings=h.load('app/workspace-settings.ts').newWorkspaceSettings,model=h.load('app/automation/model.ts');
  const plan=await model.planAutomation(saved.product,settings,null,null,null,saved.product.updated_at,saved.options.options),run=model.executeLocalAutomation(plan,saved.product,settings,{action:'run',stages:['pricing']},saved.product.updated_at,saved.options.options),stage=run.stages.find(stage=>stage.id==='pricing');
  assert.equal(stage.status,'complete');assert.equal(stage.artifacts[0].data.calculation.costKrw,2499);assert.equal(stage.artifacts[0].data.policy.fixedSourcing.referenceCny,2.99);
  before=await json(await h.get());request=h.body(before);h.before(()=>h.sqlite.prepare('UPDATE product_price_policy SET payload=? WHERE product_id=?').run(JSON.stringify({...request.policy,fixedSourcing:{...request.policy.fixedSourcing,purchaseCost:2500}}),h.id));
  assert.equal((await h.post(request)).status,409);assert.equal(h.sqlite.prepare('SELECT revision FROM product_options WHERE product_id=?').get(h.id).revision,before.options.options.revision);
 }finally{h.close();}
});
test('fixed CNY edits keep manual quote amounts and explicit blanks while automatic calculation reevaluates',async()=>{
 const h=await stageTwoFixture();try{
  const view=(await json(await h.get())).quotation,row={...h.load('app/product-options.ts').emptyOptionInput('row-a'),unitCostCny:2.99,included:true};
  view.overrides.options['row-a']={supplyPrice:'5391',salePrice:'12000'};
  const edits=[{optionId:'row-a',fieldKey:'salePrice',value:''}],p=basis(2.99,9800,5390,2499);
  const result=h.load('app/stage-two-option-recalculation.ts').recalculateStageTwoOptionCost(row,4,p,view,edits);
  assert.deepEqual(plain(result.changes),edits);assert.equal(result.row.unitCostCny,4);assert.ok(calculatePrice(4,p).salePrice>9800);
 }finally{h.close();}
});

const gated=(gate,cost=3000)=>{const p=basis(2,10000,5000,cost);p.fixedSourcing.marginGate=gate;return p;};
test('current fixed gate supports rate/amount/AND/OR with equality and zero thresholds',()=>{
 for(const gate of [{mode:'rate',minRate:20},{mode:'amount',minAmount:2000},{mode:'both',minRate:20,minAmount:2000},{mode:'either',minRate:21,minAmount:2000},{mode:'either',minRate:20,minAmount:2001}])assert.equal(calculatePrice(2,gated(gate)).marginKrw,2000);
 for(const gate of [{mode:'rate',minRate:20.01},{mode:'amount',minAmount:2001},{mode:'both',minRate:20,minAmount:2001},{mode:'both',minRate:20.01,minAmount:2000},{mode:'either',minRate:20.01,minAmount:2001}])assert.throws(()=>calculatePrice(2,gated(gate)),/소싱|마진/);
 for(const gate of [{mode:'rate',minRate:0},{mode:'amount',minAmount:0},{mode:'both',minRate:0,minAmount:0},{mode:'either',minRate:99,minAmount:0}])assert.equal(calculatePrice(2,gated(gate,5000)).marginKrw,0);
 for(const gate of [undefined,null]){assert.equal(calculatePrice(2,gated(gate,2500)).marginKrw,2500);assert.throws(()=>calculatePrice(2,gated(gate,2501)),/25%/);}
});
test('current gate parser normalizes active numeric strings, ignores inactive values and extra keys, rejects malformed active settings',()=>{
 assert.deepEqual(plain(pricePolicy(gated({mode:'rate',minRate:'20',minAmount:'ignored',extra:1})).fixedSourcing.marginGate),{mode:'rate',minRate:20,minAmount:null,source:'customer'});
 assert.deepEqual(plain(pricePolicy(gated({mode:'amount',minRate:Infinity,minAmount:'2000'})).fixedSourcing.marginGate),{mode:'amount',minRate:null,minAmount:2000,source:'customer'});
 for(const gate of [[],false,0,'rate',{}, {mode:'unknown'},...['',null,undefined,-1,100,Infinity,NaN].map(minRate=>({mode:'rate',minRate})),...['',null,undefined,-1,1.5,Infinity,NaN].map(minAmount=>({mode:'amount',minAmount})),{mode:'both',minRate:20},{mode:'either',minAmount:1}])assert.throws(()=>pricePolicy(gated(gate)));
 const old=basis(2,10000,5000,2500);assert.equal(JSON.stringify(pricePolicy(old).fixedSourcing),JSON.stringify(old.fixedSourcing));
});
test('product gate is read-only and owner-root gate carries through stage-two receipt and direct export',async()=>{
 const ui=policyUI(basis(2.99,9800,5390,2499),2.99);assert.equal(ui.field('계정 로켓 소싱 마진 기준').type,'p');assert.throws(()=>ui.field('소싱 마진 판단 방식'));
 const h=await stageTwoFixture();try{
  const settings={...h.load('app/workspace-settings.ts').newWorkspaceSettings,rocketMarginGate:{mode:'both',minRate:20,minAmount:2000}};
  await h.load('db/queries.ts').saveSettings(h.owner,JSON.stringify(settings));
  const before=await json(await h.get()),request=h.body(before);request.policy=basis(2.99,9800,5390,3000);const saved=await json(await h.post(request));h.load('app/stage-two-pricing.ts').verifyStageTwoPricingReceipt(before.options,before.quotation,request,saved);
  assert.deepEqual(saved.options.pricing.policy.fixedSourcing.marginGate,{mode:'both',minRate:20,minAmount:2000,source:'customer'});
  const content=h.load('app/product-content.ts').emptyProductContent(h.id);assert.equal(h.load('app/exports/quotation-data.ts').quotationData(saved.product,content,settings,[saved.options.options.rows[0]],[])[0].salePrice,9800);
  const fake=plain(saved);fake.options.pricing.policy.fixedSourcing.marginGate.minRate=21;assert.throws(()=>h.load('app/stage-two-pricing.ts').verifyStageTwoPricingReceipt(before.options,before.quotation,request,fake));
 }finally{h.close();}
});
