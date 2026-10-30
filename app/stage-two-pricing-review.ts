import {calculatePrice,pricePolicy,type PricePolicy} from '@/app/pricing';
import {calculateOptionPrices,type ProductOptions} from '@/app/product-options';
import {quotationPriceInputs,quotationPriceTargets} from '@/app/quotation-price-targets';
import {quotationNumericValue,quotationScalarValueIssues} from '@/app/quotation-scalar-constraints';
import {scopedQuotationOverrides} from '@/app/quotation-scopes';
import type {QuotationSchema} from '@/app/quotation-schema';
import type {QuotationFieldsState} from '@/db/quotation-fields';

/** Server-created saved review of this configuration, not a client status flag
 * or evidence of Supplier Hub submission. configuration is canonical JSON. */
export type StageTwoPricingReview={schemaVersion:1;ownerId:string;productId:string;profileId:string|null;categoryId:string|null;
  productVersion:string;sourceProductVersion:string;sourceInputFingerprint:string;companyCode?:string;companyName?:string;configuration:string};
export type StageTwoPricingReviewInput={ownerId:string;product:{id:string;source_price_cny:number;updated_at:string};policy:PricePolicy;
  options:ProductOptions;state:QuotationFieldsState;schema:QuotationSchema;profileId?:string|null;sourceInputFingerprint?:string;
  sourceProductVersion?:string;savedAt?:string;company?:{code:string;name:string}|null};
const fail=()=>Error('가격 검토 저장의 현재 설정과 연결 근거를 확인해주세요.');
const text=(value:unknown,max=256):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f]/u.test(value);
const time=(value:unknown):value is string=>text(value,40)&&Number.isFinite(Date.parse(value));
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const category=(value:unknown):value is string|null=>value===null||text(value,100)&&/^[A-Za-z0-9_-]+$/u.test(value);
const profile=(value:unknown):value is string|null=>value===null||text(value,100)&&/^[A-Za-z0-9_-]+$/u.test(value);
function canonical(value:unknown,seen=new Set<object>(),depth=0):string{
  if(depth>30)throw fail();
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){if(!Number.isFinite(value))throw fail();return JSON.stringify(value);}
  if(typeof value!=='object'||seen.has(value))throw fail();seen.add(value);
  const result=Array.isArray(value)?`[${value.map(item=>canonical(item,seen,depth+1)).join(',')}]`:
    `{${Object.keys(value).filter(key=>(value as Record<string,unknown>)[key]!==undefined).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key],seen,depth+1)}`).join(',')}}`;
  seen.delete(value);return result;
}
function configuration(input:StageTwoPricingReviewInput):string{
  const {product,options,state,schema}=input;
  if(!text(input.ownerId)||!text(product?.id)||!time(product.updated_at)||!profile(input.profileId??null)
    ||!schema||schema.version!==1||!category(schema.categoryId)||!Array.isArray(schema.categoryPath)||schema.categoryPath.some(part=>!text(part,200))
    ||!Array.isArray(schema.fields)||new Set(schema.fields.map(field=>field.id)).size!==schema.fields.length
    ||!options||options.schemaVersion!==1||options.productId!==product.id||!Number.isSafeInteger(options.revision)||options.revision<0
    ||!Array.isArray(options.rows)||options.rows.length>200||!state||state.schemaVersion!==1||state.productId!==product.id
    ||!Number.isSafeInteger(state.revision)||state.revision<0||!record(state.overrides)||!record(state.overrides.common)||!record(state.overrides.options))throw fail();
  if(input.company!==undefined&&input.company!==null&&(!text(input.company.code,100)||!text(input.company.name,200)))throw fail();
  const policy=pricePolicy(input.policy);
  // Representative source arithmetic must also be valid; it is not substituted
  // for the distinct saved per-option costs and reviewed pack quantities.
  calculatePrice(product.source_price_cny,policy);
  const ids=new Set<string>();
  const tuples=options.rows.map(row=>{
    if(!row||!text(row.id,80)||!/^[A-Za-z0-9_-]+$/u.test(row.id)||ids.has(row.id)||typeof row.included!=='boolean'
      ||!Number.isSafeInteger(row.unitsPerPack)||row.unitsPerPack<1||row.unitsPerPack>1e6
      ||row.unitCostCny!==null&&(typeof row.unitCostCny!=='number'||!Number.isFinite(row.unitCostCny)||row.unitCostCny<=0||row.unitCostCny>1e9))throw fail();
    ids.add(row.id);return [row.id,row.included,row.unitCostCny,row.unitsPerPack];
  });
  const included=options.rows.filter(row=>row.included);if(!included.length||schema.maxIncludedOptions!==undefined&&included.length>schema.maxIncludedOptions)throw fail();
  const prices=calculateOptionPrices(options.rows,policy),targets=quotationPriceTargets(schema.fields),overrides=scopedQuotationOverrides(state,schema.categoryId);
  if(!record(overrides)||!record(overrides.common)||!record(overrides.options))throw fail();
  const bindings=included.map(option=>{
    const calculation=prices.find(row=>row.optionId===option.id);if(calculation?.error||!calculation?.calculation)throw fail();
    const own=Object.hasOwn(overrides.options,option.id)?overrides.options[option.id]:undefined;if(own!==undefined&&!record(own))throw fail();
    const values=quotationPriceInputs.map(key=>{
      const target=targets[key],cells=target.linked.map(id=>{
        const field=schema.fields.find(field=>field.id===id);if(!field||field.hubInput!==undefined&&field.hubInput!==key)throw fail();
        const automatic=String(calculation.calculation![key]),value=field.readOnly?automatic:
          own&&Object.hasOwn(own,id)?own[id]:Object.hasOwn(overrides.common,id)?overrides.common[id]:automatic;
        if(typeof value!=='string')throw fail();
        if(!value.trim()){if(key!=='msrp'||field.required)throw fail();}
        else{const number=quotationNumericValue(field,value);if(number===undefined||number<=0||quotationScalarValueIssues(field,value).length)throw fail();}
        return {id,value};
      });
      if(cells.some(cell=>cell.value!==cells[0].value))throw fail();return {input:key,primary:target.primary,cells};
    });
    const supply=Number(values.find(item=>item.input==='supplyPrice')!.cells[0].value),sale=Number(values.find(item=>item.input==='salePrice')!.cells[0].value);
    if(schema.salePriceMustCoverSupply&&sale<supply)throw fail();
    return {optionId:option.id,values};
  });
  const contracts=quotationPriceInputs.map(key=>({input:key,primary:targets[key].primary,linked:targets[key].linked.map(id=>schema.fields.find(field=>field.id===id)!)}));
  const result=canonical({policy,sourcePriceCny:product.source_price_cny,options:tuples,category:{id:schema.categoryId,path:schema.categoryPath},
    priceContract:{fields:contracts,salePriceMustCoverSupply:schema.salePriceMustCoverSupply??false,maxIncludedOptions:schema.maxIncludedOptions??null},bindings});
  if(result.length>512*1024)throw fail();return result;
}
export function createStageTwoPricingReview(input:StageTwoPricingReviewInput):StageTwoPricingReview{
  const savedAt=input.savedAt??input.product.updated_at,sourceProductVersion=input.sourceProductVersion;
  if(!time(savedAt)||savedAt!==input.product.updated_at||!time(sourceProductVersion)||Date.parse(sourceProductVersion)>=Date.parse(savedAt)||!hash(input.sourceInputFingerprint))throw fail();
  return {schemaVersion:1,ownerId:input.ownerId,productId:input.product.id,profileId:input.profileId??null,categoryId:input.schema.categoryId,
    productVersion:savedAt,sourceProductVersion,sourceInputFingerprint:input.sourceInputFingerprint,
    ...(input.company?{companyCode:input.company.code,companyName:input.company.name}:{}),configuration:configuration(input)};
}
export function matchesStageTwoPricingReview(receipt:unknown,input:StageTwoPricingReviewInput):receipt is StageTwoPricingReview{
  try{
    if(!record(receipt)||Object.keys(receipt).some(key=>!['schemaVersion','ownerId','productId','profileId','categoryId','productVersion','sourceProductVersion','sourceInputFingerprint','companyCode','companyName','configuration'].includes(key))
      ||receipt.schemaVersion!==1||receipt.ownerId!==input.ownerId||receipt.productId!==input.product.id||receipt.categoryId!==input.schema.categoryId||!profile(receipt.profileId)
      ||input.profileId!==undefined&&receipt.profileId!==input.profileId||!time(receipt.productVersion)||!time(receipt.sourceProductVersion)||!time(input.product.updated_at)
      ||Date.parse(receipt.sourceProductVersion)>=Date.parse(receipt.productVersion)||Date.parse(receipt.productVersion)>Date.parse(input.product.updated_at)||!hash(receipt.sourceInputFingerprint)
      ||input.sourceInputFingerprint!==undefined&&receipt.sourceInputFingerprint!==input.sourceInputFingerprint
      ||input.sourceProductVersion!==undefined&&receipt.sourceProductVersion!==input.sourceProductVersion||input.savedAt!==undefined&&receipt.productVersion!==input.savedAt
      ||typeof receipt.configuration!=='string'||receipt.configuration.length>512*1024
      ||(receipt.companyCode===undefined)!==(receipt.companyName===undefined)
      ||receipt.companyCode!==undefined&&(!text(receipt.companyCode,100)||!text(receipt.companyName,200))
      ||input.company!==undefined&&input.company!==null&&(receipt.companyCode!==input.company.code||receipt.companyName!==input.company.name))return false;
    return receipt.configuration===configuration(input);
  }catch{return false;}
}
