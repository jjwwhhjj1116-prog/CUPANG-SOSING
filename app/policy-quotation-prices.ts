import { calculateStageTwoMsrp, pricePolicy, type PricePolicy } from '@/app/pricing';
import { quotationPriceInputs, quotationPriceTargets } from '@/app/quotation-price-targets';
import { quotationNumericValue, quotationScalarValueIssues } from '@/app/quotation-scalar-constraints';
import { quotationScope, scopedQuotationOverrides } from '@/app/quotation-scopes';
import { currentStageTwoMsrp, scopedStageTwoMsrp } from '@/app/stage-two-msrp';
import type { QuotationFieldsView, QuotationOverrides } from '@/app/quotation-schema';
import type { QuotationFieldsState } from '@/db/quotation-fields';

/** Prepares only the current category's price sidecar. The caller supplies the
 * exact saved quotation payload and commits it with the product policy CAS. */
export function preparePolicyQuotationPrices(view: QuotationFieldsView, state: QuotationFieldsState,
  input: PricePolicy, recalculate: boolean): { state: QuotationFieldsState; changed: boolean } {
  const policy=pricePolicy(input),categoryId=view.categoryContext.categoryId;
  if(state.revision!==view.revision||JSON.stringify(scopedQuotationOverrides(state,categoryId))!==JSON.stringify(view.overrides))
    throw Error('견적서의 저장 기준이 변경되었습니다. 다시 불러와주세요.');
  const next=structuredClone(state),overrides:QuotationOverrides=structuredClone(view.overrides),targets=quotationPriceTargets(view.resolved.schema.fields);
  const scope=categoryId?quotationScope(categoryId):null;
  const storeOverrides=()=>{if(scope)next.categoryOverrides={...next.categoryOverrides,[scope]:overrides};else next.overrides=overrides;};
  if(recalculate){
    const priceFields=new Set(quotationPriceInputs.flatMap(key=>targets[key].linked));
    for(const key of priceFields)delete overrides.common[key];
    for(const row of view.resolved.rows){
      if(row.optionId===null||!Object.hasOwn(overrides.options,row.optionId))continue;
      const values=overrides.options[row.optionId];for(const key of priceFields)delete values[key];
      if(!Object.keys(values).length)delete overrides.options[row.optionId];
    }
    if(JSON.stringify(overrides)!==JSON.stringify(view.overrides))storeOverrides();
    if(scope&&next.categoryStageTwoMsrp&&Object.hasOwn(next.categoryStageTwoMsrp,scope)){
      const markers={...next.categoryStageTwoMsrp};delete markers[scope];
      if(Object.keys(markers).length)next.categoryStageTwoMsrp=markers;else delete next.categoryStageTwoMsrp;
    }else if(!scope)delete next.stageTwoMsrp;
  }else{
    const markers=currentStageTwoMsrp(view,scopedStageTwoMsrp(state,categoryId));
    if(!markers||targets.msrp.linked.some(key=>Object.hasOwn(overrides.common,key)))return{state:next,changed:false};
    let updated=false;
    for(const row of view.resolved.rows){
      if(row.optionId===null||!row.included||!Object.hasOwn(markers,row.optionId))continue;
      const field=view.resolved.schema.fields.find(item=>item.id===targets.salePrice.primary),raw=row.fields[targets.salePrice.primary]?.value;
      const sale=field&&typeof raw==='string'?quotationNumericValue(field,raw):undefined;
      if(!field||typeof raw!=='string'||sale===undefined||!Number.isSafeInteger(sale)||sale<=0||quotationScalarValueIssues(field,raw).length)continue;
      const value=String(calculateStageTwoMsrp(sale,policy));
      for(const key of targets.msrp.linked){const definition=view.resolved.schema.fields.find(item=>item.id===key);if(!definition||definition.readOnly||quotationScalarValueIssues(definition,value).length)throw Error('새 가격 설정으로 계산한 MSRP의 입력 범위를 확인해주세요.');}
      if(markers[row.optionId].value===value)continue;
      for(const key of targets.msrp.linked)Object.defineProperty(overrides.options[row.optionId],key,{value,enumerable:true,configurable:true,writable:true});
      markers[row.optionId]={fields:[...targets.msrp.linked],value};updated=true;
    }
    if(updated){
      storeOverrides();
      // Retain excluded/unknown origin records verbatim; only the verified,
      // included markers that changed above receive their new exact amount.
      const original=scopedStageTwoMsrp(state,categoryId),merged={...original};
      for(const [id,marker]of Object.entries(markers))if(original&&Object.hasOwn(original,id)&&original[id].value!==marker.value)Object.defineProperty(merged,id,{value:marker,enumerable:true,configurable:true,writable:true});
      if(scope)next.categoryStageTwoMsrp={...next.categoryStageTwoMsrp,[scope]:merged};else next.stageTwoMsrp=merged;
    }
  }
  if(new TextEncoder().encode(JSON.stringify(next)).length>512*1024)throw Error('견적서 가격 자료가 저장 한도를 초과했습니다.');
  return{state:next,changed:JSON.stringify(next)!==JSON.stringify(state)};
}
