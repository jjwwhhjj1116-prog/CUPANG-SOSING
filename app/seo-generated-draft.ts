import {seoCompositionContext} from '@/app/seo-composition-context';
import {assertGeneratedSeoQuality,validateSeoOptionResults} from '@/app/seo-option-results';
import type {TranslationJob} from '@/app/automation/translation';
import type {ProductContent} from '@/app/product-content';
import type {ProductOptions} from '@/app/product-options';
import type {SeoWorkspaceView} from '@/app/seo-workspace';
import type {SeoWorkspaceDraft} from '@/app/seo-workspace-client';
import {untouchedIntakeKeywords} from '@/app/translation-batch-adoption';
import {translationAttributeIssue} from '@/app/translation-attribute-evidence';
import {seoGuidanceTitle,seoGuidanceTags,validateSeoGuidanceComposition,type SeoGuidanceComposition} from '@/app/seo-guidance-composition';

type NameSource={id:string;originalName:string;supplierSku:string;translatedName:string;provenance:string;included:boolean};
export type SeoGeneratedDraft={
 format:'yoofam-seo-generated-draft-v1';ownerId:string|null;productId:string;productVersion:string;contentRevision:number;optionRevision:number;
 jobId:string;model:string;reviewFingerprint:string;sourceReference:string;
 intent:'explicit-regeneration'|'preserve-reviewed';
 source:{seo:ProductContent['seo'];options:NameSource[]};values:SeoWorkspaceDraft;warnings:string[];
};
const nameSources=(options:ProductOptions):NameSource[]=>options.rows.map(row=>({id:row.id,originalName:row.originalName,supplierSku:row.supplierSku,translatedName:row.translatedName,provenance:row.provenance.translatedName,included:row.included}));
const same=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);
export const seoGeneratedDraftKey=(draft:SeoGeneratedDraft)=>JSON.stringify([draft.ownerId,draft.productId,draft.productVersion,draft.contentRevision,draft.optionRevision,draft.jobId,draft.reviewFingerprint,draft.intent]);

/** Explicit regeneration asks for every included option name, even when its
 * prior saved translation was reviewed. The existing request cap still applies. */
export function seoRegenerationOptionBatch(options:ProductOptions,limit:number,additional:readonly {name:string;value:string}[]=[]){
 const names=options.rows.filter(row=>row.included&&row.originalName.trim()).map(row=>({name:'option:'+row.id,value:row.originalName}));
 const all=[...names,...additional.filter(pair=>!/^option:/u.test(pair.name))],count=Math.max(0,Math.floor(limit));
 return {attributes:all.slice(0,count),remaining:Math.max(0,all.length-count)};
}

/** A completed provider job becomes editable input only. No content, option or
 * provenance is changed until the member uses the ordinary explicit SEO save. */
export function createSeoGeneratedDraft(input:{ownerId?:string;productVersion:string;content:ProductContent;options:ProductOptions;job:TranslationJob;brand:string;memo?:Pick<SeoGuidanceComposition,'brand'|'features'|'keywords'>;replaceSaved?:boolean}):SeoGeneratedDraft{
 const {content,options,job,productVersion}=input;
 if(content.productId!==options.productId||job.productId!==content.productId||job.productVersion!==productVersion||job.contentRevision!==content.revision
  ||job.status!=='completed'||!job.result||job.error||job.result.model!==job.review.model||!/^[a-f0-9]{64}$/u.test(job.review.fingerprint)
  ||!Number.isSafeInteger(content.revision)||!Number.isSafeInteger(options.revision))throw Error('현재 상품·원문·옵션에 연결된 완료 SEO 초안을 확인해주세요.');
 if(job.review.seoCompositionContext&&(job.review.seoCompositionContext.optionRevision!==options.revision||JSON.stringify(job.review.seoCompositionContext.selectedOptions)!==JSON.stringify(seoCompositionContext(options).selectedOptions)))throw Error('SEO 생성 이후 선택 옵션·사용자 입력이 변경되었습니다.');
 assertGeneratedSeoQuality(job.review,job.result,job.review.seoComposition?.memo.brand??input.memo?.brand??input.brand);
 const values:SeoWorkspaceDraft={seo:{},optionNames:{}},draft=job.result.draft,warnings=[...draft.warnings];
 const eligible=(field:'title'|'keywords'|'description')=>input.replaceSaved||content.seo[field].provenance!=='manual'||field==='keywords'&&untouchedIntakeKeywords(content,job);
 const memo=input.memo?{...input.memo,brand:input.memo.brand.split(',')[0].trim()}:null;
 const composed:Partial<Pick<typeof draft,'title'|'keywords'>>={};
 if(memo&&!job.review.seoComposition){
  let targetsValid=true;
  try{const tags=seoGuidanceTags(draft,{...memo,title:''},job.review.seoKeywordPolicy==='couplus-generated-v1');if(eligible('keywords')){composed.keywords=tags.tags;if(tags.omitted.length)warnings.push('검색태그 한도에 맞지 않는 추가 번역 태그는 넣지 않았습니다. 타겟과 원문을 확인해주세요.');}}
  catch{targetsValid=false;if(eligible('title')||eligible('keywords'))warnings.push('타겟 검색태그가 20자·전체 150자 기준에 맞지 않아 원래 번역 검색태그를 유지했습니다.');}
  if(eligible('title'))try{
   // Target nouns append to the provider base; its product wording is not rewritten.
   const keywords=targetsValid?memo.keywords:'',title=seoGuidanceTitle(draft,{...memo,keywords});
   composed.title=validateSeoGuidanceComposition({...memo,keywords,title}).title.trim();
  }catch{warnings.push('특징·구성 상품명이 한 줄 100자 기준에 맞지 않아 원래 번역 상품명을 유지했습니다.');}
 }
 for(const field of ['title','keywords','description'] as const){
  if(!eligible(field))continue;
  const value=field==='description'?draft[field]:composed[field]??draft[field];if(field==='keywords'){
   if((value.length||job.review.seoKeywordPolicy==='couplus-generated-v1')&&(input.replaceSaved||!same(value,content.seo.keywords.value))){
    values.seo.keywords=(value as string[]).join(', ');
    if(job.review.seoKeywordPolicy==='couplus-generated-v1')values.generatedKeywords={text:values.seo.keywords,values:[...value as string[]]};
   }
  }else if(typeof value==='string'&&value.trim()){
   const prefix=(memo?.brand??input.brand).split(',')[0].trim();let name=field==='title'&&composed.title===undefined&&prefix&&value!==prefix&&!value.startsWith(prefix)?prefix+' '+value:value;
   if(memo&&field==='title'&&(name.length>100||/[\r\n]/u.test(name))){name=draft.title;if(name.length>100||/[\r\n]/u.test(name))continue;}
   if(input.replaceSaved||name!==content.seo[field].value)values.seo[field]=name;
  }
 }
 const seen=new Set<string>();
 for(const translated of draft.attributes){
  const source=job.review.source.attributes[translated.sourceIndex],id=source?.name.match(/^option:([A-Za-z0-9_-]{1,80})$/u)?.[1];
  if(!id||translationAttributeIssue(source,translated))continue;
  const row=options.rows.find(row=>row.id===id);if(!row||seen.has(id)||row.originalName!==source.value)throw Error('생성된 옵션명과 현재 옵션 원문 연결을 확인해주세요.');
  seen.add(id);if(!row.included||!input.replaceSaved&&(row.provenance.translatedName==='manual'||row.translatedName.trim()))continue;
  if(translated.value.trim())values.optionNames[id]=translated.value.trim();
 }
 if(job.review.seoCompositionContext&&job.result.seoOptions){const checked=validateSeoOptionResults(job.result.seoOptions,job.review.seoCompositionContext.selectedOptions,job.review);for(const value of checked.values){const row=options.rows.find(row=>row.id===value.optionId);if(row?.included&&row.provenance.translatedName!=='manual'&&value.name&&(input.replaceSaved||!row.translatedName.trim()))values.optionNames[row.id]=value.name;}warnings.push(...checked.warnings);}
 return {format:'yoofam-seo-generated-draft-v1',ownerId:input.ownerId??null,productId:content.productId,productVersion,contentRevision:content.revision,optionRevision:options.revision,
  jobId:job.id,model:job.review.model,reviewFingerprint:job.review.fingerprint,sourceReference:job.review.source.reference,intent:input.replaceSaved?'explicit-regeneration':'preserve-reviewed',
  source:{seo:structuredClone(content.seo),options:nameSources(options)},values,warnings};
}

/** Exact saved clocks and field bindings must still match. Existing explicit
 * user edits, including blanks, always win over an arriving generated seed. */
export function mergeSeoGeneratedDraft(seed:SeoGeneratedDraft,view:SeoWorkspaceView,ownerId:string|undefined,editing:SeoWorkspaceDraft):SeoWorkspaceDraft{
 if(seed.format!=='yoofam-seo-generated-draft-v1'||seed.ownerId!==(ownerId??null)||seed.productId!==view.productId||seed.productVersion!==view.productVersion
  ||seed.contentRevision!==view.content.revision||seed.optionRevision!==view.options.revision||!same(seed.source.seo,view.content.seo)||!same(seed.source.options,nameSources(view.options)))
  throw Error('AI 초안 이후 상품·원문·옵션 저장 상태가 변경되었습니다. 현재 입력은 유지했습니다. 최신 상품에서 다시 생성해주세요.');
 return {...editing,...(!Object.hasOwn(editing.seo,'keywords')&&seed.values.generatedKeywords?{generatedKeywords:seed.values.generatedKeywords}:{}),seo:{...seed.values.seo,...editing.seo},optionNames:{...seed.values.optionNames,...editing.optionNames}};
}
