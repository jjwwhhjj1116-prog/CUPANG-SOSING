# Step781 — 검증 반려 항목 표시와 실상품 검증 경계

기준 커밋은 `86fce4a05c55143ed30343a6c341db8dfe53a6fa`다. 사용자가 적용한 통합 확장 2.1.18은 이전 운영 앱 응답으로 확인됐으며, 그 사실을 새 기능 적용 완료와 혼동하지 않는다. 기존 업무 상품, 이전 수집본과 Supplier Hub 발주 화면은 열어 편집하거나 전송하지 않았다.

## REA 근거와 구현

보관된 Couplus 배포 청크의 `verifyProducts`·`processNext`·실패 상세 경로는 검증 오류의 항목명과 사유를 보존한다. 우리 런타임도 native checkpoint에 `validationErrors`를 저장했지만, 전체 상품 응답에 이를 투영하지 않아 앱에는 일반 반려 문구만 표시됐다. 원본 근거·해시·범위는 `outputs/step781-rea-transport-audit.json`에 있다. 해당 공급자의 모든 실패 UI 또는 자동 수정 동작까지 동일하다고 주장하지 않는다.

`single-document.mjs`는 현재 전체 상품의 `validation-rejected` 응답에만 `validationRejection.errors`를 전달한다. 개별 기존 계약은 그대로다. 클라이언트는 최대 200개, 항목명 500자·사유 2,000자, 정확한 필드와 현재 request/document/checkpoint를 검증한다. 구버전의 상세 없는 응답은 명시적인 안내를 유지한다. TTL이 갱신된 같은 요청에서 원래 반려 시각을 거절하지 않는다.

전송 화면은 검증 단계, 미제출 문서 ID, 원래 항목명과 사유를 표로 보여준다. 서버의 HTML처럼 보이는 문자열도 텍스트로 표시한다. 저장된 반려 결과를 다시 확인한 뒤 사용자가 수정 허용을 선택해야 편집 잠금이 풀린다. 현재 화면에서는 오류를 계속 볼 수 있고, 회사·상품·검토 변경 및 ABA 이후에는 되살리지 않는다. 명시적 해제 후 완전 재마운트에서 별도 오류 상세 이력을 복원하는 기능은 이번 변경에 포함되지 않는다.

작은 전송 이력에는 원래 요청의 식별 증거만 보관한다. 최대 크기의 오류 본문을 65,536자 제한 이력에 추가해 수정 허용이 실패하게 하지 않는다. 상세는 원래 확장 checkpoint에 남는다. 이 안내가 입력값 수정, 자동 재등록, 약관 동의 또는 최종 제출을 실행하지 않는다.

## 검수와 배포 산출물

실제 production React 컴포넌트·클라이언트·dispatcher·receiver·private asset 핸들러를 격리 SQLite 및 합성 Chrome/Hub 어댑터에 연결했다. 기존 Chrome4의 로컬 검수 탭에서 새 합성 문서 한 개 생성·검증 반려·읽기 복구·명시 수정 허용을 수행했다. 항목명·사유·문자열 이스케이프·잠금 해제·해제 후 오류 유지를 확인했다. 보호된 합성 상품·원문·파일·기존 문서는 같고, 약관 클릭·단계 이동·제출·실제 1688/Hub 요청은 0이다. native 검증 실패 응답만 fixture가 제공했으므로 실제 접수 증거가 아니다. `outputs/step781-browser-final-proof.json`과 `outputs/step781-browser-{rejection,release}.png`를 참조한다.

검수용 custom port는 기존 origin 제한에 거절됐고, frozen adapter 대입과 localhost/127.0.0.1 불일치도 각각 거절됐다. 검수 fixture만 수정했으며 운영 보호를 완화하지 않았다. 검수 탭과 서버를 종료하고 운영 앱은 유지했다. 독립 읽기 검수의 추가 확정 P1/P2는 없었다 (`outputs/step781-validation-diagnostics-independent-review.json`).

넓힌 회귀 검사에서 기존 prepared-lifecycle VM 테스트의 의존성 누락을 발견했다. 기준 커밋에도 같은 fixture가 실제 `readPreparedDocumentPreviewCheckpoint`를 주입하지 않아 `ReferenceError`가 났다. 실제 조회 함수를 import·주입하고 읽기 전용 empty store만 제공하는 테스트 코드 2줄을 보완했다. 실패한 해당 사례 하나만 재검사해 통과했으며 긴 성공 흐름을 반복 실행하거나 운영 로직·차단 조건을 바꾸지 않았다. 원래 실행의 실패와 좁힌 재검사를 모두 보존한다 (`outputs/step781-public-lifecycle-dispatch-repair-proof.json`).

확장 2.1.19는 native 오류 전달을 포함한다. 이전 2.1.18 ZIP은 그대로 보존했다. 새 패키지는 90파일, 1,113,844바이트, SHA-256 `c1fe955ecc76a4917cf5f561a43d9aa4963a814ff02bdcd322ed5b245e883bd3`이다. 차이는 README·manifest·single-document 3개이고 87개 파일은 동일하다. 권한·호스트·content scripts·background는 같다.

Chrome이 실제 읽는 이전 판매량 확장 폴더의 95파일을 `outputs/step781-loaded-extension-backup`으로 백업한 뒤 canonical 90파일을 복사했다. 삭제·Chrome profile/storage 접근은 없다. 파일 준비 버전은 2.1.19이고 **실행 확인 버전은 2.1.18**이다. 사용자에게 아직 새로고침 요청을 보내지 않았으며, 신규 런타임 오류 전달이 실행 중이라고 주장하지 않는다. `outputs/step781-loaded-extension-preparation.json` 참조.

## 실상품 검증의 한계

이 단계에서 사용자 지정 검증 상품 `https://detail.1688.com/offer/1022260303756.html`을 기존 Chrome4에서 여는 직접 동작 한 번이 브라우저 **사이트 안전 정책**에 거절됐다. 정책은 페이지 관찰 권한을 부여하지 않았으며, Auto-review 또는 사용자 권한 질문은 실행되지 않았다. 로그인 문제나 사이트 자체 장애로 확인된 것이 아니다. 같은 내용을 얻기 위한 다른 브라우저·확장·서버·CLI·캐시·우회 경로는 시도하지 않았다.

따라서 이 단계에서는 실제 새 상품 수집, 카테고리와 1~7단계의 전체 실상품 대조, 실제 Supplier Hub 접수 번호 확인을 완료하지 못했다. 기존 963861920029 수집본과 업무 상품도 재사용하지 않았다. 두 일반 live gate는 false를 유지한다. 전체 UI 동등성 또는 실제 접수 완료율을 산정하지 않는다. 최종 검사·Worker 배포·커밋·푸시 결과는 `outputs/step781-final-validation.json`에 별도 기록한다.
