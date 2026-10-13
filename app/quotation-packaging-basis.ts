import type { ProductOption } from '@/app/product-options';
import type { QuotationChange, QuotationField, QuotationFieldsView, QuotationOverrides } from '@/app/quotation-schema';
import { quotationPackagedWeightManual, quotationPackagedWeightPeer } from '@/app/quotation-packaged-weight';
import { isPackagedDimensionsMmField, isCanonicalPackagedDimensionsMm } from '@/app/quotation-packaged-dimensions';

export type QuotationPackagingFact = { value:string;fieldSignature:string;unitsPerPack:Record<string,number> };
export type QuotationPackagingBasis = {version:1;common:Record<string,QuotationPackagingFact>;options:Record<string,Record<string,QuotationPackagingFact>>};
type PackagingState = {packagingBasis?:QuotationPackagingBasis;categoryPackagingBasis?:Record<string,QuotationPackagingBasis>};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const invalid=()=>Error('저장된 포장값과 판매 구성 수량의 확인 기준을 읽지 못했습니다. 입력값을 유지하고 저장본을 다시 확인해주세요.');
const owns=(value:object,key:string)=>Object.hasOwn(value,key);
export const isQuotationPackagingBasisIssue=(value:string)=>value.startsWith('직접 입력한 포장 정보는 ')||value.startsWith('직접 입력한 포장값의 항목·값과 ')||value.startsWith('이 공통 포장값은 현재 옵션의 ');
export function quotationPackQuantities(options:readonly Pick<ProductOption,'id'|'unitsPerPack'>[]) {
  const result=Object.fromEntries(options.map(option=>[option.id,option.unitsPerPack]));
  validatePackQuantities(result);return result;
}
export function validatePackQuantities(value:unknown):asserts value is Record<string,number> {
  if(!record(value)||Object.keys(value).length>200||Object.entries(value).some(([id,quantity])=>!/^[A-Za-z0-9_-]{1,80}$/u.test(id)
    ||!Number.isSafeInteger(quantity)||(quantity as number)<1||(quantity as number)>1e6))throw invalid();
}
export function validateQuotationPackagingBasis(value:unknown):asserts value is QuotationPackagingBasis {
  if(!record(value)||Object.keys(value).sort().join(',')!=='common,options,version'||value.version!==1||!record(value.common)||!record(value.options)
    ||Object.keys(value.common).length>10||Object.keys(value.options).length>200)throw invalid();
  const facts=(values:Record<string,unknown>)=>{
    if(Object.keys(values).length>10)throw invalid();
    for(const [id,fact]of Object.entries(values)){
      if(!/^[A-Za-z0-9_-]{1,160}$/u.test(id)||!record(fact)||Object.keys(fact).sort().join(',')!=='fieldSignature,unitsPerPack,value'
        ||typeof fact.value!=='string'||!fact.value.trim()||fact.value.length>2000||typeof fact.fieldSignature!=='string'||!fact.fieldSignature||fact.fieldSignature.length>128*1024)throw invalid();
      validatePackQuantities(fact.unitsPerPack);
    }
  };
  facts(value.common);
  for(const [id,values]of Object.entries(value.options)){if(!/^[A-Za-z0-9_-]{1,80}$/u.test(id)||!record(values))throw invalid();facts(values);}
}
export function scopedQuotationPackagingBasis(state:PackagingState,categoryId:string|null) {
  const value=categoryId?state.categoryPackagingBasis?.[`category:${categoryId}`]:state.packagingBasis;
  if(value!==undefined)validateQuotationPackagingBasis(value);
  return value;
}
export function isQuotationPackagingField(fields:readonly QuotationField[],fieldId:string) {
  const field=fields.find(item=>item.id===fieldId);
  if(!field||field.readOnly||field.section!=='logistics')return false;
  return isPackagedDimensionsMmField(field)||field.id==='packagedWeightG'&&field.type==='number'&&field.unit==='g'
    ||field.hubInput==='packagedWeightG'&&quotationPackagedWeightPeer(fields,fieldId)==='packagedWeightG';
}
function origin(fields:readonly QuotationField[],overrides:QuotationOverrides,optionId:string|null,fieldId:string) {
  const read=(layer:string|null,id:string)=>{const values=layer===null?overrides.common:owns(overrides.options,layer)?overrides.options[layer]:undefined;return values&&owns(values,id)?values[id]:null;};
  const weight=quotationPackagedWeightManual(fields,fieldId,optionId,read);
  if(weight)return{fieldId:weight.fieldId,optionId:weight.source==='manual-option'?optionId:null,value:weight.value};
  const own=optionId===null?null:read(optionId,fieldId),common=read(null,fieldId);
  return own!==null?{fieldId,optionId,value:own}:common!==null?{fieldId,optionId:null,value:common}:null;
}
/** Historical documents without this sidecar retain their manual values. Only
 * a server-recorded fact can become stale; no past confirmation is invented. */
export function quotationPackagingBasisIssues(fields:readonly QuotationField[],basis:QuotationPackagingBasis|undefined,
  overrides:QuotationOverrides,optionId:string|null,unitsPerPack:number|undefined,fieldId:string):string[] {
  if(basis===undefined||optionId===null||unitsPerPack===undefined||!isQuotationPackagingField(fields,fieldId))return [];
  const manual=origin(fields,overrides,optionId,fieldId);if(!manual||!manual.value.trim())return [];
  const values=manual.optionId===null?basis.common:owns(basis.options,manual.optionId)?basis.options[manual.optionId]:undefined;
  const fact=values&&owns(values,manual.fieldId)?values[manual.fieldId]:undefined;
  if(!fact)return [];
  const definition=fields.find(field=>field.id===manual.fieldId);
  if(fact.value!==manual.value||fact.fieldSignature!==JSON.stringify(definition))return ['직접 입력한 포장값의 항목·값과 저장된 확인 기준이 다릅니다. 현재 구성의 포장값을 확인한 뒤 명시 저장해주세요.'];
  if(!owns(fact.unitsPerPack,optionId))return [`이 공통 포장값은 현재 옵션의 ${unitsPerPack}개입 구성에 맞춰 확인한 기록이 없습니다. 해당 옵션의 포장 무게·치수를 확인한 뒤 명시 저장해주세요.`];
  const previous=fact.unitsPerPack[optionId];
  return previous===unitsPerPack?[]:[`직접 입력한 포장 정보는 ${previous}개입 기준입니다. 현재 ${unitsPerPack}개입의 포장 무게·치수를 확인한 뒤 같은 값이라도 명시 저장해주세요.`];
}
/** Only explicit physical-field edits create or clear facts. Unrelated writes
 * preserve every previous fact; direct empty values are not confirmed sizes. */
export function applyQuotationPackagingBasis(basis:QuotationPackagingBasis|undefined,fields:readonly QuotationField[],
  quantities:Record<string,number>,changes:readonly QuotationChange[]) {
  if(basis!==undefined)validateQuotationPackagingBasis(basis);validatePackQuantities(quantities);
  const next:QuotationPackagingBasis=basis?structuredClone(basis):{version:1,common:{},options:{}};
  for(const change of changes){
    if(!isQuotationPackagingField(fields,change.fieldKey))continue;
    let values=change.optionId===null?next.common:owns(next.options,change.optionId)?next.options[change.optionId]:undefined;
    if(change.value===null||!change.value.trim()){
      if(values)delete values[change.fieldKey];
    }else{
      if(change.optionId!==null&&!owns(quantities,change.optionId))throw invalid();
      if(!values){values={};Object.defineProperty(next.options,change.optionId!,{value:values,enumerable:true,configurable:true,writable:true});}
      values[change.fieldKey]={value:change.value,fieldSignature:JSON.stringify(fields.find(field=>field.id===change.fieldKey)),
        unitsPerPack:change.optionId===null?{...quantities}:{[change.optionId]:quantities[change.optionId]}};
    }
    if(change.optionId!==null&&values&&!Object.keys(values).length)delete next.options[change.optionId];
  }
  if(!Object.keys(next.common).length&&!Object.keys(next.options).length)return undefined;
  validateQuotationPackagingBasis(next);return next;
}
export function quotationPackagingReconfirmationChanges(view:QuotationFieldsView,optionId:string|null):QuotationChange[] {
  const quantities=view.optionPackQuantities;if(!quantities||!view.packagingBasis)return [];
  validatePackQuantities(quantities);validateQuotationPackagingBasis(view.packagingBasis);
  const affected=view.resolved.rows.filter(row=>row.optionId!==null&&row.included&&(optionId===null||row.optionId===optionId));
  return view.resolved.schema.fields.flatMap(field=>{
    if(!isQuotationPackagingField(view.resolved.schema.fields,field.id)
      ||!affected.some(row=>quotationPackagingBasisIssues(view.resolved.schema.fields,view.packagingBasis,view.overrides,row.optionId,quantities[row.optionId!],field.id).length))return [];
    const row=view.resolved.rows.find(item=>item.optionId===optionId),cell=row?.fields[field.id];
    if(!cell?.source.startsWith('manual-')||!cell.value.trim())return [];
    const valid=isPackagedDimensionsMmField(field)?isCanonicalPackagedDimensionsMm(cell.value):Number.isFinite(Number(cell.value))&&Number(cell.value)>0;
    return valid?[{fieldKey:field.id,optionId,value:cell.value}]:[];
  });
}
/** A refreshed literal alone cannot acknowledge an explicit same-value review.
 * A lost response is recoverable only from that field's stored quantity fact. */
export function quotationPackagingChangeStored(previous:QuotationFieldsView,next:QuotationFieldsView,change:QuotationChange,changes:readonly QuotationChange[]) {
  if(!previous.optionPackQuantities||!isQuotationPackagingField(previous.resolved.schema.fields,change.fieldKey))return true;
  const expected=applyQuotationPackagingBasis(previous.packagingBasis,previous.resolved.schema.fields,previous.optionPackQuantities,changes);
  const fact=(basis:QuotationPackagingBasis|undefined)=>change.optionId===null?basis?.common[change.fieldKey]:basis?.options[change.optionId]?.[change.fieldKey];
  return JSON.stringify(fact(expected)??null)===JSON.stringify(fact(next.packagingBasis)??null);
}
export function quotationPackagingChangeScopeChanged(previous:QuotationFieldsView,next:QuotationFieldsView,change:QuotationChange) {
  if(change.value===null||!previous.optionPackQuantities||!isQuotationPackagingField(previous.resolved.schema.fields,change.fieldKey))return false;
  const quantities=(view:QuotationFieldsView)=>change.optionId===null?Object.entries(view.optionPackQuantities??{}).sort(([a],[b])=>a.localeCompare(b))
    :view.optionPackQuantities?.[change.optionId];
  return JSON.stringify(quantities(previous))!==JSON.stringify(quantities(next));
}
