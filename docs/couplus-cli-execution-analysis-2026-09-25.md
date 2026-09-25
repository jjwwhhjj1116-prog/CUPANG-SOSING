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
