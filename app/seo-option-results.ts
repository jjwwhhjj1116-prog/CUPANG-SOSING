import type {SeoCompositionContext} from '@/app/seo-composition-context';
import type {TranslationReview,TranslationResult} from '@/app/automation/translation';
import {guardCurrentSeoDraft,normalizeSeoQuantityNumbers} from '@/app/seo-current-policy';
import {translationNumbers} from '@/app/translation-attribute-evidence';
import {optionInputs,type ProductOptions} from '@/app/product-options';
export type SeoOptionTranslation={optionId:string;name?:string;color?:string;size?:string};
export type SeoOptionTarget=SeoCompositionContext['selectedOptions'][number];
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function parseSeoOptionResultShape(raw:unknown,targets:readonly SeoOptionTarget[]):SeoOptionTranslation[]{
 if(!Array.isArray(raw)||raw.length>targets.length)throw Error('SEO_OPTION_SCOPE');const seen=new Set<string>();
 for(const value of raw){if(!object(value)||Object.keys(value).some(key=>!['optionId','name','color','size'].includes(key))||typeof value.optionId!=='string'||!targets.some(target=>target.id===value.optionId)||seen.has(value.optionId))throw Error('SEO_OPTION_FOREIGN_OR_DUPLICATE');seen.add(value.optionId);for(const field of ['name','color','size'] as const)if(Object.hasOwn(value,field)&&(typeof value[field]!=='string'||value[field].length>(field==='name'?500:200)||/[\u0000-\u001f\u007f]/u.test(value[field])))throw Error('SEO_OPTION_FIELD');}
 return raw.map(value=>({...value})) as SeoOptionTranslation[];
}
/** IDs belong to the server-bound selected cohort, never response position. */
export function validateSeoOptionResults(raw:unknown,targets:readonly SeoOptionTarget[],review:TranslationReview){
 if(!review.seoComposition||!Array.isArray(raw)||raw.length>targets.length)throw Error('SEO_OPTION_SCOPE');
 const seen=new Set<string>(),warnings:string[]=[],values:SeoOptionTranslation[]=[];
 for(const value of raw){
  if(!object(value)||Object.keys(value).some(key=>!['optionId','name','color','size'].includes(key))||typeof value.optionId!=='string'||seen.has(value.optionId))throw Error('SEO_OPTION_DUPLICATE_OR_SHAPE');
  const target=targets.find(target=>target.id===value.optionId);if(!target)throw Error('SEO_OPTION_FOREIGN_ID');seen.add(target.id);const result:SeoOptionTranslation={optionId:target.id};
  for(const field of ['name','color','size'] as const){
   if(!Object.hasOwn(value,field))continue;const text=value[field];if(typeof text!=='string'||text.length>(field==='name'?500:200)||/[\u0000-\u001f\u007f]/u.test(text))throw Error('SEO_OPTION_FIELD');
   const original=target[field],manual=field==='name'?target.manualName:field==='color'?target.manualColor:target.manualSize;
   if(manual){warnings.push('직접 수정한 옵션 '+target.id+' '+field+' 값을 유지합니다.');continue;}
   if(!original.trim()){if(text.trim())throw Error('SEO_OPTION_UNSUPPORTED_FIELD');continue;}
   const source={...review.source,attributes:[{name:(field==='name'?'option:':'option-'+field+':')+target.id,value:original}]};
   const guarded=guardCurrentSeoDraft({title:'',description:'',keywords:[],attributes:[{sourceIndex:0,name:'옵션명',value:text}],warnings:[]},source,review.seoComposition,{optionRevision:review.seoCompositionContext?.optionRevision??0,selectedOptions:[target],bundleQuantity:null},true);
   const translated=guarded.attributes[0]?.value??'';if(!translated.trim()){warnings.push('옵션 '+target.id+' '+field+' 번역 누락: 원문을 유지합니다.');continue;}
   const before=new Set(translationNumbers(normalizeSeoQuantityNumbers(original))),after=new Set(translationNumbers(translated));if([...before].some(number=>!after.has(number))||[...after].some(number=>!before.has(number)))throw Error('SEO_OPTION_NUMBER_CHANGED');
   const units=(text:string)=>text.replace(/厘米/gu,'cm').replace(/毫米/gu,'mm').replace(/毫升/gu,'ml').match(/\d+(?:[.,]\d+)*\s*(?:mm²|cm²|m²|mm|cm|km|kg|mg|ml|g|m|l)(?![A-Za-z0-9²])/giu)?.map(value=>value.replace(/\s/gu,'').toLowerCase())??[],codes=original.match(/\b[A-Za-z]+[-_]?[0-9][A-Za-z0-9._/-]*\b/gu)??[];if(units(original).some(unit=>!units(translated).includes(unit))||codes.some(code=>!translated.includes(code)))throw Error('SEO_OPTION_UNIT_OR_CODE_CHANGED');
   if(/\p{Script=Han}/u.test(translated))throw Error('SEO_OPTION_HAN');result[field]=translated;warnings.push(...guarded.warnings);
  }
  values.push(result);
 }
 for(const target of targets)for(const field of ['name','color','size'] as const){const manual=field==='name'?target.manualName:field==='color'?target.manualColor:target.manualSize;if(target[field].trim()&&!manual&&!values.find(value=>value.optionId===target.id)?.[field])warnings.push('옵션 '+target.id+' '+field+' 번역이 누락되어 저장 원문을 유지합니다.');}
 return {values,warnings};
}
export function adoptSeoOptionResults(options:ProductOptions,review:TranslationReview,result:TranslationResult){
 const context=review.seoCompositionContext;if(!context||context.optionRevision!==options.revision||result.seoOptions===undefined)throw Error('SEO_OPTION_REVISION');
 const checked=validateSeoOptionResults(result.seoOptions,context.selectedOptions,review),rows=optionInputs(options),reviewed:{optionId:string;field:'translatedName'|'color'|'size'}[]=[];
 for(const value of checked.values){const row=rows.find(row=>row.id===value.optionId),original=options.rows.find(row=>row.id===value.optionId),target=context.selectedOptions.find(row=>row.id===value.optionId);if(!row||!original||!target||!row.included||row.originalName!==target.name)throw Error('SEO_OPTION_CURRENT_ID');
  for(const field of ['name','color','size'] as const){const key=field==='name'?'translatedName':field;if(value[field]===undefined||original.provenance[key]==='manual')continue;row[key]=value[field]!;reviewed.push({optionId:row.id,field:key});}
 }
 return {rows,reviewed,changed:reviewed.length,warnings:checked.warnings};
}
