import { validateTranslationSource, type TranslationSource } from '@/app/automation/translation';
import { collectedTranslationAttributes } from '@/app/collected-translation-attributes';
import type { CollectionResult } from '@/app/collection-result';
import { collectionSourceReference, type CollectionJob } from '@/app/sourcing';

/** Compare supplier facts only. Editing/deleting an option does not invalidate
 * the saved SEO source; newly received supplier text cannot inherit its coverage. */
export function intakeSupplierSourceMatches(reviewed: TranslationSource, receipt: CollectionResult, job: CollectionJob): boolean {
  if (receipt.offerId !== job.offer_id || receipt.sourceUrl !== job.source_url || !job.context?.category) return false;
  const category = job.context.category;
  const current = validateTranslationSource({ title: receipt.title, description: receipt.description,
    attributes: collectedTranslationAttributes(receipt.attributes ?? []), provenance: 'manual',
    reference: collectionSourceReference(job.id, receipt.sourceUrl),
    ...(category.categoryId && category.categoryPath.length ? { category: { id: category.categoryId, path: category.categoryPath } } : {}),
    guidance: { features: job.context.features, keywords: job.context.keywords },
  });
  const supplierSource = (source: TranslationSource) => ({ title: source.title, description: source.description,
    reference: source.reference, category: source.category, guidance: source.guidance,
    attributes: source.attributes.filter(pair => !/^option(?:-color|-size)?:[A-Za-z0-9_-]{1,80}$/.test(pair.name))
      .map(pair => ({ name: pair.name, value: pair.value })),
  });
  return JSON.stringify(supplierSource(reviewed)) === JSON.stringify(supplierSource(current));
}
