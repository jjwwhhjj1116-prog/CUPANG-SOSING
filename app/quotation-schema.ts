import { QUOTATION_TAG_TOTAL_LIMIT, QUOTATION_TAG_ITEM_LIMIT } from '@/app/quotation-keywords';
import { couplus64497Fields, couplus64497Path } from '@/app/couplus-toothbrush-schema';
import { couplus77442Fields, couplus77442Path } from '@/app/couplus-board-schema';
import { couplus81452Fields, couplus81452Path } from '@/app/couplus-brace-schema';
import { couplus103495Fields, couplus103495Path } from '@/app/couplus-marathon-schema';
import { contentDetailImageKeys, savedTextOrFallback, type ContentField, type CustomLabel, type ProductContent } from '@/app/product-content';
import type { ProductOption, ProductOptions } from '@/app/product-options';
import { calculateOptionPrices, resolveOptionPricePolicy, quotationMainImageKeys } from '@/app/product-options';
import type { WorkspaceSettings } from '@/app/workspace-settings';
import type { ProductRecord } from '@/db/queries';
import { hubProductSchemas } from '@/app/hub-product-schemas';
import { couplusQuotationDefault } from '@/app/couplus-quotation-defaults';
import { hasSelectedEmptyQuotationChoice } from '@/app/quotation-choice-state';

// Base fields come from Couplus screenshots 15–23. Product attributes and preview
// notice names for 22 kitchen-storage categories were observed in Supplier Hub
// (2026-09-23). Image/certification/logistics forms and submission remain unverified.
export const quotationSections = {
  start: '1. Start Page · 시작 페이지', product: '2. Product Page · 상품 페이지',
  image: '3. Image Page · 이미지 페이지', legal: '4. Legal Page · 법적 정보',
  logistics: '5. Logistics Page · 물류 정보',
} as const;
export type QuotationSection = keyof typeof quotationSections;
export type QuotationField = {
  id: string; section: QuotationSection; label: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'images';
  required: boolean; visibility: 'common' | 'exposed' | 'hidden';
  choices?: { value: string; label: string }[]; unit?: string; maxLength?: number;
  reviewRequired?: boolean; readOnly?: boolean; help?: string;
  integer?: boolean; min?: number; max?: number; maxItems?: number;
  /** Explicit shared meaning; never infer component materials from a label substring. */
  contentField?: 'material' | 'components' | 'model';
  optionDimension?: 'widthCm' | 'lengthCm' | 'heightCm';
};
export type QuotationSchema = {
  version: 1; categoryId: string | null; categoryPath: string[];
  status: 'observed' | 'unconfirmed'; evidence: string; fields: QuotationField[];
  submissionReady: false;
  maxIncludedOptions?: number;
  salePriceMustCoverSupply?: boolean;
};
export type QuotationOverrides = { common: Record<string, string>; options: Record<string, Record<string, string>> };
export type QuotationChange = { fieldKey: string; optionId: string | null; value: string | null };
export type QuotationSource = 'manual-option' | 'manual-common' | 'schema' | 'content' | 'settings' | 'option' | 'pricing' | 'product' | 'empty' | 'couplus-default';
export type ResolvedQuotationField = { value: string; source: QuotationSource; needsReview: boolean; issues: string[]; validationIssues?: string[]; reviewMessages?: string[] };
export type ResolvedQuotationRow = { optionId: string | null; optionLabel: string; included: boolean; fields: Record<string, ResolvedQuotationField> };
export type ResolvedQuotation = { schema: QuotationSchema; rows: ResolvedQuotationRow[]; issues: string[]; customLabels?: CustomLabel[] };
export type QuotationFieldsView = {
  revision: number; inputFingerprint: string; overrides: QuotationOverrides; legacyOverrides?: QuotationOverrides; resolved: ResolvedQuotation; automatic: ResolvedQuotation;
  categoryContext: { source: 'profile' | 'collection' | 'unknown'; profileId: string | null; categoryId: string | null; categoryPath: string[] };
  productVersion: string; contentRevision: number; optionRevision: number; updatedAt: string | null;
  imageKeys: string[]; submissionReady: false;
};

type FieldExtras = Partial<Omit<QuotationField, 'id' | 'section' | 'label'>>;
const field = (id: string, section: QuotationSection, label: string, extra: FieldExtras = {}): QuotationField =>
  ({ id, section, label, type: 'text', required: false, visibility: 'common', maxLength: 2000, ...extra });
const choices = (...values: string[]) => values.map(value => ({ value, label: value }));
const imageHelp = '이 상품에 저장된 비공개 이미지의 참조입니다. Supplier Hub에서 접근할 공개 URL이 만들어졌다는 의미는 아닙니다.';
const commonFields: QuotationField[] = [
  field('title', 'start', '상품명', { required: true, maxLength: 500, help: '저장한 SEO 상품명을 우선 사용합니다. 수정값은 견적서에만 적용됩니다.' }),
  field('category', 'start', '카테고리', { required: true, readOnly: true, reviewRequired: true, help: '선택한 분류입니다. 상품과 맞는지는 별도 확인이 필요합니다.' }),
  field('model', 'product', '모델명', { required: true, maxLength: 50, reviewRequired: true, help: '확인된 모델명을 사용합니다. 상품명을 임의로 잘라 모델명으로 만들지 않습니다.' }),
  field('brand', 'product', '브랜드', { required: true, maxLength: 500, reviewRequired: true }),
  field('manufacturer', 'product', '제조사', { required: true, maxLength: 500, reviewRequired: true }),
  field('tradeType', 'product', '거래타입', { type: 'select', required: true, choices: choices('제조사', '공식총판사', '공식대리점', '기타 도소매업자'), reviewRequired: true }),
  field('taxType', 'product', '과세여부', { type: 'select', required: true, choices: choices('과세', '면세', '영세'), reviewRequired: true }),
  field('importType', 'product', '수입여부', { type: 'select', required: true, choices: choices('수입대상아님', '수입상품', '병행수입상품'), reviewRequired: true }),
  field('searchTags', 'product', '검색태그', { type: 'textarea', required: true, maxLength: QUOTATION_TAG_TOTAL_LIMIT, help: '쉼표로 구분하며 전체 150자, 태그마다 20자 이내입니다. 초과값을 조용히 잘라내지 않습니다.' }),
  field('supplyPrice', 'product', '공급가', { type: 'number', unit: '원', integer: true, min: 1, max: Number.MAX_SAFE_INTEGER }),
  field('salePrice', 'product', '판매가', { type: 'number', unit: '원', integer: true, min: 1, max: Number.MAX_SAFE_INTEGER }),
  field('msrp', 'product', '권장소비자가격', { type: 'number', unit: '원', integer: true, min: 1, max: Number.MAX_SAFE_INTEGER,
    help: '배수로 자동 계산한 금액은 권장가 초안입니다. 제조사 권장가 또는 공식 판매처 가격의 근거와 가격 설정 권한을 확인해주세요. 직접 수정하거나 저장해도 Supplier Hub MSRP·OSRP 약관에 동의한 것으로 처리하지 않습니다.' }),
  field('barcodeMode', 'product', '바코드 입력 방식', { type: 'select', choices: [
    { value: 'existing', label: '실제 바코드 입력' }, { value: 'request-coupang', label: '바코드 없음(쿠팡 바코드 생성 요청)' },
  ], reviewRequired: true, help: '없음을 선택해도 실제 쿠팡 바코드 생성 요청은 전송하지 않습니다.' }),
  field('barcode', 'product', '바코드', { maxLength: 100, reviewRequired: true, help: '실제 바코드 입력 방식을 선택한 경우 확인된 번호를 입력합니다.' }),
  field('mainImage', 'image', '대표 이미지', { type: 'images', maxLength: 512, maxItems: 1, help: imageHelp }),
  field('additionalImages', 'image', '추가 이미지', { type: 'images', maxLength: 16000, maxItems: 30, help: imageHelp }),
  field('labelImages', 'image', '제품 한글 표시사항 라벨 또는 도안 이미지', { type: 'images', maxLength: 16000, maxItems: 30, help: imageHelp }),
  field('detailImages', 'image', '상세 이미지', { type: 'images', maxLength: 16000, maxItems: 30, help: imageHelp }),
  field('detailHtml', 'image', 'HTML 상세 내용', { type: 'textarea', maxLength: 150000, help: '자동값은 설명을 HTML 이스케이프한 문단입니다. 입력한 HTML을 작업 화면에서 실행하지 않습니다.' }),
  field('altText', 'image', '대체 텍스트', { maxLength: 2000 }),
  field('kcMarkType', 'legal', '전기용품 및 생활용품, 어린이 (KC) 인증 마크 타입', { type: 'select', required: true, reviewRequired: true, choices: choices('해당사항없음', 'KC인증마크_어린이제품 공급자적합성확인', 'KC인증마크_생활용품 공급자적합성확인', 'KC인증마크_전기용품 공급자적합성확인'), help: '인증 대상 여부와 유형을 확인해 입력합니다. 미확인을 해당사항없음으로 바꾸지 않습니다.' }),
  field('kcCertificationNumber', 'legal', '전기용품 및 생활용품, 어린이 (KC) 인증번호', { reviewRequired: true }),
  field('emcCertificationNumber', 'legal', '방송통신 기자재 (EMC) 인증 번호', { reviewRequired: true }),
  field('safetyDeclarationNumber', 'legal', '안전기준적합확인 신고번호', { reviewRequired: true }),
  field('kcsCertificationNumber', 'legal', 'KCS 인증번호', { reviewRequired: true }),
  field('boxSkuQuantity', 'logistics', '박스 내 SKU 수량', { type: 'number', required: true, integer: true, min: 1, max: 100000, unit: '개', help: '판매 단위 구성 수량과 별개인 입고 박스 안 SKU 수량입니다.' }),
  field('shelfLifeDays', 'logistics', '유통기간 · 식품의 경우 소비기간', { type: 'number', required: true, integer: true, min: 0, max: 100000, unit: '일', reviewRequired: true, help: '해당되지 않아 0을 입력하는 경우에도 직접 확인해주세요.' }),
  field('handlingReason', 'logistics', '취급주의 사유', { type: 'select', required: true, choices: choices('해당사항없음', '유리'), reviewRequired: true }),
  field('packagedWeightG', 'logistics', '한 개 단품 포장 무게', { type: 'number', required: true, integer: true, min: 1, max: 1e9, unit: 'g', reviewRequired: true, help: '배송되는 포장 상태의 무게입니다. 상품 무게 kg에서 자동 변환하지 않습니다.' }),
  field('packagedDimensionsMm', 'logistics', '한 개 단품 포장 사이즈', { required: true, maxLength: 100, unit: 'mm', reviewRequired: true, help: '포장 가로*세로*높이를 mm로 입력합니다. 상품 치수 cm와 다릅니다.' }),
];

const hidden80719 = [
  ['lidIncluded', '뚜껑 포함여부'], ['heightAdjustable', '높이조절 여부'], ['basketShape', '바구니 형태'],
  ['storageMaterial', '수납/정리용품 재질'], ['totalQuantity', '총 수량'], ['width', '가로길이'],
  ['handleIncluded', '손잡이 포함여부'], ['foldable', '접이식 가능여부'], ['weight', '중량'],
  ['transparent', '투명 여부'], ['storageShape', '수납/정리함 형태'], ['ventilationFan', '환기팬 유무'],
  ['storageMethod', '보관방식'], ['storageAvailable', '수납가능여부'], ['storageLocation', '수납정리공간 위치'],
  ['shelfLevels', '가구 단수'], ['basketUse', '바구니 용도'], ['shelfShape', '선반형태'],
  ['widthAdjustable', '폭조절 가능 여부'], ['assemblyRequired', '조립식 여부'], ['sliding', '슬라이딩 여부'],
  ['kitchenShelfUse', '주방선반 용도'], ['finishType', '마감 유형'], ['itemHeight', '아이템 높이'],
  ['includedComponents', '포함 구성 요소'], ['gtin', 'Global Trade Item Number'],
  ['parentManufacturerPartNumber', 'Parent Manufacturer Part Number'], ['manufacturerPartNumber', 'Manufacturer Part Number'],
] as const;
const notice80719 = [
  ['noticeNameModel', '품명 및 모델명'], ['noticeMaterial', '재질'], ['noticeComponents', '구성품'],
  ['noticeDimensions', '크기'], ['noticeReleaseDate', '출시년월'], ['noticeManufacturerImporter', '제조자(수입자)'],
  ['noticeCountryOfOrigin', '제조국'], ['noticeImportDeclaration', '수입신고 문구 여부'],
  ['noticeQualityAssurance', '품질보증기준'], ['noticeServiceContact', 'A/S 책임자와 전화번호'],
] as const;
// Exact options observed on Supplier Hub Product Page, category 80719, 2026-09-22.
// Empty value has the visible label “해당사항없음”; it is not an inferred product fact.
const hubProductSelectValues80719: Partial<Record<(typeof hidden80719)[number][0], readonly string[]>> = {
  lidIncluded: ["뚜껑포함",""],
  heightAdjustable: ["높이조절 가능",""],
  basketShape: ["원형","사각형","다각형",""],
  storageMaterial: ["플라스틱","패브릭","부직포","PVC","라탄","원목/우드","강철/철제","스테인리스","아크릴","ABS","고무","폴리프로필렌(PP)","폴리에스터(PE)","벨벳","종이",""],
  handleIncluded: ["손잡이 포함","미포함",""],
  foldable: ["접이식가능",""],
  transparent: ["투명","반투명","불투명","해당없음",""],
  storageShape: ["선반형","박스형","그물형","바구니형","서랍형","혼합형",""],
  ventilationFan: ["환기팬있음","환기팬없음",""],
  storageMethod: ["실온보관","냉동보관","냉장보관",""],
  storageAvailable: ["수납가능",""],
  storageLocation: ["싱크대 상부장","싱크대 하부장","조리대 윗공간","싱크대/개수대 주변","냉장고 선반/바스켓","기타/틈새수납",""],
  basketUse: ["수납/정리바구니","빨래바구니","목욕바구니","소풍바구니",""],
  shelfShape: ["스탠드형","설치형 (못없이)","설치형 (타공)","부착/흡착형","걸이형","기둥/행거형","압축 (스프링)형","싱크바구니형","싱크롤형","매트형",""],
  widthAdjustable: ["폭조절 가능",""],
  assemblyRequired: ["조립식","비조립식",""],
  sliding: ["슬라이딩",""],
  kitchenShelfUse: ["다용도","식기 건조용",""],
  finishType: ["브러쉬 처리","래커 처리","오일 마감","도장","광택 처리","분체 도장","무광택","고광택","고민 처리","광택 처리되지 않음","글로시","매트","미완성","반광택","반무광","반짝임","새틴","쉬머리","쉬어","페인트 처리",""],
  includedComponents: ["갓","나사","리모콘","반사판","배터리","본품","설명서","스탠드","어댑터","전구","전원 케이블","조광기","콘센트","해당없음","On-Off 스위치","USB포트","어플리케이터 브러시","주걱","추출 도구",""],
};
const category80719: QuotationField[] = [
  field('color', 'product', '색상', { visibility: 'exposed', required: true, reviewRequired: true }),
  field('quantity', 'product', '수량', { visibility: 'exposed', required: true, reviewRequired: true }),
  field('size', 'product', '사이즈', { visibility: 'exposed', required: true, reviewRequired: true }),
  ...hidden80719.map(([id, label]) => {
    const observed = hubProductSelectValues80719[id];
    return field(id, 'product', label, { visibility: 'hidden', reviewRequired: true,
      ...(observed ? { type: 'select', choices: observed.map(value => ({ value, label: value === '' ? '해당사항없음' : value })),
        help: 'Supplier Hub 상품 페이지에서 확인한 선택값입니다. 해당사항없음의 저장값은 빈 문자열이며, 자동 미입력과 직접 선택은 출처로 구분합니다.' } : {}),
    });
  }),
  ...notice80719.map(([id, label]) => field(id, 'legal', label, { reviewRequired: true })),
];

// Explicit meanings in observed fields; never infer from partial label matches.
function productContentBinding(item: QuotationField): QuotationField {
  if (item.section !== 'product' || item.visibility !== 'hidden') return item;
  if (item.label === '포함 구성 요소' && item.type === 'select') return { ...item, contentField: 'components' };
  if (item.label === '모델명/품번' && item.type === 'text') return { ...item, contentField: 'model' };
  // Packaging and capacity are separate facts from physical dimensions.
  if (item.type !== 'text') return item;
  const keys = { '가로길이': 'widthCm', '세로길이': 'lengthCm', '아이템 높이': 'heightCm' } as const;
  const key = keys[item.label as keyof typeof keys];
  return key ? { ...item, optionDimension: key } : item;
}

export function getQuotationSchema(categoryId: string | null, categoryPath: readonly string[] = []): QuotationSchema {
  const hub = categoryId && Object.hasOwn(hubProductSchemas, categoryId) ? hubProductSchemas[categoryId] : undefined;
  const observed = Boolean(hub) || categoryId === '80719' || categoryId === '81452' || categoryId === '64497' || categoryId === '103495' || categoryId === '77442';
  const fields = commonFields.map(item => observed && ['supplyPrice', 'salePrice', 'searchTags'].includes(item.id)
    ? { ...item, required: item.id !== 'searchTags' }
    : observed && item.id === 'barcode' ? { ...item, help: '실제 바코드 입력 방식에서는 6~14자의 영문 대문자·숫자·하이픈·공백을 사용합니다. 앞뒤 공백과 연속 공백은 허용되지 않습니다.' } : item);
  if (categoryId === '80719') {
    const modelIndex = fields.findIndex(item => item.id === 'model');
    fields[modelIndex] = { ...fields[modelIndex], help: '6단계 모델명이 미입력일 때 50자 이내의 SEO 상품명(없으면 수집 상품명)을 연결합니다. 직접 비운 값은 유지합니다. 인증 대상 상품은 증빙의 모델명과 일치하는지 확인해주세요.' };
    fields.splice(fields.findIndex(item => item.section === 'image'), 0, ...category80719.filter(item => item.section === 'product'));
    fields.splice(fields.findIndex(item => item.section === 'logistics'), 0, ...category80719.filter(item => item.section === 'legal'));
  } else if (hub) {
    const attributes = [
      ...hub.exposed.map(item => field(item.id, 'product', item.label, { visibility: 'exposed', required: item.required, reviewRequired: true })),
      ...hub.hidden.map(item => field(item.id, 'product', item.label, { visibility: 'hidden', type: item.type, choices: item.choices,
        ...(['수납/정리용품 재질', '상품 재질'].includes(item.label) ? { contentField: 'material' as const } : {}),
        reviewRequired: true, help: item.placeholder ? `공식 입력 예시: ${item.placeholder.replace(/^예\)\s*/, '')}` : '선택한 카테고리의 공식 상품정보 화면에서 확인한 항목입니다.' })),
    ];
    fields.splice(fields.findIndex(item => item.section === 'image'), 0, ...attributes);
    fields.splice(fields.findIndex(item => item.section === 'logistics'), 0, ...hub.notices.map(item => field(item.id, 'legal', item.label,
      { reviewRequired: true, help: '공식 상품 미리보기의 상품고시 항목입니다. 실제 상품·증빙에 맞게 작성해주세요.' })));
  }
  const couplusFields = categoryId === '103495' ? couplus103495Fields : categoryId === '64497' ? couplus64497Fields : categoryId === '77442' ? couplus77442Fields : categoryId === '81452' ? couplus81452Fields : null;
  const couplusPath = categoryId === '103495' ? couplus103495Path : categoryId === '64497' ? couplus64497Path : categoryId === '77442' ? couplus77442Path : categoryId === '81452' ? couplus81452Path : null;
  if (couplusFields && !hub) {
    fields.splice(fields.findIndex(item => item.section === 'image'), 0, ...couplusFields.filter(item => item.section === 'product').map(item => (categoryId === '81452' || categoryId === '64497' || categoryId === '103495' || categoryId === '77442')
      ? { ...item, ...(['수납/정리용품 재질', '상품 재질'].includes(item.label) ? { contentField: 'material' as const } : {}), required: item.visibility === 'exposed', help: item.type === 'select' ? item.help : item.id === 'size'
        ? '공식 입력 예시: S, Medium, Free, 대, one size 등. 구매 옵션의 사이즈를 입력해주세요. 크기·중량 표시사항과 별도로 관리합니다.'
        : 'Supplier Hub 상품정보 화면에서 확인한 항목입니다. 실제 상품값을 입력해주세요.' } : item));
    fields.splice(fields.findIndex(item => item.section === 'logistics'), 0, ...couplusFields.filter(item => item.section === 'legal'));
    if (categoryId !== '64497') fields.splice(fields.findIndex(item => item.id === 'kcsCertificationNumber'), 1);
    if (categoryId === '64497' || categoryId === '103495') { const model = fields.findIndex(item => item.id === 'model'); fields[model] = { ...fields[model], required: false }; }
  }
  const maxIncludedOptions = hub?.maxIncludedOptions ?? (categoryId === '80719' || categoryId === '81452' || categoryId === '64497' || categoryId === '103495' || categoryId === '77442' ? 100 : undefined);
  return { version: 1, categoryId, categoryPath: hub ? [...hub.path] : couplusPath ? [...couplusPath] : categoryId === '80719' ? ['주방용품', '주방수납/정리', '주방수납바구니/바스켓'] : [...categoryPath],
    status: observed ? 'observed' : 'unconfirmed', evidence: categoryId === '77442' ? '77442 코드·경로·노출 속성 2개·비노출 속성 16개·선택값·필수 모델명과 가격·바코드 규칙·옵션 100개 한도를 Supplier Hub 상품정보에서 대조했습니다. 상품고시 5개 이름은 공식 미리보기와 일치합니다. 이미지·인증·물류 및 최종 접수는 미검증입니다.' : categoryId === '103495' ? '103495 코드·경로·노출 속성 3개·비노출 속성 23개·선택값·필수 가격·바코드 규칙·옵션 100개 한도를 Supplier Hub 상품정보에서 대조했습니다. 상품고시 9개 이름은 공식 미리보기와 일치합니다. 이미지·인증·물류 및 최종 접수는 미검증입니다.' : categoryId === '64497' ? '64497 코드·경로·노출 속성 2개·비노출 속성 33개·선택값·필수 가격·바코드 규칙·옵션 100개 한도를 Supplier Hub 상품정보에서 대조했습니다. 상품고시 5개 이름은 공식 미리보기와 일치합니다. 이미지·인증·물류 및 최종 접수는 미검증입니다.' : categoryId === '81452' ? '81452 코드·경로·상품정보 필수 항목·선택값·옵션 100개 한도는 Supplier Hub에서 대조했습니다. 상품고시는 쿠플러스 관찰 기준이며 이미지·인증·물류·최종 접수는 미검증입니다.' : observed ? `${categoryId}의 상품 옵션·검색 속성·선택값은 Supplier Hub 공식 화면에서 대조했습니다. 상품고시 이름은 공식 미리보기 기준입니다. 이미지·인증·물류 입력 규격과 최종 접수는 추가 검증이 필요합니다.` : couplusFields ? '쿠플러스 견적 화면에서 속성·선택지·고시 항목을 확인했습니다. 자동 기본값과 Supplier Hub 공식 규격은 미확인입니다.' : '카테고리별 속성·상품고시 스키마 미확보. 관찰된 공통 입력만 표시합니다.',
    fields: structuredClone(observed ? fields.map(productContentBinding) : fields), submissionReady: false, ...(maxIncludedOptions ? { maxIncludedOptions } : {}),
    ...(hub?.salePriceMustCoverSupply || categoryId === '81452' || categoryId === '64497' || categoryId === '103495' || categoryId === '77442' ? { salePriceMustCoverSupply: true } : {}) };
}
export function emptyQuotationOverrides(): QuotationOverrides { return { common: {}, options: {} }; }

export function quotationBarcodeIssues(categoryId: string | null, mode: string, value: string): string[] {
  if (((!categoryId || !Object.hasOwn(hubProductSchemas, categoryId)) && categoryId !== '80719' && categoryId !== '81452' && categoryId !== '64497' && categoryId !== '103495' && categoryId !== '77442') || mode !== 'existing' || !value.trim()) return [];
  const issues: string[] = [];
  if (!/^[A-Z0-9 -]{6,14}$/.test(value)) issues.push('실제 바코드는 6~14자의 영문 대문자·숫자·하이픈·공백만 사용할 수 있습니다.');
  if (/^ | $| {2}/.test(value)) issues.push('실제 바코드의 앞뒤 공백과 연속 공백은 허용되지 않습니다.');
  return issues;
}
export function quotationOptionLimitIssue(schema: QuotationSchema, includedCount: number): string | null {
  return schema.maxIncludedOptions !== undefined && includedCount > schema.maxIncludedOptions
    ? `현재 견적 포함 옵션 ${includedCount}개가 Supplier Hub ${schema.categoryId}의 ${schema.maxIncludedOptions}개 한도를 초과했습니다. 로컬 옵션은 모두 보존됩니다. 포함 범위를 조정한 후 등록 자료를 검토해주세요.` : null;
}
export function quotationPriceIssues(schema: QuotationSchema, supply: string, sale: string): string[] {
  if (!schema.salePriceMustCoverSupply || !/^\d+$/.test(supply) || !/^\d+$/.test(sale)) return [];
  const supplyValue = Number(supply); const saleValue = Number(sale);
  return Number.isSafeInteger(supplyValue) && Number.isSafeInteger(saleValue) && supplyValue > 0 && saleValue > 0 && saleValue < supplyValue
    ? ['판매가는 공급가보다 작을 수 없습니다.'] : [];
}

export const duplicateQuotationImageIssue = '대표 이미지가 상세 이미지에도 포함되어 있습니다. Supplier Hub 반려 가능성이 있으므로 구성을 확인해주세요.';
export function quotationImageRoleIssues(main: string, detail: string): string[] {
  const keys = new Set(main.split('\n').map(key => key.trim()).filter(Boolean));
  return detail.split('\n').some(key => keys.has(key.trim())) ? [duplicateQuotationImageIssue] : [];
}
export function quotationValueIssues(field: QuotationField, value: string, ownedKeys?: readonly string[]) {
  const issues: string[] = [];
  if (!value.trim()) return field.required ? ['필수 값이 비어 있습니다.'] : [];
  if (field.maxLength && value.length > field.maxLength) issues.push(`${field.maxLength}자 제한을 초과했습니다.`);
  if (field.choices && !field.choices.some(choice => choice.value === value)) issues.push('지원하는 선택값을 확인해주세요.');
  if (field.type === 'number') {
    const numeric = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
    if (!Number.isFinite(numeric) || (field.integer && !Number.isSafeInteger(numeric)) || (field.min !== undefined && numeric < field.min) || (field.max !== undefined && numeric > field.max)) issues.push(`${field.unit ?? '숫자'} 값의 형식과 범위를 확인해주세요.`);
  }
  if (field.id === 'searchTags' && value.split(',').some(tag => tag.trim().length > QUOTATION_TAG_ITEM_LIMIT)) issues.push('검색태그는 태그마다 20자 이하여야 합니다.');
  if (field.id === 'packagedDimensionsMm') {
    const parts = value.split(/[xX×*]/).map(part => part.trim());
    if (parts.length !== 3 || parts.some(part => !/^\d+$/.test(part) || Number(part) <= 0 || Number(part) > 1e6)) issues.push('포장 가로*세로*높이를 양의 정수 3개로 입력해주세요(mm).');
  }
  if (field.type === 'images') {
    const keys = value.split('\n').map(key => key.trim()).filter(Boolean);
    if (keys.length > (field.maxItems ?? 30) || new Set(keys).size !== keys.length || keys.some(key => key.length > 512 || !ownedKeys?.includes(key))) issues.push('이 상품에 저장된 이미지 참조만 중복 없이 선택해주세요.');
  }
  return issues;
}

export function validateQuotationChanges(input: unknown, context: { schema: QuotationSchema; optionIds: readonly string[]; ownedImageKeys?: readonly string[]; overrides?: QuotationOverrides }): QuotationChange[] {
  if (!Array.isArray(input) || !input.length || input.length > 1000) throw new Error('변경 항목은 1~1,000개여야 합니다.');
  const known = new Map(context.schema.fields.map(item => [item.id, item])); const seen = new Set<string>();
  const changes: QuotationChange[] = input.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['fieldKey', 'optionId', 'value'].includes(key))) throw new Error('견적 편집 형식을 확인해주세요.');
    const field = known.get(item.fieldKey);
    if (!field || field.readOnly) throw new Error('편집할 수 없는 견적 필드입니다.');
    if (item.optionId !== null && (typeof item.optionId !== 'string' || !context.optionIds.includes(item.optionId))) throw new Error('이 상품의 옵션을 선택해주세요.');
    const key = JSON.stringify([item.optionId, item.fieldKey]); if (seen.has(key)) throw new Error('동일 필드 변경이 중복됐습니다.'); seen.add(key);
    if (item.value !== null && (typeof item.value !== 'string' || (field.maxLength && item.value.length > field.maxLength) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(item.value))) throw new Error('필드 값은 길이 제한 이내의 일반 텍스트 또는 수정 해제여야 합니다.');
    // Empty values can be saved as a draft; missing required values are surfaced
    // by the resolver instead of preventing a user from removing a wrong value.
    if (item.value !== null && item.value.trim()) {
      const issues = quotationValueIssues(field, item.value, context.ownedImageKeys);
      if (issues.length) throw new Error(`${field.label}: ${issues.join(' ')}`);
    }
    return { fieldKey: item.fieldKey, optionId: item.optionId, value: item.value };
  });
  const barcodeChanges = changes.filter(change => change.fieldKey === 'barcode' || change.fieldKey === 'barcodeMode');
  if (barcodeChanges.length) {
    const next = applyQuotationChanges(context.overrides ?? emptyQuotationOverrides(), changes);
    const targets = barcodeChanges.some(change => change.optionId === null) ? [null, ...context.optionIds] : [...new Set(barcodeChanges.map(change => change.optionId))];
    for (const optionId of targets) {
      const specific = optionId !== null && Object.hasOwn(next.options, optionId) ? next.options[optionId] : undefined;
      const value = (id: string) => specific && Object.hasOwn(specific, id) ? specific[id] : Object.hasOwn(next.common, id) ? next.common[id] : '';
      const errors = quotationBarcodeIssues(context.schema.categoryId, value('barcodeMode'), value('barcode'));
      if (errors.length) throw new Error(`바코드: ${errors.join(' ')}`);
    }
  }
  return changes;
}

export function applyQuotationChanges(current: QuotationOverrides, changes: readonly QuotationChange[]): QuotationOverrides {
  const next = structuredClone(current);
  for (const change of changes) {
    // Inputs must first pass validateQuotationChanges. Own-property definitions
    // additionally avoid prototype setters when reading untrusted stored JSON.
    const values = change.optionId === null ? next.common : (Object.hasOwn(next.options, change.optionId) ? next.options[change.optionId] : Object.defineProperty(next.options, change.optionId, { value: {}, enumerable: true, configurable: true, writable: true })[change.optionId]);
    if (change.value === null) delete values[change.fieldKey];
    else Object.defineProperty(values, change.fieldKey, { value: change.value, enumerable: true, configurable: true, writable: true });
    if (change.optionId !== null && Object.keys(values).length === 0) delete next.options[change.optionId];
  }
  return next;
}

export type QuotationResolverInput = { categoryId: string | null; categoryPath?: readonly string[]; product: ProductRecord;
  content: ProductContent; settings: WorkspaceSettings; options: ProductOptions | readonly ProductOption[]; overrides?: QuotationOverrides };
type Automatic = { value: string; source: QuotationSource; issues?: string[] };
const literal = (value: unknown, source: QuotationSource): Automatic => ({ value: value === null || value === undefined ? '' : String(value), source: value === '' || value === null || value === undefined ? 'empty' : source });
const htmlEscape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function resolveQuotationFields(input: QuotationResolverInput): ResolvedQuotation {
  const { product, content, settings } = input;
  const options: readonly ProductOption[] = Array.isArray(input.options) ? input.options : (input.options as ProductOptions).rows;
  const untouchedOptions = Array.isArray(input.options) || (input.options as ProductOptions).revision === 0;
  const includeCommonRow = options.length === 0 && untouchedOptions;
  const overrides = input.overrides ?? emptyQuotationOverrides();
  const schema = getQuotationSchema(input.categoryId, input.categoryPath);
  let ownedKeys: string[] = []; const issues = [schema.evidence, 'Supplier Hub 최종 접수 검증 전인 편집 자료입니다.'];
  if (!includeCommonRow && !options.some(option => option.included)) issues.unshift('견적서에 포함할 옵션을 한 개 이상 선택해주세요. 삭제·제외된 옵션을 상품 대표 가격으로 대체하지 않습니다.');
  const optionLimitIssue = quotationOptionLimitIssue(schema, options.filter(option => option.included).length);
  if (optionLimitIssue) issues.unshift(optionLimitIssue);
  try { const keys: unknown = JSON.parse(product.image_keys); if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string')) throw new Error(); ownedKeys = keys; }
  catch { issues.push('상품 이미지 목록을 읽지 못했습니다. 이미지 자동 연결을 확인해주세요.'); }
  if (schema.status === 'unconfirmed') issues.push('선택한 카테고리의 상세 속성과 상품고시 스키마가 아직 확인되지 않았습니다.');
  if (!schema.categoryId) issues.push('카테고리를 먼저 선택해주세요.');
  let prices: ReturnType<typeof calculateOptionPrices> = [];
  try { prices = calculateOptionPrices(options, resolveOptionPricePolicy(product, settings).policy); }
  catch { issues.push('저장된 가격 설정을 확인해주세요. 옵션 가격을 자동 계산하지 않았습니다.'); }
  const contentValue = (field: ContentField<string>, fallback?: string): Automatic => field.provenance === 'manual'
    ? { value: field.value, source: 'content' }
    : literal(savedTextOrFallback(field, fallback), field.value ? 'content' : fallback ? 'settings' : 'empty');
  const images = (keys: readonly string[]): Automatic => {
    const missing = keys.filter(key => !ownedKeys.includes(key));
    return { value: keys.filter(key => ownedKeys.includes(key)).join('\n'), source: keys.some(key => ownedKeys.includes(key)) ? 'content' : 'empty',
      issues: missing.length ? ['상품에 저장되지 않은 이미지 참조를 제외했습니다. 연결을 다시 확인해주세요.'] : [] };
  };
  function dimensions(option: ProductOption | null): Automatic {
    // An explicit removal must not silently restore a shared label measurement.
    if (option && (['widthCm', 'lengthCm', 'heightCm'] as const).some(key => option[key] === null && option.provenance[key] === 'manual')) return { value: '', source: 'option' };
    return option && option.widthCm && option.lengthCm && option.heightCm
      ? literal(`${option.widthCm} × ${option.lengthCm} × ${option.heightCm} cm`, 'option') : contentValue(content.label.dimensions);
  }
  function auto(definition: QuotationField, option: ProductOption | null): Automatic {
    const id = definition.id;
    const linkedContent = definition.contentField ?? (id === 'storageMaterial' ? 'material' : undefined);
    if (linkedContent) {
      const saved = contentValue(content.label[linkedContent] ?? { value: '', provenance: 'unverified', updatedAt: null });
      if (saved.source === 'empty') return saved;
      // A single exact observed choice can be translated to its wire value.
      // Composite descriptions stay intact and receive normal select validation;
      // do not reduce them to one material/component or silently replace with N/A.
      const matches = definition.choices?.filter(choice => choice.value === saved.value || choice.label === saved.value) ?? [];
      return matches.length === 1 ? { ...saved, value: matches[0].value } : saved;
    }
    if (definition.optionDimension) {
      const key = definition.optionDimension;
      const value = option?.[key];
      if (option && value === null && option.provenance[key] === 'manual') return { value: '', source: 'option' };
      return literal(value == null ? '' : `${value} cm`, value == null ? 'empty' : 'option');
    }
    const title = savedTextOrFallback(content.seo.title, product.title);
    const titleSource = content.seo.title.provenance === 'manual' || content.seo.title.value ? 'content' as const : 'product' as const;
    const pricing = option ? prices.find(row => row.optionId === option.id) : null;
    switch (id) {
      case 'title': return { value: title, source: titleSource };
      case 'category': return literal(schema.categoryId ? `${schema.categoryPath.join(' > ')}${schema.categoryPath.length ? ' ' : ''}(${schema.categoryId})` : '', 'schema');
      case 'model': {
        const saved = contentValue(content.label.model);
        // The supplied 80719 form explicitly permits the product name when no
        // model is entered. Keep this observed rule scoped to that category.
        if (saved.source !== 'empty' || schema.categoryId !== '80719') return saved;
        if (title.length > (definition.maxLength ?? 50)) return { value: '', source: 'empty', issues: ['상품명이 모델명 50자 제한을 초과합니다. 확인한 모델명을 입력해주세요.'] };
        return { value: title, source: titleSource };
      }
      case 'brand': return literal(settings.brand, 'settings');
      case 'manufacturer': return contentValue(content.label.manufacturer, settings.manufacturer);
      case 'tradeType': return literal(settings.tradeType, 'settings');
      case 'taxType': return literal(settings.taxType, 'settings');
      case 'importType': return literal(settings.importType, 'settings');
      case 'searchTags': return literal(content.seo.keywords.value.join(', '), 'content');
      case 'supplyPrice': case 'salePrice': case 'msrp': {
        if (!option) return literal(id === 'supplyPrice' ? product.supply_price : id === 'salePrice' ? product.sale_price : product.msrp, 'product');
        return { ...literal(pricing?.calculation?.[id], 'pricing'), issues: pricing?.error ? [pricing.error] : !option.included ? ['견적 제외 옵션의 가격은 자동 계산하지 않았습니다.'] : !pricing?.calculation ? ['옵션 가격 계산을 확인해주세요.'] : [] };
      }
      case 'quantity': return literal(option?.unitsPerPack, 'option');
      case 'weight': {
        // Only the observed 80719 product weight; never packaging or per-item weight.
        if (schema.categoryId !== '80719') return literal('', 'empty');
        if (option?.weightKg === null && option.provenance.weightKg === 'manual') return { value: '', source: 'option' };
        return literal(option?.weightKg == null ? '' : `${option.weightKg} kg`, 'option');
      }
      case 'color': case 'brace_noticeColor': case 'marathon_noticeColor': return option?.provenance.color === 'manual'
        ? { value: option.color ?? '', source: 'option' } : literal(option?.color, 'option');
      case 'size': case 'marathon_noticeSize':
        if (option?.size || option?.provenance.size === 'manual') return { value: option.size ?? '', source: 'option' };
        // 81452 expects a purchasing size (S/Medium/Free), not physical dimensions.
        if (schema.categoryId === '81452' || schema.categoryId === '103495') return literal('', 'empty');
        return dimensions(option);
      case 'noticeMaterial': return contentValue(content.label.material);
      case 'mainImage': {
        const selected = images(quotationMainImageKeys(option, content.assets.main.value));
        return { ...selected, source: selected.value && option?.imageKey ? 'option' : selected.source };
      }
      case 'additionalImages': return images(content.assets.additional.value);
      case 'labelImages': return images(content.assets.label.value);
      case 'detailImages': return images(contentDetailImageKeys(content));
      case 'detailHtml': return literal(content.seo.description.value ? `<p>${htmlEscape(content.seo.description.value).replace(/\r?\n/g, '<br>')}</p>` : '', 'content');
      case 'altText': return { value: title, source: titleSource };
      case 'noticeNameModel': {
        const value = [...new Set([savedTextOrFallback(content.label.productName, title), content.label.model.value].filter(Boolean))].join(' / ');
        return content.label.productName.provenance === 'manual' || content.label.model.provenance === 'manual' ? { value, source: 'content' } : literal(value, 'content');
      }
      case 'noticeDimensions': return dimensions(option);
      // This notice contains product size/weight, not the option's packaging dimensions.
      case 'brace_noticeSizeWeight': return contentValue(content.label.dimensions);
      case 'noticeManufacturerImporter': {
        const manufacturer = savedTextOrFallback(content.label.manufacturer, settings.manufacturer); const importer = savedTextOrFallback(content.label.importer, settings.importer);
        const value = [manufacturer && `제조자: ${manufacturer}`, importer && `수입자: ${importer}`].filter(Boolean).join(' / ');
        return { value, source: (content.label.manufacturer.value && content.label.importer.value) || content.label.manufacturer.provenance === 'manual' || content.label.importer.provenance === 'manual' ? 'content' : value ? 'settings' : 'empty' };
      }
      case 'noticeCountryOfOrigin': return contentValue(content.label.countryOfOrigin);
      case 'marathon_noticeKind': return contentValue(content.label.productType ?? { value: '', provenance: 'unverified', updatedAt: null });
      case 'marathon_noticeCaution': return contentValue(content.label.precautions);
      case 'noticePermission': return contentValue(content.label.certification);
      case 'brace_noticeKc': return contentValue(content.label.kcInformation ?? { value: '', provenance: 'unverified', updatedAt: null });
      case 'noticeComponents': return contentValue(content.label.components ?? { value: '', provenance: 'unverified', updatedAt: null });
      case 'noticeReleaseDate': return contentValue(content.label.releaseDate ?? { value: '', provenance: 'unverified', updatedAt: null });
      case 'noticeQualityAssurance': return contentValue(content.label.qualityAssurance);
      case 'noticeServiceContact': return contentValue(content.label.contact, settings.serviceContact);
      case 'packagedWeightG': return option?.provenance.packagedWeightG === 'manual' ? { value: option.packagedWeightG == null ? '' : String(option.packagedWeightG), source: 'option' } : literal(option?.packagedWeightG, 'option');
      case 'packagedDimensionsMm': {
        const dimensions = [option?.packagedWidthMm, option?.packagedLengthMm, option?.packagedHeightMm];
        if (dimensions.every(value => value != null)) return literal(dimensions.join('*'), 'option');
        const entered = dimensions.some(value => value != null);
        const cleared = option && (['packagedWidthMm','packagedLengthMm','packagedHeightMm'] as const).some(key => option.provenance[key] === 'manual');
        return { value: '', source: entered || cleared ? 'option' : 'empty', issues: entered ? ['포장 가로·세로·높이를 모두 입력해주세요(mm).'] : [] };
      }
      case 'boxSkuQuantity': return literal(settings.boxSkuQuantity, 'settings');
      // Certification applicability, country, packaging measurements, barcode,
      // and attribute values never come from category names or blanket defaults.
      default: return literal('', 'empty');
    }
  }
  const rows = [null, ...options].map((option): ResolvedQuotationRow => {
    const optionId = option?.id ?? null;
    const specific = optionId !== null && Object.hasOwn(overrides.options, optionId) ? overrides.options[optionId] : undefined;
    const fields = Object.fromEntries(schema.fields.map(definition => {
      let automatic = auto(definition, option);
      const preset = couplusQuotationDefault(schema.categoryId, definition);
      if (automatic.source === 'empty' && preset !== undefined) automatic = {
        value: preset, source: 'couplus-default',
        issues: [],
      };
      const manualOption = !definition.readOnly && specific && Object.hasOwn(specific, definition.id);
      const manualCommon = !definition.readOnly && Object.hasOwn(overrides.common, definition.id);
      const value = manualOption ? specific![definition.id] : manualCommon ? overrides.common[definition.id] : automatic.value;
      const source: QuotationSource = manualOption ? 'manual-option' : manualCommon ? 'manual-common' : automatic.source;
      const validationIssues = [...quotationValueIssues(definition, value, ownedKeys), ...(!manualOption && !manualCommon ? automatic.issues ?? [] : [])];
      const reviewMessages: string[] = [];
      if (source === 'couplus-default') reviewMessages.push('쿠플러스 참조 화면의 양식 기본값입니다. 실제 상품의 해당 여부를 확인해주세요.');
      if (definition.reviewRequired && (value.trim() || hasSelectedEmptyQuotationChoice(definition, { value, source }))) reviewMessages.push('실제 상품·증빙과 일치하는지 확인해주세요.');
      if (definition.type === 'images' && value) validationIssues.push('비공개 이미지 참조입니다. 외부 접수용 공개 주소는 아직 생성되지 않았습니다.');
      const fieldIssues = [...validationIssues, ...reviewMessages];
      return [definition.id, { value, source, needsReview: Boolean(definition.reviewRequired) || fieldIssues.length > 0, issues: fieldIssues, validationIssues, reviewMessages } satisfies ResolvedQuotationField];
    }));
    if (fields.barcodeMode.value === 'existing' && !fields.barcode.value.trim()) { fields.barcode.needsReview = true; fields.barcode.issues.push('실제 바코드 번호를 입력해주세요.'); fields.barcode.validationIssues!.push('실제 바코드 번호를 입력해주세요.'); }
    const barcodeIssues = quotationBarcodeIssues(schema.categoryId, fields.barcodeMode.value, fields.barcode.value);
    if (barcodeIssues.length) { fields.barcode.needsReview = true; fields.barcode.issues.push(...barcodeIssues); fields.barcode.validationIssues!.push(...barcodeIssues); }
    if (fields.barcodeMode.value === 'request-coupang' && fields.barcode.value.trim()) { fields.barcode.needsReview = true; fields.barcode.issues.push('바코드 생성 요청 방식과 입력된 번호가 충돌합니다.'); fields.barcode.validationIssues!.push('바코드 생성 요청 방식과 입력된 번호가 충돌합니다.'); }
    const priceIssues = quotationPriceIssues(schema, fields.supplyPrice.value, fields.salePrice.value);
    if (priceIssues.length) { fields.salePrice.needsReview = true; fields.salePrice.issues.push(...priceIssues); fields.salePrice.validationIssues!.push(...priceIssues); }
    const imageIssues = quotationImageRoleIssues(fields.mainImage?.value ?? '', fields.detailImages?.value ?? '');
    if (imageIssues.length && fields.detailImages) { fields.detailImages.needsReview = true; fields.detailImages.issues.push(...imageIssues); }
    return { optionId, optionLabel: option ? option.translatedName || option.originalName || option.supplierSku || option.id : '상품 공통값', included: option ? option.included : includeCommonRow, fields };
  });
  return { schema, rows, issues, customLabels: (content.customLabels ?? []).map(label => ({ ...label })) };
}
