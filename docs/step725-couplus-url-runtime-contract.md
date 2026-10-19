# Step725 — URL 추가의 실제 경계와 재구현 우선순위

부모 담당의 현재 화면 확인: 같은 Chrome4의 `yooandchae` 계정에서 새 검수 탭의 빈 대기열만 사용했다. 상품추가 → 카테고리 검색/선택 → 빈 1688 링크·특징·키워드 행까지 확인했고, 만든 빈 행을 제거해 대기열 0건을 복원했다. URL 입력·전체 시작·상품 생성·기존 상품 열기·설정 저장·등록전송·동의는 실행하지 않았다. 기존 사용자의 작업 탭은 변경하지 않았다. 화면과 코드를 대조한 기록은 `outputs/step725-original-live-form-proof.json`, `step725-original-category-picker-ax.txt`, `step725-original-url-entry-ax.txt`, `step725-original-empty-queue-restored-ax.txt`다. 스크린샷은 CDP 캡처 시간 초과로 얻지 못했으며 성공한 캡처로 기록하지 않았다.

이 작업의 앱 실행 코드는 변경하지 않았다. 실제 URL 수집부터 등록 완료까지 검증했다는 기록도 아니다. 원문 공급 계층과 별도로, 자체 Single packet은 준비된 전체 포함 옵션에서 선택 옵션 한 개를 보내는 제한이 남아 있다. 원본의 그룹당 전체 배열/문서 한 개 계약과 정확히 맞추려면 단일 옵션 packet·본문 해시·현재 자료 대조·접수 기록의 단위를 함께 변경해야 한다. Step724의 `step724-original-option-document-contract.md`와 이번 원본 대조를 기준으로 하며, 단순 길이 검사 삭제나 실제 접수 미확인 상태의 완료 처리로 대체하지 않는다.

2026-10-19 KST. 기준 `8c018be85d3d93914a34e9ee829d10a53f5a4e68`. 사용자의 요청은 원문 자료를 대신 제출하는 절차가 아니라, 로그인된 쿠플러스의 구동방법을 분석하고 YOOFAM PLUS에 같은 사용 흐름을 구현하는 것이다. 이번 담당은 이미 보관한 원본 클라이언트와 현재 자체 수집 경계를 비교했다. 기존 상품·기본설정·운영 자료를 읽거나 변경하지 않았으며, 거절된 1688 URL에 재접근하지 않았다.

## 원본에서 이미 확정된 구동 순서

1. 사용자가 상품추가 행에서 카테고리를 확정하고 URL을 입력한다. 행에는 선택 code/path와 URL이 유지된다. 이 시점에 상품 원문이나 견적 문서가 이미 만들어진 것은 아니다.
2. 일반 추가의 `handleAddProduct`는 URL에서 offer 번호를 추출해 **자체 서버 `/api/aiPage/getProductInfo`에 `[{productId:<숫자 offer ID>}]`를 POST**한다. 응답의 `data.result[0].result.result`가 원문 상품 객체다. category/company는 이 요청 body에 없다.
3. 클라이언트는 받은 원문을 보관한 뒤 `GET_PRODUCT_INFO` 확장 메시지를 보낸다. 이 메시지는 원문/번역 제목·특징·키워드·회사코드·선택 카테고리 code/path를 전달한다. 기존 확장 handler의 역할은 **Supplier Hub 카테고리 schema와 `docId:null` 문서 골격**을 가져오는 것이다. 일반 추가의 1688 수집기가 이 확장 메시지라는 주장은 틀리다.
4. 현재 요청의 `PRODUCT_INFO_RESPONSE`에서 `createResult`와 `rocketRegInfo.schemaString`을 확인한 다음, 원문과 양식을 `createProductObject`에 함께 넘긴다. 옵션·원가·이미지 후보·속성·회사 기본설정·선택 카테고리를 조합해 `saveItems`에 저장한다.
5. 저장 성공 envelope를 받은 뒤 최초 작업은 **SEO → 가격**이다. 최초 상품에 사진 후보와 견적 기본 골격이 있다는 것과 대표/추가/상세 편집·번역, 한글표시사항, 견적 검수, 등록전송이 모두 끝났다는 것은 다르다. 원본도 후속 전체 작업과 개별 편집을 별도로 제공한다.

위 내용은 Step705·715·717·720의 같은 **이전 보관 UI652** 원본을 재사용한 정적 구문 관찰이다. 문서 제목의 `runtime`은 실제 새 상품 실행을 뜻하지 않는다. 부모 담당은 현재 같은 Chrome4의 상품추가가 대기열과 상품추가/SEO+가격/작업/전송 목표를 제공하고 기본 목표는 SEO+가격인 것을 직접 확인했다. 이전 UI 원본 분석을 최신 브라우저 구현 전체의 실행 증거로 확대하지 않는다. 빠른 UI 응답과 외부 수집원 내부 동작은 여전히 실행 미관측이다.

## 현재 자체와 다른 핵심 두 경계

**첫째, 원문 공급 계층의 동등성은 아직 입증되지 않았다.** 원본은 일반 추가부터 자체 구조화 상품 서버에 요청한다. 현재 자체 `collectionProvider`의 기본 경로는 PC JSON-LD와 모바일 공개 상품 원문이며, 별도 배포 설정이 있을 때만 자체 소유 자격증명의 공식 API 후보를 선택한다. 자체 `/collect`도 서버에서 실제 수집 후 검증·저장하므로 URL 입력이라는 사용자 패턴은 같다. 그러나 공개 페이지 fallback을 원본의 private 상품 서버와 같은 원천·속도·성공률이라고 부를 근거는 없다. API 후보가 있다는 사실도 쿠플러스가 같은 공식 API를 사용한다는 증거가 아니다. 원본 서버의 공급자·자격증명·캐시·재시도·비용·실제 응답은 이 클라이언트 밖이다.

따라서 가장 중요한 후속은 자체의 실제 원문 공급원이 정확한 offer ID, 상품명, 실제 SKU/옵션명, CNY 원가, 최소 주문, 갤러리/상세를 공급하는지 검증하고 이 결과를 현재 `/collect → immutable receipt → 초안`에 연결하는 것이다. title/headline 가격만으로 SKU와 가격을 만들어 성공 처리하거나, 사용자가 자료 저장 경로를 모르면 원래 URL 기능을 제공하지 않는 구조로 대체할 근거는 없다. 쿠플러스의 인증된 private endpoint를 자체 무료 backend로 재사용하거나 그 비밀을 복사하는 것도 이번 구현 범위에 없다.

**둘째, 배송 참고 원문은 현재 정규 결과에 없다.** 원본은 `productShippingInfo`를 상품에 보존하고 뒤 견적 AI 참고자료에 전달한다. 현재 자체 `CollectionResult`와 `parseAlibabaProduct`에는 이 원문 객체가 없다. 이 차이는 Step706에 이미 기록됐고 이번에 새 결함으로 중복 집계하지 않았다. 원본의 배송 미확인 fallback 수치나 추정 prompt는 실제 단품 포장 무게·치수의 증거가 아니다. 추후 정당한 원문 응답에서 단위·SKU 관계가 확인되면 bounded 원문 보존과 명시적 단위 매핑을 추가할 수 있지만, 지금 임의 숫자를 채워 실제 접수까지 진행하는 근거로 삼지 않는다.

초기 SEO/가격과 후속 이미지·표시사항·견적을 연결하는 순서는 이미 구현되고 단계별 로컬 검수 중인 별도 범위다. 이번 비교에서 이를 다시 처음부터 구현해야 할 새 누락으로 판단하지 않았다. 저장 ACK·회사/category/source identity·수동 공란·완료 이미지 보호는 원본보다 엄격한 자체 경계를 유지한다. 원본의 약한 requestId 처리나 선행 local badge 변경을 복제해 실제 저장·접수 확인을 약화하지 않는다.

## CLI·확장을 잘못된 수집 원천으로 연결하지 않기

보관 CLI 1.3.24 archive는 동적 원격 도구 카탈로그 계층을 포함한다. Step705의 bounded 정적 탐색에서 일반 `getProductInfo`나 1688 수집 구현을 이 archive에서 확인하지 못했다. CLI 설치 여부만으로 원본의 서버 수집기를 복원했다고 할 수 없다. 확장에는 별도 구형 페이지 reader도 있지만 일반 AI상품추가가 호출하는 서버 경로와 다르며, 보관 reader의 부분 SKU 상태만으로 현재 전체 가격·MOQ·identity 계약을 만들어내지 않는다.

## 근거·정확한 범위

원본 UI는 `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`, SHA-256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`다. 범위는 UTF-16 start-inclusive/end-exclusive이며 raw slice hash는 UTF-8이다.

| 원본 경계 | 범위 | slice SHA-256 |
| --- | --- | --- |
| handleAddProduct | `[409883,410740)` | `2c08c174d1abb501f2b04228f11a9799af78f94f77887b531077ba13f52cdada` |
| requestProductInfoFromExtension | `[410741,411765)` | `d68bf7c9e8a1ae5589f3f56415c76e539e13f4263529323cf5fd6d83164997df` |
| answerProductInfoFromServer | `[411766,412547)` | `7e72aae28a53852bd8bbbd31d2a8fcc1f749ab61bffde0e31f517fdf0e866b72` |
| PRODUCT_INFO_RESPONSE branch | `[414581,417234)` | `897aa22a2946fa3a670a8be43e4b827a3afaefbedf96da7e82c7a6c9fbfc0ebf` |
| createProductObject | `[436576,441156)` | `d359e61ea580bfcdead25cbecbbcb27390a41394bd3ee7b6238a04f74a4e3e53` |
| runInitialProcessing | `[441157,442908)` | `9e1ab8af2d5ad2bd10bccbf19bdf3230cf38109f76f52227fc82c8711a2ade15` |

현재 MCP 연결의 같은 parent retained record는 0개였다. 원본 분석을 반복하지 않고 보관 portable bundle을 **REA `inspect-evidence-bundle` summary**로 재조회해 parent `ev_cd515dbbeab22000b72ee021eb669326d3fa3695cede4a815ccd90c6966e239a`가 실제 존재하는 것을 확인했다. bundle SHA는 `e9bf40d30f95e7235d37b6d4dbf63ade4cb9a74725443d5a759ace527c961c41`, 선택 대상 directory SHA는 `087bc9ca06125903677f89ce83642131984c4aa7dae34957c7c5766b76cbe2db`다. 이 parent의 scope는 응답 branch 하나이며 outer Vuex·서버·전체 app 실행은 여전히 미확정이다.

카테고리 행 연결은 재사용 parent `ev_031002beee6d4de040b6b091d765d7ecae06affbb798dec64f5d4c46af65ad05`와 Step717 manifest, 옵션/배송 소비는 Step705·706의 동일 source-bound 범위, 상태 구분은 Step720을 참조한다. 이 기록을 새로운 producer Evidence나 새 원본 실행으로 세지 않는다.

`outputs/step725-url-original-proof.mjs`는 정확한 원본 bytes·여섯 slice·보관 parent·현재 자체 파일 7개의 SHA와 구문 경계를 확인하고 `outputs/step725-url-original-proof.json`을 만든다. 이 **이전 UI 재사용 부분**의 원본/vendor 실행·브라우저·네트워크·운영 read/write·기존 상품 변경·새 분석 producer는 모두 0이다. 아래 최신 CLI 취득·분석은 별도 실행 수로 구분한다.

## 추가 확인 — 현재 공식 CLI 1.3.37도 원격 recipe 방식

부모 담당이 현재 Chrome4의 CLI 화면에서 설치 1.3.36/최신 1.3.37과 공식 다운로드 URL `https://www.couplus.co.kr/downloads/couplus-cli-latest.tgz`를 직접 확인했다. 이번 담당은 **그 URL의 압축파일을 GET 한 번만** 실행했다. package script·postinstall·CLI·브라우저·원격 도구는 실행하지 않았다. 설치된 CLI를 업데이트하거나 세션·계정·기존 상품을 변경하지 않았다.

새 archive는 9,170,840 bytes, SHA-256 `9089561e73521ffea12e4be1a3abc6ffa70e2716ecdf121ee2464a4b4979b4f3`, package.json version **1.3.37**이다. 57개 archive entry의 경로가 package/ 아래이며 traversal이 없는 것을 확인했다. JavaScript 51개와 package.json/README, 총 53개 텍스트 파일만 추출했다. native TLS binary 3개는 목록만 확인했고 추출·실행·분석하지 않았다.

신규 구현은 이전 archive의 고정 catalog endpoint보다 한 단계 더 원격화되어 있다.

- `remote.js`는 `/api/cli/rpc`에 bootstrap 요청을 보내 `ops` map을 받은 뒤, logical `catalog`/`tool` operation을 `x-couplus-op` 헤더 값으로 변환한다. 도구명은 `x-couplus-op-arg`다. 실제 ops 값은 서버 응답으로 정해진다.
- `tool-catalog.js`의 logical `{op:'catalog'}` 요청은 회사·supplier 범위와 세션이 연결된 catalog를 가져오고 tools/version을 확인한다. 실제 catalog body·권한·동적 도구명은 실행하지 않았으므로 미관측이다.
- `tools/server.tools.js`는 빈 배열이다. registry가 catalog의 도구를 찾으면 `tool-runner.serverTool(name)`으로 실행기를 만든다. 1688 전용 도구 목록을 archive 안에 고정해두는 방식으로 관찰되지 않는다.
- `tool-runner.js`는 logical `{op:'tool',arg:<이름>}`에 phase:start/params/identity/runner capability를 보내고, 서버 응답의 request 또는 requests를 수행한 뒤 n/state/response를 돌려보내는 generic 단계 실행기다. 지원 종류는 `coupang`, `http`, `local`, `page`, `tool`이다. `done:true`/result, 오류, detached 작업을 별도로 처리한다. 어떤 1688 요청·parser·provider를 사용할지는 이 정적 archive로 확정하지 못했다.

JavaScript 51개 전체의 bounded literal 검색에서 `1688`, `alibaba`, `getProductInfo`, `productSkuInfos`, `scrape1688`, `offerDetails`, `queryProductDetail`은 0개였다. 이는 명시 literal의 부재이며 동적 이름·서버 recipe·native 내부에 모든 관련 동작이 없다는 증명은 아니다. 최신 CLI를 확보했다고 자체 URL 원문 수집을 해결했거나 원본 provider를 복원했다고 주장하지 않는다. 최신 원본도 원격 server recipe와 로컬 generic 실행기의 경계를 구분해야 한다는 근거다.

새로 바뀐 artifact를 대상으로 필요한 다섯 JS 파일만 REA 분석했다. parent **`ev_52b98239bfe56a801d9d058e990d32437210dd220a36bdde5f9870620dd50530`**, summary `ev_624545dd6422e3465c8f003e646857db31cd6939a4f99b5b834d330d76d629d3`, 선택 directory SHA `f8de028a82013ec566604aa502be6a4159aa4647fd03ad5f5815e0b2f9fed9e0`다. 5파일/43,124 bytes/AST12,184/parse failure0이고 semantic unknown **2,895**가 남는다. 외부 모듈을 선택 범위에 넣지 않아 import 해석과 실제 실행은 제한된다.

선택 module asset view는 remote `ev_3a4dad06d89917a9cde39668c3c3d5e14eceda12c34e1d6fe788aa73139f0fea`, runner `ev_f392131cf70fb0092c71af34383a1f16b350da141e07249cadfabfc8e008907c`, catalog `ev_ce0edd355a95c7d10f5f684fbfee6f5a597925d5978bf96f7c70aa4825315684`다. 처음 고른 같은 경로의 module entry 두 개는 unresolved require 역할이었고, 전체 identity page에서 **javascript-asset** 역할을 골라 다시 읽었다. 경로만 같다고 require 노드를 전체 source 분석으로 오해하지 않았다.

| 새 source 계약 | UTF-16 범위 | raw slice SHA-256 |
| --- | --- | --- |
| remote bootstrap f | `[596,909)` | `17f10ce1d65d4700575ff47c1c349e8110bf0ca8908d54d972696c14efb50b4d` |
| remote op-header h | `[909,1135)` | `16e9f5e810b2b593e48d1e31196fdf5658302bc01ae7ed66235a957b61d3cd49` |
| remote postJson g | `[1135,1325)` | `e57a02ce580846acb2e2e28ca2e215239a56113167900185862ab3d22e929cb5` |
| catalog request g | `[720,1285)` | `97caf3e7dcdd7b8ec56c8f7d306f925977bf36ae36b86ef5efd37ab7b7177f8c` |
| runner request dispatch be | `[14509,14942)` | `d34eba2ac60bba50113d4e30ebb90f23b5ad24a97bf7649e51321312c7129193` |
| runner remote step loop _e | `[16403,18308)` | `6ca3b03d5ad677bc2fcaa1131d5d8823bb059c313ed7d749b10032040c9b9138` |
| runner serverTool Pe | `[19755,19893)` | `0c7ae704b6dfe81939f916a7acdc0b93e69fbd7fb9a0ccef6352a630db24dee1` |

파일별 SHA·전체 11개 함수 범위·byte 범위·literal 검색·선택 scope·실행 수는 `outputs/step725-current-cli/proof.json`에 있다. portable REA bundle은 `outputs/step725-current-cli/rea-evidence-bundle.json`, SHA `e191fa6cb3869e8d8fca4a4974a3d82deb7ea0e6e82e299cae246d04e6297cc6`다. 이번 **최신 CLI 부분** 실행은 공식 archive GET1·새 static producer1, vendor code0·설치0·postinstall0·runtime requests0·브라우저0·운영 쓰기0·기존 상품 변경0이다. 실제 새 상품 원문·수집 속도·현재 UI의 모든 단계 동등성·Hub 접수·최종 SKU 확인은 별도 미완료로 남긴다.

## 추가 확인 — 현재 로그인 화면의 main·AI상품등록 route 대조

부모 담당이 같은 Chrome4 DOM에서 script와 prefetch 주소만 보관한 `outputs/step725-live-script-dom.json`을 사용했다. 현재 main은 `main.a878a60f.js`이며, main의 `AIRocketReg` 라우트는 component D에 연결된다. D는 cd19167a/4a5f46a6/36123f1a 세 chunk를 의존성으로 로드하고 entry module `901f`를 선택한다. 실제 DOM의 loaded script와 prefetch가 모두 **`chunk-36123f1a.155d5b9e.js`**를 가리킨다. 이 실제 주소의 main과 leaf 두 파일만 내려받았다. chunk 이름을 추측하거나 나머지 의존성·모든 prefetch 파일을 받지 않았다.

- 현재 main: 582,447 bytes, SHA `36a8e3252cba8096da3e9b06eaf3c338699dce35280a0080484a5c7181d20fb7`.
- 현재 route: 553,821 bytes, SHA `2fb15d370c331f65d982a886f2888b813ccae67277e87f806182c70032821664`.

**현재 source에서도 일반 URL 수집 계약은 그대로다.** `handleAddProduct`, 확장 handoff, 서버 handoff, 상품 객체 생성, 견적 초기화 다섯 메서드의 raw slice SHA가 이전 보관 원본과 정확히 같다. 따라서 자체 getProductInfo 서버 원문 조회 → 같은 회사/category 양식 연결 → 새 상품 저장이라는 분석은 이 다섯 현재 메서드에도 직접 적용된다. 현재 실제 XHR 응답이나 private provider를 관측했다는 뜻은 아니다.

| 현재 route 메서드 | UTF-16 범위 | raw SHA 비교 |
| --- | --- | --- |
| handleAddProduct | `[410467,411324)` | 이전 `2c08c174…2cdada`와 동일 |
| requestProductInfoFromExtension | `[411325,412349)` | 이전 `d68bf7c9…64997df`와 동일 |
| answerProductInfoFromServer | `[412350,413131)` | 이전 `7e72aae2…e866b72`와 동일 |
| createProductObject | `[437160,441740)` | 이전 `d359e61e…4e3e53`와 동일 |
| initializeCoupangDoc | `[445121,449150)` | 이전 `0b7c3e36…f16eae`와 동일 |

추가로 `processNextQueueItem`, `runInitialProcessing`, `processOptions`는 raw hash가 다르지만 변경은 선택한 helper alias `Bt→Gt`, `Vt→Wt`, `zt→Ht`를 치환하면 **전체 메서드 문자열이 정확히 동일**하다. 초기 task helper의 import는 양쪽 모두 literal module `66e4`다. 이를 확인한 source 변경 범위에서 새로운 원문 공급자·새 가격 산식·최초 전 단계 자동 완성을 발견한 것은 아니다. 이 비교를 전체 의존 모듈 실행 동등성으로 확대하지 않는다.

현재 queue의 기본 목표는 **level2 SEO+가격**이다. level1은 상품추가, level3은 작업개시, level4는 등록전송이다. 전체 큐가 끝나면 level3 이상 상품만 `autoFullProcess`에 넘긴다. level4는 별도 상태·문서가 준비된 대상의 `verifyProducts`를 호출한다. 같은 등록번호 계열이 옵션 분리로 추가됐는데 함께 선택되지 않으면 `_queueSubmitBlocked`로 자동 전송을 보류하는 분기도 있다. **URL 추가 기본값으로 실제 Hub 등록까지 끝내는 구조가 아니다.** 사용자가 요청한 수동 수정 뒤 명시 전송 흐름과 자동 목표 선택을 구분해 구현해야 한다.

### 현재 기본설정·가격 산식 대조

이 질문에 관련된 기존 선택 메서드 15개를 현재 main/route에서 찾아 비교했다. 12개는 raw 문자열이 그대로이며, 나머지 3개는 가격 helper `Z→it`와 표시사항 helper `X→st`의 이름 변경만 치환하면 정확히 같다. 해당 import module ID는 각각 `48cd`, `c7d5`로 같다. 선택 범위에서 새 기능 변경은 **0개**다. 버전 파일 hash가 바뀌었다는 이유만으로 가격·기본설정의 새로운 동작을 추정하지 않는다.

| 현재 근거 | 범위 | raw SHA-256 |
| --- | --- | --- |
| main getDefaultPricingInfo | `[163461,163595)` | `d1649af30dc32d9a47df9b707d37c3b4acfc727c772b47f9f524d8a5f3b2d874` |
| main calculatePricing | `[164142,166051)` | `b2dfcb25080ebe5131abc543131dddd6f27e46fa2ddfad653c809acf49d9c442` |
| main pricing resolve | `[296210,297038)` | `3f81b7e2942f5fabdc2969c32ae6e7cf4e6b8993f7ff9e40f2e31e269523fd6c` |
| route initializeSettings | `[313789,314921)` | `f51db4eb14d358460d2cf9b30346b113dc6be86983c03ca4c9fe6eea5ad91911` |
| route saveSettings | `[315429,318374)` | `b24251f8973c99ae2387852bf17d062ec0f8ab942ca2cd618722c5216a0a1516` |
| route applyDefaultSettings | `[460195,465227)` | `09bbc96a570f0a975d3a1bef5ae6c41f337ac73758822f004c2b377ecee38584` |
| route pricingInfo | `[172209,172647)` | `f658fbc535371c67c40237c8f3811d09a089c877aa653187613a361b7b89df57` |

초기 가격은 비율 계산 후 최소 마진 하한 보정, 명시 가격 편집은 켜짐 여부와 최소액을 분리한 경로라는 이전 Step695/716 결론을 유지한다. 현재 초기 `calculatePricing`·정책 `resolve`의 raw가 같고, 명시 `recalculateOption`도 helper alias 치환 외에는 같다는 근거다. 이 감사에서는 이미 반영한 산식을 다시 바꾸거나 과거 상품을 현재 기본설정으로 덮지 않는다.

최신 UI source 비교는 `outputs/step725-current-ui/proof.mjs`가 자동 검증했으며, source SHA·8개 intake 메서드의 전체 raw 범위/hash·alias 치환·15개 가격/설정 비교·route 해석·goal 근거는 `outputs/step725-current-ui/proof.json`에 보관했다. 원본을 실행하거나 새 분석 producer를 반복하지 않고, 변경된 입력 bytes와 앞선 REA source-bound 계약을 좁혀 대조했다. 이 **현재 UI 부분** 실행은 공식 asset GET2, 원본 code 실행0·installed CLI0·브라우저0·실제 원문 수집 요청0·Hub 요청0·운영 쓰기0·기존 상품 변경0이다.

### CLI recipe가 이미 파일로 저장되는지에 관한 한계

분석한 최신 CLI 다섯 파일에서 catalog는 Map과 5분 TTL, RPC ops는 Map과 10분 TTL, runner job은 메모리 Map/종료 후 만료 관리로 나타난다. 이 다섯 파일 안에서 catalog/recipe를 파일에 쓰는 writer나 그 저장 경로는 확인하지 못했다. registry의 파일 읽기는 bundled tools 디렉터리 목록이다. 이것을 CLI 전체에 캐시/로그가 없다는 결론으로 확대하지 않는다. 인증·config·cookie·token 파일, 사용자 홈의 다른 자료나 기존 로그는 읽지 않았다. 원격 catalog/recipe를 새로 실행하거나 그 결과가 없다는 이유로 backend 분석 자체가 불가능하다고 단정하지 않는다.
