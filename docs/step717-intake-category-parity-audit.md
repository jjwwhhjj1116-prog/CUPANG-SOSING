# Step717 — 상품추가 행의 카테고리와 양식 연결 시점

기준 HEAD는 `1ef3c7ccd5478da7b10f9c03142086dd46ddeae2`다. 보관된 Couplus UI chunk와 Step664·692·715를 먼저 읽고, 미답이던 카테고리 확정·행 생성 6개 메서드만 새 REA 분석에 넣었다. 앱·테스트·원본 설정·기존 상품을 수정하지 않았고 브라우저·네트워크·vendor bootstrap/backend도 실행하지 않았다. 아래는 정적 source 관찰이며 실제 수집·접수의 실행 기록이 아니다.

## 시점별 확인 결과

| 시점 | 확인한 동작 | 그때 고정됐다고 말할 수 없는 것 |
| --- | --- | --- |
| 분류 트리에서 중간/최종 노드를 누름 | `selectCategory`가 선택 path/depth를 바꾸고 하위 목록을 정리한다. | 이 메서드는 상품 행의 schema나 문서를 만들지 않는다. |
| 최종 선택 완료 또는 검색 결과 선택 | `completeSelection`·`selectSearchedCategory`가 code/path/pathString을 newProduct에 넣는다. queue 추가이면 같은 값과 빈 link/특징/키워드를 새 행에 복사한다. | 새 큐 행에는 rocketRegInfo/createResult/doc가 없다. 검색 결과의 internalCategoryCode라는 속성명만으로 Hub의 Kan code라고 단정하지 않는다. |
| 행에 URL 입력 | render의 `item.link` callback은 해당 행 link만 쓴다. | URL 입력이 카테고리를 재분류하거나 schema를 조회한다는 근거가 없다. |
| 그 행 처리 시작 | `processNextQueueItem`가 그 행의 link/keyword/feature/code/path/pathString을 공통 newProduct에 복사하고 원문 backend 응답을 기다린다. | 최초 카테고리 선택 시점의 immutable schema snapshot이 저장됐다는 뜻은 아니다. |
| 원문 응답을 받은 뒤 | 행 code의 `_cliRocketRegInfo` cache가 있으면 서버 양식 경로, 없으면 `GET_PRODUCT_INFO` 확장 경로를 선택한다. | cache의 버전·유효기간과 실제 private backend 검증은 미확인이다. |
| 양식 응답 수신 | 현재 extension request가 있어야 하며 createResult와 rocketRegInfo.schemaString을 요구한다. 이후 createProductObject에 원문과 응답 객체를 함께 넘긴다. | requestId가 없는 응답도 수용하는 약한 조건은 Step715에 이미 기록됐다. 자체에 복제할 권고가 아니다. |
| 상품 객체 저장 | createProductObject가 rocketRegInfo와 초기화한 coupangDoc를 넣어 saveItems에 전달한다. code/path·구매링크·특징·키워드는 당시 newProduct에서 읽는다. | 이 source만으로 저장 서버가 code/schema 충돌을 재검증하거나 거래적으로 고정한다고 말할 수 없다. |
| 실패 후 재시도 | 실패 행에는 오류·횟수·시각만 추가하고 code/path/link는 남긴다. 다음 시작에서 오류 표시를 지운 뒤 현재 행값으로 같은 처리를 다시 한다. | 최초 실패 때 사용한 schema를 다음 시도에도 그대로 유지한다는 보장은 없다. code cache 또는 새 응답을 다시 선택한다. |

트리 선택을 확정하는 것과 상품 문서의 schema를 저장하는 것은 다른 시점이다. 원본 사용자 경로는 **행의 선택 카테고리 → 해당 행의 URL 원문 → 같은 카테고리 양식 → 상품 객체·견적 문서**다. 카테고리 이름이 같다는 이유로 다른 code 또는 Kan/notice/version의 양식을 섞을 근거는 없다.

## 실패와 새 입력의 보존

`recordQueueFailure`는 `_error`, failCount, lastError, lastFailedAt와 별도 실패 목록을 갱신한다. `failCurrentQueueItem`은 현재 요청 ID·원문 pending과 queue busy 상태를 해제하고 다음 행을 예약한다. 둘 다 그 행의 카테고리나 URL을 지우지 않는다. createProductObject 실패도 같은 실패 기록으로 돌아간다. 성공한 행은 큐에서 제거되는 별도 경로다.

`startQueueProcessing`의 재시도는 행의 오류 표시만 비운다. link와 keyword가 있는 행을 다시 대상으로 삼고, 매 처리 시작마다 행의 카테고리 값을 newProduct로 복사한다. 이 메서드가 feature/keyword나 카테고리를 자동으로 새로 추정하지는 않는다. 사용자 지시의 URL-only 초안 흐름에 원본 keyword 필수 조건을 새로 강제하지 않는 기존 자체 선택은 유지한다.

원본 `duplicateQueueItem`은 행을 얕게 복사하고 queue ID·오류·실패 횟수 등을 바꾼다. 따라서 URL도 복사된다. 자체 복제에서 새 URL을 입력하게 하는 정책과 차이는 있지만, 기존 작업 상품 보존·중복 수집 정책을 이 조사만으로 뒤집을 이유는 없다.

## 원본의 고정 경계에 관한 한계

원문 backend를 기다린 뒤 requestProductInfoFromExtension은 그때의 newProduct 카테고리를 읽는다. 이어 createProductObject도 등록번호 발급 await 뒤 newProduct의 code/path/link를 읽어 응답 객체의 rocketRegInfo/createResult와 조합한다. 즉 검토한 source 안에 요청 시작 시점의 immutable category+URL 객체를 별도로 캡처해 모든 단계가 그것만 읽는 구조는 보이지 않는다.

이를 실제 원본의 사용자 race 취약점이라고 확정하지 않는다. 처리 중 원본 UI가 어떤 입력·모달 전환을 허용하는지, 프레임워크의 이벤트 순서와 private 저장 서버의 재검증을 이번에 실행하지 않았다. 공통 mutable 상태를 사용한다는 source 사실과 실제로 잘못된 문서가 저장된다는 주장은 다르다. `_queueBusy`·extensionRequestPending·requestId가 일부 직렬화를 제공하는 사실도 유지한다.

## 자체와의 비교 및 구현 권고

읽은 자체 `IntakeQueuePanel.edit`는 URL/특징/키워드 변경 시 그 행의 productId/forkJobId/pendingJobId 및 pending source 참조를 비운다. 카테고리 변경도 같은 연결을 비우며 다른 행은 유지한다. 처리 중과 owner/session이 오래된 callback은 거절한다. `intakeProductId`의 URL 기반 복구는 profile ID/revision/code/path와 특징/키워드까지 같은 저장 context만 고른다. 서버의 카테고리·기본설정 snapshot/CAS는 Step674의 별도 검증 범위다.

따라서 이번 읽기에서 이 지점의 **새로 확정된 자체 미구현 동작은 찾지 못했다.** 이미 있는 행별 code/profile snapshot과 URL 변경 시 이전 연결 해제를 버리고 원본의 공통 mutable newProduct를 따라 바꾸는 것은 권하지 않는다. 같은 행에서 분류 A→B 또는 URL A→B로 바꿨을 때, 다음 명시 시작이 새 입력의 profile·원문·schema만 사용하고 이전 상품은 그대로 보존하는 계약을 구현/회귀의 기준으로 삼는 것이 적절하다. 그 확인은 실제 자체 API·저장 자료와 별도로 해야 하며 이 원본 정적 분석이 새 실행 검사를 대신하지 않는다.

초안 실패 재시도도 기존 영속 원문·동일 job을 읽어 확인하는 것과 원본을 다시 가져오는 것을 구별해야 한다. 이전 schema/원문 응답을 다른 URL·카테고리의 새 행에 재사용하거나, 실패했다는 이유로 기존 작업 상품을 reset하는 근거는 이 원본에 없다. 전 카테고리 양식의 실제 버전 일치·private backend 공급자·새 1688 전체 SKU/사진·Hub 최종 접수는 여전히 미검증이다.

## 근거

원본은 `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`, SHA256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`다. 새 메서드와 연결에 재사용한 모든 source 범위·UTF-8 byte 범위·slice SHA 및 자체 읽기 시점 해시는 `outputs/step717-original-category-manifest.json`에 있다.

| 새로 선택한 메서드 | UTF-16 start-inclusive/end-exclusive | slice SHA256 |
| --- | --- | --- |
| showCategorySelectionModal | `[396823,397194)` | `8417349494b9091bc725f58a6bef9e18153f5e16e1a8f60723be024acd451598` |
| selectSearchedCategory | `[397784,398589)` | `6957f8752c920da2fcc363eba4a26f418c988d44138c244885405f66e62fcdd9` |
| selectCategory | `[400689,401142)` | `5a6b4d12dbe260def39bf2d46bf0d3addd5603bce0c0f205371502a15370dc00` |
| completeSelection | `[401143,402141)` | `f944ac4095a984d58db7fbd2927176541aa999d6edb5e773450daa5de3aaeeef` |
| addQueueItem | `[402316,402410)` | `062e71df8628f53adf7fb3d8f377f753a54f9b7691277f393024275d8d59870c` |
| duplicateQueueItem | `[402411,402670)` | `c3fbdcfd47e1d21981f628852d8a367fe0c90efd16b040867e43943fa9fe7dfc` |

새 parent `ev_031002beee6d4de040b6b091d765d7ecae06affbb798dec64f5d4c46af65ad05`, summary `ev_15a0862a75ffb6573e290a629bf09c390d66ba5a688b767720cb08e638806395`. 선택 1파일/3,295bytes/AST675/parse failure0이며 semantic unknown144가 남는다. 이는 선택 source 구문 분석의 범위이며 전체 프로그램의 행동 동등성이 아니다. 새 portable ledger는 `outputs/step717-original-evidence-bundle.json`, summary는 `outputs/step717-original-rea-summary.json`이다.

처리·실패 메서드는 Step664 parent `ev_e209eb6877550c205e52dbed56ee1b857dfdcdc78fb0a47b1f3c2e568287f8ae`, 응답 branch는 Step715 parent `ev_cd515dbbeab22000b72ee021eb669326d3fa3695cede4a815ccd90c6966e239a`를 재사용했다. 두 parent가 각 보관 portable bundle 안에 실제 존재함을 확인했다. Step692의 옵션 이미지 대표 선택은 별도이며 카테고리 고정의 근거로 확대하지 않았다. Step716의 설정 이미지 parent도 이 질문의 근거로 쓰지 않았다. 새 runtime/native session을 열지 않았으므로 정리할 세션은 없다. 이전 거절된 1688 도메인·URL을 다른 도구로 재접근하지 않았다.
