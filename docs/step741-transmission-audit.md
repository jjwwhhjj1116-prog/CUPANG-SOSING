# Step741 — 전체 상품 문서의 native 제출 전 본문 경계

2026-10-19 KST. 시작 HEAD `464b72fdd4c74233ac726304ea0134358ce01d70`. 기존 Step723–729·735–736의 retained 분석을 재사용했다. 조사 범위는 **문서 metadata·저장 버전·포함 옵션 순서·동의 상태·이미지 JSON 자료형이 앱의 전체 상품 문서에서 native 요청 직전까지 보존되는지**다. 가격·이미지 후보 수집·최종 receipt 판정은 재조사하지 않았다. 이 범위에서 새로 확정한 actionable 계약 결함은 없다. 앱·테스트·확장·운영 자료를 수정하지 않았다.

## 원본 경계와 자체 대조

원본 current route `processNextVerification`은 상품의 전체 `coupangDoc`를 `VERIFY_ROCKET_REG_DOC.data.body`에 한 번 넣는다. 표시 카테고리 코드와 내부 categoryId·고시 번호·native schema version은 그 body에 이미 있는 값이다. 별도 원문을 조회해 metadata를 다시 만드는 호출은 이 함수에 없다. 전송 직전 root 제목을 첫 `startPage.productName`으로 맞추고 모델번호 정리 helper를 거친다. 이를 사용자의 명시 수정값·공란을 조용히 바꾸라는 권고로 확대하지 않는다.

retained 설치 확장의 VERIFY receiver는 X에 전체 body를 전달해 create1회, 얻은 docId를 같은 body에 대입한 뒤 `JSON.stringify(body)`를 Q에 전달해 update1회를 한다. Y의 step2–5 요청은 `{docId, version:body.version}`이다. object key의 원래 열거 순서까지 서버가 계약으로 사용한다는 근거는 없다. `jsonDocument` 배열의 위치와 JSON 값의 자료형은 별도다.

| 확인 경계 | 현재 자체의 확인 내용 |
| --- | --- |
| 앱 전체 상품 구성기 | `singlePackageCurrent`가 product/content/option/quotation clock·profile·inputFingerprint·포함 옵션 순서를 현재 view와 연결한다. 전체 payload와 metadata를 복사하고 first document 제목을 root와 확인한다. |
| packet → receiver | 전체 `members[{optionId,optionLabel,documentIndex}]`와 원본문/prepared 본문 SHA·schema SHA·source5개 clock/revision이 identity에 연결된다. profileId는 별도 정확한 nullable 값이고 queryless requestedProfileId를 추정해 채우지 않는다. |
| 본문 정규화 | JSON canonical 처리는 object key를 정렬하지만 `jsonDocument`나 하위 배열 순서는 유지한다. 문자열 숫자와 number,0,false,null,공란·labelImages 배열·comma형 additionalImage 문자열을 다른 자료형으로 바꾸지 않는다. |
| 동의 | 저장 원본은 별도 SHA와 함께 그대로 남긴다. native prepared body에서 각 문서의 알려진 imagePage `msrpAgree`·`labelContactAgreed`만 false로 보류한다. 같은 이름의 다른 page 값과 다른 필드는 변경하지 않는다. 이후 현재 단계의 약관/challenge·명시 동의로만 진행하는 것은 기존 보호 계약이다. |
| create/update/validate | 공유 receiver는 full prepared body로 create1회 후 docId만 교체해 update한다. validate2–5는 저장한 version의 자료형까지 유지한다. adapter page는 `JSON.stringify(input.body)`를 쓰고 native create/update 전 정확한 preparedBodySha를 다시 확인한다. |
| 현재 저장본/새 문서 읽기 | adapter의 app source GET은 source5개 revision과 full body·members 순서를 다시 확인한다. receiver는 요청마다 source guard를 반복한다. get-by-id는 소유 새 docId의 metadata/body만 읽고 exact 본문을 비교하며 동의 후 알려진 Boolean 차이만 별도 다룬다. 서버의 실제 정규화·응답 shape를 이번에 관측한 것은 아니다. |

원본이 저장 동의를 자동 true로 만들고 UI의 동의란을 누르는 동작과 자체의 현재 동의 확인은 Step723/735에 이미 구분돼 있다. 이를 새 동의 누락으로 다시 제출하지 않는다. 원본 callback의 약한 success/registered 처리나 update ACK 수용 범위가 넓다는 사실도 actual native response 표본 없이 자체 계약을 느슨하게 바꿀 근거가 아니다.

## 로컬 순수 확인

`outputs/step741-transmission-review.mjs`는 합성2옵션 B→A와 원본문에만 존재하는 메모·nested 값들을 이용해 **자체 app compiler → packet validator → receiver identity**를 실행했다. 이어 자체 request-page 함수를 격리 VM의 합성 location/document와 local fetch stub에서만 호출했다. 브라우저·Chrome API·실제 Hub·vendor 함수는 실행하지 않았다. URL 형태의 문자열은 합성 응답 key일 뿐 외부 요청0이다.

6개 검사 그룹이 통과했다. 내부 categoryId number3000·display code string991234·native version string188·고시 번호25·remark 개행, source clock/revision, B→A 순서, 공란/false/0/null, 이미지 문자열/배열이 보존됐다. 원본 flag와 보류 flag의 분리, create/update body의 docId만 변경,4개 validate의 정확한 `{docId:741,version:'188'}`, 이미지 자료형을 변경한 body가 fetch 전에 거절됨, source revision 변경 시 identity 변경과 두 live gate false를 확인했다. 합성 함수 호출6개는 실제 Hub 요청6건이라는 뜻이 아니다.

첫 probe는 합성 location에서 pathname을 빠뜨려 guard 단계에서 실패했다. 자체 fixture에 `/dashboard/KR`을 추가한 뒤 통과했고 초기 실패는 `outputs/step741-initial-fixture-failure.txt`에 남겼다. 앱 문제나 production 수정으로 계산하지 않는다. 읽은 자체11파일의 SHA가 전후 같고 검사 중 운영 자료·기존 상품 쓰기는0이다. parent가 별도로 수정 중인 다른 앱 파일은 이 담당의 변경이 아니다. release test 합계 기여0이며 기존 관련 회귀검사 전체를 재실행한 결과로 합산하지 않는다.

## source identity와 Evidence

current route `outputs/step725-current-ui/chunk-36123f1a.155d5b9e.js` SHA256은 `2fb15d370c331f65d982a886f2888b813ccae67277e87f806182c70032821664`, Hub shipped main `outputs/step548-hub-main.js`는 `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`다. 둘 다 다시 확인했다.

| 원본 함수 | UTF-16 start-inclusive/end-exclusive | slice SHA256 |
| --- | --- | --- |
| verifyProducts | `[484044,487207)` | `86ac55ce97c54186de9ea8797be927df2afbcc1c1c17539c7fefd2fd6ca0da82` |
| processNextVerification | `[488342,492647)` | `e9a6114a4e9f82db46ff8b700d9fed5e915a310effe6fd8864729d5e5edcd706` |
| 설치 background VERIFY receiver | `[93438,97027)` | `3f9059b5303efe95e3518d3e0e320817cb9552ac09e6613af6c625ec0a21850c` |

설치 background SHA `fb03e8a70bc684e8b08539d8eb507720170eca8cf6fa4cb74af549f13179ec99`와 X/Q/Y exact 범위·slice/wrapper hash는 기존 `outputs/step652-current-extension-provenance.json`을 재사용했고 selected wrapper hash도 재확인했다. receiver parent `ev_17ed0cebd00b285e0bc489221547e437d2b3f69d9b636a813eb942a0a2a3a49a`, summary `ev_05abd95724353b22c4ca14685b3e8dbe88bc4f0cee756eea76a4dd6873b7f42c`의 기존 선택7파일/9,392bytes·semantic unknown375 범위를 유지한다. 새 REA producer나 retained session을 열지 않았다.

주요 자체 SHA: `single-document.mjs`=`52acd772fe1ff34b5f5fb7e4716c18d280e3c8c5ee5e3a18f51449ab36e18552`, `single-document-adapter.mjs`=`44ad0b240fd3227b9d08cac4c69d9fbb8e1843572b80afc2f14d58e83bf871b7`. 나머지 source hash와 합성 요청 본문은 `outputs/step741-transmission-review.json`에 있다.

전송 전 자체 JSON 보존 확인은 현재 서버의 실제 수용 형식·약관 전문·native ACK·접수번호·SKU 생성의 증거가 아니다. 전 카테고리 동일성도 확정하지 않는다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`, `PRODUCT_DOCUMENT_LIVE_VERIFIED=false`를 유지했다. 이전1688/Open1688 사이트 거절을 재시도·우회하지 않았고 종료할 owned 세션은 없다.
