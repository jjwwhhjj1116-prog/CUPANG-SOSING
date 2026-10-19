# Step738 — 공개 모바일 원문의 갤러리 출처 경계

2026-10-19 KST. 기준 commit `5681dd6166deeead24f0a5c76c6384f57df0d235`. 이 담당은 보관된 원본 계약과 자체 full/partial mobile·SKU-only·Chrome retag·append-only supplement 연결을 읽기 전용으로 분석했다. 앱·테스트·확장 변경, 브라우저, 네트워크, collector/CLI 실행, 원격 API, 운영 자료/기존 상품 접근은 모두0이다. 작업 중 root의 수정과 섞이지 않게 독립 재현은 `git show <기준>:<파일>`의 해당 commit source를 읽어 자체 parser만 실행했다. 차단된 1688/Open1688 주소를 다시 읽거나 우회하지 않았다.

## 적용 가능한 범위

**새 full/partial mobile receipt는 출처가 확인된 gallery marker를 보존할 수 있다. SKU-only receipt에는 만들면 안 된다.** 두 경로가 공유 private parser의 `source.gallery`를 사용한다는 사실만으로 같은 관측 수준인 것은 아니다.

`parseAlibabaMobilePage`는 literal `window.__INIT_DATA`만 읽고, 요청 offer ID와 일치하는 populated component 중 `offerImgList`를 가진 component가 정확히 하나인지 확인한다. 비어 있지 않은 해당 배열을 `page.gallery`로 돌려준다. 이는 **그 페이지가 명시적으로 공개한 갤러리 목록**의 근거다. hidden/미게시 사진이나 현재 실상품의 모든 사진이 빠짐없이 있다는 보증까지 의미하지는 않는다. 동일 page/response의 offer ID·원문 title·SKU identity·가격 검증도 그대로 유지한다.

반면 `parseAlibabaPublicSkuProduct`는 별도 SKU 응답의 `offerBaseInfo.picUrl` 한 장을 `gallery:[text(base.picUrl)]`로 구성해 같은 private `parseAlibabaSkuProduct`에 넘긴다. 그 응답은 full gallery·일반 속성·상세 설명을 포함하지 않는다는 명시적 주석과 실제 자료 구조가 있다. 이 한 장과 SKU별 사진을 모아 '전체 갤러리'로 표시해서는 안 된다. `source.gallery.length>0`, `provider`의 느슨한 prefix match, 또는 SKU 사진의 존재만 보고 marker를 만드는 구현은 잘못이다.

보관된 2026-09-30 product-only fixture를 기준 source의 자체 parser에 넣은 격리 재현에서 page의 `offerImgList`는5개, full mobile 정규 images는8개(갤러리+SKU 후보), SKU-only 정규 images는4개(대표 한 장+SKU 후보)였다. 양쪽 SKU·원가·재고·MOQ는 같았다. 이는 기존 fixture parser 검수이지 새 HTTP 응답이나 Couplus backend의 관측이 아니다.

## 최소 구현 권고

1. `parseAlibabaMobileProduct`에서만 `1688-public-mobile-gallery-v1` 같은 독립 format을 선택해 private parser에 명시적으로 전달한다. 갤러리 URL들을 기존 규칙대로 정규화·고유 index 등록한 직후, SKU 사진을 append하기 **전에** 고정된 prefix index를 보존한다. SKU-only wrapper에는 이 근거 flag/format을 전달하지 않는다. 기존 URL·수량 구간 가격·실제 SKU·순서·첫/둘째 사진 후보·fallback·이미지 역할 정책은 바꾸지 않는다.
2. 공통 marker의 descriptor-safe 정확한 key·밀집 정수 prefix·중복/범위·첫 main/나머지 additional 검증은 유지하고 format별 provider를 분리한다. OpenAPI marker의 provider를 무조건 넓혀 public 자료도 OpenAPI로 부르면 안 된다. public marker는 아래 matrix의 명시 값만 허용한다.
3. `parseBrowserProductCapture`의 full/partial branches는 내부 full parser의 결과를 spread한 뒤 provider만 Chrome 값으로 바꾼다. `collectAlibabaMobileProduct`의 partial branches도 spread retag다. 따라서 새 marker를 그 과정에서 잃지 않도록 하되 validator 반환의 format type과 provider 허용값이 **모든 retag 후 값**과 일치해야 한다. 그렇지 않으면 수집 저장은 성공했는데 이후 `/result`/import의 정규화가 같은 receipt를 거절할 수 있다. 원문 입력에 사용자가 임의 marker를 붙여 주입하는 새로운 request field는 필요 없다.
4. partial의 뜻은 상세 조회 실패다. page gallery를 검증한 뒤의 `VerifiedMobileDetailUnavailable.result`와 명시 502/503/504 partial capture 모두 정상 full page gallery를 가지고 있으므로 같은 public marker를 유지할 수 있다. gallery 자체가 누락·private·다른 offer·모호하면 기존대로 hard failure이며 partial로 승격하지 않는다. 상세 사진은 없는데 생성된 것처럼 marker에 넣거나 일반 finalwire로 채우면 안 된다.
5. supplement는 현재의 `...original`을 유지한다. 원래 OpenAPI marker는 OpenAPI format, 원래 public marker는 public format으로 보존하면서 provider만 supplement로 바뀌어도 validator가 받아야 한다. **원래 marker가 없으면 캡처한 full source의 marker를 새로 복사하지 않는다.** 기존 images prefix가 SKU-only/base사진/다른 순서일 수 있어 captured `[0..n]`가 같은 이미지를 가리킨다는 보장이 없다. append-only라는 원문·index identity를 깨고 역추정할 수 없다. 새 SKU-only 수집 직후 상품 생성 전에 full source로 보완하는 경우도, 이미 저장한 첫 receipt가 unmarked이면 이 원칙을 지킨다.
6. marker 없는 이전 mobile/SKU/JSON-LD receipt의 배치 정책과 immutable payload를 소급 바꾸지 않는다. 새 full/partial mobile에서만 공통 additional 자동 선택을 gallery 후보로 좁히고, 모든 SKU 후보의 파일 저장·원본 자료함·옵션 대표 연결·직접 Stage4 선택·수동 공란/번역 provenance 보호는 Step737의 predicate 분리로 유지한다. 기존 상품을 재수집하거나 marker를 추가하는 migration은 필요 없다.

| marker format | 허용 provider | 거절 경계 |
| --- | --- | --- |
| `1688-openapi-gallery-v1` | `1688-openapi-candidate-v1`, `chrome-public-mobile-supplement-v1` | public full/partial/sku·JSON-LD로 retag해 OpenAPI 근거를 주장하지 않음 |
| 신규 public-mobile format | `1688-public-mobile-v1`, `1688-public-mobile-partial-v1`, `chrome-public-mobile-v1`, `chrome-public-mobile-partial-v1`, `chrome-public-mobile-supplement-v1` | `1688-public-sku-v1`, `chrome-public-sku-v1`, `chrome-product-jsonld-v1`, `1688-openapi-candidate-v1` |

이는 pending 갤러리 **후보의 출처·자동 배치 구분**에 관한 범위다. 원본의 첫 gallery 사진을 최초 최종 견적 additional wire에 중복 넣거나, 수집된 사진이 번역·검수까지 완료됐다고 표시하는 근거가 아니다.

## 원본과 재현 근거

Couplus 현재 보관 route는 `outputs/step725-current-ui/chunk-36123f1a.155d5b9e.js`, SHA-256 `2fb15d370c331f65d982a886f2888b813ccae67277e87f806182c70032821664`다. `processOptions` UTF-16 `[467246,469661)`, slice SHA `3b006f4f7a14b17fcdaf1846dc7fbb3717ae87b35952a86bbc7bbf2af672f5bb`를 재사용했다. 기본/실제 SKU의 `additionalImageStatus.images`는 `t.productImage.images`이며 첫/둘째 SKU 사진은 별도 필드다. Step737에서 현재 source와 이전 source가 alias 치환 외 같음을 확인했고 새 producer는 실행하지 않았다.

REA 재사용 parent는 `ev_5869fb5a1a6ec67485ac76e74414a221ecb4eb7a035d0344c07e66b28c7bcec2`, summary는 `ev_40f57053660d6ff48348b5af5719c9cd3a761514c4acbf5cdeb4b62b7cadf68a`다. 선택 한 함수의 정적 Evidence이고 application/semantic partial·unknown11/231을 유지한다. Couplus가 자체 public/mobile 공급 경로를 사용하는지, 실제 새 원문/API·모든 카테고리·이미지 번역 품질·Hub 접수는 미확인이다.

`outputs/step738-public-gallery-proof.{mjs,json}`에 기준 source의 SHA-256, 해당 gallery/SKU fallback/Chrome·server partial retag/supplement 정확한 UTF-16 범위와 slice SHA, 보관 fixture SHA·크기와 자체 parser 결과를 보관했다. 원문 gallery 목록과 `picUrl`의 관측 수준 차이를 확인한 결과이며, full workflow 릴리스 검사 숫자나 새로운 실제 수집 성공으로 합산하지 않는다.

## 수정 후 독립 검토

root가 구현한 `observedGallery` flag는 full-page wrapper에서만 true로 전달되고 SKU-only wrapper는 기본 false를 유지한다. gallery를 정규화한 직후 고유 prefix를 보존해 SKU 사진·detail 사진의 뒤 append가 marker에 섞이지 않는다. `1688-public-mobile-gallery-v1`은 위 public provider matrix에만 허용되고 OpenAPI marker는 별도 matrix를 유지한다. Chrome full/partial와 서버 partial retag에서도 format·prefix가 보존돼 receipt 재정규화에 통과한다. 기존 supplement의 원래 marker만 유지하는 spread와 원문/SKU/index identity guard는 바뀌지 않았다. common-stage/옵션 연결의 Step737 보호 조건도 유지된다.

검토 초기에 full/SKU-only의 옵션 객체를 raw `imageIndex`까지 같다고 비교한 독립 단언이 실패했다. 이 두 receipt는 다른 이미지 inventory를 가지므로 동일 SKU 사진이 다른 index일 수 있다. 실제 예에서는 Green이 full=1/SKU-only=2, Blue가 full=2/SKU-only=1이지만 각 inventory에서 해석한 URL은 정확히 같았다. 기존 source의 이미지 삽입 순서이므로 runtime을 바꿀 결함은 아니다. 최신 신규 테스트가 SKU 사실과 해석한 `imageUrl`로 비교하도록 수정된 것을 확인했고 독립 단언도 같은 의미로 고쳤다.

최종 자체 격리 parser 단언10개가 통과했다. full gallery prefix, SKU-only marker 없음과 대표 URL, Chrome의 full/세 partial 상태 roundtrip, 서버 partial spread의 유효성, format/provider 분리, missing·중복·private gallery 거절, public/OpenAPI 원래 marker supplement, unmarked/SKU-only 소급 marker 금지, 수동 공란/제외 대표 보존, marker descriptor-safe 거절을 확인했다. 실제 collector는 실행하지 않았다. getter 실행0, 앱/테스트/확장 수정0, 네트워크·브라우저·운영 DB·기존 상품 접근0이며, 검토 source12개와 로드한 자체 source 전체의 실행 전후 SHA가 같다. actionable runtime 지적은 없다.

| 핵심 검토 source | 최종 SHA-256 |
| --- | --- |
| `app/collection-gallery.ts` | `24bd3c0c4dba9c1e0c37c02d37a6cc32415d0fb7ef89ead1ce8454d5236ebd6a` |
| `app/alibaba-mobile-product.ts` | `986ea1ce40bc2c3dedc0ce8606252b39eb7d689a647387838090beda575a5109` |
| `app/browser-product-capture.ts` | `ce3042a80bb5ca3f312c0a4eb53797c50853a25182bd55939dfa709095648f17` |
| `app/alibaba-mobile-collector.ts` | `5277069ad38267edd7f2aeb45176f1175dce7da379b74b8a19ba63cf2f9e0241` |
| `app/collection-source-supplement.ts` | `23bf30a7f1c0fac57f3d097773d1d5c8ed8b1378e06a14708016be8c277b8515` |
| `tests/public-mobile-gallery.test.mjs` | `17370abac26d608f88bb2552cb917bbf9e32daa9239b24ba2d84bb18ce326d87` |
| `tests/public-mobile-gallery-api.test.mjs` | `97e0ea2766aeb462ee65c085349b1f6ff326a3c18f0448215e52f78993f61680` |

전체 조건과 해시는 `outputs/step738-public-gallery-review.{mjs,json}`에 있다. 독립 단언10개는 root 릴리스 검사 총계에 중복 합산하지 않는다. 실제 새 원문·번역·접수의 확인이나 전체 기능 완료를 주장하지 않는다.
