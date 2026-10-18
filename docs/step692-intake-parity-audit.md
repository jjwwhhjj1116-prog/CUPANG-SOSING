# Step692 — 실제 SKU의 원문 대표 이미지 선택 대조

2026-10-18 KST. Step691 `9e3ea25` 이후 초기 상품 수집의 정규화와 옵션 이미지 연결을 읽었다. 기존 REA 지침·보존된 shipped artifact와 Evidence를 재사용했으며 같은 producer를 다시 실행하지 않았다. Couplus·Supplier Hub·1688·공유 Chrome·운영 DB·기존 작업 상품에는 접근하거나 변경하지 않았다. 아래 vendor 동작은 **정적 관찰**, 자체 코드 재현은 **격리된 합성 실행**이다.

## 우선 수정할 차이

실제 SKU가 있으나 첫 두 옵션 속성에 이미지 URL이 없을 때, 원본은 상품 갤러리 첫 이미지를 해당 SKU의 원본 대표 이미지로 지정한다. 자체 parser는 지금까지 옵션의 `imageIndex`를 생략했다. 공통 대표 이미지가 있기 때문에 견적서에 이미지가 안 보이는 문제라고 표현하면 틀린다. 차이는 **해당 SKU와 원래 사진의 명시적인 연결이 없다는 점**이다.

원본 선택 순서는 첫 번째 속성 이미지 → 두 번째 속성 이미지 → 상품 갤러리 첫 이미지다. 자체 parser는 모든 속성의 이미지 중 첫 URL을 선택하므로 세 번째 이후 속성에만 사진이 있을 때도 다른 사진을 고른다. 이 두 경우를 같은 좁은 parser 수정으로 맞출 수 있다. 가격·SKU identity·옵션명·새 회사 설정·견적 override·기존 상품을 바꿀 필요가 없다.

## 원본과 Evidence

| 항목 | 근거 |
| --- | --- |
| shipped UI artifact | `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js` |
| UI SHA-256 | `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc` |
| `processOptions` | UTF-16 `[466662,469077)` / slice SHA-256 `4a5671380c795a5b6e598bc3abfcdf54cb66318a62119f43478964ee68b0e3f0` |
| inert wrapper | `outputs/step660-intake-rea-selected/03-processOptions.js` / SHA-256 `7ce56d2c6afdeefff4691bb422334787c8d256c27b7138e5703a38b2d5ac1da9` |
| REA6.5 selected-source parent | `ev_5869fb5a1a6ec67485ac76e74414a221ecb4eb7a035d0344c07e66b28c7bcec2` |
| REA6.5 summary | `ev_40f57053660d6ff48348b5af5719c9cd3a761514c4acbf5cdeb4b62b7cadf68a` |
| `getMainImageUrl` | UTF-16 `[245498,245868)` / slice SHA-256 `a0851446725af56de661316efd0361c4a2c86482f9e92a6f9e6e31420f02f7c7` |
| image helper wrapper | `outputs/step653-rea-image-selected/901f-getMainImageUrl.js` / SHA-256 `68792380e4fed4474f4ad46a844def747c3fd9e612b32bfae6f721c21ac02f8b` |
| 기존 image-analysis parent | `ev_02780e2b058e642fc180a67b70caa803cccdc81f6dae0421b92e62c6c911e3a4` |

Step691에서 전체 파일·정확한 구간·wrapper SHA를 대조했고 이번에는 동일 artifact의 다른 normal-SKU 분기를 읽었다. REA6.5 결과는 2,531바이트·선택1파일·AST558개·parse failure0이다. 다른11파일은 inventory에만 들어가며 application/semantic graph partial, 각각 unknown11/231개다. 바깥 Vuex/import/`this` 연결과 서버 저장은 실행 보증으로 확대하지 않는다. 새 설치·원본 fetch·원본 bootstrap 실행·runtime session은 없다.

## 정적 관찰: 선택과 최종 사용

`processOptions`의 실제 SKU branch는 원래 순서의 `skuAttributes[0].skuImageUrl`, `skuAttributes[1].skuImageUrl`, `productImage.images[0]`를 JavaScript truthiness로 차례로 고른다. 고른 URL은 해당 옵션의 `mainImageStatus.image`에 저장한다. 첫 번째/두 번째 속성의 자체 `imageUrl`은 별도로 보존하고, 세 번째 이후 속성의 이미지는 이 선택식에서 읽지 않는다. SKU 원가 선택·재고·등록 옵션번호 산출은 별개다.

갤러리 fallback은 상품 단위 공통 이미지 상태를 참조하는 getter가 아니라, **그 시점의 갤러리 URL을 각 실제 SKU의 상태에 대입하는 방식**이다. `getMainImageUrl`은 선택 옵션의 `processedImage`를 우선하고 없으면 같은 옵션의 원본 `image`를 읽는다. 선택 옵션이 없으면 첫 옵션에 같은 우선순위를 적용한다. 실제 새 상품 처리나 견적 업로드를 실행한 결과는 아니다.

원본은 문자열 URL을 그대로 보관한다. 이 구간에는 HTTPS/CDN 허용 목록·URL canonicalization·200개 제한이 없다. 따라서 상대 URL 허용이나 임의 URL 업로드 성공, 원문 전체 이미지의 서버 처리까지 확인했다고 주장하지 않는다.

## 자체의 현재 조건과 실제 영향

조사 시작 시 `app/alibaba-product-result.ts`는 다음과 같이 동작했다.

- 모든 `skuAttributes` 중 null/undefined/빈 문자열이 아닌 `skuImageUrl`을 `image(...,'additional')`로 정규화한다.
- URL이 하나라도 있으면 첫 index를 옵션에 넣고, 전혀 없으면 `imageIndex` 자체를 생략한다.
- 갤러리를 먼저 등록한다. 첫 이미지는 `main`, 나머지는 `additional`이다. 같은 URL의 gallery/SKU 참조는 동일한 non-detail index를 재사용한다. 상세에 같은 URL이 있으면 별도의 detail 역할 index를 유지한다.

후속 연결은 이미 엄격하게 구현돼 있다.

1. `readOptionSourceImages`는 immutable receipt의 **명시적 imageIndex**, 동일 owner/product/job·이미지 풀과 정확한 비어 있지 않은 SKU를 묶는다. index가 없으면 원본 미리보기가 없다.
2. `collectedImageDraft`는 포함 옵션의 원래 supplier SKU·source/option 고유성·unverified imageKey·실제 저장 파일을 확인해 연결한다. index가 없으면 그 행은 갱신하지 않는다. 기존 manual·generated·공란 의도·제외 옵션을 넓게 덮는 새 fallback을 여기에 추가하면 안 된다.
3. SEO 편집기의 사진은 저장한 `row.imageKey` 또는 해당 `sourceImageKeys[row.id]`만 사용한다. 공통 대표 이미지까지 읽지 않으므로 이 경우 SEO 행에 원본 사진이 나타나지 않는다.
4. 견적은 이미 `quotationMainImageKeys(option, common)`으로 옵션 이미지가 없으면 공통 대표 이미지를 쓴다. 따라서 최초 화면에서 사진이 정상으로 보여도 source 연결이 동일하다는 뜻은 아니다. 뒤에 공통 이미지를 변경하면 기존의 null 옵션은 새 공통 이미지를 따르지만, 명시적인 source 이미지가 연결된 옵션은 원래 사진을 유지한다.

이는 existing common fallback의 결함으로 보고하지 않는다. 사용자가 옵션에서 ‘공통 대표 이미지 사용’을 명시적으로 고르면 null을 유지하는 기존 계약도 바꾸지 않는다. 이번 차이는 **새 receipt를 만들 때 원래 관찰된 SKU 사진의 index를 누락하는 것**이다.

## 합성 재현

자체 parser·`prepareCollectionProduct`·`collectedImageDraft`·견적 이미지 resolver만 실행했다. 합성 offer `90000000692`, 실제 SKU 형태 `69210001`, 첫 가격4.5, 재고0과 자체 CDN 식별 문자열을 사용했으며 이미지 다운로드·외부 네트워크·DB 쓰기는0이다.

| 합성 원문 | 수정 전 자체 결과 | 원본 정적 선택식 |
| --- | --- | --- |
| 첫 두 속성 URL 없음 | imageIndex 없음 | 갤러리 첫 이미지 |
| 첫·둘째 속성 모두 URL 있음 | 첫 URL | 첫 URL |
| 첫 URL 빈 문자열, 둘째 URL 있음 | 둘째 URL | 둘째 URL |
| 첫 두 속성 URL 없음, 세 번째에만 URL | 세 번째 URL | 갤러리 첫 이미지 |
| 첫 URL scheme-relative | `Invalid URL` | raw 값을 상태에 보관; 후속 실행 성공 여부 미확인 |

URL이 없는 첫 사례에서 실제 자체 image draft는 `changedOptions:0`, `row.imageKey:null`을 반환했고 공통 main에는 `owner/image-0.png`가 있었다. 최초 견적도 그 이미지를 정상으로 반환했다. 공통 이미지만 `owner/manual-common.png`로 바꾸면 해당 SKU 견적도 새 공통 이미지를 반환한다. source hash·상태·다섯 사례의 raw 결과는 ignored `outputs/step692-intake-parity-probe.json`에 있다. 이 자료는 수정 전 재현이며 새로운 구현의 최종 테스트·브라우저·배포 검수가 아니다.

## 좁은 구현 권고

1. 새 explicit OpenAPI 실제-SKU parser에서 첫 두 원래 속성만 이미지 선택 후보로 사용한다. 첫 값이 없으면 둘째, 둘 다 없으면 이미 등록한 갤러리 첫 index0을 넣는다. 전체 속성의 원문 이름·색상·사이즈·가격 규칙은 이 수정으로 바꾸지 않는다.
2. 갤러리 fallback은 기존 index0을 재사용한다. 새 같은 URL의 additional 행·복제 파일·시간 기반 image identity를 만들지 않는다. 같은 URL인 gallery/SKU index 재사용과 별도 detail 역할을 보존한다.
3. 명시적인 잘못된 URL은 조용히 갤러리로 바꾸지 않는다. 현재 HTTPS Alibaba CDN·credential/port/hash·크기·시간·상한 정책을 유지한다. scheme-relative·상대 주소 정책은 별도 검증 근거 없이 넓히지 않는다. 첫 두 URL의 truthy malformed 입력이 원본에서는 선택된다는 이유로 자체에서 성공 처리하지 않는다.
4. 현재 첫 두 후보를 모두 gallery에 보존할지 선택 URL만 보존할지는 후보 목록의 별도 정책이다. 원본에는 first/second imageUrl이 모두 남으므로 둘째 후보를 선택하지 않았다고 파괴할 근거는 없다. 세 번째 이후 URL을 옵션 대표 선택 후보에 넣지 않는 것과 다른 상품 속성의 원문 보존을 구분한다.
5. receipt URL200개·실제 상품 이미지 풀150개·일회 import50개·역할별 배치 제한은 그대로 유지한다. fallback index0은 count를 늘리지 않는다. 원본에 보이지 않는 상한을 동등성 근거로 삼거나 제한을 우회하지 않는다.
6. 명시적 SKU 없는 Step691 기본 옵션은 계속 blank supplier SKU/unverified와 common main을 쓴다. 일반 SKU의 정확한 source identity guard를 완화해 기본 옵션이나 삭제·수정·중복 SKU에 자동 사진을 붙이지 않는다. 과거 immutable receipt에 imageIndex를 소급 추가하지 않는다.

검수에서는 원가·MOQ·재고·회사·카테고리·원문/수동 수정값 보존과 함께 first/second/fallback·제3속성·gallery URL 중복·200개 경계·잘못된 선택 URL·두 회사 실제 로컬 handler·수동 공통 변경 후 source 연결 보존을 확인한다. 이미지 처리·번역·Hub 전송 성공으로 표시하지 않는다.

## 조사에서 제외한 반복 구현과 미확인

Step662 문서의 ‘150자 태그 끝 제거 미구현’은 현재 코드에 대해 오래된 설명이다. `prepareSeoKeywordText`, `SeoWorkspaceEditor`의 저장안/최종 저장안, `seo-workspace` 정규화와 `seo-keyword-save-parity` 검사가 이미 있다. 같은 기능을 새로 구현할 차이로 제출하지 않았다.

추가로 `productShippingInfo`가 vendor 상품과 견적 AI 참고 자료로 전달되지만 자체 canonical collection receipt에는 없는 점을 읽었다. 실제 API shipping shape·단위·SKU 연결 및 실측 포장값과의 관계가 미검증이므로 이번 이미지 선택 변경에 추정 포장값이나100g/100mm 기본값을 섞지 않는다. 관련 물류 차이는 별도 근거와 검토가 필요하다.

현재 실제 provider 응답·모든 최신 카테고리·비공개 수집 서버/cache·AI 출력·새 실제 상품의 Hub 접수는 미확인이다. 정적 메서드의 분기와 자체 합성 연결만으로 전체 복제 완료 또는 접수 완료라고 판정하지 않는다.

## 후속 구현의 좁은 독립 검토

root의 최초 선택식 수정에서 첫 번째 후보만 receipt에 넣어 선택하지 않은 두 번째 유효 후보가 사라지는 회귀를 확인했다. 서로 다른 first/second URL을 가진 자체 합성 원문에서 첫 후보는 보존되고 둘째 후보는 누락됐다. 원본은 `option1.imageUrl`과 `option2.imageUrl`을 모두 보존하므로, 첫 두 후보를 함께 정규화·보존하고 대표 선택 index만 첫 후보 또는0으로 정하는 수정을 권고했다. root가 이를 반영한 뒤 두 후보 보존과 대표 우선순위를 다시 확인했다. 앱 코드는 이 검토자가 수정하지 않았다.

최종 parser와 별도 mobile transport의 실패한 초기 준비 promise 제거 변경을 읽었다. 자체 합성 단언16개에서 첫/둘째/갤러리·제3속성 배제·동일 URL 재사용·200개 경계·잘못된 CDN 후보 거절·실제 SKU의 원본 이미지 유지·blank SKU 분리와 transport 실패 후 명시 재시도/성공 cache/취소/offer·app context guard를 확인했다. 미해결 actionable 지적은 없다. 두 source SHA와 수정 전 후보 손실, 최종 단언은 ignored `outputs/step692-independent-review.json`에 보관했다. 이는 release test 총계에 자동 합산하는 숫자가 아니며, 실제 Chrome API·네트워크·운영 DB·기존 상품·Hub 동작은 수행하지 않았다.
