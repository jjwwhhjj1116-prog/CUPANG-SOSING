# Step720 — URL 초안·초기 작업·저장 상태의 구분

2026-10-18 KST, 자체 기준 `4922d12495ee5f969c02633c4a767b3bdfb8146b`. 보관된 Couplus shipped UI/main만 정적으로 읽었다. Step715 원문 응답, Step717 카테고리 연결, Step693 최초 문서, Step667 SEO 문서 연결, Step699 브랜드, Step716 초기 가격 근거를 먼저 재사용했다. 이번 새 REA producer는 아직 직접 확인하지 않은 **작업 상태의 Vuex → 저장 요청 action 두 개**만 다룬다. 원본 실행·브라우저·네트워크·운영 자료 읽기/쓰기와 기존 상품 변경은 모두 0이다.

## 정확한 최초 흐름

선택 카테고리는 상품 원문 수집을 대체하지 않는다. Step715의 일반 추가는 자체 backend `getProductInfo`에서 상품 응답을 받고, 별도 extension 응답에서 선택한 Hub 카테고리의 schema와 create skeleton을 받은 뒤 두 자료를 조합한다. 이 클라이언트로 private backend의 원문 공급자·공식 API·cache·queue·속도나 특정 서버 번역 방식을 식별할 수 없다. 원본 사이트를 읽지 못한 브라우저 조사 도구의 제약도 그 backend의 기능 부재를 입증하지 않는다.

`createProductObject`는 source의 제목·번역 제목·갤러리·SKU/원가/재고/속성, 선택 code/path, 구매링크, 특징/키워드, 당시 기본설정과 `rocketRegInfo`를 새 상품 객체에 넣는다. `initializeCoupangDoc(createResult, defaultSettings, rocketRegInfo, options)`로 옵션별 문서를 준비한 뒤 **`saveItems` 요청의 `res==='success'`를 먼저 확인**한다. 응답의 savedItems 첫 항목이 있으면 그것을, 없으면 준비한 local 객체를 다음 단계에 사용한다. success envelope를 검사한다는 사실과 서버가 어떤 bytes를 거래적으로 저장했는지는 다르다.

그다음 일반 생성은 `runInitialProcessing`을 호출하되 await하지 않는다. queueAutoMode는 await하고, skipInitialProcessing 모드에서는 호출하지 않는다. 일반 최초 작업은 **SEO → 가격 두 개뿐**이다. source의 사진 목록·schema 기본 문서가 준비됐다는 것과 이미지 번역·합성·한글표시사항 PNG·견적 검증 작업이 완료됐다는 것은 별개다. 원본 완료 안내도 “전체 작업으로 나머지 작업”을 진행하라는 의미다. 이를 모든 단계가 성공했거나 Hub 등록까지 끝났다는 안내로 복제해서는 안 된다.

## 단계별 최초 자료와 추가 작업

| 단계 | 최초 새 상품/문서에 준비되는 자료 | 최초 SEO+가격 호출만으로 완료됐다고 할 수 없는 것 |
| --- | --- | --- |
| SEO | source subject/subjectTrans, 타겟 키워드·특징·브랜드, option1/2 원문/번역명. source 갤러리 첫 사진은 목록의 최초 productImage다. | 새 모델 결과와 저장 성공은 별도 worker/service의 결과다. 설정의 복수 브랜드는 첫 구간을 사용하며, 수동 입력 전체를 전역 잘라내는 규칙은 아니다. |
| 가격 | SKU price/stock와 설정 기반 계산 가격이 옵션 생성 때 이미 들어간다. 저장 후 pricing worker를 다시 호출한다. | 최초 산식과 가격창의 명시적 재계산 산식은 기존 Step695/716 구분을 유지한다. 정적 가격 계산 코드가 실제 유효 공급가격이나 상품 포장 사실을 입증하지 않는다. |
| 대표이미지 | 상품 갤러리, 정상 SKU의 첫 속성 사진 → 둘째 속성 사진 → 갤러리 첫 사진, pending 상태와 processedImage:null. | 이미지 번역/제거/편집 완료·번역 PNG 영속 저장. 상품 목록의 source 사진과 사용자가 최종 적용한 대표사진은 다른 경계다. |
| 추가이미지 | 옵션의 additionalImageStatus.images에 source 갤러리를 보관하며 상태는 pending이다. | 최초 견적 additional wire가 그 갤러리 전체를 쓴다는 보장은 없다. 기존 image helper의 root.additionalImages 참조와 구분한다. source 후보 보관을 완료된 추가이미지 선택으로 승격하지 않는다. |
| 상세이미지 | description HTML에서 img URL 목록을 추출하고, 사용 설정이 켜진 상·하단 공통이미지를 앞/뒤에 중복 없이 넣는다. 초기 견적 HTML helper는 설정 배너로 기본 HTML을 만든다. | source 전체가 번역·재편집됐다는 것, 필요 없는 사진이 삭제됐다는 것, 조판 결과가 저장됐다는 것. source detail 후보 목록과 최종 HTML/합성 이미지가 다르다. |
| 사이즈표·한글표시사항 | root status는 pending이며, 생성 객체에는 새 chart 데이터나 새 라벨 PNG를 만드는 호출이 없다. schema required 여부가 사이즈표 단계 표시/처리에 사용된다. | 표시사항 번역·옵션별 텍스트 편집·라벨 PNG 생성/연결. 폼을 열 때의 기본 표시값과 저장한 이미지도 다르다. 사이즈표는 필요 없으면 이후 worker가 disabled로 처리한다. |
| 견적 | createResult의 doc metadata와 category schema로 기본 page/field 골격, 기본설정·선택지·고시·물류·이미지 구조를 만들고 옵션마다 clone한다. 저장된 옵션 문서가 입력에 있으면 지정 page 객체를 얕게 병합한다. | 전체 필수값 검증, 모든 옵션의 최종 실제 값, 동의 처리, Hub 등록전송과 실제 접수/SKU 확인. 최초 document가 있다는 것만으로 quotationStatus 완료가 아니다. |

일반 화면은 사이즈표 필요 여부에 따라 단계가 빠지므로 “1~7단계” 숫자만으로 데이터 종류를 고정하면 안 된다. 원본 내부에는 SEO·가격·대표·추가·상세·사이즈표·표시사항·견적, 총 8개 작업명이 있으며 사용 화면에서는 조건부 7단계가 된다.

최초 root는 `mainImageStatus`, `additionalImageStatus`, `detailImageStatus`, `koreanLabelStatus`, `pricingStatus`, `seoStatus`, `sizeChartStatus`, `quotationStatus`를 모두 pending으로 저장한다. 정상 SKU 옵션도 같은 작업별 pending을 가진다. 원본의 SKU 없음 fallback 옵션은 일부 marker 구성이 다르며 source가 없는 경우 default SKU를 만든다. 자체의 실제 SKU 검증·누락 source 보호를 이 fallback에 맞춰 약화할 이유는 없다.

## 새로 확인한 상태 저장 action

main `updateFeatureStatus`는 입력 상품을 JSON deep clone하고, `<feature>Status`가 객체면 `.status`, 아니면 scalar 값을 바꾼다. 현재 상품의 options 전체에도 같은 상태를 넣은 뒤 `updateProductFeature`를 dispatch한다. 이 action에는 옵션 포함/제외 선택 필터가 없다. 실패 catch는 로그 후 끝나므로 action의 Promise 완료만으로 서버 상태 기록을 보장하지 않는다.

`updateProductFeature`는 **로컬 `UPDATE_PRODUCT_FEATURE` commit 후** `/api/rocketReg/updateFeature`에 `{feature, product}`를 POST한다. `res!=='success'`이면 throw하지만, 서버 notFound 배열은 저장 경고를 기록하고 true를 반환할 수 있다. updatedProduct가 있어도 이 action에서는 확인 로그만 남긴다. 전체 Vuex mutation의 상세 merge와 private 서버가 보존하는 field·원자성·충돌 처리까지 이번 두 action으로 증명하지 않았다. 로컬 badge가 먼저 바뀔 수 있는 구문과 영속 성공·실제 접수의 증거를 구분해야 한다.

재사용한 `executeSingleTask`는 시작 시 processing, worker의 error 반환이나 일반 예외 시 error를 기록한다. 일반 오류는 잡아서 끝내며 SEO의 `GEMINI_API_ERROR:` 예외만 다시 throw한다. `runInitialProcessing`은 각 task의 반환값이나 최종 status를 검사하지 않고 진행률 100%·완료 안내로 갈 수 있다. 이는 실행 재현이 아니라 명시된 분기 조합에 따른 정적 추론이다. 모든 상황에서 거짓 완료가 나타난다고 주장하지 않는다.

일괄 `processProduct`는 별도 경로다. 기본 전체 작업은 completed/disabled를 건너뛰고 SEO/가격부터 처리하며, 이미지·표시사항·사이즈 작업을 병렬 분기로 실행하고 견적은 뒤로 미룬다. 명시 작업 지정과 retry의 의미가 다르므로 새 source 적용 때 이 전체 작업을 무조건 재실행해 기존 수동 수정·완료 이미지를 덮어쓰는 것은 원본 근거가 아니다.

## YOOFAM PLUS의 구체적인 구현·검수 기준

1. 같은 행의 회사·category code/path·원문 offer/SKU·수집 당시 설정을 연결하고, source가 실제 없으면 임의 제목/옵션/원가로 성공한 초안을 만들지 않는다. 원문 수집과 Hub 양식 취득을 구분한다.
2. 새 초안은 source 후보·가격·SEO·schema 기본값을 보관하되 source 후보를 번역/이미지 작업 완료로, local 작업 완료를 Hub 접수 완료로 표시하지 않는다. 실제 source·번역·편집·저장 결과별 단계 상태를 사용한다.
3. 초기 AI/번역 완료가 늦게 도착하거나 같은 URL을 다시 조회해도 수동 제목·옵션명·명시 공란·사진 선택을 조용히 덮어쓰지 않는다. 원본에는 전체 manual-edit race/CAS 보장이 보이지 않으므로 자체 source fingerprint·영속 원문·scope·manual provenance 보호를 유지한다.
4. 기본설정은 계정별 future intake의 입력이며 이미 저장한 상품 전체를 현재 기본값으로 재생성하는 권한이 아니다. 사용자가 수정·검토한 견적서의 source와 전송 body를 정확히 연결하고, 실제 접수/SKU proof가 없으면 등록 완료를 주장하지 않는다.

이 조사만으로 새로운 자체 앱 결함을 재현한 것은 아니다. 실제 앱의 URL→원문→초기 적용·수동값 보존은 별도 local API/SQLite/컴포넌트 회귀와 실상품 검수로 확인해야 한다. private provider·모델 품질·처리 속도·전체 category 및 현재 운영 Single contract는 미확인이다. marketing의 “92.2%·4분” 같은 문구도 현재 코드의 관측 성능·성공률 증거로 쓰지 않는다.

## 근거와 보관 범위

UI 원본은 `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`, SHA `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`다. main은 같은 폴더의 `main.a20c7114.js`, SHA `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`다. 다음 범위는 UTF-16·끝 제외, raw SHA는 UTF-8이며 byte 범위도 manifest에 있다.

| 경계 | 원본 범위 | raw slice SHA-256 |
| --- | --- | --- |
| createProductObject, 재사용 UI | `[436576,441156)` | `d359e61ea580bfcdead25cbecbbcb27390a41394bd3ee7b6238a04f74a4e3e53` |
| runInitialProcessing, 재사용 UI | `[441157,442908)` | `9e1ab8af2d5ad2bd10bccbf19bdf3230cf38109f76f52227fc82c8711a2ade15` |
| initializeCoupangDoc, 재사용 UI | `[444537,448566)` | `0b7c3e36d3c1048f75303995f3f4c8a5caa89ee1c5f9455a8d9201f0fff16eae` |
| processOptions, 재사용 UI | `[466662,469077)` | `4a5671380c795a5b6e598bc3abfcdf54cb66318a62119f43478964ee68b0e3f0` |
| executeSingleTask, 재사용 main | `[308020,310070)` | `4cb687b04e43b0c8529b726996f0e8bff904cc60f611541efdf33489f709a49e` |
| updateFeatureStatus, 새 main 선택 | `[266417,267715)` | `bc05c82a2b8ea934c7cc223dd0ce95ac3bde380c70f530c837420bc8a9f54fa7` |
| updateProductFeature, 새 main 선택 | `[267716,268724)` | `45bcb9efeea4660eb27ff07b3fdbbc882f4c5460f7ee2877fae175273de66f39` |

Step715 응답 parent `ev_cd515dbbeab22000b72ee021eb669326d3fa3695cede4a815ccd90c6966e239a`와 Step717 카테고리 parent `ev_031002beee6d4de040b6b091d765d7ecae06affbb798dec64f5d4c46af65ad05`는 실제 retained exact summary로 다시 찾았다. Step667 portable bundle 8 records를 검증 import해 `processProduct/isTaskCompleted` parent `ev_ac226470ee37b350778dd9cdc96642263193ceaa2d239b448d0761bb328ef9ed`의 선택 범위도 확인했다. 새 module page는 `ev_1e85769154caced3ff55719593d5eb05356c48f512da26ab7be110d0fc64d583`다. 이 parent에 executeSingleTask나 초기 UI 메서드 전체가 직접 들어 있다고 확대하지 않는다.

역사적 초기 문서 parent `ev_d49bd95d5e4610573ee111bbc753a6055e2f0913515c0f96f146f2ff50050a6b`와 intake parent `ev_1983224a44e1100a435aca7caaa76ebb6e1d9df782252092d57dcc695765e8ee`는 이번 연결에 retained record가 없다. 기존 문서·manifest·exact source slice를 재사용했으며 producer를 다시 돌리거나 새로 읽은 retained evidence라고 주장하지 않는다. 과거 Step693의 일부 helper “slice” SHA는 실제 선택 wrapper 파일 SHA였다. 이번 manifest는 예를 들어 createFieldStructure raw `860805d452804c93a8702431379298d81b0894609dce5d1403033d60923bd363`, applyDefaultSettings raw `09bbc96a570f0a975d3a1bef5ae6c41f337ac73758822f004c2b377ecee38584`로 구분하며, 원본 전체 digest나 내용이 변경된 것은 아니다.

새 parent는 `ev_4d3580bc08888e08a5c432ba8009d993800d8eb5935954ce2cb31c56502dab68`, summary는 `ev_b227470890e13c3ce4f09bc4d5bc539cb4d8291417b41fbd739dd8367885724d`다. 선택파일 `outputs/step720-original-selected/featureStatusPersistence.js` SHA `d58a7bd70ac39cd6e758753374f9892bf7f205ab2ba6b4a8bfdd54795f921647`, directory SHA `694ec710a3c9788091e3a0bebf861448d7243e6a103623e447fc93dab2f4a6c9`다. 2,700 bytes·파싱 1파일·AST 614·parse failure 0, 선택 application complete·semantic unknown 130이다. 외부 Vuex/this/HTTP backend 의미까지 완결한 결과가 아니다.

재현기와 manifest는 `outputs/step720-original-extract.mjs`, `outputs/step720-original-manifest.json`이다. portable bundle `outputs/step720-original-evidence-bundle.json`은 14,315,762 bytes·32 records·SHA `65c74fc47b1c7a78b03f99b5c5a038c95e2da318dc76f83b6f1a28be94dd6366`다. 이 조사에서 새 producer/summary는 2 records이고 재사용 projection 1개가 추가됐다. 나머지 기록을 새 분석으로 세지 않는다. 열린 native/browser/runtime session과 종료할 owned resource는 없다. 기존 작업 상품·전송 gate·동의 처리와 실제 접수 미검증 상태는 그대로 유지한다.
