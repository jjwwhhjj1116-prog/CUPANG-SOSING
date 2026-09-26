import { parseCollectionRequest } from '@/app/sourcing';
import { validateCategoryProfile } from '@/app/category-profiles';
import { readQuotationCollectionSource, type QuotationCollectionSource } from '@/db/quotation-fields';

export type TranslationCategorySource = { offerId: string; snapshot: QuotationCollectionSource | null };

/** Same exact product-to-intake binding used by the quotation resolver. */
export async function readTranslationCategorySource(owner: string, productId: string, sourceUrl: string, categoryId: string): Promise<TranslationCategorySource> {
  const { offerId } = parseCollectionRequest({ urls: [sourceUrl] })[0];
  const snapshot = await readQuotationCollectionSource(owner, offerId, productId);
  if (snapshot) {
    const context = JSON.parse(snapshot.payload);
    const category = validateCategoryProfile(context.category);
    if (!snapshot.linked || category.categoryId !== categoryId) throw new Error('번역 카테고리와 상품추가에서 선택한 카테고리가 다릅니다. 현재 분류로 번역 결과를 다시 준비해주세요.');
  }
  // Legacy manually entered products have no captured category. Preserve that
  // state explicitly so a link added during review invalidates the transaction.
  return { offerId, snapshot };
}
