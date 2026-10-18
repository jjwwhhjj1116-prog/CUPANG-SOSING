# Step691 — SKU 배열이 빈 상품의 최초 초안 대조

2026-10-18 KST. 기존 Step690 이후의 초기 수집 경로를 대조했다. 설치된 REA 6.4.0과 upstream version37 지침을 읽고, 이미 보존한 Couplus shipped JavaScript를 inert text로 조사했다. 실제 Couplus·Supplier Hub·1688·운영 DB·기존 작업 상품에는 접근하거나 변경하지 않았다. 원본 bootstrap이나 메서드를 실행하지 않았으며 아래 vendor 동작은 **정적 관찰**이다.

## 결론

원본에는 `productSkuInfos`가 없거나 빈 경우 상품 자체를 한 개의 기본 옵션으로 만드는 명확한 분기가 있다. Step690 기준 자체 `app/alibaba-product-result.ts`는 빈 배열도 ‘실제 옵션 1~200개가 필요합니다’로 거절한다. 이는 초기 URL 원문이 있어도 초안 생성 전에 멈추는 구체적인 차이다. Step660에서 실제 SKU가 있는 경우의 원가 규칙을 먼저 구현했으며, 무SKU 분기는 별도 범위로 남겼던 부분이다.

다만 원본의 느슨한 누락 판정까지 그대로 복제하면 부분 응답을 무옵션 상품으로 오인할 수 있다. 자체 지원은 **명시적인 빈 배열과 검증된 상품 단위 원문**에 한정하고, 공급자 SKU가 없었다는 증거를 별도로 보존해야 한다. 내부 기본 옵션 식별자를 실제 1688 SKU처럼 표시·저장하지 않는다.

## 원문 식별과 REA 재사용

| 항목 | 근거 |
| --- | --- |
| 보존된 UI | `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js` |
| 원본 SHA-256 | `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc` |
| `processOptions` 범위 | UTF-16 `[466662,469077)`, 끝 제외 |
| 구간 SHA-256 | `4a5671380c795a5b6e598bc3abfcdf54cb66318a62119f43478964ee68b0e3f0` |
| 선택 wrapper | `outputs/step660-intake-rea-selected/03-processOptions.js` |
| wrapper SHA-256 | `7ce56d2c6afdeefff4691bb422334787c8d256c27b7138e5703a38b2d5ac1da9` |
| 기존 parent | `ev_1983224a44e1100a435aca7caaa76ebb6e1d9df782252092d57dcc695765e8ee` |
| 기존 summary | `ev_c09a0b073aa2961fa6660da9d2e95275f34d4826dd950a1c0e9c5abf833a086a` |

이번 읽기에서도 전체 파일·정확한 구간·wrapper 세 SHA가 모두 일치했다. 위 기존 분석은 선택 파일12개, AST4,209개, parse failure0이다. standalone wrapper의 외부 Vuex/import/`this` 관계와 실행·저장은 확정하지 않는다. 기존 semantic unknown887개를 실행 보장으로 확대하지 않는다.

새 MCP 연결에서 Step690의 editor retained ID는 없었고, 이를 이유로 원본 producer를 다시 실행하지 않았다. 보존된 portable `step662-rea-seo-evidence-bundle.json`을 실제 REA `import_evidence_bundle`로 검증해 16 records를 재사용했다. 후속 module page Evidence는 `ev_9810e0a0227f66e171f0bd939d6e4ad86f20aef8747979b60b6120e809b84511`이고, parent는 `ev_3bb1acf8440f425095be2f253be6c6b74f7c2f9c4e88f3ec9186b4151555e2af`이다. 이는 SEO save 모듈 재사용 근거이지 무SKU 분기의 새 실행 증거가 아니다. 이번에 native/browser session은 열지 않았다.

금일 공개 버전을 확인한 별도 담당이 격리된 REA **6.5.0**의 실제 CLI를 설치·검사했다. 기존6.4 MCP/runtime는 교체하지 않았다. 새 버전의 `selected_sources` 기능으로 위 디렉터리 중 **`03-processOptions.js` 한 파일만** 선택한 정적 분석을 수행했다. parent Evidence는 `ev_5869fb5a1a6ec67485ac76e74414a221ecb4eb7a035d0344c07e66b28c7bcec2`, summary는 `ev_40f57053660d6ff48348b5af5719c9cd3a761514c4acbf5cdeb4b62b7cadf68a`이다. 원래 디렉터리 digest `959916d15ab8ecefcc629cc69d164fbe39452294fcf6a1de927b3ca01c520919`를 유지하며 2,531바이트·파싱1파일·AST558개·parse failure0을 보고한다. 나머지11파일은 inventory identity에만 포함되며 분석 범위 밖이다. application graph partial·unknown11개, semantic partial·unknown231개를 유지한다. 이는 최신 REA를 실제 적용한 좁은 정적 검증이며 전체 애플리케이션·provider·기본 옵션의 런타임 성공 증거가 아니다. 원문 결과는 ignored `outputs/step691-rea650-process-options-evidence.json`과 `outputs/step691-rea650-process-options-summary.json`에 있다.

## 정적 관찰: 기본 옵션의 자료 출처

| 생성 항목 | 원본의 출처·의미 |
| --- | --- |
| 분기 조건 | `!productSkuInfos` 또는 `productSkuInfos.length === 0` |
| 내부 ID | `default-`와 `Date.now()`의 결합. 공급자가 준 `skuId`가 아니다. |
| 등록 옵션번호 | 이미 발급된 등록번호의 앞9자리와 `001` 결합. 1688 SKU가 아니다. |
| 원문 옵션명 | 상품 `subject` |
| 번역명 후보 | 상품 `subjectTrans` |
| 재고 | `productSaleInfo.amountOnSale`, 직접 대입 |
| CNY 원가 | `parseFloat(productSaleInfo.priceRangeList[0].price)` |
| 대표 이미지 | `productImage.images[0]` |
| 추가 이미지 | `productImage.images` 전체 |
| 상세 이미지 | truthy description이면 `extractDetailImages`와 현재 상하단 설정 helper, 아니면 빈 배열 |
| 완료 상태 | 각 단계는 pending. 가격 helper를 거쳐 반환하며 초안 생성 자체가 이미지 처리나 Hub 등록 완료는 아니다. |

이 분기에는 `skuId`·`specId`·공급자 SKU 원문이 없다. 별도의 option-level MOQ 필드도 없으며 상품 생성자는 원본 `minOrderQuantity`를 상품 단위에 보존한다. 가격은 최저 구간 검색·정렬·수량 tier 선택·headline fallback이 아닌 **원래 첫 행**이다. 기본 옵션에서만 다른 SKU의 `offerPrice`나 `consignPrice`를 읽지 않는다.

일반 SKU 분기는 그대로 별개다. 전체 원래 SKU의 가격 동일 여부로 첫 기본가격 또는 각 SKU 원가를 고르며, 이 기존 정책을 무SKU 지원으로 바꾸지 않는다.

## 모호성과 잘못된 입력

- 원본의 falsy 조건은 missing·null·숫자0·빈 문자열도 포함한다. 응답이 정상 무옵션 상품인지 필드가 빠진 부분 응답인지 이 조건만으로는 알 수 없다.
- 비어 있지 않은 잘못된 자료형은 뒤의 `map` 등에서 실패할 수 있다. 이를 정상 fallback 지원으로 해석하지 않는다.
- `parseFloat`는 `"4.5"`를4.5로 만들지만 빈 값·잘못된 값은 NaN, 문자열 `"4.5garbage"`도4.5다. 원문에는 이 분기 자체의 유효한 양수 검사나 대체가격이 없다. 후속 가격 helper의 실행 결과·성공 저장까지 관찰한 것은 아니다.
- 재고는 raw 대입이므로 숫자0과 미확인값의 후처리는 이 분기만으로 확정하지 않는다. 자체는 확인된0과 unknown null을 구분하고 음수·소수·잘못된 숫자는 거절해야 한다.
- 선택 SKU 목록이 주어지면 원본은 기본 옵션 분기 **이전**에 해당 SKU 필터를 실행하고 선택 결과가 없으면 오류로 멈춘다. 실제 SKU 선택 요청을 기본 옵션으로 조용히 대체하지 않는다.
- 명시적인 빈 배열도 전체 서버 응답의 완전성을 절대 증명하지는 않는다. 새 지원의 실제 provider 응답 호환성은 미검증이며 UI에서 실제 전체 SKU 수집 성공으로 확대하지 않는다.

## 자체 구현 권고와 경계

1. 기존 envelope success·요청 offer ID·상품명·MOQ·CDN 이미지·설명·속성 크기 검증을 모두 유지한다. 빈 배열 지원을 이유로 missing/null/wrong type SKU 필드를 허용하지 않는다.
2. 명시적인 `productSkuInfos: []`와 유효한 첫 `productSaleInfo.priceRangeList[0].price`가 있을 때만 기본 옵션1개를 만든다. 다른 행·headline·임의 최저가격으로 보충하지 않는다. 실제 SKU 배열이 있는 기존 경로는 그대로 둔다.
3. 내부 옵션 identity와 원격 supplier SKU를 타입과 증거로 구분한다. offer 기반의 결정적인 내부 연결은 가능하지만 실제 supplier SKU는 공란/미확인으로 보존한다. 시간 기반 가짜 SKU는 만들지 않는다. 재시도에서 동일한 원문이 다른 옵션이 되지 않아야 한다.
4. receipt에는 원래 빈 SKU 배열이라는 선택 근거, 상품 단위 첫 기본가격·재고·offer 연결을 검증 가능하게 보존한다. 기존 `uniform-first-base`의 `skuPrices`에 가짜 SKU 행을 추가하는 대신 별도의 명시적 source identity/price basis를 사용한다. provider와 offer·옵션 개수1·identity·가격·재고가 일치해야 한다.
5. source receipt 정규화·저장·원문 보충·이미지 다운로드·번역 source binding에서 새 증거가 사라지거나 일반 실제 SKU로 변하지 않는지 점검한다. 과거 실제 SKU source를 기본 옵션으로 바꾸거나 반대 방향으로 덮지 않는다.
6. 로컬 two-company 원문→카테고리/회사 설정→가격→1~7단계 조회로 연결을 검수한다. supplierSku 공란, MOQ/재고0·null, 기본가격, 원문 이미지 순서, 동일 원문 재시도와 기존 수정값 보존을 확인한다. 전송 게이트와 실제 Hub 접수 상태는 바꾸지 않는다.

이 권고의 엄격한 자료형·유효값·원격 SKU 미확인 표시는 자체 일관성 정책이다. 원본의 NaN·부분 응답 오류를 재현하거나 공개 bundle만으로 private 수집 서버를 복제했다고 주장하지 않는다.

## 이번 소스 검증과 미완료 범위

현재 자체 parser를 합성 offer `90000000691`의 성공 envelope·상품명·MOQ2·첫 가격4.5·재고0·CDN 이미지·설명과 함께 직접 호출했다. 명시적인 빈 배열, missing, null 세 경우 모두 기존 ‘실제 옵션 1~200개가 필요합니다’로 거절됐다. 외부 fetch·provider·원본 코드 실행·DB 쓰기는0이다. 이는 수정 전 재현 근거이며 새 구현 통과 보고가 아니다.

실제 무SKU 1688 응답·전체 source completeness·private backend/cache·실제 소요시간·원본 AI 결과와 전체 카테고리 기본값·Hub 접수는 확인하지 않았다. 과거 접근이 거절된 URL을 다른 도구나 provider로 우회하지 않았다. 원본 정적 분기, 자체 합성 재현, 앞으로의 자체 구현 완료와 실제 운영 접수는 서로 구분한다.

## 후속 구현의 독립 소스 검토

root가 새 기본 옵션 계약을 구현한 뒤 seven-file 소스를 읽고 두 가지 실제 누락을 합성 호출로 재현했다. 첫째, 기본 옵션 marker를 유지한 채 옵션명만 상품명과 다르게 바꿔도 정규화가 수용했다. 둘째, 원문 설명·속성이 없는 기본 상품에 `canSupplementCollection`이 true를 반환해 현재 계약상 성공할 수 없는 실제-SKU 전용 Chrome 보완을 시도할 수 있었다. 두 경우 모두 source/code 실행은 자체 앱에만 한정했고 외부 호출은 없었다.

root는 정상화한 원문 상품명과 기본 옵션명을 정확히 묶고, `offerDefault`가 있는 원문은 현재 미지원 mobile 보완에서 제외했다. 최종 소스에 대해 위 두 재현의 거절, marker 보존 roundtrip, marker 누락·provider 변경·priceBasis 충돌 거절, 기존 실제 SKU 경로 유지, missing/null SKU 거절 등 독립 합성 단언10개가 통과했다. 남은 actionable 소스 지적은 없다. seven-file SHA·수정 전 결과·수정 후 단언은 ignored `outputs/step691-independent-review.json`에 보관했다. 이10개는 root의 단위/API 검사를 대체하거나 자동 합산하는 별도 릴리스 테스트 총계가 아니며, 실제 two-company DB·브라우저·provider·배포 검수 완료를 주장하지 않는다.
