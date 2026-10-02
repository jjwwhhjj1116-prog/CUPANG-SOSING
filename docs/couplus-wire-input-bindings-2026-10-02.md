# 단계 입력 → 실제 견적 항목 경로 연결 — 557

## 확인한 문제와 근거

이전 상세 양식 연결은 같은 구역의 표시 이름을 비교했다. 쿠플러스가 표시하는 모델 번호/거래 유형/수입 유형/박스당 입수량은 기존 모델명/거래타입/수입여부/박스 내 SKU 수량과 달라, 실제 항목이 별도 빈 입력으로 남을 수 있었다. 가격·이미지에 단위나 다른 제목이 붙어도 같은 문제가 생겼다. 같은 이름이 다른 구조에 있으면 중복 ID로 미확인 처리되는 문제도 재현했다.

근거는 556에서 2026-10-02에 재확인한 [공개 상품등록 JavaScript](https://couplus.co.kr/js/chunk-e2dd462a.8dc4d2d7.js)다. 549198바이트/SHA-256 `38aee73a04100657ed8463a6156cc096ceaf68d4f3d671f34845a9cda515d587`. 이번에는 저장한 공개 메서드의 getDefaultTitle/convertDocToQuotationData/applyDefaultSettings/cliPageSyncPricesToDoc 경로를 읽었다. 외부 코드를 실행하거나 메서드 본문을 복사하지 않았다. 로그인 응답이나 비공개 수집 서버를 확인한 것은 아니다.

공개 코드에서 옵션 공급가는 productPage.commonAttributes.purchasePrice, 판매가는 coupangSalePrice에 기록한다. msrp/osrp가 존재하면 같은 옵션 가격 계산값을 연결한다. 기본설정은 productPage의 brand/manufacturer/businessType/importType과 logisticsPage의 totalSKUsInBox/daysToExpiration/specialHandlingReason을 사용한다. 이미지·상세 HTML도 각각 images/details 아래의 명시적 항목에 연결한다.

## 구현 범위

새로 읽은 회사·최종 코드·전체 경로 양식에 `inputBindings: couplus-paths-v1`을 저장한다. 서버가 원문에서 재생성한 입력 항목의 전체 경로와 타입을 확인해 아래 25개 연결을 적용한다. 제목·부분 문자열·카테고리 이름으로 추측하지 않는다. 점이 포함된 단일 속성명과 여러 단계 경로도 구분한다.

| 실제 항목 경로 | 앱의 입력값 |
| --- | --- |
| startPage.productName / categoryPath | SEO 상품명 / 선택 카테고리 |
| productPage.modelNumber / brand / manufacturer | 6단계 모델명 / 기본설정 브랜드 / 6단계 제조사 |
| productPage.businessType / taxationSchema / importType / searchTags | 거래타입 / 과세여부 / 수입여부 / SEO 검색어 |
| productPage.commonAttributes.purchasePrice / coupangSalePrice | 옵션 공급가 / 판매가 |
| productPage.commonAttributes.msrp / osrp / productBarcode | 옵션 권장가 계산값 / 같은 계산값의 별도 OSRP 항목 / 바코드 |
| imagePage.images.mainImage / additionalImage | 옵션 대표 이미지 / 추가 이미지 |
| imagePage.details.detailedImage / htmlProductDetailContent / altText | 상세 이미지 / 상세 HTML / 대체 텍스트 |
| legalPage.kcMarkType | KC 마크 타입 |
| logisticsPage.totalSKUsInBox / daysToExpiration / specialHandlingReason | 박스 내 SKU 수량 / 유통기간 / 취급주의 사유 |
| logisticsPage.skuUnitBoxWeight / skuUnitBoxDimension | 옵션 포장 무게(g) / 포장 치수(mm) |

MSRP와 OSRP가 함께 있으면 독립 입력 ID와 원본 경로를 유지한다. 속성 순서나 표시 이름이 같아도 합치지 않는다. OSRP만 있으면 기존 권장가 입력을 해당 필드에 연결한다. 기본 계산값이 같아도 견적서의 두 수정값/공란은 각각 보존된다. 기존 가격·마진 계산식을 바꾸거나 실제 권장가 근거가 검증됐다고 처리하지 않는다.

숫자 경로가 boolean 등 맞지 않는 타입이면 값을 연결하지 않고 미확인 양식으로 남긴다. 실제 선택지·필수값·최소/최대 제약을 유지한다. 카테고리는 읽기 전용으로 연결한다. HTML은 앱 상세 편집 한도인 150000자를 유지하되 캡처 양식이 maxLength를 선언하면 그 제한을 적용한다. 일반 텍스트의 2000자 제한을 잘못 적용하지 않는다.

기존 버전 없는 작업 상품은 수집 당시 양식·ID·값을 유지한다. 카테고리 프로필을 새 버전으로 갱신해도 기존 상품에 새 연결을 도입하지 않는다. 수동 수정·직접 공란이 자동 원문/설정/가격/이미지보다 우선한다. 새 규칙에서 알 수 없는 스칼라 경로는 같은 표시 이름이라는 이유만으로 공통 입력에 연결하지 않는다. 이전 named-array 속성·고시 연결은 유지한다.

## 검증

- 수정 전 경로/중복 관련 검사 3개가 실패했고 수정 후 통과했다. 긴 HTML의 2000자 제한도 별도 검사로 실패를 재현한 뒤 수정했다.
- 신규 검사 11개는 양쪽 회사, 다른 제목·같은 제목·속성 순서·점이 든 속성명, 잘못된 타입, 버전/구형 캡처, HTML 제한을 확인한다.
- 실제 앱 API·임시 SQLite에서 유앤채 A01526306·와이홉 A01464742 각각 합성 분류 991234를 선택해 기록된 지정 상품 813724060928 응답으로 6옵션 초안을 생성했다. SEO/검색어·모델/제조사·긴 상세 설명·이미지 역할·포장 치수를 수정하고 실제 가격을 확인했다. 옵션별 견적 가격 수정, OSRP/모델/추가 이미지 공란을 저장한 뒤 실제 합성 CSV 바이트·SHA-256을 연결한 출력에서 같은 값을 확인했다. 기본설정과 수동값·출력 파일명도 대조했다.
- 합성 분류/CSV, fixture 인증·AI·이미지를 실제 판매 분류·공식 양식·운영 AI/번역·Hub 접수로 취급하지 않는다. 원격 Hub 접수 호출은 0회다. 첫 통합 검사에서 콘텐츠 GET의 응답 구조를 잘못 읽은 테스트를 수정했으며 저장 버전 검증을 약화하지 않았다.
- 전체 1846/1846(248.876초) 통과 후 긴 HTML 보완을 포함한 최종 관련 74/74(19.266초) 통과. TypeScript 및 최종 변경 파일 lint 오류·경고 0. 최종 운영 빌드·산출물·배포 결과는 아래에 기록한다.

최종 운영 빌드·11마이그레이션 산출물·확장 원본/번들/ZIP 검사를 통과했다. 기존 Worker에 버전 `02bbfe68-f907-4fd4-9b31-556688582f06`으로 배포했다. 익명 앱/분류 컨텍스트 GET에서 기존 Access 302 두 건만 확인했으며, 로그인 운영 화면이나 접수 결과를 검증한 것은 아니다. 확장 0.2.39는 유지하며 앱 새로고침으로 적용한다. 새 자원·권한·비밀·DB migration 변경은 없다.

기존 Chrome 바인딩의 `tabs.selected()`에서 선택된 작업 탭이 반환되지 않았다. 전체 탭 열거·다른 프로필/새 창·기존 거절 우회·기존 Couplus 작업 조회/수정은 하지 않았다. 남은 실검증은 전 카테고리 실제 양식·기본값·공식 Excel, 운영 URL→AI/이미지 번역·필수 서류와 두 회사의 최종 Hub 접수번호/SKU다. 전체 완성률을 테스트 수로 환산하지 않는다.
