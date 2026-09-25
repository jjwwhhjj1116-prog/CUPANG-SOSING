// Aggregate UTF-8 JSON request limit; per-field character limits still apply.
export const CATEGORY_PROFILE_BODY_LIMIT = 300_000;
export const CATEGORY_TEMPLATE_FILE_LIMIT = 5_000_000;
export const categoryFields = {
  marathon_sockLength: "마라톤가방: 양말 길이",
  marathon_totalQuantity: "마라톤가방: 총 수량",
  marathon_modelNumber: "마라톤가방: 모델명/품번",
  marathon_colorFamily: "마라톤가방: 패션 의류/잡화 색상계열",
  marathon_user: "마라톤가방: 사용대상 구분",
  marathon_waterproof: "마라톤가방: 방수 가능여부",
  marathon_length: "마라톤가방: 길이",
  marathon_fastener: "마라톤가방: 잠금/고정방식",
  marathon_washing: "마라톤가방: 세탁방법",
  marathon_sockUse: "마라톤가방: 양말 용도",
  marathon_waterproofGrade: "마라톤가방: 방수 등급",
  marathon_depth: "마라톤가방: 아이템 깊이",
  marathon_shortEdge: "마라톤가방: 항목 너비가 짧은 가장자리",
  marathon_components: "마라톤가방: 포함 구성 요소",
  marathon_material: "마라톤가방: 상품 재질",
  marathon_style: "마라톤가방: 스타일",
  marathon_accuracy: "마라톤가방: 측정 정확도",
  marathon_strap: "마라톤가방: 스트랩 종류",
  marathon_capacity: "마라톤가방: 보관 용량",
  marathon_sections: "마라톤가방: 섹션 수",
  marathon_gtin: "마라톤가방: Global Trade Item Number",
  marathon_parentPart: "마라톤가방: Parent Manufacturer Part Number",
  marathon_part: "마라톤가방: Manufacturer Part Number",
  marathon_noticeKind: '마라톤가방 고시: 종류', marathon_noticeColor: '마라톤가방 고시: 색상',
  marathon_noticeSize: '마라톤가방 고시: 크기', marathon_noticeCaution: '마라톤가방 고시: 취급시 주의사항',
  "tooth_paperHolderType": "양치용품정리: 휴지걸이 형태",
  "tooth_lidIncluded": "양치용품정리: 뚜껑 포함여부",
  "tooth_cupMaterial": "양치용품정리: 컵 재질",
  "tooth_bathroomMaterial": "양치용품정리: 욕실수납용품 재질",
  "tooth_shelfShape": "양치용품정리: 욕실선반 형태",
  "tooth_installation": "양치용품정리: 욕실용품 설치방법",
  "tooth_storageMaterial": "양치용품정리: 수납/정리용품 재질",
  "tooth_width": "양치용품정리: 가로길이",
  "tooth_handleIncluded": "양치용품정리: 손잡이 포함여부",
  "tooth_transparentWindow": "양치용품정리: 투명창여부",
  "tooth_drainage": "양치용품정리: 물빠짐여부",
  "tooth_mirror": "양치용품정리: 거울 유무",
  "tooth_set": "양치용품정리: 세트여부",
  "tooth_wheels": "양치용품정리: 바퀴 유무",
  "tooth_colorFamily": "양치용품정리: 색상계열",
  "tooth_height": "양치용품정리: 높이",
  "tooth_magnetic": "양치용품정리: 자석 부착가능 여부",
  "tooth_levels": "양치용품정리: 단 수",
  "tooth_minAge": "양치용품정리: 최소 연령",
  "tooth_maxAge": "양치용품정리: 최대 연령",
  "tooth_drilling": "양치용품정리: 타공 여부",
  "tooth_shelfUse": "양치용품정리: 선반 용도",
  "tooth_sliding": "양치용품정리: 슬라이딩 여부",
  "tooth_toothbrushCount": "양치용품정리: 칫솔 수납 개수",
  "tooth_finishType": "양치용품정리: 마감 유형",
  "tooth_shortEdge": "양치용품정리: 항목 너비가 짧은 가장자리",
  "tooth_components": "양치용품정리: 포함 구성 요소",
  "tooth_material": "양치용품정리: 상품 재질",
  "tooth_longEdge": "양치용품정리: 항목 길이가 더 긴 가장자리",
  "tooth_shape": "양치용품정리: 품목 모양",
  "tooth_gtin": "양치용품정리: Global Trade Item Number",
  "tooth_parentPart": "양치용품정리: Parent Manufacturer Part Number",
  "tooth_part": "양치용품정리: Manufacturer Part Number",
  brace_bodyPart: '헬스보호대: 사용부위', brace_size: '헬스보호대: 패션잡화 사이즈',
  brace_fastener: '헬스보호대: 잠금/고정방식', brace_composition: '헬스보호대: 구성',
  brace_user: '헬스보호대: 보호대 사용대상', brace_purpose: '헬스보호대: 보호대/교정용품 용도',
  brace_direction: '헬스보호대: 착용방향', brace_gtin: '헬스보호대: Global Trade Item Number',
  brace_parentPart: '헬스보호대: Parent Manufacturer Part Number', brace_part: '헬스보호대: Manufacturer Part Number',
  brace_noticeKc: '헬스보호대 고시: KC 인증정보', brace_noticeSizeWeight: '헬스보호대 고시: 크기, 중량',
  brace_noticeColor: '헬스보호대 고시: 색상', brace_noticeSpecifications: '헬스보호대 고시: 상품별 세부 사양',
  // BEGIN OBSERVED HUB MAPPING FIELDS
  optionLevels: '관찰 카테고리: 단 수',
  "hub_80714_3f61a31d7c3f": "키친타올걸이/홀더: 주방용품재질",
  "hub_80714_d30551b95e59": "키친타올걸이/홀더: 간편세척 가능여부",
  "hub_80714_cddd6c5a6f80": "키친타올걸이/홀더: 설치 형태",
  "hub_80714_a3054b5d3edf": "키친타올걸이/홀더: 수납가능여부",
  "hub_80714_ea09b2425970": "키친타올걸이/홀더: 수납정리공간 위치",
  "hub_80714_2ef9504e316b": "키친타올걸이/홀더: 걸이 형태",
  "hub_80714_5bd365ab3a60": "키친타올걸이/홀더: 아이템 높이",
  "hub_80714_9e5e7ca7d91b": "키친타올걸이/홀더: 항목 너비가 짧은 가장자리",
  "hub_80714_c5234f4eb22f": "키친타올걸이/홀더: 표면 권장 사항",
  "hub_80714_677ec907242a": "키친타올걸이/홀더: 상품 재질",
  "hub_80714_aa9e055ca3f4": "키친타올걸이/홀더: 설치 유형",
  "hub_80714_702b8f6bdee0": "키친타올걸이/홀더: Global Trade Item Number",
  "hub_80714_019ea26a47cc": "키친타올걸이/홀더: Parent Manufacturer Part Number",
  "hub_80714_f07b53d0ab24": "키친타올걸이/홀더: Manufacturer Part Number",
  "hub_80715_d30551b95e59": "행주걸이/주방수건걸이: 간편세척 가능여부",
  "hub_80715_aa9e055ca3f4": "행주걸이/주방수건걸이: 설치 유형",
  "hub_80715_8d31d8333580": "행주걸이/주방수건걸이: 선반개수",
  "hub_80715_a3054b5d3edf": "행주걸이/주방수건걸이: 수납가능여부",
  "hub_80715_ea09b2425970": "행주걸이/주방수건걸이: 수납정리공간 위치",
  "hub_80715_5bd365ab3a60": "행주걸이/주방수건걸이: 아이템 높이",
  "hub_80715_e99c12092b4d": "행주걸이/주방수건걸이: 아이템 깊이",
  "hub_80715_677ec907242a": "행주걸이/주방수건걸이: 상품 재질",
  "hub_80715_28a7d0530389": "행주걸이/주방수건걸이: 조립 필요여부",
  "hub_80715_702b8f6bdee0": "행주걸이/주방수건걸이: Global Trade Item Number",
  "hub_80715_019ea26a47cc": "행주걸이/주방수건걸이: Parent Manufacturer Part Number",
  "hub_80715_f07b53d0ab24": "행주걸이/주방수건걸이: Manufacturer Part Number",
  "hub_109047_75d9170fa5f0": "바나나걸이: 높이조절 여부",
  "hub_109047_0c632391936c": "바나나걸이: 수납/정리용품 재질",
  "hub_109047_9154857e37fd": "바나나걸이: 총 수량",
  "hub_109047_faaa5544d36d": "바나나걸이: 가로길이",
  "hub_109047_8d0e65a11a26": "바나나걸이: 손잡이 포함여부",
  "hub_109047_7aed7a663012": "바나나걸이: 접이식 가능여부",
  "hub_109047_aa9e055ca3f4": "바나나걸이: 설치 유형",
  "hub_109047_e6ac1362406c": "바나나걸이: 용량",
  "hub_109047_0800a532b8f7": "바나나걸이: 투명 여부",
  "hub_109047_4cc7d81c1d81": "바나나걸이: 수납/정리함 형태",
  "hub_109047_a3054b5d3edf": "바나나걸이: 수납가능여부",
  "hub_109047_ea09b2425970": "바나나걸이: 수납정리공간 위치",
  "hub_109047_c4b324ee3608": "바나나걸이: 청소방법",
  "hub_109047_9d9099f40c07": "바나나걸이: 가구 단수",
  "hub_109047_671ade7b3218": "바나나걸이: 선반형태",
  "hub_109047_eae99048f04c": "바나나걸이: 폭조절 가능 여부",
  "hub_109047_5b5e8d637991": "바나나걸이: 조립식 여부",
  "hub_109047_b4bff66aeec5": "바나나걸이: 슬라이딩 여부",
  "hub_109047_e7cd3afcf8ad": "바나나걸이: 주방선반 용도",
  "hub_109047_935696a615e0": "바나나걸이: 포함 구성 요소",
  "hub_109047_702b8f6bdee0": "바나나걸이: Global Trade Item Number",
  "hub_109047_019ea26a47cc": "바나나걸이: Parent Manufacturer Part Number",
  "hub_109047_f07b53d0ab24": "바나나걸이: Manufacturer Part Number",
  "hub_80720_75d9170fa5f0": "기타수납/정리용품: 높이조절 여부",
  "hub_80720_0c632391936c": "기타수납/정리용품: 수납/정리용품 재질",
  "hub_80720_9154857e37fd": "기타수납/정리용품: 총 수량",
  "hub_80720_faaa5544d36d": "기타수납/정리용품: 가로길이",
  "hub_80720_8d0e65a11a26": "기타수납/정리용품: 손잡이 포함여부",
  "hub_80720_7aed7a663012": "기타수납/정리용품: 접이식 가능여부",
  "hub_80720_aa9e055ca3f4": "기타수납/정리용품: 설치 유형",
  "hub_80720_e6ac1362406c": "기타수납/정리용품: 용량",
  "hub_80720_0800a532b8f7": "기타수납/정리용품: 투명 여부",
  "hub_80720_4cc7d81c1d81": "기타수납/정리용품: 수납/정리함 형태",
  "hub_80720_a3054b5d3edf": "기타수납/정리용품: 수납가능여부",
  "hub_80720_ea09b2425970": "기타수납/정리용품: 수납정리공간 위치",
  "hub_80720_c4b324ee3608": "기타수납/정리용품: 청소방법",
  "hub_80720_9d9099f40c07": "기타수납/정리용품: 가구 단수",
  "hub_80720_671ade7b3218": "기타수납/정리용품: 선반형태",
  "hub_80720_eae99048f04c": "기타수납/정리용품: 폭조절 가능 여부",
  "hub_80720_5b5e8d637991": "기타수납/정리용품: 조립식 여부",
  "hub_80720_b4bff66aeec5": "기타수납/정리용품: 슬라이딩 여부",
  "hub_80720_e7cd3afcf8ad": "기타수납/정리용품: 주방선반 용도",
  "hub_80720_935696a615e0": "기타수납/정리용품: 포함 구성 요소",
  "hub_80720_702b8f6bdee0": "기타수납/정리용품: Global Trade Item Number",
  "hub_80720_019ea26a47cc": "기타수납/정리용품: Parent Manufacturer Part Number",
  "hub_80720_f07b53d0ab24": "기타수납/정리용품: Manufacturer Part Number",
  "hub_80717_20f554966228": "냉장고슬라이드선반: 길이조절 가능여부",
  "hub_80717_7987cc591e6e": "냉장고슬라이드선반: 선반 단수",
  "hub_80717_0c632391936c": "냉장고슬라이드선반: 수납/정리용품 재질",
  "hub_80717_5ececc424913": "냉장고슬라이드선반: 개당 중량",
  "hub_80717_e0511ad24076": "냉장고슬라이드선반: 사이즈",
  "hub_80717_8be0f2e36a34": "냉장고슬라이드선반: 세로길이",
  "hub_80717_575b9fb5d187": "냉장고슬라이드선반: 뚜껑포함여부",
  "hub_80717_2f16d9003317": "냉장고슬라이드선반: 설치지원방식",
  "hub_80717_aa9e055ca3f4": "냉장고슬라이드선반: 설치 유형",
  "hub_80717_0800a532b8f7": "냉장고슬라이드선반: 투명 여부",
  "hub_80717_3163c5ab2817": "냉장고슬라이드선반: 차량용카매트 구조",
  "hub_80717_a3054b5d3edf": "냉장고슬라이드선반: 수납가능여부",
  "hub_80717_ea09b2425970": "냉장고슬라이드선반: 수납정리공간 위치",
  "hub_80717_72312f86bd3a": "냉장고슬라이드선반: 선반 유형",
  "hub_80717_1d8936275d56": "냉장고슬라이드선반: 구성",
  "hub_80717_2beea3f61672": "냉장고슬라이드선반: 손잡이 유무",
  "hub_80717_2108228c7d54": "냉장고슬라이드선반: 칸막이 여부",
  "hub_80717_b4bff66aeec5": "냉장고슬라이드선반: 슬라이딩 여부",
  "hub_80717_2164b0bbf70f": "냉장고슬라이드선반: 냉장고정리용품 용도",
  "hub_80717_1b4a97ed915d": "냉장고슬라이드선반: 냉장고정리용품 종류",
  "hub_80717_ffa159a0e5f4": "냉장고슬라이드선반: 호환 여부",
  "hub_80717_5bd365ab3a60": "냉장고슬라이드선반: 아이템 높이",
  "hub_80717_e99c12092b4d": "냉장고슬라이드선반: 아이템 깊이",
  "hub_80717_9e5e7ca7d91b": "냉장고슬라이드선반: 항목 너비가 짧은 가장자리",
  "hub_80717_b3142b1b6a7a": "냉장고슬라이드선반: 가구 베이스 이동 유형",
  "hub_80717_848e8f3a7206": "냉장고슬라이드선반: 세척 용이성",
  "hub_80717_702b8f6bdee0": "냉장고슬라이드선반: Global Trade Item Number",
  "hub_80717_019ea26a47cc": "냉장고슬라이드선반: Parent Manufacturer Part Number",
  "hub_80717_f07b53d0ab24": "냉장고슬라이드선반: Manufacturer Part Number",
  "hub_80718_0c632391936c": "정리수납함/트레이: 수납/정리용품 재질",
  "hub_80718_8be0f2e36a34": "정리수납함/트레이: 세로길이",
  "hub_80718_575b9fb5d187": "정리수납함/트레이: 뚜껑포함여부",
  "hub_80718_0460d80c3281": "정리수납함/트레이: 미끄럼방지 가능여부",
  "hub_80718_a3054b5d3edf": "정리수납함/트레이: 수납가능여부",
  "hub_80718_ea09b2425970": "정리수납함/트레이: 수납정리공간 위치",
  "hub_80718_1d8936275d56": "정리수납함/트레이: 구성",
  "hub_80718_2beea3f61672": "정리수납함/트레이: 손잡이 유무",
  "hub_80718_2108228c7d54": "정리수납함/트레이: 칸막이 여부",
  "hub_80718_2164b0bbf70f": "정리수납함/트레이: 냉장고정리용품 용도",
  "hub_80718_1b4a97ed915d": "정리수납함/트레이: 냉장고정리용품 종류",
  "hub_80718_a8fb2f8c7767": "정리수납함/트레이: 마감 유형",
  "hub_80718_5bd365ab3a60": "정리수납함/트레이: 아이템 높이",
  "hub_80718_9e5e7ca7d91b": "정리수납함/트레이: 항목 너비가 짧은 가장자리",
  "hub_80718_9de425ddd2f9": "정리수납함/트레이: 항목 길이가 더 긴 가장자리",
  "hub_80718_21e3717fedb3": "정리수납함/트레이: 품목 모양",
  "hub_80718_ce5ef961e69e": "정리수납함/트레이: 스타일",
  "hub_80718_848e8f3a7206": "정리수납함/트레이: 세척 용이성",
  "hub_80718_fbed365e43a4": "정리수납함/트레이: 방수 성능",
  "hub_80718_702b8f6bdee0": "정리수납함/트레이: Global Trade Item Number",
  "hub_80718_019ea26a47cc": "정리수납함/트레이: Parent Manufacturer Part Number",
  "hub_80718_f07b53d0ab24": "정리수납함/트레이: Manufacturer Part Number",
  "hub_80701_75d9170fa5f0": "개수대: 높이조절 여부",
  "hub_80701_dc9cd8a7608e": "개수대: 수전용품 종류",
  "hub_80701_20f554966228": "개수대: 길이조절 가능여부",
  "hub_80701_0c632391936c": "개수대: 수납/정리용품 재질",
  "hub_80701_faaa5544d36d": "개수대: 가로길이",
  "hub_80701_d30551b95e59": "개수대: 간편세척 가능여부",
  "hub_80701_aa9e055ca3f4": "개수대: 설치 유형",
  "hub_80701_16f1b2704aba": "개수대: 주방용품 형태",
  "hub_80701_459b9ff736b4": "개수대: 일반개수대/반개수대",
  "hub_80701_ea09b2425970": "개수대: 수납정리공간 위치",
  "hub_80701_9d9099f40c07": "개수대: 가구 단수",
  "hub_80701_671ade7b3218": "개수대: 선반형태",
  "hub_80701_eae99048f04c": "개수대: 폭조절 가능 여부",
  "hub_80701_5b5e8d637991": "개수대: 조립식 여부",
  "hub_80701_b4bff66aeec5": "개수대: 슬라이딩 여부",
  "hub_80701_e7cd3afcf8ad": "개수대: 주방선반 용도",
  "hub_80701_20cdee2bd299": "개수대: 옷 패턴/디자인",
  "hub_80701_a8fb2f8c7767": "개수대: 마감 유형",
  "hub_80701_5bd365ab3a60": "개수대: 아이템 높이",
  "hub_80701_935696a615e0": "개수대: 포함 구성 요소",
  "hub_80701_51df6eb2d6e0": "개수대: 저장량",
  "hub_80701_cf18ed2f5589": "개수대: 배수 유형",
  "hub_80701_702b8f6bdee0": "개수대: Global Trade Item Number",
  "hub_80701_019ea26a47cc": "개수대: Parent Manufacturer Part Number",
  "hub_80701_f07b53d0ab24": "개수대: Manufacturer Part Number",
  "hub_80699_0c632391936c": "거치식 식기건조대/싱크선반: 수납/정리용품 재질",
  "hub_80699_3f61a31d7c3f": "거치식 식기건조대/싱크선반: 주방용품재질",
  "hub_80699_e0511ad24076": "거치식 식기건조대/싱크선반: 사이즈",
  "hub_80699_c808579a7689": "거치식 식기건조대/싱크선반: 사용인원",
  "hub_80699_faaa5544d36d": "거치식 식기건조대/싱크선반: 가로길이",
  "hub_80699_d2bfd4ccc077": "거치식 식기건조대/싱크선반: 구성품",
  "hub_80699_64cf1d8a69c6": "거치식 식기건조대/싱크선반: 물받이 유무",
  "hub_80699_992314e1b6b8": "거치식 식기건조대/싱크선반: 물빠짐여부",
  "hub_80699_aa9e055ca3f4": "거치식 식기건조대/싱크선반: 설치 유형",
  "hub_80699_1370af80715e": "거치식 식기건조대/싱크선반: 저장용량",
  "hub_80699_fddf3d937308": "거치식 식기건조대/싱크선반: 걸이 유무",
  "hub_80699_8f8209e92379": "거치식 식기건조대/싱크선반: 수저통포함여부",
  "hub_80699_ea09b2425970": "거치식 식기건조대/싱크선반: 수납정리공간 위치",
  "hub_80699_86ddc2a45a35": "거치식 식기건조대/싱크선반: 논슬립 여부",
  "hub_80699_671ade7b3218": "거치식 식기건조대/싱크선반: 선반형태",
  "hub_80699_eae99048f04c": "거치식 식기건조대/싱크선반: 폭조절 가능 여부",
  "hub_80699_5b5e8d637991": "거치식 식기건조대/싱크선반: 조립식 여부",
  "hub_80699_ffa159a0e5f4": "거치식 식기건조대/싱크선반: 호환 여부",
  "hub_80699_5bd365ab3a60": "거치식 식기건조대/싱크선반: 아이템 높이",
  "hub_80699_e99c12092b4d": "거치식 식기건조대/싱크선반: 아이템 깊이",
  "hub_80699_9e5e7ca7d91b": "거치식 식기건조대/싱크선반: 항목 너비가 짧은 가장자리",
  "hub_80699_eaf8b324eef8": "거치식 식기건조대/싱크선반: 특별한 기능",
  "hub_80699_c7d32ad76dbb": "거치식 식기건조대/싱크선반: 높이(베이스에서 상단까지)",
  "hub_80699_702b8f6bdee0": "거치식 식기건조대/싱크선반: Global Trade Item Number",
  "hub_80699_019ea26a47cc": "거치식 식기건조대/싱크선반: Parent Manufacturer Part Number",
  "hub_80699_f07b53d0ab24": "거치식 식기건조대/싱크선반: Manufacturer Part Number",
  "hub_80709_e0511ad24076": "국자받침/조리도구받침: 사이즈",
  "hub_80709_d30551b95e59": "국자받침/조리도구받침: 간편세척 가능여부",
  "hub_80709_eeb68233a6da": "국자받침/조리도구받침: 패션 의류/잡화 스타일",
  "hub_80709_a3054b5d3edf": "국자받침/조리도구받침: 수납가능여부",
  "hub_80709_ea09b2425970": "국자받침/조리도구받침: 수납정리공간 위치",
  "hub_80709_ffa159a0e5f4": "국자받침/조리도구받침: 호환 여부",
  "hub_80709_935696a615e0": "국자받침/조리도구받침: 포함 구성 요소",
  "hub_80709_677ec907242a": "국자받침/조리도구받침: 상품 재질",
  "hub_80709_d0eb8b83dbff": "국자받침/조리도구받침: 관리 지침",
  "hub_80709_6fbbd856e54d": "국자받침/조리도구받침: 열원 호환성",
  "hub_80709_702b8f6bdee0": "국자받침/조리도구받침: Global Trade Item Number",
  "hub_80709_019ea26a47cc": "국자받침/조리도구받침: Parent Manufacturer Part Number",
  "hub_80709_f07b53d0ab24": "국자받침/조리도구받침: Manufacturer Part Number",
  "hub_80700_0c632391936c": "기둥식 식기건조대/싱크선반: 수납/정리용품 재질",
  "hub_80700_69dca77b6a63": "기둥식 식기건조대/싱크선반: 타공치수",
  "hub_80700_5ececc424913": "기둥식 식기건조대/싱크선반: 개당 중량",
  "hub_80700_3f61a31d7c3f": "기둥식 식기건조대/싱크선반: 주방용품재질",
  "hub_80700_e0511ad24076": "기둥식 식기건조대/싱크선반: 사이즈",
  "hub_80700_faaa5544d36d": "기둥식 식기건조대/싱크선반: 가로길이",
  "hub_80700_d2bfd4ccc077": "기둥식 식기건조대/싱크선반: 구성품",
  "hub_80700_d30551b95e59": "기둥식 식기건조대/싱크선반: 간편세척 가능여부",
  "hub_80700_64cf1d8a69c6": "기둥식 식기건조대/싱크선반: 물받이 유무",
  "hub_80700_c2c8f0007728": "기둥식 식기건조대/싱크선반: 높이",
  "hub_80700_fddf3d937308": "기둥식 식기건조대/싱크선반: 걸이 유무",
  "hub_80700_8f8209e92379": "기둥식 식기건조대/싱크선반: 수저통포함여부",
  "hub_80700_a3054b5d3edf": "기둥식 식기건조대/싱크선반: 수납가능여부",
  "hub_80700_ea09b2425970": "기둥식 식기건조대/싱크선반: 수납정리공간 위치",
  "hub_80700_38ffe71c0fc2": "기둥식 식기건조대/싱크선반: 선반 용도",
  "hub_80700_671ade7b3218": "기둥식 식기건조대/싱크선반: 선반형태",
  "hub_80700_eae99048f04c": "기둥식 식기건조대/싱크선반: 폭조절 가능 여부",
  "hub_80700_5b5e8d637991": "기둥식 식기건조대/싱크선반: 조립식 여부",
  "hub_80700_ffa159a0e5f4": "기둥식 식기건조대/싱크선반: 호환 여부",
  "hub_80700_e99c12092b4d": "기둥식 식기건조대/싱크선반: 아이템 깊이",
  "hub_80700_eaf8b324eef8": "기둥식 식기건조대/싱크선반: 특별한 기능",
  "hub_80700_702b8f6bdee0": "기둥식 식기건조대/싱크선반: Global Trade Item Number",
  "hub_80700_019ea26a47cc": "기둥식 식기건조대/싱크선반: Parent Manufacturer Part Number",
  "hub_80700_f07b53d0ab24": "기둥식 식기건조대/싱크선반: Manufacturer Part Number",
  "hub_80708_e0511ad24076": "도마정리대/쟁반정리대: 사이즈",
  "hub_80708_1370af80715e": "도마정리대/쟁반정리대: 저장용량",
  "hub_80708_e7a752404eca": "도마정리대/쟁반정리대: 칸/분할 수",
  "hub_80708_a3054b5d3edf": "도마정리대/쟁반정리대: 수납가능여부",
  "hub_80708_ea09b2425970": "도마정리대/쟁반정리대: 수납정리공간 위치",
  "hub_80708_20cdee2bd299": "도마정리대/쟁반정리대: 옷 패턴/디자인",
  "hub_80708_5bd365ab3a60": "도마정리대/쟁반정리대: 아이템 높이",
  "hub_80708_e99c12092b4d": "도마정리대/쟁반정리대: 아이템 깊이",
  "hub_80708_935696a615e0": "도마정리대/쟁반정리대: 포함 구성 요소",
  "hub_80708_545ecf394893": "도마정리대/쟁반정리대: 항목 너비 좌우",
  "hub_80708_28a7d0530389": "도마정리대/쟁반정리대: 조립 필요여부",
  "hub_80708_eaf8b324eef8": "도마정리대/쟁반정리대: 특별한 기능",
  "hub_80708_702b8f6bdee0": "도마정리대/쟁반정리대: Global Trade Item Number",
  "hub_80708_019ea26a47cc": "도마정리대/쟁반정리대: Parent Manufacturer Part Number",
  "hub_80708_f07b53d0ab24": "도마정리대/쟁반정리대: Manufacturer Part Number",
  "hub_110583_0c632391936c": "부착식 식기건조대/싱크선반: 수납/정리용품 재질",
  "hub_110583_69dca77b6a63": "부착식 식기건조대/싱크선반: 타공치수",
  "hub_110583_5ececc424913": "부착식 식기건조대/싱크선반: 개당 중량",
  "hub_110583_3f61a31d7c3f": "부착식 식기건조대/싱크선반: 주방용품재질",
  "hub_110583_e0511ad24076": "부착식 식기건조대/싱크선반: 사이즈",
  "hub_110583_faaa5544d36d": "부착식 식기건조대/싱크선반: 가로길이",
  "hub_110583_d2bfd4ccc077": "부착식 식기건조대/싱크선반: 구성품",
  "hub_110583_d30551b95e59": "부착식 식기건조대/싱크선반: 간편세척 가능여부",
  "hub_110583_64cf1d8a69c6": "부착식 식기건조대/싱크선반: 물받이 유무",
  "hub_110583_c2c8f0007728": "부착식 식기건조대/싱크선반: 높이",
  "hub_110583_fddf3d937308": "부착식 식기건조대/싱크선반: 걸이 유무",
  "hub_110583_8f8209e92379": "부착식 식기건조대/싱크선반: 수저통포함여부",
  "hub_110583_a3054b5d3edf": "부착식 식기건조대/싱크선반: 수납가능여부",
  "hub_110583_ea09b2425970": "부착식 식기건조대/싱크선반: 수납정리공간 위치",
  "hub_110583_38ffe71c0fc2": "부착식 식기건조대/싱크선반: 선반 용도",
  "hub_110583_671ade7b3218": "부착식 식기건조대/싱크선반: 선반형태",
  "hub_110583_eae99048f04c": "부착식 식기건조대/싱크선반: 폭조절 가능 여부",
  "hub_110583_5b5e8d637991": "부착식 식기건조대/싱크선반: 조립식 여부",
  "hub_110583_ffa159a0e5f4": "부착식 식기건조대/싱크선반: 호환 여부",
  "hub_110583_e99c12092b4d": "부착식 식기건조대/싱크선반: 아이템 깊이",
  "hub_110583_eaf8b324eef8": "부착식 식기건조대/싱크선반: 특별한 기능",
  "hub_110583_702b8f6bdee0": "부착식 식기건조대/싱크선반: Global Trade Item Number",
  "hub_110583_019ea26a47cc": "부착식 식기건조대/싱크선반: Parent Manufacturer Part Number",
  "hub_110583_f07b53d0ab24": "부착식 식기건조대/싱크선반: Manufacturer Part Number",
  "hub_80703_ec46e7cdc720": "설거지통: 용기류재질",
  "hub_80703_e0511ad24076": "설거지통: 사이즈",
  "hub_80703_891abd725243": "설거지통: 개당 용량",
  "hub_80703_d30551b95e59": "설거지통: 간편세척 가능여부",
  "hub_80703_7ce8a03c8ef9": "설거지통: 배수구 여부",
  "hub_80703_16f1b2704aba": "설거지통: 주방용품 형태",
  "hub_80703_a3054b5d3edf": "설거지통: 수납가능여부",
  "hub_80703_ea09b2425970": "설거지통: 수납정리공간 위치",
  "hub_80703_1fcd60bc0c1b": "설거지통: 물넘침 방지 구멍 여부",
  "hub_80703_5bd365ab3a60": "설거지통: 아이템 높이",
  "hub_80703_702b8f6bdee0": "설거지통: Global Trade Item Number",
  "hub_80703_019ea26a47cc": "설거지통: Parent Manufacturer Part Number",
  "hub_80703_f07b53d0ab24": "설거지통: Manufacturer Part Number",
  "hub_80702_75d9170fa5f0": "싱크롤: 높이조절 여부",
  "hub_80702_0c632391936c": "싱크롤: 수납/정리용품 재질",
  "hub_80702_faaa5544d36d": "싱크롤: 가로길이",
  "hub_80702_a3054b5d3edf": "싱크롤: 수납가능여부",
  "hub_80702_ea09b2425970": "싱크롤: 수납정리공간 위치",
  "hub_80702_917efa42758c": "싱크롤: 상품구성",
  "hub_80702_9d9099f40c07": "싱크롤: 가구 단수",
  "hub_80702_671ade7b3218": "싱크롤: 선반형태",
  "hub_80702_eae99048f04c": "싱크롤: 폭조절 가능 여부",
  "hub_80702_5b5e8d637991": "싱크롤: 조립식 여부",
  "hub_80702_b4bff66aeec5": "싱크롤: 슬라이딩 여부",
  "hub_80702_e7cd3afcf8ad": "싱크롤: 주방선반 용도",
  "hub_80702_ffa159a0e5f4": "싱크롤: 호환 여부",
  "hub_80702_6d9a76dc1b80": "싱크롤: 제품의 권장 용도",
  "hub_80702_e99c12092b4d": "싱크롤: 아이템 깊이",
  "hub_80702_eaf8b324eef8": "싱크롤: 특별한 기능",
  "hub_80702_702b8f6bdee0": "싱크롤: Global Trade Item Number",
  "hub_80702_019ea26a47cc": "싱크롤: Parent Manufacturer Part Number",
  "hub_80702_f07b53d0ab24": "싱크롤: Manufacturer Part Number",
  "hub_80710_e0511ad24076": "싱크수저정리함/서랍정리함: 사이즈",
  "hub_80710_a3054b5d3edf": "싱크수저정리함/서랍정리함: 수납가능여부",
  "hub_80710_ea09b2425970": "싱크수저정리함/서랍정리함: 수납정리공간 위치",
  "hub_80710_5bd365ab3a60": "싱크수저정리함/서랍정리함: 아이템 높이",
  "hub_80710_e99c12092b4d": "싱크수저정리함/서랍정리함: 아이템 깊이",
  "hub_80710_935696a615e0": "싱크수저정리함/서랍정리함: 포함 구성 요소",
  "hub_80710_545ecf394893": "싱크수저정리함/서랍정리함: 항목 너비 좌우",
  "hub_80710_eaf8b324eef8": "싱크수저정리함/서랍정리함: 특별한 기능",
  "hub_80710_702b8f6bdee0": "싱크수저정리함/서랍정리함: Global Trade Item Number",
  "hub_80710_019ea26a47cc": "싱크수저정리함/서랍정리함: Parent Manufacturer Part Number",
  "hub_80710_f07b53d0ab24": "싱크수저정리함/서랍정리함: Manufacturer Part Number",
  "hub_80707_6b9ef972206a": "접시꽂이: 사이즈 조절여부",
  "hub_80707_3f61a31d7c3f": "접시꽂이: 주방용품재질",
  "hub_80707_e0511ad24076": "접시꽂이: 사이즈",
  "hub_80707_992314e1b6b8": "접시꽂이: 물빠짐여부",
  "hub_80707_cddd6c5a6f80": "접시꽂이: 설치 형태",
  "hub_80707_1370af80715e": "접시꽂이: 저장용량",
  "hub_80707_ea09b2425970": "접시꽂이: 수납정리공간 위치",
  "hub_80707_25591ff898c0": "접시꽂이: 내하중",
  "hub_80707_1d8936275d56": "접시꽂이: 구성",
  "hub_80707_145786d4b322": "접시꽂이: 정리대 형태",
  "hub_80707_5bd365ab3a60": "접시꽂이: 아이템 높이",
  "hub_80707_e99c12092b4d": "접시꽂이: 아이템 깊이",
  "hub_80707_9e5e7ca7d91b": "접시꽂이: 항목 너비가 짧은 가장자리",
  "hub_80707_eaf8b324eef8": "접시꽂이: 특별한 기능",
  "hub_80707_5eb1374ed6d3": "접시꽂이: 호환성 및 적합성",
  "hub_80707_702b8f6bdee0": "접시꽂이: Global Trade Item Number",
  "hub_80707_019ea26a47cc": "접시꽂이: Parent Manufacturer Part Number",
  "hub_80707_f07b53d0ab24": "접시꽂이: Manufacturer Part Number",
  "hub_80704_75d9170fa5f0": "정리선반/다용도선반: 높이조절 여부",
  "hub_80704_0c632391936c": "정리선반/다용도선반: 수납/정리용품 재질",
  "hub_80704_5ececc424913": "정리선반/다용도선반: 개당 중량",
  "hub_80704_faaa5544d36d": "정리선반/다용도선반: 가로길이",
  "hub_80704_8e6218add2e5": "정리선반/다용도선반: 바퀴 유무",
  "hub_80704_c2c8f0007728": "정리선반/다용도선반: 높이",
  "hub_80704_cddd6c5a6f80": "정리선반/다용도선반: 설치 형태",
  "hub_80704_a3054b5d3edf": "정리선반/다용도선반: 수납가능여부",
  "hub_80704_24e51d16269e": "정리선반/다용도선반: 고정 방식",
  "hub_80704_ea09b2425970": "정리선반/다용도선반: 수납정리공간 위치",
  "hub_80704_72312f86bd3a": "정리선반/다용도선반: 선반 유형",
  "hub_80704_9d9099f40c07": "정리선반/다용도선반: 가구 단수",
  "hub_80704_38ffe71c0fc2": "정리선반/다용도선반: 선반 용도",
  "hub_80704_671ade7b3218": "정리선반/다용도선반: 선반형태",
  "hub_80704_eae99048f04c": "정리선반/다용도선반: 폭조절 가능 여부",
  "hub_80704_5b5e8d637991": "정리선반/다용도선반: 조립식 여부",
  "hub_80704_b4bff66aeec5": "정리선반/다용도선반: 슬라이딩 여부",
  "hub_80704_28a7d0530389": "정리선반/다용도선반: 조립 필요여부",
  "hub_80704_26e8e5bd4f64": "정리선반/다용도선반: 수평 조절",
  "hub_80704_702b8f6bdee0": "정리선반/다용도선반: Global Trade Item Number",
  "hub_80704_019ea26a47cc": "정리선반/다용도선반: Parent Manufacturer Part Number",
  "hub_80704_f07b53d0ab24": "정리선반/다용도선반: Manufacturer Part Number",
  "hub_80706_1370af80715e": "컵걸이: 저장용량",
  "hub_80706_615d4ae7c1f2": "컵걸이: 차량사용 가능여부",
  "hub_80706_e4a489b39c02": "컵걸이: 컵걸이형태",
  "hub_80706_a3054b5d3edf": "컵걸이: 수납가능여부",
  "hub_80706_ea09b2425970": "컵걸이: 수납정리공간 위치",
  "hub_80706_f927b9d79400": "컵걸이: 호환모델",
  "hub_80706_5bd365ab3a60": "컵걸이: 아이템 높이",
  "hub_80706_9e5e7ca7d91b": "컵걸이: 항목 너비가 짧은 가장자리",
  "hub_80706_935696a615e0": "컵걸이: 포함 구성 요소",
  "hub_80706_9de425ddd2f9": "컵걸이: 항목 길이가 더 긴 가장자리",
  "hub_80706_702b8f6bdee0": "컵걸이: Global Trade Item Number",
  "hub_80706_019ea26a47cc": "컵걸이: Parent Manufacturer Part Number",
  "hub_80706_f07b53d0ab24": "컵걸이: Manufacturer Part Number",
  "hub_80705_75d9170fa5f0": "프라이팬정리대: 높이조절 여부",
  "hub_80705_20f554966228": "프라이팬정리대: 길이조절 가능여부",
  "hub_80705_0c632391936c": "프라이팬정리대: 수납/정리용품 재질",
  "hub_80705_3f61a31d7c3f": "프라이팬정리대: 주방용품재질",
  "hub_80705_faaa5544d36d": "프라이팬정리대: 가로길이",
  "hub_80705_d30551b95e59": "프라이팬정리대: 간편세척 가능여부",
  "hub_80705_88eaa3c04cfd": "프라이팬정리대: 세트여부",
  "hub_80705_a3054b5d3edf": "프라이팬정리대: 수납가능여부",
  "hub_80705_ea09b2425970": "프라이팬정리대: 수납정리공간 위치",
  "hub_80705_917efa42758c": "프라이팬정리대: 상품구성",
  "hub_80705_9d9099f40c07": "프라이팬정리대: 가구 단수",
  "hub_80705_a847d39ea099": "프라이팬정리대: 확장 가능 여부",
  "hub_80705_671ade7b3218": "프라이팬정리대: 선반형태",
  "hub_80705_eae99048f04c": "프라이팬정리대: 폭조절 가능 여부",
  "hub_80705_5b5e8d637991": "프라이팬정리대: 조립식 여부",
  "hub_80705_b4bff66aeec5": "프라이팬정리대: 슬라이딩 여부",
  "hub_80705_e7cd3afcf8ad": "프라이팬정리대: 주방선반 용도",
  "hub_80705_145786d4b322": "프라이팬정리대: 정리대 형태",
  "hub_80705_22696ee59eae": "프라이팬정리대: 단수조절 여부",
  "hub_80705_5bd365ab3a60": "프라이팬정리대: 아이템 높이",
  "hub_80705_e99c12092b4d": "프라이팬정리대: 아이템 깊이",
  "hub_80705_702b8f6bdee0": "프라이팬정리대: Global Trade Item Number",
  "hub_80705_019ea26a47cc": "프라이팬정리대: Parent Manufacturer Part Number",
  "hub_80705_f07b53d0ab24": "프라이팬정리대: Manufacturer Part Number",
  "hub_80712_6ee9e618547c": "수세미걸이/수세미받침: 욕실수납용품 재질",
  "hub_80712_ec61562aec1a": "수세미걸이/수세미받침: 욕실용품 설치방법",
  "hub_80712_d30551b95e59": "수세미걸이/수세미받침: 간편세척 가능여부",
  "hub_80712_992314e1b6b8": "수세미걸이/수세미받침: 물빠짐여부",
  "hub_80712_18f2fac07467": "수세미걸이/수세미받침: 방수 가능여부",
  "hub_80712_a3054b5d3edf": "수세미걸이/수세미받침: 수납가능여부",
  "hub_80712_ea09b2425970": "수세미걸이/수세미받침: 수납정리공간 위치",
  "hub_80712_ffa159a0e5f4": "수세미걸이/수세미받침: 호환 여부",
  "hub_80712_5bd365ab3a60": "수세미걸이/수세미받침: 아이템 높이",
  "hub_80712_e99c12092b4d": "수세미걸이/수세미받침: 아이템 깊이",
  "hub_80712_545ecf394893": "수세미걸이/수세미받침: 항목 너비 좌우",
  "hub_80712_6fbbd856e54d": "수세미걸이/수세미받침: 열원 호환성",
  "hub_80712_702b8f6bdee0": "수세미걸이/수세미받침: Global Trade Item Number",
  "hub_80712_019ea26a47cc": "수세미걸이/수세미받침: Parent Manufacturer Part Number",
  "hub_80712_f07b53d0ab24": "수세미걸이/수세미받침: Manufacturer Part Number",
  "hub_80713_0c632391936c": "조리도구걸이: 수납/정리용품 재질",
  "hub_80713_e0511ad24076": "조리도구걸이: 사이즈",
  "hub_80713_cddd6c5a6f80": "조리도구걸이: 설치 형태",
  "hub_80713_a3054b5d3edf": "조리도구걸이: 수납가능여부",
  "hub_80713_720f0f65c138": "조리도구걸이: 회전가능여부",
  "hub_80713_5e729f1aa10e": "조리도구걸이: 단 수",
  "hub_80713_ea09b2425970": "조리도구걸이: 수납정리공간 위치",
  "hub_80713_5bd365ab3a60": "조리도구걸이: 아이템 높이",
  "hub_80713_28a7d0530389": "조리도구걸이: 조립 필요여부",
  "hub_80713_291a744c8e21": "조리도구걸이: 규격",
  "hub_80713_702b8f6bdee0": "조리도구걸이: Global Trade Item Number",
  "hub_80713_019ea26a47cc": "조리도구걸이: Parent Manufacturer Part Number",
  "hub_80713_f07b53d0ab24": "조리도구걸이: Manufacturer Part Number",
  // END OBSERVED HUB MAPPING FIELDS
  board_width: '바둑알+바둑판: 가로길이', board_length: '바둑알+바둑판: 세로길이',
  board_foldable: '바둑알+바둑판: 접이식 가능여부', board_magnetic: '바둑알+바둑판: 자석 부착가능 여부',
  board_doubleSided: '바둑알+바둑판: 양면사용 가능여부', board_duration: '바둑알+바둑판: 사용시간',
  board_maxPlayers: '바둑알+바둑판: 최대사용인원', board_minimumAge: '바둑알+바둑판: 최소 연령',
  board_stoneKind: '바둑알+바둑판: 바둑알 종류', board_genre: '바둑알+바둑판: 보드게임 장르',
  board_language: '바둑알+바둑판: 사용언어', board_theme: '바둑알+바둑판: 테마',
  board_components: '바둑알+바둑판: 포함 구성 요소', board_gtin: '바둑알+바둑판: Global Trade Item Number',
  board_parentPart: '바둑알+바둑판: Parent Manufacturer Part Number', board_part: '바둑알+바둑판: Manufacturer Part Number',
  noticePermission: '상품고시: 인증/허가 사항',
  category: '견적 편집: 카테고리 경로', model: '견적 편집: 모델명', tradeType: '견적 편집: 거래타입', taxType: '견적 편집: 과세여부', importType: '견적 편집: 수입여부',
  searchTags: '견적 편집: 검색태그', barcodeMode: '견적 편집: 바코드 입력 방식',
  additionalImages: '견적 편집: 추가 이미지', labelImages: '견적 편집: 표시사항 이미지', detailImages: '견적 편집: 상세 이미지', detailHtml: '견적 편집: HTML 상세 내용', altText: '견적 편집: 대체 텍스트',
  kcMarkType: '견적 편집: KC 마크 타입', kcCertificationNumber: '견적 편집: KC 인증번호', emcCertificationNumber: '견적 편집: EMC 인증번호', safetyDeclarationNumber: '견적 편집: 안전기준 신고번호', kcsCertificationNumber: '견적 편집: KCS 인증번호',
  boxSkuQuantity: '견적 편집: 박스 내 SKU 수량', shelfLifeDays: '견적 편집: 유통·소비기간', handlingReason: '견적 편집: 취급주의 사유', packagedWeightG: '견적 편집: 포장 무게 g', packagedDimensionsMm: '견적 편집: 포장 사이즈 mm',
  color: '관찰 카테고리: 색상', quantity: '관찰 카테고리: 수량', size: '관찰 카테고리: 사이즈',
  lidIncluded: '관찰 카테고리: 뚜껑 포함여부', heightAdjustable: '관찰 카테고리: 높이조절 여부', basketShape: '관찰 카테고리: 바구니 형태', storageMaterial: '관찰 카테고리: 수납 재질', totalQuantity: '관찰 카테고리: 총 수량', width: '관찰 카테고리: 가로길이', handleIncluded: '관찰 카테고리: 손잡이', foldable: '관찰 카테고리: 접이식', weight: '관찰 카테고리: 중량', transparent: '관찰 카테고리: 투명 여부', storageShape: '관찰 카테고리: 수납 형태', ventilationFan: '관찰 카테고리: 환기팬', storageMethod: '관찰 카테고리: 보관방식', storageAvailable: '관찰 카테고리: 수납가능', storageLocation: '관찰 카테고리: 수납 위치', shelfLevels: '관찰 카테고리: 가구 단수', basketUse: '관찰 카테고리: 바구니 용도', shelfShape: '관찰 카테고리: 선반 형태', widthAdjustable: '관찰 카테고리: 폭조절', assemblyRequired: '관찰 카테고리: 조립식', sliding: '관찰 카테고리: 슬라이딩', kitchenShelfUse: '관찰 카테고리: 주방선반 용도', finishType: '관찰 카테고리: 마감', itemHeight: '관찰 카테고리: 높이', includedComponents: '관찰 카테고리: 구성 요소', gtin: '관찰 카테고리: GTIN', parentManufacturerPartNumber: '관찰 카테고리: 상위 제조사 부품번호', manufacturerPartNumber: '관찰 카테고리: 제조사 부품번호',
  noticeNameModel: '상품고시: 품명 및 모델명', noticeMaterial: '상품고시: 재질', noticeComponents: '상품고시: 구성품', noticeDimensions: '상품고시: 크기', noticeReleaseDate: '상품고시: 출시년월', noticeManufacturerImporter: '상품고시: 제조자·수입자', noticeCountryOfOrigin: '상품고시: 제조국', noticeImportDeclaration: '상품고시: 수입신고 문구', noticeQualityAssurance: '상품고시: 품질보증', noticeServiceContact: '상품고시: A/S 연락처',
  title: '한국어 상품명', skuName: '옵션명', skuId: '원본 SKU 번호', categoryId: '카테고리 번호',
  brand: '브랜드', manufacturer: '제조사', importer: '수입·판매원', serviceContact: 'A/S 연락처',
  sourceUrl: '1688 상품 URL', sourcePriceCny: '원가 (CNY)', supplyPrice: '공급가 (KRW)',
  salePrice: '판매가 (KRW)', msrp: '시장가격 (KRW)', barcode: '바코드', boxQuantity: '박스 내 수량',
  material: '소재', countryOfOrigin: '제조국', mainImage: '대표 이미지', detailImage: '상세 이미지',
  label: '표시사항 파일', constant: '고정값',
} as const;
export type CategoryField = keyof typeof categoryFields;
export function categoryFieldScope(field: string): string | null {
  return field.startsWith('marathon_') ? '103495' : field.startsWith('tooth_') ? '64497' : field.startsWith('brace_') ? '81452' : field.startsWith('board_') ? '77442' : /^hub_(\d+)_/.exec(field)?.[1] ?? null;
}
export type TemplateDefinition = {
  name: string; format: 'csv' | 'tsv' | 'xlsx'; sha256: string;
  sheetName: string; headerRow: number; headers: string[];
  storageKey?: string; dataStartRow?: number;
};
/** Older profiles retain their original header-following default without rewriting stored payloads. */
export function quotationStartRow(template?: TemplateDefinition | null): number {
  return template?.dataStartRow ?? (template?.headerRow ?? 1) + 1;
}
export type ColumnMapping = { column: number; field: CategoryField; required: boolean; constant?: string; choiceFormat?: 'value' | 'label' };
export type CategoryProfileInput = {
  name: string; categoryId: string; categoryPath: string[];
  template: TemplateDefinition | null; mappings: ColumnMapping[];
};
export type CategoryProfile = CategoryProfileInput & {
  id: string; revision: number; verification: 'draft'; createdAt: string; updatedAt: string;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 형식을 확인해주세요.`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, limit: number, optional = false): string {
  if (typeof value !== 'string' || value.length > limit || (!optional && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${label}을(를) 확인해주세요.`);
  return value.trim();
}
export function validateCategoryProfile(value: unknown): CategoryProfileInput {
  const input = record(value, '카테고리 설정');
  if (input.verification !== undefined && input.verification !== 'draft') throw new Error('견적서 검증 상태는 직접 변경할 수 없습니다.');
  const name = string(input.name, '설정 이름', 120);
  const categoryId = string(input.categoryId ?? '', '실제 카테고리 번호', 120, true);
  if (!Array.isArray(input.categoryPath) || !input.categoryPath.length || input.categoryPath.length > 10) throw new Error('카테고리 경로를 1~10단계로 입력해주세요.');
  const categoryPath = input.categoryPath.map(value => string(value, '카테고리 경로', 120));
  let template: TemplateDefinition | null = null;
  if (input.template !== null && input.template !== undefined) {
    const value = record(input.template, '견적서 양식');
    if (!['csv', 'tsv', 'xlsx'].includes(String(value.format))) throw new Error('지원하는 견적서 형식인지 확인해주세요.');
    if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.sha256)) throw new Error('견적서 원본 파일의 SHA-256 값이 필요합니다.');
    if (!Number.isInteger(value.headerRow) || Number(value.headerRow) < 1 || Number(value.headerRow) > 1000) throw new Error('머리글 행 번호를 확인해주세요.');
    if (value.dataStartRow !== undefined && (!Number.isInteger(value.dataStartRow) || Number(value.dataStartRow) <= Number(value.headerRow) || Number(value.dataStartRow) > 10000)) throw new Error('상품 입력 시작 행은 머리글 뒤부터 10000행까지 지정해주세요.');
    if (!Array.isArray(value.headers) || !value.headers.length || value.headers.length > 200) throw new Error('견적서 열은 1~200개까지 사용할 수 있습니다.');
    const headers = value.headers.map(value => string(value, '견적서 열 이름', 500, true));
    if (!headers.some(Boolean)) throw new Error('견적서 머리글에 열 이름이 없습니다.');
    template = { name: string(value.name, '견적서 파일 이름', 240), format: value.format as TemplateDefinition['format'], sha256: value.sha256.toLowerCase(), sheetName: string(value.sheetName ?? '', '시트 이름', 120, true), headerRow: Number(value.headerRow), headers,
      ...(value.dataStartRow !== undefined ? { dataStartRow: Number(value.dataStartRow) } : {}),
      ...(value.storageKey !== undefined ? { storageKey: string(value.storageKey, '견적서 저장 경로', 600) } : {}), };
  }
  if (!Array.isArray(input.mappings) || input.mappings.length > 200) throw new Error('견적서 열 연결을 확인해주세요.');
  if (!template && input.mappings.length) throw new Error('견적서 파일을 먼저 연결해주세요.');
  const used = new Set<number>();
  const mappings = input.mappings.map(raw => {
    const value = record(raw, '열 연결');
    const column = Number(value.column);
    if (typeof value.column !== 'number' || !Number.isInteger(column) || column < 0 || !template || column >= template.headers.length || used.has(column)) throw new Error('견적서 열을 중복 없이 연결해주세요.');
    used.add(column);
    if (typeof value.field !== 'string' || !Object.hasOwn(categoryFields, value.field) || typeof value.required !== 'boolean') throw new Error('열 연결 항목을 확인해주세요.');
    if (value.choiceFormat !== undefined && value.choiceFormat !== 'value' && value.choiceFormat !== 'label') throw new Error('선택값 출력 형식을 확인해주세요.');
    const field = value.field as CategoryField;
    if (field === 'constant' && value.choiceFormat === 'label') throw new Error('고정값에는 선택 문구 변환을 적용할 수 없습니다.');
    const scopedCategory = categoryFieldScope(field);
    if (scopedCategory && scopedCategory !== categoryId) throw new Error('다른 카테고리의 고유 속성은 연결할 수 없습니다. 선택한 카테고리의 항목으로 다시 연결해주세요.');
    return { column, field, required: value.required, ...(value.choiceFormat !== undefined ? { choiceFormat: value.choiceFormat as 'value' | 'label' } : {}), ...(field === 'constant' ? { constant: string(value.constant ?? '', '고정값', 4000, true) } : {}) };
  });
  return { name, categoryId, categoryPath, template, mappings };
}

// This checks a locally configured mapping, not Supplier Hub acceptance.
/** Same identifier contract as category-scoped quotations; not proof of a Hub code. */
export function usableCategoryCode(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}
/** Keep legacy records readable; enforce this only when writing a setting. */
export function validateCategoryCodeForSave(value: string): void {
  if (value && !usableCategoryCode(value)) throw new Error('카테고리 번호는 영문·숫자·하이픈·밑줄 100자 이하로 입력해주세요. 분류 이름은 카테고리 경로에 입력해주세요.');
}
export function categoryProfileIssues(profile: CategoryProfileInput): string[] {
  const issues: string[] = [];
  if (!profile.categoryId) issues.push('Supplier Hub의 실제 카테고리 번호 미확인');
  else if (!usableCategoryCode(profile.categoryId)) issues.push('카테고리 번호 형식 오류 · 저장 설정에서 번호를 수정해주세요.');
  if (!profile.template) issues.push('카테고리에 맞는 견적서 양식 미연결');
  else if (!profile.mappings.length) issues.push('견적서 열과 상품 자료 연결 필요');
  return issues;
}

/** Validate writes against current category metadata; legacy settings remain readable. */
export function validateQuotationChoiceFormats(profile: CategoryProfileInput, fields: readonly { id: string; type: string; choices?: readonly {value:string;label:string}[] }[]): void {
  for (const mapping of profile.mappings) {
    const label = categoryFields[mapping.field];
    const categorySpecific = categoryFieldScope(mapping.field) !== null || /^(관찰 카테고리:|상품고시:)/.test(label);
    if (categorySpecific && !fields.some(field => field.id === mapping.field)) {
      throw new Error(`${mapping.column + 1}열 (${label}): 현재 카테고리의 견적 항목에 없습니다. 연결 항목을 다시 선택해주세요.`);
    }
    if (mapping.choiceFormat !== 'label') continue;
    const field = fields.find(field => field.id === mapping.field);
    if (field?.type !== 'select' || !field.choices?.length) throw new Error(`${mapping.column + 1}열: 현재 카테고리의 선택형 항목에만 표시 문구 출력을 사용할 수 있습니다. 저장 코드로 바꾸거나 연결 항목을 수정해주세요.`);
  }
}

export function mapQuotationRow(profile: CategoryProfileInput, data: Partial<Record<Exclude<CategoryField, 'constant'>, string | number | null>>, fields: readonly {id:string;type:string;choices?:readonly {value:string;label:string}[]}[] = []): { values: (string | number)[]; missing: string[] } {
  const valid = validateCategoryProfile(profile);
  if (!valid.template) throw new Error('견적서 양식을 먼저 연결해주세요.');
  if (fields.length) validateQuotationChoiceFormats(valid, fields);
  const values: (string | number)[] = valid.template.headers.map(() => '');
  const missing: string[] = [];
  for (const mapping of valid.mappings) {
    const value = mapping.field === 'constant' ? mapping.constant ?? '' : mapping.field === 'categoryId' ? valid.categoryId : data[mapping.field];
    let normalized = value === null || value === undefined ? '' : value;
    if (mapping.choiceFormat === 'label') {
      const field = fields.find(field => field.id === mapping.field);
      if (field?.type !== 'select' || !field.choices) throw new Error(`${mapping.column + 1}열: 현재 카테고리의 선택형 항목에만 표시 문구 출력을 사용할 수 있습니다.`);
      // Empty input remains empty, including an intentional manual clear.
      if (normalized !== '') {
        const choice = field.choices.find(choice => choice.value === String(normalized));
        if (!choice) throw new Error(`${mapping.column + 1}열: 저장값이 현재 선택 목록에 없습니다. 견적 입력을 확인해주세요.`);
        normalized = choice.label;
      }
    }
    if (typeof normalized === 'number' && !Number.isFinite(normalized)) throw new Error('견적서에 유효하지 않은 숫자가 포함되어 있습니다.');
    values[mapping.column] = normalized;
    if (mapping.required && (typeof normalized === 'string' && !normalized.trim())) missing.push(`${mapping.column + 1}열 ${valid.template.headers[mapping.column]}`);
  }
  return { values, missing };
}

/** RFC 4180 quoted fields, embedded newlines, and a UTF-8 BOM are supported. */
export function parseTemplateText(text: string, delimiter: ',' | '\t', headerRow = 1): string[] {
  if (text.length > 2_000_000 || !Number.isInteger(headerRow) || headerRow < 1 || headerRow > 1000) throw new Error('양식 크기 또는 머리글 행 번호를 확인해주세요.');
  const source = text.replace(/^\uFEFF/, '');
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false; let closed = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"') { if (source[index + 1] === '"') { field += '"'; index++; } else { quoted = false; closed = true; } }
      else field += char;
    } else if (char === delimiter || char === '\n' || char === '\r') {
      row.push(field); field = ''; closed = false;
      if (row.length > 200) throw new Error('견적서 열은 최대 200개입니다.');
      if (char !== delimiter) {
        if (char === '\r' && source[index + 1] === '\n') index++;
        rows.push(row); row = [];
        if (rows.length === headerRow) return rows[headerRow - 1];
      }
    } else if (char === '"' && field === '' && !closed) quoted = true;
    else { if (closed || char === '"') throw new Error('CSV 따옴표 구분이 올바르지 않습니다.'); field += char; }
  }
  if (quoted) throw new Error('CSV 따옴표가 닫히지 않았습니다.');
  row.push(field); rows.push(row);
  if (row.length > 200 || rows.length < headerRow) throw new Error('머리글 행을 찾을 수 없습니다.');
  return rows[headerRow - 1];
}
