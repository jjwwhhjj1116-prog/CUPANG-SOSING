# Couplus CLI 역할 정적 분석 — 2026-10-06

현재 우리 서비스의 **1688 상품 수집·Supplier Hub 견적서 첨부에 별도 CLI를 추가해야 한다는 근거는 없다.** 이 기능은 현재 Chrome 확장에 이미 있다. Couplus CLI의 핵심은 사용자의 PC에서 쿠팡 요청을 실행하고, 여러 계정의 세션·작업 상태를 보관하며, 웹 화면/확장과 AI 도구를 연결하는 로컬 에이전트다.

우리 **상품관리(신규)의 실시간 SKU·재고·가격 조회는 아직 없다.** 먼저 현재 로그인한 Chrome에서 필요한 데이터를 수집하는 범위를 정하고 확장을 확장하는 것이 맞다. 브라우저를 닫은 뒤에도 수집해야 하거나, 여러 계정의 독립 세션을 유지하거나, PC에서 직접 네트워크 요청을 실행해야 하는 요구가 확인되면 그때 별도 companion을 추가한다.

## 1. 관찰·배포물·실행 여부를 구분한 근거

| 근거 | 확인된 내용 | 확인 범위 |
|---|---|---|
| 실제 Chrome4 CLI 안내 화면: `outputs/couplus-reference-2026-10-06/08-cli.txt` 및 같은 이름의 스크린샷 | 연결됨, 연결된 버전 v1.2.12, 권장 버전 v1.3.24, 쿠팡 데이터 수집용 프로그램, 한 번 재설치한 뒤 자동 업데이트 안내 | 화면이 표시한 상태다. 로컬 서비스에 직접 요청해 확인한 상태는 아니다. |
| [공식 공개 배포 파일](https://www.couplus.co.kr/downloads/couplus-cli-latest.tgz) | `package/package.json`의 이름 `couplus-cli`, 버전 **1.3.24**, 설명 `couplus local agent`, 실행 진입점 `dist/index.js`, npm `postinstall` 스크립트 | 2026-10-06 다운로드한 최신 배포물의 정적 코드다. 연결된 v1.2.12의 구현이라고 주장하지 않는다. |
| 공식 배포물 `package/README.md:3,15–17` | 셀러 PC에서 Couplus 서버와 MCP 에이전트를 연결한다. Chrome 확장이 Couplus 로그인 세션을 전달하고, Couplus 멀티계정관리에서 쿠팡 계정을 저장한다. | 배포물의 사용 설명이다. |
| 우리 저장소 `extensions/supplier-hub/*`, 상품관리 API·DB 코드 | 현재 구현한 동작과 없는 연동 경로 | 소스 코드 확인이며, 이번 감사에서 확장 기능을 다시 실행하지 않았다. |

다운로드 크기 **12,302,247 bytes**; SHA-256 **`98106402185e46c925a34a9c655e0331f54d0b5ab78abb173a9d5599ff0387bd`**. 압축 내부 51개 파일, 펼친 파일 크기 합계 26,698,315 bytes. 공개 archive 사본은 `outputs/private-cli-audit/couplus-cli-latest.tgz`에 있다. 압축 내용을 디스크에 풀지 않고 tar reader로 선택한 JSON·텍스트만 읽었다.

**설치·npm hook·CLI·내장 실행 파일은 실행하지 않았다.** 프로그램 중지, 프로세스 종료, 로그인, 사설 API 요청도 하지 않았다. 사용자의 쿠키·Chrome 프로필·인증 데이터는 읽지 않았다. 배포물에 있는 프로필/세션 관련 코드는 동작을 설명하기 위해서만 정적으로 읽었다. CLI 안내 화면에 적힌 프로세스 종료 명령도 실행하지 않았다.

이하 정적 코드의 위치는 압축 내부 경로다. `dist/*.js`는 대부분 한 줄로 압축되어 있으므로 위치는 **UTF-8 디코딩 후 문자 오프셋**을 함께 적는다. 오프셋은 실행 추적이나 byte offset이 아니다.

## 2. 기능별 판정

| 질문 | 판정 | 정확한 근거와 한계 |
|---|---|---|
| 1688 수집을 CLI가 직접 처리하는가? | 공개 배포물에서 **전용 구현을 확인하지 못함** | 선택 가능 텍스트 전체에 `1688`·`alibaba` 식별자가 없었다. 단, 도구/레시피는 서버에서 받으므로 이름 부재만으로 원격 정의된 기능까지 없다고 단정할 수 없다. 우리 1688 수집은 확장에서 이미 처리한다. |
| Supplier Hub 파일 첨부를 CLI가 직접 처리하는가? | 공개 배포물에서 **전용 파일 첨부 구현을 확인하지 못함** | `upload`·`multipart`·`supplier.coupang` 식별자가 없었다. CLI에는 supplier 채널, 등록 대기열, 확장 화면 작업 중계가 있으나 이것이 파일 입력에 직접 첨부한다는 증거는 아니다. 우리 첨부 동작은 확장 `attach.mjs`에 있다. |
| 쿠팡 데이터 요청을 PC에서 실행하는가? | **예: 정적 코드 확인** | `index.js` `/execute`, `wing-*`, `keyword-search`, `option-sales`; `coupang-recipe.js`가 Couplus 서버에서 요청 레시피를 받아 `curl-executor.js`에 전달한다. `option-sales`는 product/item/vendor item 식별자를 가지고 서버와 단계별 조회를 진행한다. |
| 상품관리(신규) SKU·재고를 조회하는 특정 도구가 있는가? | **정확한 도구/endpoint 미확인** | 공개 코드에 `sku`·`stock` 식별자는 없었다. `/api/cli/tools/catalog` 및 서버 레시피를 받는 구조여서 SKU·재고 도구가 서버에서 정의될 가능성은 있지만, 사설 catalog를 호출하지 않았으므로 확인된 사실이 아니다. 화면의 「쿠팡 데이터 수집」 설명만으로 구체적인 SKU·재고 조회를 보장하지 않는다. |
| 쿠팡 계정 로그인 상태를 유지/구분하는가? | **예: 정적 코드 확인** | `account-store.js`, `account-jar.js`, `cookie-store.js`, `account-keepalive.js`; supplier·wing·advertising 채널의 세션과 소유자/로그인 상태를 계정별로 다룬다. 확장에서 전달된 세션을 이용한다. |
| Chrome 프로필을 찾아 화면을 열 수 있는가? | **예: 정적 코드 확인** | `browser-launch.js`는 Chrome·Edge·Whale 프로필과 Couplus 확장 설치 표시/로컬 확장 저장소를 기준으로 프로필을 선택하고 Couplus AI 등록 화면을 연다. 우리 감사에서는 실제 프로필을 읽거나 이 기능을 실행하지 않았다. |
| 별도 로그인 자동화도 있는가? | **예: 선택적인 shop 채널 구현** | `core/shop/login.js`는 저장된 shopping 계정 정보와 별도 Chrome 데이터 디렉터리를 사용하고, Playwright CDP 연결 및 로그인 폼 입력을 포함한다. Couplus 웹 로그인 세션 전달 및 seller 채널 세션과는 별도 경로다. 실제 계정 정보나 세션은 읽지 않았다. |
| 자동 시작/업데이트가 있는가? | **예: 정적 코드 확인** | npm postinstall이 Windows Startup VBS/macOS LaunchAgent를 작성하는 구현, 시작 및 24시간마다 최신 버전 확인, updater 생성과 재시작 구현이 있다. 지금 설치된 v1.2.12에서 이 동작이 실행됐다는 확인은 아니다. |
| MCP/AI 도구 지원인가? | **예: 정적 코드 및 README 확인** | `dist/mcp/server.js`, `dist/mcp/install.js`, `tool-catalog.js`, `tool-gate.js`, `tool-runner.js`. 상품 등록 웹 기능만 사용하는 우리 앱에 MCP가 필수라는 의미는 아니다. |

## 3. CLI가 맡는 실제 구조

**세션 중계와 여러 계정 관리.** 공식 README는 확장이 Couplus 로그인 세션을 CLI로 넘긴다고 설명한다. `index.js` 오프셋 15,100–16,500의 `/api/cli/cookies` 처리에는 계정 목록·계정 힌트·계정별 세션 저장 및 현재 계정 선택이 있다. 추가로 `/api/cli/account-jar`, `/api/cli/autocollect/jar`, `/api/cli/screen-command/jar` 경로가 있다. `account-keepalive.js` 오프셋 0–1,350 및 3,350–4,161은 supplier·wing·advertising 상태 확인과 첫 1분 이후 10분 간격 검사 구현을 보여 준다. 상태를 모를 때 바로 로그아웃으로 판단하지 않는 처리도 있다.

**서버 지시를 사용자의 PC에서 실행.** `coupang-recipe.js` 오프셋 0–931은 Couplus 서버의 `/api/recipe/{action}`에서 요청 레시피를 받는다. `index.js` 오프셋 26,200–29,800은 `/execute`에서 keyword 검색·리뷰·Wing 요청·옵션 판매량 조회를 실행하는 분기를 보여 준다. `tool-catalog.js` 오프셋 0–1,300은 계정 문맥을 전달하여 `/api/cli/tools/catalog`에서 도구 목록/정책을 받는다. 따라서 전체 데이터 수집 기능이 CLI archive에 고정되어 있는 구조가 아니다.

**화면 작업과 로컬 작업 중계.** `tool-runner.js` 오프셋 0–1,000 및 8,200–10,850은 `coupang`, `http`, `local`, `page`, `tool` 요청 종류와 화면 작업 dispatch/wait 처리다. `local-ops.js` 오프셋 0–1,450은 등록 대기열, 소싱 키워드/결과, workflow 파일 등의 로컬 상태 작업을 보여 준다. `page-channel.js` 및 `screen-command.js`와 함께 서버/에이전트 작업을 확장 화면에 전달하고 완료 상태를 기다리는 역할이다. 이 중계 기능과 Supplier Hub 파일 첨부의 실제 구현을 동일시하면 안 된다.

**맞는 브라우저 화면 복구.** `browser-launch.js` 오프셋 0–1,500, 2,200–5,200, 5,200–6,692는 브라우저 프로필 후보 탐색, Couplus 확장 설치/계정 표시를 이용한 선택, 동일 프로필에 `/AIRocketReg` 화면 열기, 3분 cooldown을 보여 준다. 별도의 새 로그인 프로필을 만들기 위한 일반 수집기로 볼 수는 없다. shopping 전용 로그인 경로는 별도로 존재한다.

## 4. 로컬 HTTP 서비스·origin·업데이트

| 항목 | v1.3.24 배포물에서 확인한 정책 | 근거 |
|---|---|---|
| 서비스 포트 | 기본 **9876**; `COUPLUS_CLI_PORT`로 지정 가능 | `index.js` 문자 5,500–6,700 |
| 서비스 bind | **127.0.0.1** | `index.js` 문자 34,350–35,900 |
| Host 검사 | 지정 포트의 `127.0.0.1` 또는 `localhost` Host | `core/daemon-auth.js` 문자 0–1,941 |
| 허용 웹 origin | `https://www.couplus.co.kr`, `https://couplus.co.kr`, `https://coupass.kr`, `https://www.coupass.kr`; localhost/127.0.0.1의 8080·8081·8082 | 같은 파일 |
| 확장 origin | 문법상 유효한 `chrome-extension://` 확장 ID origin을 허용한다. 특정 Couplus 확장 ID만 고정한 목록은 아니다. | 같은 파일 |
| origin 없는 요청 | local daemon token을 검사하는 경로가 있으며, `Sec-Fetch-Site: none`과 GET `/health` 예외도 있다. 단순히 모든 경로가 무인증이라는 뜻은 아니다. | 같은 파일; `index.js` 문자 11,600–12,850 |
| 일부 route 추가 제한 | autocollect lease/jar, account-jar, screen-command/jar는 확장 origin을 추가 검사 | `index.js` 문자 12,756–14,586 |
| CORS | 허용 origin만 응답 헤더로 반사; GET/POST/PUT/DELETE/OPTIONS, Content-Type, Private Network 허용 헤더 설정 | `index.js` 문자 5,500–6,700 |
| Windows 자동 시작 | Startup의 VBS가 CLI를 창 없이 실행하며, 설치 hook에서 그 VBS를 호출하는 구현 | `postinstall.js` 문자 0–1,650 |
| macOS 자동 시작 | LaunchAgents의 `com.couplus.cli.plist` 작성 구현 | `postinstall.js` |
| 업데이트 | 시작 시 및 24시간 간격으로 공식 latest-version endpoint 확인; 최신 공식 tgz를 대상으로 updater 생성; 설치·재시작 및 실패 횟수 제한 구현 | `index.js` 문자 33,250–35,900; `core/self-update.js` |

shopping 로그인용 Chrome 디버깅 포트는 별도 동적 포트다(`shop/login.js` 문자 4,470–5,320). 이것을 기본 HTTP 서비스 포트 9876과 혼동하지 않는다. 이 표는 정적 정책을 설명하며 실제 PC의 열린 포트·자동 시작 파일·업데이트 기록을 조사한 결과가 아니다.

## 5. 우리 확장이 이미 맡는 기능

현재 manifest 버전은 **0.2.52**다. `extensions/supplier-hub/manifest.json:3–13`에서 1688·Supplier Hub 호스트, tabs/scripting/webRequest 권한, 앱 origin content script를 확인했다. 쿠키 권한, Wing·광고센터 호스트 권한, 로컬 companion 주소는 없다.

| 기능 | 우리 구현 근거 | CLI 필요 여부 |
|---|---|---|
| 1688 원문 상품 정보 수집 | `capture-1688.mjs:98,108–118,121–141`: 모바일 전송 경로, 같은 Chrome 창의 상품 탭, JSON-LD 스크립트 읽기; `mobile-transport.mjs`, `mobile-public.mjs` | 현재 구현으로 가능 |
| 수집 취소·앱 문맥 확인 | `handoff-worker.mjs:5,48–52`; `capture-1688.mjs:51–63` | 현재 구현으로 가능 |
| 견적서·이미지·법정 서류 첨부 | `attach.mjs:41–45,101–104`: 검토된 payload의 파일 객체를 만들고 Hub 파일 input에 전달 | 현재 구현으로 가능 |
| 회사/탭/견적서 동일성 검증 및 접수 상태 관찰 | `company.mjs`, `hub-tab.mjs`, `validation-*.mjs`, `observe.mjs`, `result.mjs`, `receipt-recovery.mjs` | 현재 구현으로 가능 |
| 등록 결과 조회 및 복구 | `registration-*.mjs`, `app-registration.mjs`, `handoff-worker.mjs:9` | 현재 구현으로 가능 |
| Hub 카테고리·양식·템플릿 읽기 | `catalog*.mjs`, `schema-page.mjs`, `template-page.mjs`, `handoff-worker.mjs:10` | 현재 구현으로 가능 |

앱과 확장의 메시지 연결은 `handoff-content.js:2–10,103–109`의 앱 origin/요청 식별자 검사를 사용한다. 현재 구현은 열린 로그인 Chrome에서 필요한 작업을 수행하는 구조다. Couplus의 범용 세션 저장·서버 recipe 실행기·프로필 탐색을 그대로 추가할 이유는 없다.

## 6. 상품관리(신규)에서 실제로 남은 일

`app/components/managed-products-panel.tsx:6`에는 SKUID·바코드·노출ID·옵션ID·vendorItemId·productId·재고·판매가·공급가 등의 열이 있다. 하지만 `:28`은 `/api/managed-products` 저장 목록을 읽고 `:47`은 `/api/managed-products/import`로 파일을 보낸다. `app/api/managed-products/route.ts:1–18`과 `db/managed-products.ts:45`는 회사별 저장 데이터 조회 경로다. **쿠팡에서 최신 값을 가져오는 연동은 아니다.** 1688 옵션의 공급자 재고를 쿠팡 판매/입고 재고와 동일시해서도 안 된다(`app/product-options.ts:8`의 stock은 공급자 재고).

먼저 구현 범위를 정해야 하는 누락 기능은 다음과 같다.

1. 현재 로그인한 Supplier Hub 계정/회사와 상품관리 목록의 회사가 같은지 확인한다.
2. 허용된 화면에서 SKU·바코드·쿠팡 상품/옵션 식별자를 읽고, 우리 저장 행과 안정적으로 연결한다.
3. 쿠팡 재고·발주 가능 상태·판매가·공급가의 실제 읽기 위치와 단위를 확인한다. 수집 시각, 출처, 계정/회사, 미확인 상태를 함께 보관한다.
4. 검색/페이지 이동/중단/중복 요청을 제한한 읽기 기능을 만든다. 읽은 값만 갱신하고 수동 입력 및 원래 파일의 값과 구분한다.

현재 확장을 통한 **사용자 요청 시 읽기**를 우선 검토할 수 있다. 화면이 열린 상태에서 가능한 기능이면 네이티브 프로그램 설치는 필요하지 않다. 실제 페이지나 지원 API에서 어떤 값이 제공되는지 확인하기 전에는 CLI가 필요하다고도, 확장만으로 모든 값이 가능하다고도 확정하지 않는다.

## 7. 우리 companion을 도입할 조건

| 요구 | 판단 |
|---|---|
| 현재 Chrome에서 1688 수집·Supplier Hub 첨부·조회 | 기존 확장 유지/확장 |
| 열린 로그인 Chrome에서 상품관리 목록을 요청 시 새로 읽기 | 범위를 제한한 확장 수집 기능 우선 검토 |
| 브라우저가 닫혀도 PC에서 예약 수집을 계속 실행 | 항상 실행되는 로컬 worker가 필요한 요구인지 검토 |
| 여러 계정 세션을 독립 보관하여 화면 전환 없이 요청 실행 | 별도 세션 저장/계정 관리 요구이므로 companion 도입 후보 |
| 브라우저 문맥 밖에서 쿠팡 요청을 실행해야 함 | 실제 접근 방식과 지원 조건을 확인한 뒤 companion 필요성 판단 |
| AI 에이전트에서 로컬 도구/MCP 실행 | 상품관리 요구와 별개인 companion 도입 후보 |

companion을 만들더라도 우리 요구에 맞는 **회사별 상품 읽기 작업, 취소/상태 조회, 명시적 권한 경계, local service 식별과 인증, 설치·업데이트 상태 표시**부터 독립 설계한다. Vendor 구현을 복사하거나 Couplus 계정/recipe/MCP 체계를 재사용하지 않는다. 세션 내보내기·브라우저 프로필 탐색·저장 비밀번호 자동 로그인은 현재 우리 수집/첨부 요구에 포함되지 않는다.

## 8. 미확인 사항

- v1.2.12 실제 실행 프로세스의 코드·열린 포트·자동 시작 상태는 확인하지 않았다.
- 서버가 내려주는 최신 catalog, SKU/재고 recipe, 상품관리(신규)의 내부 API 매핑은 확인하지 않았다.
- Couplus Chrome 확장의 공개 배포물을 별도로 분석하지 않았다. CLI와 확장의 정확한 업로드 역할 분담은 CLI 코드만으로 확정하지 않는다.
- 현재 우리 확장이 실시간 상품관리 데이터까지 읽을 수 있는지는 해당 페이지의 읽기 가능한 값/권한을 확인한 뒤 결정해야 한다.

따라서 이번 결론은 **현재 기능의 중복 설치를 피하고, 상품관리의 실시간 데이터 수집 공백을 먼저 좁힌 다음 companion을 결정한다**는 것이다. Couplus CLI가 연결되어 보인다는 사실만으로 우리 서비스의 모든 기능에 네이티브 프로그램이 필수라고 판단하지 않는다.
