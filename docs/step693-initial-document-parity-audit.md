# Step693 — 초기 견적서 구조 조사와 공개 SKU 이미지 연결 대조

2026-10-18 KST. Step692 `9c49f08` 이후 초기 상품→견적서 연결을 보관된 Couplus shipped JavaScript와 현재 자체 코드로 대조했다. REA와 upstream 지침을 읽고 기존 정적 Evidence를 재사용했다. 원본 코드·원본 bootstrap 실행·새 producer·원본 URL 요청은 없었다. 앱 구현은 root가 담당했으며 이 검토자는 앱/확장 소스를 수정하지 않았다. 기존 작업 상품·공유 Chrome·로그인 계정·운영 DB·Supplier Hub에는 접근하지 않았다.

## 이번에 확인한 실제 차이

Step692는 OpenAPI candidate parser의 실제 SKU 이미지 선택을 첫 속성→둘째 속성→상품 갤러리 첫 사진으로 맞췄다. 그러나 기본 URL 수집에서 사용하는 `app/alibaba-mobile-product.ts`의 공유 공개 SKU parser에는 같은 차이가 남아 있었다. 해당 함수는 `1688-public-mobile-v1`과 `1688-public-sku-v1` 두 경로에서 사용한다.

수정 전에는 전체 옵션 축의 사진을 후보로 보고 첫 URL만 이미지 풀에 넣었다. 사진이 하나도 없으면 `imageIndex`를 생략했다. 그러므로 첫 두 축에 사진이 없고 세 번째 축에만 있으면 다른 사진을 고르고, 첫·둘째 사진이 모두 있으면 둘째 원본을 잃었다. 사진이 전혀 없으면 원래 갤러리와 실제 SKU의 명시적인 연결이 생기지 않았다. 견적에는 기존 공통 이미지 fallback이 있으므로 이를 ‘견적 사진이 전혀 안 보임’이라고 과장하지 않는다. 차이는 원본 후보 보관, SKU별 원본 미리보기, 후속 옵션 이미지 저장과 공통 이미지 변경 이후의 연결이다.

root의 수정은 공유 parser의 첫 두 원래 위치만 후보로 삼고, **두 후보 모두 검증·보관한 뒤** 첫 유효 후보 또는 기존 갤러리 index0을 선택한다. 세 번째 이후의 사진은 대표 선택에 사용하지 않지만 전체 옵션명·색상·사이즈·실제 SKU·원가·MOQ·재고는 보존한다. 기존 HTTPS Alibaba CDN 검증, scheme-relative 정규화, URL 중복 재사용, 상세 이미지 역할 분리와 크기 제한을 완화하지 않는다. 이미지가 없는 ‘명시적인 단일 실제 SKU’와 실제 SKU 자체가 없는 응답도 구분한다. 빈 SKU map에서 기본 SKU를 만들어내지 않는다.

이는 Couplus `processOptions`에서 관찰한 **실제 SKU의 선택 의미를 다른 source adapter에도 일관되게 적용한 호환성 구현**이다. Couplus가 같은 공개/mobile 응답을 사용하거나 같은 backend 결과를 내는 것을 이번에 관찰한 것은 아니다. 공개 원문의 수량 구간 가격 정책을 OpenAPI의 균일 SKU 가격 규칙으로 바꾸지 않는다.

## 원본 근거와 경계

| 대상 | 위치·Evidence |
| --- | --- |
| shipped UI | `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js` SHA-256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc` |
| `processOptions` | UTF-16 `[466662,469077)`, slice SHA-256 `4a5671380c795a5b6e598bc3abfcdf54cb66318a62119f43478964ee68b0e3f0` |
| inert selected wrapper | `outputs/step660-intake-rea-selected/03-processOptions.js`, SHA-256 `7ce56d2c6afdeefff4691bb422334787c8d256c27b7138e5703a38b2d5ac1da9` |
| REA6.5 selected-source parent/summary | `ev_5869fb5a1a6ec67485ac76e74414a221ecb4eb7a035d0344c07e66b28c7bcec2` / `ev_40f57053660d6ff48348b5af5719c9cd3a761514c4acbf5cdeb4b62b7cadf68a` |
| initial-document selected methods | `outputs/step652-current-stages-selected/`、manifest `outputs/step652-current-stages-selected-manifest.json` |
| initial-document analysis parent | `ev_d49bd95d5e4610573ee111bbc753a6055e2f0913515c0f96f146f2ff50050a6b` |
| image-helper analysis parent | `ev_02780e2b058e642fc180a67b70caa803cccdc81f6dae0421b92e62c6c911e3a4` |

REA6.5의 `processOptions` 분석은 선택1파일 2,531바이트·AST558개·parse failure0이며 다른11파일은 inventory만 있다. application/semantic graph가 partial이고 unknown이 각각11/231개이므로 바깥 Vuex·`this`·서버 연결의 실행 증거로 확대하지 않는다. 같은 producer를 다시 실행하지 않았다. 공개 응답 shape·rox normalizer와 per-SKU/rangePrice 구분의 기존 기록은 `docs/1688-public-mobile-observation-2026-09-30.md`에서 참조했다. 이는 2026-09-30의 기록이며 현재 live 조회나 Couplus backend capture가 아니다.

`processOptions` normal-SKU 분기는 `skuAttributes[0].skuImageUrl`→`skuAttributes[1].skuImageUrl`→`productImage.images[0]` 순서로 `mainImageStatus.image`를 정한다. 첫·둘째 속성의 자체 `imageUrl`도 각각 보관한다. 이 부분이 이번 교차 adapter 선택 규칙의 정적 근거다. 원본은 URL truthiness를 쓰지만 자체에서 잘못된 URL을 성공 처리해야 한다는 뜻은 아니다.

## 최초 견적서 구조: 확인한 것과 수정하지 않은 것

`initializeCoupangDoc`는 UTF-16 `[444537,448566)`, slice SHA-256 `41c70c5b16a64374290c8970bcfcc3e041750ee32f2b3151ec76a60c1bfe4624`다. 선택 카테고리 schema를 기본 문서에 적용하고 각 옵션마다 deep clone한 뒤 기존 옵션 문서의 page 객체를 얕게 병합한다. `createFieldStructure`는 `[456679,457561)`, SHA-256 `d8418e58d599084f4b00b2119150f974f851b983b5911de484ae74951df90d87`이다. 문자열의 dropdown/enum은 해당사항없음 우선 또는 첫 값, fashionSeason은 사계절, 숫자는0, boolean은false다. named-array에서는 비노출 속성을 null, 나머지를 해당사항없음으로 만든다. 자체의 문자열 편집 모델에서 null과 의도적으로 비운 문자열을 구분하는 기존 처리는 유지한다.

별도로 읽은 `extractAndApplySchema`는 root.required의 page 및 required 객체 경로를 따라가며, 각 page의 직접 named-array 속성도 초기화한다. 자체 schema compiler가 다른 optional/nested array 구조에서도 동일한 범위를 사용하는지는 추가 확인 대상이다. 다만 보관된 실제 81452·69900·64455 양식의 named-array는 모두 원본 초기화 경로에 포함돼 있었다. 이번 조사에서 실제 카테고리의 누락 필드를 입증하지 못했으므로 가상의 schema만으로 새 기본값 기능을 추가하지 않았다. 이것은 모든 카테고리의 동등성을 확인했다는 뜻이 아니다.

`applyDefaultSettings`는 `[459611,464643)`, SHA-256 `4069cd43928262c23a6acc085f1d87bdd9de9268099191d8cb869b27545089ea`다. 이 메서드는 전달 문서의 `rocketRegInfo.schemaString`을 선택지 검증에 사용하지만, 읽은 `initializeCoupangDoc`의 반환 문서에는 그 속성이 포함되지 않는다. 따라서 이 호출 경계에서 선택지 검증 자료가 없는 것으로 보인다. 다른 호출자·동적 주입·현재 runtime은 미확인이다. 현재 보관된 category choices와 허용 workspace settings에서 실제 값 차이를 입증하지 못했다. 이 미확인을 이유로 자체 선택지 검증을 제거하지 않았다.

원본은 초기 imagePage에 `msrpAgree`와 `labelContactAgreed`를 true로 추가하는 분기가 있다. 보관된 schema는 해당 키를 선언하지 않은 경우도 있으며 자체는 실제 단계의 명시적 동의 UI·projection·receipt 처리를 별도로 갖고 있다. 정적 초기 객체의 true만 보고 실제 제출 동의 상태까지 같다고 주장하거나 기존 단계 동의 처리를 없애지 않았다.

`processOptions`의 `additionalImageStatus.images`는 갤러리 첫 사진을 포함한 전체 갤러리다. 그러나 `createProductObject`는 root.mainImages에 갤러리를 저장하고 `getAdditionalImageUrls`는 root.additionalImages만 읽는다. 후자는 옵션의 pending gallery를 읽지 않는다. 따라서 최초 최종 견적 additional field에 main을 중복 넣는다고 입증되지 않았다. 이를 근거로 자체 이미지 role 모델을 넓히지 않았다.

## 공개 응답 상태 충돌에 대한 독립 검토

root는 별도로 `app/alibaba-mobile-response.ts`를 추가해 모든 ret 항목이 성공일 때만 원문 사실을 받아들이도록 했다. 성공 항목 하나가 있어도 같은 배열에 로그인·확인·세션·access·token 오류가 있으면 즉시 실패한다. collector의 최초 응답에서 **단독** TOKEN_EMPTY일 때만 기존처럼 한 번 익명 handshake를 갱신한다. 혼합 응답은 갱신이나 다음 요청을 허가하지 않는다. 이는 자체 collector의 확인된 상태 판정 결함 수정이며 Couplus 원본에서 직접 관찰한 정책이라고 표현하지 않는다.

## 동결 소스의 독립 합성 검토

자체 함수만 실행하고 완전히 합성한 offer `90000000693`·실제 SKU 모양 `69310001`·가짜 CDN 식별 문자열을 사용했다. collector 호출에는 자체 mock fetch만 전달했으며 외부로 요청하지 않았다. 공개 SKU/full-mobile 두 parser 각각에서 첫/둘째/갤러리 우선순위, 두 후보 보관, 제3사진 배제와 전체 옵션명 유지, scheme-relative 동일 URL 재사용, 잘못된 첫/둘째 CDN 거절, SKU 없는 map 거절, 단일 실제 SKU의 빈 축, private/identity 거절, 원가·MOQ·0재고·수량 구간 정책과 원문 불변을 확인했다. 혼합 상태의 즉시종료와 단독 TOKEN_EMPTY→정상 응답의 기존 흐름도 확인했다.

독립 단언27개 모두 통과했고 추가 actionable 지적은 없다. 세 파일 SHA·단언·범위는 ignored `outputs/step693-independent-review.json`에 보관했다. 이 숫자의 전체 release test 총계 기여는0으로 기록했으며 실제 handler·회사 격리·extension package·배포 검수는 root/다른 worker 결과로 구분한다.

| 자체 동결 소스 | SHA-256 |
| --- | --- |
| `app/alibaba-mobile-response.ts` | `b8cd9632abcb15a01035c5e728a622d0031ecca52b833d6e87f8bc25a7c04e36` |
| `app/alibaba-mobile-collector.ts` | `43320f9d08b2d5abfd804601e0ea36831367af6dcffd774011dcb17bc3cdb563` |
| `app/alibaba-mobile-product.ts` | `fe2d51c99bfbe99bd80e2aa823f4def6a3e14dd2685957f2325135622d8d0f13` |

실제 최신 1688 접근·성능·Couplus backend source mapping·모든 카테고리 default·이미지 번역 품질·수정한 신규 실상품의 Supplier Hub 접수는 이 검토로 확인되지 않았다. 초기 문서의 세 미확인 항목을 구현 완료로 계산하지 않는다. 새 native/runtime session이나 브라우저 자원을 열지 않아 별도 종료 자원은 없다.
