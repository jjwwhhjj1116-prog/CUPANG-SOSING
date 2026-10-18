import {labelFields,type LabelField,type ProductContent} from '@/app/product-content';
import type {TranslationJob} from '@/app/automation/translation';
import type {ProductLabelsState} from '@/app/product-label';
import {assertContentTranslationScope} from '@/app/translation-adoption';
import {translationAttributeIssue} from '@/app/translation-attribute-evidence';
import {collectionLabelField} from '@/app/collection-label-attributes';
import {translationLabelSourceScope} from '@/app/translation-label-source-scope';
export type TranslationLabelReuseMapping={sourceIndex:number;field:LabelField};
export type TranslationLabelReuseView={format:'translation-label-reuse-v1';productId:string;jobId:string;productVersion:string;contentRevision:number;inputFingerprint:string;
 categoryId:string;categoryPath:string[];sourceReference:string;attributes:{sourceIndex:number;sourceName:string;sourceValue:string;name:string;value:string}[];
 fields:{field:LabelField;label:string;before:string;eligible:boolean;reason:string|null}[];suggestions:TranslationLabelReuseMapping[];skipped:string[]};
export class TranslationLabelReuseError extends Error{constructor(message:string,public status=409,public code='TRANSLATION_LABEL_REUSE_CONFLICT'){super(message);}}
export function translationLabelReuseView(input:{job:TranslationJob;content:ProductContent;labels:ProductLabelsState;productVersion:string;categoryId:string;categoryPath:string[];inputFingerprint:string}):TranslationLabelReuseView{
 const {job,content,labels}=input;assertContentTranslationScope(job);
 if(job.productId!==content.productId||labels.productId!==content.productId||job.status!=='completed'||!job.result||!job.review.source.category
  ||job.review.source.category.id!==input.categoryId||JSON.stringify(job.review.source.category.path)!==JSON.stringify(input.categoryPath))throw new TranslationLabelReuseError('현재 상품·수집 카테고리의 완료된 속성 번역을 선택해주세요.');
 const skipped:string[]=[],seen=new Set<number>(),attributes:TranslationLabelReuseView['attributes']=[];
 for(const pair of job.result.draft.attributes){
  const source=job.review.source.attributes[pair.sourceIndex];if(!source?.name.startsWith('상품속성: '))continue;
  if(seen.has(pair.sourceIndex))throw new TranslationLabelReuseError('같은 원문에 번역값이 중복되어 재사용하지 않았습니다.');seen.add(pair.sourceIndex);
  if(!pair.value.trim()||pair.value.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(pair.value)||translationAttributeIssue(source,pair)){skipped.push(`${source.name}: 원문·숫자와 일치하지 않는 번역은 제외했습니다.`);continue;}
  attributes.push({sourceIndex:pair.sourceIndex,sourceName:source.name.slice('상품속성: '.length),sourceValue:source.value,name:pair.name.replace(/^상품속성: /u,''),value:pair.value});
 }
 if(!attributes.length)throw new TranslationLabelReuseError('재사용할 수 있는 완료된 수집 상품 속성 번역이 없습니다.');
 const fields=(Object.keys(labelFields) as LabelField[]).map(field=>{
  const reason=content.label[field].provenance==='manual'?'직접 저장한 공통 값·공란을 유지합니다.':Object.hasOwn(labels.overrides.common,field)?'제품 라벨에서 직접 저장한 공통 값·공란을 유지합니다.':null;
  return{field,label:labelFields[field],before:content.label[field].value,eligible:reason===null,reason};
 });
 const suggestions:TranslationLabelReuseMapping[]=[];
 for(const field of fields.filter(field=>field.eligible)){
  const candidates=attributes.filter(attribute=>{if(translationLabelSourceScope(attribute.sourceName))return false;const known=collectionLabelField(attribute.sourceName);return known?field.field===known:field.label===attribute.name;});
  if(candidates.length>1){skipped.push(`${field.label}: 연결 후보가 여러 개라 자동 선택하지 않았습니다.`);continue;}
  if(candidates.length===1&&field.before!==candidates[0].value)suggestions.push({sourceIndex:candidates[0].sourceIndex,field:field.field});
 }
 return{format:'translation-label-reuse-v1',productId:content.productId,jobId:job.id,productVersion:input.productVersion,contentRevision:content.revision,inputFingerprint:input.inputFingerprint,categoryId:input.categoryId,categoryPath:[...input.categoryPath],sourceReference:job.review.source.reference??'',attributes,fields,suggestions,skipped};
}
export function translationLabelReusePlan(view:TranslationLabelReuseView,mappings:unknown){
 if(!Array.isArray(mappings)||!mappings.length||mappings.length>Object.keys(labelFields).length)throw new TranslationLabelReuseError('연결할 표시사항을 한 개 이상 선택해주세요.',400,'TRANSLATION_LABEL_REUSE_INPUT');
 const indices=new Set<number>(),fields=new Set<string>(),label:Partial<Record<LabelField,string>>={};
 for(const raw of mappings){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==2||!Object.hasOwn(raw,'sourceIndex')||!Object.hasOwn(raw,'field')||!Number.isSafeInteger(raw.sourceIndex)||typeof raw.field!=='string'||indices.has(raw.sourceIndex)||fields.has(raw.field))throw new TranslationLabelReuseError('속성과 표시사항을 중복 없이 연결해주세요.',400,'TRANSLATION_LABEL_REUSE_INPUT');
  const source=view.attributes.find(item=>item.sourceIndex===raw.sourceIndex),field=view.fields.find(item=>item.field===raw.field);
  if(!source||!field||!field.eligible)throw new TranslationLabelReuseError('직접 수정값을 보존하며 현재 연결 가능한 속성만 선택해주세요.',400,'TRANSLATION_LABEL_REUSE_INPUT');
  if(source.value===field.before)throw new TranslationLabelReuseError('이미 같은 값인 항목은 제외하고 변경할 표시사항을 선택해주세요.',400,'TRANSLATION_LABEL_REUSE_INPUT');
  indices.add(raw.sourceIndex);fields.add(raw.field);label[field.field]=source.value;
 }
 return{label,applied:fields.size};
}
