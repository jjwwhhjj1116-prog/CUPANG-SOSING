# Step792 · 신규 초안 이미지 복구와 CLI 권한 실측

2026-10-22. 신규 검증 대상은 886034098637이며, 기존 운영 상품 두 건과 기존 대기열은 편집·삭제·전송하지 않았다.

## 반영한 동작

서버 수집본으로 새 상품을 만든 뒤 이미지 일부 저장이 실패하면, 해당 오류 행에서 ‘누락 원본 이미지 이어받기’를 연다. 수집 요청·상품·URL·원문 저장 시각이 정확히 연결된 한 건만 대상으로 한다. 서버가 반환한 상품 ID를 확인한 뒤 저장하지 못한 원본만 자료함에 추가하며, SEO·옵션·대표·상세 이미지 배치를 재작성하지 않는다. query 수집본으로 일반 기존 상품을 다시 덮어쓰지 못하는 보호 조건은 유지했다.

이미지 저장 API의 회사 검증 누락도 수정했다. 단일·묶음 저장 모두 다운로드 전후, 파일 저장 후, 재사용 응답 전에 인증 계정과 수집 당시 회사를 재확인한다. DB의 최초 이미지 연결은 수집 문맥의 정확한 payload와 현재 승인 회원의 회사·역할·이메일을 조건으로 묶는다. 같은 transaction의 동반 쓰기 중 조건이 바뀌어도 전체 연결 작업을 rollback한다. 회사 기록이 없는 진짜 legacy의 기존 owner-only 계약은 유지하고 오늘의 회사로 backfill하지 않았다. 파일 저장 도중 회사가 바뀌면 새 파일 객체가 남을 수 있지만 상품·옵션·이미지 참조에는 연결하지 않는다.

## CLI와 REA

REA로 보관한 Couplus CLI·웹 배포물의 연결을 재대조했다. 웹은 localhost HTTP/SSE 작업 채널을 사용하며 상품조회 서버는 별도다. PNA 헤더 누락이 우리 실패 원인이라는 근거는 없었다. native EventSource로 바꿔 기존 Bearer 인증을 제거하지 않았다. 근거 parent는 `ev_ea88968fbc8f601c8da726e20b791a00f5031911de8c1f420406eb8cf62c5202`; 선택 파일·archive·범위 해시는 `outputs/step792-rea-transport-proof.json`에 있다. 정적 분석이며 원본 서버 내부나 전체 CLI 복제 완료를 의미하지 않는다.

YOOFAM CLI 0.1.2는 기존 IPv4 loopback 바인딩을 유지하면서 정확한 localhost:동일포트 Host만 추가로 지원한다. 웹에서 연결 전 표기를 명시적으로 선택할 수 있다. 공개 고정 태그 `yoofam-cli-v0.1.2`는 `6d8cf76`이며 이전 태그는 변경하지 않았다. TGZ 13,614bytes/SHA256 `58eec677508effbcbd4756f2dc52487283907c80c11a1ae23ec051ddfbf751df`, ZIP 42,061bytes/SHA256 `62da232e53cb9f8f44138f0cafb208129c0b302326e1b64073431e05dc802438`. 공개 TGZ HEAD는200이었다. 원격 설치·조직 다운로드 정책 변경은 하지 않았다.

브라우저의 `loopback-network` 권한을 읽기 전용으로 확인한다. 구형 combined permission 조회는 사용하지 않는다. 정확한 granted/prompt/denied만 표시하고, API 미지원·오류·시간 초과는 차단으로 단정하지 않는다. 명시적인 denied 또는 안전하지 않은 문맥에서는 페어링 버튼과 호출을 막는다. [Chrome 공식 안내](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/security/local-network-access.md)를 참고했으며 권한 요청·설정 변경을 자동 실행하지 않는다.

## 실제 Chrome와 검수 경계

승인된 유앤채·15분·상품조회OFF 범위에서 127.0.0.1 연결을 재검수했다. 앱 회사 조회 두 번은200이었고 pair는30초 timeout, CLI 수신은OPTIONS를 포함해0이었다. 최초 권한 조회는prompt였지만, 최종 배포의 새 문서에서 읽고 다시 확인한 상태는 **denied**였다. 이 때문에 localhost 실연결 비교는 실행하지 않았다. 누가 언제 권한을 바꾸었는지와 이전 timeout의 구체적인 원인은 확인되지 않았다. 차단 상태를 우회하지 않고 사용자에게 해당 사이트의 Chrome 권한 확인 동작을 요청했다. 임시 CLI는 종료했다.

합성 신규 상품은 실제 React 화면·API·SQLite로 검수했다. 이미 저장한0번은 건너뛰고1·2번만 assignToStage:false로 저장했으며 보호 상품, 수동 SEO·이미지 필드, 옵션이 그대로였다. 이 검수는 실제 1688/Hub/AI 공급자 요청을 하지 않았다. 증거는 `outputs/step792-recovery-final.ax.txt`, `step792-recovery-proof.json`이다.

지정한 886034098637의 실제 수집본은 확보하지 못했고 새 실상품 초안·실제 Supplier Hub 접수도0이다. 앞선 1688 사이트 안전 거절을 CLI·확장·서버로 우회하지 않았다. 현재 도구의 관측 제한과 앱 수집기 자체 실패를 혼동하지 않는다. 사용자에게 직접 확장 수집 버튼을 눌러 새 수집본을 담는 동작을 요청했다. 전체1~7단계 UI 완전 동일성과 실접수 완료를 이번 합성 검사·빌드로 인정하지 않는다.

관련 고유24파일289개 검사가 통과했다(CLI107, 이미지 복구/수집132, 회사 보호/이미지50; 중복 재실행 제외). 회사 보호는 메모리에만 수정 전 코드를 넣은 음성 대조에서 원래 문제가 다시 발생하고 현재 코드에서 차단되는 것까지 확인했다. TypeScript·변경 파일 lint(error0, 기존 테스트 warning4)·패키지 무결성·운영 빌드·독립 검토를 통과했다. 운영 D1 schema·상품 DML·확장 버전·Cloudflare Access·보안 정책 변경은0이다.
