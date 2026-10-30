import type {TranslationJob} from '@/app/automation/translation';
import type {ProductContent} from '@/app/product-content';
import type {ProductOptions} from '@/app/product-options';
import type {SeoWorkspaceView} from '@/app/seo-workspace';
import type {SeoWorkspaceDraft} from '@/app/seo-workspace-client';
import {untouchedIntakeKeywords} from '@/app/translation-batch-adoption';
import {translationAttributeIssue} from '@/app/translation-attribute-evidence';

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
export function createSeoGeneratedDraft(input:{ownerId?:string;productVersion:string;content:ProductContent;options:ProductOptions;job:TranslationJob;brand:string;replaceSaved?:boolean}):SeoGeneratedDraft{
 const {content,options,job,productVersion}=input;
 if(content.productId!==options.productId||job.productId!==content.productId||job.productVersion!==productVersion||job.contentRevision!==content.revision
  ||job.status!=='completed'||!job.result||job.error||job.result.model!==job.review.model||!/^[a-f0-9]{64}$/u.test(job.review.fingerprint)
  ||!Number.isSafeInteger(content.revision)||!Number.isSafeInteger(options.revision))throw Error('현재 상품·원문·옵션에 연결된 완료 SEO 초안을 확인해주세요.');
 const values:SeoWorkspaceDraft={seo:{},optionNames:{}},draft=job.result.draft;
 for(const field of ['title','keywords','description'] as const){
  if(!input.replaceSaved&&content.seo[field].provenance==='manual'&&!(field==='keywords'&&untouchedIntakeKeywords(content,job)))continue;
  const value=draft[field];if(field==='keywords'){
   if(value.length&&(input.replaceSaved||!same(value,content.seo.keywords.value)))values.seo.keywords=(value as string[]).join(', ');
  }else if(typeof value==='string'&&value.trim()){
   const prefix=input.brand.split(',')[0].trim(),name=field==='title'&&prefix&&value!==prefix&&!value.startsWith(prefix)?prefix+' '+value:value;
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
 return {format:'yoofam-seo-generated-draft-v1',ownerId:input.ownerId??null,productId:content.productId,productVersion,contentRevision:content.revision,optionRevision:options.revision,
  jobId:job.id,model:job.review.model,reviewFingerprint:job.review.fingerprint,sourceReference:job.review.source.reference,intent:input.replaceSaved?'explicit-regeneration':'preserve-reviewed',
  source:{seo:structuredClone(content.seo),options:nameSources(options)},values,warnings:[...draft.warnings]};
}

/** Exact saved clocks and field bindings must still match. Existing explicit
 * user edits, including blanks, always win over an arriving generated seed. */
export function mergeSeoGeneratedDraft(seed:SeoGeneratedDraft,view:SeoWorkspaceView,ownerId:string|undefined,editing:SeoWorkspaceDraft):SeoWorkspaceDraft{
 if(seed.format!=='yoofam-seo-generated-draft-v1'||seed.ownerId!==(ownerId??null)||seed.productId!==view.productId||seed.productVersion!==view.productVersion
  ||seed.contentRevision!==view.content.revision||seed.optionRevision!==view.options.revision||!same(seed.source.seo,view.content.seo)||!same(seed.source.options,nameSources(view.options)))
  throw Error('AI 초안 이후 상품·원문·옵션 저장 상태가 변경되었습니다. 현재 입력은 유지했습니다. 최신 상품에서 다시 생성해주세요.');
 return {...editing,seo:{...seed.values.seo,...editing.seo},optionNames:{...seed.values.optionNames,...editing.optionNames}};
}
