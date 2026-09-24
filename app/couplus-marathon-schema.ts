import type { QuotationField } from '@/app/quotation-schema';

// Read from saved Couplus quotation 260921006001 on 2026-09-24.
// Saved item values are not category defaults. Official Hub comparison is pending.
export const couplus103495Path = ['스포츠/레져', '기타스포츠', '육상/체조', '마라톤가방'];
export const couplus103495Fields: QuotationField[] = [
  {
    "id": "color",
    "section": "product",
    "label": "색상",
    "type": "text",
    "required": false,
    "visibility": "exposed",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 블랙(색상), 레드(색상), 네온(색상), 그레이(색상), 무지(색상), 로고(패턴), 반사광(패턴), 매쉬(패턴)"
  },
  {
    "id": "quantity",
    "section": "product",
    "label": "수량",
    "type": "text",
    "required": false,
    "visibility": "exposed",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 1개, 2개, 3개, 1세트, 1박스"
  },
  {
    "id": "size",
    "section": "product",
    "label": "사이즈",
    "type": "text",
    "required": false,
    "visibility": "exposed",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: S, Medium, Free, 대, one size 등"
  },
  {
    "id": "marathon_sockLength",
    "section": "product",
    "label": "양말 길이",
    "type": "select",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 발가락 양말, 덧신, 발목 길이, 종아리 길이, 무릎 길이",
    "choices": [
      {
        "value": "해당사항없음",
        "label": "해당사항없음"
      },
      {
        "value": "발목 길이",
        "label": "발목 길이"
      },
      {
        "value": "무릎 길이",
        "label": "무릎 길이"
      },
      {
        "value": "종아리 길이",
        "label": "종아리 길이"
      },
      {
        "value": "발가락 양말",
        "label": "발가락 양말"
      },
      {
        "value": "덧신",
        "label": "덧신"
      }
    ]
  },
  {
    "id": "marathon_totalQuantity",
    "section": "product",
    "label": "총 수량",
    "type": "text",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 10개입, 2팩, 3박스 등"
  },
  {
    "id": "marathon_modelNumber",
    "section": "product",
    "label": "모델명/품번",
    "type": "text",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 154834-541, SJ157-75, BJFK34123(15)"
  },
  {
    "id": "marathon_colorFamily",
    "section": "product",
    "label": "패션 의류/잡화 색상계열",
    "type": "select",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 블랙계열, 그레이계열, 골드계열, 멀티(혼합)컬러, 투명 등",
    "choices": [
      {
        "value": "해당사항없음",
        "label": "해당사항없음"
      },
      {
        "value": "네이비계열",
        "label": "네이비계열"
      },
      {
        "value": "레드계열",
        "label": "레드계열"
      },
      {
        "value": "오렌지계열",
        "label": "오렌지계열"
      },
      {
        "value": "옐로우계열",
        "label": "옐로우계열"
      },
      {
        "value": "그린계열",
        "label": "그린계열"
      },
      {
        "value": "블루계열",
        "label": "블루계열"
      },
      {
        "value": "바이올렛/보라계열",
        "label": "바이올렛/보라계열"
      },
      {
        "value": "핑크계열",
        "label": "핑크계열"
      },
      {
        "value": "화이트계열",
        "label": "화이트계열"
      },
      {
        "value": "베이지계열",
        "label": "베이지계열"
      },
      {
        "value": "멀티(혼합)컬러",
        "label": "멀티(혼합)컬러"
      },
      {
        "value": "블랙계열",
        "label": "블랙계열"
      },
      {
        "value": "브라운계열",
        "label": "브라운계열"
      },
      {
        "value": "그레이계열",
        "label": "그레이계열"
      },
      {
        "value": "실버계열",
        "label": "실버계열"
      },
      {
        "value": "골드계열",
        "label": "골드계열"
      },
      {
        "value": "투명",
        "label": "투명"
      }
    ]
  },
  {
    "id": "marathon_user",
    "section": "product",
    "label": "사용대상 구분",
    "type": "select",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 남성용, 여성용, 남녀공용, 아동/유아용",
    "choices": [
      {
        "value": "해당사항없음",
        "label": "해당사항없음"
      },
      {
        "value": "남성용",
        "label": "남성용"
      },
      {
        "value": "여성용",
        "label": "여성용"
      },
      {
        "value": "남녀공용",
        "label": "남녀공용"
      },
      {
        "value": "아동/유아용",
        "label": "아동/유아용"
      },
      {
        "value": "시니어 남성용",
        "label": "시니어 남성용"
      },
      {
        "value": "시니어 여성용",
        "label": "시니어 여성용"
      },
      {
        "value": "시니어 남녀공용",
        "label": "시니어 남녀공용"
      }
    ]
  },
  {
    "id": "marathon_waterproof",
    "section": "product",
    "label": "방수 가능여부",
    "type": "select",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 방수가능",
    "choices": [
      {
        "value": "해당사항없음",
        "label": "해당사항없음"
      },
      {
        "value": "방수가능",
        "label": "방수가능"
      }
    ]
  },
  {
    "id": "marathon_length",
    "section": "product",
    "label": "길이",
    "type": "text",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 50cm, 60m 등"
  },
  {
    "id": "marathon_fastener",
    "section": "product",
    "label": "잠금/고정방식",
    "type": "select",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 지퍼형, 자석형, 벨크로형, 밴드형, 똑딱이형, 끈 조임형, 잠금장치없음",
    "choices": [
      {
        "value": "해당사항없음",
        "label": "해당사항없음"
      },
      {
        "value": "지퍼형",
        "label": "지퍼형"
      },
      {
        "value": "자석형",
        "label": "자석형"
      },
      {
        "value": "벨크로형",
        "label": "벨크로형"
      },
      {
        "value": "똑딱이형",
        "label": "똑딱이형"
      },
      {
        "value": "끈 조임형",
        "label": "끈 조임형"
      },
      {
        "value": "잠금장치없음",
        "label": "잠금장치없음"
      },
      {
        "value": "밴드형",
        "label": "밴드형"
      }
    ]
  },
  {
    "id": "marathon_washing",
    "section": "product",
    "label": "세탁방법",
    "type": "select",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 손세탁권장, 세탁기사용가능, 드라이클리닝, 세탁불가",
    "choices": [
      {
        "value": "해당사항없음",
        "label": "해당사항없음"
      },
      {
        "value": "손세탁권장",
        "label": "손세탁권장"
      },
      {
        "value": "세탁기사용가능",
        "label": "세탁기사용가능"
      },
      {
        "value": "드라이클리닝",
        "label": "드라이클리닝"
      },
      {
        "value": "세탁불가",
        "label": "세탁불가"
      }
    ]
  },
  {
    "id": "marathon_sockUse",
    "section": "product",
    "label": "양말 용도",
    "type": "select",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 일반\\r\\n수면용\\r\\n스포츠/등산용",
    "choices": [
      {
        "value": "해당사항없음",
        "label": "해당사항없음"
      },
      {
        "value": "일반",
        "label": "일반"
      },
      {
        "value": "수면용",
        "label": "수면용"
      },
      {
        "value": "스포츠/등산용",
        "label": "스포츠/등산용"
      }
    ]
  },
  {
    "id": "marathon_waterproofGrade",
    "section": "product",
    "label": "방수 등급",
    "type": "text",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 생활방수(IPX 4등급), IPX5"
  },
  {
    "id": "marathon_depth",
    "section": "product",
    "label": "아이템 깊이",
    "type": "text",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 40cm, 50cm, 60cm"
  },
  {
    "id": "marathon_shortEdge",
    "section": "product",
    "label": "항목 너비가 짧은 가장자리",
    "type": "text",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 60cm, 80cm, 120cm"
  },
  {
    "id": "marathon_components",
    "section": "product",
    "label": "포함 구성 요소",
    "type": "select",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 본체, 리모컨, 사용설명서",
    "choices": [
      {
        "value": "해당사항없음",
        "label": "해당사항없음"
      },
      {
        "value": "갓",
        "label": "갓"
      },
      {
        "value": "나사",
        "label": "나사"
      },
      {
        "value": "리모콘",
        "label": "리모콘"
      },
      {
        "value": "반사판",
        "label": "반사판"
      },
      {
        "value": "배터리",
        "label": "배터리"
      },
      {
        "value": "본품",
        "label": "본품"
      },
      {
        "value": "설명서",
        "label": "설명서"
      },
      {
        "value": "스탠드",
        "label": "스탠드"
      },
      {
        "value": "어댑터",
        "label": "어댑터"
      },
      {
        "value": "전구",
        "label": "전구"
      },
      {
        "value": "전원 케이블",
        "label": "전원 케이블"
      },
      {
        "value": "조광기",
        "label": "조광기"
      },
      {
        "value": "콘센트",
        "label": "콘센트"
      },
      {
        "value": "해당없음",
        "label": "해당없음"
      },
      {
        "value": "On-Off 스위치",
        "label": "On-Off 스위치"
      },
      {
        "value": "USB포트",
        "label": "USB포트"
      },
      {
        "value": "어플리케이터 브러시",
        "label": "어플리케이터 브러시"
      },
      {
        "value": "주걱",
        "label": "주걱"
      },
      {
        "value": "추출 도구",
        "label": "추출 도구"
      }
    ]
  },
  {
    "id": "marathon_material",
    "section": "product",
    "label": "상품 재질",
    "type": "select",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 쉘, 종이, 점토, 탄소 섬유, 금속, 린넨, 알루미늄, 철, 청동, 폴리염화비닐",
    "choices": [
      {
        "value": "해당사항없음",
        "label": "해당사항없음"
      },
      {
        "value": "가공 목재",
        "label": "가공 목재"
      },
      {
        "value": "가죽",
        "label": "가죽"
      },
      {
        "value": "고무",
        "label": "고무"
      },
      {
        "value": "구리",
        "label": "구리"
      },
      {
        "value": "금속",
        "label": "금속"
      },
      {
        "value": "니켈",
        "label": "니켈"
      },
      {
        "value": "대나무",
        "label": "대나무"
      },
      {
        "value": "대리석",
        "label": "대리석"
      },
      {
        "value": "세라믹",
        "label": "세라믹"
      },
      {
        "value": "등나무",
        "label": "등나무"
      },
      {
        "value": "로즈우드",
        "label": "로즈우드"
      },
      {
        "value": "린넨",
        "label": "린넨"
      },
      {
        "value": "망고 나무",
        "label": "망고 나무"
      },
      {
        "value": "면",
        "label": "면"
      },
      {
        "value": "목재",
        "label": "목재"
      },
      {
        "value": "붕규산 유리",
        "label": "붕규산 유리"
      },
      {
        "value": "비닐",
        "label": "비닐"
      },
      {
        "value": "석재",
        "label": "석재"
      },
      {
        "value": "수지",
        "label": "수지"
      },
      {
        "value": "쉘",
        "label": "쉘"
      },
      {
        "value": "스테인레스 스틸",
        "label": "스테인레스 스틸"
      },
      {
        "value": "실리콘",
        "label": "실리콘"
      },
      {
        "value": "실크",
        "label": "실크"
      },
      {
        "value": "아연",
        "label": "아연"
      },
      {
        "value": "아카시아",
        "label": "아카시아"
      },
      {
        "value": "아크릴",
        "label": "아크릴"
      },
      {
        "value": "아크릴로니트릴 부타디엔 스티렌 (ABS)",
        "label": "아크릴로니트릴 부타디엔 스티렌 (ABS)"
      },
      {
        "value": "알루미늄",
        "label": "알루미늄"
      },
      {
        "value": "연철",
        "label": "연철"
      },
      {
        "value": "유리",
        "label": "유리"
      },
      {
        "value": "인조 가죽",
        "label": "인조 가죽"
      },
      {
        "value": "인조 목재",
        "label": "인조 목재"
      },
      {
        "value": "종이",
        "label": "종이"
      },
      {
        "value": "주철",
        "label": "주철"
      },
      {
        "value": "참피나무",
        "label": "참피나무"
      },
      {
        "value": "철",
        "label": "철"
      },
      {
        "value": "청동",
        "label": "청동"
      },
      {
        "value": "콘크리트",
        "label": "콘크리트"
      },
      {
        "value": "크리스탈",
        "label": "크리스탈"
      },
      {
        "value": "탄소강",
        "label": "탄소강"
      },
      {
        "value": "폴리스티렌",
        "label": "폴리스티렌"
      },
      {
        "value": "폴리에스테르",
        "label": "폴리에스테르"
      },
      {
        "value": "폴리에틸렌",
        "label": "폴리에틸렌"
      },
      {
        "value": "폴리에틸렌 테레프탈레이트 (PET)",
        "label": "폴리에틸렌 테레프탈레이트 (PET)"
      },
      {
        "value": "폴리염화비닐",
        "label": "폴리염화비닐"
      },
      {
        "value": "폴리카보네이트",
        "label": "폴리카보네이트"
      },
      {
        "value": "폴리프로필렌",
        "label": "폴리프로필렌"
      },
      {
        "value": "플라스틱",
        "label": "플라스틱"
      },
      {
        "value": "합금강",
        "label": "합금강"
      },
      {
        "value": "황동",
        "label": "황동"
      },
      {
        "value": "해당없음",
        "label": "해당없음"
      },
      {
        "value": "고탄소강",
        "label": "고탄소강"
      },
      {
        "value": "공작석",
        "label": "공작석"
      },
      {
        "value": "극세사",
        "label": "극세사"
      },
      {
        "value": "금",
        "label": "금"
      },
      {
        "value": "껍질",
        "label": "껍질"
      },
      {
        "value": "나일론",
        "label": "나일론"
      },
      {
        "value": "남옥",
        "label": "남옥"
      },
      {
        "value": "너도밤나무",
        "label": "너도밤나무"
      },
      {
        "value": "도자기",
        "label": "도자기"
      },
      {
        "value": "라인스톤",
        "label": "라인스톤"
      },
      {
        "value": "마노",
        "label": "마노"
      },
      {
        "value": "말털",
        "label": "말털"
      },
      {
        "value": "망간강",
        "label": "망간강"
      },
      {
        "value": "모가나이트",
        "label": "모가나이트"
      },
      {
        "value": "모슬린",
        "label": "모슬린"
      },
      {
        "value": "밀짚",
        "label": "밀짚"
      },
      {
        "value": "밍크 모피",
        "label": "밍크 모피"
      },
      {
        "value": "백단",
        "label": "백단"
      },
      {
        "value": "백랍",
        "label": "백랍"
      },
      {
        "value": "벽옥",
        "label": "벽옥"
      },
      {
        "value": "보석",
        "label": "보석"
      },
      {
        "value": "뿔",
        "label": "뿔"
      },
      {
        "value": "석영",
        "label": "석영"
      },
      {
        "value": "소나무",
        "label": "소나무"
      },
      {
        "value": "소달라이트",
        "label": "소달라이트"
      },
      {
        "value": "스털링 실버",
        "label": "스털링 실버"
      },
      {
        "value": "스테인레스강",
        "label": "스테인레스강"
      },
      {
        "value": "스톤",
        "label": "스톤"
      },
      {
        "value": "실버",
        "label": "실버"
      },
      {
        "value": "아마조나이트",
        "label": "아마조나이트"
      },
      {
        "value": "아크릴로니트릴 부타디엔 스티렌",
        "label": "아크릴로니트릴 부타디엔 스티렌"
      },
      {
        "value": "양모",
        "label": "양모"
      },
      {
        "value": "에틸렌 비닐 아세테이트",
        "label": "에틸렌 비닐 아세테이트"
      },
      {
        "value": "에폭시 수지",
        "label": "에폭시 수지"
      },
      {
        "value": "열가소성 엘라스토머",
        "label": "열가소성 엘라스토머"
      },
      {
        "value": "열가소성 폴리우레탄",
        "label": "열가소성 폴리우레탄"
      },
      {
        "value": "오닉스",
        "label": "오닉스"
      },
      {
        "value": "올리브 우드",
        "label": "올리브 우드"
      },
      {
        "value": "용암",
        "label": "용암"
      },
      {
        "value": "유리 섬유",
        "label": "유리 섬유"
      },
      {
        "value": "유리 충전 나일론",
        "label": "유리 충전 나일론"
      },
      {
        "value": "인모",
        "label": "인모"
      },
      {
        "value": "인조 밍크",
        "label": "인조 밍크"
      },
      {
        "value": "인조 실크",
        "label": "인조 실크"
      },
      {
        "value": "자수정",
        "label": "자수정"
      },
      {
        "value": "적철광",
        "label": "적철광"
      },
      {
        "value": "전기석",
        "label": "전기석"
      },
      {
        "value": "점토",
        "label": "점토"
      },
      {
        "value": "진주",
        "label": "진주"
      },
      {
        "value": "카드지",
        "label": "카드지"
      },
      {
        "value": "큐빅 지르코니아",
        "label": "큐빅 지르코니아"
      },
      {
        "value": "크롬-바나듐강",
        "label": "크롬-바나듐강"
      },
      {
        "value": "타이거 아이",
        "label": "타이거 아이"
      },
      {
        "value": "탄소 섬유",
        "label": "탄소 섬유"
      },
      {
        "value": "터키석",
        "label": "터키석"
      },
      {
        "value": "티타늄",
        "label": "티타늄"
      },
      {
        "value": "포금",
        "label": "포금"
      },
      {
        "value": "폴리부틸렌 테레프탈레이트 섬유",
        "label": "폴리부틸렌 테레프탈레이트 섬유"
      },
      {
        "value": "폴리비닐아세테이트(PVA)",
        "label": "폴리비닐아세테이트(PVA)"
      },
      {
        "value": "폴리에스터",
        "label": "폴리에스터"
      },
      {
        "value": "폴리에틸렌 테레프탈레이트",
        "label": "폴리에틸렌 테레프탈레이트"
      },
      {
        "value": "폴리에틸렌(PE)",
        "label": "폴리에틸렌(PE)"
      },
      {
        "value": "폴리염화비닐(PVC)",
        "label": "폴리염화비닐(PVC)"
      },
      {
        "value": "폴리우레탄",
        "label": "폴리우레탄"
      },
      {
        "value": "폴리우레탄 폼",
        "label": "폴리우레탄 폼"
      },
      {
        "value": "하울라이트",
        "label": "하울라이트"
      },
      {
        "value": "합성모",
        "label": "합성모"
      },
      {
        "value": "헬리오트로프",
        "label": "헬리오트로프"
      },
      {
        "value": "호두",
        "label": "호두"
      },
      {
        "value": "호박색",
        "label": "호박색"
      },
      {
        "value": "흑단",
        "label": "흑단"
      },
      {
        "value": "UV 수지",
        "label": "UV 수지"
      }
    ]
  },
  {
    "id": "marathon_style",
    "section": "product",
    "label": "스타일",
    "type": "select",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 골동품, 과도기, 글램, 남서부, 농가, 다이아몬드, 디자인, 라틴, 러스틱, 레트로",
    "choices": [
      {
        "value": "해당사항없음",
        "label": "해당사항없음"
      },
      {
        "value": "골동품",
        "label": "골동품"
      },
      {
        "value": "과도기",
        "label": "과도기"
      },
      {
        "value": "​​글램",
        "label": "​​글램"
      },
      {
        "value": "남서부",
        "label": "남서부"
      },
      {
        "value": "농가",
        "label": "농가"
      },
      {
        "value": "다이아몬드",
        "label": "다이아몬드"
      },
      {
        "value": "디자인",
        "label": "디자인"
      },
      {
        "value": "라틴",
        "label": "라틴"
      },
      {
        "value": "러스틱",
        "label": "러스틱"
      },
      {
        "value": "레트로",
        "label": "레트로"
      },
      {
        "value": "롤빵",
        "label": "롤빵"
      },
      {
        "value": "롯지",
        "label": "롯지"
      },
      {
        "value": "모던",
        "label": "모던"
      },
      {
        "value": "모로코",
        "label": "모로코"
      },
      {
        "value": "미국식",
        "label": "미국식"
      },
      {
        "value": "미니멀리스트",
        "label": "미니멀리스트"
      },
      {
        "value": "미드 센추리 모던",
        "label": "미드 센추리 모던"
      },
      {
        "value": "미드 센츄리",
        "label": "미드 센츄리"
      },
      {
        "value": "미션",
        "label": "미션"
      },
      {
        "value": "바로크",
        "label": "바로크"
      },
      {
        "value": "밥",
        "label": "밥"
      },
      {
        "value": "보헤미안",
        "label": "보헤미안"
      },
      {
        "value": "복고풍",
        "label": "복고풍"
      },
      {
        "value": "부타",
        "label": "부타"
      },
      {
        "value": "브레이드",
        "label": "브레이드"
      },
      {
        "value": "빅토리아 시대",
        "label": "빅토리아 시대"
      },
      {
        "value": "빈티지",
        "label": "빈티지"
      },
      {
        "value": "셰비 시크",
        "label": "셰비 시크"
      },
      {
        "value": "셰이커",
        "label": "셰이커"
      },
      {
        "value": "소박한",
        "label": "소박한"
      },
      {
        "value": "숭어",
        "label": "숭어"
      },
      {
        "value": "쉐비 시크",
        "label": "쉐비 시크"
      },
      {
        "value": "스칸디나비아",
        "label": "스칸디나비아"
      },
      {
        "value": "아르 데코",
        "label": "아르 데코"
      },
      {
        "value": "아시안",
        "label": "아시안"
      },
      {
        "value": "아프리카",
        "label": "아프리카"
      },
      {
        "value": "앤티크",
        "label": "앤티크"
      },
      {
        "value": "영어",
        "label": "영어"
      },
      {
        "value": "올드 월드",
        "label": "올드 월드"
      },
      {
        "value": "옴브레",
        "label": "옴브레"
      },
      {
        "value": "웨트 앤 웨이브",
        "label": "웨트 앤 웨이브"
      },
      {
        "value": "유럽",
        "label": "유럽"
      },
      {
        "value": "이집트",
        "label": "이집트"
      },
      {
        "value": "이탈리안",
        "label": "이탈리안"
      },
      {
        "value": "인더스트리얼",
        "label": "인더스트리얼"
      },
      {
        "value": "일본식",
        "label": "일본식"
      },
      {
        "value": "전통",
        "label": "전통"
      },
      {
        "value": "절충주의",
        "label": "절충주의"
      },
      {
        "value": "정원",
        "label": "정원"
      },
      {
        "value": "중국식",
        "label": "중국식"
      },
      {
        "value": "지중해",
        "label": "지중해"
      },
      {
        "value": "캐주얼",
        "label": "캐주얼"
      },
      {
        "value": "컨템포러리",
        "label": "컨템포러리"
      },
      {
        "value": "컨트리 러스틱",
        "label": "컨트리 러스틱"
      },
      {
        "value": "케이프 코드",
        "label": "케이프 코드"
      },
      {
        "value": "코티지",
        "label": "코티지"
      },
      {
        "value": "콜로니얼",
        "label": "콜로니얼"
      },
      {
        "value": "클래식",
        "label": "클래식"
      },
      {
        "value": "트로피컬",
        "label": "트로피컬"
      },
      {
        "value": "포니 테일",
        "label": "포니 테일"
      },
      {
        "value": "프랑스식",
        "label": "프랑스식"
      },
      {
        "value": "픽시 컷",
        "label": "픽시 컷"
      },
      {
        "value": "해상",
        "label": "해상"
      },
      {
        "value": "해안",
        "label": "해안"
      },
      {
        "value": "향취",
        "label": "향취"
      },
      {
        "value": "현대",
        "label": "현대"
      },
      {
        "value": "일반형",
        "label": "일반형"
      },
      {
        "value": "날개형",
        "label": "날개형"
      }
    ]
  },
  {
    "id": "marathon_accuracy",
    "section": "product",
    "label": "측정 정확도",
    "type": "text",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 예: 고정밀, 중정밀, ±0.01mm, ±0.5g, 해당없음"
  },
  {
    "id": "marathon_strap",
    "section": "product",
    "label": "스트랩 종류",
    "type": "text",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 예: 조절 가능 스트랩, 패딩 스트랩, 어깨 스트랩, 가슴 스트랩, 허리 스트랩"
  },
  {
    "id": "marathon_capacity",
    "section": "product",
    "label": "보관 용량",
    "type": "text",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 예: 5L, 10L, 20L, 30L"
  },
  {
    "id": "marathon_sections",
    "section": "product",
    "label": "섹션 수",
    "type": "text",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: 예: 1, 2, 3, 4+"
  },
  {
    "id": "marathon_gtin",
    "section": "product",
    "label": "Global Trade Item Number",
    "type": "text",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "쿠플러스 저장 견적에서 관찰한 항목. 공식 Supplier Hub 규격 대조 필요."
  },
  {
    "id": "marathon_parentPart",
    "section": "product",
    "label": "Parent Manufacturer Part Number",
    "type": "text",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "쿠플러스 저장 견적에서 관찰한 항목. 공식 Supplier Hub 규격 대조 필요."
  },
  {
    "id": "marathon_part",
    "section": "product",
    "label": "Manufacturer Part Number",
    "type": "text",
    "required": false,
    "visibility": "hidden",
    "reviewRequired": true,
    "maxLength": 2000,
    "help": "예시: L1899089001,10337021001,10329021001,NK-B-01"
  }
];
couplus103495Fields.push(...([
 ['marathon_noticeKind','종류'], ['noticeMaterial','소재'], ['marathon_noticeColor','색상'],
 ['marathon_noticeSize','크기'], ['noticeManufacturerImporter','제조자(수입자)'],
 ['noticeCountryOfOrigin','제조국'], ['marathon_noticeCaution','취급시 주의사항'],
 ['noticeQualityAssurance','품질보증기준'], ['noticeServiceContact','A/S 책임자와 전화번호'],
] as const).map(([id,label]): QuotationField => ({id,label,section:'legal',visibility:'common',type:'text',
 required:false,reviewRequired:true,maxLength:2000,help:'쿠플러스 저장 견적에서 확인한 고시 항목입니다. 실제 상품 정보를 사용합니다.'})));


// Supplier Hub Product Page cross-check, 2026-09-24: an empty wire value
// is displayed as 해당사항없음. Preserve historical overrides for explicit review.
for (const field of couplus103495Fields) {
  if (field.type !== 'select' || !field.choices) continue;
  field.choices = [...field.choices.filter(choice => choice.value !== '해당사항없음'), { value: '', label: '해당사항없음' }];
  field.help = 'Supplier Hub 상품정보에서 확인한 선택값입니다. 해당사항없음의 실제 값은 빈 문자열입니다. 이전 문자열 값은 직접 재선택해주세요.';
}
