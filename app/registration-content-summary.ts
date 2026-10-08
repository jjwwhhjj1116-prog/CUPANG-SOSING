import type { ProductContent } from '@/app/product-content';
import { getQuotationSchema, type QuotationOverrides } from '@/app/quotation-schema';
import { exactPrimaryQuotationTarget } from '@/app/quotation-seo-targets';
import { scopedQuotationOverrides } from '@/app/quotation-scopes';
import { isOwnedImageKey } from '@/app/image-files';
import type { HubSchemaSnapshot } from '@/app/supplier-hub-schema';
export type RegistrationContentSummary = { seo: boolean; seoTitle: string | null; mainImageKey: string | null; main: number; additional: number; detail: number; label: number; missingImages: boolean };
export type RegistrationQuotationLabels = { ownerId:string;categoryId:string|null;categoryPath:string[];hubSchema?:HubSchemaSnapshot;
  options:{revision:number;rows:{id:string;included:boolean}[]};state:{overrides:QuotationOverrides;categoryOverrides?:Record<string,QuotationOverrides>} };
function labelSummary(product:{id:string;image_keys:string},content:ProductContent|null,input:RegistrationQuotationLabels){
 const keys=JSON.parse(product.image_keys) as string[],schema=getQuotationSchema(input.categoryId,input.categoryPath,input.hubSchema),target=exactPrimaryQuotationTarget(schema.fields,'labelImages');
 if(!Number.isSafeInteger(input.options.revision)||input.options.revision<0||!Array.isArray(input.options.rows)||input.options.rows.length>200
   ||input.options.rows.some(row=>!row||!/^[A-Za-z0-9_-]{1,80}$/.test(row.id)||typeof row.included!=='boolean')||new Set(input.options.rows.map(row=>row.id)).size!==input.options.rows.length)throw Error('Invalid label option scope');
 const overrides=scopedQuotationOverrides(input.state,input.categoryId),record=(value:unknown)=>!!value&&typeof value==='object'&&!Array.isArray(value);
 if(!record(overrides.common)||!record(overrides.options))throw Error('Invalid label overrides');
 const included:(string|null)[]=input.options.rows.filter(row=>row.included).map(row=>row.id);if(!input.options.rows.length&&input.options.revision===0)included.push(null);
 const automatic=content?.assets?.label?.value??[],images=new Set<string>();let missingImages=schema.status!=='observed'||!!schema.unsupportedFields?.length;
 for(const id of included){
  const own=id!==null&&Object.hasOwn(overrides.options,id)?overrides.options[id]:undefined;if(own!==undefined&&!record(own))throw Error('Invalid label option values');
  const manual=target.primaryField.readOnly?undefined:(own&&Object.hasOwn(own,target.primary)?own[target.primary]:Object.hasOwn(overrides.common,target.primary)?overrides.common[target.primary]:undefined);
  if(manual!==undefined&&typeof manual!=='string')throw Error('Invalid label reference value');
  const selected=manual!==undefined?manual.split(/\r?\n/).map(key=>key.trim()).filter(Boolean):automatic;
  for(const key of selected){if(!keys.includes(key)||!isOwnedImageKey(input.ownerId,key))missingImages=true;else images.add(key);}
 }
 return {label:images.size,missingImages};
}
/** Counts final included label references only. A reference count is never an
 * image-byte check, generated-plan freshness proof or Hub registration status. */
export function registrationContentSummary(product: {id:string;image_keys:string}, content: ProductContent | null, finalLabels?:RegistrationQuotationLabels|null): RegistrationContentSummary {
  const keys:unknown=JSON.parse(product.image_keys);
  if(!Array.isArray(keys)||keys.some(key=>typeof key!=='string'))throw Error('Invalid product images');
  if(content&&(content.productId!==product.id||content.schemaVersion!==1))throw Error('Invalid product content');
  let missingImages=false;
  const count=(roles:string[])=>{
    const saved=roles.flatMap(role=>{const values=content?.assets?.[role as keyof ProductContent['assets']]?.value??[];if(!Array.isArray(values)||values.some(key=>typeof key!=='string'))throw Error('Invalid content images');return values;});
    if(saved.some(key=>!keys.includes(key)))missingImages=true;
    return new Set(saved.filter(key=>keys.includes(key))).size;
  };
  const title=content?.seo?.title;
  const seoTitle=typeof title?.value==='string'&&(title.provenance==='manual'||title.value!=='')?title.value:null;
  const main=count(['main']);
  const mainImageKey=content?.assets?.main?.value?.find(key=>keys.includes(key))??null;
  const additional=count(['additional']),detail=count(['detailTop','detail','detailBottom']),nonLabelMissingImages=missingImages;
  const summary={seoTitle,mainImageKey,seo:typeof content?.seo?.title?.value==='string'&&!!content.seo.title.value.trim(),main,additional,detail,label:count(['label']),missingImages};
  if(finalLabels===undefined)return summary;
  if(finalLabels===null)return {...summary,missingImages:true};
  try{const final=labelSummary(product,content,finalLabels);return {...summary,label:final.label,missingImages:nonLabelMissingImages||final.missingImages};}
  catch{return {...summary,missingImages:true};}
}
