# Step729 — 원문 수집 경계와 현재 CLI 실행·복구 계약

2026-10-19 KST. 대상은 사용자가 지정한 Couplus `AIRocketReg`다. 이번 질문은 “설치 CLI 안에 자체 1688 수집기가 있는가, URL 초안 구현에 사용할 실행·복구 계약은 무엇인가”로 제한했다. [Step705](step705-url-source-collection-parity-audit.md), [Step727](step727-rea-stage-contract-2026-10-19.md), [Step728](step728-whole-product-transport-2026-10-19.md)의 완료 분석을 재실행하지 않았다. 브라우저·네트워크·vendor 코드·인증 저장소·운영 상품은 사용하지 않았다.

## 결론

현재 **CLI 1.3.37을 설치하는 것만으로 독립 1688 원문 공급자를 복제할 수 있다는 근거는 없다.** 기존 UI 분석의 `POST /api/aiPage/getProductInfo → 구조화된 상품 원문 → 확장의 Hub 카테고리 양식 → 상품 저장 → 초기 SEO/가격` 경계는 그대로다. CLI의 현재 역할은 서버가 선택한 도구와 요청 recipe를 실행하는 것이다. 비공개 원문 공급자·키·캐시·응답·실제 처리 속도는 이 archive에 포함되지 않았다.

공식 archive SHA-256은 `9089561e73521ffea12e4be1a3abc6ffa70e2716ecdf121ee2464a4b4979b4f3`이고 package version은 `1.3.37`이다. 보관 manifest의 **JavaScript 51개 전체 bytes를 다시 hash 검증**했다. `1688`, `alibaba`, `getProductInfo`, `productSkuInfos`, `scrape1688`, `offerDetails`, `queryProductDetail` literal은 이 51개 파일에 없다. 이 제한된 문자열 부재는 동적으로 받은 도구·native binary·서버에 해당 기능이 없다는 증거가 아니다.

## 이번에 좁혀 확인한 현재 CLI 계약

다음은 실제 실행 관찰이 아닌 shipped source의 직접 관찰이다. `outputs/step729-rea-acquisition-proof.json`에 16개 함수의 UTF-16 범위, UTF-8 범위, 원문 slice SHA-256과 별도 inert TXT를 기록했다.

| 경계 | 정적으로 확인한 동작 | YOOFAM 재구성 시 의미 |
| --- | --- | --- |
| RPC와 recipe | `/api/cli/rpc`의 catalog/tool 명령과 `x-couplus-op`를 사용한다. 서버가 `http/coupang/local/page/tool` 요청을 선택한다. `requests[]`는 각 요청을 `await`하는 순차 실행이고 recipe loop는 400회 제한이다. | 이를 “1688 고속 동시 수집기”로 해석하지 않는다. 자체 웹에 서버 지시 임의 URL 실행기를 추가하는 것으로 원문 공급 문제가 해결되지 않는다. |
| 일시 오류 | catalog의 `readOnlyHint === true`인 도구만 transient RPC 오류를 최대 2번, 2.5초 간격으로 재시도한다. | 쓰기 ACK 유실을 같은 방법으로 재전송하면 안 된다. Step728의 불변 문서·접수 읽기 복구 경계를 유지한다. |
| HTTP 크기·시간 | 일반 HTTP 기본 제한은 35초·8 MiB이며 선택된 최대 응답은 16 MiB다. 누적 임시 blob은 16 MiB, recipe delay는 10초 제한이다. | CLI의 제한값이며 실제 1688 지연·용량·정상 응답을 입증하지 않는다. 대형 이미지와 상품 metadata의 실패를 구분해야 한다. |
| 화면 연결 | 가장 나중에 연결된 같은 screen의 SSE가 활성이다. 새 구독에는 pending job을 다시 전달하고 running job은 orphaned 목록으로 알린다. | 진행 중 작업을 새 화면에서 자동 재시작하는 계약으로 만들지 않는다. 원래 회사·요청·저장 상태를 먼저 확인한다. |
| 작업 시간 | 일반 dispatch 기본 10분, sync 60초, 지정 최대 30분. 완료 이력은 30분 뒤 정리하며 job 수는 최대 200, SSE heartbeat는 25초다. | job 완료와 Hub 접수는 다르다. UI의 완료 badge를 접수 ID로 대체하지 않는다. |
| 늦은 보고 | 밀려난 `subId`의 running 보고는 타이머를 재설정하지 못한다. 같은 `subId` 조건이 terminal 보고 전체를 감싸지는 않는다. | 외관·작업 패턴을 맞추더라도 자체 앱의 오래된 callback·요청/문서 hash 보호를 약화시키지 않는다. |
| 회사 미확인 분기 | `ensureScreen`은 가능한 companyid를 비교한다. 다만 완료된 open 명령 이후 연결된 화면이면 companyid가 없는 fallback을 허용하는 분기도 있다. | 사용자가 요구한 두 회사 분리를 위해 실제 business write는 명시적인 회사코드 일치를 계속 요구한다. 현재 Chrome의 회사를 추정해 바꾸지 않는다. |

등록 대기열은 회사별 scoped file과 lock·임시 파일 rename을 사용한다. 이 queue가 존재하거나 페이지 job이 done이라는 사실만으로 상품 원문 수집, 1~7단계 완성 또는 Supplier Hub 접수를 증명하지 않는다. 이 파일의 실제 사용자 내용은 읽지 않았다.

## Evidence와 한계

- 재사용 REA parent: `ev_52b98239bfe56a801d9d058e990d32437210dd220a36bdde5f9870620dd50530`. 기존 5개 선택 모듈의 static analysis다. 현재 MCP ledger에 retained record가 0건이어서 설치된 REA CLI의 `inspect-evidence-bundle`로 보관 bundle의 같은 parent 1건을 확인했다. producer 재실행은 0이다.
- 보관 bundle: `outputs/step725-current-cli/rea-evidence-bundle.json`. bundle 전체 SHA와 parent identity는 새 proof에 있다. 조회 결과는 `outputs/step729-rea-acquisition-rea-summary.json`이다.
- `page-channel.js`, `screen-command.js`, `registration-queue.js`의 새 함수 확인은 digest로 고정한 원문 정적 관찰이다. 이 세 파일까지 기존 REA parent가 분석했다고 주장하지 않는다.
- 이전 일반 URL/source/Hub 확장 계약과 네이티브 전송 Evidence는 위 Step705·727·728 문서를 재사용한다. 현재 UI main SHA는 `36a8e3252cba8096da3e9b06eaf3c338699dce35280a0080484a5c7181d20fb7`, route SHA는 `2fb15d370c331f65d982a886f2888b813ccae67277e87f806182c70032821664`다.
- 자체 원문 수집 서비스가 실제 정상 offer/SKU/원가/통화/MOQ/이미지 응답을 공급하는지, native 다중 옵션 약관·제출·접수·SKU join은 이번 분석으로 해결되지 않는다. CLI 설치 안내나 합성 fixture 검사를 그 실제 증거로 확대하지 않는다.

이번 담당의 앱 코드·테스트 수정, 브라우저·네트워크, vendor 실행, 운영 read/write, 기존 작업 상품 변경은 모두 0이다. 열린 REA native/runtime/browser 세션은 없다.
