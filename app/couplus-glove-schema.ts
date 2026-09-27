import type { QuotationField } from '@/app/quotation-schema';

// Couplus rendered quotation 260927002001, observed 2026-09-27.
// Saved values do not establish automatic defaults or Supplier Hub validation rules.
export const couplus81221Path = ['스포츠/레져', '스포츠잡화', '스포츠장갑'];
const attributes: [string, string, string[]?][] = [
  ['season', '사용계절', ['사계절용', '봄/가을용', '여름용', '겨울용', '봄용', '가을용']],
  ['touch', '스마트폰 터치 가능 여부', ['터치 가능']],
  ['model', '모델명/품번'],
  ['user', '사용대상 구분', ['남성용', '여성용', '남녀공용', '아동/유아용', '시니어 남성용', '시니어 여성용', '시니어 남녀공용']],
  ['fashionSize', '패션잡화 사이즈', ['S', 'M', 'L', 'XL', 'Free Size', 'XXS', 'XS', 'XXL이상']],
  ['material', '스포츠 장비재질', ['나무', '알루미늄', '플라스틱', '카본', '스틸', '티타늄', '그래파이트', '강철', '스테인리스', '두랄루민']],
  ['shape', '장갑형태', ['손가락장갑', '벙어리장갑', '손가락+벙어리장갑', '손가락 반장갑']],
  ['colorGroup', '색상계열', ['블랙계열', '네이비계열', '그레이계열', '실버계열', '레드계열', '오렌지계열', '옐로우계열', '그린계열', '블루계열', '바이올렛/보라계열', '핑크계열', '화이트계열', '브라운계열', '골드계열', '베이지계열', '멀티(혼합)컬러', '투명계열', '아이보리 계열']],
  ['waterproof', '방수 가능여부', ['방수가능']],
  ['sport', '스포츠 종류'], ['gtin', 'Global Trade Item Number'],
  ['parentPart', 'Parent Manufacturer Part Number'], ['part', 'Manufacturer Part Number'],
];
const make = (id: string, label: string, section: QuotationField['section'], visibility: QuotationField['visibility']): QuotationField => ({
  id, label, section, visibility, type: 'text', required: false, reviewRequired: true, maxLength: 2000,
  help: '쿠플러스 스포츠장갑 견적 화면에서 확인한 항목입니다. Supplier Hub 규격과 자동 기본값은 추가 대조가 필요합니다.',
});
export const couplus81221Fields: QuotationField[] = [
  ...[['color', '색상'], ['quantity', '수량'], ['size', '사이즈']].map(([id, label]) => make(id, label, 'product', 'exposed')),
  ...attributes.map(([id, label, values]) => ({ ...make(`glove_${id}`, label, 'product', 'hidden'),
    ...(values ? { type: 'select' as const, choices: ['', ...values].map(value => ({ value, label: value || '해당사항없음' })) } : {}),
  })),
  ...[['noticeNameModel', '품명 및 모델명'], ['glove_noticeKc', 'KC 인증정보'], ['glove_noticeSizeWeight', '크기, 중량'],
    ['glove_noticeColor', '색상'], ['noticeMaterial', '재질'], ['noticeComponents', '제품 구성'], ['noticeReleaseDate', '출시년월'],
    ['noticeManufacturerImporter', '제조자(수입자)'], ['noticeCountryOfOrigin', '제조국'], ['glove_noticeSpecifications', '상품별 세부 사양'],
    ['noticeQualityAssurance', '품질보증기준'], ['noticeServiceContact', 'A/S 책임자와 전화번호'],
  ].map(([id, label]) => make(id, label, 'legal', 'common')),
];
