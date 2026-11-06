import test from 'node:test';
import assert from 'node:assert/strict';
import {stageTwoFixture,json,plain} from './helpers/stage-two-pricing.mjs';
import {optionPriceTableUI,priceTableNodes as nodes,priceTableText as text} from './helpers/option-price-table-ui.mjs';
const gate=amount=>({mode:'amount',minAmount:amount});
const settings=(h,value)=>({...h.load('app/workspace-settings.ts').newWorkspaceSettings,...(value===undefined?{}:{rocketMarginGate:value})});
const setRoot=(h,value)=>h.load('db/queries.ts').saveSettings(h.owner,JSON.stringify(settings(h,value)));
const fixed=policy=>({...policy,coupangMargin:45,useIntegratedRate:true,integratedRate:290,fixedSourcing:{version:1,referenceCny:2.99,salePrice:9800,supplyPrice:5390,purchaseCost:1000,sourceUnitsPerPack:1}});
for(const [name,oldRoot,newRoot] of [['configured',gate(2000),gate(2500)],['missing-null',undefined,null],['null-missing',null,undefined],['missing-explicit25',undefined,{mode:'rate',minRate:25}]])test(`mixed refresh ${name} is known409 before any commit; coherent explicit retry and strict receipt succeed`,async()=>{
 const h=await stageTwoFixture();try{
  await setRoot(h,oldRoot);let first=await json(await h.get()),request=h.body(first);request.policy=fixed(request.policy);first=await json(await h.post(request));const oldOptions=first.options;
  await setRoot(h,newRoot);const current=await json(await h.get()),before=h.snapshot(),batches=h.batches;
  assert.equal(first.product.updated_at,current.product.updated_at);request=h.body({product:first.product,options:oldOptions,quotation:current.quotation});
  const rejected=await h.post(request);assert.equal(rejected.status,409);assert.equal((await rejected.json()).code,'STAGE_TWO_PRICE_GATE_CONFLICT');assert.equal(h.batches,batches);assert.equal(h.snapshot(),before);
  const coherent=h.body(current),saved=await json(await h.post(coherent));h.load('app/stage-two-pricing.ts').verifyStageTwoPricingReceipt(current.options,current.quotation,coherent,saved);assert.deepEqual(await json(await h.get()),saved);
  const forged=plain(coherent);forged.expectedRocketMarginGate=gate(999);assert.throws(()=>h.load('app/stage-two-pricing.ts').verifyStageTwoPricingReceipt(current.options,current.quotation,forged,saved));
 }finally{h.close();}
});
test('actual fixed editor retains all drafts on conflict, rebinds only root during keep-draft GET and saves only on explicit retry',async()=>{
 const h=await optionPriceTableUI(undefined,{count:2,integrated:true,initialSettings:{rocketMarginGate:gate(2000)}});try{
  const owner=h.product.owner_id,id=h.product.id,set=async value=>h.load('db/queries.ts').saveSettings(owner,JSON.stringify(settings(h,value)));
  const change=(label,value)=>h.node(label).props.onChange({target:{value,valueAsNumber:Number(value)}});
  h.node('고정 소싱가격 사용').props.onChange({target:{checked:true}});change('소싱 판매가 (원)','9800');change('소싱 공급가 (원)','5390');change('선택 매입원가 (원)','1000');
  await set(gate(2500));h.button('저장 가격 다시 조회').props.onClick();await h.settle();
  change('가격 옵션 1 개당 원가','3.3');h.setPricingView(false);change('가격 옵션 1 구성 수량','2');h.setPricingView(true);change('시장가격 배수','1.4');change('가격 옵션 2 판매가','10000');change('가격 옵션 2 권장소비자가','');h.node('가격 옵션 2 공급가 복원').props.onClick();
  const version=h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(id).updated_at,revision=(await h.rows()).revision;
  h.button('옵션 가격 저장하기').props.onClick();await h.settle();assert.equal(h.writes.length,1);assert.deepEqual(h.writes[0].expectedRocketMarginGate,{mode:'amount',minRate:null,minAmount:2000});assert.equal((await h.rows()).revision,revision);assert.equal(h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(id).updated_at,version);
  assert.ok(!text(h.render()).includes('입력 유지 · 저장 결과 확인'),'known conflict does not enter unknown-write recovery');
  h.button('입력 유지 · 최신 가격 적용').props.onClick();await h.settle();assert.equal(h.writes.length,1,'refresh is GET only');
  assert.equal(h.node('가격 옵션 1 개당 원가').props.value,3.3);h.setPricingView(false);assert.equal(h.node('가격 옵션 1 구성 수량').props.value,2);h.setPricingView(true);assert.equal(h.node('시장가격 배수').props.value,1.4);assert.equal(h.node('가격 옵션 2 판매가').props.value,'10000');assert.equal(h.node('가격 옵션 2 권장소비자가').props.value,'');assert.match(text(h.node('계정 로켓 소싱 마진 기준')),/2500/);
  assert.equal(h.button('옵션 가격 저장하기').props.disabled,false);h.button('옵션 가격 저장하기').props.onClick();await h.settle();assert.equal(h.writes.length,2);assert.equal(h.writes[1].expectedRocketMarginGate.minAmount,2500);assert.equal(h.writes[1].policy.msrpMultiple,1.4);assert.equal(h.writes[1].rows[0].unitCostCny,3.3);assert.equal(h.writes[1].rows[0].unitsPerPack,2);assert.ok(h.writes[1].changes.some(edit=>edit.value===null));assert.ok(!nodes(h.render()).some(node=>node.props?.role==='alert'));assert.equal((await h.rows()).revision,revision+1);
 }finally{h.close();}
});
