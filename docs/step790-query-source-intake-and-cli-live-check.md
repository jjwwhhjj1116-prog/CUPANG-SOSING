# Step790 · 카테고리 전 서버 원문 저장과 초안 연결

2026-10-22, 기준 `a10f584c4f72b4ee2b8589eb6db2b075bcb7ccfa`. 기존 업무 상품을 수정하지 않고 서버 URL 조회 결과를 카테고리 선택 이후의 기존 초안 작성 경로에 연결했다. 전체 Couplus UI 동일성이나 실상품 수집·접수 완료를 의미하지 않는다.

## 실제 CLI 읽기 연결 검수

사용자의 **읽기 연결 승인**에 따라 기존 Chrome3의 유앤채(A01526306)에서 자체 CLI0.1.0/127.0.0.1:49831의15분 세션 연결을 실행했다. 상품조회 체크는 계속 해제했고 상품조회 명령·상품 수정·전송은 실행하지 않았다. 연결 주소를 이미 열린 `/cli` 문서에 입력하면 fragment가 처리되지 않는 실제 버그를 발견해 hashchange 처리, 즉시 fragment 제거, 이전 연결 해제 후 새 연결 대기, 세대가 다른 늦은 응답 폐기와 StrictMode 처리를 수정했다. 내부 AbortError를 사용자 안내가 덮어쓰던 오류도 수정했다.

CLI의 tools/list는 네 도구를 반환했다. 회사 조회 API는 현재 유앤채를 반환했고, 같은 Chrome에서 localhost HTTP 응답도 확인했다. 그러나 수정 배포 후에도 실제 페어링은 제한 시간 안에 완료되지 않았고 CLI status는 PAIR_REQUIRED였다. 이것만으로 브라우저 권한이 원인이라고 확정할 수 없다. 브라우저 로컬 네트워크 안내의 표시 여부를 사용자에게 요청했으며 이 문서 작성 시 답변은 없다. 임시 CLI를 종료하고 해당 포트 리스너0개를 확인했다. 연결·실상품 성공으로 계산하지 않는다. 토큰·쿠키는 검수 자료에 저장하지 않았다.

## 새 서버 수집 경로

- `POST /api/query-captures`는 URL과 요청ID, 현재 회원·회사만 받는다. 원문 JSON을 클라이언트에서 제출할 수 없다. 서버가 조회·검증한 CollectionResult를 독립 `query_source_captures`에 저장한다. 기존 `/api/product-query`의 읽기 전용 계약과 CLI 네 도구는 변경하지 않았다.
- provider·priceBasis·offerDefault·sourceGallery·pageOptionIdentity·옵션 원가·MOQ null·재고0·빈 이미지 목록을 그대로 보존한다. PageSource로 강제 변환하지 않는다. 지문과 회원·회사·버전을 재검증하며 동일 요청 재시도는 저장된 ACK를 반환한다. 저장 전 동시 요청의 upstream 호출까지 정확히 한 번으로 보장하지는 않는다.
- 새 대시보드 URL 수집 UI는 사용자 클릭으로만 조회한다. 저장 원문 요약 → 카테고리 선택 → 정확한 query capture 선택 → 기존 SEO/가격/이미지/표시사항/견적서 초안 경로로 전달한다. 조회·저장만으로 Supplier Hub 전송을 실행하지 않는다.
- 이미 상품이 연결된 요청에는 query 원문을 자동 반영하지 않는다. 다른 회사·회사가 미확인인 기존 대기 요청도 거절한다. 원문 선택이 바뀌거나 ACK가 불확실하면 다른 receipt GET으로 성공을 추정하지 않는다.
- 상품 생성 transaction에도 소유자·회사·원문 지문·선택 버전·보관 상태·receipt 시각·job context 조건을 적용한다. source가 바뀌면 새 상품 행을 만들지 않는다. 기존 상품이 경쟁 중 생성되면 이미지·SEO 쓰기를 중단한다.
- 활성40/보존200 한도. 보관·해제 API와 UI는 버전 CAS로 원문을 삭제하지 않고 visibility/revision만 바꾼다. 보관 해제 후 이전 선택 버전은 무효화된다.

## 검수와 배포

고유10파일 **193/193**, fail/skip/cancel0. 양사 실제 API+SQLite 원문 저장/초안 생성, 실제 CategoryPicker→명시 시작→선택본 전달, 기존 page 경로 회귀, 회사 변경·타회사 pending 오염 차단, transaction race, ACK 손실, 보관/해제, 실제 localhost CLI TCP를 포함한다. provider와 UI 자료는 합성으로 주입했으며 실제1688·Supplier Hub 호출은0이다. 첫192/193 실패는 새 UI 시험의 `Response.json(body,409)` 잘못된 fixture였으며 `{status:409}`로 고쳤다. 최초 로그를 별도로 보존했다.

타입·변경 파일 lint·스키마(47tables/17indexes/32runtime modules)·운영 빌드 통과. 독립 검수에서 새 query 행이 페이지 수집함 검사에 막히는 문제와 다른 회사 pending에 receipt가 기록되는 문제를 찾아 수정하고 실제 합성 재현/회귀로 확인했다. 남은 P1/P2는 보고되지 않았다.

새 D1에는 별도 CREATE TABLE IF NOT EXISTS 한 문장만 적용했다. Wrangler 파일 import API는 인증10000으로 실패했다. 기존 D1 쓰기 권한의 직접 SQL 방식으로 같은 문장을 적용해 성공했다. 파일 주석이 옵션으로 해석되던 첫 직접 실행은 실행 전 실패했고, 주석만 제거한 동일 DDL이 성공했다. 기존 상품·견적·접수 데이터 DML은0이다.

최종 Worker: `540713b3-f34b-43e3-b6ad-cb7f9a5f4d47`. CLI ZIP0.1.0 SHA256 `bb607679fe032a0735597e3a271bf275e2f2f684aa44d455120d9548393d6df4` 유지. 확장2.1.21 변경·새로고침 요청0. 공식 API 키·제공자·Access 설정 변경0. 새886034098637 원문·실상품 초안·Supplier Hub 실제 접수는 미검증이며 일반 live gates는 계속 false다. 이전1688 도구 경계를 CLI·새 저장 경로로 우회하지 않았다.

같은 Chrome3의 새 운영 탭에서 현재 계정, 활성화된 URL 입력/서버 수집함 버튼과 실제 GET 후 ‘저장된 서버 수집본이 없습니다’ 응답을 확인했다. 새 원문 POST·보관 PATCH는 운영에서 실행하지 않았다. 기존 상품2건과 대기열1건을 열거나 수정하지 않았다. 최종 화면과 AX는 `outputs/step790-release.png`, `outputs/step790-release-loaded.ax.txt`에 보관했고 운영 탭을 결과물로 남겼다. CLI·localhost·회사 조회의 임시 검수 탭은 정리했다.
