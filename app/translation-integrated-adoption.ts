import { translationBatchAdoption } from '@/app/translation-batch-adoption';
import { adoptOptionTranslations } from '@/app/option-translation';
import { applyOptionRows, optionFieldNames, type ProductOptions } from '@/app/product-options';
import type { ProductContent } from '@/app/product-content';
import type { TranslationJob } from '@/app/automation/translation';

export function integratedTranslationPlan(content: ProductContent, options: ProductOptions, job: TranslationJob, version: string, scope: 'all' | 'options' = 'all') {
  if (options.productId !== content.productId || job.contentRevision !== content.revision) throw Error('상품 또는 번역 원문의 콘텐츠 버전이 변경되었습니다. 최신 자료를 확인해주세요.');
  const text = scope === 'options' ? { input: null, preview: [], skipped: [] } : translationBatchAdoption(content, job, version);
  const translated = adoptOptionTranslations(options, job, version, true);
  const preview = [...text.preview];
  for (const row of translated.rows) {
    const current = options.rows.find(item => item.id === row.id)!;
    for (const field of ['translatedName', 'color', 'size'] as const) {
      const reviewed=translated.reviewed.some(item=>item.optionId===row.id&&item.field===field);
      const differs=(current[field] ?? '') !== (row[field] ?? '');
      if (reviewed) preview.push({ name: `${current.originalName || row.id} · ${optionFieldNames[field]}${differs?'':' · 번역 확인 (값 유지)'}`, before: current[field] ?? '', after: row[field] ?? '' });
    }
  }
  return { patch: text.input?.patch ?? null, rows: translated.rows, reviewedOptions:translated.reviewed, preview, skipped: text.skipped };
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
