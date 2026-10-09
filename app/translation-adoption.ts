import { validateContentInput, type ProductContent } from '@/app/product-content';
import type { TranslationJob } from '@/app/automation/translation';

export const translationSeoFields = ['title', 'keywords', 'description'] as const;
export type TranslationSeoField = typeof translationSeoFields[number];

/** Option-only drafts cannot supply replacement SEO or label content. */
export function assertContentTranslationScope(job: TranslationJob): void {
  if (job.review && (Object.hasOwn(job.review, 'optionsRetry') || Object.hasOwn(job.review, 'intakeOptions')))
    throw Error('옵션 전용 번역은 상품명·설명·표시사항에 적용할 수 없습니다.');
}

/** Save explicitly reviewed fields together against the displayed content revision. */
export function translationAdoptionInput(content: ProductContent, job: TranslationJob, productVersion: string, fields: readonly TranslationSeoField[]) {
  assertContentTranslationScope(job);
  if (job.productId !== content.productId || job.productVersion !== productVersion || job.status !== 'completed' || !job.result) {
    throw new Error('현재 상품의 완료된 번역 결과가 아닙니다. 최신 상품과 번역 결과를 확인해주세요.');
  }
  if (!fields.length || new Set(fields).size !== fields.length || fields.some(field => !translationSeoFields.includes(field))) {
    throw new Error('적용할 상품명·검색어·설명을 선택해주세요.');
  }
  const seo = Object.fromEntries(fields.map(field => [field, job.result!.draft[field]]));
  return validateContentInput({ expectedRevision: content.revision, patch: { seo } }, [], '');
}
