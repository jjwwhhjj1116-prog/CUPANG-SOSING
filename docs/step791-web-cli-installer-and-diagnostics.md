# Step791 · 웹 CLI 설치 안내와 정식 npm 패키지

2026-10-22, 기준 `76aa1dca823a9178b467c0af856acea1463ec813`. 사용자 요청은 Couplus처럼 웹에서 PowerShell 설치·확인·실행·업데이트를 안내하고 배포 가능한 CLI를 제공하는 것이다. 별도로 Chrome ZIP 다운로드가 ‘조직에서 차단함’으로 표시됐고, 로컬 네트워크 안내는 없었다고 답변했다.

## 구현·배포 계약

- 대시보드의 ‘CLI 설치·연결’에서 native dialog를 연다. Windows/PowerShell과 Mac/터미널을 선택하고 Node.js 공식 링크, 설치 명령 복사, 설치 버전 확인, 실행, 종료·업데이트를 안내한다. `/cli`에서도 같은 안내를 사용한다. 설치 확인을 연결 성공으로 표시하지 않는다.
- npm 설치용0.1.1 TGZ와 bin `yoofam-studio`를 추가했다. start/serve는 foreground, Ctrl+C로 종료한다. status는 로컬 설치 버전·Node만 확인한다. 로그인 계정 상태 조회는 기존 승인된 브라우저 연결 뒤의 interactive status다. daemon/OS자동시작/service·postinstall script·외부 의존성은 없다.
- Windows는 npm.cmd/yoofam-studio.cmd 표준 shim을 안내하며 --ignore-scripts/no-audit/no-fund를 사용한다. 조직 정책, 실행 정책, 인증서 검사를 끄거나 모든 Node 프로세스를 종료하는 명령은 없다. 다운로드 차단을 우회하는 설치를 자동 실행하지 않는다. 조직 제한이 있으면 배포본의 허용을 요청하도록 안내한다.
- 앱 로그인 쿠키가 필요한 Worker 주소를 npm URL로 사용하지 않는다. 이미 공개된 사용자 저장소의 고정 버전 태그 `yoofam-cli-v0.1.1` 아래 자체 TGZ를 사용한다. 비밀번호·앱 쿠키·Cloudflare 토큰은 설치 명령에 없다. 브라우저 ZIP 차단 정책은 변경하지 않는다.
- 정식 TGZ13508bytes/SHA256 `4edf23d987e977e09babcc1ee48a150edd533ee59dd130d537182ec51cfea731`, ZIP41849bytes/SHA256 `ccdfe6a40e66ac6f5af6ecc8614c00e525def99ea21b3fdbe8806081d58e1053`. 배포 파일5개 allowlist·재현 가능한 archive·SHA manifest·latest alias와 --check를 검증한다.

## 연결 진단

이전 실패를 로컬 네트워크 권한 때문이라고 확정하지 않는다. 앱 로그인 회사 조회10초와 localhost 페어링30초를 분리한다. AbortSignal을 무시하는 fetch/body도 정해진 시간에 호출자에게 종료를 반환하고 늦은 pair 성공은 poll을 재개하지 않는다.

`?diagnostics=1`인 앱 검수 탭만 console에 단계·app/localhost 구분·결과·HTTP 상태를 기록한다. 기본 진단 출력은0이다. CLI --diagnostics와 로컬 diagnostics 명령은 요청0/OPTIONS만/pair 도착/거절/미완료 카운터와 최대64개 이벤트만 보관한다. 원본 URL·query string·Origin 값·본문·쿠키·토큰·세션ID·회사·회원은 기록하지 않는다. HTTP Host/Origin/token,15분TTL,네 읽기 도구,상품조회 기본OFF를 유지했다.

## 검수

고유5파일79/79 fail/skip/cancel0. 실제 localhost TCP와 실제 브리지, 강제deadline·늦은응답·진단정보비식별, 설치안내/정식패키지 버전 계약을 검증했다. 임시 prefix에 실제 npm --offline --ignore-scripts 설치 후 생성된 Windows .cmd 자체로 --version/help/status를 실행했다. 기기 전역 설치·원격 npm 설치·브라우저 정책 변경은0이다.

독립 검수에서 Unix npm symlink와 import.meta.url의 entry guard 불일치를 찾아 realpathSync로 수정했다. Windows 환경의 파일 symlink 권한은 EPERM이므로 정확한 argv→realpath 모델 분기를 확인했고, Unix/권한 있는 환경에서는 실제 symlink를 실행하는 검사가 있다. 실제 Mac 설치를 완료했다고 주장하지 않는다. 수정 후 TGZ/ZIP/manifest를 다시 생성했다. TypeScript·변경 파일 lint·패키지 무결성 검사가 통과했고 독립 재검수에 남은 P1/P2는 없다.

RS형 확장 수집 버튼 경로는 이 CLI 설치와 별개다. 이번 설치·진단 기능이 886034098637 실수집이나1~7단계 전체 UI 동일성, Supplier Hub 실제 접수 성공을 뜻하지 않는다. 기존 상품·대기열·견적서 수정이나 외부 제출은 실행하지 않는다.

## 실제 게시·Chrome 검수

공개 저장소 커밋 `b6088b8`과 태그 `yoofam-cli-v0.1.1`을 게시했다. 태그 TGZ의 무인증 HEAD는200/application/octet-stream/13508bytes였다. 파일 본문 원격 다운로드·원격 npm 설치는 실행하지 않았다. 최종 Worker `d33f31c0-2e27-4e39-971d-cf763ea8a50f`에 배포했다. 실제 화면에서 처음 발견한 dialog의 좌측 배치를 `position:fixed;inset:0;margin:auto`로 수정하고 중앙 정렬을 다시 확인했다. 설치창 열기·Windows/Mac 전환·복사 완료 UI·Esc 닫기·포커스 복귀를 확인했다. 브라우저 clipboard 도구의 readText는 공란이어서 OS 붙여넣기 내용까지 검증했다고 세지 않는다. 표준 Clipboard API의 writeText 완료 표시는 확인했다.

기존 Chrome3에서 승인된 유앤채/localhost/15분/상품조회OFF 범위의 새 임시 세션으로 읽기 연결만 다시 실행했다. 앱scope GET 두 번은 각각200(04:32:28UTC)으로 성공했고, 이후 localhost pair 단계가04:32:58UTC에30초 timeout으로 끝났다. CLI --diagnostics에서 이 Chrome의 HTTP 수신 이벤트는 관측되지 않았고 interactive status의 결과는PAIR_REQUIRED였다. 구체적 browser/OS/proxy 정책 원인은 확정하지 않았다. 설치 안내가 없다는 사용자 답변을 재차 허용 요청으로 돌리지 않았다. 임시 CLI를 종료하고 리스너0개를 확인했다.

운영 상품2건과 대기열1건을 편집·삭제·수집재실행·전송하지 않았다. 새 상품조회0, Supplier Hub 접수0. Chrome 조직 정책·권한·Cloudflare Access·DB schema·제공자 설정·확장2.1.21 변경0. 최종 증거는 outputs/step791-installer-final.png, step791-live-cli-diagnostics.json, step791-cli-failed.ax.txt 및 각 검사 로그다. 실제 연결 실패와 RS형 수집 버튼 경로를 혼동하지 않는다.
