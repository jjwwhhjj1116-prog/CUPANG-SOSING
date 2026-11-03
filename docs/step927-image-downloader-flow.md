# Chrome의 1688 이미지 다운로드 확장 분석

2026-11-03. 일반 Google Chrome의 `User Data/Default` 및 `Profile N/Extensions`에 설치된 공개 manifest와 JavaScript만 읽었다. Aside의 확장 목록과 구분했다. 확장 실행·설치·복사, 브라우저 연결, 1688 본문 접근, 쿠키/비밀번호/로그인 DB 열기, 상품 변경, 외부 HTTP 요청은 하지 않았다. 설치 디렉터리 존재는 활성화·실행 관찰을 뜻하지 않는다.

## 대상과 증거

| 설치 위치 | 확장 | 버전·ID | 확인 범위 |
|---|---|---|---|
| Chrome Default | AiPrice(AliPrice) - TB以图搜同款 | 5.1.9 · `fahhlhbhnmkjegdfoiadmnhcclidoflh` | 이미지 다운로드 버튼과 1688 전용 파서·원본 URL 변환·background 다운로드 |
| Chrome Default | 셀러라이프 | 1.2.1.94 · `cgococegfcmmfcjggpgelfbjkkncclkf` | 상품 위젯의 이미지 추출 버튼 → side-panel 연결까지만 |
| Chrome Profile 21 | 淘宝图片下载器 | 5.1.6 · `adiiljmikodifdicmceknnjagffknaok` | 이름·manifest와 AiPrice 계열 번들 구조 존재만. 별도 동작 동등성은 미확인 |

기준 대상 경로는 `C:/Users/7500F/AppData/Local/Google/Chrome/User Data/Default/Extensions/fahhlhbhnmkjegdfoiadmnhcclidoflh/5.1.9_0`이다. 전체 manifest 목록은 `outputs/step927-chrome-extension-inventory.json`에 남겼다.

- REA parent: `ev_4191fdb9c394edac2da5606fcbb610dbc060f9b5a83fbb321f89c89d9b9fed36`.
- REA summary: `ev_9898afb32267e08912764b3a8b6aaeb9c5f184dd61aa41a2552dcf7ccb2476d3`.
- content-script module view: `ev_4c6b2e4f36a72b8f79d02d8cf312988b641483d8d53d55a3d90550c61a4e9fe1`.
- root artifact SHA256: `063c305e2c7d963d733b5544ff0a99870082453f296165df1676977f52d92deb`.
- manifest SHA256: `ea1b48230c23550aa749af4dce2adf5097573b6381f5f0e64de95b7fedd49cea`.

관련 파일45개, JS12개를 정적으로 읽었으며 JS parse 실패는0개다. vendor 및 동적 코드 때문에 전체 application/semantic graph는 **partial**이고 semantic unknown 9,352개가 남았다. 따라서 아래는 정확한 파일·함수 범위의 정적 관찰이며 실제 클릭 성공이나 현재 사이트와의 호환성을 증명하지 않는다. 원문 스크립트를 실행하지 않았다. 축약한 REA 증거는 `outputs/step927-aliprice-rea-evidence.json`, 파일별 SHA·UTF-16 반열린 범위·짧은 원문은 `outputs/step927-image-downloader-source-locations.json`에 있다.

## 실제 다운로드 경로에서 확인한 것

1. 다운로드 UI는 선택 이미지를 `main`·`variant`·`desc` 등으로 분리한다. 파일 다운로드와 ZIP을 별도 동작으로 제공한다. 다운로드 권한은 manifest의 기본 권한이 아니라 `optional_permissions: ["downloads"]`이며 실행 경로에서 권한 확인을 거친다.
2. 1688용 `Goe` 파서의 대표/갤러리는 `@ali/tdmod-pc-od-main-pic`가 든 페이지 스크립트에서 `offerImgList`를 먼저 읽는다. 없으면 `.od-picture-gallery-list .v-image-cover`, `.img-list-wrapper .detail-gallery-img`, `#gallery ...` 등의 DOM으로 돌아간다.
3. 옵션 대표사진은 별도 `variant` 그룹에서 SKU 이미지 DOM을 읽는다. `.od-gyp-pc-sku-selection ... .single-sku-img-pop`, `#skuSelection .ant-image-img`, `.sku-panel .sku-panel-item-img`, `.pc-sku-wrapper .prop-item .prop-img, .sku-item-image`가 포함된다. 갤러리 사진과 옵션 사진을 같은 목록으로 추정하지 않는다.
4. 상세사진은 `#detail img` 및 `#detailContentContainer .content-detail img`에서 `data-lazyload-src`를 우선한다. 공통 파서는 추가로 `data-src`, `currentSrc`, `src`, CSS background를 읽는다. 이 1688 다운로드 설정 자체에는 별도 desc API나 iframe 문서 조회가 없다. 일반 파서는 플랫폼별 클릭/스크롤 훅을 지원하지만, 1688 설정의 `scrollTo`는 `-1`이므로 이 경로가 상세 전체를 강제로 스크롤한다고 말할 수 없다.
5. 수집한 URL은 `oriSrc`에 남기고, 실제 다운로드 대상 `src`는 `formatAlicdnImg.img2Large`로 만든다. 이 함수는 지원 CDN에서 `.webp`, `_80x80.jpg`, `_q숫자`, 크기 접미사, `.search` 등의 변형을 제거한다. 이것이 YOOFAM의 현재 단순 URL 정규화와 가장 분명하게 다른 부분이다. 변환 URL이 실제로 존재하는지는 정적 코드만으로 확인되지 않는다.
6. 일반 파일 다운로드는 content-script → `backend/download` → background의 `browser.downloads.download({url, filename})`로 진행한다. 50개씩 제출하고 `backend/download/search`로 완료/중단 상태를 조회한다. URL 추출과 브라우저 파일 저장은 별도 단계다.
7. ZIP은 content-script → `backend/fetch_file_as_dataURL` → background fetch/Blob → `createImageBitmap` → Canvas/OffscreenCanvas → data URL → ZIP 경로다. 요청 옵션은 `resize:false`, `quality:1`이지만 Canvas 재인코딩을 거치므로 **원본 바이트/SHA가 그대로라는 뜻은 아니다**. 무조건 이 ZIP 경로를 YOOFAM의 원문 보관에 가져오는 것은 적절하지 않다.

주요 정적 위치(UTF-16 반열린 범위):

| 파일 | 범위 | 내용 |
|---|---|---|
| `assets/js/content-script.js` | `[1799042,1801380)` | 1688 `Goe`의 main/variant/desc 설정 |
| 같은 파일 | `[1790223,1791592)` | 공통 `Ooe` 이미지 속성 추출 → `img2Large` |
| 같은 파일 | `[1771529,1775259)` | 선택 파일의 background 다운로드·상태 조회 |
| 같은 파일 | `[1775240,1778076)` | ZIP용 이미지 fetch 및 `resize:false` |
| `assets/js/chunk-common-5c551db8.js` | `[977394,978771)` | Alicdn 원본 후보 URL 복원 |
| `assets/js/background.js` | `[1419911,1420260)` | fetch-file data URL helper |
| 같은 파일 | `[1418886,1419244)` | Canvas 재인코딩 |

content-script SHA256는 `482cca4612df511b8cf09b910da8b45cc1b6c2b8b858aac4cf609de7d380d8e6`, common chunk는 `ca17b5b3c0c96847d14d384e36490b799780bbe3c0287b19f6c5ed6d9b1fdd93`, background는 `29c89ab67a10c83af4c493132affe0e985fda4ef9cd6e080e8e49b0db4db9a6b`이다.

별도 `inject-script.js`의 대행/장바구니용 수집기는 `window.__INIT_DATA` 또는 `context.result`에서 원문·SKU·`detailUrl`을 읽고 상세 탭을 누른 뒤 lazy 속성으로 HTML을 복원한다. 그러나 위 다운로드 버튼이 이 별도 함수를 호출한다는 연결은 확인하지 못했으므로 다운로드 경로와 합쳐 설명하지 않았다.

셀러라이프 쪽 REA parent `ev_8ae4854e4a9ce44922f263f53a05f130b4cec90043978eda675d3bd78d6fffb3` / summary `ev_ad069254aca793f24b49d6e828eb68df5d331c80360b49c7a1df97ad4809fb87`는 `sourcing/js` 2파일·6,957bytes·parse 실패0개다. 상품 위젯 `sourcingContent.js`가 iframe을 만들고, `sourcing.js`의 이미지추출 버튼이 `OPEN_SIDE_PANEL_FEATURE`/`feature:"capture"`를 background에 전달하는 지점까지만 확인했다. 이 위젯이 직접 SKU/상세 URL을 수집한다고 판단하지 않았다. 해당 두 파일 SHA는 각각 `2b58b93ed33e9920b8dbaf3da187af09058f539f089e8ca0fe154c9d20ee2f77`, `41f968bb977c34704ae9b9abfd2aca9fabb4d43717ea0572c59c781bea338151`이다.

## YOOFAM에 필요한 적용 범위

현재 YOOFAM은 확장에서 DOM/JSON의 URL을 수집함에 저장하고 서버의 `app/collection-image.ts` → `app/collection-image-store.ts`에서 실제 bytes를 R2로 저장한다. 다운로드 단계에서 사진을 resize/re-encode하지는 않는다. 따라서 **다운로더를 설치하거나 ZIP을 거쳐야 수집이 되는 구조는 아니다.**

비교로 확정한 보완 순서는 다음과 같다.

- 관측된 `originalImageURI`·lazy 속성·가장 큰 srcset 후보를 역할별로 우선 선택한다. 선택 원천과 원래 URL을 남긴다.
- 추가할 CDN 원본 URL 복원은 지원 호스트·인식 가능한 접미사로 한정하고, 후보 파일의 실제 응답·MIME·크기·SHA를 검증한다. 404/403 또는 불일치이면 기존 관측 URL을 보존한다. 이름만 보고 원본이라고 확정하거나 무제한 우회 호출하지 않는다.
- 대표/옵션/추가/상세 역할과 순서를 분리해서 저장한다. 주소 추출 성공과 bytes 저장 성공·누락 상태를 구별한다.
- 서버 다운로드가 실패하는 경우에만 실패 단계와 응답 증거로 브라우저 bytes 전달 필요성을 판단한다. 이 정적 조사만으로 쿠키/로그인이나 브라우저 다운로드가 필요하다고 결론내릴 수 없다.

이번 조사에서는 production 코드를 변경하지 않았다. 원본35장 전체를 보존하는 multipart 상세 저장은 앞 작업에서 별도로 구현·검수한 기능이며, 이번 다운로더 조사와 혼동하지 않는다. 현재 사이트에서 어느 확장이 활성화되어 있고 사용자가 가리킨 버튼이 어느 것인지는 실 UI 관찰 없이 미확인으로 남긴다.

## 후속 적용: YOOFAM 2.1.85 구현과 검증 상태

이 절은 위 정적 조사 이후 별도 개발 작업에서 반영한 내용을 기록한다. 외부 확장 코드를 실행하거나 제품에 복사한 결과가 아니다. 확장 manifest·패키지 2.1.85 빌드를 확인했으며, 실제 CDN 다운로드 성공 여부는 아직 검증 대기다.

`app/collection-image.ts`에는 `ali-cdn-original-v1` 원본 후보 다운로드를 적용했다. 기존 HTTPS Alibaba CDN 허용 범위를 유지하며, query가 없는 `/img/ibank/` 경로 중 인식 가능한 JPG/PNG의 크기·품질·WebP 래퍼 접미사만 제거한다. 크기 및 품질 숫자도 허용 범위를 확인한다. query가 있는 서명 가능 URL이나 알 수 없는 패턴은 수정하지 않는다. 확장자와 경로만으로 원본 존재를 확정하지 않는다.

후보 응답이 **404 또는 410**일 때만 수집 당시 관측 URL로 한 번 돌아간다. 403·서버 오류·네트워크 실패·형식 불일치에는 자동 복귀나 재호출을 하지 않는다. 후보와 복귀 요청은 하나의 AbortController와 **공유 15초** 제한을 사용한다. 따라서 앞 절의 검토 제안과 달리, 실제 적용 코드의 자동 복귀 경계는 404/410으로 한정된다.

원문 수집 receipt의 URL·순서·옵션 연결은 변경하지 않는다. 실제 수신 bytes의 형식과 크기를 확인하고 SHA-256을 계산하며, 재인코딩·리사이즈 없이 그 bytes를 역할별 SHA 키로 R2에 저장한다. `app/collection-image-store.ts`에는 선택 경로가 `original`인지 `observed-fallback`인지와 관측 URL/다운로드 URL의 SHA를 metadata로 기록한다. URL 원문을 바꿔서 더 높은 품질이었다고 표시하지 않는다. 기존 수집본에서 이미 저장한 이미지가 있으면 기존 파일을 확인해 재사용하며, 새 후보 정책 때문에 저장된 이미지나 수동 편집·역할 배치를 교체하지 않는다.

`extensions/supplier-hub/page-dom-details.mjs`의 상세사진 선택에는 관측된 `data-srcset`/`srcset` 후보 처리를 추가했다. 현재 상품의 검증된 상세 영역 안에서 유효한 허용 URL만 고려하고, 같은 단위(`w` 또는 `x`) 안에서 가장 큰 값을 선택한다. 폭과 배율 숫자를 서로 비교하지 않는다. 단위가 혼합되거나 descriptor가 잘못된 목록은 채택하지 않으며, 유효한 srcset 후보가 없으면 기존 lazy 속성·표시 URL 선택으로 돌아간다. 새 CDN 주소를 생성하거나 추천 상품·리뷰·다른 상품 영역으로 탐색 범위를 넓히지 않는다.

검증 기록:

- 서버 이미지 다운로드·저장 독립 검사 **40/40 통과**: `outputs/step927-collection-original-independent-review.log`.
- 상세 srcset 집중 검사 **8/8 통과**: `outputs/step927-detail-srcset-green.log`. 기존 호출부 검사도 `outputs/step927-detail-srcset-callers.log`에서 **58/58 통과**했다.
- 확장 **2.1.85 / 124파일** 빌드·패키징 완료: `outputs/step927-extension-build.log`. 패키지 SHA-256은 `aff38a304bd1dc2e1ee076e512bee532ee334c03b1501209bbfc710c9264a803`이다. 이 기록은 설치된 실행 버전이나 실제 사이트 수집 성공을 의미하지 않는다.

별도 Aside 실 UI 확인에서는 SellerLife의 ‘이 화면 이미지 추출’ 버튼을 한 번 눌렀으나, 제어 도구에 노출된 이미지 선택창이나 새 탭은 관찰되지 않았다. 버튼 존재와 클릭만 확인했으며 해당 외부 다운로더가 실제로 사진을 추출·다운로드했다고 판단하지 않았다.

## 배포 및 공개 CDN 표본 확인

위 검토 후 현재 양말 상품 `965495834905`의 DOM에서 관측된 `O1CN013a8MTM1xIPpFu97Ae_!!2219010046420-0-cib.jpg_.webp`를 입력으로 실제 `downloadCollectionImage`를 읽기 전용 실행했다. 원본 후보 `.jpg` 요청 1회가 HTTP 200 / `image/jpeg` / 237,122 bytes / 800×800으로 응답했고, 받은 bytes의 SHA-256은 `9263f6abc6c2cecf4a72d9f60b5c619b815855bfcdf023b6ec64c7e9381ef107`이다. 쿠키를 보내거나 제품·이미지 저장 상태를 변경하지 않았다. 근거는 `outputs/step927-cdn-live-check.json`이며, 이 한 표본이 다른 모든 CDN 주소의 존재나 품질 향상을 증명하지는 않는다. 실제 404/410 fallback은 모의 응답 검사로 검증했으며 사이트에서 강제로 유도하지 않았다.

Worker 배포 `d4760158-a528-4851-af75-5023d85fbde2`와 브라우저에서 받은 확장 ZIP의 HTTP 200 / 2,171,979 bytes / 위 패키지 SHA 일치를 확인했다. Aside 확장 관리 UI에서 저장소의 `extensions/supplier-hub` 경로·새로고침 완료·2.1.85를 확인했고, 상품 탭을 새로고침한 뒤 DOM의 `data-yoofam-collector-version`과 화면 배지 모두 2.1.85인 것을 확인했다.

그 뒤 첫 수집 시도는 화면 조작/이동 감지로 저장 전에 중단됐다. 서버 목록은 원래 수집본 3개 그대로였다. 새 수집본으로 검증한 성공이라고 보고하지 않는다. 추가 클릭은 중복 수집본 생성 가능성을 이유로 자동 승인 검토에서 거절돼 실행하지 않았으며, 검수용 재수집 1회에 대한 사용자 답변을 기다린다. 기존 2.1.84 수집본 3번은 속성23개·포장8/8옵션·상세38배치(고유35장)이며, 이 수집본의 원본 사진 저장·3개 긴 상세 파일 생성은 별도의 완료된 검수다. 새 수집본의 사진 품질 검수는 아직 후속 단계다. 기존 상품을 교체하거나 서플라이허브로 재전송하지 않았다.
