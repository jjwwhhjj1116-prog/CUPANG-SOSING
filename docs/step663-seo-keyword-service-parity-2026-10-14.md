# Step663 — SEO 검색태그 입력과 견적서 전달 규칙

기준 commit `75eda27fe20e67cc2f397e067a062df490df6baf`, Worker `bbc475f2-40f5-4a11-b280-d6b497f7bb90`. 새 SEO 저장에 한정해 기록된 쿠플러스 클라이언트와 부분 갱신 서비스의 태그 처리를 연결했다. 기존 작업 상품·운영 DB 자료는 편집하지 않았다.

## 원본 근거와 범위

Step662의 UI `saveSeoData`는 chunk SHA `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`, UTF-16 `[198565,200557)`, method SHA `d64e11c06db33017e8e91d24023592dad3d3fd9e6f78fb6ebdd39ce3df75cc42`에 있다. raw 입력이 150자를 초과할 때만 쉼표로 나누고 trim한 배열의 가장 긴 앞부분을 `, `로 연결해 150자 이하로 만든다. 이후 쉼표 구분/trim/빈 값 제거를 하고 중복은 이 UI 단계에서 제거하지 않는다. 줄바꿈은 별도 구분자가 아니다. 부모 REA Evidence `ev_3bb1acf8440f425095be2f253be6c6b74f7c2f9c4e88f3ec9186b4151555e2af`를 재사용했고 module page `ev_f7cfa6e48c582eab129c83f280096a202953147eed27bb126431b4af011d4e93`를 조회했다.

추가 정적 분석에서 `rt=s("27c2")` 바인딩을 확인했다. UI `[195318,195330)` → main module `27c2` → import `c758` → API export 경로를 정확한 바인딩 구간으로 추적했다. 원본 main SHA는 `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`다. generic label writer `[362069,363339)`와 이 SEO writer를 혼동하지 않는다.

| 메서드 | UTF-16 범위 | SHA-256 |
| --- | --- | --- |
| cleanSearchTagKeywords | [183773,184151) | a576bcdbfe1465df9e9b46952288d783367226b886e78222d5ca6f43fe7f9a5a |
| SEO updateProductWithCoupangDocPartial | [184152,186443) | f952a16bff72658df46fe554aa1c7a089bb2bfd03bcd03eb1ecfba92d4d13e8d |
| API updateRocketProductPartial | [454856,455254) | 66b5d6675065026e562798888cdf15498e98aead22a432431ba9e1d841da017b |

SEO REA parent `ev_6f9827b0f3963841858f7f1e736342f9b28b722b8092af77ffe7f723e83f40c9`, summary `ev_c12300c5db1735ebfadafcebe3455eeba8c4e8b442b5a3a8fe2f65a4ff8cb685`. API parent `ev_e006cdc0b74f7f1fae2f8b30c1cf679cce890271da92e392f36d964404b0dd4f`, summary `ev_196c709d7d23340b0d70df7bd7c3003b6f6918db910212993982889fc3206f8a`. 비실행 선택 메서드·원본 byte/UTF-16 범위·hash·binding manifest·portable Evidence는 ignored `outputs/step663-tag-writer-audit/`에 보관했다. 원본 bootstrap/메서드는 실행하지 않았고 사이트 요청도 하지 않았다. 공개 클라이언트 API 요청 구성은 관찰했지만 비공개 서버 처리·저장 실행은 관찰하지 않았다.

서비스는 한국어 자모 `[ㄱ-ㅎㅏ-ㅣ]`가 있는 태그를 통째로 제외한다. 허용 문자 외 부분은 공백으로 바꾸고 연속 공백을 정리한 다음 trim한다. 허용 문자는 완성형 한글·ASCII 영문·숫자·공백이다. 정리 후 빈 값, 20 UTF-16자를 넘는 값, 이미 있는 값을 제외한다. 대소문자를 구별하며 최초 순서를 유지한다.

상위 `keywordsSeo`와 `seo.keywords`에는 정리된 전체 배열을 저장한다. 문서 `productPage.searchTags`만 이 배열의 `, ` 연결값을 다시 150자 prefix로 제한한다. 전체 배열은 이 두 번째 길이 처리에서 줄이지 않는다. 정리된 배열이 비면 각 문서의 기존 태그를 유지한다. 모든 `productPage`에 적용하며 옵션별 태그 보존 분기는 없었다. 같은 부분 업데이트 객체가 API와 Vuex에 전달된다.

## 재구현

`seo-keyword-text.ts`가 원문 준비, 서비스 정리, 문서 prefix를 각각 처리한다. `seo-workspace`의 새 원문 편집 경로는 `keywordText`와 정확히 일치하는 정리된 `keywords`만 받는다. 5050자 입력/금지 control/body 한도, 상품·콘텐츠·옵션 시계/owner/삭제/이미지 풀 CAS를 유지한다. 요청의 원문은 최종 콘텐츠에 저장하지 않는다. proof 없는 기존 배열 API의 기존 validation은 바꾸지 않았다.

직접 키워드를 저장한 경우에만 `seoKeywordDocument`에 전체 목록·필드 시계·문서용 값을 묶어 저장한다. 7단계 자동 검색태그는 이 exact list/clock 기준이 유효할 때만 해당 값을 사용한다. 다른 writer가 키워드를 바꾸거나 legacy 자료이면 기존 join 동작을 유지한다. 정리된 목록이 비면 이전 자동 문서 태그를 유지하며 초기 소싱 keyword seed를 되살리지 않는다. 수동 견적서 override와 직접 저장한 공란은 기존 우선순위대로 보존한다. 이 수동 override 보호는 원본의 모든 문서 태그 덮어쓰기와 동일하다고 주장하지 않는다. 원본 서비스의 다른 SEO 메타 설명/점수 초기화까지 복제한 변경도 아니다.

UI는 raw 글자 수, 길이 조정 후 prefix와 실제 최종 저장 목록을 구분한다. 성공 ACK 전에는 입력 원문을 지우지 않는다. 저장 진행과 조회 진행을 구분하고, 진행 중에 확정 실패처럼 보이는 불확실 안내를 표시하지 않는다. 새 동작은 사용자의 명시적인 저장 시점에만 실행된다.

## 검수

서로 다른 검사 총 **414개 통과**, 실패·취소·skip 0: 모델·실제 API·content/names/태그 검토 86개, actual API 기반 client/editor 67개, quotation-schema/fields/export/title/선택 SEO 및 dashboard/generator 회귀 261개. 초기 키워드 단독 입력에서 generic empty patch 검사가 먼저 실행되는 결함은 수정해 86개 최종 실행에서 확인했다. UI-only 준비 단계의 55/65개 실행이나 이전 74개 실행을 별도 최종 성공 수로 더하지 않았다. 최종 TypeScript와 변경 소스·검사 lint는 오류/경고 0이다.

동일 사용자 Chrome의 자체 합성 탭에서 실제 편집기/API/SQLite를 사용했다. 회사마다 PATCH 1회 → 다시 열기 GET → 화면·저장본·7단계 대조를 했다. 와이홉은 166자 입력의 뒤 전체 태그 제외, 자모/중국어/중복/특수문자 정리 후 `태그 하나`를 저장했다. 유앤채는 raw 123자의 31개 unique 태그를 상위 SEO에 모두 보존했다(표시 153자). 문서는 앞쪽 30개/148자였고 각 자동 견적 행과 일치했다. 두 회사 모두 **13/13 proof**를 통과했다. 최초 와이홉 12/13은 재개 직후 lazy 이미지가 아직 로딩 중이어서였으며, 실제 320×200 로딩 완료 후 GET proof만 다시 확인했다. 추가 PATCH는 없었다. 가격·포장·기존 이미지·수동 견적 제목/공란은 그대로였다.

기존 운영 상품 수정·외부 제공자·업로드·Hub 호출 0. 원문/최종 저장안을 보여주는 Chrome preview PNG는 성공해 `outputs/step663-seo-native-preview.png`에 보관했다. 저장 후 캡처는 Page.captureScreenshot 시간 초과로 성공하지 않았으므로 저장 완료 PNG가 있다고 주장하지 않는다. 최종 DOM과 두 회사 actual API/SQLite proof는 별도로 보관했다. 자체 탭과 로컬 서버를 종료했다.

## 배포와 남은 검증

Bounded build 통과. 기존 무료 Worker sourceflow에 Version `35c3566b-0542-42ab-95f0-b8b76bec2347`을 배포했다. DB migration, 준비된 extension 0.2.72, Access/R2/무료 공급자 설정은 바꾸지 않았다. 설치된 extension을 새로 확인한 것은 아니다.

Step660 D1 Free 일일 row-read 한도 제한은 reset 전이다(2026-10-15 09:00 KST). 운영 GET 우회·추가 DB·플랜 결제·인증 완화는 하지 않았으며 배포 뒤 운영 상품 readback을 반복하지 않았다. 실제 새 1688 상품 전체 SKU/이미지 수집, 전체 카테고리 동등성, Hub 동의→최종 접수→SKU 대조는 미완료다. `SINGLE_DOCUMENT_LIVE_VERIFIED`와 운영 개별 전송 gate는 false 그대로다. 이전 URL 도구 정책 거절은 다른 도구/브라우저/확장/API/REA로 우회하지 않는다.

## Release

- Baseline: `75eda27fe20e67cc2f397e067a062df490df6baf`.
- Tests: 414 distinct passing cases; types/lint 0 errors and warnings.
- Native synthetic actual Chrome: 와이홉/유앤채 each 13/13, one PATCH each. This is not a production Hub receipt.
- Deployment version: `35c3566b-0542-42ab-95f0-b8b76bec2347`; existing free Worker and bindings unchanged.
