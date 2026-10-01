import type { CollectionResult } from '@/app/collection-result';

export type CollectionSourceGap = { fieldId: string; label: string; step: 'SEO' | '상세 이미지' | '표시사항' };
/** An absent supplier fact remains absent even after an editable AI draft exists. */
export function collectionSourceGaps(result: Pick<CollectionResult, 'provider'>): CollectionSourceGap[] {
  return ['1688-public-sku-v1', 'chrome-public-sku-v1'].includes(result.provider) ? [
    { fieldId: 'detailHtml', label: '상세 설명', step: '상세 이미지' },
    { fieldId: 'detailImages', label: '상세 이미지', step: '상세 이미지' },
    { fieldId: 'noticeMaterial', label: '일반 상품 속성', step: '표시사항' },
  ] : [];
}
