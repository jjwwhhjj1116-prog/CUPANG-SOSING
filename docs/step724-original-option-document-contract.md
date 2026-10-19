# Step724 — 옵션 항목과 실제 native 문서 생성 단위

2026-10-19 KST. 보관 Couplus UI/설치 확장만 정적으로 읽었다. 새 원본 수집·vendor 실행·브라우저·네트워크·운영 상품/설정 변경은 0이다. 기존 REA parent와 source-bound 추출을 재사용했으며 producer를 반복 실행하지 않았다.

## 결론과 Step723 해석의 범위

**보관 VERIFY 경로는 ‘선택한 Couplus 상품 또는 분할 상품 한 건 → 전체 jsonDocument 배열 한 번 전달 → native create 한 번 → 새 docId 한 개’ 구조다. 옵션마다 create를 반복하는 경로가 아니다.** 따라서 Step723의 ‘한 상품의 여러 옵션 문서를 한 body로 보낸다’는 관찰은 맞다.

다만 이를 ‘원래 1688의 모든 옵션이 언제나 한 Hub docId에 최종 SKU로 등록된다’고 확장하면 안 된다. 작업개시 중 선행 분할이 원래 상품을 여러 옵션 그룹의 별도 Couplus 상품으로 만들 수 있다. 또한 실제 Hub가 배열 각 항목에 최종 SKU를 할당·수용하는 응답은 이 보관 클라이언트에서 관측하지 않았다. 확인된 것은 **그룹 내 옵션별 초안 배열과 한 문서 요청**이며, 실제 Hub SKU 생성·접수 성공은 별도 미확인이다.

## 선택 단위와 반복 범위

`CDataTable`은 `items:t.products`, `itemKey:'registrationId'`를 사용하고 model을 `t.selectedItems`에 연결한다. data의 selectedItems는 일반 빈 배열이며 옵션을 펼치는 computed가 아니다. store watcher도 선택 항목을 `registrationId`로 갱신한다. CLI 제출 역시 대상 상품 배열을 그대로 selectedItems에 넣고 verifyProducts를 호출한다.

`verifyProducts`는 선택 **상품**을 순회한다. 상품별 단계 완료와 공통 coupangDoc/jsonDocument 존재를 확인하고, 옵션이 있으면 `jsonDocument.length < options.length`를 거절한다. 정상 상품당 `verificationQueue.push({product:t,index:t.registrationId})` 한 번이다. 옵션별 entry를 push하는 loop는 없다. ‘총 N개 옵션’이라는 toast는 실제 queue 단위와 일치하지 않는 표시 문구이므로 구현 단위 근거로 쓰면 안 된다. 이 길이 검사는 최소 길이일 뿐 exact equality·전체 UUID 일대일 검증이 아니다.

`processNextVerification`은 `queue[0].product` 하나를 취해 새 request ID 하나를 만들고 pending map에 `{product,timestamp}`를 넣는다. 전체 jsonDocument를 순회하는 코드는 모델번호 정리용이다. 그 loop 안에서 message를 보내지 않으며 loop 종료 후 **전체 coupangDoc를 body로 한 번** postMessage한다. 응답 후 상품 queue를 하나 shift하고 재귀 호출해 다음 상품으로 이동한다. `processedOptionCount`라는 변수명 역시 이 사실을 옵션별 전송으로 바꾸지 않는다.

## 옵션 인덱스와 화면용 한 항목 wrapper

`processOptions`는 원문 SKU별 local option 객체를 만든다. `id`에는 원문 skuId, `optionNumber`에는 local 등록번호 기반 순번을 넣는다. 이 번호는 Hub의 최종 SKU 식별자가 아니다. `createProductObject`는 이 전체 옵션 배열을 initializeCoupangDoc에 넘긴다.

initializer는 같은 root metadata 아래 빈 jsonDocument를 만들고, 전달 옵션 배열을 같은 순서로 순회해 schema 기반 페이지 객체를 하나씩 push한다. 옵션에 기존 `option.coupangDoc.jsonDocument[0]`가 있으면 그 페이지를 복사·병합한다. 이 과정에는 native create 요청이 없다.

특히 견적 편집기의 `getCurrentCoupangDoc`는 선택 optionNumber의 `product.options` 인덱스를 찾아 다음 **화면용 객체**를 반환한다.

```js
{ ...product.coupangDoc, jsonDocument: [product.coupangDoc.jsonDocument[index]] }
```

원문 변수명은 minified이며 위 코드는 이름만 풀어 쓴 설명이다. spread로 root docId가 그대로 보존된다. 선택 옵션의 견적이 항상 jsonDocument[0]로 보인다는 사실은 옵션마다 독립 native docId가 있다는 증거가 아니다. 공통 문서가 없을 때만 selectedOption.coupangDoc를 fallback으로 읽는다.

저장도 `getCurrentOptionIndex`로 같은 순번을 찾고 `coupangDoc.jsonDocument.<index>.<field>` 경로를 pending에 넣는다. 이 선택·편집 경계에서 옵션별 native create나 새 docId를 만들지 않는다. 자체 재구현은 local UUID 기반의 현재 옵션 identity를 보존해야 하며, 원본의 실패 시 index0 fallback이나 최소 배열 길이만 검사하는 느슨함을 복사할 필요는 없다.

## native request/response와 docId 영속 범위

설치 10.92 receiver의 한 VERIFY 요청 내부에는 다음만 있다.

| 요청 | 본문/횟수 | 식별 범위 |
| --- | --- | --- |
| create | 전체 e.body JSON, 한 번 | 응답의 truthy docId 한 개 |
| update | 같은 전체 body에 새 docId를 넣어 한 번 | root body.docId |
| validate-step | 2~5 loop, `{docId,version}` | 위의 같은 docId를 반복 사용 |
| drafts GET 및 화면 이동 | 같은 docId의 목록 행을 찾아 한 번 선택 | 상품 root productName 확인 |
| 최종 UI 제출 | 페이지 진행 및 submit | ‘상품 등록 완료’ 문구를 success로 반환 |

이 receiver에는 jsonDocument 배열의 옵션을 순회하며 native create/update를 반복하는 코드가 없다. validate 응답의 `data[0].success`·오류를 읽지만, 이것이 옵션0의 SKU 응답이라는 뜻은 확인되지 않았다. 옵션별 응답·최종 SKU 배열·옵션번호 join을 처리하는 구문도 해당 경로에 없다.

wrapped 성공 callback은 pending request의 **root 상품 coupangDoc.docId**에 응답 ID를 넣고 상품 및 전체 options의 완료 상태를 함께 기록한다. direct UPDATE callback은 root docId를 성공 판정보다 먼저 기록할 수 있다. 두 callback에서 옵션마다 별도 native docId를 저장·대조하는 분기는 확인되지 않는다. missing docId를 경고만 하거나 boolean success로 전 옵션을 완료 처리하는 원본 동작은 실제 접수·SKU 근거로 사용하지 않는다.

## 선행 분할의 의미

기존 Step680의 분할은 속성 그룹별 Couplus 상품을 만든다. 첫 그룹은 원래 상품을 수정하고 뒤 그룹은 새 local registrationId의 상품으로 저장한다. 각 그룹은 원래 `options` 인덱스로 해당 jsonDocument subset을 복제하므로 그룹에 옵션이 여러 개 남을 수 있다. 분할이 반드시 1옵션씩이라는 규칙은 아니다.

새 상품 helper는 root coupangDoc.docId를 그대로 복사하며 ‘docId 유지’ 로그까지 있다. 이것은 각 분할 상품의 새 native 문서가 이미 만들어졌다는 뜻이 아니다. VERIFY 단계에서 상품마다 fresh create를 한 번 실행하고 그 응답 ID로 body.docId를 바꾼다. 따라서 **전송 시 선택 상품 그룹마다 native docId 하나가 갈라지는 구조**와 **그 그룹 안에 여러 jsonDocument 항목이 존재하는 구조**는 동시에 성립한다.

## 재구현 판단

현재 자체 옵션 1개당 새 문서 1개 제한을 원본과 완전히 동일하다고 부를 수는 없다. 다음 구현은 ‘현재 카테고리·회사·저장 revision에 속한 포함 옵션 배열을 하나의 검토된 그룹 문서로 준비’하는 별도 계획으로 좁힐 수 있다. 그러나 source UUID·순서·exact schema·같은 회사·제외 옵션·저장 CAS·공개 이미지·수동 공란을 보존해야 한다. root 제목만 첫 옵션으로 바꾸고 문서 배열 길이만 늘리는 변경으로 완성을 주장하면 안 된다.

이번 정적 근거는 로컬 다중 옵션 준비·직렬화 계약을 설계하는 데 쓸 수 있다. 실제 native 수용·최종 약관·qvt 접수·각 옵션 SKU join을 관찰한 근거가 아니므로 `SINGLE_DOCUMENT_LIVE_VERIFIED=false`나 운영 제출 gate를 해제하지 않는다. 기존 작업 상품으로 이 실험을 수행하지 않는다.

## Evidence와 정확한 source 범위

기존 설치 확장 parent **`ev_17ed0cebd00b285e0bc489221547e437d2b3f69d9b636a813eb942a0a2a3a49a`**, Step723 summary **`ev_05abd95724353b22c4ca14685b3e8dbe88bc4f0cee756eea76a4dd6873b7f42c`**를 재사용했다. 이번 module page는 `ev_0b96e5cf8b5a4cb7eebc8c4e182f6f38b2f1028deae212bc3ee6a8640f4f26d4`이며 기존 graph의 21개 중 첫10개 identity만 표시한 page다. 이를 새 producer 분석이나 전체 module 내용 조사로 세지 않는다. 확장 선택 graph는 7파일/9,392 bytes이고 semantic unknown375개다.

분할 parent **`ev_9ba78b705b9c68a727604eaf0bebe7f726bbbe8fea6c6d38d50ac77d2b88e1ba`**도 기존 portable ledger를 import해 재사용했다. 선택 directory SHA는 `def2f227803a683ea0f048dfa61d9a6f0cca00589482bbaaeaefadf7d304ad97`이고 semantic unknown1,572개다. 설치 버전은 현재 실행 버전·프로필을 입증하지 않는다.

UI chunk SHA-256: `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc` (553,312 bytes). main SHA-256: `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad` (579,613 bytes). 아래는 UTF-16·끝 제외 범위다.

| 정확한 근거 | 원문 범위 | slice SHA-256 |
| --- | --- | --- |
| getCurrentCoupangDoc | chunk `[235015,235560)` | `ce5e2956cc6e9a45d7ccde0adec274158ac66149c36282b6f38676bd6a43fae7` |
| saveCurrentOptionField | chunk `[264106,264359)` | `a3b6659d80aa5ef5e154c0be7b4243e4cd99d90dc97e26d6e34f8795571c1e30` |
| getCurrentOptionIndex | chunk `[264539,264760)` | `47a3b597a6d02441fde90997a1255e8048bc48305b727f6fa2601a6c3ea2c527` |
| initializeCoupangDoc | chunk `[444537,448566)` | `0b7c3e36d3c1048f75303995f3f4c8a5caa89ee1c5f9455a8d9201f0fff16eae` |
| verifyProducts | chunk `[483455,486618)` | `86ac55ce97c54186de9ea8797be927df2afbcc1c1c17539c7fefd2fd6ca0da82` |
| processNextVerification | chunk `[487753,492058)` | `e9a6114a4e9f82db46ff8b700d9fed5e915a310effe6fd8864729d5e5edcd706` |
| updateOriginalProductForSplit | main `[72575,75935)` | `a772b3151589c419eba3e89c01936ac5abe67c3c7321322304932bc4c91864e5` |
| createNewProductForSplit | main `[75936,79290)` | `699757973527f48ed30c6ef2b09d9f765846a7bdb0cc71e1486d699025afb115` |

`outputs/step724-original-option-contract-manifest.json`에 table binding, source option 생성, 두 callback 및 위 method들의 source/slice hash를 보관했다. 추출기는 inert TypeScript AST와 source slice만 사용한다. 원본 메서드를 실행하지 않았으며 이전 REA parent가 새로 선택한 모든 UI 범위를 직접 분석했다고 주장하지 않는다. native/browser session을 열지 않아 종료할 owned session은 없다.
