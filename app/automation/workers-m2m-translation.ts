import type {TranslationSource,TranslationDraft,WorkersAiBinding} from '@/app/automation/translation';
import {translationNumbers} from '@/app/translation-attribute-evidence';
import {unsupportedTranslatedProductClaim,workersRecoveryOptionMetadataLabel} from '@/app/product-translation-quality';
import {QUOTATION_TAG_ITEM_LIMIT,QUOTATION_TAG_TOTAL_LIMIT} from '@/app/quotation-keywords';

export const WORKERS_M2M_MODEL='@cf/meta/m2m100-1.2b';
export const WORKERS_M2M_STRATEGY='m2m-text-v1';
export const WORKERS_M2M_MAX_CALLS=8;
const maxText=1000,maxCharacters=6000,hasHan=(text:string)=>/\p{Script=Han}/u.test(text);
const retained=(text:string)=>!hasHan(text)&&(/[가-힣]/u.test(text)||/^(?:[A-Z]{1,6}\d*|\d+(?:[.,]\d+)*(?:\s*(?:cm|mm|kg|g|m|ml|L|%))?)$/u.test(text));
type Field={original:string;location:string;limit:number};
type Attribute={sourceIndex:number;name:string;value:string;metadataName:string|null};
export type WorkersM2mPlan={requests:string[];literals:string[];fields:Field[];attributes:Attribute[];description:string;missingAttributeIndexes:number[];descriptionOmitted:boolean};
export class WorkersM2mError extends Error{constructor(public code:string,message:string,public uncertain=false){super(message);}}

/** Fixed source fields are translated independently. IDs, source indexes,
 * category/guidance and generated prompts are never sent to the provider. */
export function planWorkersM2mTranslation(source:TranslationSource):WorkersM2mPlan{
 const requests:string[]=[],literals:string[]=[],fields:Field[]=[],attributes:Attribute[]=[],missingAttributeIndexes:number[]=[];let characters=0;
 const known=(text:string)=>requests.includes(text)||literals.includes(text);
 const fits=(texts:string[])=>{const pending=[...new Set(texts)].filter(text=>!known(text)&&!retained(text));return texts.every(text=>!!text&&text.length<=maxText)&&requests.length+pending.length<=WORKERS_M2M_MAX_CALLS&&characters+pending.reduce((sum,text)=>sum+text.length,0)<=maxCharacters;};
 const add=(original:string,location:string,limit:number)=>{fields.push({original,location,limit});if(known(original))return;if(retained(original))literals.push(original);else{requests.push(original);characters+=original.length;}};
 if(!source.title.trim()||!fits([source.title]))throw new WorkersM2mError('M2M_TITLE_REQUIRED','전용 번역에 사용할 저장 상품명과 길이를 확인해주세요. 원문과 기존 수정값은 유지했습니다.');
 add(source.title,'title',500);
 const ordered=source.attributes.map((pair,sourceIndex)=>({pair,sourceIndex,metadataName:workersRecoveryOptionMetadataLabel(pair.name)})).sort((left,right)=>Number(!!right.metadataName)-Number(!!left.metadataName)||left.sourceIndex-right.sourceIndex);
 for(const {pair,sourceIndex,metadataName}of ordered){const name=pair.name.replace(/^상품속성: /u,'').trim(),texts=metadataName?[pair.value]:[name,pair.value];if(!fits(texts)){missingAttributeIndexes.push(sourceIndex);continue;}
  if(!metadataName)add(name,`attributes[${sourceIndex}].name`,200);add(pair.value,`attributes[${sourceIndex}].value`,metadataName==='옵션명'?500:metadataName?200:2000);attributes.push({sourceIndex,name,value:pair.value,metadataName});
 }
 let description='',descriptionOmitted=false;if(source.description){if(fits([source.description])){description=source.description;add(description,'description',20000);}else descriptionOmitted=true;}
 attributes.sort((left,right)=>left.sourceIndex-right.sourceIndex);
 return{requests,literals,fields,attributes,description,missingAttributeIndexes:missingAttributeIndexes.sort((left,right)=>left-right),descriptionOmitted};
}
function confirmTranslation(plan:WorkersM2mPlan,original:string,text:string){
 for(const field of plan.fields.filter(field=>field.original===original)){
  if(!text||text.length>field.limit||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)||field.location.startsWith('attributes[')&&/[\r\n\t]/u.test(text))throw new WorkersM2mError('INVALID_M2M_OUTPUT',`전용 번역의 입력 규격을 확인하지 못했습니다. 위치 ${field.location}. 결과를 적용하거나 자동 재시도하지 않았습니다.`);
  if(hasHan(text)||hasHan(original)&&!/[가-힣]/u.test(text))throw new WorkersM2mError('RECOVERY_UNTRANSLATED_TEXT',`전용 번역이 한국어로 완료되지 않았습니다. 위치 ${field.location}. 원문과 기존 수정값을 유지했으며 자동 재시도하지 않았습니다.`);
  const numbers=new Set(translationNumbers(original));if(translationNumbers(text).some(number=>!numbers.has(number)))throw new WorkersM2mError('UNSUPPORTED_FACT',`전용 번역에 원문 밖 숫자가 포함되었습니다. 위치 ${field.location}. 결과를 적용하지 않았습니다.`);
  if(unsupportedTranslatedProductClaim(text,original))throw new WorkersM2mError('RECOVERY_UNSUPPORTED_CLAIM',`전용 번역에 원문에서 확인하지 못한 성능 표현이 포함되었습니다. 위치 ${field.location}. 결과를 적용하지 않았습니다.`);
 }
}
/** One bounded sequential call per unique text; a timeout/uncertain result
 * ends this job. Atomic job claims and per-call source/quota guards live in
 * the caller. Async request_id, chat envelopes and repair fallbacks are not
 * accepted as synchronous translations. */
export async function executeWorkersM2mTranslation(source:TranslationSource,ai:WorkersAiBinding,expectedMaxCalls:number){
 const plan=planWorkersM2mTranslation(source);if(!Number.isSafeInteger(expectedMaxCalls)||expectedMaxCalls<1||expectedMaxCalls!==plan.requests.length)throw new WorkersM2mError('INVALID_WORKERS_RECOVERY','검토한 전용 번역의 호출 범위가 변경되었습니다. 원문을 전송하지 않았습니다.');
 const translated=new Map(plan.literals.map(text=>[text,text])),started=Date.now();let calls=0;
 for(const original of plan.requests){
  const remaining=50000-(Date.now()-started);if(remaining<=0)throw new WorkersM2mError('PROVIDER_OUTCOME_UNCERTAIN','전용 번역 제한시간이 지나 남은 요청을 중단했습니다. 자동 재시도하지 않았습니다.',true);
  let timeout:ReturnType<typeof setTimeout>|undefined,response:unknown;
  try{calls++;response=await Promise.race([ai.run(WORKERS_M2M_MODEL,{text:original,source_lang:'zh',target_lang:'ko'}),new Promise<never>((_resolve,reject)=>{timeout=setTimeout(()=>reject(new WorkersM2mError('PROVIDER_OUTCOME_UNCERTAIN','전용 번역 응답을 제한시간 안에 확인하지 못했습니다. 남은 요청과 자동 재시도를 중단했습니다.',true)),Math.min(15000,remaining));})]);}
  finally{if(timeout!==undefined)clearTimeout(timeout);}
  if(!response||typeof response!=='object'||Array.isArray(response)||Object.hasOwn(response,'request_id')||typeof (response as {translated_text?:unknown}).translated_text!=='string')throw new WorkersM2mError('INVALID_M2M_OUTPUT','전용 번역의 translated_text 응답을 확인하지 못했습니다. 결과를 적용하거나 자동 재시도하지 않았습니다.');
  const text=(response as {translated_text:string}).translated_text.trim();confirmTranslation(plan,original,text);translated.set(original,text);
 }
 const title=translated.get(source.title)??'',description=plan.description?translated.get(plan.description)??'':'',keywords:string[]=[];
 // Same source-only title token rules as the existing Google text adapter.
 for(const token of title.split(/[\s,，、;；]+/u).filter(Boolean)){if(token.length>QUOTATION_TAG_ITEM_LIMIT||keywords.includes(token)||/[\r\n]/u.test(token))continue;if([...keywords,token].join(', ').length>QUOTATION_TAG_TOTAL_LIMIT||keywords.length>=30)break;keywords.push(token);}
 const attributes=plan.attributes.map(pair=>({sourceIndex:pair.sourceIndex,name:pair.metadataName??translated.get(pair.name)!,value:translated.get(pair.value)!}));
 const warnings=['중국어→한국어 전용 번역 초안입니다. 상품명·옵션 의미를 확인한 후 선택한 항목만 적용하세요.',...(plan.missingAttributeIndexes.length?[`호출·길이 한도로 상품 속성·옵션 ${plan.missingAttributeIndexes.length}개는 요청하지 않고 원문에 보존했습니다.`]:[]),...(plan.descriptionOmitted?['길이·호출 한도로 설명은 요청하지 않고 원문에 보존했습니다.']:[])];
 return{draft:{title,description,keywords,attributes,warnings} satisfies TranslationDraft,requests:calls};
}
