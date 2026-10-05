import { translationBatchAdoption } from '@/app/translation-batch-adoption';
import { adoptOptionTranslations } from '@/app/option-translation';
import { applyOptionRows, optionFieldNames, type ProductOptions } from '@/app/product-options';
import type { ProductContent } from '@/app/product-content';
import { translationAttributeCoverage,type TranslationJob } from '@/app/automation/translation';

export function integratedTranslationPlan(content: ProductContent, options: ProductOptions, job: TranslationJob, version: string, scope: 'all' | 'options' = 'all', hiddenAttributes?: boolean, intakeBrand?: string, preserveCategoryAttributes = false, optionRecoveryJobs:readonly TranslationJob[] = []) {
  if (options.productId !== content.productId || job.contentRevision !== content.revision) throw Error('상품 또는 번역 원문의 콘텐츠 버전이 변경되었습니다. 최신 자료를 확인해주세요.');
  const text = scope === 'options' ? { input: null, preview: [], skipped: [] } : translationBatchAdoption(content, job, version, intakeBrand);
  const translated = adoptOptionTranslations(options, job, version, true, optionRecoveryJobs);
  const preview = [...text.preview];
  if(content.categoryAttributes && job.review.instructionsVersion==='sourceflow-translation-v6' && job.result &&
    translationAttributeCoverage(job.review.source,job.result.draft).missingSourceIndexes.some(index=>job.review.source.attributes[index].name.startsWith('상품속성: '))){
    // A partial refresh is not a replacement for the previously reviewed
    // category snapshot or its explicit field bindings.
    preserveCategoryAttributes=true;
    text.skipped.push('일부 상품 속성 번역이 누락되어 기존 카테고리 속성과 연결값을 유지했습니다. 생성 이력의 반환된 속성을 확인해주세요.');
  }
  const attributes = !preserveCategoryAttributes && scope === 'all' && job.review.source.category && job.result
    ? job.result.draft.attributes.filter(item => job.review.source.attributes[item.sourceIndex]?.name.startsWith('상품속성: '))
      .map(item => ({ name: item.name.trim(), value: item.value.trim(), sourceName: job.review.source.attributes[item.sourceIndex].name })).filter(item => item.name && item.value) : [];
  const categoryAttributes: ProductContent['categoryAttributes'] = attributes.length ? { categoryId: job.review.source.category!.id, jobId: job.id, values: attributes, ...(hiddenAttributes === undefined ? {} : { hiddenAttributes }) } : undefined;
  if (categoryAttributes && JSON.stringify(content.categoryAttributes) !== JSON.stringify(categoryAttributes)) {
    preview.push({ name: '카테고리 상품 속성 원문 번역', before: (content.categoryAttributes?.values ?? []).map(item => `${item.name}: ${item.value}`).join('\n'), after: attributes.map(item => `${item.name}: ${item.value}`).join('\n') });
  }
  for (const row of translated.rows) {
    const current = options.rows.find(item => item.id === row.id)!;
    for (const field of ['translatedName', 'color', 'size'] as const) {
      const reviewed=translated.reviewed.some(item=>item.optionId===row.id&&item.field===field);
      const differs=(current[field] ?? '') !== (row[field] ?? '');
      if (reviewed) preview.push({ name: `${current.originalName || row.id} · ${optionFieldNames[field]}${differs?'':' · 번역 확인 (값 유지)'}`, before: current[field] ?? '', after: row[field] ?? '' });
    }
  }
  return { patch: text.input?.patch ?? null, categoryAttributes, rows: translated.rows, reviewedOptions:translated.reviewed, preview, skipped: text.skipped };
}

/** Call only with a server-recomputed plan from a completed, matching job. */
export function applyIntegratedOptions(options:ProductOptions,plan:ReturnType<typeof integratedTranslationPlan>,now:string){
  const next=applyOptionRows(options,plan.rows,now);
  for(const item of plan.reviewedOptions){
    const row=next.rows.find(row=>row.id===item.optionId)!;
    row.provenance[item.field]='translated';row.updatedAt=now;
  }
  return next;
}
