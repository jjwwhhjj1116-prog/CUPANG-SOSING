import { optionInputs, type ProductOptions } from '@/app/product-options';
import type { TranslationJob } from '@/app/automation/translation';
export function optionTranslationAttributes(options:ProductOptions){
 const attributes=options.rows.flatMap(row=>{
  const values=row.originalName.trim()&&!row.translatedName.trim()?[{name:`option:${row.id}`,value:row.originalName}]:[];
  for(const field of ['color','size'] as const){
   if(row[field]?.trim()&&row.provenance[field]==='collected')values.push({name:`option-${field}:${row.id}`,value:row[field]!});
  }
  return values;
 });
 if(!attributes.length)throw new Error('번역할 빈 한국어 옵션명 또는 수집한 색상·사이즈가 없습니다.');
 if(attributes.length>50)throw new Error('한 번에 번역할 옵션명·색상·사이즈는 합계 50개까지입니다. 옵션을 나누어 작업해주세요.');
 return attributes;
}
/** Match immutable reviewed source indexes to IDs and exact originals; preserve every other option field. */
export function adoptOptionTranslations(options:ProductOptions,job:TranslationJob,productVersion:string){
 if(job.productId!==options.productId||job.productVersion!==productVersion||job.status!=='completed'||!job.result)throw new Error('상품이 변경됐거나 완료된 번역 결과가 아닙니다. 새 요청을 검토해주세요.');
 const rows=optionInputs(options);let changed=0;const seen=new Set<string>();
 for(const translated of job.result.draft.attributes){
  const source=job.review.source.attributes[translated.sourceIndex];
  const binding=source?.name.match(/^option(?:-(color|size))?:([A-Za-z0-9_-]{1,80})$/);
  if(!binding)continue;
  const field=binding[1] as 'color'|'size'|undefined;
  const id=binding[2];const row=rows.find(row=>row.id===id);
  const key=`${id}:${field??'translatedName'}`;
  if(!row||seen.has(key))throw new Error('옵션 원문이나 연결이 변경되었습니다. 새 번역 요청을 만들어주세요.');
  seen.add(key);
  if(field){
   // Only unchanged collected attributes may be replaced. Reviewed/manual blanks stay blank.
   if(options.rows.find(value=>value.id===id)?.provenance[field]!=='collected')continue;
   if(row[field]!==source.value)throw new Error('옵션 원문이나 연결이 변경되었습니다. 새 번역 요청을 만들어주세요.');
  }else{
   if(row.originalName!==source.value)throw new Error('옵션 원문이나 연결이 변경되었습니다. 새 번역 요청을 만들어주세요.');
   if(row.translatedName.trim())continue;
  }
  const value=translated.value.trim();
  const limit=field?200:500;
  if(!value||value.length>limit||/[\u0000-\u001f]/u.test(value))throw new Error(`번역 옵션 값은 ${limit}자 이내의 한 줄 텍스트여야 합니다.`);
  if(field)row[field]=value;else row.translatedName=value;
  changed++;
 }
 if(!changed)throw new Error('적용할 미번역 옵션 값이 없습니다. 기존 수정값은 유지했습니다.');
 return {rows,changed};
}
