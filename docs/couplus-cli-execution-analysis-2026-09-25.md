# 쿠플러스 CLI 로컬 소스와 작업 경로 대조 (2026-09-25)

## 근거 범위
이전에 내려받은 `work/analysis/couplus-cli/package`의 couplus-cli 1.3.2 및 readable 분석본을 정적으로 읽었다. CLI를 실행하거나 개인 인증 저장소를 읽거나 외부 비공개 API를 호출하지 않았다. 기존 설치 버전 1.2.12와 다르므로 현재 실행 중인 웹페이지의 동작을 입증하지 않는다.

## 확인 (소스)
- `rocket.tools`: addRegistration은 URL/offerId, categoryCode/path, keyword, productFeature, stepLevel을 로컬 대기열에 넣는다. 이 호출 자체가 상품 수집 완료를 의미하지 않는다.
- startQueue, runWork, setPrice, setBundle, submitRegistration은 page-channel을 통해 열린 `rocketReg` 웹페이지에 위임한다. CLI가 독립적으로 모든 단계를 처리하는 구조가 아니다.
- 단계 수준은 상품추가 / SEO·가격 / 전체 작업 / 전송의 네 종류. 작업 종류는 seo, pricing, mainImage, additionalImage, detailImage, sizeChart, koreanLabel, quotation이다.
- setBundle의 add는 원래 옵션을 남기고 새 번들 옵션을 추가한다. apply는 기존 옵션의 구성 수량을 바꾼다. add 범위 2~100, apply 범위 1~100. 상세 옵션 변환과 가격 계산 구현은 웹페이지 측에 있어 이 소스에서는 확인되지 않는다.
- submitRegistration은 Supplier 세션 준비 및 분리 등록 대상 확인 후 웹페이지에 작업을 위임한다. 공식 엑셀 일괄 업로드를 사용한다는 증거는 아니다.
- `core/page-channel`: SSE 연결 중 최신 페이지가 활성화된다. 작업 상태는 메모리에 존재하며 재시작 시 소실된다. 재연결 시 pending 전달과 running orphan 안내가 구분된다. done 상태만으로 Supplier Hub의 접수 결과를 입증할 수 없다.
- `core/category-tree-store`: categoryId/name/path/depth 캐시와 14일 TTL. 견적서 항목별 기본값은 이 모듈에 없다.

## 추정
열린 웹페이지가 CLI 작업 실행자이므로 페이지 연결·세션 유지가 자동화의 중요한 전제다. Supplier Hub를 계속 열어두는 정확한 이유와 확장 프로그램의 실행 위치는 이 코드만으로 확정할 수 없다.

## 미확인
전체 카테고리 견적 매핑/자동 기본값, 실제 1688 수집 실행 경로, 이미지 번역 품질, Supplier Hub 실제 등록 요청·접수 결과. Chrome 도구의 탭 목록은 이번 확인에서도 []여서 실페이지 대조는 수행하지 못했다.

## 앱 반영
가격 단계의 선택 옵션 일괄 편집에 번들 추가를 구현했다. 원래 옵션을 보존하고 새 ID, 지정 구성 수량, 저장 가격 정책으로 계산한다. 공급자 SKU/재고/최소주문량/포장 크기·무게는 새 번들의 사실로 확인되지 않아 공란으로 둔다. 번역 옵션명의 명시 공란도 보존한다. 미리보기·되돌리기 후 기존 옵션 저장을 이용한다. 이는 확인한 add 계약의 자체 구현이며 쿠플러스 내부 변환 알고리즘과 전부 동일하다는 주장이 아니다.

## 272. 1688 상세 조회의 서버 의존성 추가 확인 (2026-09-26)

### 확인: 내려받은 CLI 1.3.2의 정적 소스
- dist/tools/sourcing/alibaba.js의 growth.getOfferDetail은 URL/상품번호를 파싱한 뒤 remote.run('alibaba-offer-detail', [{productId}])을 호출한다.
- dist/core/remote.js는 해당 action을 POST /api/aiPage/getProductInfo로 매핑하고 배열 본문을 보낸다. 대상은 설정된 homeServer, 설정이 없으면 localhost:8080과 www.couplus.co.kr이다. 인증은 쿠플러스 세션 또는 토큰을 사용하는 코드다. 실제 인증값은 읽지 않았다.
- 따라서 이 CLI 상세 도구는 독립적인 Chrome 페이지 수집기가 아니라 쿠플러스 서버의 상세 조회 기능에 의존한다. YOOFAM PLUS에 CLI 호출만 추가해서 자체 수집을 구현할 수 있다는 근거가 아니다.
- 성공 여부는 각 응답의 result.success와 result.result를 검사한다. 응답 수와 요청 수가 다르면 오류, 일부 실패는 failed에 분리, 전부 실패는 오류다. 반환 source는 1688-openapi다.
- 도구 설명은 SKU/배송정보/속성 위치를 각각 detail.result.result.productSkuInfos / productShippingInfo / productAttribute로 안내한다. 이 정보만으로 SKU 내부 필드, 옵션 이미지 연결, 단계별 가격, 상세 이미지 추출 계약을 확정할 수 없다.
- 재귀 처리에서 4,000자를 초과한 문자열은 생략 표기로 대체하고 strippedFields에 경로를 기록한다. 따라서 CLI의 표시용 상세 결과를 원문 그대로 저장하거나 완전한 상세페이지 수집 결과로 간주해서는 안 된다.

### 미확인
- 로켓배송 AI등록 웹페이지가 이 상세 도구와 같은 요청 경로를 사용하는지, 실제 응답 구조, 해당 상세 조회의 과금 여부, 카테고리 견적 기본값과의 연결, Supplier Hub 제출 요청 및 접수 응답은 미확인이다. 검색 도구의 유료 안내를 상세 조회의 과금 근거로 일반화하지 않는다.
- 기존 supplierChrome.tabs.list()는 오류 없이 []를 반환했다. 새 창/탭/프로필을 열지 않았다. 빈 목록은 확장 고장이나 사용자 로그아웃의 증거가 아니다.

### 현재 앱과 대조 및 다음 구현 조건
- collection-result는 자체 구조의 원문 검증기이고 collection-delivery는 그 원문을 저장/상품 반영하는 경로다. 위 CLI 원시 응답을 받는 수집 실행기가 아니다. 현재 검증기는 CLI 응답을 그대로 전달하면 지원하지 않는 구조로 거절한다.
- 다음 구현에는 사용자가 지정한 기존 Chrome의 실제 상품 응답 또는 사용 권한/비용 조건이 확인된 제공자의 원문 응답이 필요하다. 원문 상품번호, SKU별 가격·수량, 옵션-이미지 관계, 상세 이미지의 누락 여부를 확인한 뒤 자체 수집 계약으로 변환해야 한다.
- Supplier Hub POST501과 실제 수집 실행기 부재를 성공 응답으로 덮지 않았다. 외부 서버 호출·유료 실행·운영 등록 및 기능 배포는 수행하지 않았다.
