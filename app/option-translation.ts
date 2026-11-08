import { optionInputs, type ProductOptions, type OptionInput } from '@/app/product-options';
import type { TranslationJob } from '@/app/automation/translation';
import { translationAttributeIssue } from '@/app/translation-attribute-evidence';
import {assertWorkersRecoveryJobQuality} from '@/app/product-translation-quality';

/** Confirm the committed snapshot, not just an HTTP success status. */
export function confirmOptionTranslationSave(input: unknown, current: ProductOptions, productVersion: string, requested: readonly OptionInput[]): void {
 const fail=()=>{throw new Error('옵션 저장 결과가 요청한 상품·버전·내용과 일치하지 않습니다. 저장 여부를 다시 조회해주세요. 자동으로 재저장하지 않았습니다.');};
 if(!input||typeof input!=='object'||Array.isArray(input))return fail();
 const body=input as {productVersion?:unknown;options?:ProductOptions};const saved=body.options;
 if(typeof body.productVersion!=='string'||!Number.isFinite(Date.parse(body.productVersion))||!Number.isFinite(Date.parse(productVersion))
  ||Date.parse(body.productVersion)<=Date.parse(productVersion)||!saved||saved.schemaVersion!==1||saved.productId!==current.productId
  ||saved.revision!==current.revision+1||saved.updatedAt!==body.productVersion||!Array.isArray(saved.rows)||saved.rows.length!==requested.length)return fail();
 const ids=new Set<string>();
 for(const [index,row] of requested.entries()){
  const actual=saved.rows[index];
  if(!actual||actual.id!==row.id||ids.has(actual.id))return fail();
  ids.add(actual.id);
  for(const [key,value] of Object.entries(row)){
   if(value!==undefined&&(actual as unknown as Record<string,unknown>)[key]!==value)return fail();
  }
 }
}
/** A completed result must still match both the collected source and saved
 * provider value. The caller supplies this owner/product's saved jobs. */
function recoverableOptionAttributes(options:ProductOptions,jobs:readonly TranslationJob[]){
 const recoverable=new Map<string,{source:string;partialName:boolean}>();
 const rows=new Map(options.rows.map(row=>[row.id,row]));
 for(const job of jobs){
  const legacy=job.review.instructionsVersion==='sourceflow-translation-v5';
  if(job.productId!==options.productId||job.status!=='completed'||!job.result||!legacy&&job.review.instructionsVersion!=='sourceflow-translation-v6')continue;
  for(const translated of job.result.draft.attributes){
   const source=job.review.source.attributes[translated.sourceIndex],binding=source?.name.match(/^option(?:-(color|size))?:([A-Za-z0-9_-]{1,80})$/);
   if(!binding||!/\p{Script=Han}/u.test(source.value))continue;
   const field=binding[1] as 'color'|'size'|undefined,id=binding[2],row=rows.get(id),key=field??'translatedName';
   const value=legacy?translated.value:translated.value.trim();
   if(legacy?value!==source.value||/[가-힣]/u.test(source.value)
     :field||!/[가-힣]/u.test(value)||!/\p{Script=Han}/u.test(value)||translationAttributeIssue(source,translated))continue;
   if(!row?.included||row.provenance[key]!=='translated'||row[key]!==value)continue;
   const original=job.review.source.attributes.filter(pair=>pair.name===`option:${id}`);
   if(original.length!==1||original[0].value!==row.originalName)continue;
   recoverable.set(source.name,{source:source.value,partialName:!legacy});
  }
 }
 return recoverable;
}
function pendingOptionAttributes(options:ProductOptions,recoveryJobs:readonly TranslationJob[]=[]){
 const recoverable=recoverableOptionAttributes(options,recoveryJobs);
 const attributes=options.rows.flatMap(row=>{
  if(!row.included)return [];
  const name=`option:${row.id}`;
  const values=row.originalName.trim()&&(!row.translatedName.trim()&&row.provenance.translatedName!=='manual'||recoverable.has(name))?[{name,value:row.originalName}]:[];
  for(const field of ['color','size'] as const){
   if(row[field]?.trim()&&(row.provenance[field]==='collected'||recoverable.has(`option-${field}:${row.id}`)))values.push({name:`option-${field}:${row.id}`,value:row[field]!});
  }
  return values;
 });
 return attributes;
}
/** Select a bounded batch from current saved values; never mark unselected items completed. */
export function optionTranslationBatch(options:ProductOptions, capacity=50,recoveryJobs:readonly TranslationJob[]=[]){
 if(!Number.isInteger(capacity)||capacity<0||capacity>50)throw new Error('번역 요청의 남은 항목 수를 확인해주세요.');
 const pending=pendingOptionAttributes(options,recoveryJobs);
 return {attributes:pending.slice(0,capacity),remaining:Math.max(0,pending.length-capacity),total:pending.length};
}
export function optionTranslationAttributes(options:ProductOptions, allowEmpty = false){
 const attributes=pendingOptionAttributes(options);
 if(!attributes.length&&!allowEmpty)throw new Error('번역할 빈 한국어 옵션명 또는 수집한 색상·사이즈가 없습니다.');
 if(attributes.length>50)throw new Error('한 번에 번역할 옵션명·색상·사이즈는 합계 50개까지입니다. 옵션을 나누어 작업해주세요.');
 return attributes;
}
/** Match immutable reviewed source indexes to IDs and exact originals; preserve every other option field. */
export function adoptOptionTranslations(options:ProductOptions,job:TranslationJob,productVersion:string, allowEmpty = false,recoveryJobs:readonly TranslationJob[]=[]){
 assertWorkersRecoveryJobQuality(job);
 if(job.productId!==options.productId||job.productVersion!==productVersion||job.status!=='completed'||!job.result)throw new Error('상품이 변경됐거나 완료된 번역 결과가 아닙니다. 새 요청을 검토해주세요.');
 const rows=optionInputs(options);let changed=0;const seen=new Set<string>();
 const recoverable=recoverableOptionAttributes(options,job.review.instructionsVersion==='sourceflow-translation-v6'?recoveryJobs:[]);
 const reviewed:{optionId:string;field:'translatedName'|'color'|'size'}[]=[];
 for(const translated of job.result.draft.attributes){
  const source=job.review.source.attributes[translated.sourceIndex];
  const binding=source?.name.match(/^option(?:-(color|size))?:([A-Za-z0-9_-]{1,80})$/);
  if(!binding)continue;
  const field=binding[1] as 'color'|'size'|undefined;
  const id=binding[2];const row=rows.find(row=>row.id===id);
  const key=`${id}:${field??'translatedName'}`;
  if(!row||seen.has(key))throw new Error('옵션 원문이나 연결이 변경되었습니다. 새 번역 요청을 만들어주세요.');
  seen.add(key);
  // Excluded rows remain available for later use, but must not be changed by
  // a batch prepared before they were excluded.
  if(!row.included)continue;
  if(job.review.instructionsVersion==='sourceflow-translation-v6'&&translationAttributeIssue(source,translated))continue;
  const candidate=recoverable.get(source.name);
  const recovery=candidate?.source===source.value?candidate:undefined;
  if(field){
   // Only unchanged collected attributes may be replaced. Reviewed/manual blanks stay blank.
   if(options.rows.find(value=>value.id===id)?.provenance[field]!=='collected'&&!recovery)continue;
   if(row[field]!==source.value)throw new Error('옵션 원문이나 연결이 변경되었습니다. 새 번역 요청을 만들어주세요.');
  }else{
   if(row.originalName!==source.value)throw new Error('옵션 원문이나 연결이 변경되었습니다. 새 번역 요청을 만들어주세요.');
   if(row.translatedName.trim()&&!recovery||options.rows.find(value=>value.id===id)?.provenance.translatedName==='manual')continue;
  }
  const value=translated.value.trim();
  const limit=field?200:500;
  if(!value||value.length>limit||/[\u0000-\u001f]/u.test(value))throw new Error(`번역 옵션 값은 ${limit}자 이내의 한 줄 텍스트여야 합니다.`);
  if(recovery?.partialName){
   const modelCode=/\b[A-Za-z]+[-_]?[0-9][A-Za-z0-9._/-]*\b/gu;
   const codes:readonly string[]=value.match(modelCode)??[];
   if(/\p{Script=Han}/u.test(value)||(source.value.match(modelCode)??[]).some(code=>!codes.includes(code)))continue;
  }
  if(recovery&&/\p{Script=Han}/u.test(value)&&!/[가-힣]/u.test(value))throw Error('옵션 재번역 결과가 중국어로 남아 있습니다. 기존 옵션을 유지했으며 한국어 초안을 다시 확인해주세요.');
  if(field)row[field]=value;else row.translatedName=value;
  reviewed.push({optionId:id,field:field??'translatedName'});
  changed++;
 }
 if(!changed&&!allowEmpty)throw new Error('적용할 미번역 옵션 값이 없습니다. 기존 수정값은 유지했습니다.');
 return {rows,changed,reviewed};
}
