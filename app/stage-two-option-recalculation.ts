import {pricePolicy,type PricePolicy} from '@/app/pricing';
import {calculateOptionPrices,type OptionInput} from '@/app/product-options';
import {recalculateStageTwoRows} from '@/app/stage-two-pricing';
import {quotationPriceTargets} from '@/app/quotation-price-targets';
import type {QuotationChange,QuotationFieldsView} from '@/app/quotation-schema';

/** A deliberate cost change recalculates this included row only. Its exact
 * supply/sale aliases become the local draft; the product policy, unrelated
 * row prices and explicit MSRP/OSRP retain their existing authority. The usual
 * Stage2 save derives automatic MSRP from the new sale value. */
export function recalculateStageTwoOptionCost(row:OptionInput,cost:OptionInput['unitCostCny'],policy:PricePolicy,
  view:QuotationFieldsView,edits:readonly QuotationChange[]):{row:OptionInput;changes:QuotationChange[]}|null{
  if(Object.is(row.unitCostCny,cost)||!row.included)return null;
  if(typeof cost!=='number'||!Number.isFinite(cost)||cost<=0)throw Error('개당 위안 원가에 0보다 큰 금액을 입력해주세요. 기존 가격 입력은 유지했습니다.');
  if(!view.resolved.rows.some(value=>value.optionId===row.id&&value.included))throw Error('현재 견적서에 포함한 옵션의 원가와 가격을 다시 확인해주세요.');
  const checked=pricePolicy({...policy,recalculationMode:'couplus-stage-two-v1',arithmeticMode:policy.roundingMode==='nearest'?'couplus-number-v1':undefined});
  const next=recalculateStageTwoRows([{...row,unitCostCny:cost}],checked)[0],result=calculateOptionPrices([next],checked)[0];
  if(result.error||!result.calculation)throw Error(result.error||'현재 옵션의 원가와 구성 수량을 확인해주세요.');
  const targets=quotationPriceTargets(view.resolved.schema.fields),prices=result.calculation;
  const values=(['supplyPrice','salePrice'] as const).flatMap(input=>{
    if(!Number.isSafeInteger(prices[input])||prices[input]<=0)throw Error('현재 옵션의 계산 금액을 확인해주세요. 기존 가격 입력은 유지했습니다.');
    return targets[input].linked.map(fieldKey=>({optionId:row.id,fieldKey,value:String(prices[input])}));
  });
  const replaced=new Set(values.map(value=>value.fieldKey));
  return{row:next,changes:[...edits.filter(edit=>edit.optionId!==row.id||!replaced.has(edit.fieldKey)).map(edit=>({...edit})),...values]};
}
