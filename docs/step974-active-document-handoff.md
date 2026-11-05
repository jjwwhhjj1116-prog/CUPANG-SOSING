# Step974 — 진행 중인 문서와 작업창 인계

## 근거와 설계

COUPLUS 보관 route SHA `5b92873c674c4b76c0e6ce4961caedbf8728ca86f6a15b6d9dc8cdfce80ad1d9`의 `closeWizard`는 편집창 닫기와 closed 이벤트만 처리한다. 저장과 등록 전송은 별도 동작이다. `cliPageSubmitRegistration`은 `isVerifying` 중 새 등록 요청을 거절하며 원래 대기열을 기다린다. 이는 보관된 코드의 정적 관찰이며 실제 전송 실행의 증거가 아니다. REA parent `ev_74135c2a7e00469ce4e3cb39748a224763539b087d5103ced3b2ddfe477d7dfc` / summary `ev_edfd825dd142bc8bda820e46c5e32265d7116986d38fac9acd1818eeb11896c3`. 원본 AST는 파싱됐으나 REA semantic graph는 heap 제한으로 partial이다. 관련 원문 메서드와 범위는 별도로 보존했다.

YOOFAM은 source 잠금과 close 잠금을 분리한다. 긍정적으로 저장한 접수 대기 화면은 source=true, close=false여서 명시적으로 닫을 수 있다. 현재 `openSubmission`은 close만 검사하므로 유지된 목록 콜백이 현재 전송 세션을 교체할 수 있다. `openProduct`도 해당 전송의 source 잠금을 검사하지 않는다. 또한 `prepareCurrentSubmission`은 전송 화면을 열지 못해도 원래 작업창과 옵션 복귀 정보를 지운다.

기존 Dashboard의 공통 진입점에서 현재 세션의 source 또는 close 잠금을 검사한다. 이전 세션의 잠금은 새 세션을 막지 않는다. 명시적으로 닫은 뒤에는 기존 pending 복구 흐름이나 다른 상품을 열 수 있다. `openSubmission`이 실제 성공 여부를 반환하고, 견적서 인계는 성공했을 때만 원래 작업창과 복귀 정보를 정리한다. 회원·회사·상품·양식·미저장 입력·저장 중 가드는 유지한다.

성공한 인계는 product navigation 세대를 즉시 증가시켜 이전 작업창의 재호출을 첫 React 커밋 전에도 거절한다. 독립 검토에서 계정 A→B→A 후 이전 `openProduct`가 현재 전송 잠금을 무시하는 경우를 재현했다. 현재 `submissionContext`와 일치하는지 먼저 검사하도록 고쳤으며 양사 회귀 검사의 RED→GREEN을 확인했다.

이 변경은 입력 저장, 문서 준비, 동의 또는 전송을 자동 실행하지 않는다. 기존 상품·접수 완료 문서의 재전송 금지는 유지한다. 실제 Hub 최종 접수나 모든 COUPLUS 상태의 동일성을 정적 분석·합성 검사로 완료 처리하지 않는다.

## 검증과 한계

새 인계·잠금 검사7/7, TypeScript·변경 파일 ESLint 통과. 독립 검토도7/7을 확인했다. 원래 HEAD 소스를 메모리에서 읽도록 한 별도 실행에서 초기 문제4개가 그대로 실패했고, 검토에서 찾은 계정 왕복 문제2개도 수정 전 실패했다. 운영 파일을 테스트 중 되돌리지 않았다.

확장 실행은298개 중293개 통과,5개 실패였다. 같은5개가 수정 전 HEAD에서도 동일하게 실패함을 별도로 확인했다: packaging review retains unsaved source…, retained packaging callback…, packaging review from a category-bound…, connection dialog displays returned server states…, reviewed archive product enters transmission…. 이5개를 통과로 집계하거나 이번 코드에서 해결했다고 보고하지 않는다. 초기 negative-name filter가 전체 파일 이름에도 일치해 실제 제외가 되지 않았으므로 확장 로그는 실패5개를 포함한 원래 결과 그대로 보존한다.

브라우저는 실제 Dashboard 진입/현재세션/닫기/잠금/상품열기/견적인계 함수와 실제 workspace 검사 함수를 추출해 합성 환경에서 실행했다. 정확한 상품·양식 인계1회, source-only 및 close-only 잠금의 세션 보존, 명시적 닫기 뒤 새 진입, 거절된 인계의 원래 작업창/옵션 복귀 정보 보존을 확인했다. 전체 Dashboard React와 SQLite/API 통합은 단위 fixture에서 별도로 확인했다. 브라우저 fixture는 실제 Hub/확장/API 요청0, 런타임 오류0이며 전체 화면 레이아웃·실제 접수 증거가 아니다.

검토한 동결본을 기존 Worker `777e1353-f057-4f5d-8bc6-9e0de3df6dad`에 반영했다. `dashboard-client-F7rkPxb9.js` GET200/2262459bytes/SHA `5538efb62dd8c43d488724009b7edc77dd41b81ed8f76969e49462f2927c045b`로 동결 파일과 일치했다. 실제 앱의 열려 있던 편집 탭은 다시 불러오거나 닫지 않았다.
