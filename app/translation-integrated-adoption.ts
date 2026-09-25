import { translationBatchAdoption } from '@/app/translation-batch-adoption';
import { adoptOptionTranslations } from '@/app/option-translation';
import { optionFieldNames, type ProductOptions } from '@/app/product-options';
import type { ProductContent } from '@/app/product-content';
import type { TranslationJob } from '@/app/automation/translation';

export function integratedTranslationPlan(content: ProductContent, options: ProductOptions, job: TranslationJob, version: string) {
  if (options.productId !== content.productId || job.contentRevision !== content.revision) throw Error('상품 또는 번역 원문의 콘텐츠 버전이 변경되었습니다. 최신 자료를 확인해주세요.');
  const text = translationBatchAdoption(content, job, version);
  const translated = adoptOptionTranslations(options, job, version, true);
  const preview = [...text.preview];
  for (const row of translated.rows) {
    const current = options.rows.find(item => item.id === row.id)!;
    for (const field of ['translatedName', 'color', 'size'] as const) {
      if ((current[field] ?? '') !== (row[field] ?? '')) preview.push({ name: `${current.originalName || row.id} · ${optionFieldNames[field]}`, before: current[field] ?? '', after: row[field] ?? '' });
    }
  }
  return { patch: text.input?.patch ?? null, rows: translated.rows, preview, skipped: text.skipped };
}
