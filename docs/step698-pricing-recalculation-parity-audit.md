# Step698 — 수동 가격 재계산의 초안·저장 경계

2026-10-18 KST. 기준 commit은 `b3e3d2ebc7c889b7ade5f2bf3547c5784f38a90f`이다. 보관된 Couplus UI artifact와 기존 REA Evidence만 재사용했다. 새 producer·vendor 실행·원본 요청·Chrome·계정·기존 실상품 접근은0이다. 이 조사자의 편집 소유 범위는 이 문서와 ignored `outputs/step698-analysis*`뿐이며 앱을 수정하지 않았다.

## 원본에서 확인한 순서

원본은 가격창을 열었다는 이유로 모든 수동 가격을 바로 버리지 않는다. `initializeCalculatedOptions`는 현재 product.options와 저장된 pricing.options의 optionNumber 집합이 일치하면 저장 가격을 deep clone해 calculatedOptions로 사용한다. 옵션 집합이 다르거나 저장 가격이 없을 때 새 배열을 만든 후 updatePricing을 호출한다.

사용자가 **일괄 재계산**을 누르면 updatePricing이 calculatedOptions 전체를 순회해 recalculateOption(index)을 호출한다. 환율·공급 마진·쿠팡 마진·반올림 단위·최소 공급 마진액 필드에도 change→updatePricing이 연결돼 있다. 따라서 단순 input의 매 글자가 아니라 해당 change callback 또는 명시 버튼에서 로컬 가격 초안을 재계산한다. 이 메서드들에는 서버 dispatch가 없다.

일반 수동 상품의 recalculateOption은 현재 CNY×bundleQuantity의 매입가를 다시 구하고, 최소 공급 마진 보장 ON이면 원가+최소액, OFF이면 공급 마진율로 공급가를 반올림한다. 판매가는 이 공급가와 쿠팡 마진율에서 반올림한다. 각 행의 purchasePrice/supplyPrice/sellingPrice/supplyMargin/sellingMargin을 다시 쓴다. 이전 수동 가격인지 비교하는 조건이 없다. sourcingSellingPrice 분기는 별도 queue/plugin 범위로 이번 일반 동작에 도입하지 않는다.

updatePricing에는 selectedOptions 조건이 없으므로 **선택하지 않은 현재 행도** 재계산한다. selectedOptions는 삭제·번들 작업의 대상 선택이다. 다만 이 원본 메서드들은 자체의 included=false와 같은 상태를 읽지 않는다. 원본 배열에서 제거된 행과 자체에 보관하되 견적에서 제외한 행을 같은 것으로 취급하거나, 제외 행까지 강제로 고치라고 해석할 근거는 없다.

**저장하기**의 savePricing에서만 현재 calculatedOptions 전체를 product.options, pricing.options, coupangDoc.jsonDocument의 대응 행으로 변환하고 updateProductPartial을 dispatch한다. 선택 여부로 저장 대상을 좁히지 않는다. 판매가에 따른 MSRP/OSRP도 이 저장 시 계산한다. updatePricing 자체는 MSRP를 쓰지 않는다. 원본의 빈 변경 저장·전체 행 MSRP 덮어쓰기와 직접 MSRP 소유권 문제는 Step697에서 이미 분석했으므로 새 발견으로 세지 않는다.

원본 calculateMsrpValue는 `settings.msrpMultiplier || 1.3`과 `settings.roundUnit || editRoundUnit || 100`을 사용한다. inspected 가격창 render에서 별도의 edit MSRP 배수 필드는 확인되지 않았다. 자체 PriceEditor의 시장가격 배수 control을 원본에도 똑같이 있는 UI라고 표현하면 안 된다. 원본은 workspace roundUnit이 있으면 editRoundUnit보다 우선하므로 이 우선순위까지 자체 product-policy와 같다고 단정하지 않는다.

## 가장 강한 차이와 자체 재현

자체의 일괄 재계산 버튼은 stage-two mode와 nearest rounding을 로컬 PricePolicy에 넣는다. OptionPricePreview는 저장된 옵션 CNY/묶음 수량으로 새 자동값을 미리 보여주고, 문구로 직접 수정한 견적 가격이 우선한다고 알린다. 이 단계의 DB 저장은 없다. 이어 pricing POST는 product의 대표 계산값과 product_price_policy를 저장하지만 기존 quotation override는 바꾸지 않는다.

따라서 원본의 **명시 재계산→저장으로 이전 수동 공급가·판매가를 현재 정책의 가격으로 치환**하는 의미는 아직 동일하지 않다. 이 차이는 단순 미검증이 아니라 자체 실제 handler·임시 SQLite·합성 양사 자료에서 확인했다.

- 처음 저장된 옵션에 판매가9,000을 직접 적용하고 Step697에서 자동 MSRP11,700의 정확한 sidecar를 저장했다. 다른 옵션에는 직접 MSRP27,000을 따로 보관했다.
- stage-two mode/최소 공급 마진6,000 정책을 저장하면 자동 fallback은 공급가7,050·판매가11,750·MSRP15,280으로 바뀌었다. 하지만 첫 옵션의 resolved sale9,000/MSRP11,700 및 sidecar11,700은 그대로다. 공급가는 override가 없어7,050을 사용한다. 실제 product_quotation_fields payload는 가격 정책 저장 전후 동일했다.
- 이어 자체 시장가격 배수를1.7로 저장해도 첫 옵션의 파생 MSRP/sidecar11,700이 유지됐다. 현재 sale9,000×새 배수1.7의 계산 결과는15,300이다. 이는 자체가 이미 노출한 배수 control과 자동 권한의 정합성 문제다. 원본에 같은 배수 입력 callback이 있다는 parity 증거로 확대하지 않는다.
- 직접 MSRP27,000과 원본 옵션 저장 자료는 유지됐다. 운영 자료·원격 접수는 바꾸지 않았다.

재현은 `outputs/step698-analysis-own-gap.mjs/.json`이다. 양사 모두 자체 API가200을 반환했으며 외부 요청·브라우저·vendor 실행·Hub 등록은0이다. release test 합계에는 더하지 않는다.

## 구현 선택의 경계

정확한 원본 패턴을 재현하려면 재계산된 행 가격을 저장 전 로컬 초안에 보여주고, 저장/취소를 구분해야 한다. 일반 가격 정책 저장이나 GET에서 기존 직접값을 몰래 지우는 것은 원본의 명시 동작을 재현하는 방법이 아니다. 또한 선택 체크 여부와 included 제외 여부를 혼동하지 않아야 한다. 원본의 전체 수동값 덮어쓰기를 채택하려면 이 동작 자체를 명확한 재계산·저장 작업으로 구현해야 한다.

더 좁은 개선은 이미 서버가 기록한 **정확한 sale-derived MSRP sidecar만** 새 저장 정책에서 갱신하고, 직접 MSRP/공란·독립 OSRP·다른 카테고리를 보존하는 것이다. 이는 자체 자동 권한의 정합성 보완으로 설명해야 하며 원본 전체 재계산/저장 동일구현 완료로 설명하면 안 된다. root는 일반 정책 저장에 이 보존 경로를, 명시 일괄 재계산 후 저장에는 현재 카테고리의 직접 가격을 재계산으로 돌리는 별도 경로를 구현했다. 이 조사자가 앱을 변경하지는 않았다.

## 구현 중 독립 검토에서 발견한 저장 경계

첫 route 초안은 snapshot을 읽었어도 plan.changed=false이면 기존 상품 clock만 검사하는 저장으로 돌아갔다. 명시 재계산 또는 기존 자동 MSRP 검증을 수행한 요청은 값이 같아도 profile/settings/raw quotation 등 읽은 원천에 묶여야 한다는 범위로 root가 이 지적을 채택했다. 수정 전 조건과 route SHA는 `outputs/step698-analysis-guard-only-finding.json`에 남겼다. 이는 source 제어흐름 관찰이며 이 조사자가 당시 실행 경쟁까지 관찰한 것으로 기술하지 않는다.

이어 guard-only 최종 sentinel의 CASE가 직전 companion의 changes()를 확인하지 않는 문제를 실제 자체 handler·임시 SQLite에서 재현했다. 동일 정책의 명시 재계산 중 다른 저장이 product.updated_at을 이번 batch의 계산 timestamp와 같게 만든 합성 경쟁에서 첫 CAS는 실패했다. 하지만 존재하는 정책/견적 payload가 같아 마지막 title=title UPDATE는 실행됐고, batch 밖 acknowledgement 오류로503을 반환했다. AFTER UPDATE OF title 감사 trigger의1행이 남아 실패한 요청의 mutation이 commit됐음을 확인했다. 실상품이나 운영 DB의 trigger를 관찰한 것이 아니라 rollback 경계 검증용 로컬 fixture다. 원본은 `outputs/step698-analysis-cas-sentinel-before-fix.json`, 재현 코드는 같은 prefix의 probe.mjs에 보존했다. 이 조사자는 앱을 수정하지 않고 root에게 transaction 내부 제약 검증에 companion 성공 조건을 넣도록 전달했다.

최종 수정은 값이 같은 plan에도 writeQuote=false companion을 전달해 raw payload와 원천 CAS를 유지하고 견적서 행·revision은 새로 쓰지 않는다. 두 마지막 product sentinel CASE에는 changes()=1을 포함했다. 최종 db/queries.ts SHA-256 `57248a979257003c80e6b6361d4adbba431a740fe6c73a5248e192c25f6df1f2`에서 위 timestamp 경쟁과 **동일 정책 INSERT IGNORE**를 재실행했다. 두 요청 모두503을 반환하되 감사 trigger0행, 요청 전 DB(경쟁자가 batch 전에 저장한 clock 포함)와 완전히 같았다. 이 독립 회귀2건은 `outputs/step698-analysis-cas-sentinel-after-fix.json`에 남겼다. 실패 응답 뒤 부분 저장이 없음을 로컬에서 확인한 것이며 운영 D1 장애를 실제 관찰한 것은 아니다.

## 최종 반영 범위와 독립 검수

일괄 재계산 버튼은 원시 policy와 별도의 pending intent를 만들고, 이미 동일한 stage-two 정책이라도 dirty/parent lock을 켠다. 저장 전까지 DB의 직접 가격은 유지되고 preview에는 덮어쓸 범위를 알린다. 명시 저장에서만 현재 카테고리의 공통·현재 옵션 UUID에 있는 exact 가격 alias를 해제해 새 계산을 사용한다. 선택 여부로 좁히지 않으며 제외 옵션의 included/원가/수량 같은 사실은 바꾸지 않는다. 비가격 title/legal, 독립 OSRP, 다른 카테고리, 현재 배열에 없는 이전 옵션의 직접값은 보존한다. 원본의 제거 모델과 자체 제외 모델 전체가 같아졌다고 설명하지 않는다.

일반 정책 저장은 현재 포함된 행의 서버 검증 MSRP sidecar만 갱신한다. 직접 MSRP/공란 및 제외 행의 marker는 유지한다. 요청의 profileId는 실제 가격창→dashboard→route까지 전달된다. 성공 ACK에서만 pending intent가 해제되고 실패하면 입력과 intent를 보존한다. root/통합검수 worker가 발견한 A→B→A category 전환의 오래된 callback 문제도 generation identity로 보완했고, 이 조사자의 재실행에서 이전 submit/click은 저장하지 않았다.

최종 소스에 대해 독립 UI 순수 probe9/9, 가격 plan 순수 probe10/10, 실제 자체 handler/SQLite sentinel 회귀2/2 및 source assertion13개를 확인했다. 별도 worker의 양사 UI/API/workbook 통합검사를 중복 실행하거나 release test 합계에 더하지 않았다. 이 조사자의 합계 기여는0이다. source manifest에는 변경 앱6파일·변경 test helper1파일·읽은 기존 guard/target dependency3파일의 SHA를 보존했다. 최종 보고서는 `outputs/step698-analysis-independent-review.json`, 재현은 `step698-analysis-ui-review*`, `step698-analysis-policy-pure-review*` 및 sentinel 전후 결과다. 이전 UI8건 보고서는 generation 수정 전 자료로 별도 보존했다. 수정된 지적 외에 최종 범위에서 추가 확정 결함은 없었다.

## 보관 근거와 한계

artifact는 `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`, SHA-256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`다. UTF-16 범위의 정확한 원문·digest·callback slice는 `outputs/step698-analysis-static.json`에 보관했다.

| 메서드 | 원본 범위 | slice SHA-256 |
| --- | --- | --- |
| initializeCalculatedOptions | `[173880,176093)` | `70a60f92dab2bc16e4efff71429c2dc48496c3349806556a97a81dfd19448155` |
| updatePricing | `[176094,176208)` | `64c93c23b077181bb25bd3a390af4db1245c30bbbcc9c34782281d7fbe69fe97` |
| recalculateOption | `[176686,178472)` | `19e8405eda56fbaacdfb08cf70092024b874b09a05dd7d4dd220034e493c761b` |
| savePricing | `[179537,183657)` | `d19bd6552a912ceb5d78ab1baee282118133b946276d968e41b87b04fad7a893` |
| calculateMsrpValue | `[184936,185086)` | `31fa548a9e5f9cc99deeba9483974e137691a973f53c452c22606125273424ba` |

REA parent `ev_80058b8130c110cfd1ec44a0c48cf2441311a5ce02c3a66e52f40c0fbf65b42f`와 `ev_cd5b12712ef6b71c2acfc13858957b76b067e15d1319aac6ac68b3c3a642258a`를 재사용했다. 정적 callback/조건은 관찰한 source 사실이지만 실제 원격 저장·새로운 Couplus 실행·모든 카테고리에서의 동작이나 receipt를 관찰한 것은 아니다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`를 유지하며 열린 runtime/session은 없다.
