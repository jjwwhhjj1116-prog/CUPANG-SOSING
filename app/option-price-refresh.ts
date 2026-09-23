import { optionInputs, type OptionInput, type ProductOptionsResponse } from '@/app/product-options';

// A product version can change without changing its options (for example pricing).
// Only advance the editing base when the server options are exactly unchanged.
export function refreshOptionPriceBase(base: ProductOptionsResponse, latest: ProductOptionsResponse, draft: readonly OptionInput[]) {
  if (base.options.productId !== latest.options.productId) throw new Error('다른 상품의 옵션을 적용할 수 없습니다.');
  if (base.options.revision !== latest.options.revision || JSON.stringify(optionInputs(base.options)) !== JSON.stringify(optionInputs(latest.options))) {
    throw new Error('서버의 옵션도 변경되었습니다. 현재 입력은 유지했습니다. 저장본과 비교한 뒤 다시 편집해주세요.');
  }
  if (!Number.isFinite(Date.parse(latest.productVersion)) || Date.parse(latest.productVersion) < Date.parse(base.productVersion)) {
    throw new Error('최신 상품 버전을 확인하지 못했습니다. 다시 확인해주세요.');
  }
  return { saved: latest, rows: draft.map(row => ({ ...row })) };
}
