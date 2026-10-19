# Step735 — 원본 동의·접수 전환과 반려 사유 표시 차이

2026-10-19 KST. 사용자 대상은 Couplus 로켓배송 AI상품등록과 자체 YOOFAM PLUS의 전체 카테고리→1688 URL→1~7단계 초안→수동 검토→Supplier Hub 제출·접수다. 이번 담당은 기존 727·732·734 및 retained artifact만 읽었다. 기존 상품·설정·견적서·로그인 상태를 조회하거나 변경하지 않았다. vendor 코드 실행·브라우저·네트워크·새 REA producer·runtime 수정은 모두 0이다. 1688의 기존 사이트 안전 거절을 재시도하거나 우회하지 않았다.

## 새로 기록한 작은 차이

**접수 상태가 REJECTED일 때 원본이 보여주는 반려 오류 항목이 자체 화면으로 전달되지 않는다.** 원본 Hub의 `K4`는 선택한 접수 행의 `remark`를 JSON으로 파싱하고 `errors[]`의 `columnName`과 `message`를 표에 표시한다. 파싱 실패·빈 오류는 별도의 사유 없음 표시로 내려간다. 현재 `normalizeSingleReceipt`는 `remark`를 읽지 않고 상태·문서 ID·등록 파일 ID만 반환한다. 자체 Single 화면은 “반려 상세는 Supplier Hub에서 확인해주세요.”를 표시하며 전체 상품 화면도 상태와 식별값까지만 표시한다.

이는 **소스에서 확인한 소비·표시 경계 차이**다. 실제 서버가 현재 어떤 remark bytes를 반환하는지, 실제 사용자 상품에 반려가 발생했는지, 접수나 SKU가 성공했는지의 증거가 아니다. 다른 두 runtime 수정이 진행 중이므로 이 세 번째 차이는 다음 작업용 기록으로 남기며 이번 release 범위를 넓히지 않는다.

| 근거 | 정확한 위치·SHA-256 |
| --- | --- |
| 원본 Hub | `outputs/step548-hub-main.js`, SHA `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11` |
| 요청 목록 K4 | `[4153982,4159515)`, slice `1eb5d1ea62cd452e004a16b1528ee265b4473ceb65767b003161f55f471bad51` |
| remark/errors memo | `[4154614,4154848)`, slice `8ef54602d5f519b8828c0d468cc6d31d30ce139dc0b6d78c1da4864a0d6b5f04` |
| 현재 정규화 | `extensions/supplier-hub/single-receipt.mjs:65`, SHA `c7854c17497af045df6f39fba4d455f0c6b4f8729c1576016ade19e3d0e716b5` |
| 현재 Single 안내 | `app/components/supplier-hub-single-review.tsx:198`, SHA `167e1e734ded323a8915759cab9f8fbe727d664a47f901ce98fc3d35a474cec3` |
| 현재 전체 상품 표시 | `app/components/supplier-hub-product-transport.tsx:154`, 조사 시 SHA `97ad1d6c4e0dd2056b24ac3d61e5fc26df323622114bddc5626d2c8a7e7c35fe` |

범위는 0-based UTF-16, 끝 제외다. Hub 원본은 ASCII이므로 위 byte offset도 같다. 해당 전체 source와 기존 manifest의 7개 선택 slice 및 위 memo digest를 이 조사에서 다시 확인했다.

후속 구현은 이미 확인한 exact 새 docId·회사·본문·등록 파일 ID의 fresh GET 응답 중 **같은 REJECTED 행**의 부가 진단만 해석·표시하는 것으로 좁힐 수 있다. 지원할 수 있는 정적 후보는 JSON 문자열 안의 `errors` 배열과 문자열 `columnName/message`다. 실제 wire 타입·길이·null은 미관측이므로 bounded parser와 사유 미확인 fallback이 필요하다. 진단 파싱 실패 때문에 이미 확인한 반려 접수 자체를 없애거나, 이를 성공·SKU·재전송 허가로 바꾸면 안 된다. 원본의 delimiter 연결 기반 uniqBy나 넓은 catch를 그대로 복사할 필요도 없다. 현재 strict receipt/client/store schema에 임의 필드를 덧붙이지 말고, 도입한다면 명시적으로 검증하는 별도 진단 계약으로 연결해야 한다. 기존 상품을 열거나 자동 재제출하는 변경은 이 권고에 포함하지 않는다.

## 이미 구현된 동의와 성공 전환

원본 Hub `l2`의 상품정보 확인란은 `agreeMSRPTerm`이며 저장 flag는 `imagePage.msrpAgree`다. 자세히보기 또는 최초 checkbox 조작은 약관 modal을 열 수 있고, modal의 `onSubmit`은 true를 저장한다. `M4`의 이미지 확인란은 `agreeLabelContact`, flag는 `imagePage.labelContactAgreed`다. 해당 지역의 `config.label_contact_agree`가 Y일 때 표시하며 checkbox 또는 modal 동의가 true를 저장한다. 두 약관의 현재 전문·지역 설정은 이 shipped main의 message-key 호출만으로 확정하지 않는다.

현재 자체 `single-stage-page.mjs`는 두 단계의 현재 전문·확인란·문서별 challenge를 읽고 현재 사용자 동의 뒤에만 반영한다. `single-document-adapter.mjs`와 receiver는 새 소유 문서·회사·본문을 대조하고 이후 단계로 진행한다. 따라서 이 두 확인란이 새로 누락됐다고 보고하지 않는다. 보관 Couplus 확장 J helper가 `agreeLabelContact`를 자동 선택하는 부분은 현재 자체의 동의 UX를 자동 선택으로 바꿀 근거가 아니다.

원본 `W4`는 현재 form 저장 성공→현재 단계 validate-step 성공→최종 `validateDraft` 호출로 이어진다. `validateDraft`는 POST `/sr/qvt/api/validate-single-product`에 `{docId,version}`을 보내고 code 숫자200 및 data.success truthy이면 draft/form reset과 성공 이벤트를 만든다. 실패는 오류 표시와 failed 이벤트다. 완료 화면 `V4`는 문구를 표시하고 `startPage?showPending=true`로 가는 버튼을 제공한다. 이 컴포넌트에는 docId·qvtRequestId·SKU 확정 로직이 없다.

설치 Couplus 10.92 확장의 J helper는 최종 submit 뒤 정확한 “상품 등록 완료” 문구를 기다린다. 그 boolean을 페이지 callback이 상품/옵션 완료 상태로 확대하는 원본 경계는 Step724와 같다. 자체는 별도로 GET `/sr/draft/api/drafts/register-requested`의 exact docId 행과 qvtRequestId를 확인하고 SUBMITTED/REJECTED/FINISHED를 pending/rejected/accepted로 구분한다. 이 정규화와 false live gate는 유지한다. 완료 문구 자체를 접수번호나 SKU 증거로 바꾸는 차이를 권고하지 않는다.

| 원본 주요 선택 | UTF-16 `[start,end)` | slice SHA-256 |
| --- | --- | --- |
| MSRP l2 | `[4046952,4049205)` | `614133f989f0bba911d1fe433f3dbdebd167f522be19baad7a5ea96e8645dd2f` |
| 라벨 M4 | `[4090538,4093327)` | `183613bdfdb3bc30a21caacc1672f755991564e8fd85111515b2abd701ad8c57` |
| 진행 W4 | `[4134287,4143643)` | `87273b012125a3da11e5e77c5f67b1b672f24ffbcb7a4c1c3ed9e7abe1e89723` |
| 최종 validateDraft | `[2870643,2871458)` | `a3bd933948a780d71a717cd119f72996d5f1363c46f8d90bf88bf51ef9f278ea` |
| 완료 V4 | `[4143643,4144772)` | `c6ca95de109f9e5db1ff7cab92685f58691ce14294b89ea27169e1c42e812dbe` |
| 목록 getRequests | `[2868035,2868195)` | `1d207d3e500173812fa6b9eb0c07c0390256e02e74d08967c7f3892515ca0756` |

## Evidence 재사용과 한계

설치 확장 parent `ev_17ed0cebd00b285e0bc489221547e437d2b3f69d9b636a813eb942a0a2a3a49a`는 현재 MCP session에 없었다. producer를 반복하지 않고 설치 CLI의 `inspect-evidence-bundle` exact filter로 **`outputs/step723-original-transmission-evidence-bundle.json`의 36 records 중 parent 1건**을 확인했다. 번들 SHA는 `c9cef0dfa37994f34e587892984f64243b29ac331e1578feb77b51a411cda247`, parent subject directory SHA는 `f761082a81d5e1a0c0bd0c7ca9390d4a69b0d8753915e05ba452096dcdb7fac1`다. 기존 summary는 `ev_05abd95724353b22c4ca14685b3e8dbe88bc4f0cee756eea76a4dd6873b7f42c`다. 이 7파일/9,392bytes 선택 분석의 semantic unknown375개를 없앤 것으로 보지 않는다.

J/H/VERIFY 선택 wrapper의 source binding은 `outputs/step652-current-extension-provenance.json`을 재사용했다. 설치 `background.js` SHA는 `fb03e8a70bc684e8b08539d8eb507720170eca8cf6fa4cb74af549f13179ec99`다. J 원문 범위 `[16517,18533)`, raw slice SHA `97ba21b09917da4b2c42a7a279c8148bd43dc763e57a6ac3421a37a5ef693227`; wrapper는 `outputs/step652-current-extension-selected/document-helper-J.js`다. 현재 실행 중인 확장 버전이나 프로필을 관측한 것은 아니다.

Hub 근거는 기존 focused parent **`ev_7bccb57e05307a52efc7ae3b1f8a61f5f96ef3cd32e29faeaf569b4b78483157`**, summary **`ev_786c61028e9543ec0f0a5ae873667c78adf08a28629811cca462f14164110e87`**다. 역사 요약은 `outputs/step654-hub-rea-summary.json`, 원문 범위 manifest는 `outputs/step654-hub-focused-manifest.json` 및 `step654-hub-support-manifest.json`에 있다. 해당 Hub full record는 선택한 Step723 portable bundle에 없었으므로, 새 retained import나 full-record 검사를 했다고 주장하지 않는다. 기존 요약의 20/20 parse·semantic unknown2,536과 원문 slice 직접 확인을 구분한다. HTTP/router/완료 UI 보조 parent `ev_eec07247224a1bfd75967f307b1af673ddf3399ec2b5ad64c355a6073e0f1f48`도 기존 기록으로만 재사용했다.

현재 Couplus main `outputs/step725-current-ui/main.a878a60f.js` SHA `36a8e3252cba8096da3e9b06eaf3c338699dce35280a0080484a5c7181d20fb7`, route `chunk-36123f1a.155d5b9e.js` SHA `2fb15d370c331f65d982a886f2888b813ccae67277e87f806182c70032821664`의 동일성도 확인했다. Step727의 선택 VERIFY/queue 분석을 다시 producer로 분석하지 않았다.

재현 기록은 `outputs/step735-original-submit-readback-audit.mjs`와 `outputs/step735-original-submit-readback-proof.json`이다. 원본을 import/execute하지 않고 파일 SHA와 raw 범위·기존 Evidence metadata·자체 소스 경계를 검증한다. 최초 실행의 보조 gate 파일명이 틀려 ENOENT였고 `product-document-dispatch.mjs`로 바로잡은 뒤 완료했다. 앱 테스트 수로 집계하지 않는다.

실제 final POST bytes/ACK, 현재 약관 전문·지역 설정, 새 docId→qvtRequestId의 실접수, 전체 옵션·SKU join은 그대로 미관측이다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`와 `PRODUCT_DOCUMENT_LIVE_VERIFIED=false`를 유지했다. 새 native/runtime/browser session을 열지 않아 종료할 소유 세션은 없다.
