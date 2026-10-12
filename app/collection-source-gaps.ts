import type { CollectionResult } from '@/app/collection-result';

export type CollectionSourceGap = { fieldId: string; label: string; step: 'SEO' | '상세 이미지' | '표시사항' };
/** An absent supplier fact remains absent even after an editable AI draft exists. */
export function collectionSourceGaps(result: Pick<CollectionResult, 'description' | 'images' | 'attributes'>): CollectionSourceGap[] {
  const gaps: CollectionSourceGap[] = [];
  // A usable JSON-LD/API receipt can still contain only title, SKU and price.
  // Provider names are transport evidence, not evidence of these optional facts.
  if (!result.description.trim()) gaps.push({ fieldId: 'detailHtml', label: '상세 설명', step: '상세 이미지' });
  if (!result.images.some(image => image.role === 'detail')) gaps.push({ fieldId: 'detailImages', label: '상세 이미지', step: '상세 이미지' });
  if (!result.attributes?.length) gaps.push({ fieldId: 'noticeMaterial', label: '일반 상품 속성', step: '표시사항' });
  return gaps;
}
