import { validateTranslationSource } from '@/app/automation/translation';
import { collectedTranslationAttributes } from '@/app/collected-translation-attributes';
import { optionTranslationBatch } from '@/app/option-translation';
import type { CollectionResult } from '@/app/collection-result';
import { collectionSourceReference, type CollectionJob } from '@/app/sourcing';
import type { ProductOptions } from '@/app/product-options';

export function collectedSeoSource(receipt: CollectionResult, job: CollectionJob, options: ProductOptions, optionsOnly = false) {
  if (receipt.offerId !== job.offer_id || !job.context?.category) throw Error('수집 원문과 선택 카테고리를 확인해주세요.');
  const attributes = optionsOnly ? [] : collectedTranslationAttributes(receipt.attributes ?? []);
  const batch = optionTranslationBatch(options, 50 - attributes.length);
  const category = job.context.category;
  const source = validateTranslationSource({ title: receipt.title, description: receipt.description,
    attributes: [...attributes, ...batch.attributes], provenance: 'manual',
    reference: collectionSourceReference(job.id, receipt.sourceUrl),
    ...(category.categoryId && category.categoryPath.length ? { category: { id: category.categoryId, path: category.categoryPath } } : {}),
    guidance: { features: job.context.features, keywords: job.context.keywords },
  });
  return { source, remainingOptions: batch.remaining };
}
