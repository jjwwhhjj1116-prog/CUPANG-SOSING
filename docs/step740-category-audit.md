# Step740 — 초기 카테고리 기본값과 편집 후 견적 연결의 한정 재검수

2026-10-19 KST. 읽기 기준 HEAD `999b05b30979d369fd12274a75f9a52a345965d3`. 기존 Step693·700·706·717·718·722·727·734를 먼저 재사용하고 현재 retained route의 초기화·기본설정·SEO 저장 경계를 대조했다. 가격 입력과 갤러리 수정737–739는 재조사하지 않았다. **이 한정 범위에서 새로 확정한 구현 결함은 없다.** 앱·테스트·확장·계정 설정·기존 작업 상품을 변경하지 않았다.

## 관찰과 기각한 후보

| 경계 | 보관 원본의 정적 관찰 | 현재 자체 확인 |
| --- | --- | --- |
| 카테고리 필수 scalar 초기화 | 필수 page/object/field chain을 따라 string·number·boolean을 초기화한다. `fashionSeason`은 사계절이며 선택값은 N/A 또는 첫 값이다. | `couplus-required-v1`이 있는 captured schema에만 적용한다. 오래된 양식에 새 표식을 소급하지 않는다. |
| 상품 기본설정 | brand/businessType/importType/specialHandlingReason을 확인하고 manufacturer는 직접 쓴다. | 정확한 `couplus-paths-v1`과 설정 규칙으로 연결한다. captured 등록 설정과 제조사·수입사·연락처 공란도 보존한다. |
| 초기 legal named array | 비노출 속성은 null, 그 외 named value는 N/A. A/S·세탁/취급·첫 날짜만 정확한 이름/key로 별도 설정된다. | Step700의 server-owned 초기 고시 표식이 유지된다. 원문 재질과 Stage6 수정은 별도 표시사항이며 고시 자동 재작성 근거가 아니다. |
| 명시 SEO 저장 → 문서 | 저장한 SEO 기본 상품명과 태그를 기존 문서에 쓴다. | `couplus-seo-save-v1`이 현재 제목·clock에 정확히 연결되고 Stage7 공통/옵션 직접값·공란이 우선한다. |

검토한 마지막 후보는 `taxationSchema`였다. 원본 `applyDefaultSettings`에는 과세 설정 쓰기가 없는데 자체 resolver에는 `taxType` 설정 연결이 있어, 자체가 카테고리의 첫 enum을 덮는다는 가설이다. 그러나 현재 신규·누락 설정의 `taxType`은 빈 문자열이고 resolver는 그때 captured required 초기값으로 내려간다. 합성 enum `['면세','과세']`에서 실제 자체 결과는 **면세 / couplus-default**다. 사용자가 명시 설정한 과세가 있으면 그 설정을 쓰는 기존 추가 기능과 구분해야 한다. 현재 확보한 원본·카테고리 증거만으로 기본값 오류라 판정하거나 명시 설정을 삭제할 이유가 없다.

제조사도 초기 수집 속성으로 덮인다는 후보를 기각했다. `prepareCollectionProduct`는 owner의 captured 제조사 설정을 명시 공란까지 별도 보존하므로 원문 재질·모델과 혼동하지 않는다. Step700 초기 법적 고시와 Step706 AI 참고자료 누락, Step717 동결 카테고리, Step718 workbook 편집, Step734 SEO 번들명/표시사항 첨부는 이미 구현된 경계이며 새 차이로 집계하지 않는다.

## 순수 자체 검수

`outputs/step740-category-review.mjs`는 메모리상의 합성 schema·원문 객체와 자체 순수 TS 모듈만 실행한다. DB·원격 AI·URL fetch·vendor 함수·수집기·브라우저는 사용하지 않는다. 합성 schema는 상용 카테고리를 새로 관측했다는 증거가 아니다.

6개 단언 그룹이 통과했다: 빈 과세 설정의 category default, 초기 고시/설정 예외와 원문 분리, SEO 제목·태그의 문서 연결, Stage7 공통/옵션 직접값·공란 우선, 표식 없는 legacy와 유사 label scalar의 비확대, 나중 workspace 설정으로 captured 공란을 대체하지 않음. 준비 함수의 입력 객체와 읽은 자체 소스11개의 SHA가 검사 전후 같았다. 상세 source hash와 원본 slice hash는 `outputs/step740-category-review.json`에 있다. release 회귀 합계 기여는0이며 parent의 별도 API 검사 실패를 이 순수 결과로 덮지 않는다.

## 근거와 제한

현재 route는 `outputs/step725-current-ui/chunk-36123f1a.155d5b9e.js`, SHA256 `2fb15d370c331f65d982a886f2888b813ccae67277e87f806182c70032821664`다. 현재 범위는 UTF-16 start-inclusive/end-exclusive이며 보관 Step727 manifest의 hash를 다시 대조했다.

| 함수 | 현재 source 범위 | slice SHA256 |
| --- | --- | --- |
| initializeCoupangDoc | `[445121,449150)` | `0b7c3e36d3c1048f75303995f3f4c8a5caa89ee1c5f9455a8d9201f0fff16eae` |
| applyDefaultSettings | `[460195,465227)` | `09bbc96a570f0a975d3a1bef5ae6c41f337ac73758822f004c2b377ecee38584` |
| saveSeoData | `[199514,201506)` | `1c98c75b1737c5e08d5760512962b9f11ff05378fbc456ccaf06537882390831` |

추가 읽은 `createFieldStructure`·`createCompleteArrayStructure`의 정확한 현재 범위와 hash도 JSON manifest에 기록한다. 초기 문서 Evidence parent `ev_d49bd95d5e4610573ee111bbc753a6055e2f0913515c0f96f146f2ff50050a6b`, SEO writer parent `ev_6f9827b0f3963841858f7f1e736342f9b28b722b8092af77ffe7f723e83f40c9`와 Stage722 parent `ev_8e9a17009e057dc9e4c5a48432308c2edcfb8d712d5a3c552093e3fff505d021`는 기존 조사 범위로만 재사용한다. 새 REA producer는 실행하지 않았고 `processOptions` Evidence를 다른 함수 증거로 확대하지 않았다. VERIFY Evidence `ev_17ed0cebd00b285e0bc489221547e437d2b3f69d9b636a813eb942a0a2a3a49a` 및 summary `ev_05abd95724353b22c4ca14685b3e8dbe88bc4f0cee756eea76a4dd6873b7f42c`는 후속 등록 경계의 별도 자료이며 이 초기값 검수로 실제 접수를 증명하지 않는다.

다음 미관찰 경계는 현재 지원하는 required scalar/named-array 밖의 **실제로 확보된 비표준·조건부 카테고리 양식**이다. 보관하지 않은 구조를 합성으로 만든 뒤 ‘실제 누락’이라 판정하거나 전 카테고리 지원으로 넓히지 않는다. 원본 private 저장 서버의 추가 변환·새1688 원문 수집·전 카테고리 동등성·Supplier Hub 최종 접수는 여전히 이 검수로 확인되지 않았다. 새 세션을 열지 않았고 native live gates는 false다.

## Step740 회귀 fixture 보정의 독립 검수

parent가 바꾼 테스트2개와 대응 runtime을 읽었다. **회귀를 숨기거나 실제값 검사를 약화한 변경은 발견하지 못했다.** 작업 트리의 app/db/extensions diff는 없고 테스트2파일만 바뀌었다. 앞서 기록한 앱11파일의 SHA도 모두 같다. 이 조사자는 앱·테스트를 편집하지 않았다.

- `live-category-attribute-rules.test.mjs`는 형식이 바뀐 동일 profile PUT을200으로 기대하던 것을 기존 보호 계약의409로 바로잡고, 별도 POST201과 다른 profile ID·새 maxLength2를 추가 확인한다. 원래 profile row 전체가 같다는 검사, 기존 상품·견적 수정값 불변, 원래 captured maxLength1000, 수동 공란 보존 검사도 남는다. 따라서 새 형식을 받아들이지 않는 오류를 무시한 것이 아니라 기존 상품 형식을 바꾸지 않고 새 형식을 만드는 경계를 검증한다.
- 같은 테스트의 `否 → 아니요`는 이미 있는 로컬 번역 fixture의 명시 mapping과 일치한다. 원문값 `否`의 별도 assertion,6옵션 초안 전체, export의 번역값, 특정 옵션의 수동 공란·공통 검토 제목 검사가 유지된다. 중국어 그대로인 값을 번역 완료로 인정하는 검사를 고친 것이다. 실제 번역 서비스 호출을 검증한 것은 아니다.
- `quotation-notice-fingerprint.test.mjs`의 `initialLegalNotices` 제거는 **테스트 메모리 SQLite**에만 한다. source를 읽기 전에 새 intake 표식의 존재 여부도 assert하고 pre-Step700의 ‘표식 없는 역사적 초안’을 명시한다. 이후 actual fingerprint를 기대값으로 대입하지 않고 이전 payload 공식을 별도로 계산한다. 잘못된 이름의 scalar에서는 package/editor 지문 변경·stale409·이전 receipt 보존을, 정상 named notices에서는 이전 날짜 `2024.02`·세탁문구와 지문/receipt 동일성을 계속 확인한다. 신규 intake의 N/A·실제 생성 월·표식 보존·Stage7 수정은 별도 `intake-initial-legal-notices`/`initial-legal-notices` 검사에 남는다.
- legacy hash helper의 `productFingerprintSource`는 실제 runtime과 같은 display용 `registration_number` 한 key만 제외한다. 제목·원가·clock·content/options/settings·binding policy를 제거하지 않는다. 순수 helper 실행으로 이 한 key 이외 객체값과 원본 객체 불변을 확인했다. 별도 `quotation-registration-numbers`는 display metadata 유무가 지문에 영향을 주지 않는 계약을 직접 검사한다.

검수 source SHA256: `live-category-attribute-rules.test.mjs`=`0c87c8a2887d3527c3338ccc47cfd277589f439807cabb2079b38e7efbf10f17`, `quotation-notice-fingerprint.test.mjs`=`db032da4ec788e6c5e6a5daac9b055c6e4d36250f12a18ecbef6840d7ed77582`. 나머지 읽은 source와 log hash는 `outputs/step740-test-review.json`에 있다. `outputs/step740-test-review.mjs`의 순수/static5개 그룹이 통과했다. parent의 보관된 `step740-baseline-repairs-resolved.log`는13건 통과/실패0이며 이번 독립 검수에서13건을 재실행했다고 계산하지 않는다. 원래147건 중7실패 log나 중간 실패 log도 삭제하지 않았다. 전체 회귀 통과·실제 수집·Hub 접수까지 확대하지 않는다.
