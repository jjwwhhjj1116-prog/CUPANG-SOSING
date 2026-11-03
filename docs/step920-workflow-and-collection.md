# Step920 — COUPLUS 수집 계약과 실제 검증 경계

2026-11-03. 보존된 COUPLUS 배포 JavaScript·CLI·REA Evidence와 로컬 합성 검증을 정리한다. 이번 조사에서는 1688·대체 상품·COUPLUS 서버에 새 요청을 보내지 않았고, 기존 상품을 재수집·저장·전송하지 않았다.

## 확인된 원문 수집 경로

일반 상품추가는 URL에서 offer 번호를 추출해 COUPLUS 자체 서버 **`POST /api/aiPage/getProductInfo`**에 `[{productId:<번호>}]`를 보낸다. Axios 응답의 **`response.data.result[0].result.result`**가 구조화 상품 원문이다. 원문을 받은 다음 확장 `GET_PRODUCT_INFO`로 Supplier Hub 카테고리 양식을 연결하고 상품을 저장한다. 이 확장 메시지를 1688 원문 수집기로 해석하지 않는다.

| 원문 필드 | 보존 클라이언트의 소비 |
|---|---|
| `subject`, `subjectTrans` | 원문·번역 상품명 |
| `productSkuInfos[]`, `productSaleInfo`, `minOrderQuantity` | 실제 옵션, 원가·재고·최소 주문 |
| `productImage.images` | 대표·갤러리·추가사진 후보 URL |
| `productSkuInfos[].skuAttributes[].skuImageUrl` | 첫 번째, 두 번째 속성 이미지, 첫 갤러리 순으로 옵션사진 fallback |
| `productAttribute` | 상품 `attributes`에 그대로 보존해 후속 AI 참고자료로 전달 |
| `productShippingInfo` | 객체를 그대로 보존해 후속 견적 AI 참고자료로 전달 |
| `description` | 상세 HTML에서 상세사진 후보 URL 추출 |

초기 후보는 화면 탭·스크롤이나 이미지 픽셀 전체 다운로드부터 시작하지 않는다. **서버가 이미 전달한 HTML과 URL 배열을 소비한다.** 따라서 이 계약은 후보를 빠르게 구성하는 구조를 설명하지만 실제 수집 지연·성공률을 입증하지 않는다. 서버 내부의 공식 API/제3자 공급자/캐시·권한·재시도는 미확인이다. CLI의 원격 도구 실행 기능만 복제해 같은 원문 공급원이 확보되는 것도 아니다.

## 상세사진 helper의 정확한 범위

`extractDetailImages(description)`는 `DOMParser(...,'text/html')` → `querySelectorAll('img')` → `img.src` 순으로 URL을 읽는다. jpg/jpeg/png/gif/webp 확장자 뒤 query/hash를 제거하고 빈값을 제외한다. 이어 `getDetailImagesWithTopBottom`이 기본설정의 상·하단 이미지를 앞·뒤에 삽입한다. 원문 상세사진과 설정 배너는 출처가 다르다. 후보 URL 추출은 이미지 번역·편집·최종 저장 완료와도 다르다.

원본 helper의 URL 처리를 자체 보안 정책으로 그대로 복제할 근거는 없다. 현재 자체 parser는 inert HTML 해석과 Alibaba CDN 검증 등 자체 계약을 유지한다.

## 포장·속성에서 확정하지 못한 것

보존 클라이언트는 `productShippingInfo`를 직접 SKU별 실측값으로 해석하지 않는다. `prepareAttributeRequest`는 객체가 없으면 `{skuShippingInfoList:[{weightKg:1,lengthCm:30,widthCm:20,heightCm:10}]}`를 참고자료로 만든다. 견적 AI 프롬프트는 배송정보를 참고하되 없으면 포장 크기·무게를 추정하도록 허용하고, 실패 경로에도 기본값이 있다. **포장칸이 채워진 사실은 공급자 원문 수집이나 실측 성공의 증거가 아니다.**

선택한 보존 main 5개에서 `skuShippingInfoList`는 프롬프트 2곳과 fallback 1곳에만 등장한다. 실제 응답 행의 SKU 식별자, 옵션과의 join, 단위 계약은 미확인이다. 합성 fixture의 `skuId`와 kg/cm 숫자를 실제 API 계약으로 취급하거나 `source:'package-table'` 실측값으로 승격하지 않는다. `productAttribute`도 shipped 코드에서는 통째로 보존·직렬화하며, 원소의 `attributeName/value` 직접 해석 근거는 확인되지 않았다. 해당 원소 형태는 현재 자체 OpenAPI 후보 계약이다.

## 실제965와 현재 후보 parser

사용자가 제공한 **965495834905 / 수집기2.1.80** 실제 진단은 옵션8, 속성0, 포장0, 상세사진0이다. 탭16, 상품정보 탭0, 본문패널0, 속성·포장·상세 제목0이며 상세문서 주소도 미확인이다. 실제 raw carrier가 어떤 형태인지는 확보되지 않았다. 이 숫자는 해당 recognizer가 자료를 찾지 못했다는 진단이며 사이트에 원문이 없다는 증거는 아니다.

새 후보 지원은 **현재 offer 식별자와 자체 `skuModel`을 함께 가진 literal primary record**의 `productAttribute`와 `description`만 좁게 정규화한다. 추천·상점 하위 객체를 재귀 탐색하지 않고, 배송 원문을 실측 포장으로 변환하지 않는다. 합성 fixture는 이 경로와 기존 회사·초안 연결을 검사한다. **2.1.81 빌드·패키지 검증 및 후보 parser 통과는 실제965 수집 성공 증거가 아니다.** 합성 단계 검증 역시 실제 원문 공급·AI 결과·1~7단계 전체 동등성·Hub 최종 접수 성공을 대신하지 않는다. 이전 생성물 불일치 경고는 최종 full build/check 및 123파일·2.1.81 패키지 검사로 해결됐다.

## 근거

- 원문 흐름과 정확한 범위: [Step705](step705-url-source-collection-parity-audit.md), [Step746](step746-current-url-acquisition-contract-2026-10-19.md). 재사용 intake REA parent `ev_1983224a44e1100a435aca7caaa76ebb6e1d9df782252092d57dcc695765e8ee`; CLI1.3.37 parent `ev_52b98239bfe56a801d9d058e990d32437210dd220a36bdde5f9870620dd50530`.
- 이미지 helper 신규 REA parent `ev_ca8a211d486c76c92ac30510f31025c52e7cac2efbf9f98e4300a7161f0bb74e`, summary `ev_907824dd2655d5f1f8850cff2f9521b2e835a8b0130d4086ca328fee414457a6`. [정확한 source/slice digest](../outputs/step920-rea-source-manifest.json), [portable Evidence bundle](../outputs/step920-rea-evidence-bundle.json). UI652 SHA-256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`; helper UTF-16 범위 `[465184,465468)`, `[465469,466254)`. 2개 helper 내부 정적 coverage이며 semantic unknown53, 실제 실행 증거가 아니다.
- 배송의 미확정 경계: [5개 shipped main의 hash·literal 위치](../outputs/step920-rea-shipping-contract.json), [보존 소비 함수](../outputs/step706-analysis-source-consumer-methods.json). main652 SHA-256 `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`; `prepareAttributeRequest` UTF-16 `[136502,138303)`.
- 수정 전 누락 재현: [합성 원문 probe](../outputs/step920-rea-offline-source-gap.json). 후보 지원 검증: [구조화 원문 테스트](../tests/page-source-structured-product.test.mjs). 두 자료 모두 실제965 원문 fixture가 아니다.
