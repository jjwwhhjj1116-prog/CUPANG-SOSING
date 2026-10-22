# YOOFAM 스튜디오 CLI

Node.js 22.13 이상에서 별도 의존성·전역 설치 없이 실행하는 로컬 연결 프로그램입니다. 기존 Chrome과 YOOFAM 로그인 세션을 사용합니다. 비밀번호, 로그인 쿠키, Supplier Hub 인증 정보를 CLI로 복사하지 않습니다.

```powershell
node cli/yoofam-studio.mjs serve
```

웹에서 받은 ZIP은 `cli/` 폴더를 포함합니다. 압축을 푼 뒤 `cli` 폴더가 보이는 상위 폴더에서 위 명령을 실행하세요. 이미 `cli` 폴더 안에 들어왔다면 `node yoofam-studio.mjs serve`를 사용합니다.

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

## 표준 입출력

```powershell
node cli/yoofam-studio.mjs serve --stdio
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
