import type {ContentPatch,ProductContent} from '@/app/product-content';
import type {QuotationField,QuotationSchema,QuotationSource} from '@/app/quotation-schema';
import {readInitialLegalNotices} from '@/app/initial-legal-notices';

export type ExplicitSeoQuotationDefaults={policy:'couplus-explicit-seo-defaults-v1';productId:string;categoryId:string;categoryPath:string[];sourceTitle:string;sourceUpdatedAt:string};
const path=(field:QuotationField,value:readonly string[])=>JSON.stringify(field.hubWire?.path)===JSON.stringify(value);
const validTitle=(value:unknown):value is string=>typeof value==='string'&&!!value.trim()&&value.length<=500&&/\p{Script=Hangul}/u.test(value)&&!/\p{Script=Han}|[\u0000-\u001f]|[\uD800-\uDFFF]/u.test(value);
function nativeScope(content:ProductContent){
 const value=content.initialLegalNotices;
 if(!value||value.format!=='couplus-initial-legal-notices-v1'||!/^\d{1,20}$/u.test(value.categoryId)||!Array.isArray(value.categoryPath)||!value.categoryPath.length||value.categoryPath.length>10
  ||value.categoryPath.some(item=>typeof item!=='string'||!item.trim()||item.length>200)||!Array.isArray(value.fields))return null;
 const notices=value.fields.flatMap(item=>{try{const field=JSON.parse(item.signature) as QuotationField;
  return item.fieldId===field.id&&JSON.stringify(field)===item.signature&&field.section==='legal'&&field.visibility==='common'&&field.label==='품명 및 모델명'
   &&path(field,['legalPage','notices'])&&field.hubWire?.name==='품명 및 모델명'&&field.hubWire.nameKey==='noticeItemName'&&field.hubWire.valueKey==='noticeItemValue'?[item.signature]:[];
 }catch{return[];}});
 return notices.length===1?{categoryId:value.categoryId,categoryPath:value.categoryPath,noticeSignature:notices[0]}:null;
}
/** Explicit SEO writers only. Reads, intake execution and option-only saves never call this. */
export function applyExplicitSeoQuotationDefaults(content:ProductContent,seo:ContentPatch['seo']):boolean{
 if(!seo||!Object.keys(seo).length||!validTitle(content.seo.title.value)||!content.seo.title.updatedAt||!Number.isFinite(Date.parse(content.seo.title.updatedAt)))return false;
 const scope=nativeScope(content);if(!scope)return false;
 content.explicitSeoQuotationDefaults={policy:'couplus-explicit-seo-defaults-v1',productId:content.productId,categoryId:scope.categoryId,categoryPath:[...scope.categoryPath],sourceTitle:content.seo.title.value,sourceUpdatedAt:content.seo.title.updatedAt};return true;
}
/** Scope is proved once for one synchronous immutable source resolution. There
 * is no cross-request cache or partial revision key. Legacy content exits
 * before parsing the initial native notice signatures. */
export function explicitSeoQuotationDefaultsResolver(content:ProductContent,schema:QuotationSchema):(field:QuotationField,automatic:{value:string;source:QuotationSource})=>string|null{
 const proof=content.explicitSeoQuotationDefaults;
 if(!proof)return()=>null;
 const scope=nativeScope(content);
 if(!scope||Object.keys(proof).sort().join(',')!=='categoryId,categoryPath,policy,productId,sourceTitle,sourceUpdatedAt'||proof.policy!=='couplus-explicit-seo-defaults-v1'
  ||proof.productId!==content.productId||proof.categoryId!==scope.categoryId||proof.categoryId!==schema.categoryId||JSON.stringify(proof.categoryPath)!==JSON.stringify(scope.categoryPath)
  ||JSON.stringify(proof.categoryPath)!==JSON.stringify(schema.categoryPath)||proof.sourceTitle!==content.seo.title.value||proof.sourceUpdatedAt!==content.seo.title.updatedAt
  ||typeof proof.sourceUpdatedAt!=='string'||proof.sourceUpdatedAt.length>30||!Number.isFinite(Date.parse(proof.sourceUpdatedAt))
  ||!validTitle(proof.sourceTitle)||schema.status!=='observed'||schema.unsupportedFields?.length||!readInitialLegalNotices(content.initialLegalNotices,schema).size)return()=>null;
 const models=schema.fields.filter(item=>item.hubInput==='model');
 const modelManual=content.label.model.provenance==='manual',noticeManual=content.label.productName.provenance==='manual';
 const title=proof.sourceTitle.trim();let shortTitle=title.slice(0,50);const last=shortTitle.charCodeAt(shortTitle.length-1);if(last>=0xd800&&last<=0xdbff)shortTitle=shortTitle.slice(0,-1);
 return(field,automatic)=>{
 if(field.readOnly||field.type!=='text'||field.choices||field.numericText||field.numericValue
  ||automatic.value.trim()&&!(automatic.source==='couplus-default'&&automatic.value==='해당사항없음'))return null;
 const model=models.length===1&&field.id===models[0].id&&field.section==='product'&&field.visibility==='common'&&path(field,['productPage','modelNumber'])
  &&field.hubWire&&Object.keys(field.hubWire).length===1;
 const peer=field.contentField==='model'&&field.visibility==='hidden'&&field.label==='모델명/품번'&&path(field,['productPage','unexposedAttributes'])&&field.hubWire?.name==='모델명/품번'
  &&field.hubWire.nameKey==='attributeName'&&field.hubWire.valueKey==='attributeValue';
 const notice=JSON.stringify(field)===scope.noticeSignature;
 if(!model&&!peer&&!notice||((model||peer)&&modelManual)||notice&&noticeManual)return null;
 return (model||peer?shortTitle:title)||null;
 };
}
/** A saved explicit intent changes only this product's untouched native fields.
 * Manual quotation layers still take priority in the ordinary resolver. */
export function explicitSeoQuotationDefault(content:ProductContent,schema:QuotationSchema,field:QuotationField,automatic:{value:string;source:QuotationSource}):string|null{
 return explicitSeoQuotationDefaultsResolver(content,schema)(field,automatic);
}
