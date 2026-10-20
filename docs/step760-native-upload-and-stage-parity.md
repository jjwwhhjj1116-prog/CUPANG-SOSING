# Step760 — native 원본 전송 연결과 단계별 입력 대조

2026-10-20. Step759 다음 변경이다. 기존 실상품·Couplus 작업 상품·실제 설정은 열거나 수정하지 않았다. 이번 단계는 **파일명 기반 전체 상품 검토와 실제 확장 어댑터 연결을 로컬에서 검증한 것**이며, 실제 1688 수집 또는 Supplier Hub 업로드·접수 성공을 의미하지 않는다. 전체 동일 구현이나 임의 완료율을 주장하지 않는다.

## 전체 상품 검토를 기본 흐름으로 연결

`app/components/supplier-hub-single-review.tsx`의 `primaryProduct`는 새 `SupplierHubNativeSourceReview`를 사용한다. 기존 개별 옵션 검토는 별도 기존 경로에 남는다. 기본 흐름은 현재 승인 회원·회사와 `native-assets` GET을 확인하고, 옵션별 대표·추가·상세·사이즈표·표시사항 파일 수와 법적 원본 PDF를 보여준다. 사용자가 **견적서·첨부 파일 확인**을 누르면 포함 옵션 전체를 문서 하나로 검토한다. 이 진입으로 public 이미지 준비 POST, 재수집, Hub 문서 생성 또는 업로드가 실행되지는 않는다.

`app/supplier-hub-native-product-document.ts`는 별도 원본 계약을 검증한다. 현재 상품·회사·카테고리·선택 profile·source clocks·포함 옵션 ID/이름/순서와 견적서 view가 일치해야 한다. 원본 계획·identity·전체 파일명 본문·동의 보류 본문의 SHA를 각각 검사하고, 역할별 파일/슬롯 순서와 실제 본문 파일명 연결을 확인한다. 컴파일 전후 같은 원본을 다시 GET하며, 변경·취소·잘못된 JSON/파일 목록은 검토 오류로 끝난다. malformed 이미지 목록이 화면 렌더링 예외로 번지던 경계도 reader에서 거절하도록 보강했다.

검토 결과는 기존 전체 상품 transport에 연결하지만, 과거 public URL 본문의 검토 SHA 아래에서 파일명 본문을 바꾸지 않는다. `supplier-hub-product-receipt` POST는 관찰값이 추가 native 검증 경로를 선택하더라도 서버가 현재 원본 계획과 견적서를 다시 만들어 전체 관찰값을 검증한다. 관찰값이 plan·본문·회원·회사·권한을 공급할 수 없다. 저장 직전 원본 guard와 기존 원자 저장 조건을 유지한다. 이 저장 경로의 합성 관찰값 검증은 실제 Hub 접수 증거가 아니다.

## 실제 확장 어댑터의 opt-in 업로드 경계

이번 연결 파일은 다음과 같다.

- `extensions/supplier-hub/native-product-assets.mjs`
- `extensions/supplier-hub/native-asset-upload-page.mjs`
- `extensions/supplier-hub/product-document-adapter.mjs`
- `extensions/supplier-hub/single-document-adapter.mjs`
- `extensions/supplier-hub/single-content.js`
- `extensions/supplier-hub/product-document-dispatch.mjs`

어댑터 선택은 원래 앱 탭의 인증된 현재 GET에서 native 원본 계획과 본문 SHA를 독립 확인한 뒤 이루어진다. 패킷 필드 하나가 느슨한 전송 방식을 선택하지 않는다. native 확인 실패 후 기존 어댑터를 선택하는 경우에도 기존 public-package fingerprint·본문·회사·이력 검증이 그대로 적용된다. 원본 검증 실패를 무시하는 자동 쓰기 우회는 없다.

업로드 대상은 이 요청이 전용 탭에서 새로 생성한 정확한 문서로 제한한다. create operation ID·docId·packet/body SHA·기준 문서 목록을 확인하고, 기존 docId 또는 사용자가 불러온 문서/watch가 있는 경우 원본 업로드를 거절한다. 현재 앱의 승인 회사·원본 계획·파일 길이/SHA를 재검사하고, private 원본 바이트를 검증한 뒤 역할별 multipart를 구성한다. 같은 원본을 여러 역할로 사용할 때도 각각 올바른 전송 별칭과 바이트를 검증한다. PDF의 원래 이름·법적 값은 유지하고 확인된 certificate 행 별칭만 사용한다.

보관된 SR `main.5239dce6.js` SHA `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`의 기존 REA 근거를 재사용했다. 확인된 `additionalImageFiles`/`uploadFiles` multipart 이름, 역할별 업로드 경로, 목록 조회와 **응답 배열**만 소비한다. `{data: ...}` 같은 미확인 응답 포장은 해석하지 않는다. 이번 변경을 위해 vendor 번들을 실행하거나 같은 SHA의 REA producer를 반복하지 않았다.

각 그룹은 요청 전 `requested` 기록을 남긴다. ACK 유실·알 수 없는 응답·목록 불일치가 생기면 JSON 문서 update를 진행하지 않고, 같은 파일을 맹목적으로 다시 업로드하지 않는다. 이미 관찰된 그룹을 재확인할 때도 같은 문서의 파일명 목록과 보관된 ACK가 일치해야 한다. 업로드/목록 메타데이터 일치는 원격 파일 바이트 영속성이나 접수를 증명하지 않는다. `remoteBytesVerified`, `actualUploadVerified`, `registered`는 false로 유지한다.

실제 어댑터와 직렬화된 injected 함수는 합성 Chrome/API/파일 응답으로 시험했다. 양사 원본 이미지, certificate PDF, 한 원본의 여러 역할 재사용, 원본·바이트·프레임 변경, 이전 차단 이력, ACK 유실·목록 변경·미확인 envelope를 포함한다. 보호된 기존 합성 문서는 바뀌지 않았고, 제출 호출은 없었다. 이것은 외부 Hub 통신을 수행한 시험이 아니다.

## 표시사항 입력·확인창

대조 원본은 `outputs/step754-current-couplus/chunk-6b0db3f8.8a741991.js`, SHA `5b92873c674c4b76c0e6ce4961caedbf8728ca86f6a15b6d9dc8cdfce80ad1d9`다. 아래 위치는 UTF-16 인덱스이며 끝은 제외한다.

| 원본 함수 | 범위 | 반영한 입력 의미 |
| --- | --- | --- |
| `initializeData` | `[148733,149597)` | 저장한 사용자 구조·값이 있으면 기본 9항목보다 우선 |
| `removeItem` | `[150411,150565)` | 필수 항목 보호, 선택 항목 삭제 전 확인 |
| `addNewItem` | `[150566,150838)` | 새 항목 추가 직후 이름 입력 focus/select |
| `resetToDefault` | `[150839,151758)` | 확인 후 기본/저장 구조로 복원 |
| `clearAll` | `[151759,151920)` | 확인 후 필수 항목만 남기고 값 비우기 |

`app/components/product-label-editor.tsx`는 기존 이름 click→Enter/blur 확정·Escape 취소와 multiline 값 입력을 유지한다. **기본값 복원**은 현재 저장한 구조와 값으로 로컬 초안을 되돌린다. 저장한 사용자 항목·명시 공란이 있는 경우도 보존한다. 기존 **기본 9항목 구조로 복원**과 공통·자동값 override 해제는 의미가 다르므로 별도 확인 작업으로 유지한다.

삭제·복원·전체 비우기는 확인 후에도 product/option/profile/source/active/disabled/busy와 초안·이름 후보가 그대로인지 다시 검사한다. 오래된 확인 결과는 적용하지 않는다. 새 항목은 즉시 이름 후보 입력으로 들어간다. 확인 취소는 초안/미리보기를 유지한다. 이 작업들은 로컬 변경이며, 기존 명시 저장·CAS→PNG→첨부 흐름과 원격 파일 삭제 금지는 그대로다.

표시사항 최종 focused 검증은 11개 고유 파일 96/96 case다. 근거는 `outputs/step760-label-final-tests.log`, `step760-label-lint.log`, `step760-label-types.log`, `step760-label-confirmation-ui-proof.json`이다. 최초 95/96 로그 `step760-label-first-related-tests.log`도 보존했다. 실패는 합성 reference-busy 테스트가 해제를 하지 않고 idle을 기다린 fixture 문제였으며, 테스트가 차단을 확인한 뒤 busy를 해제하도록 수정했다. 앱 guard를 완화하지 않았다. 최초 lint의 미사용 변수 경고 로그도 별도 보존했다.

## 가격 원가 표시

같은 Couplus 원본 `[165430,166355)`의 표는 개당 위안 원가와 현재 구성 수량의 합계 및 일반 적용환율 환산값을 보여준다. slice SHA는 `2f4c334cb68c65540485e875f5d22289ccddd338b7003afc6ccb9e5ecea1ec6f`다.

`option-price-table.tsx`에 현재 저장 정책의 `exchangeRate`를 전달하여 다음 읽기 표시를 추가했다.

- 일반 환율 환산: 개당 위안 원가 × 구성 수량 × 일반 적용환율.
- 구성 수량이 1보다 클 때 위안 구성 합계.
- 공란·잘못된 원가/수량/환율에는 금액을 만들어 표시하지 않음.

이 표시는 통합통관 매입가 계산과 구분한다. 가격 산식·입력 callback·저장·정책 dirty 잠금은 바꾸지 않았다. `outputs/step760-price-source-proof.json`과 `step760-price-source-tests.log`의 focused 3개 파일 32/32 case를 확인했다. 표시사항 focused 결과나 root 시험과 합산한 전체 수치가 아니다.

## 실제 로컬 Dashboard 브라우저 검수

root가 실제 Dashboard/컴포넌트와 로컬 API·임시 SQLite를 사용했다. 회원·상품·양식·PNG는 합성 자료다. 검수 상품은 `synthetic-document-652`, 보호 상품은 `protected-synthetic-760`, 회사는 와이홉 `A01464742`였다.

- 전체 상품 native 검토에서 포함 옵션·상품명·금액·역할별 파일을 확인했다.
- 가격 구성 수량 2→1 입력에 따라 구성 원가 표시가 변하고, 되돌린 1개 구성의 일반환율 환산 표시 2,485원을 확인했다. 이는 초안 입력 관찰이며 별도 저장 성공으로 확대하지 않는다.
- 표시사항 단계를 읽기 전용으로 열어 편집·확인 제어를 확인했다. 브라우저에서 파괴적 확인창의 확정이나 저장은 실행하지 않았다. 삭제·복원 경합 검증은 앞서 설명한 합성 컴포넌트 시험 근거다.
- 보호된 합성 상품의 SHA/상태는 그대로였다. 실제 기존 상품은 사용하지 않았다.
- 전체 로컬 API 쓰기 0, `native-assets` GET 3회, 실제 source/1688 요청·Hub 요청·native 요청은 모두 0이다.

스크린샷은 `outputs/step760-ui/native-document-review-final.png`, `outputs/step760-ui/price-bundle-cost.png`, `outputs/step760-ui/label-edit-confirm-controls.png`다. 최종 브라우저 검수 요약은 `outputs/step760-browser-final-proof.json`, 요청 기록은 `outputs/step760-browser-qa/proof.json`, 앞선 origin 준비 상태는 `outputs/step760-browser-before-origin-proof.json`에 있다. 409 응답은 연결 원문이 없는 QA fixture의 `translation-source` GET 2건이며, 이 브라우저 검수에서 번역 또는 실제 수집을 검증했다고 주장하지 않는다.

## 검증 상태와 다음 경계

focused native/root/표시사항/가격 로그는 서로 범위와 반복 실행이 겹친다. 이를 단순 합산하지 않는다. 파일 이름에 `final`이 있어도 중간 실패가 남은 `step760-native-review-final.log`를 최종 통합 성공 기록으로 취급하지 않는다. 초기 native 테스트의 fixture 기대·receipt 저장 단언 실패와 후속 수정 기록은 보존하며, root가 최종 고유 파일 목록으로 다시 확정한다.

- 최종 관련 검사는 **35개 고유 파일, 405개 case 통과**다. 첫 통합 실행은 393/416이었다. 실패 23개는 바뀐 primary 경로를 여전히 public-package 준비로 가정한 구형 fixture에서 발생했다. 이 파일의 기존 24개 case 전체를 실제 `SupplierHubSingleReview`→native scope와 양사 explicit legacy를 검증하는 13개 case로 갱신하여 모두 통과했다. 나머지 34파일의 392개 성공에 새 13개를 합산했고, 이전 primary 파일의 1개 성공은 중복으로 더하지 않았다. `step760-final-tests.log`와 `step760-primary-routing-final.log`를 함께 보관했다. 새 fixture의 첫 상대 import 누락 로그도 보존했다. 앱 guard는 완화하지 않았다.
- TypeScript·변경 파일 ESLint·운영 빌드·생성 수집 모듈 2개·ZIP 검사 모두 통과했다. 최종 source SHA는 `outputs/step760-final-validation.json`에서 확정한다.
- 확장 ZIP은 **2.1.8**, 88파일, 1,039,444바이트, SHA `13e47babf42ad4d7eabdf9595fcc71d2a6a94d0129a5f029c2638a9f5275ecb0`다. 기존 2.1.7 ZIP은 불변이다. 기존 Worker 배포 version ID는 `8309e2fd-cb4e-459a-80a6-b9f78d1f8315`다. 설치된 Chrome runtime을 2.1.8로 단정하지 않는다. 권한·호스트 범위·리소스·요금제·migration은 늘리지 않았다. 검수용 Chrome 탭과 로컬 서버는 종료했다.

독립 읽기 검토에서 새 재현 가능한 어댑터 결함은 찾지 못했다. 이 검토는 테스트 재실행·실제 브라우저/Hub 접근 없이 source 경계를 읽은 결과다.

REA 대조상 남은 가격 기능은 **상품별 자동 번들 설정·표현**과 **정책/옵션 grid 초안을 함께 명시 저장하는 원자적 coordinator**다. 기존 정책 dirty 잠금만 없애면 서로 다른 가격 정책과 옵션 초안이 저장될 수 있으므로 단독으로 해제하지 않는다. 그 밖에도 실제 상품 수집 공급계층의 동등성, 모든 카테고리/상태별 편집 동일성, 실제 upload/list/readback·원격 바이트 확인·최종 동의·docId/qvtRequestId/SKU 접수 검증은 끝나지 않았다.

`SINGLE_DOCUMENT_LIVE_VERIFIED=false`, `PRODUCT_DOCUMENT_LIVE_VERIFIED=false`를 유지한다. 파일 준비·목록 메타데이터·합성 receipt가 실제 업로드 또는 접수를 대신하지 않는다. 기존 작업 상품 보호를 유지하며, 이미 도구에서 거절된 대상에 다른 도구/확장/CLI/프록시로 우회 접근하지 않는다.
