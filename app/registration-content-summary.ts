import { contentDetailImageKeys, type ProductContent } from '@/app/product-content';
import { getQuotationSchema, type QuotationOverrides } from '@/app/quotation-schema';
import { exactPrimaryQuotationTarget, type PrimaryQuotationInput, type PrimaryQuotationTarget } from '@/app/quotation-seo-targets';
import { scopedQuotationOverrides } from '@/app/quotation-scopes';
import { isOwnedImageKey } from '@/app/image-files';
import type { HubSchemaSnapshot } from '@/app/supplier-hub-schema';
import type { TemplateDefinition } from '@/app/category-profiles';
import { quotationMainImageKeys } from '@/app/product-options';
export type RegistrationContentSummary = { seo: boolean; seoTitle: string | null; mainImageKey: string | null; main: number; additional: number; detail: number; label: number; missingImages: boolean };
export type RegistrationQuotationLabels = { ownerId:string;categoryId:string|null;categoryPath:string[];hubSchema?:HubSchemaSnapshot;template?:TemplateDefinition|null;
  options:{revision:number;rows:{id:string;included:boolean;imageKey?:string|null}[]};state:{overrides:QuotationOverrides;categoryOverrides?:Record<string,QuotationOverrides>} };
function finalContentSummary(product:{id:string;image_keys:string},content:ProductContent|null,input:RegistrationQuotationLabels,summary:RegistrationContentSummary){
 const keys=JSON.parse(product.image_keys) as string[],schema=getQuotationSchema(input.categoryId,input.categoryPath,input.hubSchema,input.template);
 const targets:Partial<Record<PrimaryQuotationInput,PrimaryQuotationTarget>>={};let unconfirmedTarget=false;
 for(const id of ['title','mainImage','additionalImages','detailImages','labelImages'] as const){try{targets[id]=exactPrimaryQuotationTarget(schema.fields,id);}catch{unconfirmedTarget=true;}}
 if(!Number.isSafeInteger(input.options.revision)||input.options.revision<0||!Array.isArray(input.options.rows)||input.options.rows.length>200
   ||input.options.rows.some(row=>!row||!/^[A-Za-z0-9_-]{1,80}$/.test(row.id)||typeof row.included!=='boolean'||row.imageKey!==undefined&&row.imageKey!==null&&typeof row.imageKey!=='string')||new Set(input.options.rows.map(row=>row.id)).size!==input.options.rows.length)throw Error('Invalid final option scope');
 const overrides=scopedQuotationOverrides(input.state,input.categoryId),record=(value:unknown)=>!!value&&typeof value==='object'&&!Array.isArray(value);
 if(!record(overrides.common)||!record(overrides.options))throw Error('Invalid final overrides');
 const included:(string|null)[]=input.options.rows.filter(row=>row.included).map(row=>row.id);if(!input.options.rows.length&&input.options.revision===0)included.push(null);
 const images={main:new Set<string>(),additional:new Set<string>(),detail:new Set<string>(),label:new Set<string>()};let missingImages=unconfirmedTarget||schema.status!=='observed'||!!schema.unsupportedFields?.length,seoTitle=summary.seoTitle,seo=summary.seo,mainImageKey:string|null=null;
 for(const id of included){
  const own=id!==null&&Object.hasOwn(overrides.options,id)?overrides.options[id]:undefined;if(own!==undefined&&!record(own))throw Error('Invalid final option values');
  const manual=(name:PrimaryQuotationInput)=>{const target=targets[name];if(!target)return undefined;const value=target.primaryField.readOnly?undefined:(own&&Object.hasOwn(own,target.primary)?own[target.primary]:Object.hasOwn(overrides.common,target.primary)?overrides.common[target.primary]:undefined);if(value!==undefined&&typeof value!=='string')throw Error('Invalid final reference value');return value;};
  // The first included option is the representative row in the reviewed file.
  // A manual blank stays blank instead of recovering the previous SEO title.
  const title=manual('title');if(id===included[0]&&title!==undefined){seoTitle=title;seo=Boolean(title.trim());}
  const option=id===null?null:input.options.rows.find(row=>row.id===id)!;
  const automatic={main:quotationMainImageKeys(option?{imageKey:option.imageKey??null}:null,content?.assets?.main?.value??[]),additional:content?.assets?.additional?.value??[],detail:content?contentDetailImageKeys(content):[],label:content?.assets?.label?.value??[]};
  for(const [role,name]of [['main','mainImage'],['additional','additionalImages'],['detail','detailImages'],['label','labelImages']] as const){
   const value=manual(name),selected=value!==undefined?value.split(/\r?\n/).map(key=>key.trim()).filter(Boolean):automatic[role];
   for(const key of selected){if(!keys.includes(key)||!isOwnedImageKey(input.ownerId,key))missingImages=true;else{images[role].add(key);if(role==='main'&&id===included[0]&&mainImageKey===null)mainImageKey=key;}}
  }
 }
 return {seoTitle,seo,mainImageKey,main:images.main.size,additional:images.additional.size,detail:images.detail.size,label:images.label.size,missingImages};
}
/** Reads final included title/image references only. A reference count is never an
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
  const additional=count(['additional']),detail=count(['detailTop','detail','detailBottom']);
  const summary={seoTitle,mainImageKey,seo:typeof content?.seo?.title?.value==='string'&&!!content.seo.title.value.trim(),main,additional,detail,label:count(['label']),missingImages};
  if(finalLabels===undefined)return summary;
  if(finalLabels===null)return {...summary,missingImages:true};
  try{return finalContentSummary(product,content,finalLabels,summary);}
  catch{return {...summary,missingImages:true};}
}
