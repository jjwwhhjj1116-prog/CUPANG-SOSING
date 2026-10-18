# Step691 — 공개 개발 스킬 확인과 REA 6.5.0 실제 적용

확인일: **2026-10-18, Asia/Seoul**. 기존 운영 상품·공유 Chrome 탭·로그인·전송 데이터는 변경하지 않았다. 이 문서의 REA 결과는 보관된 클라이언트 코드의 정적 분석이며 실제 사이트 실행이나 Supplier Hub 접수 결과가 아니다.

## 확인한 공개 도구와 적용 판단

| 공개 자료 | 이번 작업에서 유용한 부분 | 적용 결과 |
| --- | --- | --- |
| [REA 최신 릴리스 6.5.0](https://github.com/morluto/rea/releases/tag/rea-agents-6.5.0) | 정확한 JavaScript 파일 선택, 분석 증거 보존·요약·페이지 조회 | 프로젝트 내부 독립 CLI로 설치하고 실제 보관 코드에 적용했다. |
| [REA 릴리스 고정 스킬](https://github.com/morluto/rea/blob/3b79af28e80785afce9f5998d8f03289402a1847/skills/reverse-engineer-anything/SKILL.md) | 대상·증거·관찰/추론/미확인을 분리하고 기존 분석을 재사용 | 설치 패키지의 일치하는 bundled skill과 JavaScript 안내를 읽고 적용했다. |
| [OpenAI 공개 스킬 목록](https://api.github.com/repos/openai/skills/contents/skills/.curated) | playwright, playwright-interactive, cloudflare-deploy 등 개발·검수 후보 확인 | 기존 도구를 대체할 필요와 사용자 Chrome 제약을 먼저 대조했다. 목록에 있다는 사실만으로 설치하지 않았다. |
| [OpenAI Playwright](https://github.com/openai/skills/blob/main/skills/.curated/playwright/SKILL.md) | 브라우저 검수 CLI | 현재 로그인된 Chrome을 보존해야 하므로 새 브라우저 경로로 전환하지 않았다. 기존 CUA 검수를 계속 사용한다. |
| [OpenAI Playwright Interactive](https://github.com/openai/skills/blob/main/skills/.curated/playwright-interactive/SKILL.md) | 기능·화면 검수를 같은 요구 목록으로 관리 | 현재 지침에 별도 js_repl 설정과 sandbox 비활성화 요구가 있어 실행 절차를 채택하지 않았다. 전역 설정·보안 모드를 변경하지 않았다. |
| [Anthropic webapp-testing](https://github.com/anthropics/skills/blob/main/skills/webapp-testing/SKILL.md) | 로컬 웹 검수·스크린샷의 일반 절차 | 예시가 headless Chromium을 새로 실행한다. 로그인된 기존 Chrome에서 작업하라는 사용자 제약에 맞춰 해당 브라우저 경로를 사용하지 않았다. |
| [OpenAI cloudflare-deploy](https://github.com/openai/skills/blob/main/skills/.curated/cloudflare-deploy/SKILL.md) | Cloudflare 제품·배포 절차 후보 | 기존 Wrangler 배포·환경 검사 흐름이 이미 있어 별도 전역 스킬이나 계정을 추가하지 않았다. |

REA의 공개 최신 릴리스 API는 `rea-agents-6.5.0`, 게시 시각 `2026-10-14T12:32:45Z`, 대상 commit `3b79af28e80785afce9f5998d8f03289402a1847`을 반환했다. 릴리스 본문의 변경 기록 날짜 `2026-10-13`과 게시 시각을 구분했다. 조회일에 새 릴리스가 나왔다고 표현하지 않는다. [공식 최신 릴리스 API](https://api.github.com/repos/morluto/rea/releases/latest)

## 실제 설치·실행 범위

설치 위치는 `outputs/rea-6.5.0`이다. Node/npm·기존 REA 6.4.0 MCP·사용자 전역 스킬·MCP 등록·기존 Codex 설정은 변경하지 않았다. 버전 확인과 CLI 도움말은 성공했다. Node **v24.19.0**은 패키지의 Node 24 최소 조건을 충족한다. 설치에는 lifecycle script를 실행하지 않았으며, JavaScript 분석 성공이 모든 선택적 네이티브 provider의 설치·작동을 의미하지 않는다.

```powershell
& 'C:/Users/7500F/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' `
  'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js' install `
  --prefix outputs/rea-6.5.0 --ignore-scripts --no-audit --no-fund `
  --cache outputs/npm-cache rea-agents@6.5.0

& 'C:/Users/7500F/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' `
  outputs/rea-6.5.0/node_modules/rea-agents/scripts/rea.mjs --version
```

결과는 `6.5.0`이다. 최초 npm 생성 manifest의 `^6.5.0`은 독립 폴더의 manifest/lock root 모두 `6.5.0`으로 고정했다. 실제 설치된 lock 레코드도 정확히 6.5.0이다. npm에서 173개 패키지를 설치했으며 기존 앱의 package.json/lock에는 의존성을 추가하지 않았다.

공식 npm identity:

- tarball: `https://registry.npmjs.org/rea-agents/-/rea-agents-6.5.0.tgz`
- integrity: `sha512-C6BG7LyrAdR74mSjertM6PrxJkcNZ2bfQNOJornPo9erDEp2tyPRVYPnV5Yodr+1RqewCQla68WulXlVnveD+A==`
- 독립 package lock SHA256: `a95301789f3b00a28f366b59a090082a0dd0a12e05579120ffb0fdca83bb0ba3`
- CLI entry SHA256: `526105418604cc6e5a202a6275b700814e27450bfaffd45e7510530ba669de8d`
- bundled skill SHA256: `3456aab99d48c3294726065c9d5bd586bc165f2849fd5a3d5080381630564715`

기존 설치 스킬의 metadata는 version37/tool_count170, 새 독립 패키지 bundled skill은 version42/tool_count207이다. 이는 스킬 메타데이터 비교이며 현재 연결된 MCP 도구가 207개로 바뀌었다는 뜻이 아니다. **현재 세션의 등록 MCP는 기존 6.4.0을 유지하고, 새 6.5.0은 검증한 독립 CLI로 사용한다.**

## REA를 이번 구현 근거에 실제 적용한 기록

분석 대상은 이전에 보관한 Couplus 옵션 처리 method 하나다. 전체 웹앱 또는 운영 상품을 실행하지 않았다.

- 원본: `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`, 553,312 bytes, SHA256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`.
- 기존 추출 범위: UTF-16 `[466662,469077)`, 원문 조각 SHA256 `4a5671380c795a5b6e598bc3abfcdf54cb66318a62119f43478964ee68b0e3f0`.
- inert class wrapper: `outputs/step660-intake-rea-selected/03-processOptions.js`, 2,531 bytes, SHA256 `7ce56d2c6afdeefff4691bb422334787c8d256c27b7138e5703a38b2d5ac1da9`.

```powershell
& 'C:/Users/7500F/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' `
  --max-old-space-size=256 outputs/rea-6.5.0/node_modules/rea-agents/scripts/rea.mjs `
  analyze-javascript-application `
  'C:/Users/7500F/Documents/Codex/2026-09-14/new-chat/work/CUPANG-SOSING/outputs/step660-intake-rea-selected' `
  --source-path 03-processOptions.js --max-heap-mb 128 --analysis-timeout-ms 30000 --json
```

실행 exit0. 분석은 **선택한 파일 1개**, text bytes2,531, AST558, parse failure0이다. 나머지11개 파일은 identity inventory만 보존하고 분석하지 않았다. semantic graph는 nodes281/relations254/unknowns231로 **partial**이다. parse failure0을 전체 의미·실행 경로 검증으로 확대하지 않는다.

| 기록 | Evidence ID | 출력 파일 SHA256 |
| --- | --- | --- |
| REA 6.5.0 실제 정적 분석 | `ev_5869fb5a1a6ec67485ac76e74414a221ecb4eb7a035d0344c07e66b28c7bcec2` | `d6d3c61f5dc1776166b051263a61a5bc1453973250066ad36a3acb6b5f556c8d` |
| 같은 완전 Evidence를 public inspect-analysis-view로 요약 | `ev_40f57053660d6ff48348b5af5719c9cd3a761514c4acbf5cdeb4b62b7cadf68a` | `a8315b793759985d01168cbbbfaa75225d79b661d6a2412b6a521e1f3b51038a` |

출력은 각각 `outputs/step691-rea650-process-options-evidence.json`과 `outputs/step691-rea650-process-options-summary.json`에 보관했다. 요약은 producer를 다시 실행하지 않고 완전 inline Evidence를 입력해 만들었다. 설치·artifact·출력 identity와 한계는 `outputs/step691-rea650-toolchain-check.json`에 별도로 남겼다.

### 이번에 구현으로 연결할 구체적인 차이

**정적 관찰:** vendor `processOptions`는 `productSkuInfos`가 없거나 길이가0이면 즉시 실패하지 않는다. 상품 전체의 원문/번역 제목, 판매 재고, 첫 기본가격, 첫 대표사진 및 전체 사진으로 기본 옵션 하나를 만들고 가격 계산 경로로 넘긴다. SKU가 존재하는 분기와 구분된다. 보관 원문과 새 REA 분석은 같은 artifact identity를 사용했다.

**구현에 대한 결론:** 실제로 완전한 상품 기본정보를 받은 단일 옵션 상품은 SKU 배열이 없다는 이유만으로 거절하지 않는 것이 이 클라이언트 패턴에 맞다. 반면 API 미응답·차단 화면·가격/재고 누락을 성공한 상품으로 만드는 근거는 아니다. 변경 구현과 API·저장 경로 검증은 다른 담당 범위에서 진행한다.

**미확인:** vendor 서버가 이 branch에 도달할 응답을 실제로 반환하는 빈도, 숨은 API 정책, provider·가격 계산의 내부 실행, 실제 1688 수집 성공 및 Supplier Hub 최종 접수는 이 정적 분석으로 증명되지 않는다. 이 문서를 전체 동일 구현 완료나 실제 견적 접수 완료로 사용하지 않는다.

## 계속 유지할 개발 방식

REA는 화면을 한 번에 완전 복사하는 도구가 아니라, 실제 shipped artifact와 실행 기록을 근거로 동작을 좁혀 확인하는 도구다. 이미 보관한 증거를 재사용하고 필요한 method만 선택 분석한 뒤, 관찰된 입력·출력 차이를 앱 변경 및 격리 검수로 연결한다. 이번에는 최신 CLI를 설치하는 데서 끝내지 않고 단일 옵션 처리의 누락 branch를 확인하는 데 사용했다. 새 브라우저·공유 탭·기존 상품 변경·차단 URL 우회·전역 설정 교체는 수행하지 않았다.
