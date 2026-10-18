# Step694 — 등록전송 문서·이미지·접수 판정 대조

2026-10-18 KST. 기준 `47c0f58`. 기존 REA 지침과 보관된 Couplus UI/설치 확장 artifact를 재사용했다. 신규 원본 수집·producer 실행·vendor 코드 실행은 없다. 실제 Couplus·Supplier Hub·1688·공유 Chrome·계정·기존 상품에는 접근하지 않았다. 앱 코드는 root/담당 worker가 수정하며 이 검토자의 소유 범위는 이 문서다.

## 확정된 작은 차이: 선택한 사이즈표 한 장의 Single 준비

Couplus는 저장한 단일 사이즈표 URL을 `coupangDoc.jsonDocument[n].imagePage.images.sizeChartImage`에 직접 넣는다. 자체는 같은 exact wire를 images 항목으로 편집·resolve·projection할 수 있고 Excel 파일 첨부 계획도 지원하지만, **Single 자산 준비의 역할 판정에 사이즈표가 없었다.** 따라서 사이즈표 한 장을 선택해도 `SINGLE_IMAGE_ENCODING_UNVERIFIED`로 전체 Single 준비가 차단된다. 단순 live 미검증을 기능 결함으로 부른 것이 아니라 자체 함수로 재현한 연결 누락이다.

수정 전 `app/supplier-hub-single-assets.ts`는 Role을 main/additional/detail/label만 허용하고 `role(wire)`에서도 sizeChartImage를 처리하지 않았다. `projectSupplierHubSingleDocument`는 해당 값을 `unresolvedImages`에 정상 수집한다. 이후 `singleAssetSelection`이 이를 알 수 없는 encoding으로 분류하고, `buildSingleAssetPlan`은 canPrepare=false를 반환하며 사이즈표가 manifest와 payload에 들어가지 않는다. 조사 시 소스 SHA-256은 `b78c0372aa144c1bbd8cc912adfc27ac59adc974e4525140cfb49f73958f454d`다.

독립 합성 재현은 `outputs/step694-size-chart-gap-probe.mjs`와 JSON에 보관했다. 자체 projection→실제 자산 plan 함수를 실행했고 양사 회사정보를 격리 입력했다. 각 사례에서 정확한 size wire, 소유한 PNG 한 장, 원래 row identity를 썼다. 두 사례 모두 unresolved reference1개→canPrepare=false→`SINGLE_IMAGE_ENCODING_UNVERIFIED`→manifest/payload 누락을 확인했다. 원래 projection은 바뀌지 않았다. 외부 요청·파일 publication·DB/상품 쓰기는0이다. 이는 두 회사의 실제 인증 양식이나 Hub 접수 재현이 아니다.

### 사이즈표 저장의 정적 근거

| 항목 | 위치·SHA-256 |
| --- | --- |
| UI artifact | `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`, `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc` |
| `saveManualSizeChart` | UTF-16 `[285279,286603)`, slice `94fbd7139b9b9a5f143258b71b87befe587357c22686bb45e1fe98ec28b0d243` |
| selected wrapper | `outputs/step653-rea-image-selected/901f-saveManualSizeChart.js`, `5ebeb1d342c6bfc27cae858f380a317746cac60b4fb3fcdff95cfbc606842ac1` |
| main artifact | `outputs/step652-current-couplus/main.a20c7114.js`, `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad` |
| `uploadSizeChartImage` | UTF-16 `[447211,447405)`, slice `d3ebb94de5e6d6b34d78c9733aa60a78a53a56efdfe354010775dc7a4a4fa84f` |
| upload wrapper | `outputs/step653-rea-image-selected/c715-uploadSizeChartImage.js`, `28a854dd6a253284d6785d292630de205af28af543364141d1695d91a62818c2` |
| image-analysis parent | `ev_02780e2b058e642fc180a67b70caa803cccdc81f6dae0421b92e62c6c911e3a4` |

`saveManualSizeChart`는 이미 있는 `selectedProduct.sizeChartImage`를 재사용한다. 없으면 chart raster 생성→uploadSizeChartImage 결과의 `imageUrl`을 하나 받는다. 그 URL을 상품 상태와 각 옵션에 대응하는 기존 문서의 exact sizeChartImage 속성에 직접 저장한다. uploader의 기본 파일명은 `size_chart_${registrationId}_${Date.now()}.png`이며 `uploadImageToS3(data,name,'sizeChart')`를 호출한다. 로컬 artifact에서는 단일 URL이며 comma/newline 다중 URL로 변환하는 동작은 이 경로에서 관찰하지 못했다. 실제 S3 바이트·외부 접근·Hub 수용은 실행하지 않았다.

권고 범위는 exact bare `imagePage.images.sizeChartImage`를 **단일 이미지 역할**로 연결하는 것이다. 한 장은 기존 소유 key→실제 파일→SHA/MIME→기존 immutable 공개 URL 검증을 재사용해 URL 한 개를 넣을 수 있다. 저장된 원본을 새로 rasterize하거나 vendor의 시간 기반 파일명을 자체 파일 identity로 복사할 필요는 없다. 이미지 pool·수동 공란·제외 옵션·소유권·회사·카테고리·source revision·publication 검증은 유지한다. 자체 편집기는 최대5장을 허용하지만 그 사실만으로 Single의 다중 URL delimiter를 추정하지 않는다. 두 장 이상을 조용히 첫 장으로 줄이지 말고 정확한 저장 encoding 미확인으로 명시적으로 차단해야 한다. Excel 준비의 기존 다중 첨부 지원도 바꾸지 않는다.

## 실제 전송 payload와 단순 편집 변환기를 구분

REA retained 단계 parent는 `ev_d49bd95d5e4610573ee111bbc753a6055e2f0913515c0f96f146f2ff50050a6b`이며 source manifest는 `outputs/step652-current-stages-selected-manifest.json`이다.

`convertDocToQuotationData`는 UTF-16 `[246257,248856)`, slice SHA-256 `9ddf9daa357194e2fa53338f790d8a9dc7dbebc58c76cd06fefe2735cba14810`다. start/product/legal/logistics의 값을 평탄한 quotation object로 옮긴다. 비노출 속성의 null/빈 문자열/해당사항없음을 null로 만들고 certificate/notice 이름을 name/value 쌍으로 바꾸며 MSRP/OSRP는 schema 허용 여부에 따라 포함한다. 이미지 문서 전체를 전송하는 변환기가 아니다. 이 보관 chunk에서는 해당 이름의 literal 호출을 definition 외에 찾지 못했다. 따라서 이 메서드만으로 최종 전송 본문에서 모든 비노출 텍스트를 강제로 null로 바꿔야 한다고 결론내리지 않았다.

현재 페이지의 `regRocketApi`는 UPDATE_ROCKET_REG_DOC을 보내고 로컬 registered/verified를 즉시 갱신하는 별도 경로다. 보관된 설치 확장은 이 UPDATE literal receiver가 없고 VERIFY_ROCKET_REG_DOC을 수신한다. `processNextVerification`는 모델번호50자 정리·root productName 동기화·누락 모델번호 처리 뒤 **전체 coupangDoc**을 `body`로 보낸다. 별도 필드는 docId/suppliercode/delay/shouldRedirect/requestId다. 자체 counterpart는 다음과 같이 나뉜다.

| 단계 | 자체 counterpart | 대조 결과 |
| --- | --- | --- |
| 저장한 최종값→정확한 문서 | `app/supplier-hub-single-projection.ts` | 원문 schema wire·primitive·category/notice/scope/version을 유지한다. 이미지 key는 unresolved로 남겨 별도 준비한다. |
| 이미지 실제 bytes→문서 URL | `app/supplier-hub-single-assets.ts` | 기존 main/additional/detail/label을 처리한다. 이번에 sizeChart 단일 역할 누락을 재현했다. |
| 포함 옵션 선택→전송 packet | `app/supplier-hub-single-client.ts` | 한 문서에 정확히 선택 옵션1개, 해당 옵션 startPage 제목·categoryPath를 root에 묶고 owner/company/source/hash를 보존한다. |
| company·문서·단계 상태 | `extensions/supplier-hub/single-document.mjs` 및 `single-document-adapter.mjs` | 새 소유 문서와 앱/Hub 탭·창·본문 digest·회사·현재 source를 묶는다. 기존 문서를 자동 재사용하지 않는다. |
| 실제 접수 상태 | `extensions/supplier-hub/single-receipt.mjs`, `app/supplier-hub-single-receipt.ts` | 문서와 등록파일 ID·원문 상태를 확인하며 처리 완료와 SKU 확인을 분리한다. |
| Excel 별도 준비 | `app/exports/quotation-fields.ts`, `supplier-hub-upload-plan.ts` | 최종 저장값·mapping·실제 첨부 bytes를 사용한다. Single 단일 size 저장과 Excel 다중 첨부를 섞지 않는다. |

모델번호 자동 단축/채우기·동의 자동 선택은 원본 코드에서 보인다고 바로 자체 export가 저장값을 바꿔도 된다는 뜻은 아니다. 자체의 명시적인 모델 제안, 직접 공란 보존, 최신 저장본 지문 검증은 유지한다. 이번 사이즈표 변경으로 이를 확장하거나 원본처럼 로컬 상태를 즉시 완료로 표시하지 않는다.

## 설치 확장에 관찰된 회사 확인·동의·최종 완료 조건

보관 확장은10.92, background SHA-256 `fb03e8a70bc684e8b08539d8eb507720170eca8cf6fa4cb74af549f13179ec99`, script SHA-256 `0547785f8b746c75dc509dc96c4cfb9c290aff941499aaeb9c3b1af33ce9edc1`다. 현재 실행 중인 Chrome의 프로필/버전을 확인한 것은 아니다. retained protocol parent `ev_17ed0cebd00b285e0bc489221547e437d2b3f69d9b636a813eb942a0a2a3a49a`, provenance/ledger는 `outputs/step652-current-extension-provenance.json`과 `step652-current-extension-handoff-audit.json`이다.

receiver는 Supplier Hub 탭을 찾고 suppliercode를 회사 확인 helper에 넘긴다. 새 create 응답의 docId를 받아 body에 넣고 update한 뒤 validate-step2~5를 순차 요청한다. 문서 목록에서 그 docId의 index를 찾아 중간 저장 불러오기에서 선택한다. startPage의 상품명이 맞는지 확인한 뒤 Product/Image/Legal/Logistics 단계를 통과한다. 보관된 page helper는 agreeLabelContact가 아직 선택되지 않았으면 클릭하는 코드가 있다. 최종 submit 후 `.text-primary`의 정확한 ‘상품 등록 완료’ 문구로 success를 반환한다. 이 정적 흐름은 실제 native POST나 실제 수락 응답을 관찰한 기록이 아니다.

자체는 현재 동의 전문·challenge·실제 사용자 확인을 거쳐 상품/이미지 단계를 처리하고, 마지막 제출도 같은 소유 문서의 최신 challenge에 묶는다. company 코드는 유앤채 A01526306, 와이홉 A01464742의 일치한 이름과 함께 검증한다. 단순 공개 완료 문구·로컬 toast·배열 index·상품명만으로 등록을 판정하지 않는다. 이미 등록된 실상품이나 기존 작업 문서를 수정해 parity를 시험하지 않는다.

기존 접수 근거는 Step658 문서의 retained Hub bundle `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`과 Evidence `ev_7bccb57e05307a52efc7ae3b1f8a61f5f96ef3cd32e29faeaf569b4b78483157`, `ev_eec07247224a1bfd75967f307b1af673ddf3399ec2b5ad64c355a6073e0f1f48`, `ev_ad6079002eb8e54c2ffb2aec03b1f4cc27263deb155f0890f033a046182418a8`에 연결돼 있다. 자체는 exact 새 docId·company·상품명/category·qvtRequestId와 fresh 응답을 묶고 SUBMITTED/REJECTED/FINISHED를 분리한다. FINISHED도 SKU와의 join 증거가 없으므로 registered/success=false다. 현재 `SINGLE_DOCUMENT_LIVE_VERIFIED=false`와 `submissionReady=false` gate는 그대로 유지한다.

이번에 확인한 수정 권고는 단일 sizeChart 자산 연결 하나다. 나머지 범위에서 읽기만으로 완전한 동등성이나 새 결함을 선언하지 않았다. 실제 모든 카테고리·최종 native 제출 bytes·receipt·SKU 관계·외부 이미지 가용성·current extension 실행 상태는 미확인이다. 새 native/runtime session은 열지 않았다.

## 후속 구현의 좁은 독립 검토

root는 exact bare sizeChartImage wire를 `size` 역할로 추가하고 main/label과 같이 한 장만 허용했다. 기존 자산검증·서명 URL·파일 재사용·불변 저장 흐름을 그대로 사용한다. 검토 화면의 역할/열 제목에는 사이즈표를 추가했다. 이 검토자는 두 소스의 diff와 최종 파일을 읽고 자체 함수로 별도 합성 검토했다.

양사 각각에서 단일 URL 대입, 추가 이미지와 동일한 key의 파일/URL 재사용, 원가·동의값 보존, 직접 비운 size 값 유지, 다중선택 명시 거절, 중복/외부 소유 key 거절, named/다른 path의 가짜 size wire 거절, 공개 준비와 Hub 접수 상태 분리를 확인했다. 화면 role label과 release gate는 실행이 아닌 소스 점검이다. 검토 항목18개 모두 통과했고 미해결 actionable 지적은 없다. 실파일 publication·브라우저 렌더링·네트워크·운영 쓰기·실상품·Hub 제출은0이다.

기록은 ignored `outputs/step694-independent-review.json`과 자체 probe에 있다. 이18개는 release test 총계에 자동 가산하지 않는다. 동결 assets SHA-256은 `2d4d986da873a83cec28a3b49bc0e83d0bf905aa3f2a627d490e408a9a0521b7`, review UI SHA-256은 `a0613057c00feeedad3b0cf1499f0c2a3447e6b8f9a6934f75fb4c8af9efcc29`다. 사전 차단 재현 JSON과 사후 검토 JSON은 별도로 보관했다.
