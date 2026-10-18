# Step705 — URL 원문 수집 경로 재대조

2026-10-18. 사용자의 최우선 요구인 `카테고리 선택 → 1688 URL → 초안`에서 **실제 상품 원문을 어디서 얻는지**만 다시 좁혔다. 원본 JavaScript는 정적 문자열·AST로 읽었고 실행하지 않았다. 외부 요청·브라우저·CLI 실행·1688 접속·기존 상품 변경은0이다. REA 설치를 다시 하거나 분석 producer를 반복하지 않았다. 이번 turn 시작 기준은 root가 기록한 `daebe0472258a0a13bdbd21ca68dc8ade48a3990`이며, 별도 동의 before probe의 이전 기준 `e5612771…`와 구분한다.

## 핵심 확인

쿠플러스의 일반 AI상품추가 버튼은 1688 페이지를 화면에서 직접 긁는 함수부터 시작하지 않는다. **쿠플러스 자체 서버의 상품조회 endpoint**에 offer ID를 보내 구조화된 원문을 받은 뒤, 확장으로 Supplier Hub 카테고리 양식을 연결한다.

따라서 자체 앱의 `공개 PC JSON-LD → 모바일 페이지/공개 SKU 조회`가 실패한 사실과 조사용 브라우저 도구가 특정 URL 읽기를 거절한 사실은 서로 다른 문제다. 도구의 접근 거절은 앱 수집기가 원래 불가능하다는 증거가 아니다. 반대로 공개 metadata fallback만으로 쿠플러스 자체 서버 수집기를 동일하게 구현했다고 할 수도 없다.

## 정확한 일반 URL 흐름

보관 UI artifact `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`, SHA-256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`.

| 원본 메서드 | 원문 UTF-16 범위 | 정적 관찰 |
| --- | --- | --- |
| `triggerAddProduct` | `[409745,409882)` | 상품추가 modal을 닫고 nextTick에서 `handleAddProduct` 호출 |
| `handleAddProduct` | `[409883,410740)` | URL·keyword 필요. URL의 `offer/`와 `.html` 사이 ID → `POST /api/aiPage/getProductInfo`, body `[{productId:parseInt(id)}]` |
| 응답 소비 | 같은 메서드 | Axios 응답의 `response.data.result[0].result.result`를 상품 객체로 읽고 다음 확장 요청에 전달 |
| `requestProductInfoFromExtension` | `[410741,411765)` | **이미 받은 상품 원문**을 pending으로 저장. `GET_PRODUCT_INFO` 메시지에 keyword·원문/번역 제목·feature·supplierCode·categoryCode/categoryPathString 전송 |
| `createProductObject` | `[436576,441156)` | 옵션·이미지·속성·기본설정·카테고리·문서 초기화 후 `POST /api/rocketReg/saveItems`, body `[product]`. 성공을 확인한 뒤 SEO/가격 처리 시작 |
| `runInitialProcessing` | `[441157,442908)` | 초기 SEO, 최신 저장본 기준 가격 처리를 순차 실행. 나머지는 ‘전체 작업’으로 진행한다는 안내가 있음 |

`handleAddProduct` slice SHA는 `2c08c174d1abb501f2b04228f11a9799af78f94f77887b531077ba13f52cdada`; trigger는 `1f3e2c8f3191fdf5600b8df0350df2810929efc198cc7123ae53eea7210c3756`이다. 원문 전체·각 digest는 ignored `outputs/step705-analysis-url-source-methods.json`, trigger/queue 범위는 `…url-trigger-methods.json`에 보존했다.

main utility의 `get1688ProductInfo`도 같은 endpoint를 사용한다. main artifact SHA `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`, 함수 `[453845,454342)`, slice SHA `0169381d1cfa325d17d7c4ac5e965a5fdebfe220c7462693f2ca3ddd91e3a748`. 여기서는 network wrapper가 response.data를 벗기므로 `response.result[0].result.result`를 읽는다. **이 중첩 응답 차이를 서로 다른 외부 provider API라고 해석하지 않는다.**

queue/자동소싱도 동일 자체 서버 endpoint를 호출하지만 SKU subset·고정 판매가·자동 전송은 별도 옵션이다. 이를 사용자가 요청한 일반 수동 URL 흐름에 필수로 끼우지 않는다.

## 서버 응답이 공급하는 원문 계약

원본 `createProductObject`와 `processOptions`의 실제 필드 접근을 구분했다.

| 데이터 | 원본이 읽는 경로 |
| --- | --- |
| 원문·번역 제목 | `subject`, `subjectTrans` |
| 대표/갤러리 | `productImage.images` |
| 상세 | `description` HTML의 이미지와 본문 |
| 속성·배송 | `productAttribute`, `productShippingInfo` |
| 최소 주문 | `minOrderQuantity` |
| 상품 기본 가격·재고 | `productSaleInfo.priceRangeList[0].price`, `productSaleInfo.amountOnSale` |
| 실제 SKU | `productSkuInfos[]`, 그 안의 SKU 식별/속성·재고·원가 정보 |

전체 SKU 가격 동일 여부를 먼저 보고 첫 상품 가격을 택하는 기존 processOptions 원가 규칙은 Step660/691/692에서 이미 조사·반영한 범위다. 이번에 그 산식을 다시 수정하지 않는다. 중요한 것은 **그 구조화된 응답 자체를 공급할 수집 원천**이다. 제목이나 headline 최저가격 하나로 실제 SKU·재고·최소 주문을 만들어 채우는 근거는 없다.

서버 내부가 1688 공식 API, 별도 공급자, 자체 캐시, 파트너 API 중 어느 것을 쓰는지는 프런트 계약만으로 확정할 수 없다. 호출 응답의 provider 이름·키·권한·cache hit·실제 지연도 미관측이다. 자체 앱의 기존 공식 OpenAPI connector가 존재한다는 사실은 확인했지만, 그것이 쿠플러스 서버가 실제로 쓰는 provider라고 주장하지 않는다. 쿠플러스 비공개 endpoint를 자체 앱의 무료 backend로 재사용하거나 인증/비밀을 복사하지 않았다.

## `GET_PRODUCT_INFO` 확장의 실제 역할

기존10.92 확장 Evidence와 보관 source를 재사용했다. `background.js` SHA `fb03e8a70bc684e8b08539d8eb507720170eca8cf6fa4cb74af549f13179ec99`, `script.js` SHA `0547785f8b746c75dc509dc96c4cfb9c290aff941499aaeb9c3b1af33ce9edc1`.

`GET_PRODUCT_INFO`는 원문1688 API 이름처럼 보이지만 실제 handler는 Supplier Hub 탭의 회사코드를 확인하고 `/sr/schema/api/get-default-schemaform?internalDisplayCode=<category>&useCustomizedJsonSchema=true`를 읽는다. category 내부 ID·고시 번호·scope·version과 `docId:null` startPage skeleton을 `PRODUCT_INFO_RESPONSE`로 반환한다. 이 단계는 1688 원문 조회도 실제 원격 견적서 생성도 아니다.

정확한 handler `[86376,87976)`, slice SHA `c184a7777631f1e4c7684db1208097141353adf7b7355ce80b0915345275612b`; 보관 `outputs/step652-current-extension-schema-provenance.json`과 `…schema-selected/category-document-skeleton-handler.js`를 참조한다.

## 별도 구형 페이지 reader — 확인된 것과 없는 것

같은 확장에는 소문자 `joke:'getproductinfo'`라는 별도 caller가 있다. 새 비활성1688 탭을 열고 `bn(url)`을 실행한 다음 결과를 relay하고 자신이 만든 탭을 정리한다. 이 reader는 일반 AI상품추가의 `handleAddProduct`가 호출하는 함수가 아니다.

`async function bn`의 정확한 범위는 `[352696,356283)`, slice SHA `50c0aadc3017d66bfc6849252712d9413b529ace7d938df2668ed4ddbe098822`이다. 다른 library 스코프에도 `bn`이라는 이름이 있으므로 이름만으로 연결하지 않았다.

확인된 reader 동작:

- URL을 `credentials:'include'`로 GET하고 DOMParser로 HTML을 읽는다.
- script에 `window.__GLOBAL_DADA`가 들어 있으면 `window.__INIT_DATA` 할당 뒤 JSON을 읽는다. 원본은 느슨한 문자열 잘라내기지만 재구현에 eval은 필요 없다.
- `h.globalData.skuModel.skuProps`, `skuInfoMap`를 읽고 원문 전체를 `info.obj=h`, 속성을 `info.obj1`, 맵을 `info.obj2`로 보존한다.
- 첫 두 SKU 속성의 `value[].name/imageUrl`을 option1array/option2array로 반환한다.
- 별도 이미지 helper는 `globalData.images[].fullPathImageURI`를 읽는다.

**확인되지 않은 것:** bn은 offerID/title/통화/MOQ/개별 SKU price를 명시적으로 해석하지 않는다. 보관 background 전체에서 `orderParamModel`, `offerBaseInfo`, `offerTitle`, `minOrder` literal은 발견되지 않았다. 이 문자열 부재는 동적 서버·다른 버전까지 기능이 없다는 증명이 아니다. 다만 여기서 `skuInfoMap.price`나 `orderParamModel`의 구체적 저장 계약을 도출할 수 없다는 범위 제한이다.

자체 모바일 parser는 이미 `window.__INIT_DATA`를 읽지만 mobile의 `globalData.offerBaseInfo/tempModel`과 `init.data` component를 요구한다. 구형 desktop의 `globalData.skuModel`과 같은 변수명이라는 이유만으로 둘이 호환된다고 할 수 없다. 공개 PC parser가 JSON-LD만 처리하는 지원 범위 차이는 확인했지만, 현재 실제 페이지의 이 desktop 형태·완전 가격/식별값을 관찰한 것은 아니다. **빠진 사실을 추정한 full-SKU parser나 연결되지 않은 ‘성공’ 경로는 추가하지 않는 것이 이번 판단이다.** 구현 담당에게 이 증거 한계를 전달했고 앱 파일 변경0을 확인했다.

## CLI 역할과 한계

보관 `outputs/private-cli-audit/couplus-cli-latest.tgz`, SHA `98106402185e46c925a34a9c655e0331f54d0b5ab78abb173a9d5599ff0387bd`, package version1.3.24. archive의 JavaScript45개와 JSON/문서를 텍스트로 읽었고 실행·설치하지 않았다.

이 archive에는 `1688`, `alibaba`, `getProductInfo`, `productSkuInfos`, `scrape1688`, `offerDetails` literal이 없다. CLI는 자체 서버의 `/api/cli/tools/catalog`와 동적 remote 도구 계층을 포함한다. 따라서 이 CLI를 연결했다는 사실만으로1688 원문 수집기를 직접 복원했다고 할 수 없다. 동적으로 받은 서버 도구 내부 구현은 이 archive 밖이며 미확인이다.

## 재구현에 필요한 다음 증거

1. 자체 원문 수집 서비스의 실제 입력→응답을 먼저 검증한다. 정상 응답의 offer ID·원문 제목·실제 SKU/원가/통화/MOQ·갤러리/상세를 공급할 수 있어야 한다. JSON-LD/mobile 파서의 합성 통과와 실제 수집 성공을 구분한다.
2. PC 초기상태 adapter를 추가하려면 해당 shape의 정당한 원문 fixture와 가격·SKU·identity 소비 근거가 필요하다. 보관 bn의 부분 정보만으로 없는 사실을 보충하지 않는다.
3. 검증된 원문이 정규화된 뒤에는 현재 회사별 기본설정·선택 category 공식 schema·초기 SEO/가격/수정·견적서 경로로 이어간다. 브라우저 도구 차단 때문에 이 단계 전체가 불가능하다고 말하지 않는다.

## Evidence·산출물

- 기존 원문 intake REA parent `ev_1983224a44e1100a435aca7caaa76ebb6e1d9df782252092d57dcc695765e8ee`, summary `ev_c09a0b073aa2961fa6660da9d2e95275f34d4826dd950a1c0e9c5abf833a086a`.
- 기존 UI/main parent `ev_cd5b12712ef6b71c2acfc13858957b76b067e15d1319aac6ac68b3c3a642258a` / `ev_80058b8130c110cfd1ec44a0c48cf2441311a5ce02c3a66e52f40c0fbf65b42f`.
- 기존 확장 Evidence `ev_17ed0cebd00b285e0bc489221547e437d2b3f69d9b636a813eb942a0a2a3a49a`와 Step652 schema provenance.
- 이번 source-bound ignored 분석: `outputs/step705-analysis-url-source-locator.{mjs,json}`, `…url-source-methods.{mjs,json}`, `…url-trigger-methods.json`, `…desktop-literal-boundaries.json`.

이는 정적 클라이언트 구조를 확인한 결과다. 새로운1688 원문 수집 성공, 속도, 모든 카테고리 동등성, Hub 수용·접수·최종 SKU 또는 전체 완성률의 증거로 확대하지 않는다.
