import test from 'node:test';
import assert from 'node:assert/strict';
import {stageTwoFixture,json,plain} from './helpers/stage-two-pricing.mjs';
import {optionPriceTableUI,priceTableNodes as nodes,priceTableText as text} from './helpers/option-price-table-ui.mjs';
const gate=amount=>({mode:'amount',minAmount:amount});
const settings=(h,value)=>({...h.load('app/workspace-settings.ts').newWorkspaceSettings,...(value===undefined?{}:{rocketMarginGate:value})});
const setRoot=(h,value)=>h.load('db/queries.ts').saveSettings(h.owner,JSON.stringify(settings(h,value)));
test('ordinary mixed options-root2000/current quote-root2500 rejects before commit; explicit coherent retry confirms strictly',async()=>{
 const h=await stageTwoFixture();try{
  await setRoot(h,gate(2000));const old=await json(await h.get());await setRoot(h,gate(2500));const current=await json(await h.get()),request=h.body({product:old.product,options:old.options,quotation:current.quotation}),before=h.snapshot(),batches=h.batches;
  assert.equal(request.policy.fixedSourcing,undefined);assert.equal(request.expectedRocketMarginGate.minAmount,2000);assert.equal(old.product.updated_at,current.product.updated_at);
  const rejected=await h.post(request);assert.equal(rejected.status,409);assert.equal((await rejected.json()).code,'STAGE_TWO_PRICE_GATE_CONFLICT');assert.equal(h.batches,batches);assert.equal(h.snapshot(),before);
  const coherent=h.body(current),saved=await json(await h.post(coherent));h.load('app/stage-two-pricing.ts').verifyStageTwoPricingReceipt(current.options,current.quotation,coherent,saved);assert.deepEqual(await json(await h.get()),saved);
  const forged=plain(coherent);forged.expectedRocketMarginGate=gate(2000);assert.throws(()=>h.load('app/stage-two-pricing.ts').verifyStageTwoPricingReceipt(current.options,current.quotation,forged,saved));
 }finally{h.close();}
});
test('ordinary absent-root old protocol stays eight fields; configured root is metadata only and never gates ordinary arithmetic',async()=>{
 const h=await stageTwoFixture();try{
  let before=await json(await h.get()),request=h.body(before);assert.equal(Object.hasOwn(request,'expectedRocketMarginGate'),false);assert.equal(Object.keys(request).length,8);let saved=await json(await h.post(request));h.load('app/stage-two-pricing.ts').verifyStageTwoPricingReceipt(before.options,before.quotation,request,saved);
  await setRoot(h,gate(1000000000));before=await json(await h.get());request=h.body(before);const expected=h.load('app/product-options.ts').calculateOptionPrices(request.rows,request.policy);saved=await json(await h.post(request));assert.deepEqual(saved.options.pricing.rows,plain(expected));assert.equal(saved.product.pricing_policy,JSON.stringify(request.policy));h.load('app/stage-two-pricing.ts').verifyStageTwoPricingReceipt(before.options,before.quotation,request,saved);
  const missingContext=h.body(saved);delete missingContext.expectedRocketMarginGate;const snapshot=h.snapshot();assert.equal((await h.post(missingContext)).status,409);assert.equal(h.snapshot(),snapshot,'old request without configured context fails safely before any write');
 }finally{h.close();}
});
test('ordinary actual editor keeps drafts after known conflict, GET-only refresh and one explicit retry without uncertain recovery',async()=>{
 const h=await optionPriceTableUI(undefined,{count:2,integrated:true,initialSettings:{rocketMarginGate:gate(2000)}});try{
  const owner=h.product.owner_id,id=h.product.id;await h.load('db/queries.ts').saveSettings(owner,JSON.stringify(settings(h,gate(2500))));h.button('저장 가격 다시 조회').props.onClick();await h.settle();
  const change=(label,value)=>h.node(label).props.onChange({target:{value,valueAsNumber:Number(value)}});
  change('가격 옵션 1 개당 원가','3.3');h.setPricingView(false);change('가격 옵션 1 구성 수량','2');h.setPricingView(true);change('시장가격 배수','1.4');change('가격 옵션 2 판매가','20000');change('가격 옵션 2 권장소비자가','');h.node('가격 옵션 2 공급가 복원').props.onClick();
  const revision=(await h.rows()).revision,clock=h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(id).updated_at;
  h.button('옵션 가격 저장하기').props.onClick();await h.settle();assert.equal(h.writes.length,1);assert.equal(h.writes[0].policy.fixedSourcing,undefined);assert.equal(h.writes[0].expectedRocketMarginGate.minAmount,2000);assert.equal((await h.rows()).revision,revision);assert.equal(h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(id).updated_at,clock);assert.ok(!text(h.render()).includes('입력 유지 · 저장 결과 확인'));
  h.button('입력 유지 · 최신 가격 적용').props.onClick();await h.settle();assert.equal(h.writes.length,1);assert.equal(h.node('가격 옵션 1 개당 원가').props.value,3.3);h.setPricingView(false);assert.equal(h.node('가격 옵션 1 구성 수량').props.value,2);h.setPricingView(true);assert.equal(h.node('시장가격 배수').props.value,1.4);assert.equal(h.node('가격 옵션 2 판매가').props.value,'20000');assert.equal(h.node('가격 옵션 2 권장소비자가').props.value,'');
  assert.equal(h.button('옵션 가격 저장하기').props.disabled,false);h.button('옵션 가격 저장하기').props.onClick();await h.settle();assert.equal(h.writes.length,2);assert.equal(h.writes[1].expectedRocketMarginGate.minAmount,2500);assert.deepEqual(h.writes[1].policy,h.writes[0].policy);assert.equal((await h.rows()).revision,revision+1);assert.ok(!nodes(h.render()).some(node=>node.props?.role==='alert'));
 }finally{h.close();}
});
