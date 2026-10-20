# REA 재대조와 수집본 → 편집 초안 보완

기준 커밋은 `b88b3ab`이다. 갱신된 REA skill과 upstream v37 지침을 읽고 RS 설치 산출물과 현재 Couplus 배포 자산을 다시 대조했다. 기존 사용자의 상품을 초안·편집·전송 검수에 사용하지 않았다.

## 확인하여 수정한 차이

RS 1.0.88의 설치된 1688 collector는 최소 주문 수량(MOQ)을 수집하지 않는다. Couplus의 상품조회 결과는 `minOrderQuantity`를 보관하지만 관측한 초안 경로에서 이를 필수 조건으로 막거나 판매 구성 수량으로 대체하지 않는다. 우리 수집함은 MOQ가 미확인이면 다른 필수 정보가 있어도 초안을 막고 있었다.

이를 수정하여 공급자 SKU·양수 위안 원가·CNY 통화가 확인된 상품은 MOQ `null` 상태로 초안을 작성할 수 있다. 미확인 경고를 표시하고 가격 편집 화면에서 확인하도록 한다. 미확인 값을 1로 채우지 않으며 provenance는 `unverified`다. 확인된 양수 정수는 기존 값과 `collected` 출처를 보존한다. 누락·문자·0·음수·소수·무한·안전 정수 범위 밖 MOQ는 여전히 거절한다. 판매 구성 수량과 박스 SKU 수량은 별개이며 가격 계산에 MOQ를 섞지 않는다.

카테고리 선택 후 상품화하는 요청에도 선택한 수집본의 ID·URL·fingerprint·revision·실제 수신 시각을 전달한다. 서버는 회원·회사를 확인하고, 원자 INSERT에서 같은 수집본·수신 결과·context인지 재검사한다. 그 사이 원문 보완이나 다른 회사·수신 결과로 바뀌면 409로 거절하고 상품 및 동반 데이터는 쓰지 않는다. 기존 body 없는 호출과 이미 연결된 상품의 재사용 동작은 유지한다.

공식 카테고리 schema의 `legalPage.certificates` 안에 있는 명시적 `certificateName`/`certificateValue` 쌍도 인식하도록 수정했다. 두 값이 각각 단일 enum이어도 이름과 값의 역할이 뒤바뀌지 않는다. 다른 경로의 비슷한 필드에는 이 예외를 적용하지 않는다.

## 현재 REA 근거와 한계

- 현재 RS 1.0.88의 content/background/bridge/origin 자산 SHA는 보관된 Step747 자산과 같다. 동일 입력에는 기존 REA module 결과를 재사용했다. RS 웹은 새 읽기 탭에서 로그인 화면이 확인되어 그 이후 동작은 현재 관측으로 주장하지 않는다.
- 현재 로그인된 Couplus 페이지에서 관측한 script URL만 내려받았다. `outputs/step754-current-couplus/inventory.json`에 다섯 파일의 원본 URL·크기·SHA를 기록했다. AIRocketReg route SHA는 `5b92873c674c4b76c0e6ce4961caedbf8728ca86f6a15b6d9dc8cdfce80ad1d9`, main SHA는 `027a17c12b60164e856058cbe449b827d38bf1ec0f7d98bb23acbff2c6c25b67`이다. 이전 보관 route와 다른 입력은 새 분석 대상으로 분리했다.
- 상품조회·MOQ·이미지 번역·가격 helper의 확실한 연결과 미관측 경계를 `outputs/step754-rea-collection-legal-review.json`에 구분했다. 공개 client 함수만으로 서버 내부 상품조회 provider, 유료 계약, 모든 카테고리의 실제 기본값이나 로컬 AI 필요 여부를 확정하지 않는다.
- 새로운 두 REA parent는 `ev_69740e390a2cc1e539a4a65a84e5c7065e2e6db9dcbc8a6311d0b4bfce5a3166`와 `ev_3fc8249a40ae76ed7952dd06b962e3f23198d763baf258555dead1511267fdce`다. 각각 현재 route의 21개 메서드와 main의 6개 선택 범위에 한정한다. UTF-16 범위·원문 및 wrapper SHA를 다시 검증했다. semantic unknown은 2,860개와 781개이며 전체 시스템 분석 완료를 뜻하지 않는다.
- AIRocketReg의 `at=s("48cd")` → `updateOptionPricing` → main의 `resolve/purchaseCost/fixedSellingPricing`는 정적으로 연결됐다. 기존 `app/pricing.ts`의 통합 원가 정책은 유지했다. 이미지 번역은 main 서비스 → OCR/번역 API 및 확장 `AI_TRANSLATE` 경로이며, 이 범위에서 별도 로컬 모델 설치가 필수라는 근거는 없다. 확장 뒤 실제 AI provider와 CLI 실행 여부는 미확인이다.
- 같은 Chrome의 자체 분석 탭에서 기본설정을 열려고 했으나 목록에 진행 중인 SEO 상태가 나타났다. 설정 내용을 읽었다고 주장하지 않으며 해당 탭을 닫았다. URL 입력·작업개시·상품 저장·전송·삭제는 실행하지 않았다. 원래 사용자 탭은 닫지 않았다.

## 실제 코드 검수

`tests/source-moq-draft.test.mjs`는 실제 로컬 API·SQLite에서 두 회사 각각 수집함 → 선택본 → collect → product → SEO → 옵션·가격·견적 연결을 검증한다. null/1/5 MOQ 보존과 출처, 동일 원가의 동일 계산, 판매 구성 3개·박스 50개 분리, 수동 공란의 재실행 보존, 기존 상품·원문·접수 기록 불변을 확인한다.

실제 React 화면에서도 합성 수집본 v2의 SKU·7 CNY·MOQ null → 저장 분류 80719 → 상품 및 원본 이미지 초안 → SEO 수동 상품명·자동 견적 태그 공란 저장을 확인했다. 새 합성 상품 ID는 `ec066b87-9678-437f-bff5-72bb291523ea`다. 기존 합성 상품·원문·접수 SHA는 같다. `outputs/step754-browser-qa/proof.json`과 `source-warning.png`, `seo-saved.png`에 보관했다. 이 검수의 AI·카테고리·상품·이미지는 합성 응답이며 외부 1688 및 Supplier Hub 요청은 0이다.

첫 회귀 실행 570개 중 2개 실패는 이전 기준선에서도 재현된 제조자·수입자 고시 기대 불일치였다. 기존 정책은 초기 고시 `해당사항없음`과 한글표시사항의 회사별 제조사·수입자를 분리한다. 앱 정책을 바꾸지 않고 테스트를 고쳐 초기 기본값, 수동 고시 수정, 실제 XLSX 재해석과 다른 옵션 보존을 함께 검증했다. 첫 로그를 보관했다. 다음 실행의 최소 지원 버전 단언도 배포 버전과 호환 버전이 같다는 잘못된 가정을 수정했다. 최종 고유 테스트 수·결과는 `outputs/step754-related-final-proof.json`을 따른다. 집중·반복 실행은 합산하지 않는다.

## 운영 범위와 남은 작업

확장 패키지는 2.1.5이며 84개 파일·966,870바이트, SHA256 `10928a7d26b86b954cb48b38b5b40ce32d65db3bfa7bc3701b75206be671b8a3`이다. 공통 validator를 포함한 생성 모듈과 ZIP 원본 일치를 확인했다. 웹의 최소 호환 버전은 2.1.4를 유지하므로 기존 2.1.4 사용자에게 추가 새로고침을 요구하지 않는다. 이번 턴에 설치된 Chrome 확장을 2.1.5로 전환했다고 주장하지 않는다. 새 권한·유료 provider·리소스·DB migration은 없다.

실제 새 1688 수집과 전체 카테고리 동등성, native 법적 서류 원본 전송·전체 옵션 접수는 아직 검증되지 않았다. native 첨부는 schema 행과 bucket을 명시적으로 연결해야 하며 일반 업로드를 인증 파일로 추정해서는 안 된다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`, `PRODUCT_DOCUMENT_LIVE_VERIFIED=false`를 유지한다. 기존 자동 승인 검토에서 거절된 1688 대상에 다른 도구·확장·CLI·서버로 접근하지 않았다. 실제 접수 완료나 임의 완성률을 보고하지 않는다.

최종 40개 고유 파일의 586개 검사가 전부 통과했다. 실패·취소·skip·todo는 0이며 입력 1,462개 파일의 검사 전후와 배포 후 SHA가 같다. 타입, 린트(오류 0·생성 파일 무시 경고 1), 46테이블·17인덱스·30모듈 schema 검사, 생성 모듈 및 ZIP 일치 검사와 운영 빌드가 통과했다. 공통 validator의 생성 파일을 갱신하기 전 첫 빌드 실패와 두 번의 이전 회귀 실패 로그도 보존했다. 이후 실패를 고친 최종 실행만 통과 수에 포함한다.

기존 무료 Worker 배포 버전은 `6aaae306-9529-4fd3-8eca-3809fe99d82d`다. 배포 후 같은 Chrome 2에서 원래 앱 탭이 없어 새 자체 탭으로 확인했으며 Cloudflare Access와 Cloudflare 로그인 폼이 표시됐다. 기존 SSO 링크를 한 번 선택했지만 로그인은 복원되지 않았고 자격 증명을 입력하지 않았다. 따라서 운영 앱 내부 화면 재확인에는 도달하지 못했다. 해당 자체 검수 탭과 로컬 검수 탭·서버는 정리했으며, 원래 사용자 탭은 닫지 않았다. 종합 증거는 `outputs/step754-final-validation.json`이다.
