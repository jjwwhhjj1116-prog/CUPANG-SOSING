# Step700 — 새 URL 초안의 법적 고시 기본값 대조

작성일: 2026-10-18. 비교 기준 자체 HEAD: `93f89deefd407910aab1932f300f04d398e96ab4`.

## 확인된 차이와 범위

보관된 쿠플러스 클라이언트의 **새 상품 생성 → 초기 SEO·가격 처리**에서는 카테고리의 법적 고시 named-array가 `해당사항없음`으로 만들어진다. 기본설정에서 명시적으로 대입하는 일부 고시를 제외하면 초기 SEO명·원문 속성·제조사 설정으로 고시를 채우지 않는다. 자체는 새 URL의 원문 속성과 생성한 표시사항, 캡처한 제조사·수입자를 고시에 즉시 연결한다. 따라서 처음 7단계를 열었을 때의 초안이 다르다.

이 결론은 보관한 클라이언트의 해당 전이와 자체 순수 함수의 차이다. 현재 쿠플러스의 실제 실행, `/api/rocketReg/saveItems` 서버가 반환 상품을 다시 작성하는지, 이후 견적서 AI 작업을 실행한 뒤의 최종 값까지 확인했다는 뜻은 아니다. 기존 작업 상품을 열거나 수정하지 않았다.

## 재사용한 REA 근거

- UI/main 보관 분석: `ev_cd5b12712ef6b71c2acfc13858957b76b067e15d1319aac6ac68b3c3a642258a`.
- 초기 문서 메서드: `ev_d49bd95d5e4610573ee111bbc753a6055e2f0913515c0f96f146f2ff50050a6b`.
- 초기 생성·작업 경로: `ev_ac226470ee37b350778dd9cdc96642263193ceaa2d239b448d0761bb328ef9ed`.
- SEO writer: `ev_6f9827b0f3963841858f7f1e736342f9b28b722b8092af77ffe7f723e83f40c9`.

실제 원본은 다음 로컬 보관 파일이다. 새 수집·분석 producer나 vendor 코드 실행을 하지 않았다.

| 보관 원본 | SHA-256 |
| --- | --- |
| `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js` | `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc` |
| `outputs/step652-current-couplus/main.a20c7114.js` | `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad` |
| `outputs/step650-official-81452-profile-after.json` | `1652a076a3af43c5416c01df646513bacc4e74275aab17d05bf3d29ba6bfa814` |

범위는 UTF-16 start 포함/end 제외이며 SHA는 **원본 slice의 UTF-8 bytes**이다. selected-wrapper 파일의 SHA와 혼동하지 않는다. 과거 문서의 wrapper SHA를 이 slice의 SHA로 재사용하지 않았다.

| 원본 메서드 | 원본 | 범위 | Slice SHA-256 |
| --- | --- | --- | --- |
| `createProductObject` | UI | `[436576,441156)` | `d359e61ea580bfcdead25cbecbbcb27390a41394bd3ee7b6238a04f74a4e3e53` |
| `processOptions` | UI | `[466662,469077)` | `4a5671380c795a5b6e598bc3abfcdf54cb66318a62119f43478964ee68b0e3f0` |
| `initializeCoupangDoc` | UI | `[444537,448566)` | `0b7c3e36d3c1048f75303995f3f4c8a5caa89ee1c5f9455a8d9201f0fff16eae` |
| `createCompleteArrayStructure` | UI | `[457562,458219)` | `f65819b5c5808e9d5188db14f40163bfb344c6b73d05a7020c8420188d24d9c0` |
| `applyDefaultSettings` | UI | `[459611,464643)` | `09bbc96a570f0a975d3a1bef5ae6c41f337ac73758822f004c2b377ecee38584` |
| `runInitialProcessing` | UI | `[441157,442908)` | `9e1ab8af2d5ad2bd10bccbf19bdf3230cf38109f76f52227fc82c8711a2ade15` |
| 초기 SEO writer | main | `[184152,186443)` | `f952a16bff72658df46fe554aa1c7a089bb2bfd03bcd03eb1ecfba92d4d13e8d` |
| module0d1a 초기 가격 writer | main | `[158769,160673)` | `06bc5014d2b3be4f68095809b317af62f032c8147ef71cb6dc16ebda5b9b3a0d` |

## 원본에서 관찰한 전이

1. `createProductObject`는 수집 응답을 `processOptions`에 넘겨 새 옵션을 만들고 `initializeCoupangDoc(createResult,defaultSettings,rocketRegInfo,options)`를 호출한다. 이 `processOptions`의 새 옵션에는 `coupangDoc`가 없다.
2. initializer는 `createResult`에서 첫 `startPage`를 기본 문서로 복사한다. 입력의 `legalPage` 전체를 복사하지 않는다. 선택 schema의 필수 page/field와 named-array를 적용한 뒤 옵션마다 deep clone한다. 기존 per-option `coupangDoc`가 있으면 merge하지만 위 새 옵션 분기에는 해당하지 않는다.
3. `createCompleteArrayStructure`는 `allOf[].contains.properties`의 첫 enum 값을 이름으로 쓰고, 둘째 속성은 `unexposedAttributes`일 때 null, 나머지는 `해당사항없음`으로 설정한다. 실제 보관 81452 schema에서 root는 `legalPage`를 요구하고 그 page는 `notices`를 요구한다. `notices.allOf`에 정확한 `품명 및 모델명`(스포츠용품, template249)이 존재한다.
4. `runInitialProcessing`가 요청하는 작업은 순서대로 `seo`, `pricing` 두 개이다. 이 단계에서 `koreanLabel`/`quotation` 작업을 요청하지 않는다.
5. 초기 SEO writer는 기존 문서의 `startPage.productName`, `productPage.searchTags`와 상품·옵션 SEO 상태를 갱신한다. 이 메서드에 `legalPage` 쓰기가 없다. 초기 가격 writer도 `productPage.commonAttributes`의 공급가·판매가·MSRP/OSRP와 옵션 가격·상태만 갱신하며 `legalPage`를 쓰지 않는다.

### 추가 확인 — 6단계 저장도 고시를 다시 쓰지 않는다

원본 `saveManualLabels` UI `[150334,152482)`, SHA-256 `44c4e768b548e7c8e215de4eea359c1bea618cd4a1765923ceac9982be92c4ce`는 `koreanLabels`, 구조, 이미지, 완료 상태와 각 옵션의 표시사항을 저장한다. 기존 `coupangDoc`에서 바꾸는 것은 `imagePage.images.labelImages`의 한글표시사항 이미지 파일이다. **이 메서드에는 `legalPage` 또는 `noticeItemValue` 쓰기가 없다.**

main module8efc의 자동 표시사항 writer `[362069,363339)`, `handleResult` `[365824,368991)`, `applyBatchLabelResults` `[377588,380631)`도 같은 한계에서 읽었다. 이 세 구간에도 위 법적 고시 쓰기가 없다. 정확한 SHA와 11개 정적 단언은 `outputs/step700-analysis-label-save-static.{mjs,json}`에 보관했다. vendor 함수를 실행한 것이 아니다.

따라서 6단계 표시사항을 저장하면 초기 법적 고시 정책을 통째로 해제한다는 설계는 보관된 클라이언트와 맞지 않는다. 첫 감사에서 ‘명시적 6단계 저장은 고시에 우선’이라고 제안했던 부분은 기존 자체 연결의 호환성을 고려한 **설계 추론**이었으며, 이 추가 exact-writer 근거로 정정한다. 새 정책이 있는 상품은 6단계 저장 후에도 초기 법적 고시 기본값을 유지하고 7단계의 정확한 고시 수정 또는 해당 견적 writer가 변경한 값을 우선해야 한다. 표식이 없는 기존 상품의 기존 표시사항 연결은 별도로 유지한다.

### 기본설정이 고시에 쓰는 예외

읽은 `applyDefaultSettings`의 `legalPage.notices` 변경은 아래 네 갈래다. 제조사와 수입자를 모든 고시에 자동 대입하는 로직은 없다.

| 조건 | 정확한 대상 고시 | 값 |
| --- | --- | --- |
| `asInfo` truthy | `A/S 책임자와 전화번호` | `asInfo` |
| `washingMethod || handlingPrecautions` | `세탁방법 및 취급시 주의사항` | 기존에 확인한 세탁/취급 문구 결합 규칙 |
| `manufactureDate` truthy | 배열에서 먼저 찾은 `출시년월` 또는 `제조년월` | 직전 월 |
| `품질보증기준`의 기존 값이 falsy | `품질보증기준` | 소비자분쟁해결기준 문구 |

마지막 조건은 초기 `해당사항없음`이 truthy이므로 일반적인 새 named-array에서 작동하지 않는다. `manufacturer` 설정은 `productPage.manufacturer`에 쓰며 법적 `제조자(수입자)`에 쓰지 않는다. `importer`는 이 메서드의 입력 참조에 없다. 이 차이를 이유로 productPage의 정상 기본설정 연결을 제거해서는 안 된다.

초기 named-array 생성은 원본 schema의 첫/둘째 property key를 일반적으로 사용하지만, 위 설정 예외의 lookup과 쓰기는 고정된 `noticeItemName`/`noticeItemValue`이다. 따라서 같은 `legalPage.notices`에 속해도 다른 name/value key를 쓰는 항목은 N/A를 유지하고 설정 예외를 받지 않는다. 날짜의 ‘첫 번째’ 역시 이 고정 name key로 실제 찾을 수 있는 날짜 중 첫 항목이다. 설정 예외를 모든 임의 named-array key로 확장하면 원본과 달라진다.

직전 월 계산의 시각은 `applyDefaultSettings` 안에서 평가하는 `new Date`이다. 설정 저장 시각이나 카테고리/URL 요청의 캡처 시각을 읽지 않는다. 원본 새 생성 함수가 initializer를 호출하는 시점에 계산하므로 자체 신규 promotion에서 받은 `now`가 대응한다. 원본 `Date.setMonth`의 31일 overflow를 다시 도입할 근거로 삼지 않는다.

## 자체 코드와 순수 재현

현재 `prepareCollectionProduct`는 `collectionLabelAttributes`로 원문 재질·모델·구성품·제품치수·국가를 표시사항 초안에 반영한다. 캡처한 제조사·수입자·연락처는 명시적 공란까지 보존하기 위해 표시사항 provenance를 `manual`로 저장한다. 이어 `fillLabelDraft`가 상품명과 일반 표시사항을 생성하고 `labelProductNameLinked`를 설정한다. `quotation-schema`는 이 표시사항을 고시에 연결하며 자동값이 비었을 때만 Couplus N/A 기본값으로 내려간다.

합성 원문(offer123)과 자체 함수만 실행한 결과다. 실제 상품 URL의 내용을 읽은 결과가 아니다.

| 고시 | 원본 새 클라이언트 문서 전이 | 자체 새 URL 초안 |
| --- | --- | --- |
| 품명 및 모델명 | 해당사항없음 | 원문명; 이후 최초 SEO명을 따라감 |
| 재질 | 해당사항없음 | 원문 속성 `尼龙` |
| 크기 또는 크기, 중량 | 해당사항없음 | 제품치수 원문 `31 × 19 × 7 cm` |
| 제조자(수입자) | 해당사항없음 | 캡처 제조사·수입자 문구 |
| 제조국 | 해당사항없음 | 생성된 기본 표시사항 `중국` |
| A/S 책임자와 전화번호 | 캡처 연락처 | 캡처 연락처 — 이 항목은 일치 |

80719 기록 양식, 81452 기록 양식, **실제 보관 81452 Hub schema** 세 경로에서 같은 차이를 확인했다. 각 경로는 초기 값, SEO 이후 값, 기존 표시사항 연결, 고시 수동값·공란 보존, 제조자/국가/재질 차이를 검사했다. 이 결과는 **수정 전** 자체 동작을 기록한 15개 순수 단언 통과다. 그중 표시사항 저장 후의 고시 연결은 원본 동등성을 뜻하지 않으며 위 추가 원본 감사에서 차이로 분류했다. release test 합계 기여는0이며 별도 API 통합 검수를 대체하지 않는다.

재현 파일:

- `outputs/step700-analysis-initial-notice.mjs`
- `outputs/step700-analysis-initial-notice.json` — 실제 원본 범위·SHA, 실제 schema 항목, 자체 파일 SHA, 고시별 결과와 제한 기록.

## 권장하는 최소 수정 경계

새 수집의 promotion 시점에만 server-owned 초기 고시 정책을 만들고 동결된 category/schema identity와 연결하는 것이 안전하다. 표시사항·SEO·원문 값 자체를 삭제하거나 N/A로 바꾸지 말고, **초기 법적 고시 resolver에서만** 원본 named-array/default와 위 명시적 기본설정 예외를 우선한다. 정확한 `legalPage.notices` 연결 또는 기존에 확인된 기록 양식에만 적용해야 한다. 비슷한 label을 가진 다른 배열·productPage 속성·선택되지 않은 카테고리로 확대하지 않는다.

표식이 없는 기존 상품은 현재 해석을 그대로 유지한다. `seoTitleDocument`만으로 신수집 여부를 판별하면 기존 상품의 수동 SEO 저장에도 이 표식이 생기므로 충분하지 않다. 단순 `provenance==='manual'`도 충분하지 않다. 현재 초기 제조사·수입자에는 이미 그 provenance가 붙어 있고, 이는 6단계 검토 저장과 구별되어야 한다.

6단계 표시사항 저장은 고시 저장과 별도로 취급한다. 동일한 값·공란을 포함한 표시사항은 정상 저장하되 그 동작만으로 초기 고시 정책을 해제하지 않는다. **7단계 공통/옵션 수동 고시값·공란과 명시적인 견적 AI 결과**는 기존 override 우선순위를 지킨다. 새 표식은 클라이언트 patch로 임의 주입되지 않아야 하며 category가 달라지거나 유효한 초기 근거가 없으면 그 정책을 적용하지 않는다. 기존 작업 데이터의 일괄 migration은 제안하지 않는다.

## 미확인과 제외

- 보관 클라이언트는 saveItems 응답의 `savedItems[0]`가 있으면 이를 사용한다. 서버가 고시를 추가 변경하는지와 현재 live 결과는 알 수 없다.
- 별도로 실행하는 한글표시사항/견적서 AI 작업은 이후 고시를 변경할 수 있다. 그 이후의 모든 값이 계속 N/A라는 주장은 하지 않는다.
- 실제 Supplier Hub 접수·전송 승인 상태를 검증하지 않았다. 기존 live verification gate를 바꾸지 않는다.
- 포장 무게·사이즈·물류 단위를 추정하지 않았으며 pricing/MSRP/brand의 완료된 변경을 반복하지 않았다.
- 초기 감사와 독립 앱 검수에서는 앱·테스트·Git을 편집하지 않았다. 이후 별도로 할당받은 세 회귀 테스트의 legacy fixture만 아래와 같이 수정했다. 앱·Git 편집, 네트워크, 브라우저, vendor 실행, 운영 데이터 쓰기는 각각0이다.

## 최종 구현 독립 검수

구현 담당자가 동결한 5개 앱 파일을 읽고 자체 순수 함수와 합성 fetch 응답만으로 경계를 확인했다. 1차16개 검수 후 대체 name/value key의 설정 예외 경계 차이를 추가로 발견하여 구현 담당자가 수정했다. `outputs/step700-analysis-independent-review.{mjs,json}`에 최종 SHA와 **17개 단언 통과**를 기록했다. 이 숫자는 위 수정 전15개·정적11개·1차16개와 합산하지 않으며 release test 합계 기여는0이다. 다른 담당자의 실제 API·SQLite·UI 통합 검수를 반복하지 않았다.

| 동결 앱 파일 | SHA-256 |
| --- | --- |
| `app/initial-legal-notices.ts` | `fe4dd8cc30ae15206543522205a568da104116f877ffd2b1e3e695d55dbb0252` |
| `app/collection-product.ts` | `7aad1dffaa9f3e047163bf0ad64eb0a9f24fb047aaf2c2435dfb45a455d0aa03` |
| `app/product-content.ts` | `4aeefec3b91ff1864f3ca94c519091c44a81375a631dd9781cda552c2e0a9002` |
| `app/quotation-schema.ts` | `9c18cf5d03d0417bd113ae7eab32bfeb1ca653bc4d5008f168a28af6370f7096` |
| `app/intake-seo.ts` | `88dfa890c5c1fae721eb1106066c38ec81cc19bc332aeda25df70a44748de5b2` |

최종 검수 결과 미해결 실제 결함은 발견하지 못했다. 대체키 예외 문제의 수정 전 재현은 `outputs/step700-analysis-alternate-keys-before.json`에 보관했다. 원본 고정키 조건과 달리 초기 구현은 다른 key의 A/S·날짜에 설정을 적용하고 뒤의 canonical 날짜를 놓쳤다. 최종 구현은 builder·reader·첫 날짜 선택을 모두 같은 고정키 조건으로 제한한다. 이전16개 review JSON도 `outputs/step700-analysis-independent-review-before-alternate-keys.json`으로 남겼다.

새 초기 고시 표식은 새 수집에서만 생기며 캡처 원문·별도 표시사항 값은 유지한다. 6단계 표시사항 저장으로 표식을 해제하지 않는다. 표식이 없는 기존 데이터는 기존 연결을 유지하고, 7단계 공통/옵션 수동값·공란과 명시적 견적 변경은 기존 override로 우선한다. 초기 설정 예외의 정확한 고시명·고정 name/value key, 첫 eligible 날짜 고시만 적용하는 순서, 새 생성 `now`의 이전 월을 확인했다. 별도 6단계 표시사항의 캡처 시각 기준 날짜는 바꾸지 않는다.

인증 scalar, 동일한 label을 가진 `certificates` 배열·productPage 속성, 미확인 static 필드는 새 고시 표식에서 제외된다. 손상된 표식, 항목 누락·중복, 비원시 source tag, 바뀐 category/path/field signature는 전체 표식 적용을 중단한다. 클라이언트 content patch로 표식을 주입·삭제할 수 없다. 새로운 승인 대기 source-ready 분기도 prepared 요청을 승인·실행·적용하지 않으며, 만료·다른 상품·실패/유실 ACK는 ready로 표시하지 않는 것을 별도로 확인했다.

첫 독립 probe는 서로 다른 VM realm 객체에 `deepStrictEqual`을 사용해서 실패했다. 값이 바뀐 앱 결함이 아니었고, 해당 보존 검사를 JSON 값 비교로 수정한 뒤 1차16개가 통과했다. 대체키 수정 후 그16개와 새 경계1개를 최종 소스에서 다시 실행하여17개가 통과했으며, 검사 전후 앱 파일 SHA도 같았다. 이 검수는 현재 쿠플러스 live 실행이나 Supplier Hub 접수 완료 증거가 아니다.

### 기존 notice source-binding 회귀의 legacy 범위 명시

추가로 할당된 `tests/quotation-fashion-notice-linkage.test.mjs`, `tests/quotation-other-goods-notice-linkage.test.mjs`, `tests/quotation-live-notice-linkage.test.mjs`의 회사별 API 시나리오는 기존 표시사항→고시 연결과 수동 공란·옵션 색상·XLSX·fingerprint를 보호하는 시험이었다. 새 수집 직후의 기본값을 바꾸는 시험과 목적을 구분하기 위해 제목을 legacy로 명시하고, 합성 수집 후 **로컬 fixture content의 초기 고시 표식만 제거**하여 업데이트 전 상품 상태를 구성했다. 신수집 시 표식 생성과 legacy GET에서의 부재를 각각 단언한다.

원문·category context·가격·회사·정확한 wire ID·6SKU·수동 공란·공통/옵션 override·최종 Excel·hash 단언은 완화하지 않았다. 새 수집의 Stage6 이후 고시 기본값 보호는 별도 `tests/intake-initial-legal-notices.test.mjs`에 있음을 주석으로 연결했다. 처음 두 파일9개 통과 후 세 번째가 추가되어 최종 **3파일12개 모두 통과**, 실패·취소·skip0, diff whitespace 검사도 통과했다. 이 합계는 첫9개를 포함하며 root의 최종 회귀 합계에 중복 가산하지 않는다. `outputs/step700-analysis-legacy-regression.json`에 최종 세 테스트 SHA와 실행 결과를 보관했다. 운영 데이터는 변경하지 않았다.
