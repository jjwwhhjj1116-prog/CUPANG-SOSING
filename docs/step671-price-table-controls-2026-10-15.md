# Step671 — 가격표 표시 수·높이·전체 선택 대조

기준은 Step670 `f31649a290607eae1eb8ac36ef83f32b942b3d87`이다. 저장 옵션번호·가격/견적서 UUID 연결은 유지하며, 이번 변경은 가격표의 페이지·선택·높이에 한정한다.

## 원본 근거와 구현

REA로 보관된 UI 가격 팝업의 `items-per-page:20`, `height:"600px"`를 확인했다. 일반 CDataTable은 초기 `itemsPerPage || 10`을 사용하고 높이 고정 기본 Y에서 `height || "600px"`, N에서 auto를 사용한다. 이 가격 팝업은 storageKey를 전달하지 않아 저장된 표 설정 복원 경로를 선택하지 않는다. Evidence `ev_660f0091820a726b1420393376414c0bb008409184b2025207a8351429504f05`; 원본 일반 표 SHA256 `7a2d7bc1103eb97ff90329a716da2b5595e2d3a0a8f1c6c00b4239fb2a0c3678`. 12개 선택 범위의 원본/추출 해시 검사와 정적 파싱이 통과했다.

전체 선택의 원본은 `this.selected = checked ? [...this.sortedItems] : []`다. 체크하면 검색·정렬된 전체 행으로 기존 선택을 **교체**하며 필터 밖 선택은 제거된다. 해제하면 필터 밖을 포함한 선택을 **모두 비운다**. Evidence `ev_80058b8130c110cfd1ec44a0c48cf2441311a5ce02c3a66e52f40c0fbf65b42f`; UTF16 `[24381,24474)`, UTF8 `[24688,24781)`. 처음 작성한 필터 밖 선택 보존안은 이 추가 확인에 따라 폐기하고 최종 구현/검수에서 교체·전체 초기화로 수정했다.

YOOFAM 가격표의 기본 20개 표시와 최초 선택 옵션 페이지 계산을 동일한 기준으로 맞췄다. 고정 높이는 600px이며 N을 선택하면 해당 높이 클래스를 제거한다. 전체 선택은 현재 페이지를 넘어 모든 검색 결과의 **UUID**로 교체하고 해제는 빈 배열을 전달한다. 검색·선택·페이지 이동은 원가·가격·옵션 원문·번호를 저장하거나 다시 생성하지 않는다. 부분 선택은 접근성 mixed 상태를 표시한다.

원본 페이지 선택지에는 10/25/50/100만 있고 초기 20은 별도로 유지된다. YOOFAM의 native select에서 초기 20을 표시하고 재선택할 수 있도록 **20 선택지를 추가한 것은 명시적인 자체 UI 결정**이다. 모든 메뉴/픽셀까지 원본과 동일하다고 주장하지 않는다. 원본 CSS 선언은 보관된 5개 JS에 없어 색상·너비·최종 배치 동일성은 이 정적 근거로 확인할 수 없다.

Ignored `outputs/step671-price-controls-audit/source-manifest.json` 및 `rea-evidence-bundle.json`에 원본 범위·해시·미확정 사항을 보관했다. 인증 정보와 벤더 원본을 Git에 넣지 않는다.

## 최종 검수

- 최종 5개 관련 파일 **51/51** 통과, 실패/취소/skip 0. 37개 검색 결과의 두 페이지 선택, 기존 숨겨진 UUID 교체/전체 초기화, 부분/빈 선택, 20/21 경계의 옵션 포커스, 전체 가격 요약·저장본 불변, 단일 그리드/CAS/늦은 응답 및 회사 전환을 포함한다. Step670 287개 검사와 중복되므로 합산 총계로 보고하지 않는다.
- 최종 타입 검사, 변경 소스 lint, 기존 Worker build exit 0. 로그는 ignored `outputs/step671-final-tests.log`, `step671-types.log`, `step671-lint.log`, `step671-build.log`.
- 실제 기존 Chrome 3에서 실제 편집 컴포넌트/API와 임시 SQLite/member-session fixture 33개 옵션으로 확인했다. 첫 페이지 20개·실제 600px, 두 번째 페이지 13개 모두 선택/전체 33개 선택, 숨겨진 22번 선택 후 검색 결과 11개로 교체(12개가 아님), 다시 숨겨진 2번을 선택해 전체 12개 상태에서 해제하면 0개. N은 고정 클래스가 제거되고 내용 높이 1447.708px로 표시됐다.
- Native trace 7개, 가격·옵션 수정 PATCH/PUT/DELETE 0, 두 legacy fixture 그대로/legacy 번호 0, app source hash 고정. 초기 자체 fixture 복사 시 회사 헤더가 옛 이름으로 남아 실패했고 임시 fixture만 수정해 재시작 후 위 최종 검수를 수행했다. 초기 숨겨진 선택 보존 검수 기록은 최종 교체·초기화 기록으로 덮어썼다.
- 운영 DB/실제 회원 로그인/1688/provider/Supplier Hub/업로드 요청 0. ignored `outputs/step671-price-native-proof.json`, `step671-price-native-dom.json`. 캡처는 CDP Page.captureScreenshot 5초 timeout으로 PNG 없음. 임시 탭 close 성공, 임시 서버 종료.
- 독립 소스/테스트 검토에서 actionable finding 0.

## 배포 상태

현재 운영은 계속 Step668 Worker `c9f47c1e-9d46-49c7-8eb4-fef0f70d8021`이며 Step669 0024 원격 테이블 적용도 미완료다. Step670 최소 scope 인증 session22367도 timeout/Windows assertion으로 종료했다. ignored `outputs/step670-cloudflare-login.log`에서 실제 timeout 확인, 새 인증 성공은 없다. 기존 Chrome의 인증 탭 727931209는 사용자 로그인용으로 유지했다. 로그인 완료 응답을 받으면 현재 상태를 확인한 뒤 필요한 경우 새 scoped request를 만든다. 만료된 nonce로 재시도하거나 R2/offline scope를 추가 요청하지 않는다. 인증 코드·challenge·token을 출력하지 않는다.

이번 빌드 및 푸시는 배포 성공이 아니다. 실제 Cloudflare 인증 성공 후 기존 무료 D1의 0024 additive 3-table SQL 적용과 현재 빌드의 동일 Worker 배포를 각각 확인한다. 생산 데이터 변경·새 DB·유료 자원·권한 확장·보안 우회는 수행하지 않았다.

전체 남은 범위는 새 1688 full SKU/이미지 수집, 모든 카테고리 공식 양식과 기본값, 남은 단계 UI, Supplier Hub 동의/최종 접수 번호·SKU 검증이다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`, 운영 변경 gate=false. 거절된 1688 URL의 도구 우회/기존 작업 상품 수정/임의 완료율·100% 완료 주장은 계속 금지한다.
