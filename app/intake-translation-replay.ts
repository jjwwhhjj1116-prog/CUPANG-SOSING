import type { ProductContent, LabelField } from '@/app/product-content';
import type { TranslationJob } from '@/app/automation/translation';
import { collectionLabelField } from '@/app/collection-label-attributes';

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
