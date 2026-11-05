# Step976 — 같은 시각의 접수 결과 전진

저장 견적서 작성 완료에서 실제 native 전송 자료, 새 문서 준비, 단계별 동의3회, 제출1회,접수 이력 보관까지 잇는 양사 격리 통합 검사에서 결함을 재현했다. 동일한 `observedAt`의 SUBMITTED 다음에 FINISHED가 확인되면 서버 POST는200이지만 DB/GET이 SUBMITTED를 유지한다. 공유 저장 SQL이 strictly-later timestamp만 허용하기 때문이다. Product/Single client도 같은 시각의 더 진행된 저장 ACK를 거절하여 원래 결과 저장 재시도가 끝나지 않을 수 있다.

보관된 COUPLUS `cliPageWaitForSubmit`은 원래 검증 대기열이 끝날 때까지 기다리고 같은 작업의 결과를 확인한다. 기존 REA route SHA/Evidence IDs와 커버리지 제한은 step974 기록을 유지한다. 이 변경은 그 완료 경로의 저장 결함을 고치며 전체 UI 동등성을 새로 주장하지 않는다.

## 저장 계약

- 같은 owner·회사·request·doc·QVT·본문·source identity에 한해서 같은 시각의 `pending → accepted → rejected` 방향만 전진할 수 있다. `pending → rejected`도 허용한다.
- 나중 시각의 기존 정책, source/member/revision CAS, typed IDs, immutable payload, 중복 문서 차단과 rejected의 역행 금지는 유지한다. 더 오래된 시각으로 전진하지 않는다.
- 같은 상태·같은 시각의 반복은 원래 payload/rowid/created_at을 유지한다. 같은 시각의 rejection detail만 바꿔 덮지 않는다.
- Product와 legacy Single client는 같은/더 최근 시각의 앞선 상태 ACK를 받을 수 있다. owner/회사/문서/요청/본문/원본 연결이 다르거나 상태가 역행하면 계속 거절한다.
- 다른 저장 작업이 먼저 끝나 historical payload CAS가 실패한 경우, 요청보다 낮은 상태를 성공 ACK로 반환하지 않는다.409로 원래 결과를 보존하고 같은 요청의 저장만 재시도할 수 있다.
- 새로운 Hub 요청, 생성·파일 업로드·동의·제출 재생, 원래 packet·예약·입력 변경 또는 DB 마이그레이션은 추가하지 않는다. 등록 파일 완료와 개별 SKU 검증은 별도 상태다.

## 검증

양사 current/historical 실제 API 및 공유 SQLite store, 양쪽 client와 실제 React transport의 ACK/역행/변조를 검증한다. 완전한 synthetic category43필드로 저장 검사→native 파일7개/포함 옵션2개→새 문서 준비→단계 동의3회→제출1회→원래 요청의 pending/FINISHED→단일 이력 보관을 연결한다. 제외 옵션, 기존 문서와 source/images는 보존한다. 신규 실상품 URL은 사용자에게 요청한 상태이며 기존 상품/접수 완료 문서는 재전송하지 않는다.

검증 결과: 새 focused18개와 전체 native 경로2개가 의도한 실패 뒤 통과했다. 영향 범위11파일294/294 통과,TypeScript/대상 ESLint 통과. 독립 검토도18/18과 미해결 finding 없음으로 확인했다. 브라우저는 실제 React/client에 격리한 동일 시각 ACK를 주입해 완료·반려 각각 저장1회/준비1회/동의3회,오류0,추가명령0과 원래 요청 보존/반려 ledger를 확인했다. 브라우저의 확장·API 응답은 합성이며 실제 SQLite/API·native adapter/receiver는 별도 영구 통합 검사다. step975의10개와 step974의5개 기존 baseline 실패는 이번 범위 밖이며 해결하지 않았다. 전체 저장소 통과나 실제 Hub 접수를 주장하지 않는다.

계획: `docs/superpowers/plans/2026-11-06-receipt-progress.md`.

운영 배포: 고정한14개 파일의 빌드는 Worker `8123a3b1-deae-4dab-a2a2-1cb17b81c0af`에 반영했다. 기존 앱 탭을 다시 로드하지 않은 GET에서 `dashboard-client-BJCts2ym.js`가 HTTP200/2268632bytes/SHA256 `ae3d45d022c261459fb7ba04410296c4ccb6815d946e6042ffe76e40e0818a97`로 고정 빌드와 일치했다. 원래 HEAD auth만 사용했고 비밀 환경 파일·dependency link·DB migration·확장/CLI 변경은 없다. 최종 commit/push는 Git 검증 뒤 현재 채팅 outputs의 결과에 기록한다.
