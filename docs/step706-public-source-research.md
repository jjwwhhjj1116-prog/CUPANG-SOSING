# Step706: 공개 1688-cli 상품 원문 계약 정적 검토

검토일: 2026-10-18. 대상은 공개 GitHub 소스이며, 이 조사에서 1688 사이트 요청, 브라우저 실행, CLI 실행, 의존성 설치, 테스트 실행, 계정·쿠키 읽기는 하지 않았다. 다른 작업자가 진행 중인 앱 소스와 기존 상품 데이터는 변경하지 않았다.

## 결론

이 프로젝트는 **PC HTML 하나를 파싱해 완전한 상품 결과를 얻는 구현이 아니다.** 로그인된 지속 브라우저가 정상 상품 페이지를 로드하는 동안 발생한 SKU API 응답과 `window.context`의 화면 모듈 정보를 합친다. 이 자료는 현재 YOOFAM의 JSON-LD 전용 PC 파서가 놓치는 **제목·갤러리·포장 정보의 경로 후보**를 제시한다. 그러나 **HTML만으로 정확한 offer ID, 모든 SKU 가격, 통화, MOQ, 상세 본문이 함께 검증되는 계약**을 제공하지는 않는다. 따라서 이 코드의 필드명만 근거로 실상품 값을 추정하거나 현재 수집 성공을 선언할 수 없다.

## 출처와 재현 범위

- 저장소: [superjack2050/1688-cli](https://github.com/superjack2050/1688-cli)
- 고정 커밋: `5585466a2e5acf4dec7079048daf26533cac8ba2`
- package.json 버전: `0.1.48`
- 실제 [LICENSE](https://github.com/superjack2050/1688-cli/blob/5585466a2e5acf4dec7079048daf26533cac8ba2/LICENSE)는 MIT이며 저작권자는 `2026 nobodyjack`이다. 소스 일부를 재사용·배포한다면 해당 저작권과 허가 고지를 포함해야 한다. 이번 조사는 분석만 하며 런타임 코드를 복사하지 않았다.
- [ARCHITECTURE.md](https://github.com/superjack2050/1688-cli/blob/5585466a2e5acf4dec7079048daf26533cac8ba2/ARCHITECTURE.md)의 지속 브라우저·프로필 구조는 구현과 일치한다.
- 로컬 정적 사본: `outputs/step706-public-source-research/1688-cli/`. depth 1 clone만 수행했다. 실행 가능한 패키지 설치나 postinstall 실행은 없었다.
- 파일별 SHA256과 조사 범위는 `outputs/step706-public-source-research/source-manifest.json`에 기록한다.

## 실제 데이터 흐름

근거: [src/commands/offer.ts](https://github.com/superjack2050/1688-cli/blob/5585466a2e5acf4dec7079048daf26533cac8ba2/src/commands/offer.ts).

1. `execute()`는 입력 상품번호가 숫자인지 검사한다(131~133행).
2. `executeRaw()`는 전달받은 브라우저 context 안에 새 페이지를 만들고, `wosc.queryofferskuselectormodel`에 해당하는 응답 감시를 **탐색 전에** 시작한다(146~170행).
3. SKU 응답은 `parseMtop`으로 JSON/JSONP를 해제한 뒤 `data.skuSelectorBizModel`을 읽는다. 감시 기한은 18초이다. 응답 URL의 API 이름을 대조하지만 이 지점에서 요청·응답 offer ID를 입력 offer ID와 별도로 대조하지 않는다.
4. 입력 번호의 상세 페이지를 연다. 로그인 주소로 이동하면 `NOT_LOGGED_IN`을 반환한다(285~302행).
5. SKU 응답을 기다린 뒤 `readPageInfo()`가 `window.context.result.data.productTitle.fields`의 존재를 기다린다(305~307, 388~400행). 두 번 스크롤한 후 모듈 정보를 읽는다. 이것은 정적 JSON 파서 실행이 아니라 브라우저 런타임 정보 읽기이다.
6. `assemble()`이 런타임 SKU와 모듈 정보를 결합한다(670~783행). 계정 로그인·위험 확인은 별도 브라우저 계층이 담당한다.

## 필드별 확인 결과

| 필요한 정보 | 실제 경로/동작 | 확정 범위와 제한 |
|---|---|---|
| 요청 상품번호 | `args.offerId` → 반환 `offerId` | 반환값은 입력을 그대로 복사한다. `gallery.fields.offerId`는 타입에 등장하지만 반환 시 일치 여부를 검사하지 않는다. 정확한 본문 귀속 검증의 근거로 쓸 수 없다. |
| 제목 | `window.context.result.data.productTitle.fields.title`; 없으면 `gallery.fields.subject`; 마지막으로 문서 title | 경로 후보는 구체적이다. 원문 HTML 내 데이터의 구문·바인딩을 확인하는 inert parser나 테스트는 제공하지 않는다. |
| SKU 속성 | SKU API `data.skuSelectorBizModel.skuProps[].prop` 및 `.value[].name/imageUrl` | 속성/속성값 목록이다. 실제 주문 조합은 별도 SKU map에서 읽는다. |
| 실제 SKU 조합 | 같은 SKU API의 `skuInfoMap` 각 entry; `skuId`, `specAttrs` 또는 map key | SKU API 응답을 별도로 수집해야 한다. 일반 PC SSR 객체에 이 map이 항상 실린다는 근거는 없다. |
| 옵션별 가격 | SKU entry의 `discountPrice`, 없으면 `price`; `multiPrice` 별도 | 숫자 변환만 한다. CNY 필드는 없다. `skuPriceScale` 범위를 SKU 가격으로 복제하지 않는 점은 참고할 수 있다. |
| 통화 | `OfferResult`에 통화 필드 없음 | `¥` 표시나 1688 호스트만으로 CNY를 확정하는 구현으로 가져오면 안 된다. 본 프로젝트의 CNY 검증보다 약한 계약이다. |
| MOQ | `skuSelectorBizModel.skuSelectorModel.tradeModel.beginAmount` | 없으면 null이다. 혼합 MOQ는 `.mixModel.mixAmount`로 구분한다. 각 SKU 독립 MOQ의 검증은 아니다. |
| 수량별 가격 | 같은 trade model의 `offerPriceModel.currentPrices[].beginAmount/price` | 양수 숫자 tier만 남긴다. SKU별 가격 및 tier 적용 수량 계약을 검증하는 테스트는 없다. |
| 대표·추가 이미지 | `window.context.result.data.gallery.fields.mainImage[]`; 문자열 또는 `fullPathImageURI`, `size310x310ImageURI`, `imageURI` | 객체의 상대 경로에 alicdn prefix를 붙인다. YOOFAM의 URL 허용·보안 검증을 대체할 수 없다. |
| SKU 이미지 | 속성값 이름→이미지 map을 만든 뒤 `specAttrs` 첫 조각으로 찾고 대표 이미지로 fallback | 이미지가 실제 SKU 전용이라는 보장은 없다. 이름 충돌 시 map이 덮어써질 수 있으므로 단독 권위 자료로 쓰면 안 된다. |
| 상세 내용 | `window.context.result.data.description.fields.detailUrl` | 반환에는 상세 URL만 있다. 상세 HTML·사진을 이 단계에서 내려받거나 추출하는 코드는 없다. |
| 카테고리 | `description.fields.leafCategoryId` | 1688 자체 카테고리이며 Supplier Hub 카테고리 코드 매핑이 아니다. |
| 포장 크기·무게 | `productPackInfo.fields.pieceWeightScale.pieceWeightScaleInfo[]`: `skuId`, `sku1`, `length`, `width`, `height`, `weight`, `volume` | 타입 주석상 크기는 cm. 무게는 판매자에 따라 g/kg가 섞일 수 있는 원시 값이라고 명시한다(94~104행). YOOFAM의 실제 제출 g/mm로 변환할 단위 근거를 추가로 요구한다. |
| 상품 속성 | context 트리를 깊이 12까지 탐색해 `featureAttributes`/`productAttributes`/`attributes` 또는 name/value 모양 배열 선택 | 최초 모양 일치 배열을 선택하는 휴리스틱이다. 특정 상품에 귀속된 확정 경로를 보장하지 않는다. |

## 테스트가 증명하는 것

정적 파일 목록에서 `tests/offer-run.test.ts`의 두 테스트를 확인했다. 두 테스트 모두 `dispatch` 전체를 mock으로 바꾸고 이미 만들어진 `OfferResult`를 반환시킨다. 검증 대상은 단건 JSON 형식과 여러 상품의 결과 봉투/잘못된 번호 분리이다. SKU 응답 fixture, `window.context` fixture, `readPageInfo()`/`assemble()` 단위 테스트는 찾지 못했다. 따라서 이 두 테스트를 실제 상품 수집 또는 필드 정확성 증거로 계산하면 안 된다. 이번 조사에서는 해당 테스트를 실행하지 않았다.

`src/session/response-capture.ts`와 `src/session/mtop.ts`도 읽었다. 응답 캡처는 API matcher를 통과한 첫 truthy 파싱 결과를 사용한다. `parseMtop`은 JSON/JSONP wrapper만 해제하며 상품번호·통화·SKU 완전성을 검증하지 않는다.

## YOOFAM에 적용할 수 있는 범위

- 현재 `app/public-product-collector.ts`의 PC 입력은 명시적 JSON-LD Product/Offer만 허용한다. 위 widget 기반 제목·갤러리·포장 경로가 다른 경로에 존재할 수 있다는 점은 확인됐다.
- **위젯 제목만 읽고 전체 SKU를 조합하거나 대표 가격을 모든 옵션에 넣는 수정은 금지한다.** 본 저장소도 SKU 가격은 별도 API에서 얻는다.
- 입력 HTML에서 해당 객체의 정확한 JSON 구문, 정확한 offer ID, 실제 SKU map, 명시적 CNY, MOQ가 함께 존재하는 안전한 fixture를 확보한 뒤에만 새 완결 normalizer를 추가할 수 있다. `eval`/실제 사이트 스크립트 실행을 파서로 도입할 이유는 없다.
- 브라우저 실행·세션·API 응답 감시가 필요하다는 구조는 정적 분석 결과일 뿐이다. 이 조사 결과는 이미 차단된 1688 상품을 다른 도구·프로그램으로 읽을 권한이나 접근 경로를 제공하지 않는다.
- 이 공개 repo가 쿠플러스의 공급자이거나 쿠플러스 서버가 같은 방식으로 동작한다는 증거는 없다. 쿠플러스 서버 내부 공급자와 유료 API 필요 여부는 여전히 미확정이다.

## 실행 및 변경 기록

실행한 것은 공개 GitHub clone, 소스·테스트 텍스트 열람, 파일 해시 계산뿐이다. 앱 소스 수정 0건, 실제 상품 수집 0건, 상품·견적서 변경 0건, 테스트 실행 0건, 실접수 증명 0건이다.
