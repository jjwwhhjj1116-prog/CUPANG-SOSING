import type { ProductContent, LabelField } from '@/app/product-content';
import type { TranslationJob } from '@/app/automation/translation';
import { collectionLabelField } from '@/app/collection-label-attributes';
import type { ProductOptions } from '@/app/product-options';

/** The canonical saved intake result can outlive an explicit option deletion.
 * Drop only those result bindings in its planning view, without changing the
 * saved job or source indexes. Other/manual translation jobs stay strict. */
export function intakeTranslationReplayJob(job: TranslationJob, options: ProductOptions): TranslationJob {
  if (job.productId !== options.productId || job.status !== 'completed' || !job.result) throw Error('저장된 상품 초안과 옵션 연결을 확인해주세요.');
  const ids = new Set(options.rows.map(row => row.id));
  const attributes = job.result.draft.attributes.filter(attribute => {
    const source = job.review.source.attributes[attribute.sourceIndex];
    const binding = source?.name.match(/^option(?:-(?:color|size))?:([A-Za-z0-9_-]{1,80})$/u);
    return !binding || ids.has(binding[1]);
  });
  if (attributes.length === job.result.draft.attributes.length) return job;
  return { ...job, result: { ...job.result, draft: { ...job.result.draft, attributes } } };
}

/** A planning-only view for the canonical completed intake result. Only source
 * values that remain untouched may be filled after an intervening edit. */
export function intakeTranslationReplayContent(content: ProductContent, job: TranslationJob): ProductContent {
  const next = structuredClone(content);
  for (const field of ['title', 'description'] as const) {
    const current = next.seo[field];
    if (current.provenance !== 'collected' || current.value !== job.review.source[field]) current.provenance = 'manual';
  }
  if (next.seo.keywords.provenance !== 'unverified') next.seo.keywords.provenance = 'manual';
  for (const field of Object.keys(next.label) as LabelField[]) {
    const current = next.label[field];
    const originals = job.review.source.attributes.filter(attribute => attribute.name.startsWith('상품속성: ')
      && collectionLabelField(attribute.name.slice('상품속성: '.length)) === field);
    const untouched = current.provenance === 'collected' && originals.some(attribute => attribute.value.trim() === current.value)
      || current.provenance === 'unverified' && !current.value;
    if (!untouched) current.provenance = 'manual';
  }
  return next;
}
