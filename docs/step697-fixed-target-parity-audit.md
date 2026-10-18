# Step697 — 고정 목표 판매가의 실제 범위와 수동 가격 저장 대조

2026-10-18 KST. 보관된 Couplus shipped UI/main 및 기존 REA Evidence를 재사용했다. 새 producer·vendor 코드 실행·원본 요청·Chrome·계정·기존 실상품 조작은 없다. 이 검토자의 소유 범위는 이 문서와 ignored `outputs/step697-*`다. 자체 재현에는 별도 합성 데이터와 임시 SQLite만 썼으며 운영 자료는 바꾸지 않았다.

## 고정 목표 판매가: 일반 URL 초안의 누락으로 단정하지 않음

원본의 `sourcingSellingPrice`는 일반 수동 상품추가에서 받는 값이 아니다. `loadCliRegistrationQueue`가 회사별 `/api/cli/registration/consume`의 items에서 targetSellingPrice/purchaseCost/supplyPrice/bundleQuantity를 읽고, queue 실행이 이 값들을 `_currentQueue...` 상태로 넘긴다. createProductObject는 **queueAutoMode일 때만** 고정값을 가져와 옵션에 적용하고 상품의 sourcingSellingPrice/구매가/공급가/번들수량 필드를 보관한다. 일반 handleAddProduct는 링크의 offer ID로 상품정보를 요청하고 keyword와 함께 다음 단계로 보낸다. 이 호출에서는 목표가를 받거나 추정하지 않는다.

자체의 CollectionContext/IntakeRow/collection-jobs 요청과 신규 prepareCollectionProduct에는 이 고정 목표가 contract가 없다. 대신 수집한 CNY 원가·당시 설정·옵션 구성 수량에서 일반 가격을 계산하고 별도 수동 가격값을 지원한다. 이 수동값을 고정목표가 scaling/guard 기능과 같다고 표현하지 않는다. 사용자가 일반 카테고리→URL 초안을 최우선, CLI/자동소싱 plugin을 후속으로 지정했으므로 이번에는 고정목표가를 일반 초안에 도입하지 않는다.

### 원본 입력 및 산식

- 목표 판매가의 undefined/null/빈 문자열은 null이다. Number 변환 후 정수5,200~10,000,000만 채택하고 나머지는 무시한다.
- 구매가/공급가도 undefined/null/빈 문자열은 null이고 정수1~10,000,000만 채택한다. 번들수량은 정수1~100이다. 임의 문자열 파싱이나 범위 밖 값을 자기 가격으로 확정하지 않는다.
- 참조 CNY는 모든 양수 옵션 CNY 중 최소값이다. 옵션 CNY가 이 참조보다 높으면 목표 판매가를 CNY 비율로 늘려 roundUnit 단위 **올림**한다. 이때 공급가 override는 null로 풀고, 참고 구매가는 구성 수량 기준 조정 및 해당 옵션/기준 옵션의 매입가 차액을 반영한다. 같거나 더 낮은 CNY에는 목표가를 유지한다.
- fixedSellingPricing는 양수 공급가 override가 있으면 그 값을 사용한다. 없으면 목표판매가×(1−쿠팡마진율)를 단위 반올림한다. 공급가−매입가가 **판매가의25% 미만**이면 쓰지 않고 오류를 낸다. 이25%는 현재 factory의 상수 `.25`다. 초기 조사 중10%라고 보낸 언급은 확인 전 오기로 정정했다.
- 이 경로에서는 supplyMargin/최소 마진/자동번들 같은 보통 정책을 그대로 적용하지 않는 분기가 있다. 일반 가격 산식으로 이 고정가 기능을 흉내 내거나 현재 계정에 강제로 켜지 않는다.

상세 syntax와 digest는 `outputs/step697-fixed-target-static.json`에 보관했다. TypeScript parser는 inert carrier의 구문만 읽었고 vendor 함수를 실행하지 않았다. CLI 서버의 실제 응답·현재 queue 자료·원격 저장·소싱 선정 조건은 미확인이다.

| 대상 | 원본 UTF-16 범위 | slice SHA-256 |
| --- | --- | --- |
| normalizeQueueSellingPrice | `[359108,359306)` UI | `d985cb3660b8852bc736563aaede803a7ae679aeb60f6dd68fc31d087d80b77c` |
| normalizeQueuePurchaseCost | `[359307,359500)` UI | `822a01400e87088f720b2f32c00f023f4b7d62717702e8f0b4ca79b763f23118` |
| loadCliRegistrationQueue | `[356518,358716)` UI | `72b3e96c0f49737634e5b0e8d7e3e2cfce1ff8b106a3482c70861a7605e2d223` |
| createProductObject | `[436576,441156)` UI | `d359e61ea580bfcdead25cbecbbcb27390a41394bd3ee7b6238a04f74a4e3e53` |
| fixedSellingPricing | `[295562,295987)` main | `a676b9114ad174a27462df13cdc56480fa609a8de2f0750ba11f2383a695a9b0` |
| referenceCny | `[295988,296098)` main | `702a85709b7ed5d094d2502c8a479487985ab7218a634e9abf75f422e4aa4633` |
| bundledPurchaseCost | `[296099,296259)` main | `a71c7cad7f8d0f8ddbd2f5d5cfd6452e0e5b412d610d7d7a2fd9d81ff36200cf` |
| scaleFixedPricing | `[296260,296690)` main | `96dd3eafcf446b32dd62fc4efab17f20a8c76265a644d005b708883debed5465` |

UI artifact는 `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`, SHA-256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`다. main artifact는 `main.a20c7114.js`, SHA-256 `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`다. factory 선택 원문은 `[293993,296790)`이며 기존 inert wrapper/provenance와 정확한 바이트를 대조했다.

REA price utility parent `ev_0ab0458b3894fb5a1d96e3e4891548c831252b6d63182a881d355b9dc9bdf86a`, 기존 선택 parent `ev_80058b8130c110cfd1ec44a0c48cf2441311a5ce02c3a66e52f40c0fbf65b42f`, UI/save parent `ev_cd5b12712ef6b71c2acfc13858957b76b067e15d1319aac6ac68b3c3a642258a`를 재사용했다. selected graph의 외부 바인딩·동적 호출 범위는 여전히 미확인이다.

## 수동 공급가/판매가 입력: 인접 가격 자동변경 없음

원본 가격표의 supply/selling input은 자기 행의 해당 값만 `$set`하고 recalculateMarginsByOptionNumber(optionNumber)를 호출한다. 이 메서드는 매입가·공급마진·쿠팡마진만 갱신하며 supply와selling을 서로 다시 쓰지 않는다. 자체 controller.change의 한 가격 입력과 effectiveGridPrices의 마진 재계산은 이 부분에서 기능 누락으로 보지 않았다. input마다 MSRP를 자동 계산하는 코드도 이 경로에는 없다.

공급가 render의 좁은 구간은 `[164828,165398)`, SHA `4cc3e0ba52571fab738f0bc42413c0ac68e512675b574a7750d9a318cb7d173b`이고, 판매가는 `[165816,166396)`, SHA `f967474eb3bbee8a7cb2a8cbe0a26b4167416b08968b5e86820895a4e7f39202`다. 마진 재계산 `[178473,179099)`의 SHA는 `6ddf0141f05094b1205cdfbd5833c18aeca0ab69c8241803e9c9b91dbd994cc2`다. 이 사실을 ‘판매가 수정 즉시 공급가/MSRP를 재계산한다’고 확대하지 않는다.

## 확인된 별도 차이: 저장할 때 자동 MSRP가 이전 판매가에 남음

원본의 두 ‘저장하기’ 버튼은 savePricing에 직접 연결된다. savePricing은 기존 문서를 deep clone하고 행의 공급가·판매가를 넣은 뒤 **그 행의 현재 판매가**로 calculateMsrpValue를 실행해 MSRP/OSRP에 쓴다. 입력 변경이 없어도 저장하면 이 경로가 실행된다. 기존 document 값을 비교하거나 직접 입력 여부를 확인하는 조건은 없다. 따라서 해당 원본 분기에서는 7단계에서 따로 바꾼 값도 선택된 저장 키의 새 계산값으로 바뀔 수 있다. 실제 사용자 자료를 바꿔 이를 시험하지는 않았다.

calculateMsrpValue는 현재 workspace `settings.msrpMultiplier || 1.3` 및 `settings.roundUnit || editRoundUnit || 100`을 사용해 판매가×배수를 반올림한다. 단품 공급원가·저장한 최초 판매가에서 다시 계산하는 함수가 아니다. shouldUseOsrp는 commonAttributes에 osrp own-property가 있으면 true이므로 두 속성이 모두 존재하는 원본 문서는 osrp를 선택한다. 자체는 MSRP 우선/OSRP-only fallback을 정확히 분리하는 기존 target 정책이 있어 이번 수정에서 둘을 무조건 같이 덮으면 안 된다. 두 field가 함께 있는 실제 원본 양식의 runtime 영향은 별도 미확인이다.

| 대상 | 원본 범위·SHA-256 |
| --- | --- |
| savePricing | `[179537,183657)`, `d19bd6552a912ceb5d78ab1baee282118133b946276d968e41b87b04fad7a893` |
| calculateMsrpValue | `[184936,185086)`, `31fa548a9e5f9cc99deeba9483974e137691a973f53c452c22606125273424ba` |
| shouldUseOsrp | `[185087,185210)`, `de0014c1014c89ba180f6e5854d30cb773bed64650b4e258bb9922e0ccf42494` |
| 저장 버튼 render 좁은 구간 | `[161783,161878)`, `15046047d7414c8dc8d158c532f8665c9caa08e71f1f24af2c8001f3311d2541` |

자체의 실제 quotation-fields handler와 임시 SQLite·합성 회사/회원/상품/양식으로 양사 각각 GET→판매가만 PUT을 실행했다. 처음 판매가9,150/MSRP11,900이며 MSRP 출처는 pricing이었다. 판매가만40,000으로 수정한 요청은200으로 저장되고 MSRP11,900/source pricing이 그대로 남았다. draftIssues는 빈 배열이어서 이 합성 양식에서는 낮은 MSRP 자체가 가격 저장을 막지는 않았다. 따라서 차이를 ‘MSRP가 낮아 항상 저장이 막힌다’고 기술하면 틀린다. **현재 판매가가 바뀌었는데 자동 MSRP는 최초 판매가에 묶인 채 남는 것**이 확인된 차이다. 같은 표본 배수1.3·단위10을 원본 저장식에 주면52,000이다.

이 사전 재현은 `outputs/step697-manual-msrp-gap-probe.json`에 보관했다. 네트워크·브라우저·운영/기존 상품 변경·vendor 실행은0이다. 실제 회원 인증이나 실제 Hub 수락 결과가 아니라 저장 연결 검증이다. 수동 MSRP/의도적 공란을 보존하는 자체 정책과 원본의 무조건 덮어쓰기를 분리해서 검토했다. root는 자동 값의 판매가 저장 연결을 선택했고 이 조사자가 앱 코드를 바꾸지는 않았다.

행 마진의 표시에도 작은 차이가 있다. 원본 formatNumber `[183658,183717)`, SHA `bfb530307b9591ba70b6b43ede175b4428833b3f1ed2a30d3331c12167006920`는 Intl.NumberFormat이고 자체 표의 won formatter는 정수 반올림한다. 예를 들어 실제2999.5 마진을 자체에서는3000원으로 표시할 수 있다. 계산·저장 오류로 확인한 것은 아니며 평균은 원본도 별도로 반올림하므로 둘을 섞지 않는다. 이번 우선 후보는 저장 자동 MSRP 연결이다.

## 반영 후 독립 검토

root/구현 worker의 최종 동결 소스9개를 다시 읽었다. `stageTwoMsrpEdits`는 2단계 grid의 저장 시 현재 판매가에 saved-product 가격 정책의 배수·단위 반올림을 적용한다. 기존 MSRP own/common 직접값·공란 및 이번 입력의 MSRP 직접값/공란/복원은 자동 계산보다 우선한다. 이 보존 정책은 원본의 전체 무조건 덮어쓰기와 의도적으로 구분된다. 공급가만 수정하거나 아무 변경 없이 저장할 때 모든 원본 행을 재계산하는 것까지 구현됐다고 표현하지 않는다.

새 sidecar는 현재 카테고리의 정확한 MSRP 연결 필드·저장값과 일치할 때만 자동 권한을 유지한다. 기존 직접 수정값에는 이 권한이 없다. 직접 MSRP를 같은 값으로 다시 저장해도 권한은 해제된다. MSRP와 OSRP가 함께 있는 양식에서는 독립 OSRP를 유지하고 OSRP-only일 때만 기존 exact target 규칙을 사용한다. 옵션 ID의 inherited prototype 속성을 권한으로 빌리는 경로는 own-property 조건으로 막았다.

서버는 요청한 marker를 그대로 저장하지 않는다. 저장된 정책으로 sale→MSRP 요청을 다시 계산해 옵션 ID 목록과 전체 변경값이 정확히 맞는지 확인한다. 기존 revision/inputFingerprint 및 product/settings/pricing source CAS도 유지했다. 최신 정책이 달라진 경우 이전 계산을 marker로 승인하는 코드는 없다. GET에는 sidecar projection만 추가되어 가격·상품 저장을 새로 실행하지 않는다. category scope 없이 저장한 이전 marker가 다른 카테고리에 자동 적용되지 않는다.

계산 helper는 Hub primary 필드의 기존 scalar grammar를 사용하고 원시 paired 입력을 보존한다. 예를 들어 wire가 지수 표기를 허용해 helper에서9e3을 읽을 수 있다는 사실은 canonical 요약 필드까지 포함한 실제 저장 API가9e3을 허용한다는 뜻이 아니다. 실제 API는 기존 canonical 형식 guard를 먼저 적용하며 이 추가 기능이 그 규칙을 넓히지 않는다. 최종 helper의 tuple type annotation 수정 뒤 SHA-256 `36a47767cb1b898040205bf2eae50d83d6718c85cc1f6638019fbc4066d6d7c8`을 확인하고 독립 probe를 재실행했다. 타입 수정 전 보고서는 `*-before-type-fix.json`으로 별도 보존했다.

UI는 원시 사용자 입력과 실제 보낸 augmented 변경값을 분리한다. 저장 ACK가 유실되면 scope·기준 revision/fingerprint·원시 입력 signature가 일치한 마지막 변경값으로 재조회 결과를 검증한다. 입력을 보존한 상태에서 중복 PUT을 자동 실행하는 방식이 아니다. 기존 source-generation/layout/abort 조건도 유지된다. 행 마진에는 소수값을 보존하는 locale formatter를 적용했으며 평균 표시의 정수 반올림·실제 계산식·저장 가격은 바꾸지 않았다.

독립 순수 probe16개를 **최종 소스로 재실행해16개 통과**했고 추가 source assertion10개로 저장/GET·정책·ACK 경계를 확인했다. 이는 별도 worker의 양사 UI/API/원본 workbook 통합검사를 중복 실행하거나 배포 test 합계에 더한 수치가 아니다. 이 검토의 release test 합계 기여는0이다. 추가 확정 결함은 없었다. 전체 파일 SHA-256·검토 범위·실행 한계는 `outputs/step697-independent-review.json`, 재현은 `outputs/step697-independent-pure-probe.mjs/.json`에 보관했다. 외부 요청·vendor 실행·Chrome·실상품·Hub 등록은 모두0이다.

고정가 기능은 후속 queue/plugin 범위로 남긴다. 최신 실제 source·모든 카테고리·비공개 가격 provider·원격 가격 저장·동의·실제 Hub receipt/SKU 연결은 이 정적 조사와 합성 결과만으로 완료되지 않는다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`를 유지하고 열린 runtime/session 자원은 없다.
