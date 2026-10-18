# Step695 — 기본설정·명시 재계산의 0원 최소액 대조

2026-10-18 KST. Step694 이후 기본설정→상품추가 시점의 설정 capture→가격 편집을 보관된 Couplus shipped JavaScript와 현재 자체 코드로 대조했다. Step616/640/668/674와 Step693의 초기문서 조사를 재사용했다. 이미 처리한 기본 옵션·SEO150자·대표 이미지 fallback·사이즈표를 새 차이로 보고하지 않았다. 원본 producer·vendor 실행·실제 사이트·브라우저·계정·실상품·운영 데이터 접근은0이다. 앱 코드는 root/담당 worker 소유다.

## 확정된 차이

Couplus의 2단계 가격 편집은 **최소 공급 마진 보장 여부와 금액을 별도 상태로 저장**한다. 체크가 켜져 있으면 금액이0이어도 공급가를 원가+0으로 계산한다. 입력란에는 min0이 선언돼 있다. 자체는 금액이 양수일 때만 켜진 것으로 취급해0 입력만으로 체크가 꺼지고 비율 계산으로 돌아갔다.

이는 기존에 맞춘 양수 최소액의 stage-two 재계산과 다른 경계다. 초기 상품 초안의 비율/최소액 최대값 계산을 바꾸라는 뜻도 아니다. 신규 수집의 설정 capture나 과거 저장 정책에 의도하지 않은 의미를 소급하면 안 된다.

### 원본 정적 근거

| 근거 | 위치·SHA-256 |
| --- | --- |
| UI artifact | `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`, `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc` |
| `recalculateOption` | UTF-16 `[176686,178472)`, slice `19e8405eda56fbaacdfb08cf70092024b874b09a05dd7d4dd220034e493c761b` |
| selected wrapper | `outputs/step670-price-number-audit/generic-selected/11-recalculateOption.js`, `a4a0d627c8130d2f2e765f1dc9caeb875183d79cbc877497e126e2be0744a2ff` |
| 최소액 input 좁은 구간 | UTF-16 `[157895,158405)`, slice `df9bfe4a8f47d6318479a1cd2588726d388d555dc66ec49b13d20aaa0c34c6f1` |
| `pricingInfo` | UTF-16 `[171274,171712)`, slice `f658fbc535371c67c40237c8f3811d09a089c877aa653187613a361b7b89df57` |
| `editPolicy` | UTF-16 `[176546,176685)`, slice `b84e8daae8e258a33d475e32f1f348b6553c2d286df8c8d0430c4e80170176c0` |
| retained REA parent/summary | `ev_80058b8130c110cfd1ec44a0c48cf2441311a5ce02c3a66e52f40c0fbf65b42f` / `ev_17832bd63907632253e7995219d61cac1fd2c15f6497d8bab5a750ec1f4b5ee6` |
| 가격 저장 selected parent | `ev_cd5b12712ef6b71c2acfc13858957b76b067e15d1319aac6ac68b3c3a642258a` |

`recalculateOption`의 일반 가격 분기는 editEnableMinSupplyMargin을 직접 검사한다. true이면 purchaseCost+editMinSupplyMarginAmount를 선택 단위로 반올림한 공급가를 만들고, 쿠팡 마진으로 판매가를 반올림한다. false이면 공급 마진율로 계산한다. 조건에 금액>0 검사는 없다. UI input은 type number/min0/step100이며 금액만 수정하는 callback과 별도 checkbox 상태를 사용한다. `pricingInfo`도 enableMinSupplyMargin과 minSupplyMarginAmount를 각각 기록하고, `savePricing`은 이 pricingInfo를 pricing.info로 저장한다.

같은 UI의 조건부 표시도 좁혀 확인했다. UTF-16 `[157734,158382)`, SHA-256 `ab48ab0367bb5c70026f35ce9181cb73086e89cfced095681db62914c4d8af2a`는 `editEnableMinSupplyMargin ? 금액 input과 설명 div : empty vnode`다. 그러므로 OFF 시 금액과 설명을 감추고 ON·0일 때 계속 표시하는 것이 관찰된 render 계약이다. 별도 ignored `outputs/step695-minimum-visibility-static.json`에 정확한 excerpt를 저장했으며 vendor rendering을 실행하지 않았다.

기본설정에도 같은 조건이 있다. UTF-16 `[299080,299587)`, SHA-256 `bc20bce2dd2229cea3a84276038958eda5064ef7ed712d54915850750653f68c`는 `settingsData.enableMinSupplyMargin ? 최소액 form-group(input·설명) : empty vnode`다. 자체 workspace 설정 편집기는 두 요소를 항상 보여 주고 있어 같은 범위의 표시 차이로 확인했다. 상태·설정 금액을 지우지 않고 이 표시 조건만 맞추는 것으로 범위를 한정했다.

retained generic 분석은 선택11파일 parse failure0, semantic unknown266이며 Vue 외부 바인딩과 전체 실행은 미확인이다. 실제 수정/저장을 실행한 결과가 아닌 정확한 분기와 render 입력 문법의 정적 관찰이다. 같은 producer를 다시 실행하지 않았으며 인용한 구간/hash를 원래 artifact에 다시 대조했다.

## 자체 소스와 합성 재현

수정 전 `calculatePrice`는 recalculationMode가 couplus-stage-two-v1이고 minimumMargin>0일 때만 원가+최소액을 썼다. minimumMargin0은 비율 계산이다. `PriceEditor`의 checkbox·안내문도 >0으로 켜짐을 추론했다. workspace validateSettings는 minimumMarginEnabled=true와 minimumMargin0을 허용하지만, 상품별 PricePolicy는 그 별도 여부를 보존하지 않았다.

| 합성 조건 | 공급가 | 판매가 | MSRP |
| --- | ---: | ---: | ---: |
| 원본 분기의 독립 계산: 보장 ON·0원 | 8,960 | 14,930 | 19,410 |
| 원본 분기의 독립 계산: 보장 OFF | 17,920 | 29,870 | 38,830 |
| 수정 전 자체: stage-two mode·0원 | 17,920 | 29,870 | 38,830 |

입력은 단품25.6 CNY·환율350·공급 마진50%·쿠팡 마진40%·10원 반올림·MSRP1.3이며 번들/통합통관은 껐다. 원본 branch의 산식을 별도로 읽어 계산했고 vendor 코드는 실행하지 않았다. 자체는 실제 calculatePrice를 실행했다.

추가로 실제 PriceEditor 함수와 callback을 격리된 React hook fixture로 실행했다. 초기 minimum3000으로 체크가 켜진 상태에서 **금액만0으로 수정**하자 checkbox는false가 됐다. 일괄 재계산→저장 callback의 정책은 minimum0·stage-two mode이고 별도 여부가 없어 비율 가격을 저장했다. 브라우저 DOM 검수로 표현하지 않는다. 첫 probe는 통합통관 checkbox를 잘못 찾은 fixture locator가 실패해 최소 보장 label로 좁힌 뒤 재실행했으며, 앱 동작의 실패로 계산하지 않았다.

사전 재현은 ignored `outputs/step695-zero-minimum-gap-probe.json`에 원본 구간·상태·저장 정책·자체 소스 SHA와 함께 보관했다. 수정 전 pricing SHA는 `e0e7e5079002525c67046d2ec8df641f0341537309e59cdfaf91910bf5ff0b7c`, PriceEditor SHA는 `cf53a50c62d2a95be2237b92f7b6a0bceed01e9b2078580c1787665a81a3614f`다. 외부 요청·DB 쓰기·기존 상품 변경0, release test 총계 가산0이다.

## 좁은 구현 경계

명시적인 stage-two 전용 optional boolean을 두어 ON/OFF를0이라는 금액과 분리한다. 새 marker가 있는 ON·0은 direct-min으로 계산하고 OFF는0의 비율 계산을 유지한다. marker가 없는 과거 policy는 기존 >0 추론을 유지한다. OFF인데 양수 최소액인 모순·알 수 없는 값·mode 밖 marker는 검증 정책을 명확히 해야 한다. 이 marker를 workspace 기본설정 값이나 새 수집 정책에 무심코 복사하면 안 된다.

편집기의 체크·금액 입력·재계산·저장·dirty/동등성 판단과 옵션별 bulk base 비교가 같은 상태를 봐야 한다. 켜짐을 유지한 채0 입력, 끄기/다시 켜기, 저장/조회, 비율 정책과 direct0 정책의 동등성 구분, 기존 수동 가격과 공란 보존을 검수한다. 신규 초안 가격, 양수 최소액, 구성 수량, 통합통관 매입가의 묶음당 비용·VAT·원 단위 처리, 나머지 반올림·범위 제한은 바꾸지 않는다.

## 이번 조사에서 반복 구현하지 않은 부분

applyDefaultSettings의 category-bound scalar·named-array 기본값, 첫 브랜드값·제조사·거래/수입·A/S·고시·물류 연결은 기존 구현과 Step693 범위를 재사용했다. 반환 문서의 rocketRegInfo 연결이 정적 호출 경계에서 빠지는 후보는 실제 동적 호출/분류 영향이 미확인이라 새 차이로 구현하지 않았다. 전월 자동 고시의 날짜 overflow를 원본과 같게 다시 만들거나 현재 export 시계로 바꾸지 않는다.

번들 수량은 초기 processOptions의100원 selector와 명시 가격 편집의 설정 단위 경로가 이미 분리돼 있다. 상·하단 banner는 요청 시점의 소유 key와 활성 여부를 가져오며 수동 저장·후속 설정 변경으로 과거 상품을 덮지 않는 기존 처리와 Step690을 유지한다. 번역 OFF 시 프롬프트·copyright를 보존하고 조건부로 감추는 동작은 Step668에서 처리됐다. hidden attributes의 생성 허용은 저장된 설정값과 선택 schema를 확인하는 기존 quotation-AI 경로에 있다. 이것이 외부 모델의 동등한 출력이나 자동 이미지 번역을 실증했다는 뜻은 아니다.

비율바에서 공급/쿠팡 마진 합계100 초과 시 원본 실제 렌더링을 관찰하지 못했다. 자체가 막대를 숨기는 것을 이 조사만으로 수정하지 않는다. 자동 통합통관 환율의 비공개 provider, sourcingSellingPrice 고정 목표가 경로, 모든 카테고리/현재 실제 신규 상품의 최종 Hub 접수는 별도 확인 대상이다. 확인할 수 없는 값을 새 API에 연결하거나 기존 실상품으로 시험하지 않았다. live gate는false로 유지한다.

## 후속 구현의 좁은 독립 검토

root는 상품별 가격 정책에 optional `recalculationMinimumEnabled` boolean을 추가했다. 새 marker가 없으면 기존 금액>0 추론을 유지한다. 새 marker가true이면0도 켜짐으로 보되 direct-min 산식은 기존과 같이 stage-two mode에서만 사용한다. marker false와 양수 금액의 모순, null/숫자/문자열 등 boolean이 아닌 값은 거절한다. mode를 누르기 전 편집기에서도 체크 상태를 보관할 수 있지만 신규 초안의 계산 방식은 바뀌지 않는다.

PriceEditor는 금액0 입력만으로 체크를 끄지 않고 일괄 재계산/저장에 같은 boolean을 보관한다. OFF↔ON 시0을 포함한 최근 금액을 유지하고 상태 비교에도 marker를 포함한다. `optionBulkPriceBase`는 marker 없는 기존 tuple을 그대로 유지하며 새 marker가 있을 때만 추가해0원 ON/OFF의 다른 계산을 같은 미리보기로 오인하지 않는다. workspace 설정 JSON과 신규 collection 경로에는 marker를 추가하지 않았다.

독립 검토19항목 모두 통과했다. helper의 nullish-coalescing과 `>0` 우선순위, stage2 ON0/OFF0·과거 정책·초기 mode 밖 계산 보존, JSON roundtrip, malformed/모순 거절, 통합통관 묶음당 비용과 원 단위 계산, 기존4개 반올림 단위·0원 공급가 거절, bulk base 구분을 확인했다. 실제 PriceEditor 함수/callback에서는 금액0·0 cache·marker-only dirty/외부 변경·재계산/저장·빈 입력 차단을 별도 hook fixture로 확인했다. 브라우저를 mount하거나 vendor를 실행하지 않았고 추가 actionable 지적은 없다.

최초3파일 검토 기록에는 source SHA·항목·범위를 보관했다. release test 총계 기여는0이다. 해당 시점의 pricing SHA-256은 `756a2c2d934cf5fb101520a803f22d770ca908d4baa82d6321711486835dd44c`, PriceEditor는 `b1dcbf2cd703af855c0b9afdf41599ffd0ffe890029de2d42003b8478d337235`, option-editor-tools는 `bdbf12e21c9fb30817f6ad4ffec6d104ee5bb62db5dab12895c0d97a1101bbfe`다. 외부/브라우저/운영 쓰기/실상품 변경0이며 실제 API/견적서 persistence·다른 회사 격리·배포 검수는 root와 담당 worker 결과로 구분한다.

표시 조건까지 반영한 후 마지막 검토를 갱신했다. 초기3파일/19항목 JSON은 `outputs/step695-independent-review-before-visibility.json`으로 별도 보존했다. 최종4파일에는 PriceEditor의 OFF 시 금액 숨김, ON·0 유지와 재활성화, workspace 설정의 OFF 시 금액·설명 숨김,0/양수 보관값과 저장 payload 보존 검토를 추가해 **22항목 모두 통과**했다. 추가 지적은 없다. `outputs/step695-independent-review.json`은 이 마지막 상태이며 전체 release test 총계 기여는 여전히0이다.

마지막 동결 SHA-256은 pricing `756a2c2d934cf5fb101520a803f22d770ca908d4baa82d6321711486835dd44c`, PriceEditor `7fb6490135715cea66ac4d6e4cfe2f4023c544e7a6f730ec69cb34a68aae6ac3`, option-editor-tools `bdbf12e21c9fb30817f6ad4ffec6d104ee5bb62db5dab12895c0d97a1101bbfe`, WorkspaceSettingsEditor `e683f8629a8d66ed67d2c6ae85b896886e8488e9ca015a9ea83669d5f5eb8ae4`다. 두 UI 검수는 실제 자체 React 함수/callback의 격리 hook 실행이며 브라우저 screenshot이나 운영 검수로 표현하지 않는다.
