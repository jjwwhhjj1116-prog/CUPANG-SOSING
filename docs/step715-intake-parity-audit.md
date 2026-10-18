# Step715 — URL 원문 응답·양식 응답·초안 인계의 경계

2026-10-18 KST. 기준 `81ba0a32fda5554873380f7b3a2f3ae6f86e8e70`. Step705/706의 상품 원문 contract·SKU/가격·이미지·속성 대조를 재구현 대상으로 반복하지 않았다. 이번 좁은 질문은 일반 URL 추가에서 어떤 응답을 기다리고 어떤 자료를 다음 단계에 넘기는지다. 기존 상품·브라우저·계정·1688·외부 네트워크에 접근하지 않았다.

## 원본에서 확인한 요청·응답 순서

1. 일반 URL 추가는 자체 backend `/api/aiPage/getProductInfo`에 `[{productId:<offer번호>}]`를 POST한다. 선택한 카테고리나 Hub 회사코드가 이 원문 요청 body에 들어가지는 않는다.
2. 이 호출의 반환 envelope에서 `data.result[0].result.result`를 상품 원문 객체로 읽는다. 해당 entry 메서드에는 status endpoint 조회나 polling timer가 없다. 서버 내부의 queue·cache·재시도 구현까지 동기라고 단정하지 않는다.
3. 받은 원문을 `pendingProductData`로 보관하고 `GET_PRODUCT_INFO` 확장 메시지를 보낸다. 이 별도 메시지가 키워드·원문/번역 제목·특징·회사코드·선택한 카테고리 코드/경로를 전달한다. Step705에서 확인한 확장의 역할은 Supplier Hub schema와 `docId:null` skeleton 조회다. 이 메시지를 1688 수집 요청이라고 부르면 안 된다.
4. `PRODUCT_INFO_RESPONSE` 분기는 현재 대기 requestId가 없으면 무시한다. 응답 ID가 truthy인데 다르면 과거 응답으로 무시한다. `createResult`나 `rocketRegInfo.schemaString`이 없으면 실패로 처리한다.
5. 정상 분기는 보관한 원문과 schema 응답을 local 값으로 옮긴 뒤 pending/requestId를 비우고 `createProductObject`를 시작한다. 새 상품은 원문 옵션·사진·속성·기본설정·문서를 구성해 `saveItems` 성공을 확인한 다음 초기 SEO·가격 처리를 시작한다.

정상 source query 응답 자체가 없는데 제목·가격·SKU를 상상해 초안을 만드는 분기는 이 경로에 없다. 반대로 브라우저 조사 도구가 원문 사이트를 읽지 못했다는 사실은 이 자체 서버 수집기가 불가능함을 뜻하지 않는다. private backend의 실제 provider·공식 API 사용·별도 공급자·cache hit·권한·속도는 현재 보관 클라이언트로 식별되지 않는다. CLI나 공개 metadata fallback을 그 backend와 같다고 주장할 근거도 없다.

원본의 ID 검사는 **truthy wrong ID 거절**이며 ID 부재 자체를 거절하는 분기는 아니다. 자체 owner/job/offer/원문 receipt 검증을 이 느슨함에 맞춰 약화하지 않는다. 일반 추가는 keyword truthiness를 요구하지만 manual SEO의 trim 검사와 같지 않다. 사용자 요청의 카테고리+URL 흐름을 새 필수 입력으로 바꾸기 위한 근거로 이번 복구 수정에 섞지 않는다.

## 현재 수정할 구체적인 자체 문제

자체 `/collect`는 immutable 원문을 저장한 뒤 응답한다. 저장 후 응답이 유실되거나 성공 body를 읽지 못하면 서버에 원문이 이미 있어도 `collectIntakeProduct`가 예외로 끝난다. 다음 POST는 기존 receipt를 돌려줄 수 있지만 현재 실행에서는 읽기 확인 없이 초안 진행을 중단한다. `/browser-capture` 수신도 원문 저장과 ACK 수신이 별개다.

안전한 후속은 **응답이 불확실한 원문 쓰기 한 번에 대해 같은 job의 `/result`를 GET 한 번만 조회**하는 것이다. 현재 job ID·offer ID·정규 원문·유효한 receivedAt가 모두 일치하는 저장 receipt가 실제 있을 때만 이어간다. GET은 새 수집·provider·브라우저 capture를 실행하지 않는다. 원문이 없거나 조회를 확인하지 못하면 기존 실패와 입력을 보존한다. ID가 잘못된 정상 응답을 다른 저장본으로 ‘고쳐서’ 성공시키지 않고, 401/403/404/409처럼 확정된 거절을 다른 경로로 치유하지 않는다. abort 뒤 늦은 응답은 현재 화면에 publish하지 않는다.

이는 원본의 숨은 복구 기능을 관측해 복제하는 변경이 아니다. 이미 구현한 자체 durable receipt와 owner/job 검증을 사용해 URL 초안이 ACK 유실로 불필요하게 중단되는 문제를 해결하는 재구현 설계다. 실제 원문을 아직 얻지 못한 상황이나 provider 설정 부재를 해결한 것으로 표현해서는 안 된다. 기존 상품 링크·수정값·immutable receipt·전송 상태를 다시 쓰지 않으며 **미확인 ACK를 자동 POST 재시도나 다른 browser/network 수집으로 대체하지 않는다.** GET으로 유효한 저장 원문을 확인한 뒤 정상 초안 흐름에서 원래 지원하던 상세 원문 보완을 수행하는 것은 별도 동작이다. 이 복구가 보완 조건을 넓히거나 불확실한 receipt를 성공으로 인정하는 것은 아니다.

## 원문 identity와 새로 선택한 Evidence

UI source `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`의 SHA-256은 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`다. UTF-16·끝 제외 범위이며 slice digest는 UTF-8이다.

| 항목 | 범위 | SHA-256 |
| --- | --- | --- |
| handleAddProduct | `[409883,410740)` | `2c08c174d1abb501f2b04228f11a9799af78f94f77887b531077ba13f52cdada` |
| requestProductInfoFromExtension | `[410741,411765)` | `d68bf7c9e8a1ae5589f3f56415c76e539e13f4263529323cf5fd6d83164997df` |
| answerProductInfoFromServer | `[411766,412547)` | `7e72aae28a53852bd8bbbd31d2a8fcc1f749ab61bffde0e31f517fdf0e866b72` |
| PRODUCT_INFO_RESPONSE if branch | `[414581,417234)` | `897aa22a2946fa3a670a8be43e4b827a3afaefbedf96da7e82c7a6c9fbfc0ebf` |
| createProductObject | `[436576,441156)` | `d359e61ea580bfcdead25cbecbbcb27390a41394bd3ee7b6238a04f74a4e3e53` |
| runInitialProcessing | `[441157,442908)` | `9e1ab8af2d5ad2bd10bccbf19bdf3230cf38109f76f52227fc82c8711a2ade15` |

범위·hash는 ignored `outputs/step715-intake-analysis-extract.mjs`가 source identity를 확인한 뒤 inert TypeScript AST로 선택해 manifest에 보관한다. 과거 기록의 같은 범위 digest와 충돌하면 이번 exact artifact/범위 hash를 사용하며 wrapper digest와 혼동하지 않는다.

이전 intake parent `ev_1983224a44e1100a435aca7caaa76ebb6e1d9df782252092d57dcc695765e8ee`는 과거 감사에 기록되어 있지만 이번 연결에는 retained/portable record가 없다. 이를 새로 읽었다고 주장하지 않았다. 기존 Step660의 선택 메서드 밖에 있던 **PRODUCT_INFO_RESPONSE 분기 하나만** 새 비실행 wrapper로 실제 REA 분석했다. 원본 전체 producer를 다시 실행한 것이 아니다.

새 parent는 `ev_cd515dbbeab22000b72ee021eb669326d3fa3695cede4a815ccd90c6966e239a`, summary는 `ev_2c33f445137a7d8cd61269f2e5ad00e61a6916397c8f861249f4d3e01eb9e0d2`다. 선택파일 `outputs/step715-intake-analysis-selected/productInfoResponse.js`의 SHA는 `ac9b90eb15b56dc9d9beb8f3e6c30c95d8c50225b5de0ff9ffd5463a6e096714`, directory SHA는 `087bc9ca06125903677f89ce83642131984c4aa7dae34957c7c5766b76cbe2db`다. 3,374 bytes·파싱1파일·AST512개·parse failure0, application 선택범위 complete·semantic unknown111개다. 바깥 Vuex/`this`·서버·다른 event branch는 미해결이다.

portable bundle `outputs/step715-intake-analysis-evidence-bundle.json`의 SHA는 `e9bf40d30f95e7235d37b6d4dbf63ade4cb9a74725443d5a759ace527c961c41`다. 이전 문맥11개와 새 parent/summary2개, 총13 records이며 이전 기록까지 새로운 원문 분석으로 세지 않는다. native/browser/runtime session은 열지 않았다.

## 남은 검증

자체 수정은 합성 local API/SQLite에서 ‘저장은 됐지만 ACK만 유실’된 상황과 ID 오류·확정 거절·abort·기존 상품 보호를 확인해야 한다. 실제 1688 신규 원문 수집·모델 번역 품질·전체 카테고리·실제 Supplier Hub 접수와 SKU 대조는 별도 미완료 범위다. 이 감사나 로컬 복구 검수가 private provider 동일구현·실제 접수·전체 완성을 입증하지 않는다.

## 구현 후 독립 소스 검토

동결된 `intake-collection.ts`, 새 `intake-collection-recovery.ts`, `alibaba-mobile-collector.ts`와 관련 테스트3개를 읽고 경계를 대조했다. ACK 복구는 직렬화·정상 JSON의 검증을 transport catch 밖에 두고 같은 job의 GET 한 번으로 한정한다. raw·정규 URL도 모두 현재 source와 같아야 하며 거절·wrong identity를 다른 저장본으로 치유하지 않는다. abort·기존 상품 보호와 확인 후의 원래 정상 보완 의미를 유지한다.

별도 optional 상세 경로는 이미 검증한 offer/SKU 자료를 server 내부 typed transport 오류에서만 부분 원문으로 보존한다. raw Chrome 형식이나 실제 HTTP 상태를 꾸미지 않는다. 초기 소스 검토에서 상세 child signal의 종료 정리를 보완하도록 전달했고, 최종 코드는 성공·실패 모두 child abort·타이머/parent listener 제거를 보장한다. HTTP 권한 오류·잘못된 charset의 미소비 stream 취소와 lock 해제를 명시적으로 검사하는 회귀도 추가됐다. 후기 read에서 body 취소·reader 해제·늦은 응답 폐기까지 확인했으며 남은 actionable 지적은 없다.

정확한 최종 소스/테스트 SHA, 확인한 보조 validator·GET route SHA와 한계는 `outputs/step715-independent-review.json`에 있다. 이 검토자는 앱·테스트를 수정하거나 테스트를 재실행하지 않았고 합성 통과 수를 따로 더하지 않았다. parent/worker의 실행 로그가 실제 자체 검사 결과를 제공하며, 그 결과도 원본 수집 provider나 실제 접수 완료의 증거는 아니다.
