import {productLabelDefinitions,productLabelPlan,productLabelStructure,productLabelValue,validateProductLabelChanges,validateProductLabelOverrides,validateProductLabelStructure,verifyProductLabelsView,type ProductLabelDraft,type ProductLabelKey,type ProductLabelOverrides,type ProductLabelStructure,type ProductLabelValues,type ProductLabelsView} from '@/app/product-label';
import {applyQuotationChanges,validateQuotationChanges,type QuotationChange,type QuotationFieldsView} from '@/app/quotation-schema';
import {exactPrimaryQuotationTarget} from '@/app/quotation-seo-targets';

export type AllProductLabelPlan={values:ProductLabelValues;structure:ProductLabelStructure;optionIds:(string|null)[];optionCount:number;changedOptionCount:number};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const identities=(view:ProductLabelsView)=>view.rows.map(row=>[row.optionId,row.optionLabel,row.included]);
const changed=()=>Error('전체 옵션 표시사항의 대상·내용 또는 저장 상태가 바뀌었습니다. 검토한 입력은 유지됩니다.');

/** The user reviews ONE exact label, including blanks, for all current options.
 * Removed/archived fields remain stored; only active fields inherit this label. */
export function applyAllProductLabelValues(view:ProductLabelsView,values:ProductLabelValues,structure:ProductLabelStructure):ProductLabelOverrides{
 verifyProductLabelsView(view,null);
 const checked=validateProductLabelStructure(structure),active=new Set(checked.map(field=>field.id));
 if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).length!==active.size||Object.keys(values).some(key=>!active.has(key as ProductLabelKey)))throw Error('검토한 표시사항의 모든 항목을 함께 확인해주세요.');
 validateProductLabelChanges(checked.map(field=>({optionId:null,fieldKey:field.id,value:values[field.id]})),view.rows.flatMap(row=>row.optionId?[row.optionId]:[]),checked);
 const next=validateProductLabelOverrides(view.overrides);
 for(const field of checked)Object.defineProperty(next.common,field.id,{value:values[field.id],enumerable:true,configurable:true,writable:true});
 // Only current options participate. Archived values under unrelated IDs stay.
 for(const row of view.rows)if(row.optionId!==null&&Object.hasOwn(next.options,row.optionId)){
  for(const key of active)delete next.options[row.optionId][key];
  if(!Object.keys(next.options[row.optionId]).length)delete next.options[row.optionId];
 }
 return validateProductLabelOverrides(next);
}

export function planAllProductLabels(view:ProductLabelsView,sourceOptionId:string|null,draft:ProductLabelDraft={},structure?:ProductLabelStructure):AllProductLabelPlan{
 verifyProductLabelsView(view,sourceOptionId);
 const fields=validateProductLabelStructure(structure??productLabelStructure(view));
 validateProductLabelChanges(Object.entries(draft).map(([fieldKey,value])=>({optionId:sourceOptionId,fieldKey,value})),view.rows.flatMap(row=>row.optionId?[row.optionId]:[]),fields,true);
 const values=Object.fromEntries(fields.map(field=>[field.id,productLabelValue(view,sourceOptionId,field.id,draft)])) as ProductLabelValues;
 const overrides=applyAllProductLabelValues(view,values,fields),rows=view.rows.map(row=>({...row,values:{...values},
  automatic:Object.fromEntries(fields.map(field=>[field.id,row.automatic[field.id]??''])) as ProductLabelValues,
  sources:Object.fromEntries(fields.map(field=>[field.id,'manual-common'])) as typeof row.sources}));
 // Common render authority avoids pretending excluded rows are included.
 productLabelPlan({...view,overrides,rows,structure:fields},null);
 return {values,structure:fields,optionIds:view.rows.map(row=>row.optionId),optionCount:view.rows.filter(row=>row.optionId!==null).length,
  changedOptionCount:view.rows.filter(row=>row.optionId!==null&&fields.some(field=>row.values[field.id]!==values[field.id])).length};
}

export function verifyAllProductLabelTextSave(before:ProductLabelsView,after:ProductLabelsView,plan:AllProductLabelPlan){
 verifyProductLabelsView(after,null);
 if(after.productId!==before.productId||after.revision!==before.revision+1||after.updatedAt!==after.productVersion||Date.parse(after.productVersion)<=Date.parse(before.productVersion)
  ||after.contentRevision!==before.contentRevision||after.optionRevision!==before.optionRevision||after.quotationRevision!==before.quotationRevision
  ||after.renderEpoch!==before.renderEpoch||!same(after.categoryContext,before.categoryContext)||!same(after.imageKeys,before.imageKeys)||!same(identities(after),identities(before))
  ||!same(plan.optionIds,before.rows.map(row=>row.optionId))||!same(after.structure,plan.structure)||!same(after.overrides,applyAllProductLabelValues(before,plan.values,plan.structure)))throw changed();
 for(const [index,row]of after.rows.entries())for(const field of productLabelDefinitions(after)){
  if(row.values[field.key]!==plan.values[field.key]||row.sources[field.key]!=='manual-common'
   ||Object.hasOwn(before.rows[index].automatic,field.key)&&row.automatic[field.key]!==before.rows[index].automatic[field.key])throw changed();
 }
}

/** One atomic existing quotation save: common PNG + remove only label-image
 * overrides. Prices, notice fields, other image groups and stored files remain. */
export function allProductLabelImageChanges(view:QuotationFieldsView,key:string):QuotationChange[]{
 const target=exactPrimaryQuotationTarget(view.resolved.schema.fields,'labelImages');
 if(!key||!view.imageKeys.includes(key)||!Array.isArray(view.resolved.rows)||!view.resolved.rows.some(row=>row.optionId===null)
  ||new Set(view.resolved.rows.map(row=>row.optionId)).size!==view.resolved.rows.length)throw changed();
 const changes:QuotationChange[]=[];
 for(const id of target.linked){
  if(view.overrides.common[id]!==key)changes.push({optionId:null,fieldKey:id,value:key});
  for(const row of view.resolved.rows)if(row.optionId!==null&&Object.hasOwn(view.overrides.options[row.optionId]??{},id))changes.push({optionId:row.optionId,fieldKey:id,value:null});
 }
 if(!changes.length){if(view.resolved.rows.some(row=>target.linked.some(id=>row.fields[id]?.value!==key)))throw changed();return [];}
 return validateQuotationChanges(changes,{schema:view.resolved.schema,optionIds:view.resolved.rows.flatMap(row=>row.optionId?[row.optionId]:[]),ownedImageKeys:view.imageKeys,overrides:view.overrides});
}

export function verifyAllProductLabelImageSave(before:QuotationFieldsView,after:QuotationFieldsView,changes:readonly QuotationChange[]){
 const target=exactPrimaryQuotationTarget(before.resolved.schema.fields,'labelImages'),value=applyQuotationChanges(before.overrides,changes).common[target.primary];
 if(!changes.length){
  if(!value||!same(before,after)||after.resolved.rows.some(row=>target.linked.some(id=>row.fields[id]?.value!==value)))throw changed();
  return;
 }
 if(!value||after.revision!==before.revision+(changes.length?1:0)||after.updatedAt!==after.productVersion
  ||(changes.length?Date.parse(after.productVersion)<=Date.parse(before.productVersion):after.productVersion!==before.productVersion)
  ||after.contentRevision!==before.contentRevision||after.optionRevision!==before.optionRevision||!same(after.categoryContext,before.categoryContext)||!same(after.imageKeys,before.imageKeys)
  ||!same(after.packagingBasis,before.packagingBasis)||!same(after.stageTwoMsrp,before.stageTwoMsrp)
  ||!same(exactPrimaryQuotationTarget(after.resolved.schema.fields,'labelImages'),target)||!same(after.overrides,applyQuotationChanges(before.overrides,changes))
  ||!same(after.resolved.rows.map(row=>[row.optionId,row.optionLabel,row.included]),before.resolved.rows.map(row=>[row.optionId,row.optionLabel,row.included]))
  ||after.resolved.rows.some(row=>target.linked.some(id=>row.fields[id]?.value!==value)))throw changed();
}
