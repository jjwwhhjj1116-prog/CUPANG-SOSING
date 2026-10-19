# Step744 — 선택 카테고리와 새 초안·견적 식별값 연결

기준 commit `4f9a6de1236818363842d285ee57925c411cbfe4`. 이 범위에서 **새로 확정할 구체적인 category-binding 결함은 찾지 못했다**. 원문 상품의 카테고리가 사용자 선택을 덮거나, URL 원문 복구의 새 초안이 다른 profile/schema로 조용히 연결되는 경로를 확인하지 못했다. 이것은 모든 카테고리·전체 서비스의 동등성 판정이 아니다.

새 REA producer나 vendor 실행 없이 기존 보관 source/Evidence를 재사용했다. 브라우저·네트워크·DB·운영 상품/대기열·자격정보 접근 및 runtime/test/extension 수정은0회다. 현재 QVT 목록 source는 SR 카테고리 양식의 근거로 쓰지 않았다. 거절된1688/Open1688 URL을 재시도하거나 우회하지 않았다.

## 현재 Couplus 계약

보관 route `outputs/step725-current-ui/chunk-36123f1a.155d5b9e.js` SHA-256는 `2fb15d370c331f65d982a886f2888b813ccae67277e87f806182c70032821664`다. 다음은 UTF-16 code unit, end-exclusive이며 slice hash는 UTF-8 기준이다. 정확한 raw slice는 `outputs/step744-category-review.json`에 보존했다.

| 메서드 | 현재 route 범위 | SHA-256 |
| --- | --- | --- |
| selectSearchedCategory | `[398368,399173)` | `6957f8752c920da2fcc363eba4a26f418c988d44138c244885405f66e62fcdd9` |
| completeSelection | `[401727,402725)` | `f944ac4095a984d58db7fbd2927176541aa999d6edb5e773450daa5de3aaeeef` |
| requestProductInfoFromExtension | `[411325,412349)` | `d68bf7c9e8a1ae5589f3f56415c76e539e13f4263529323cf5fd6d83164997df` |
| answerProductInfoFromServer | `[412350,413131)` | `7e72aae28a53852bd8bbbd31d2a8fcc1f749ab61bffde0e31f517fdf0e866b72` |
| createProductObject | `[437160,441740)` | `d359e61ea580bfcdead25cbecbbcb27390a41394bd3ee7b6238a04f74a4e3e53` |
| initializeCoupangDoc | `[445121,449150)` | `0b7c3e36d3c1048f75303995f3f4c8a5caa89ee1c5f9455a8d9201f0fff16eae` |

앞선 두 선택 메서드의 raw SHA는 Step717의 이전 보관 source와 같다. 재사용 선택 범위의 REA parent는 `ev_031002beee6d4de040b6b091d765d7ecae06affbb798dec64f5d4c46af65ad05`, summary는 `ev_15a0862a75ffb6573e290a629bf09c390d66ba5a688b767720cb08e638806395`다. 요청/원문 handoff의 기존 문서는 Step725이며 기존 response-branch parent `ev_cd515dbbeab22000b72ee021eb669326d3fa3695cede4a815ccd90c6966e239a`를 함수 밖 전체 source 증명으로 확대하지 않는다. 초기 문서의 기존 parent `ev_d49bd95d5e4610573ee111bbc753a6055e2f0913515c0f96f146f2ff50050a6b`도 새 분석으로 집계하지 않았다.

원문은 행의 선택 code/path를 원문 응답 후 양식 조회에 쓰고, 공급자 상품 본문의 category를 최종 Hub code로 채택하는 모습은 이 선택 범위에 없다. 서버 양식 응답 경로에서는 `displayCategoryCode`에 선택 code, `categoryId`에 `rocketRegInfo.kanCategoryId`, `productNoticeNumber`와 `version`에 같은 양식의 notice/version을 각각 넣는다. path는 선택 path와 표시 code로 만든다. 상품 객체와 coupangDoc에 같은 응답의 schema를 보관한다.

이는 표시 code와 내부 Kan ID가 서로 다를 수 있다는 구문 근거다. private backend가 실제 각 leaf↔Kan 대응을 어떻게 검증하는지, 현재 원격 응답의 category/notice/version이 무엇인지는 이 정적 source만으로 알 수 없다. 원문의 mutable newProduct/requestId 처리에 관한 기존 한계를 자체 구현에 복제할 근거도 아니다.

## 자체 연결 경계

- `CollectionResult`는 category/profile/schema 같은 top-level 필드를 허용하지 않는다. 공급자 attribute에 카테고리와 비슷한 이름이 있어도 `prepareCollectionProduct`가 사용하는 카테고리는 `job.context.category`다.
- new-draft preview client는 profile ID/revision/code/path뿐 아니라 **전체 target.category 객체**를 행 profile과 비교한다. created/recovered ACK도 context.category 전체를 확인한다. 같은 ID/revision이라도 nested Hub metadata가 달라지면 통과하지 않는다.
- 서버 new-draft 준비는 현재 owner profile/revision, 승인 company, source identity 및 원문을 검증한다. Single-only target은 `verifySingleTarget`에서 scope/Kan/notice/version과 schemaString의 raw metadata를 대조한다. fingerprint와 저장 CAS에는 profile raw payload·revision·settings·source 및 target이 포함된다. 이 서버 경계는 읽기만 했고 DB를 실행하지 않았다.
- `preservedCollectionRequests`는 전체 category 객체를 canonical 비교하여 이전 URL의 profile/schema 변화도 차이로 보고한다. queryless 견적은 captured category/schema를 사용한다. 사용자가 명시적으로 선택한 profile과 captured category가 다르면 export가 거절하는 기존 경계도 유지된다.
- Single projection은 선택 표시 code/path를 payload와 option startPage에 사용하고, raw metadata와 별도로 검증한 내부 Kan/notice/version을 native envelope에 보존한다. 카테고리 path 입력은 공급자 속성이나 수동 임의 path로 대체하지 않는다.

일반 `validateHubSchemaSnapshot` 자체는 모든 raw metadata를 단독으로 대조하는 함수가 아니다. 그러나 new-draft Single 검증, quotation-AI identity, 실제 Single projection에 해당 대조가 있으므로 이 차이를 새 전송 binding 결함으로 보고하지 않았다. 과거 schema의 빠진 metadata를 추정해 보완하거나 gate를 완화하지 않았다.

## 격리 확인

`outputs/step744-category-review.mjs`에서 자체 순수 app 모듈만 사용한5그룹이 통과했다. 요청 transport는 합성 Response stub이며 실제 API·collector·이미지·DB·Hub를 호출하지 않았다.

1. supplier top-level category/profile/schema5종은 거절됐다. 별도 상품 속성의 다른 category code/name은 selected category를 덮지 못했다.
2. 합성 표시 code `991744`, 내부 Kan `3001744`, notice17, version744를 구분해 native payload와 option startPage에 보존했다.
3. raw/snapshot의 Kan·notice·version 불일치3종과 선택 path 불일치가 projection에서 거절됐다.
4. new-draft preview와 created ACK에서 nested version/Kan/notice/display-code4종 변경이 각각 거절됐다.
5. 보존 요청 비교가 전체 category metadata의 변경을 보고했고 fixture profile/snapshot/receipt/job 객체도 불변이었다.

이 결과는 source-bound local assertion이지 새로운 실상품 원문 수집이나 실제 견적 접수 증명이 아니다. 실행 전후 읽은10개 source SHA가 동일했으며 전체 목록은 proof JSON에 있다. 주요 자체 source SHA:

| 파일 | SHA-256 |
| --- | --- |
| app/intake-new-draft.ts | `244a39bcc4f4f3888c2f96091718f95d7cc6146ffa007a1bf117eb3131f67df9` |
| app/collection-product.ts | `fd079d1b04831bfeaa4926c57cb23e9a8aee3f4e4d50928ff7e4ea771d83c990` |
| app/collection-result.ts | `62533fe60c25d2b8dcca82a2fbd6b3de67f057dbec857e29a37a1cda728f9d3e` |
| app/supplier-hub-single-projection.ts | `164220929accba8f0f9258efec120c39aada33a12e10dacc055683bb8900a168` |
| db/collection-forks.ts | `83f1cc9bd8c29c764532d449276b21a911bed38b027dae470dba7f8d395c5c8b` |

남은 다음 경계는 **실제 선택 leaf의 표시 code/path와 현재 SR 양식 응답의 내부 Kan/notice/version 대응**이다. 이는 원격 폼의 새 읽기 관측이 필요한 질문이며 retained QVT 목록이나 supplier 상품 category로 대신 확인하면 안 된다. root가 담당하는 읽기 전용 새 폼 관측과 분리한다. 모든 category의 실제 대응·현재 공급자·실제 제출/접수 및 native live gates는 이 조사로 확인하거나 변경하지 않았다.

추가 source identity 확인: root가 현재 비어 있는 SR startPage의 script 참조를 읽고 별도로 저장한 `outputs/step744-sr-main.js`는4,346,727bytes, SHA `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`로 이전 Step548 SR artifact와 정확히 같다. 이 파일의 size/SHA만 독립 확인했다. 이는 현재 SR 코드 버전의 보강 근거이며 선택 leaf·schema 응답을 새로 관측한 근거나 QVT 목록과 같은 앱이라는 뜻은 아니다. 별도 proof5그룹의 실행 대상에도 추가하지 않았다.
