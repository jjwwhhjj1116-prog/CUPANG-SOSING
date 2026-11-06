import test from 'node:test';
import assert from 'node:assert/strict';
import {stageTwoFixture,json,plain} from './helpers/stage-two-pricing.mjs';
import {providedOptionModule as load} from './helpers/provided-option-quotation.mjs';
import {componentUI,nodes} from './helpers/pricing-stage-two-zero-minimum.mjs';
const fixed=policy=>({...policy,coupangMargin:45,useIntegratedRate:true,integratedRate:290,fixedSourcing:{version:1,referenceCny:2.99,salePrice:9800,supplyPrice:5390,purchaseCost:2499,sourceUnitsPerPack:1,marginGate:{mode:'amount',minAmount:0}}});
const root=gate=>({...load('app/workspace-settings.ts').newWorkspaceSettings,...(gate===undefined?{}:{rocketMarginGate:gate})});
const setRoot=async(h,gate)=>h.load('db/queries.ts').saveSettings(h.owner,JSON.stringify(root(gate)));
test('live root gate outranks saved/captured product gate; absence/null default25 and malformed active root fails',()=>{
 const {effectivePricePolicy,calculatePrice}=load('app/pricing.ts'),policy=fixed(root()),model=load('app/product-options.ts'),product={pricing_policy:JSON.stringify(policy)};
 assert.throws(()=>calculatePrice(2.99,effectivePricePolicy(policy,root({mode:'amount',minAmount:3000}))));
 assert.equal(model.resolveOptionPricePolicy(product,root({mode:'amount',minAmount:0})).policy.fixedSourcing.marginGate.minAmount,0);
 for(const value of [undefined,null])assert.equal(Object.hasOwn(model.resolveOptionPricePolicy(product,root(value)).policy.fixedSourcing,'marginGate'),false);
 assert.throws(()=>model.resolveOptionPricePolicy(product,root({mode:'both',minRate:1})));
 const capture=load('app/collection-registration-settings.ts').collectionRegistrationSettings(root({mode:'amount',minAmount:3000}),root({mode:'invalid'}));assert.equal(capture.rocketMarginGate.minAmount,3000);
 const old={...policy};delete old.fixedSourcing;assert.equal(JSON.stringify(effectivePricePolicy(old,root({mode:'amount',minAmount:3000}))),JSON.stringify(load('app/pricing.ts').pricePolicy(old)));
});
test('account card explicitly saves root gate and preserves absent legacy settings until edited',async()=>{
 const settings=load('app/workspace-settings.ts'),original=settings.validateSettings(root());assert.equal(Object.hasOwn(original,'rocketMarginGate'),false);
 let saved;const ui=componentUI('app/components/workspace-settings-editor.tsx','WorkspaceSettingsEditor',{props:{value:original,onClose(){},onSave:async value=>{saved=plain(value);}}});
 await ui.render().props.onSubmit({preventDefault(){}});assert.equal(Object.hasOwn(saved,'rocketMarginGate'),false);
 const field=label=>{const found=nodes(ui.render()).find(node=>node.props?.['aria-label']===label);assert.ok(found,label);return found;};
 field('로켓 소싱 마진 판단 방식').props.onChange({target:{value:'both'}});field('로켓 최소 공급마진율 (%)').props.onChange({target:{value:'20'}});field('로켓 최소 공급마진액 (원)').props.onChange({target:{value:'2000'}});
 assert.equal(field('로켓 소싱 마진 판단 방식').props.value,'both');assert.equal(field('로켓 최소 공급마진율 (%)').props.value,20);assert.equal(field('로켓 최소 공급마진액 (원)').props.value,2000);await ui.render().props.onSubmit({preventDefault(){}});assert.equal(nodes(ui.render()).find(node=>node.props?.role==='alert'),undefined);assert.deepEqual(saved.rocketMarginGate,{mode:'both',minRate:20,minAmount:2000});assert.equal(Object.hasOwn(settings.newWorkspaceSettings,'rocketMarginGate'),false);
 assert.throws(()=>settings.validateSettings(root({mode:'rate',minRate:''})));
 const h=await stageTwoFixture();try{const route=h.load('app/api/settings/route.ts'),put=body=>route.PUT(new Request('https://app.test/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({...body,expectedOwnerId:h.owner})}));
  assert.equal((await put(saved)).status,200);assert.deepEqual((await json(await route.GET())).settings.rocketMarginGate,saved.rocketMarginGate);
  const before=h.snapshot();assert.equal((await put({...saved,rocketMarginGate:{mode:'both',minRate:20}})).status,400);assert.equal(h.snapshot(),before);
 }finally{h.close();}
});
test('actual owner-root admission, response/receipt/export/automation/status and same-clock account race bind one effective criterion',async()=>{
 const h=await stageTwoFixture();try{
  const schema=h.load('app/quotation-schema.ts').getQuotationSchema('80719'),profile=await h.load('db/category-profiles.ts').createCategoryProfile(h.owner,{name:'root gate pricing',categoryId:'80719',categoryPath:schema.categoryPath,template:null,mappings:[]},'root-gate-profile'),suffix='?profileId='+profile.id;
  await setRoot(h,{mode:'amount',minAmount:3000});let before=await json(await h.get(suffix)),request=h.body(before);request.policy=fixed(request.policy);assert.equal((await h.post(request,suffix)).status,400,'product zero gate cannot lower live3000');
  await setRoot(h,{mode:'amount',minAmount:2000});before=await json(await h.get(suffix));request=h.body(before);request.policy=fixed(request.policy);let saved=await json(await h.post(request,suffix));
  assert.equal(saved.options.pricing.policy.fixedSourcing.marginGate.minAmount,2000);assert.equal(saved.options.pricing.rocketMarginGate.minAmount,2000);h.load('app/stage-two-pricing.ts').verifyStageTwoPricingReceipt(before.options,before.quotation,request,saved);
  const content=h.load('app/product-content.ts').emptyProductContent(h.id),exporter=h.load('app/exports/quotation-data.ts'),settings=root({mode:'amount',minAmount:3000});assert.throws(()=>exporter.quotationData(saved.product,content,settings,[saved.options.options.rows[0]],[]));
  const model=h.load('app/automation/model.ts'),plan=await model.planAutomation(saved.product,settings,null,null,null,saved.product.updated_at,saved.options.options),run=model.executeLocalAutomation(plan,saved.product,settings,{action:'run',stages:['pricing']},saved.product.updated_at,saved.options.options);assert.equal(run.stages.find(stage=>stage.id==='pricing').status,'failed');
  const status=h.load('app/registration-pricing-status.ts').savedRecalculatedRegistrationPricing,state=await h.load('db/quotation-fields.ts').readQuotationFields(h.owner,h.id);assert.equal(status(saved.product,saved.options.options,state,saved.quotation.resolved.schema,{ownerId:h.owner,settings:root({mode:'amount',minAmount:2000})}),true,'saved current-root review starts complete');await setRoot(h,{mode:'amount',minAmount:2500});const changed=await json(await h.get(suffix));assert.equal(changed.product.updated_at,saved.product.updated_at);assert.notEqual(changed.quotation.inputFingerprint,saved.quotation.inputFingerprint);assert.equal(status(saved.product,saved.options.options,state,saved.quotation.resolved.schema,{ownerId:h.owner,settings:root({mode:'amount',minAmount:2500})}),false,'gate-only change invalidates prior fixed review even while price passes');assert.equal(status(saved.product,saved.options.options,state,saved.quotation.resolved.schema,{ownerId:h.owner,settings}),false);
  before=await json(await h.get(suffix));request=h.body(before);h.before(()=>h.sqlite.prepare('UPDATE workspace_settings SET payload=? WHERE owner_id=?').run(JSON.stringify(settings),h.owner));assert.equal((await h.post(request,suffix)).status,409);assert.equal(h.sqlite.prepare('SELECT revision FROM product_options WHERE product_id=?').get(h.id).revision,before.options.options.revision);
 }finally{h.close();}
});
