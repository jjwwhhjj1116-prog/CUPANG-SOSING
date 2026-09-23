import type { QuotationField } from '@/app/quotation-schema';

// Rendered Couplus quotation 260923003001, 2026-09-23.
// Product Page choices independently checked in Supplier Hub DOM, 2026-09-24.
// Legal notices remain Couplus-only evidence.
export const couplus81452Path = ['스포츠/레져', '헬스/요가', '헬스기구/용품', '헬스보호대'];
const attributes: [string, string, string[]?][] = [
  ['bodyPart', '사용부위', ['종아리', '다리', '목/어깨', '팔/손목', '손/손가락', '발/발가락', '엉덩이', '허리', '무릎', '팔꿈치', '발목']],
  ['size', '패션잡화 사이즈', ['S', 'M', 'L', 'XL', 'Free Size', 'XXS', 'XS', 'XXL이상']],
  ['fastener', '잠금/고정방식', ['지퍼형', '자석형', '벨크로형', '똑딱이형', '끈 조임형', '잠금장치없음', '밴드형']],
  ['composition', '구성', ['단품', '단품세트', '혼합세트']],
  ['user', '보호대 사용대상', ['일반/성인', '임산부', '어린이']],
  ['purpose', '보호대/교정용품 용도', ['스포츠/레저용', '의료용', '일상생활용']],
  ['direction', '착용방향', ['좌우겸용', '오른쪽', '왼쪽', '좌우세트']],
  ['gtin', 'Global Trade Item Number'], ['parentPart', 'Parent Manufacturer Part Number'], ['part', 'Manufacturer Part Number'],
];
const make = (id: string, label: string, section: QuotationField['section'], visibility: QuotationField['visibility']): QuotationField => ({
  id, label, section, visibility, type: 'text', required: false, reviewRequired: true, maxLength: 2000,
  help: '쿠플러스 헬스보호대 견적 화면에서 확인한 항목입니다. Supplier Hub 공식 규격과 자동 기본값은 미확인입니다.',
});
export const couplus81452Fields: QuotationField[] = [
  ...[['color', '색상'], ['quantity', '수량'], ['size', '사이즈']].map(([id, label]) => make(id, label, 'product', 'exposed')),
  ...attributes.map(([id, label, values]) => ({ ...make(`brace_${id}`, label, 'product', 'hidden'),
    ...(values ? { type: 'select' as const, choices: [...values, ''].map(value => ({ value, label: value || '해당사항없음' })),
      help: 'Supplier Hub 상품정보에서 확인한 선택값입니다. 해당사항없음의 실제 값은 빈 문자열입니다. 이전 문자열 값은 직접 재선택해주세요.' } : {}),
  })),
  ...[['noticeNameModel', '품명 및 모델명'], ['brace_noticeKc', 'KC 인증정보'], ['brace_noticeSizeWeight', '크기, 중량'],
    ['brace_noticeColor', '색상'], ['noticeMaterial', '재질'], ['noticeComponents', '제품 구성'], ['noticeReleaseDate', '출시년월'],
    ['noticeManufacturerImporter', '제조자(수입자)'], ['noticeCountryOfOrigin', '제조국'], ['brace_noticeSpecifications', '상품별 세부 사양'],
    ['noticeQualityAssurance', '품질보증기준'], ['noticeServiceContact', 'A/S 책임자와 전화번호'],
  ].map(([id, label]) => make(id, label, 'legal', 'common')),
];
