import type { QuotationField } from '@/app/quotation-schema';

// Couplus saved quotation 260921009001, observed 2026-09-24.
// Saved product values are not evidence of category-wide automatic defaults.
// Product Page choices and required exposed fields verified in Supplier Hub 2026-09-24.
export const couplus64497Path = ['생활용품', '욕실용품', '욕실수납/정리', '양치용품정리'];
export const couplus64497Attributes = [
  {
    "label": "휴지걸이 형태",
    "choices": [
      "해당사항없음",
      "휴지걸이",
      "화장지/점보롤케이스"
    ],
    "id": "tooth_paperHolderType"
  },
  {
    "label": "뚜껑 포함여부",
    "choices": [
      "해당사항없음",
      "뚜껑포함"
    ],
    "id": "tooth_lidIncluded"
  },
  {
    "label": "컵 재질",
    "choices": [
      "해당사항없음",
      "도자기",
      "유리",
      "크리스탈",
      "실리콘",
      "플라스틱/아크릴",
      "스테인리스",
      "법랑",
      "우드",
      "주석",
      "유기",
      "양은",
      "트라이탄"
    ],
    "id": "tooth_cupMaterial"
  },
  {
    "label": "욕실수납용품 재질",
    "choices": [
      "해당사항없음",
      "플라스틱",
      "스테인리스",
      "원목",
      "유리",
      "철재",
      "규조토",
      "실리콘",
      "스펀지",
      "세라믹/도자기",
      "합성고무"
    ],
    "id": "tooth_bathroomMaterial"
  },
  {
    "label": "욕실선반 형태",
    "choices": [
      "해당사항없음",
      "코너/모서리선반",
      "사각선반",
      "일자선반"
    ],
    "id": "tooth_shelfShape"
  },
  {
    "label": "욕실용품 설치방법",
    "choices": [
      "해당사항없음",
      "부착형",
      "벽면설치형",
      "비치형",
      "걸이형",
      "자석형",
      "고정형",
      "흡착형"
    ],
    "id": "tooth_installation"
  },
  {
    "label": "수납/정리용품 재질",
    "choices": [
      "해당사항없음",
      "플라스틱",
      "패브릭",
      "부직포",
      "PVC",
      "라탄",
      "원목/우드",
      "강철/철제",
      "스테인리스",
      "아크릴",
      "ABS",
      "고무",
      "폴리프로필렌(PP)",
      "폴리에스터(PE)",
      "벨벳",
      "종이"
    ],
    "id": "tooth_storageMaterial"
  },
  {
    "label": "가로길이",
    "choices": [],
    "id": "tooth_width"
  },
  {
    "label": "손잡이 포함여부",
    "choices": [
      "해당사항없음",
      "손잡이 포함",
      "미포함"
    ],
    "id": "tooth_handleIncluded"
  },
  {
    "label": "투명창여부",
    "choices": [
      "해당사항없음",
      "투명창"
    ],
    "id": "tooth_transparentWindow"
  },
  {
    "label": "물빠짐여부",
    "choices": [
      "해당사항없음",
      "가능"
    ],
    "id": "tooth_drainage"
  },
  {
    "label": "거울 유무",
    "choices": [
      "해당사항없음",
      "거울 있음",
      "거울 없음"
    ],
    "id": "tooth_mirror"
  },
  {
    "label": "세트여부",
    "choices": [
      "해당사항없음",
      "세트",
      "단품"
    ],
    "id": "tooth_set"
  },
  {
    "label": "바퀴 유무",
    "choices": [
      "해당사항없음",
      "바퀴있음",
      "바퀴없음"
    ],
    "id": "tooth_wheels"
  },
  {
    "label": "색상계열",
    "choices": [
      "해당사항없음",
      "블랙계열",
      "네이비계열",
      "그레이계열",
      "실버계열",
      "레드계열",
      "오렌지계열",
      "옐로우계열",
      "그린계열",
      "블루계열",
      "바이올렛/보라계열",
      "핑크계열",
      "화이트계열",
      "브라운계열",
      "골드계열",
      "베이지계열",
      "멀티(혼합)컬러",
      "투명계열",
      "아이보리 계열"
    ],
    "id": "tooth_colorFamily"
  },
  {
    "label": "높이",
    "choices": [],
    "id": "tooth_height"
  },
  {
    "label": "자석 부착가능 여부",
    "choices": [
      "해당사항없음",
      "자석부착가능"
    ],
    "id": "tooth_magnetic"
  },
  {
    "label": "단 수",
    "choices": [],
    "id": "tooth_levels"
  },
  {
    "label": "최소 연령",
    "choices": [],
    "id": "tooth_minAge"
  },
  {
    "label": "최대 연령",
    "choices": [],
    "id": "tooth_maxAge"
  },
  {
    "label": "타공 여부",
    "choices": [
      "해당사항없음",
      "무타공",
      "타공"
    ],
    "id": "tooth_drilling"
  },
  {
    "label": "선반 용도",
    "choices": [
      "해당사항없음",
      "다용도",
      "주방용",
      "욕실용"
    ],
    "id": "tooth_shelfUse"
  },
  {
    "label": "슬라이딩 여부",
    "choices": [
      "해당사항없음",
      "슬라이딩"
    ],
    "id": "tooth_sliding"
  },
  {
    "label": "칫솔 수납 개수",
    "choices": [],
    "id": "tooth_toothbrushCount"
  },
  {
    "label": "마감 유형",
    "choices": [
      "해당사항없음",
      "브러쉬 처리",
      "래커 처리",
      "오일 마감",
      "도장",
      "광택 처리",
      "분체 도장",
      "무광택",
      "고광택",
      "고민 처리",
      "광택 처리되지 않음",
      "글로시",
      "매트",
      "미완성",
      "반광택",
      "반무광",
      "반짝임",
      "새틴",
      "쉬머리",
      "쉬어",
      "페인트 처리"
    ],
    "id": "tooth_finishType"
  },
  {
    "label": "항목 너비가 짧은 가장자리",
    "choices": [],
    "id": "tooth_shortEdge"
  },
  {
    "label": "포함 구성 요소",
    "choices": [
      "해당사항없음",
      "갓",
      "나사",
      "리모콘",
      "반사판",
      "배터리",
      "본품",
      "설명서",
      "스탠드",
      "어댑터",
      "전구",
      "전원 케이블",
      "조광기",
      "콘센트",
      "해당없음",
      "On-Off 스위치",
      "USB포트",
      "어플리케이터 브러시",
      "주걱",
      "추출 도구"
    ],
    "id": "tooth_components"
  },
  {
    "label": "상품 재질",
    "choices": [
      "해당사항없음",
      "가공 목재",
      "가죽",
      "고무",
      "구리",
      "금속",
      "니켈",
      "대나무",
      "대리석",
      "세라믹",
      "등나무",
      "로즈우드",
      "린넨",
      "망고 나무",
      "면",
      "목재",
      "붕규산 유리",
      "비닐",
      "석재",
      "수지",
      "쉘",
      "스테인레스 스틸",
      "실리콘",
      "실크",
      "아연",
      "아카시아",
      "아크릴",
      "아크릴로니트릴 부타디엔 스티렌 (ABS)",
      "알루미늄",
      "연철",
      "유리",
      "인조 가죽",
      "인조 목재",
      "종이",
      "주철",
      "참피나무",
      "철",
      "청동",
      "콘크리트",
      "크리스탈",
      "탄소강",
      "폴리스티렌",
      "폴리에스테르",
      "폴리에틸렌",
      "폴리에틸렌 테레프탈레이트 (PET)",
      "폴리염화비닐",
      "폴리카보네이트",
      "폴리프로필렌",
      "플라스틱",
      "합금강",
      "황동",
      "해당없음",
      "고탄소강",
      "공작석",
      "극세사",
      "금",
      "껍질",
      "나일론",
      "남옥",
      "너도밤나무",
      "도자기",
      "라인스톤",
      "마노",
      "말털",
      "망간강",
      "모가나이트",
      "모슬린",
      "밀짚",
      "밍크 모피",
      "백단",
      "백랍",
      "벽옥",
      "보석",
      "뿔",
      "석영",
      "소나무",
      "소달라이트",
      "스털링 실버",
      "스테인레스강",
      "스톤",
      "실버",
      "아마조나이트",
      "아크릴로니트릴 부타디엔 스티렌",
      "양모",
      "에틸렌 비닐 아세테이트",
      "에폭시 수지",
      "열가소성 엘라스토머",
      "열가소성 폴리우레탄",
      "오닉스",
      "올리브 우드",
      "용암",
      "유리 섬유",
      "유리 충전 나일론",
      "인모",
      "인조 밍크",
      "인조 실크",
      "자수정",
      "적철광",
      "전기석",
      "점토",
      "진주",
      "카드지",
      "큐빅 지르코니아",
      "크롬-바나듐강",
      "타이거 아이",
      "탄소 섬유",
      "터키석",
      "티타늄",
      "포금",
      "폴리부틸렌 테레프탈레이트 섬유",
      "폴리비닐아세테이트(PVA)",
      "폴리에스터",
      "폴리에틸렌 테레프탈레이트",
      "폴리에틸렌(PE)",
      "폴리염화비닐(PVC)",
      "폴리우레탄",
      "폴리우레탄 폼",
      "하울라이트",
      "합성모",
      "헬리오트로프",
      "호두",
      "호박색",
      "흑단",
      "UV 수지"
    ],
    "id": "tooth_material"
  },
  {
    "label": "항목 길이가 더 긴 가장자리",
    "choices": [],
    "id": "tooth_longEdge"
  },
  {
    "label": "품목 모양",
    "choices": [
      "해당사항없음",
      "광장형",
      "꽃잎형",
      "나비형",
      "다이아몬드형",
      "물방울형",
      "라운드",
      "물결 모양",
      "반원형",
      "배럴형",
      "빗형",
      "사각형",
      "삼각형",
      "스타형",
      "하트형",
      "애플형",
      "연필형",
      "오각형",
      "원형",
      "육각형",
      "지팡이형",
      "직사각형",
      "직선형",
      "클라우드형",
      "타원형",
      "팔각형",
      "플랫형",
      "해당없음",
      "햇살형",
      "X형",
      "고양이 모양",
      "관 모양",
      "눈송이형",
      "돔형",
      "드럼 모양",
      "드롭형",
      "립스틱 모양",
      "발 모양",
      "발레리나 모양",
      "버섯 모양",
      "불규칙형",
      "산봉우리형",
      "뾰족구두 모양",
      "아몬드형",
      "원뿔형",
      "잎 모양",
      "정사각형",
      "타워형",
      "불꽃 모양",
      "해파리 모양",
      "화살촉형",
      "활 모양",
      "꽃 모양",
      "벨 모양",
      "스틸레토",
      "파우치",
      "토끼 모양"
    ],
    "id": "tooth_shape"
  },
  {
    "label": "Global Trade Item Number",
    "choices": [],
    "id": "tooth_gtin"
  },
  {
    "label": "Parent Manufacturer Part Number",
    "choices": [],
    "id": "tooth_parentPart"
  },
  {
    "label": "Manufacturer Part Number",
    "choices": [],
    "id": "tooth_part"
  }
] as const;
const make = (id: string, label: string, section: QuotationField['section'], visibility: QuotationField['visibility']): QuotationField => ({
  id, label, section, visibility, type: 'text', required: false, reviewRequired: true, maxLength: 2000,
  help: '쿠플러스와 Supplier Hub 상품정보에서 대조한 항목입니다. 해당사항없음 선택값은 빈 문자열입니다.',
});
export const couplus64497Fields: QuotationField[] = [
  ...[['color', '색상'], ['quantity', '수량']].map(([id,label]) => make(id,label,'product','exposed')),
  ...couplus64497Attributes.map(item => ({ ...make(item.id,item.label,'product','hidden'),
    ...(item.choices.length ? { type: 'select' as const, choices: item.choices.map(value => ({value: value === '해당사항없음' ? '' : value,label:value})) } : {}),
  })),
  ...[['noticeNameModel','품명 및 모델명'],['noticePermission','인증/허가 사항'],
    ['noticeCountryOfOrigin','제조국(원산지)'],['noticeManufacturerImporter','제조자(수입자)'],
    ['noticeServiceContact','소비자상담 관련 전화번호']].map(([id,label]) => ({
      ...make(id,label,'legal','common'), required:true,
      help: '쿠플러스에서 이 분류의 상품고시 미입력으로 등록 실패한 사례를 확인했습니다. 실제 상품·증빙에 맞게 작성해주세요. 인증 미확인을 해당없음으로 자동 채우지 않습니다.',
    })),
];

