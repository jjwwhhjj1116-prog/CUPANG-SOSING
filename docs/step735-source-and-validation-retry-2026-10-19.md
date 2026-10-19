# Step735 — 원문 재사용과 전송 전 반려 복구

2026-10-19 KST. 기준 commit `2e0850330f57324e3beb4b9940a129e20184ff6b`. 기존 운영 상품·회사 설정·Hub 견적서는 수정하지 않는다. 새 수집 성공이나 실제 접수 완료를 선언하는 변경은 아니다.

## 저장한 상품 원문을 재시도에서 다시 수집하던 문제

`collectIntakeProduct`는 현재 호출이 기존 Chrome 탭에서 JSON-LD를 얻었을 때만 선택적 보완 수집을 생략했다. 이미 원문을 받은 작업이나 이미지 저장 실패 뒤의 재시도에서는 같은 `chrome-product-jsonld-v1` 영수증을 읽어도 이 호출 내부 flag가 false였다. 원문 설명·이미지·속성에 선택적 공란이 있으면 Chrome 전체 수집을 다시 요청하고, 성공한 보완은 기존 견적을 무효화할 수도 있었다.

이번 변경은 검증한 **저장 원문의 provider**로 생략 여부를 판단한다. 기존 탭을 이번 호출에서 다시 읽었는지에 의존하지 않는다. 이미 받은 작업·오래된 화면에서 collect 응답으로 같은 영수증을 복구한 경우·이미 상품이 저장됐으나 이미지 가져오기가 실패한 경우에 같은 원문을 재사용한다. API 원문의 선택적 보완과 사용자가 명시적으로 요청한 원문 보완은 유지한다. 원문이 없는 새 URL을 수집할 수 있게 됐다는 의미로 확대하지 않는다.

수정 전 집중 회귀에서 누락된 전체 Chrome 수집 호출이 세 경우에 재현됐다. 수정 후 원문 재사용 관련 34건이 통과했다. 실제 로컬 API·in-memory SQLite·이미지 실패/재시도 fixture에서 수동 수정값·옵션·가격·완성한 견적을 보존하고 보완 POST·보완 DB행·전체 Chrome 수집 호출이 0임을 검사한다. 집중 결과는 `outputs/step735-source-retry-tests.log`에 있으며 최종 관련 검사와 중복 합산하지 않는다.

## 제출 전 단계 검증 반려 뒤 수정할 수 없던 문제

native receiver는 단계 검증에서 명시적 `success:false`를 받으면 `validation-rejected` 체크포인트를 저장한다. 이 상태는 아직 동의·최종 제출·접수 단계가 아니다. 기존 화면은 이를 종료 상태로 다루지 않고 진행할 수 없는 resume를 제공했다. 앱 전송 예약도 실제 접수의 `REJECTED` 영수증으로만 해제할 수 있어, 전송 전 검증 반려에는 수정으로 돌아갈 경로가 없었다.

receiver는 저장된 반려 체크포인트의 요청·단계·검증 prefix·sequence·시각과 동의/제출 없음 정보를 별도 `document-validation-rejection` 증거로 반환한다. 전체 상품 응답에만 부가하며 기존 Single 응답 형식은 유지한다. 단계 검증 요청과 체크포인트가 맞지 않거나 동의·제출·접수 흔적이 있으면 이 반려 증거를 인정하지 않는다.

앱은 **검증 반려 확인 · 수정 허용**을 명시적으로 눌렀을 때 원래 요청의 체크포인트를 읽고 회사·상품·본문·문서 ID·반려 증거의 동일성을 다시 확인한다. Web Lock 안에서도 현재 원문과 회원·화면을 확인한 뒤 정확히 같은 예약만 해제한다. ACK 유실·시간 초과·다른 회사/문서·바뀐 예약·잘못된 증거는 예약을 남긴다. native 반려 체크포인트를 지우거나 수정하지 않으며, 기록 조회를 새로운 원격 단계 검증 성공으로 표현하지 않는다.

추가 검수에서는 해제 뒤 같은 자료로 새 UUID를 만들면, 동일한 native packet에 남은 이전 UUID가 반환되어 새 예약이 묶이는 문제도 확인했다. 이미 접수된 뒤 native `REJECTED`로 반려된 경우에도 같은 문제가 있었다. 두 반려 경로 모두 기존의 정확한 반려 확인 계약을 유지하면서 회사·상품별로 검증된 작은 식별 기록을 보존하고, 이미 반려된 동일 자료의 새 시작을 차단한다. 원래 예약이 남은 경우의 읽기 복구는 허용한다. 자료를 수정한 뒤 새 전송 자료를 명시적으로 확인하는 경로는 유지한다. 이 기록에 원문 본문·이미지 URL·약관·자격 증명은 넣지 않는다.

최근 한 건만 남기면 A 반려→B 수정·반려→A로 복원할 때 이전 UUID 충돌이 다시 발생한다. 따라서 scope별 최대 32개의 strict 기록을 보존하고 자동으로 오래된 항목을 버리지 않는다. 한도·손상·알 수 없는 필드는 안전하게 중단한다. 기록은 원래 예약과 같은 Web Lock 안에서 쓰고 정확히 다시 읽은 뒤 예약을 해제한다. 기록 저장 뒤 해제/응답이 실패해도 원래 pending이 남아 있으면 동일 UUID 복구를 막지 않는다. 조회 화면의 사전 검사 외에도 claim의 lock 안에서 다시 대조해 다른 탭의 오래된 전송 미리보기도 차단한다. native 접수 상태나 저장된 영수증 형식은 바꾸지 않는다.

native 반려의 확인 시각은 새 조회 때 바뀔 수 있다. 기록 저장 후 pending 삭제가 실패한 경우에도 같은 요청·문서·등록 파일 ID·반려 상태라면 더 최근의 확인 시각으로 재시도할 수 있다. 보관한 최초 기록은 그대로 두며, 다른 ID나 이전으로 돌아간 시각은 거절한다. 전송 전 검증 반려의 단계·sequence 증거는 변경 없이 정확히 일치해야 한다. 이 마지막 경계는 실패 회귀를 먼저 확인한 뒤 수정했고 독립 검토를 통과했다.

최초 반려 복구 구현의 15파일 288/288 결과와 1,359개 소스 동결 근거는 `outputs/step735-related-release-{freeze,proof}.json`과 `.log`에 보존했다. 이 결과는 마지막 동일 자료 재시작 방어를 추가하기 전 결과이며 최종 수정의 통과 수로 바꾸어 쓰지 않는다.

## 실제 브라우저 확인과 남은 경계

기존 Chrome 4의 YOOFAM PLUS에서 관리자 로그인·상품 목록을 확인했다. 기존 대기열은 표시 후 입력·저장·수집 시작 없이 닫았다. 다른 작업이 사용하던 기존 Hub 탭 대신 **같은 Chrome의 별도 조회 탭**에서 `https://supplier.coupang.com/qvt/wims`와 회사 메뉴의 **유앤채 / A01526306**을 확인한 뒤 검수용 탭만 닫았다. 목록에 있던 기존 등록을 이번 구현의 접수라고 주장하지 않는다. 스크린샷은 Page.captureScreenshot 5초 시간 초과로 저장하지 못했고 접근성 UI로 읽은 사실만 기록했다. `outputs/step735-browser-readonly.json` 참조.

REA의 기존 shipped artifact·portable Evidence를 재사용한 [원본 조사 보고서](step735-original-submit-readback-audit-2026-10-19.md)는 원본의 동의·최종 POST·완료 문구와 접수 목록 전환을 구분한다. 원본 반려 `remark.errors[]`의 항목/사유 표시가 자체에 없는 차이는 후속 항목으로 남긴다. static 소비 코드는 실제 wire 응답이나 새 접수의 증거가 아니다.

1688의 이전 사이트 안전 거절을 재시도하거나 다른 도구·확장·backend로 우회하지 않았다. 실제 새 상품의 원문 취득·final POST/ACK·새 docId와 qvtRequestId·SKU 연결은 여전히 검증하지 못했다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`, `PRODUCT_DOCUMENT_LIVE_VERIFIED=false`는 유지한다. 로컬 fixture에서 사용하는 live ACK와 native adapter 호출은 실제 Hub 접근·상품 변경·실접수로 집계하지 않는다.

## 최종 검사·배포

마지막 수정까지 동결한 15파일 검사는 **297/297 통과, 실패·취소·skip·todo 0**이다. Node `v24.19.0`, 실행 시간 25,131ms이며 검사 중 소스 1,359개 SHA가 바뀌지 않았다. 앞선 288건과 담당별 34·87·27·36건은 이 검사와 겹치므로 더하지 않는다. `outputs/step735-related-final-{freeze,proof}.json`과 `.log`에 단일 최종 결과를 보관했다. `step735-validation-rejection-final-proof.json`은 최초 proof와 288건 로그의 SHA를 유지하고 이후 발견·수정한 세 경계를 따로 기록한다.

최종 타입 검사·변경 파일 lint·운영 빌드·diff 검사는 모두 통과했다. 마지막 소스의 근거는 `step735-types-final.log`, `step735-lint-final.log`, `step735-build-final.log`이며, 이전 `.log`와 `*-release.log`는 중간 시점 결과로 보존했다. client와 SSR dashboard 산출물에 새 반려 기록 경로·복구 버튼이 포함된 것도 확인했다. DB migration·기존 운영 상품·회사 설정은 변경하지 않았다.

확장 0.2.83을 새 권한·host 변경 없이 패키징했다. 파일 58개, 749,196bytes, ZIP SHA-256은 `2533d70a10e48c9aad749caaec7ee24f01bacda64320253e7c164e1da678bec6`이다. 공개 수집 모듈과 ZIP 원문 대조 검사를 통과했다. 앱의 다운로드·업데이트 안내도 같은 버전으로 맞췄다. 브라우저에 0.2.83이 실제 적용됐다는 확인은 하지 않았다.

기존 `sourceflow` Worker에 `--keep-vars`로 배포했다. version `08965f6b-80ea-4905-9735-0476f315089b`, 주소 https://sourceflow.jjwwhhjj1116.workers.dev/ 이다. `outputs/step735-final-validation.json`은 최종 소스/검토 SHA, 297건, 타입/lint/build, ZIP/다운로드 버전, client/SSR 산출물, 실제 배포 version과 false native gate를 함께 확인한다. 이 배포는 실제 새 Supplier Hub 접수 완료의 증거가 아니다.
