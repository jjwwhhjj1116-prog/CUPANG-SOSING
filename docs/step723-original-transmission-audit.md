# Step723 — 원본 등록전송의 문서·동의·완료 판정 경계

2026-10-19 KST. 자체 기준 HEAD `32499cc`. 설치 REA 지침을 읽고 Step694/701/705의 원본 전송 분석을 재사용했다. 이번 질문은 카테고리·회사·옵션 문서가 확장에 전달되는 경계와 접수 성공 판정이다. 앱·테스트·helper·계정·기존 작업 상품은 변경하지 않았다. vendor 실행·브라우저·네트워크·운영 쓰기는 모두 0이다.

## 원본에서 확인되는 전송 자료

보관 Couplus `processNextVerification`은 **상품의 전체 `coupangDoc`**을 `VERIFY_ROCKET_REG_DOC`의 `data.body`로 전달한다. `data`에는 `docId`, `body`, `suppliercode`, `delay`, `shouldRedirect`가 있고 outer `id`와 `requestId`는 같은 새 검증 ID다. body의 root에는 `docId`, `productName`, `categoryPath`, 내부 `categoryId`, `displayCategoryCode`, `jsonDocument`, `scope`, `productNoticeNumber`, `version`, 선택적 `remark`가 관찰된다. `jsonDocument`는 여러 옵션의 start/product/image/legal/logistics/sourcing 페이지 배열이다.

원본 카테고리의 display code, 내부 category ID, notice 번호·version·scope는 다른 식별값이다. 전송 직전 별도 schema 조회로 이들을 다시 만드는 구문은 해당 메서드에 없다. 앞서 생성·저장한 문서가 전송된다. 제목은 첫 문서 `startPage.productName`에 맞추고, 50자를 초과한 모델번호를 자르며 누락 모델번호 helper를 호출한다. 이것을 자체가 사용자의 저장값을 조용히 바꿔도 된다는 근거로 사용하지 않는다.

`convertDocToQuotationData`라는 평탄화 helper를 최종 payload라고 부르면 안 된다. 선택한 VERIFY 경로는 전체 body를 사용한다. 별도 `regRocketApi`의 `UPDATE_ROCKET_REG_DOC` 경로와 설치 10.92의 VERIFY receiver도 구분해야 한다. 보관 설치 확장에는 UPDATE 요청 literal receiver가 없다.

## 회사 확인부터 최종 클릭까지

보관 설치 확장은 기존 Supplier Hub 탭을 찾고 요청 `suppliercode`를 회사 확인 helper에 전달한다. 관련 인증 helper는 symbolic dependency이므로 실제 계정 권한·현재 회사 선택을 실행 검증한 것은 아니다.

1. 새 `/sr/draft/api/create`에 전체 body를 JSON으로 POST하고 truthy `docId`를 요구한다.
2. 새 ID를 같은 body의 `docId`로 바꿔 `/sr/draft/api/update`에 POST한다. 선택 receiver는 object의 `errorCode` 또는 그 문자열이 있는 응답을 거절한다. 실제 success 응답 전체 shape는 미관측이다.
3. `{docId,version}`으로 validate-step 2~5를 순차 요청해 `code==200`, `data[0].success`, 필드 오류를 확인한다.
4. drafts 목록에서 같은 docId의 행 index를 찾아 중간 저장 불러오기 모달에서 선택한다. 상품명 입력이 root 제목과 같은지 기다린 뒤 Product/Image/Legal/Logistics 페이지를 차례로 통과한다.
5. `agreeLabelContact`가 존재하고 미선택이면 클릭하는 helper를 호출한다. 마지막 submit 후 `.text-primary`의 **정확한 ‘상품 등록 완료’ 문구**를 최대 120초 기다려 success를 반환한다.

초기화의 `imagePage.msrpAgree=true`, `labelContactAgreed=true`와 DOM 자동 선택은 원본의 정적 관찰이다. 실제 현재 약관 전문을 검토했다는 증거나 native 제출 수용 증거가 아니다. 자체는 이미 준비 문서의 누락된 두 제어 key를 false로 보완하고 현재 문서·단계·본문 지문에 묶인 동의 확인을 사용한다. 이번 조사로 이를 자동 true로 바꾸지 않는다.

## 새로 좁혀 확인한 callback 판정

원본의 wrapped 응답 분기는 `id || requestId`가 현재 `pendingVerifications`에 있으면 처리한다. success는 outer boolean 또는 nested `data.success===true`로 읽는다. 성공이면 상품과 **모든 옵션**의 verified/registered/status를 완료로 바꾸고 store update를 요청한다. docId가 없어도 경고만 하고 완료를 기록한다. direct UPDATE 응답 분기도 같은 완료 처리를 하며, requestId가 없으면 저장 docId 매칭을 시도한다. 매칭 실패 시 큐가 있으면 중단하는 분기와 큐가 없을 때 선택 상품/docId를 갱신하는 별도 fallback이 있다.

이 callback에는 qvtRequestId·등록파일 ID·최종 SKU를 함께 조회해 일치시키는 검사가 없다. 따라서 원본 UI의 ‘등록 완료’ 표시나 extension success만으로 **새 YOOFAM 상품의 실제 접수/최종 등록 완료**를 증명할 수 없다. 원본의 느슨한 fallback·자동 재수정·재전송을 자체에 복사해 기존 작업 상품을 바꾸는 권고는 하지 않는다.

## 자체 구현과의 남은 차이

현재 `singlePackagePacket`은 포함 옵션 **1개당 새 문서 1개**로 제한한다. 원본은 상품의 여러 `jsonDocument`를 한 body로 보낸다. 이 차이는 Step694에도 기재된 기존 제한이며, 이번에 새로 발견한 결함이나 다중 옵션 전송 검증 완료로 표현하지 않는다. 다중 옵션 동일구현을 위해서는 현재 native 계약에서 여러 문서의 옵션 identity·업로드 파일·최종 접수 연결을 별도로 실증해야 한다.

자체는 owner/company/profile/schema/category/source/저장본 지문과 새 문서를 연결하고, 접수 원문 SUBMITTED/REJECTED/FINISHED를 각각 pending/rejected/accepted로 구분한다. FINISHED도 실제 SKU join 없이는 registered/success를 true로 만들지 않는다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`와 제출 gate를 바꾸는 새 근거는 없다. 기존 null·동의 key·단일 사이즈표 연결 누락은 앞선 단계에서 이미 수정되어 이 조사에서 재구현하지 않았다. 추가로 확정한 actionable 앱 결함은 0이다.

## 재현 identity와 REA

UI 원문은 `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`, SHA-256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`다. 아래 범위는 UTF-16·끝 제외이며 digest는 그 slice를 UTF-8로 저장한 값이다.

| 범위 | 위치 | SHA-256 |
| --- | --- | --- |
| wrapped 응답 if의 then 분기 | `[417234,422208)` | `47e2da7c8270cc57b6253c0c2e939d5f8f12a58d5765d3a741662b55a1411c43` |
| direct UPDATE 응답 분기 | `[422213,430823)` | `319a4fc8da3eb218f168537d6b4f7bb8a8981952ed4b4110fdb52976e97b3d15` |
| processNextVerification | `[487753,492058)` | `e9a6114a4e9f82db46ff8b700d9fed5e915a310effe6fd8864729d5e5edcd706` |
| initializeCoupangDoc | `[444537,448566)` | `0b7c3e36d3c1048f75303995f3f4c8a5caa89ee1c5f9455a8d9201f0fff16eae` |

추출기·원문/선택 hash는 `outputs/step723-original-transmission-extract.mjs`와 manifest에 있다. 기존 Step652 stage manifest의 `sliceSha256`은 일부 항목에서 실제 selected wrapper 전체 hash였으므로, 이번 manifest는 `sourceSliceSha256`와 `wrapperSha256`를 분리한다. 원문 SHA 자체는 동일하다. callback은 inert TypeScript AST로만 읽었으며 vendor 코드를 실행하지 않았다.

설치 확장 background SHA `fb03e8a70bc684e8b08539d8eb507720170eca8cf6fa4cb74af549f13179ec99`, script SHA `0547785f8b746c75dc509dc96c4cfb9c290aff941499aaeb9c3b1af33ce9edc1`다. 기존 exact receiver/helper 원문 범위와 digest는 `outputs/step652-current-extension-provenance.json`에 보존되어 있다.

REA parent **`ev_17ed0cebd00b285e0bc489221547e437d2b3f69d9b636a813eb942a0a2a3a49a`**를 기존 raw record에서 내용 변경 없이 portable bundle로 만들어 advertised `import_evidence_bundle`로 검증·재사용했다. 해당 원본 record 파일 SHA는 `4496eec3630e703e88abe47632b84d48befce796701222ec797282cc837a92fb`다. 새 summary view는 **`ev_05abd95724353b22c4ca14685b3e8dbe88bc4f0cee756eea76a4dd6873b7f42c`**다. 선택 directory SHA는 `f761082a81d5e1a0c0bd0c7ca9390d4a69b0d8753915e05ba452096dcdb7fac1`, 7파일·9,392 bytes·AST1,903개·parse failure0이며 선택 application 범위 complete, semantic unknown375개다. 원본 전체 확장 분석 완료나 runtime 실행을 뜻하지 않는다. callback 새 AST 범위를 기존 REA parent가 직접 분석했다고 주장하지 않는다.

첫 연결에는 해당 parent가 retained되지 않았고 Step721 portable ledger에도 없었다. 이를 이유로 producer를 다시 실행하지 않았다. raw record 전체를 shell output으로 전달하려던 1회는 524,288-character display cap으로 잘려 parse 실패했고 결과를 Evidence로 사용하지 않았다. 이후 로컬 record를 파일로 portable 포장해 정식 import했다. 두 초기 추출 검증 실패(비엄격 == 조건 및 wrapper/slice hash 의미 차이)도 앱 결함이나 새 분석 결과로 세지 않으며 최종 manifest가 정확한 source/range를 명시한다.

현재 설치·실행 중인 확장 버전, private backend 정규화, 현재 모든 카테고리 계약, 실제 native create/update/submit 응답, 실제 qvt 접수와 SKU join은 미확인이다. native/browser session은 열지 않아 종료할 owned session은 없다. 이번 좁은 정적 감사로 실상품 신규 수집·접수나 전체 동일구현 완료를 주장하지 않는다.
