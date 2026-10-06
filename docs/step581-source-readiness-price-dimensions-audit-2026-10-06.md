# Step581 원문 준비·가격·치수 감사 — 2026-10-06

**실제 공개 원문 조회:** 15:37:42 KST(`2026-10-06T06:37:42.834Z`), Node에서 현재 수집 함수로 1688 상품 `813724060928`을 읽어 옵션 6개·이미지 URL 19개·속성 24개·설명 0자를 확인했다. provider는 `1688-public-mobile-v1`, `collected:true`였다(`outputs/step581-live1688.json`). 운영 DB·기존 상품·R2·UI 쓰기는 0건이며, 이미지 바이트·OCR·번역·브라우저 확장 수집·Hub 접수 완료의 확인과 구분한다.

확장이 없거나 원문 수집 기능을 지원하지 않을 때도 45초 수집 기한까지 기다리던 경로에 PING 확인을 먼저 넣었다. 로컬 모의 시간 시험에서 응답 확인 기한은 2초이며 실패·미지원·취소 시 수집을 시작하지 않는다. 정상 PING 뒤의 원문 수집에는 기존 45초 기한과 같은 창·요청 ID·취소 보호를 유지한다. 이는 실제 Chrome의 응답 시간이나 확장 로드 성공을 측정한 결과가 아니다.

**가격 불일치 수정:** 설정 행과 상품별 가격 정책이 없는 기존 상품은 가격 창·견적서에서 10원 반올림을 쓰지만 옵션 API는 예전 100원 올림을 사용했다. 양사 실제 API·임시 SQLite 재현에서 25.6 CNY, 상품 환율 350·공급 마진 50%·쿠팡 마진 40%의 옵션 API 값은 공급 18,000원·판매 30,000원·MSRP 39,000원으로, 화면·견적의 17,920원·29,870원·38,830원과 달랐다. 설정 입력이 생략된 경우에만 `newWorkspaceSettings`를 선택하도록 공통 resolver를 수정했다. 명시적으로 저장한 빈 객체·부분 레거시 설정의 누락 필드 규칙, 상품별 저장 정책 우선순위, 상품 환율·마진은 유지한다. 저장된 설정·상품을 다시 쓰거나 가격 산식을 바꾸지 않는다.

가격 회귀는 실제 Dashboard 정책 함수·PriceEditor·설정/옵션/견적 API·견적 내보내기를 대조했다. 포함/제외 옵션과 3개 묶음, 원문·사용자 입력, 수동 공급가·명시적 MSRP 공란을 보존하고 5개 저장 테이블의 원문이 조회 전후 같음을 확인했다. 공개 청크의 공통 가격 resolver와 저장 정책 우선순위는 대조 근거이며, Couplus의 모든 미설정 계정이 10원 반올림을 사용한다는 주장은 아니다. 최소 마진 분기 충돌과 미연결 통합통관 환율의 한계는 [기존 가격 감사](couplus-settings-pricing-parity-2026-10-06.md)대로 남아 있다.

**PING 버전 수정:** manifest 0.2.51일 때 응답의 버전 문자열이 0.2.50으로 고정된 결함을 실제 content handler 회귀에서 먼저 실패로 확인했다. 응답은 이제 `chrome.runtime.getManifest().version`을 그대로 사용한다. 구버전 fallback이나 새로운 capability·메시지·호스트·권한을 추가하지 않았다. 현재 manifest 및 다른 정상 버전을 반환하는 로컬 Chrome API 모의에서 버전만 달라지고 기존 응답 항목이 유지됨을 확인했다.

**포장 치수 입력:** 구현은 정확한 mm 포장 치수 필드와 관측된 `logisticsPage.skuUnitBoxDimension` 입력에 한정한다. 사용자가 새로 입력하거나 복사 적용한 양의 정수 3개의 `x`·`X`·`×` 구분자를 `*`로 정규화하며 숫자 순서와 입력 숫자를 보존한다. 단위나 실제 물리값을 추측하지 않는다. 기존 저장 원문은 조회만으로 고치지 않고 진단을 표시한다. 상품명·CSV scalar 문구의 곱셈 기호, 수동 공란·수정 해제, 이전 접수 원문·지문 보존을 별도 회귀에서 확인했다. 치수 시험의 g/mm·접수 ID는 격리된 합성 값이며 실제 상품의 측정값이나 원격 Hub 접수 증거가 아니다.

집중 검사는 최종 통합 검사와 겹치므로 합산하지 않는다.

- 가격: 수정 전 양사 미저장 설정 2개 실패·나머지 6개 통과, 수정 후 신규 8개와 기존 11개 **19/19**, 6.751초(`outputs/step581-option-default-before.txt`, `step581-option-default-final.txt`).
- PING·직렬화 경계: **60/60**, 8.991초(`outputs/step581-ping-version-final.txt`). 실행 당시 manifest는 0.2.51이었다. 검사한 source는 manifest를 직접 읽으므로 버전 하드코딩에 의존하지 않는다.
- 브라우저 원문 bridge: 실제 content script의 PING→CAPTURE 연결 검사까지 **9/9**, 1.203초(`outputs/step581-bridge-integrated.txt`). 두 요청은 다른 ID를 사용하고 CAPTURE 명령은 한 번만 전달되며 일시적 listener를 정리한다. source 응답은 모의 Chrome runtime이며 기한은 로컬 모의 시간으로 검증했다.
- 가격 범위 TypeScript 오류 0, 가격/PING 변경 범위 lint 오류·경고 0, PING 문법·diff 검사 통과. PowerShell lint 실행의 메모리 오류 뒤 직접 Node 실행은 exit 0이었다.
- 치수 집중 검사: 새 치수 7개와 editor 복사 회귀 1개 **8/8**, 실패·취소·미실행 0. 메모리 압박으로 각 무거운 사례를 별도 프로세스에서 순차 실행했다. 양사 실제 PUT/UI→관측된 공식 69900 XLSX 6행→숫자 옵션 PATCH, 기존 raw 지문·접수 기록 보존을 확인했다. 분리 실행 시간 합 49.533초는 단일 suite wall time이 아니다(`outputs/step581-dimensions-focused-summary.json`, 완료된 tool 결과를 정리한 요약). 최초 시험의 모델 열·CSV 따옴표 가정 오류와 V8 메모리 실패는 수정·재실행했고 운영 결함으로 간주하지 않았다.
- 최종 관련 24파일 통합 검사 **526/526**, 실패·취소·미실행 0, 153.105초(`outputs/step581-final-focused-tests.txt`). 최종 0.2.52 manifest로 PING 직렬화·실제 content bridge, 원문 parser/수집/초안, 가격·옵션·견적 편집, 무게·표시사항 지문 보호를 함께 검사했다. 신규 치수 7개는 위 분리 실행 결과이며 editor 회귀 1개는 통합 검사에도 포함되어 중복 합산하지 않는다.
- 전체 TypeScript 오류 0, 변경 파일 lint 오류 0·기존 `onBusy` dependency 경고 1, diff 검사 통과(`outputs/step581-typecheck.txt`, `step581-lint.txt`).
- 운영 빌드·14개 마이그레이션·D1/R2/Access 산출물 검사 통과(`outputs/step581-build-final.txt`, `step581-artifact-check.txt`). 초기 PATH Node 22의 V8 Zone 메모리 실패와 Node 24의 Rust allocation 실패 이후 가용 commit 33,955MiB를 확인했다. 제공된 Node 24.19.0·heap 768MiB·Rayon 1스레드로 재실행하여 전체 5단계가 완료됐다. 사용자 Chrome·다른 프로세스·pagefile·보안 설정은 변경하지 않았다. 실패한 산출물은 배포하지 않았다. 기존 client 500kB 초과 build 경고는 남아 있다.
- 독립 읽기 검수에서 이번 bridge 취소·정확 치수 wire·설정 우선순위·기존 접수 보존 범위의 구체적 결함을 추가로 발견하지 않았다. 검수 agent는 파일·데이터·브라우저·프로세스를 변경하지 않았다.
- 기존 Worker 배포 성공: **641c9ddf-829a-41f1-8fa1-34e124cb951a**, 변경 static asset 8개 업로드(`outputs/step581-deploy.txt`). 새 계정·유료 플랜·자원 생성·DB migration 적용 없이 기존 D1/R2/Access와 `google-free`/`google-translate-gtx` 설정을 유지했다.
- 배포 후 익명 앱 `/`와 확장 ZIP 경로 2회 GET 모두 HTTP 302로 기존 Access gate가 유지됨을 확인했다(`outputs/step581-public-smoke.txt`). 인증된 UI나 원격 ZIP 바이트 검증은 아니다. 긴 인증 redirect query·세션·토큰을 읽거나 출력하지 않았다.

확장 **0.2.52**의 최종 패키지 검사 결과는 37파일·465,032바이트, SHA-256 `1299da7c471751c45a34e2bc95c8a06e07386bfe9ea36d877e9b46117d4f1e5e`다(`outputs/step581-extension-check.txt`, `checked:true`). public와 dist/client ZIP 바이트가 같고 기존 permissions·hosts·content script 범위·worker/action 구성이 변하지 않았음을 확인했다(`outputs/step581-release-check.txt`). 실제 사용자의 확장 재로드·현재 로드 버전·인증 UI는 확인하지 않았다.

이번 단계의 추가 Google 요청은 0회다. 마지막 실제 확인은 15:03 KST Node에서 실제 helper로 일반 공개 단어 한 개를 GET한 HTTP 429이며, Worker나 운영 상품 번역 시험이 아니다. 올바른 Chrome 3 연결에서 관련 사용자 작업 탭 조회 결과는 빈 목록이었다. 이를 사이트 로그아웃·차단으로 해석하거나 새 창·프로필을 만들지 않았다. 운영 기존 상품 정보 수정은 0건이며 실제 g/mm 입력·이미지 OCR·모든 카테고리 대조·원격 Hub 최종 견적서/SKU/접수 확인은 남아 있다.
