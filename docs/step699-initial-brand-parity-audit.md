# Step699 — 기본설정의 복수 브랜드와 최초 SEO 초안

2026-10-18 KST. 보관된 Couplus shipped UI/main과 기존 REA Evidence만 재사용했다. 새 producer·vendor 실행·네트워크·Chrome·원격 상품/계정 접근은0이다. 이 조사자는 이 문서 및 ignored `outputs/step699-analysis-*`만 작성했고 앱을 변경하지 않았다. 별도 backend auditor가 수행한 초기 실제 API 재현을 중복 실행하지 않았다.

## 확인한 원본 규칙

상품 생성의 createProductObject는 상품별 newProduct.brand가 없을 때 defaultSettings.brand를 사용한다. 기본설정 문자열에 쉼표가 있으면 **첫 구간만 trim**해 상품의 brand로 기록한다. 뒤의 첫 비어 있지 않은 항목을 찾는 규칙은 아니다. 따라서 `,둘째브랜드`의 기본 브랜드는 공란이다. 원본 저장 설정 전체를 이 과정에서 지우거나 첫 브랜드만으로 재저장하지 않는다.

초기 runInitialProcessing은 저장·다시 읽은 상품을 SEO executeSingleTask에 넘기고, SEO 서비스 process는 `brandName: product.brand || ''`를 옵션으로 사용한다. 그 서비스의 promptForSeo에서도 `options.brandName || product.brand || ''`에 쉼표가 있으면 첫 구간.trim()만 남긴다. prompt의 Brand 입력에는 이 정리된 값이 들어간다. 이로써 최초 기본 브랜드 목록 전체가 SEO brand 입력으로 나가는 것이 원본 규칙이라고 볼 수 없다.

이것은 **정적 입력 구성의 관찰**이다. 새 상품 saveItems 서버 응답이 brand를 어떻게 정규화하는지, 실제 모델이 그 프롬프트를 모두 따르는지, 해당 초기 SEO가 원격 저장됐는지는 이 조사에서 실행하지 않았다. 원본이 언제나 특정 완성 제목을 생성한다고 주장하지 않는다.

| 근거 | UTF-16 범위 | slice SHA-256 |
| --- | --- | --- |
| UI createProductObject | `[436576,441156)` | `d359e61ea580bfcdead25cbecbbcb27390a41394bd3ee7b6238a04f74a4e3e53` |
| UI runInitialProcessing | `[441157,442908)` | `9e1ab8af2d5ad2bd10bccbf19bdf3230cf38109f76f52227fc82c8711a2ade15` |
| main SEO process | `[216283,217373)` | `e0f4351ea916216d25d29a1ec7ee293edf96ea12a516550219f8b8902348e35e` |
| main promptForSeo | `[197696,203823)` | `fdbc62d3364b7c2a4ff87f2a2e8852edf2efec4b2051285f8ecd8e8bca732f05` |

UI artifact는 `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`, SHA-256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`다. main은 같은 폴더의 `main.a20c7114.js`, SHA-256 `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`다. 원본 bytes를 다시 확인한 좁은 slice는 `outputs/step699-analysis-brand-static.json`에 있다. main의 prompt method 경계는 TypeScript parser로 구문만 읽었고 parse failure0이며 vendor 함수는 실행하지 않았다.

REA parent `ev_cd5b12712ef6b71c2acfc13858957b76b067e15d1319aac6ac68b3c3a642258a`, 기존 초기 caller Evidence `ev_ac226470ee37b350778dd9cdc96642263193ceaa2d239b448d0761bb328ef9ed`, SEO module/writer Evidence `ev_6f9827b0f3963841858f7f1e736342f9b28b722b8092af77ffe7f723e83f40c9`를 재사용했다. 이번 prompt slice를 새 REA producer가 실행해 별도 Evidence를 발급했다고 표현하지 않는다.

## 자체에서 확인한 차이

최초 translation-apply는 linked collection context의 capturedSettings.brand 전체를 intakeBrand로 넘겼다. 일반 초기 translationBatchAdoption과 canonical Google applyInitialIntakeSeoGuidance가 이 값을 함께 사용했으며, 그 아래 title 조합은 trim만 했다. 나중에 여는 SEO session은 이미 첫 구간을 선택하고 견적서 brand 필드도 기존 기본설정 resolver에서 첫 구간을 사용했다. 따라서 초기 SEO 제목만 기본 브랜드 목록 전체를 쓰는 경로가 남아 있었다.

별도 backend auditor의 `outputs/step699-settings-brand-probe.json`에서 양사 각각19개 실제 자체 route 호출과 임시 SQLite·합성 source/provider로 이를 재현했다. 와이홉과 유앤채 모두 `첫브랜드, 둘째브랜드` 전체가 SEO 제목·연결된 품명·견적서 제목에 붙지만 brand 항목은 첫브랜드뿐이었다. captured settings/context와 공급원문은 그대로였고 외부 서비스 요청은 없다. 이 조사자는 그 결과를 읽었으며 동일 통합 경로를 다시 실행하거나 개수를 중복 합산하지 않았다.

## 최소 수정과 독립 검토

root/backend worker는 **linked captured settings를 읽는 route의 intakeBrand 계산 한 곳**에 `.split(',')[0].trim()`을 적용했다. 같은 값이 기존 일반 초기 번역 조합과 Google 초기 SEO 구성 모두에 전달된다. 저장된 기본설정·collection context의 전체 브랜드 목록, 공급자 원문, provider 번역 결과를 바꾸는 변경은 아니다. 현재 화면의 explicit 수동 SEO memo나 공유 seoGuidanceTitle을 전역 정규화하지 않는다. 직접 입력한 이름의 쉼표를 무조건 잘라내는 범위로 넓히지 않았다.

독립 검토에서는 실제 자체 route의 initializer 구문을 선택해 자체 savedRegistrationSettings와 함께 실행했다. captured settings 없음/null은 undefined, 복수 브랜드는 첫 구간, 선행 쉼표/공백 첫 구간은 공란이며 뒤 브랜드나 회사명으로 채우지 않았다. 입력 객체 불변과 일반 수동 memo의 `직접,브랜드`가 literal로 유지되는 것도 확인했다. 초기 두 caller가 같은 normalized binding을 받는 source 조건까지 **10/10** 통과했다. 전체 API/provider/browser 검증으로 표현하지 않으며 release test 합계 기여는0이다.

최종 route SHA-256은 `8d74e460bdc039815a8ead6e58fb37481fc73ad3078428a2c369224ceae32459`다. `outputs/step699-analysis-independent-review.mjs/.json`에 정확한 own expression, 관련 네 소스 SHA와 범위를 남겼다. 추가 확정 결함은 없었다. 기존 작업상품을 자동 수정하지 않았고 실제 계정·새1688 전체 수집·모든 category/form·Hub 접수/receipt는 이번 검증 범위가 아니다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`를 유지하며 조사에서 연 runtime/session 자원은 없다.
