import { observedCategoryPaths } from '@/app/observed-category-paths';
import { getQuotationSchema } from '@/app/quotation-schema';

/** Compare complete observed paths; never identify a category by its leaf name. */
export function validateCategoryIdentity(category: { categoryId: string; categoryPath: readonly string[] }) {
  const schemaPath = getQuotationSchema(category.categoryId).categoryPath;
  const expected = Object.hasOwn(observedCategoryPaths, category.categoryId) ? observedCategoryPaths[category.categoryId] : schemaPath;
  // Unknown codes remain explicitly unconfirmed; this check does not invent a catalog.
  if (!expected.length) return;
  const normalize = (part: string) => part.normalize('NFKC').replace(/\s+/gu, '');
  if (expected.length !== category.categoryPath.length || expected.some((part, index) => normalize(part) !== normalize(category.categoryPath[index]))) {
    throw new Error(`카테고리 코드 ${category.categoryId}와 선택 경로가 일치하지 않습니다. ${expected.join(' > ')} 카테고리를 다시 선택해주세요.`);
  }
}
