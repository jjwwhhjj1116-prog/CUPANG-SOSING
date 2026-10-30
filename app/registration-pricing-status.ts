import {calculatePrice,pricePolicy} from '@/app/pricing';
import {calculateOptionPrices,type ProductOptions} from '@/app/product-options';
import {quotationPriceTargets} from '@/app/quotation-price-targets';
import {quotationScalarValueIssues} from '@/app/quotation-scalar-constraints';
import {scopedQuotationOverrides} from '@/app/quotation-scopes';
import type {QuotationSchema} from '@/app/quotation-schema';
import type {QuotationFieldsState} from '@/db/quotation-fields';

export type RegistrationPricingProduct={id:string;created_at?:string;updated_at?:string;pricing_policy?:string|null;source_price_cny?:number;exchange_rate?:number;supply_margin?:number;coupang_margin?:number;supply_price?:number|null;sale_price?:number|null;msrp?:number|null;options_count?:number};
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const timestamp=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value));

/** Stage-two recalculation intentionally removes manual price overrides.
 * Its saved arithmetic policy records explicit intent; completion additionally
 * requires coherent current product, included-option and exact bound prices.
 * This is saved configuration, never an external price/registration assertion. */
export function savedRecalculatedRegistrationPricing(product:RegistrationPricingProduct,options:ProductOptions,state:QuotationFieldsState,schema:QuotationSchema):boolean {
 try{
  if(!product.pricing_policy||!timestamp(product.updated_at)||schema.status!=='observed'||schema.unsupportedFields?.length
    ||options.schemaVersion!==1||options.productId!==product.id||!Number.isSafeInteger(options.revision)||options.revision<1
    ||!timestamp(options.updatedAt)||Date.parse(options.updatedAt)>Date.parse(product.updated_at)
    ||state.schemaVersion!==1||state.productId!==product.id||!Number.isSafeInteger(state.revision)||state.revision<1
    ||!timestamp(state.updatedAt)||Date.parse(state.updatedAt)>Date.parse(product.updated_at))return false;
  const raw:unknown=JSON.parse(product.pricing_policy);
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||(raw as {recalculationMode?:unknown}).recalculationMode!=='couplus-stage-two-v1')return false;
  const policy=pricePolicy(raw);
  if(!positive(product.source_price_cny)||product.exchange_rate!==policy.exchangeRate||product.supply_margin!==policy.supplyMargin||product.coupang_margin!==policy.coupangMargin)return false;
  const representative=calculatePrice(product.source_price_cny,policy);
  if(product.supply_price!==representative.supplyPrice||product.sale_price!==representative.salePrice||product.msrp!==representative.msrp)return false;
  const included=options.rows.filter(row=>row.included);
  if(!included.length||included.length!==product.options_count||new Set(options.rows.map(row=>row.id)).size!==options.rows.length)return false;
  const calculated=calculateOptionPrices(included,policy);
  if(calculated.length!==included.length||calculated.some(row=>row.error||!row.calculation||!positive(row.calculation.supplyPrice)||!positive(row.calculation.salePrice)))return false;
  const targets=quotationPriceTargets(schema.fields),overrides=scopedQuotationOverrides(state,schema.categoryId);
  for(const row of calculated){
   const own=Object.hasOwn(overrides.options,row.optionId)?overrides.options[row.optionId]:undefined;
   for(const input of ['supplyPrice','salePrice','msrp'] as const){
    const target=targets[input],fallback=String(row.calculation![input]);
    const values=target.linked.map(id=>({field:schema.fields.find(field=>field.id===id),value:own&&Object.hasOwn(own,id)?own[id]:Object.hasOwn(overrides.common,id)?overrides.common[id]:fallback}));
    if(values.some(({field,value})=>!field||typeof value!=='string'||!/^\d+(?:\.\d+)?$/.test(value.trim())||!Number.isFinite(Number(value))
      ||(input==='msrp'?Number(value)<0:Number(value)<=0)||quotationScalarValueIssues(field,value).length)||values.some(({value})=>value!==values[0].value))return false;
   }
  }
  return true;
 }catch{return false;}
}
