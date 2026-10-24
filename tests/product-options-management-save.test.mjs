import test from 'node:test';
import assert from 'node:assert/strict';
import {optionPriceTableUI,priceTableCompanies,priceTableText as text} from './helpers/option-price-table-ui.mjs';
const plain=value=>JSON.parse(JSON.stringify(value));
function visible(value){if(Array.isArray(value))return value.flatMap(visible);if(!value||typeof value!=='object'||value.props?.hidden||value.props?.inert)return[];return[value,...visible(value.props?.children)];}
const visibleButton=(h,label)=>visible(h.render()).find(node=>node.type==='button'&&(node.props['aria-label']===label||text(node)===label));
const change=(h,label,value)=>h.node(label).props.onChange({target:{value,valueAsNumber:Number(value)}});
for(const company of priceTableCompanies){
 test(`${company.code}: option management saves factual weight from its own visible control once, preserving other rows and original unit cost`,async()=>{
  const h=await optionPriceTableUI(company,{count:3,integrated:true});try{
   const before=plain((await h.rows()).rows),protectedBefore=h.protectedSnapshot();
   assert.equal(visibleButton(h,'옵션 관리 저장하기'),undefined);assert.ok(visibleButton(h,'옵션 가격 저장하기'));
   h.setPricingView(false);await h.settle();assert.equal(visibleButton(h,'옵션 가격 저장하기'),undefined);assert.ok(visibleButton(h,'옵션 관리 저장하기'));
   change(h,'옵션 1 판매 단위 무게 kg','0.01');assert.equal(visibleButton(h,'옵션 관리 저장하기').props.disabled,false);
   visibleButton(h,'옵션 관리 저장하기').props.onClick();await h.settle();
   assert.equal(h.writes.length,1);assert.equal(h.writes[0].kind,'stage-two-pricing');assert.equal(h.saved,1);
   const after=plain((await h.rows()).rows);assert.equal(after[0].weightKg,0.01);assert.equal(after[0].packagedWeightG,null);
   assert.equal(after[0].unitCostCny,before[0].unitCostCny);assert.equal(after[0].unitsPerPack,1);assert.deepEqual(after.slice(1),before.slice(1));assert.equal(h.protectedSnapshot(),protectedBefore);
   assert.equal(visibleButton(h,'옵션 관리 저장하기').props.disabled,true);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM supplier_hub_receipts').get().n,0);
  }finally{h.close();}
 });
 test(`${company.code}: pending price edits survive navigation and save atomically with option facts without a second options PATCH`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true});try{
   change(h,'가격 옵션 1 공급가','10000');change(h,'가격 옵션 1 판매가','16000');h.setPricingView(false);await h.settle();
   change(h,'옵션 1 판매 단위 무게 kg','0.01');visibleButton(h,'옵션 관리 저장하기').props.onClick();await h.settle();
   assert.equal(h.writes.length,1);assert.equal(h.writes[0].kind,'stage-two-pricing');assert.equal(h.writes[0].rows[0].weightKg,0.01);
   const view=await (await h.request('/api/products/'+h.product.id+'/quotation-fields')).json(),row=view.resolved.rows.find(row=>row.optionId==='price-001');assert.equal(row.fields.supplyPrice.value,'10000');assert.equal(row.fields.salePrice.value,'16000');
   h.setPricingView(true);await h.settle();assert.equal(visibleButton(h,'옵션 관리 저장하기'),undefined);assert.equal(h.node('가격 옵션 1 판매가').props.value,'16000');
  }finally{h.close();}
 });
 test(`${company.code}: option management retains exact-source guards and recovers a lost atomic save response without replay`,async()=>{
  const h=await optionPriceTableUI(company,{count:2,integrated:true});try{
   h.setPricingView(false);await h.settle();change(h,'옵션 1 판매 단위 무게 kg','0.01');const callback=visibleButton(h,'옵션 관리 저장하기').props.onClick;
   h.locks({files:true});callback();await h.settle();assert.equal(h.writes.length,0);h.locks({files:false});
   let lost=true;h.controls.response=async(url,init,response)=>{if(lost&&init.method==='POST'&&url.includes('/stage-two-pricing')&&response.ok){lost=false;return Response.json({error:'synthetic lost ACK'},{status:503});}return response;};
   visibleButton(h,'옵션 관리 저장하기').props.onClick();await h.settle();assert.equal(h.writes.length,1);assert.equal(h.saved,0);assert.equal(visibleButton(h,'옵션 관리 저장하기').props.disabled,true);
   callback();await h.settle();assert.equal(h.writes.length,1);assert.ok(visibleButton(h,'입력 유지 · 옵션 저장 결과 확인'));
   visibleButton(h,'입력 유지 · 옵션 저장 결과 확인').props.onClick();await h.settle();assert.equal(h.writes.length,1);assert.equal(h.saved,1);assert.equal((await h.rows()).rows[0].weightKg,0.01);
  }finally{h.close();}
 });
}
