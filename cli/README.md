# YOOFAM 스튜디오 CLI

Node.js 22.13 이상에서 실행하는 로컬 연결 프로그램입니다. 런타임 외부 의존성과 설치 시 실행되는 스크립트가 없습니다. 기존 Chrome과 YOOFAM 로그인 세션을 사용하며 비밀번호, 로그인 쿠키, Supplier Hub 인증 정보를 CLI로 복사하지 않습니다.

## 웹에서 설치하고 실행하기

YOOFAM 스튜디오 웹의 **CLI 설치** 안내에서 Node.js LTS를 설치한 뒤 PowerShell을 새로 엽니다. 같은 화면의 **설치 명령 복사**를 눌러 실행하면 `@yoofam/studio-cli` 패키지가 설치됩니다. 웹에 표시되는 정식 배포 주소를 사용하세요. 아래의 주소 자리에는 그 화면의 주소가 들어갑니다.

```powershell
npm.cmd install --global --ignore-scripts --no-audit --no-fund "<웹에 표시된 YOOFAM CLI 패키지 주소>"
yoofam-studio.cmd --version
yoofam-studio.cmd status
yoofam-studio.cmd start
```

현재 패키지 버전은 **0.1.2**입니다. `status`는 설치된 패키지와 Node.js 버전만 확인합니다. 서버 실행 여부나 YOOFAM 로그인 상태를 조회하지 않습니다. 앱 연결을 확인하려면 `start`로 실행한 뒤 출력되는 연결 주소를 현재 Chrome에서 여세요. **실행한 PowerShell을 열어 두어야 하며 Ctrl+C로 종료합니다.** 백그라운드 서비스나 자동 시작 항목을 설치하지 않습니다.

`npm.cmd`와 `yoofam-studio.cmd`는 Windows용 명령입니다. macOS에서는 각각 `npm`, `yoofam-studio`를 사용합니다. `start`와 `serve`는 같은 명령입니다. `yoofam-studio --help`로 명령을 확인할 수 있습니다.

업데이트할 때는 실행 중인 YOOFAM CLI의 터미널에서 Ctrl+C를 누르고, 웹의 최신 설치 명령을 다시 실행한 뒤 버전을 확인하고 `start`로 시작합니다. 다른 Node.js 프로그램을 강제로 종료하지 않습니다. 삭제는 `npm.cmd uninstall --global @yoofam/studio-cli`입니다.

브라우저에서 조직에 의해 다운로드가 차단되었다면 조직의 배포 정책을 확인해야 합니다. 이 패키지는 해당 차단을 해제하거나 브라우저·PowerShell 보안 정책을 변경하지 않습니다.

## ZIP 또는 소스에서 실행하기

```powershell
node cli/bin.mjs start
```

웹에서 받은 ZIP은 `cli/` 폴더를 포함합니다. 압축을 푼 뒤 `cli` 폴더가 보이는 상위 폴더에서 위 명령을 실행하세요. 이미 `cli` 폴더 안에 들어왔다면 `node bin.mjs start`를 사용합니다. 기존 `node cli/yoofam-studio.mjs serve` 실행도 지원합니다.

출력되는 연결 주소를 **현재 로그인한 Chrome**에서 여세요. YOOFAM에서 현재 계정·회사 확인 후 연결 버튼을 눌러야 명령을 실행할 수 있습니다. 연결 주소에는 메모리에만 보관되는 일회성 토큰이 있어 공유하면 안 됩니다. 주소는 브라우저 해시에 담겨 서버 요청·리퍼러로 전달되지 않으며, 앱은 읽은 직후 해시를 제거합니다. 15분 후 프로그램을 다시 실행해 새 연결을 사용하세요.

연결 후 같은 터미널에서 다음을 입력합니다.

```text
status
query https://detail.1688.com/offer/123456789012.html
categories
job 11111111-1111-4111-8111-111111111111
quit
```

`query`는 앱에서 상품 조회 허용을 선택해야 실행됩니다. CLI는 작업명과 검증된 상품 URL만 앱에 전달합니다. 외부 사이트 요청은 앱의 고정된 상품조회 API가 처리하고, 응답의 실제 상품 정보만 결과로 돌려줍니다. 이 읽기 연결만으로 상품 생성·편집·견적서 전송이 실행되지 않습니다. 원문이 확보되지 않으면 성공으로 표시하지 않습니다.

`--port 49832`로 포트를 바꿀 수 있습니다. `--allow-local-dev`를 명시하면 `http://localhost:3000`, `http://127.0.0.1:3000` 두 개발 Origin도 허용합니다. 호스트는 항상 `127.0.0.1`이며 외부 LAN 접속은 지원하지 않습니다. Ctrl+C는 대기 작업을 취소하고 서버를 종료합니다. 자동 브라우저 실행·Chrome 프로필 변경·자동 시작 서비스 설치는 하지 않습니다.

연결 실패를 진단할 때는 `yoofam-studio start --diagnostics`로 실행할 수 있습니다. 기본값은 꺼짐이며 비밀값을 제외한 전송 단계만 표준 오류(stderr)에 출력합니다. 실행 중인 터미널에 `diagnostics`를 입력하면 메모리에서 집계한 로컬 진단 정보를 확인합니다. 상품 본문이나 비밀번호·쿠키·토큰을 수집하지 않습니다.

## 표준 입출력

```powershell
yoofam-studio.cmd start --stdio
```

첫 줄은 `notifications/connectionReady` JSON-RPC 알림이며 로컬 호출자에게 연결 주소와 만료 시각을 제공합니다. 이후 JSON Lines 입력을 받습니다. MCP `initialize`, `ping`, `tools/list`, `tools/call`, `notifications/cancelled`를 지원합니다. 도구는 `status`, `product-query`, `category-profiles/list`, `collection-job/status` 네 가지 읽기 명령만 제공합니다.

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"status","arguments":{}}}
```

또는 일반 JSON Lines를 사용할 수 있습니다.

```json
{"id":"lookup-1","command":"product-query","payload":{"sourceUrl":"https://detail.1688.com/offer/123456789012.html"}}
```

HTTP에는 작업 추가 경로가 없습니다. 작업 추가는 같은 프로세스의 표준 입력 또는 `createCliServer().enqueue()`만 허용합니다. 임의 URL, 앱 경로, JavaScript, 셸 명령, 상품 수정·전송 명령은 거절합니다.

## 브라우저 연결 프로토콜 1.0

모든 요청은 정확한 `Host: 127.0.0.1:<port>`, 허용된 `Origin`, `Authorization: Bearer <64 hex token>`이 필요합니다. 앱 로그인 쿠키는 루프백 요청에 보내지 않습니다.

`expiresAt`, 작업의 `createdAt`, `deadline`은 모두 **Unix epoch 밀리초 숫자**입니다. ISO 날짜 문자열이 아닙니다. 앱은 `Date.now()`와 비교해 만료·취소 여부를 판단합니다. 연결 URL의 해시 키는 `port`, `token`, `session`이며, HTTP JSON/쿼리에서는 `sessionId`를 사용합니다.

| 경로 | 입력 | 동작 |
| --- | --- | --- |
| `POST /pair` | `{sessionId,scope:{ownerId,company:{code,name}}}` | 계정·회사 연결 |
| `GET /next?sessionId=...&waitMs=25000` | 없음 | 최대 25초 대기 후 `{ok,job:null\|{jobId,command,payload,scope,createdAt,deadline}}` |
| `POST /result` | `{sessionId,jobId,scope,ok:true,result}` 또는 `{...,ok:false,error:{code,message}}` | 현재 작업 결과 접수 |
| `POST /abort` | `{sessionId,jobId,scope}` | 현재 작업 취소 |
| `POST /disconnect` | `{sessionId,scope}` | 연결 해제와 모든 대기 작업 취소 |

회사 코드는 유앤채 `A01526306`, 와이홉 `A01464742` 두 회사만 허용합니다. 연결 후 회사나 계정이 바뀌면 현재 세션에 결과를 넘길 수 없습니다. 같은 회사라도 계정 ID가 다르면 별도 연결입니다. 앱은 작업 전후에 현재 로그인 컨텍스트를 재확인합니다.

연결 종료는 해당 토큰과 세션을 즉시 영구 폐기합니다. 기존 연결 주소로 다시 연결하거나 다른 회사로 재사용할 수 없으며 HTTP 410으로 거절됩니다. CLI를 종료 후 다시 실행해 새 토큰·세션의 연결 주소를 사용하세요. 같은 계정·회사로 `/pair` 응답을 잃었을 때만 동일한 연결 요청을 다시 확인할 수 있습니다.

최대 대기 작업 16개, 동시에 전달되는 작업 1개, 기본 작업 제한 60초, JSON 본문 최대 8MiB입니다. 완료·취소·시간 초과 작업에 늦게 도착한 결과와 중복·순서가 바뀐 결과는 거절합니다. 토큰은 RAM에만 보관하며 파일·환경변수·로그에 저장하지 않습니다. 실제 상품 URL과 응답을 진단 로그로 복사하지 않습니다.
