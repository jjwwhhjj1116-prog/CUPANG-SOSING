import { optionInputs, type ProductOptions } from '@/app/product-options';
import type { TranslationJob } from '@/app/automation/translation';
export function optionTranslationAttributes(options:ProductOptions){
 const rows=options.rows.filter(row=>row.originalName.trim()&&!row.translatedName.trim());
 if(!rows.length)throw new Error('번역할 빈 한국어 옵션명이 없습니다.');
 if(rows.length>50)throw new Error('한 번에 번역할 옵션은 50개까지입니다. 옵션을 나누어 작업해주세요.');
 return rows.map(row=>({name:`option:${row.id}`,value:row.originalName}));
}
/** Match immutable reviewed source indexes to IDs and exact originals; preserve every other option field. */
export function adoptOptionTranslations(options:ProductOptions,job:TranslationJob,productVersion:string){
 if(job.productId!==options.productId||job.productVersion!==productVersion||job.status!=='completed'||!job.result)throw new Error('상품이 변경됐거나 완료된 번역 결과가 아닙니다. 새 요청을 검토해주세요.');
 const rows=optionInputs(options);let changed=0;const seen=new Set<string>();
 for(const translated of job.result.draft.attributes){
  const source=job.review.source.attributes[translated.sourceIndex];
  if(!source?.name.startsWith('option:'))continue;
  const id=source.name.slice(7);const row=rows.find(row=>row.id===id);
  if(!row||row.originalName!==source.value||seen.has(id))throw new Error('옵션 원문이나 연결이 변경되었습니다. 새 번역 요청을 만들어주세요.');
  seen.add(id);
  if(row.translatedName.trim())continue;
  const value=translated.value.trim();
  if(!value||value.length>500||/[\u0000-\u001f]/u.test(value))throw new Error('번역 옵션명은 500자 이내의 한 줄 텍스트여야 합니다.');
  row.translatedName=value;changed++;
 }
 if(!changed)throw new Error('적용할 빈 한국어 옵션명이 없습니다. 기존 수정값은 유지했습니다.');
 return {rows,changed};
}
