import type { QuotationField } from '@/app/quotation-schema';
import { quotationNoticeInput } from '@/app/quotation-notice-inputs';

// Exact resolver bindings only. A category name is never an input mapping.
const links: Readonly<Record<string, string>> = {
  title: '1단계 SEO 상품명 → 수집 상품명', altText: '7단계 대체 텍스트 · 신규 초안은 공란',
  category: '상품추가에서 선택한 카테고리', searchTags: '1단계 SEO 검색어',
  supplyPrice: '2단계 옵션 공급가', salePrice: '2단계 옵션 판매가', msrp: '2단계 옵션 권장소비자가격',
  brand: '기본설정 브랜드', manufacturer: '6단계 제조사 → 기본설정 제조사',
  tradeType: '기본설정 거래타입', taxType: '기본설정 과세여부', importType: '기본설정 수입여부',
  boxSkuQuantity: '기본설정 박스 내 SKU 수량', shelfLifeDays: '기본설정 유통기간', handlingReason: '기본설정 취급주의 사유', model: '6단계 모델명',
  packagedWeightG: '옵션 포장 무게 · g', packagedDimensionsMm: '옵션 포장 가로·세로·높이 · mm',
  quantity: '2단계 옵션 판매단위 수량', color: '옵션 색상', yoga_noticeColor: '옵션 색상', brace_noticeColor: '옵션 색상', marathon_noticeColor: '옵션 색상', glove_noticeColor: '옵션 색상',
  size: '옵션 사이즈 · 카테고리가 허용하는 경우 상품 치수', marathon_noticeSize: '옵션 사이즈',
  glove_fashionSize: '옵션 사이즈 · 스포츠장갑의 정확한 선택값',
  weight: '80719 옵션 상품 중량 · 포장 무게와 별개',
  mainImage: '옵션 대표 이미지 → 3단계 공통 대표 이미지', additionalImages: '4단계 추가 이미지',
  detailImages: '5단계 상세 이미지', detailHtml: '5단계 상세 설명·선택 이미지 → 전송용 HTML',
  labelImages: '6단계 한글 표시사항 이미지', noticeNameModel: '6단계 제품명·모델명 → SEO 상품명',
  noticeMaterial: '6단계 재질', noticeDimensions: '옵션 상품 치수 → 6단계 크기',
  noticeSizeWeight: '6단계 크기·중량', yoga_noticeSizeWeight: '6단계 크기·중량', brace_noticeSizeWeight: '6단계 크기·중량', glove_noticeSizeWeight: '6단계 크기·중량', noticeManufacturerImporter: '6단계 제조사·수입사 → 기본설정',
  noticeCountryOfOrigin: '6단계 제조국', noticeImportDeclaration: '6단계 수입신고 문구 여부', marathon_noticeKind: '6단계 상품 유형',
  marathon_noticeCaution: '6단계 사용 시 주의사항', noticePermission: '6단계 인증정보',
  noticeKc: '6단계 KC 인증정보', yoga_noticeKc: '6단계 KC 인증정보', brace_noticeKc: '6단계 KC 인증정보', glove_noticeKc: '6단계 KC 인증정보', noticeComponents: '6단계 구성품', noticeReleaseDate: '6단계 출시년월',
  noticeSpecifications: '6단계 상품별 세부 사양', yoga_noticeSpecifications: '6단계 상품별 세부 사양', brace_noticeSpecifications: '6단계 상품별 세부 사양', glove_noticeSpecifications: '6단계 상품별 세부 사양',
  noticeQualityAssurance: '6단계 품질보증기준', noticeServiceContact: '6단계 연락처 → 기본설정 A/S 연락처',
};
export function quotationInputLink(field: QuotationField): string | null {
  if (field.section === 'legal' && field.label === '세탁방법 및 취급시 주의사항') return '6단계 세탁·취급 주의사항 → 기본설정 세탁방법·취급시 주의사항';
  if (field.section === 'legal' && ['출시년월', '제조년월'].includes(field.label)) return '6단계 출시년월 → 기본설정 전월 자동 입력';
  const content = field.contentField ?? (field.id === 'storageMaterial' ? 'material' : undefined);
  if (content) return `6단계 ${{ material: '재질', components: '구성품', model: '모델명' }[content]}`;
  if (field.optionDimension) return `옵션 상품 ${{ widthCm: '가로', lengthCm: '세로', heightCm: '높이' }[field.optionDimension]} · cm`;
  return links[field.hubInput??quotationNoticeInput(field)??field.id] ?? null;
}
