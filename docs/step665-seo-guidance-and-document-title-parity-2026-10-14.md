# Step665 — SEO 참고 메모와 견적 문서 상품명 분기

Step664 완료 상태에서 기록된 쿠플러스 SEO 입력과 견적 문서 호출 단계를 대조했다. 이번 구현은 blur한 메모의 현재 세션 유지와 수동 SEO 저장 이후 문서 상품명 분기에 한정한다. 운영 상품·쿠플러스 작업 자료는 수정하지 않았다.

## 근거와 구현 범위

기록된 UI chunk SHA-256은 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`, main SHA-256은 `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`다. 선택 원문은 실행하지 않고 메서드·호출자·상태 mutation을 정적으로 분석했다.

원문 범위·메서드 hash·관련 watcher와 이전 등록 호출자는 ignored `outputs/step665-seo-fields-audit/source-manifest.json`, `title-phase/source-manifest.json`에 있다. 참고 메모 REA parent `ev_8e9a17009e057dc9e4c5a48432308c2edcfb8d712d5a3c552093e3fff505d021`은 4파일 parse 실패 0/의미 미확정 281, title-phase parent `ev_1b6c886763b9f125a0d2a2a65b8a66c935164cc9c32fdda95b2edc62d9db1a82`는 1파일 parse 실패 0/미확정 142다. 전체 프로그램이나 비공개 서버를 모두 이해한 근거로 삼지 않는다.

확보한 브랜드·특징·타겟 blur 경계는 Vuex 상태를 갱신하며 관련 root watcher에 서버 autosave 호출은 없었다. initializeData는 특징·타겟 원문과 공란을 복원하지만 브랜드는 `(defaultBrand || product.brand).split(',')[0]`을 사용한다. 비어 있지 않은 기본 브랜드가 편집한 브랜드보다 우선한다.

견적 화면은 기존 coupangDoc을 복사해 읽고 저장하고 등록 호출자도 현재 문서를 전달한다. `convertToJsonDocument`의 한국어 옵션명 suffix는 문서가 없는 fallback 분기다. Step647의 converter 출력만으로 모든 기존 문서에 suffix가 붙는다고 해석하지 않는다. 정적 literal 검색은 동적 호출의 부재까지 입증하지 않는다.

## 참고 메모의 현재 세션 유지

새 `app/seo-guidance-session.ts`는 owner·product·정확한 원문 기준으로 cache와 현재 ticket을 관리한다. 원문 기준에는 수집 제목·설명·속성·출처·카테고리와 captured 브랜드·특징·타겟 기본값이 포함된다. productVersion만 바뀌면 raw 입력을 유지한다. 실제 원문 기준이 달라지면 이전 확정값과 미확정 입력을 초기화하고 기존 원문 변경 안내를 보여준다.

onChange는 raw 값을 유지하고 onBlur는 현재 scope·version·active 상태가 맞으며 요청이 시작되지 않았을 때 해당 필드 하나만 확정한다. 다른 미확정 필드는 cache하거나 clean으로 바꾸지 않는다. 특징·타겟 공란은 값의 존재 여부로 복원한다. 길이·문자 검증 실패도 입력을 지우지 않는다. 정상 blur 후에는 해당 필드를 세션 기준으로 삼아 닫기를 불필요하게 막지 않으며 다른 미확정 값은 dirty로 남는다.

같은 mounted 화면의 raw 브랜드와 생성 요청 memo는 그대로다. close/unmount 후 초기화 때만 captured 기본 브랜드의 첫 쉼표 구간을 우선하고, 기본값이 공란이면 확정된 세션 브랜드의 첫 구간을 사용한다. 초기 상품 모델에 없는 브랜드를 지어내지 않았다. owner＋product로 재마운트하고 Dashboard layout에서 계정 전환 시 이전 cache를 폐기해 A→B→A에 폐기된 입력이 되살아나지 않는다. 단순 닫기는 ticket만 해제하며 owner가 없으면 retention을 사용하지 않는다.

기존 초기 5 GET, 생성 승인·실행·명시 적용, request/sessionStorage 복구는 유지한다. 시작한 요청의 memo·source·operation 증빙과 `seo.description`, detail 본문, 수집 context, content/options는 메모 기능에서 바꾸지 않는다. blur가 API·DB 저장이나 provider·이미지 호출을 추가하지 않는다.

## 수동 SEO 저장과 문서 상품명

새 `app/seo-title-document.ts`와 내부 `ProductContent.seoTitleDocument`는 수동 상품명 또는 검색태그 저장에만 plain 상품명 정책을 생성한다. 합성 예시로 수동 공통 제목 `검정 장갑`을 저장한 기존 문서의 자동 제목은 그 값이며, 문서가 없는 fallback은 `검정 장갑, 기본형`을 유지한다.

`couplus-seo-save-v1` 증빙은 SEO 제목 값·필드 updatedAt·문서 값을 묶는다. 7단계는 형태·값·clock이 일치할 때만 사용한다. client의 직접 증빙 입력은 거부한다. description-only/option-only 저장에는 정책을 생성하지 않고, 이후 다른 writer의 제목·clock 변경이나 손상된 증빙은 기존 suffix fallback으로 돌아간다.

공란 unverified legacy 제목과 이를 사칭한 malformed 증빙은 알려진 product 제목을 지우는 정책으로 인정하지 않는다. 직접 저장한 제목 공란과 수동 견적 제목·공란은 보존한다. 옵션 원문·수동 SKU 입력·가격·포장·사진·라벨·본문은 다시 쓰지 않는다. AI writer·description/features metadata·SEO score·bundle suffix 전체 동일 구현은 이번 변경에 포함하지 않았다.

## 검사와 실제 Chrome 로컬 검수

최종 통합 **16파일 456/456 통과**, 실패·취소·skip 0이다. session/generator 56개와 새 문서 제목 12개가 포함되며 선행 36/145/328 실행을 다시 더하지 않는다. 타입 exit 0, 변경 11파일 lint exit 0/진단 0. 로그는 ignored `outputs/step665-final-tests.log`, `step665-types.log`, `step665-lint.log`다.

같은 바인딩의 기존 Chrome에서 실제 Generator의 로컬 GET-only 합성 화면을 검수했다. A01464742/와이홉과 A01526306/유앤채의 raw 끝 공백·명시 공란 blur, close/unmount→reopen, 기본 브랜드 우선, fresh source reset, A→B→A cache 폐기를 확인했다. 직접 두 회사에 로그인한 검증은 아니다.

native trace의 자료 요청 **35회 모두 GET**, providerCalls 0/productionAccess false/fixtureOnly true다. 운영 상품·공급사·AI 호출 0이며 `step665-native-proof-check.mjs`의 DOM·trace 대조 **27개 단언을 통과**했다. `step665-native-proof-report.json`, `step665-guidance-native-dom.json`, `step665-guidance-native-trace.json`, 실제 확인한 PNG `step665-guidance-native.png`(78,265 bytes)는 outputs에 보관했다. 자체 검수 탭·서버만 정리하고 기존 사용자 탭은 유지했다. 원문·비밀·outputs는 Git에서 제외한다.

## 배포와 다음 운영 검수

운영 bounded build와 배포 exit 0이다. 기존 vinext route classification 경고만 남았다. 기존 무료 Worker `sourceflow` Version **`5c721623-6e07-4f73-a5fc-c3f437bc8794`**, 주소 `https://sourceflow.jjwwhhjj1116.workers.dev/`. `outputs/step665-build.log`, `step665-deploy.log`에 기록했다. 기존 Worker·DB·R2·AI 바인딩만 사용했고 새 자원·migration·권한 변경은 없다. 앱과 문서는 함께 commit/push할 예정이며 커밋 본문에 자기 해시를 넣지 않는다.

Step660에서 실제 초과한 D1 Free row-read quota는 **2026-10-15 09:00 KST**에 reset한다. 이번 단계에서 운영 상품 읽기를 반복하지 않았고 관리 API·다른 DB·유료 플랜·Access 완화로 우회하지 않았다. 배포 성공은 운영 상품 완주 증거가 아니다.

`SINGLE_DOCUMENT_LIVE_VERIFIED`와 운영 mutation gate는 false다. 확장 prepared 0.2.72/마지막 확인 installed 0.2.64, 이번 변경·설치 없음. 다음 검수에는 실제 새 URL의 전체 SKU/이미지, 카테고리별 양식·기본값, Hub 동의→최종 등록→receipt/SKU 대조가 남아 있다. 기존 working product는 수정하지 않는다. 전반적 완성·Hub 최종 등록·전체 카테고리 동일성을 주장하지 않는다.
