# Step713 — 1단계 SEO 신규 생성의 타겟 키워드 경계

2026-10-18 KST. 기준 `52aafc8e3dc71afc1dcfee784298aec4ee797e23`. Step662~667의 통합 저장·검색태그 정리·참고 메모·상품명 문서 연결을 재구현 대상으로 반복하지 않았다. 이번 질문은 기존 1단계에서 **새 SEO 생성 요청을 시작하는 정확한 입력 조건**이다. 보관 원문만 읽었으며 vendor 실행, 브라우저, 네트워크, 계정·기존 작업 상품 접근·변경은 모두 0이다.

## 정적으로 확인한 차이

원본 `canStartAiGeneration`은 `aiTargetKeyword.trim()`이 빈 문자열이면 false다. AI 생성 버튼의 disabled 조건과 `startAiGeneration` 메서드 내부 분기 양쪽이 이 값을 사용한다. 즉 공란이나 공백만 있는 타겟은 새 SEO 요청을 시작하지 않는다. 브랜드와 상품 특징은 같은 필수 조건에 포함되지 않는다. 생성 메서드는 허용된 경우 현재 브랜드·특징·타겟 메모를 갱신한 다음 SEO 서비스를 호출하고, 완료 결과에는 `initializeData`를 수행한다.

기준 자체 `SeoWorkspaceGenerator`의 생성 버튼과 `generate()`는 현재 원문·버전·진행 요청·적용 중 여부와 provider 설정을 확인하지만, 새 요청의 `memo.keywords.trim()` 공란 여부는 확인하지 않는다. 따라서 이 입력 경계는 실제로 남아 있는 차이다. 타겟 키워드와 상품명·검색태그 수동 저장은 다른 입력 범위이며, 타겟이 없다는 이유로 수동 편집을 막는 것은 원본 근거에서 나오지 않는다.

재구현은 **새 요청 생성 시점**의 버튼과 handler 모두에 같은 guard를 두는 것이 적합하다. 이미 보관한 요청의 상태 조회·유실 응답 복구는 현재 타겟 입력이 공란이어도 계속 허용해야 한다. 특히 재시작 후 과거 요청을 조회할 때 신규 요청 조건을 먼저 적용하면 복구가 막힌다. 현재 입력 원문을 지우거나 뒤 타겟을 추론하고, 공란에 임의 키워드를 넣는 방식은 필요 없다. 이는 자체 복구 설계에 대한 재구현 지침이며 원본의 비공개 복구 구현을 관측했다는 뜻이 아니다.

## 재사용한 근거

원본 UI chunk는 `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`, SHA-256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`다. 아래 범위는 UTF-16 코드 단위, 끝 제외이며 구간 SHA는 UTF-8로 계산했다.

| 범위 | 시작·끝 | SHA-256 |
| --- | --- | --- |
| SEO 렌더 | `[189560,195318)` | `302eb4efc52b0b608eda30d28e69e03b3dfac23a888bea55068bb0afefda5134` |
| processing 렌더 분기 | `[189590,189746)` | `e18e0ead32b58daaf5172b6d5b860fb10967964406a428c417ff6d6286710b51` |
| loading getter | `[195902,195935)` | `659b7dc522eb21c3ca945f7f346dc6d0d9f08990aac01cfe8d35628a96b059b8` |
| canStartAiGeneration | `[195987,196046)` | `02819dd4c58ca01f770a48ebd6ef79330dc43f08adee6c2086770a52e368b5af` |
| initializeData | `[196149,196800)` | `76c4eb1205afcd804b61589dd149cbaf4cfcdc09e511b4e828a3aa23a807ec30` |
| startAiGeneration | `[197919,198564)` | `c6928aa8ff8ee8467e792c023fa9caeb748bca1f7aa27763cd6e00de81c0dcf8` |
| saveSeoData | `[198565,200557)` | `d64e11c06db33017e8e91d24023592dad3d3fd9e6f78fb6ebdd39ce3df75cc42` |

설치된 REA의 `import_evidence_bundle`로 Step665 portable bundle 4 records를 검증해 재사용했다. 기존 parent Evidence는 `ev_8e9a17009e057dc9e4c5a48432308c2edcfb8d712d5a3c552093e3fff505d021`, 이번 module page는 `ev_e7c15edf09e2d9980bf1d74eaf5d46d2d93e0f9661a00f93f954a62d6a90fc2c`, 선택된 `01-seoInputs.js` module item은 `ev_50b27f0d6fcbb167b59aa7ed9aa191fd3442991822f96d7fe954cc65ffcc3a01`다. 비실행 선택 파일 SHA는 `3deff3d9e26057b58258ce83cc94c4c40d3ffffaf5d69ce2addc1f0e16710d5c`다. 새 원본 producer·연결 진단은 실행하지 않았다. exact 범위·내용 확인은 ignored `outputs/step713-seo-analysis-extract.mjs`와 manifest에 보관한다.

## 범위와 미확정 사항

원본 renderer는 `loading` 상태에서 AI 참고 메모·상품명/검색태그·옵션명·저장 버튼을 포함하는 편집 양쪽 전체를 spinner와 progressMessage 한 분기로 대체한다. `loading` getter는 Vuex `processing` 값이다. main의 `process` `[216283,217373)`는 시작 시 `setProcessing` true와 시작 문구를 dispatch하고 `finally`에서 false를 dispatch한다. source main SHA-256은 `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`, process 구간 SHA는 `e0f4351ea916216d25d29a1ec7ee293edf96ea12a516550219f8b8902348e35e`, 재사용한 기존 parent는 `ev_1983224a44e1100a435aca7caaa76ebb6e1d9df782252092d57dcc695765e8ee`다. 따라서 실제 생성이 진행 중인데 다른 절반의 수동 저장 폼이 계속 보이는 자체 분리 화면은 원본 표시와 다르다.

자체 재구현은 실제 생성·결과 적용의 source-bound 진행 신호를 parent로 올려 두 편집 영역의 표시·수동 저장 잠금을 함께 바꾸는 방식이 적합하다. 단순 초기 자료 GET이나 읽기 전용 복구 조회까지 같은 mutation 진행으로 보아 모두 숨기라는 근거는 없다. 진행 표현을 위해 편집 component를 unmount하거나 raw 입력·요청 복구 상태를 버릴 필요도 없다. 부모가 자식의 진행 신호를 되돌려 자식 완료 처리 자체를 막는 feedback lock은 피해야 한다.

이 원본 메서드의 관찰 범위에는 자체의 productVersion/contentRevision/source fingerprint/session lease와 같은 지문 보장이 없다. 원본이 늦은 결과·계정 전환·미저장 입력·응답 유실을 정확히 어떤 방식으로 방어하는지 여기서 입증하지 않았다. 자체 source-bound callback과 CAS는 입력을 잃지 않으면서 이 표시 동작을 복원하기 위한 재구현 설계다. URL 최초 수집 처리의 필수 입력이나 신규 상품 초기 실행 조건은 이번 조사 대상이 아니므로 이 타겟 필수 guard를 최초 URL intake로 확대하지 않는다.

이전 문서에서 남긴 SEO description/features/score 서비스 초기화는 UI나 7단계에 실제 어떻게 쓰이는지 이번 제한된 질문에서 입증하지 않았다. 이를 사용자 기능 누락으로 추정해 새 데이터를 만들지 않았다. `canSave`의 공란 제목 제한과 자체의 명시적 공란 보존 정책 차이도 이번 타겟 guard와 섞지 않는다. 실제 모델 결과, vendor 서버 저장·복구·원자성, 현재 live 화면, 전체 카테고리와 Supplier Hub 접수는 미관측이다.
