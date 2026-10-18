# Step696 — 기존 옵션의 번들 해제와 견적 옵션명 대조

2026-10-18 KST. Step649/651/669/670/672/673/681 및 기존 bundle-settings 조사와 구현을 먼저 대조했다. REA 지침·보관된 shipped UI/main·기존 Evidence를 재사용했으며 상품추가 원문·가격·이미지 분석을 반복하지 않았다. 앱/테스트/기존 상품/브라우저/계정/운영 DB/네트워크는 변경하지 않았다. 아래 source는 정적 관찰이고 자체 동작은 격리된 순수 합성 재현이다.

## 확정된 차이: 수량1로 번들 해제한 이름

Couplus의 ‘번들 적용’은 수량1을 **번들 해제**로 처리한다. 선택한 기존 행의 번들 수량을1로 바꾸고 옵션명 끝의 `(N개묶음)`을 제거한 이름을 저장한다. 자체는 수량은1로 바꾸지만 이름에 `(1개묶음)`을 다시 붙였다. 이 문자열은 저장 정규화 후에도 남아 최종 견적 export 행의 SKU 이름에 들어간다.

이 동작은 새 번들 행을 생성하는 addBundle과 다르다. 기존 선택 행의 UUID·옵션번호·SKU·재고·포장값·견적 override를 복제하거나 번호를 다시 발급하는 수정이 필요하지 않다. 이미 구현된 parseInt prompt·atomic bundle add·0원 최소액·이미지 fallback을 다시 만들지 않는다.

### 원본 근거

| 대상 | 위치·SHA-256·Evidence |
| --- | --- |
| shipped UI | `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`, `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc` |
| `applyBundleToOptions` | UTF-16 `[187675,188875)`, slice `4d1f8207215796dd84aea812aa55506f2256e977d5acd906e5eaaf06f458d706` |
| selected wrapper | `outputs/step670-price-number-audit/selected/08-applyBundleToOptions.js`, `798b5905be0efc408bc8b24fc7f95b978d2061eadd1adc3af056fd9aec1872af` |
| original selection manifest | `outputs/step670-price-number-audit/source-manifest.json` |
| retained selected-source parent | `ev_cd5b12712ef6b71c2acfc13858957b76b067e15d1319aac6ac68b3c3a642258a` |
| existing generic table/price parent | `ev_80058b8130c110cfd1ec44a0c48cf2441311a5ce02c3a66e52f40c0fbf65b42f` |

원본은 prompt 안내에1을 넣으면 해제된다고 명시한다. null 취소는 중단하고 parseInt 결과가1 미만이면 거절한다. 선택한 optionNumber의 기존 행을 찾아 bundleQuantity를 바꾼 뒤, `getOptionName` 결과에서 정규식 `\s*\(\d+개묶음\)\s*$`에 맞는 **한 개의 끝 suffix**를 지운다. 수량1이면 이 기본 이름을 사용하고,2 이상이면 새 suffix를 붙인다. 해당 행 가격을 재계산하고 전체 저장이 성공했을 때 해제/적용 완료 안내를 나눠 표시한다.

원본 바깥 `getOptionName`·Vue lifecycle·원격 저장/견적 수락을 실제로 실행한 증거는 아니다. 기존 REA selected analysis는 UI8파일·generic11파일 parse failure0, semantic unknown은 각각700/266이며 범위 밖 동적 호출은 미확인이다. 같은 producer를 다시 실행하지 않았다. 원래 구간 및 wrapper SHA를 보관 파일에 대조했다.

## 자체 연결과 실제 합성 재현

현재 가격 화면의 `ProductOptionsEditor.confirmSelection`은 parseCouplusBundleQuantity→previewOptionBulk→applyOptionBulk를 거친다. 이 결과를 옵션 저장 조정자에 보내며 validateOptionsInput/applyOptionRows가 문자열의 앞뒤 공백·provenance·포장 확인 전이를 정리한다. 이 과정은 `(1개묶음)`을 제거하지 않는다. 견적 row mapper는 저장한 optionQuotationName을 그대로 SKU 이름으로 사용한다.

수정 전 `app/option-editor-tools.ts`의 applyBundle 분기는 번역명이 비어 있지 않으면 항상 ‘끝 suffix 제거+새 `(수량개묶음)`’을 수행했다. 해당 소스의 사전 SHA-256은 `bdbf12e21c9fb30817f6ad4ffec6d104ee5bb62db5dab12895c0d97a1101bbfe`다.

`outputs/step696-bundle-release-gap-probe.json`은 자체 함수를 차례로 실행해 이 차이를 확인한 기록이다.

| 합성 입력/단계 | 수정 전 결과 | 원본 정적 기대 |
| --- | --- | --- |
| 한국어명 `검정 (5개묶음)`, 기존 구성5, 적용1 | preview 이름 `검정 (1개묶음)` | `검정` |
| validate/save normalization | 저장명 `검정 (1개묶음)` | `검정` |
| quotation resolver/export row | skuName `검정 (1개묶음)` | `검정` |

합성 행의 supplier SKU는 `SYNTHETIC-SKU-696`, 재고31이며 원가2.99와 별도 UUID를 사용했다. 단위 수량1·SKU·재고는 정상 유지됐고 원래 입력은 바뀌지 않았다. 구성 수량이 바뀌는 기존 포장 재확인 정책은 그대로 적용된다. 실제 1688 URL을 읽거나 기존 상품을 편집하지 않았으며 외부/DB/Hub 요청0이다. 순수 fixture의 회사/카테고리는 실제 신규 접수 증거가 아니다.

## 좁은 수정과 검수 경계

현재 applyBundle 분기에서 기존처럼 끝 suffix를 제거한 후, 수량1에는 기본 이름만 사용한다.2 이상은 기존 새 suffix를 유지한다. SKU·원문명·수동 빈 번역명·번호·재고·포장값·별도 수동 견적 제목·가격 override 처리와 범위 제한을 넓히지 않는다. 원본의 fallback 이름 조회를 이유로 자체의 의도적인 빈 번역명을 원문으로 자동 복원하지 않는다.

검수에서는 이미 suffix가 있는 이름→1, 원래 일반 이름→1,2 이상 적용, 끝이 아닌 괄호/다른 단어 보존, 반복 해제의 안정성, 선택하지 않은 행/제외 행·수동 공란 보존, 옵션 저장 후 견적 option label/SKU 이름을 확인한다. 가격 정책 marker와 수량·원가에 따른 계산은 기존 엔진을 재사용한다. 기존 source receipt·회사·category mapping·실파일·실전송 gate는 바꾸지 않는다.

## 반복하지 않은 범위와 미확인

기존 번들 selector는1,3,…21과 초기100원/명시 설정 단위 경로가 이미 구현돼 있다. parseInt prompt, 선택 UUID 기준의 미리보기/저장, 삭제/가격 충돌 거절, 신규 번들의 atomic 동반 저장·B번호·라벨 무효화·복구, 옵션 분할과 수동 견적값 보존도 별도 완료 기록이 있으므로 새 기능으로 계산하지 않는다.

source에는 sourcingSellingPrice/구매가/공급가와 참조 CNY·bundle 수량에 따른 고정 목표가 경로가 보인다. 그러나 이 값이 수동 상품추가 UI에서 어떻게 입력/확정되는지, current provider 또는 사용자 저장 자료에서 어떤 원천으로 입증되는지는 이번 범위에서 확인하지 않았다. 이를 새로운 기본 가격 정책이나 비공개 서버 응답으로 추정 구현하지 않는다. 전체 카테고리·실제 신규 소싱·운영 이미지 처리·최종 Hub 접수/SKU 관계는 이 조사로 완료되지 않는다. live gate는false를 유지한다.

## 최종 변경의 좁은 독립 검토

root는 applyBundle의 기존 끝 suffix 제거 결과를 baseName으로 분리하고 수량1에는 이 이름만 사용하도록 수정했다.2 이상은 같은 새 suffix를 붙이고 trim 기준 빈 번역명은 원래 입력을 유지한다. 이 두 줄의 의미 변경 외 UI handler·가격 산식·저장 조정자를 바꾸지 않았다. 검토자는 앱 소스를 수정하지 않았다.

독립 합성 검토17항목을 통과했다. 일반명/기존 `(5개묶음)`/기존 `(1개묶음)`→1,2 이상 적용, 한 개의 마지막 suffix만 제거, 끝이 아닌 괄호와 다른 `개입` 표기 보존, 빈/공백 이름 유지, 반복 해제 안정성, 원본 입력 불변과 선택하지 않은 제외 행 보존을 확인했다. UUID·SKU·재고·포장 측정값이 유지되고 구성 수량이 달라질 때만 기존 포장 재확인을 요구했다. parseInt의 기존 수량 해석과 하한 거절, 오래된 policy/base·다른 UUID 거절도 유지됐다.

validateOptionsInput→applyOptionRows→quotation resolver/export row에서도 해제한 `검정` 이름이 다시 suffix 없이 남는 것을 확인했다. 실제 DB/브라우저/API persistence는 이 검토 범위가 아니며 root/다른 worker 결과와 구분한다. 네트워크·운영 쓰기·실상품 변경·vendor 실행0이다. 미해결 actionable 지적은 없다.

최종 `app/option-editor-tools.ts`는10,560바이트, SHA-256 `dffa29c1cce349ce50d496a794fe4c49b3f706a548c8f9b3b2cd7417fe1cfc2b`다. ignored `outputs/step696-independent-review.json`에 source/항목/범위를 보관했고 release test 총계 기여는0으로 기록했다. 사전 gap probe JSON은 별도로 유지했다.
