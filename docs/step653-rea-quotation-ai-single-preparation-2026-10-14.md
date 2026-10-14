# Step653 — 쿠플러스 7단계 AI 흐름과 개별 견적 준비

2026-10-14. 사용자가 지정한 기존 Chrome에서 읽기 검수를 진행했다. 기존 쿠플러스·YOOFAM·Supplier Hub 작업 상품은 저장·수정·삭제·전송하지 않았다. 아래 구현과 합성 검수는 전체 카테고리 또는 실제 등록 완료를 의미하지 않는다.

## 확인한 쿠플러스 계약

현재 AIRocketReg chunk `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`와 main `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`의 비실행 선택 구간을 REA로 분석했다. 주 Evidence는 `ev_077d7423d18398f2639ac6cd730e4647bccc52ac3229cf3ad14e1082f97af8ad`, 보조 흐름은 `ev_83c07a874907804dbb1358ca9d2dca34e5d08620764fe99466fac2962110aa62`이다. 원본 캡처와 상세 분석은 로컬 `outputs/step653-rea-quote-contract-findings.md`, `step653-rea-image-contract-findings.md`에 보관하고 저장소에는 공급자 실행 코드를 복사하지 않았다.

7단계 클라이언트는 옵션명으로 공통/차별 항목을 분류한 뒤 공통 비노출 속성, 기타 공통 항목, 최대 10옵션 단위 차별 항목을 생성·병합한다. `workType=QUOTATION`의 task는 `ANALYZE_SCHEMA_ATTRIBUTES`, `GET_COMMON_UNEXPOSED_ATTRIBUTES`, `GET_COMMON_OTHER_ATTRIBUTES`, `GET_DIFFERENTIATED_ATTRIBUTES_BATCH_n`이다. Step652의 'AI 내부는 미확인' 범위 중 클라이언트 prompt 구성은 이번에 확인했다. 비공개 서버 내부, Gemini 실제 응답 및 모든 카테고리 기본값은 계속 미확인이다.

이미지는 main/label 단일 URL, additional 쉼표 연결 URL이다. detail은 합성 JPEG 단일 URL을 우선 저장하고 실패 시 순서 있는 URL 목록을 쉼표로 연결한다. 이번 준비기는 저장된 합성 이미지 또는 관찰된 URL-list fallback을 사용하며, 새 합성 JPEG 생성까지 구현했다고 주장하지 않는다. 수동 HTML 공란과 원본 이미지 순서는 보존한다.

## 구현

- `app/quotation-ai.ts`: 확인된 회사·Single 원문 양식·저장 버전으로 계획을 만들고 같은 분류/공통/10옵션 흐름으로 제안을 반환한다. 수동 값과 수동 공란, 제외 옵션, stage6 입력, 가격·인증·동의·실측 포장은 보호한다. 미확인 항목은 생략한다.
- `quotation-ai-provider.ts`: 실제 Workers AI의 구형 문자열/현행 chat-completion envelope/JSON-mode 객체를 정규화한다. 선택값과 field/option ID를 JSON Schema로 제한하고 코어가 별도로 원문 JSON·중복 키·자료형·범위를 검증한다. 실제 제공자가 거절한 `uniqueItems`는 생성 스키마에서 제외하되 코어 중복 검사는 유지한다. 잘린 결과·충돌한 choices·도구 호출은 거절한다.
- `quotation-ai` API와 D1 실행 이력: 현재 회원/회사/카테고리/저장 버전 및 원자적 실행 claim을 검증한다. 동일 idempotency 재조회는 모델을 다시 호출하지 않는다. 요청 시각은 요청 fingerprint에서 제외한다. 응답 불확실 상태 또는 오래된 실행은 사용자가 명시 종료하기 전 재실행하지 않는다. 계정 전체 UTC 하루 요청 상한은 40이고 유료/다른 제공자 fallback은 없다.
- 7단계 `AI 처리` → 제안 비교 → `검토한 초안 입력란에 적용` → 기존 견적 입력 저장. AI 자체가 상품을 저장하거나 전송하지 않는다. 공통값 선택 상태의 개별 실행은 차단하고 옵션 또는 전체 범위를 선택한다. React key로 상품/양식/저장 버전/선택 옵션을 분리하여 이전 응답 적용을 막는다.
- `supplier-hub-single-package` GET은 읽기만 수행한다. 검토 fingerprint의 명시 POST만 이미지 immutable 공개 사본을 준비한다. SHA/MIME/소유권/순서/원문 wire를 검증하며 다음 GET도 게시 바이트를 읽기로 검증한다. 정확히 일치하는 3개 가격 summary만 기존 wire에 이미 표현된 것으로 인정한다. 상충 값·수동 공란은 차단한다.
- Chrome 확장 0.2.66에 Single 코어·어댑터·현재 앱 proof·dispatch를 연결했다. 현재 운영 Single mutation 게이트는 **false**이다. 동의 기본 true는 실행 동의로 사용하지 않으며, 인간 확인을 위조하는 bridge 응답도 제공하지 않는다. 기존 대량 첨부/receipt 계약은 유지한다.
- 0020은 AI 이력/일일 상한 테이블을 추가한다. 전체 스키마 검수에서 발견한 기존 상품관리 runtime의 `managed_product_history`, `managed_purchase_info` 마이그레이션 누락은 추가적 0021로 맞췄다. 모두 CREATE IF NOT EXISTS이며 기존 행을 바꾸지 않는다.

## 실제 검사와 배포

무료 AI 모델 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`를 기존 Cloudflare 계정의 loopback 전용 합성 시험에서 직접 호출했다. 최종 시험은 HTTP200, 4 task, 3개 제안, **8,797ms**였다. 대상은 합성 단일 옵션이며 실제 1688 수집이나 전체 옵션 성능 측정이 아니다. 제공자 응답 envelope와 JSON schema 오류를 이 실제 시험으로 발견·수정했다. 검사 서버는 종료했다.

Cloudflare dashboard에서 Workers Free와 사전 사용량 0/10k를 읽기로 확인했다. 플랜·카드·접근 정책은 변경하지 않았다. Google 번역 `google-free/google-translate-gtx`는 유지했고 별도 quotation AI binding만 추가했다. 무료 한도 거절 시 중단한다. [Workers AI 무료 한도](https://developers.cloudflare.com/workers-ai/platform/pricing/), [JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/), [로컬 AI binding](https://developers.cloudflare.com/workers/local-development/bindings-per-env/).

회귀검사 **257/257 PASS**, fail/skip0. AI core39, API13, AI client7, provider7, Single assets27, Single receiver/adapter49, Single client5와 기존 editor/config/schema 회귀를 함께 실행했다. 전체 TypeScript·변경 파일 lint·마이그레이션 동일성·운영 build/산출물 검사를 통과했다. 로컬 81452 원본을 참조하는 2개 선택적 검사는 로컬 기록이 있어 실행됐으며, 기록 없는 환경에서는 명시 skip된다.

같은 Chrome의 합성 React 편집기에서 실제 AI 결과를 재생하고 3개 값이 **미저장 입력**에만 반영됨을 DOM으로 확인했다. 저장/Hub 전송 버튼은 실행하지 않았다. 이 화면의 screenshot 두 번은 캡처 시간 초과로 실패하여 이미지 검수로 주장하지 않는다. DOM proof는 `outputs/step653-ai-ui-native-proof.json`이다.

운영 D1에서 미적용 목록이 0020·0021 두 개뿐임을 확인하고 둘만 적용했다. 새 build를 기존 Worker `sourceflow`에 배포했다. Version **`1f0d7647-bc0c-4921-9984-ef1ddb3b2ff2`**. 기존 D1/R2/ASSETS/Access를 유지한다. 기존 Chrome에서 운영 페이지·관리자 로그인·미선택 기존 상품 1개를 읽기로 확인했다. 운영 화면 캡처 `outputs/step653-production-dashboard-native.png`는 성공했다.

확장 0.2.66 ZIP SHA-256: **`9a1bbf853e2edc6c03b6f239485c0849413f043df9fe61148aa337b969601850`**. 이전 ZIP은 보존한다. 소스 폴더/새 ZIP을 제공했으나 사용자 Chrome의 설치 확장이 실제 0.2.66으로 재로드됐다고 확인하지는 않았다. 새 서버 AI 기능에 확장 새로고침을 요구하지 않는다.

## 아직 남은 실제 등록 검증

현재 Hub 회사는 **유앤채**였다. 개별 등록 시작 화면과 중간저장 목록 232행을 읽기로 확인했으며 불러오기/삭제/저장은 실행하지 않았다. 행과 자식 DOM에는 class/type 외 문서 ID 속성이 없었다. 제목·행 번호로 기존 작업을 선택하지 않는다. 기록된 `/sr/draft/api/drafts` 직접 navigation은 ERR_BLOCKED_BY_CLIENT였고 원문 응답 구조는 확인하지 못했다. 기존 상품을 불러와 중간 동의를 시험하지 않았다.

따라서 새 문서 내용 readback, 정확한 문서 UI 연결, 현재 동의 문구/행동, 문서별 접수 ID·SKU 관찰을 아직 검증하지 못했다. **실제 견적 자동등록 완료는 미달성**이며 운영 Single mutation gate를 활성화하지 않는다. 지정 1688 URL의 이전 도구 차단을 REA/다른 API/확장으로 우회하지 않았고 실제 상품 수집 성공으로 주장하지 않는다. 모든 카테고리·기본값·1~7단계 및 실제 접수를 대조한 전체 완료율을 임의 숫자로 표시하지 않는다.

다음 검수는 새 상품의 실제 원문/이미지/실측 자료와 현재 회사의 원문 양식을 연결하고, 새 문서만 대상으로 위 네 전송 증거를 확보하는 것이다. Codex 소싱 플러그인은 그 이후 단계다.
