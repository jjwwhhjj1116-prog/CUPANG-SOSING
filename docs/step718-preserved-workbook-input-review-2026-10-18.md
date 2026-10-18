# Step718 — 갱신된 견적서 양식에서 이전 수동 입력 비교

2026-10-18 KST. 기준은 `7419b6065593ae2991ecb7659b3f064d9de3d5ef`이다. 기존 작업 상품을 수정하지 않고, 보관 원본의 REA 정적 분석과 격리된 자체 API·SQLite·React 검증으로 진행했다. 원본 분석은 [별도 감사](step718-quotation-context-parity-audit.md)에 기록했다.

## 확인한 문제와 변경 범위

같은 회사·카테고리·프로필·Hub schema라도 공식 Excel 파일의 도움말 한 줄이 바뀌면 파일 SHA가 달라진다. 자체 추가 열의 ID는 해당 SHA를 포함한다. 이때 현재 양식을 사용하는 7단계에서는 이전 추가 열의 수동값이 새 열에 들어가지 않고 빈칸으로 출력됐다. 이전 값은 이미 overrides JSON에 보존되고 내보내기 경고도 있었다. 삭제나 전체 문서의 새 기본값 덮어쓰기라고 설명하면 부정확하다. 실제 부족한 부분은 화면에서 이전 값과 새 항목을 비교해 재사용할 수 없다는 점이다.

최신 양식을 내보내는 기존 정책과 SHA별 필드 격리는 유지했다. 서버는 수집 당시 검증된 원본의 설명 중 현재 양식에 없는 수동값 항목만 읽기 전용으로 제공한다. 원래 값은 기존 overrides에 남으며 별도로 복제하거나 자동 매핑하지 않는다. 회사·상품·카테고리·원본 검증과 저장 revision/fingerprint 검사는 그대로다. 설명을 위해 R2나 외부 서비스 요청을 추가하지 않는다.

편집 화면은 공통값·해당 옵션의 이전 입력과 현재 미저장 입력을 비교한다. 같은 열·정규화된 항목명이 일치하면 대상만 제안하고 체크하지 않는다. 사용자가 직접 선택한 값만 기존 편집 초안에 반영한다. 옵션 ID를 다른 옵션이나 공통값으로 옮기지 않는다. 원래 빈 문자열과 공백도 보존하고, 현재 항목의 선택값·길이 등 저장 규칙을 검사한다. 중복 대상은 거절한다. 필수 공란의 보존과 완성된 입력의 검토는 구분한다.

가져오기는 서버 저장이 아니다. 기존 ‘모든 옵션에 적용’을 끄고 선택한 공통·옵션의 초안만 변경한다. 공통값은 별도 옵션 입력이 없는 옵션에 상속되고 기존 옵션 override가 우선한다. 사용자가 검토하고 기존 ‘견적 입력 저장’을 눌러야 반영된다. 옵션 포함/제외·이전 원본·이전 수동값·다른 상품은 유지한다. 응답·revision·fingerprint·초안 변경, 쓰기 중, unmount 뒤의 오래된 선택과 callback은 적용하지 않는다.

## 증거와 검수

초기 재현은 양사의 합성 회사 문맥에서 실제 자체 API·격리 SQLite와 실제 QuotationPanel callback을 사용했다. 같은 원본의 도움말만 바꿔 새 SHA를 만들었으며, 이전 수동값의 미리보기·XLSX 공란과 기존 경고·원본 보존을 각각 확인했다. Hub schema의 실제 변경은 기존 guard가 거절했다. 초기 조사와 이후 구현 증거는 `outputs/step718-quotation-audit-readonly-snapshot.json`, `outputs/step718-quotation-audit.json`, `outputs/step718-quotation-retained-proof.json`으로 구분한다.

백엔드 신규 8개는 양사의 실제 자체 API 읽기·정상 PUT·실제 생성 XLSX 셀, 원본/옵션/공란/제외옵션 보존, 추가 파일 요청 0, 잘못된 회사·프로필·원본 거절을 확인한다. 반복 실행은 최종 고유 시험 수에 합산하지 않는다.

화면 신규 17개(순수 규칙8·실제 컴포넌트/부모 callback9)는 미선택 상태, 명시 선택, 대상 중복, 규칙 비교, 필수 공란의 비차단 검토, 페이지 이동, 오래된 callback, busy/unmount, 전체 옵션 전파 해제, 명시 Save 이전 PUT0·이후 PUT1을 확인한다. local-yun/local-yhop 사례는 합성 회원과 모의 GET/PUT를 쓰므로 실제 두 회원의 로그인·전송 증거가 아니다. 별도 서버 시험이 실제 자체 route·SQLite·XLSX를 검사한다. 초기 타입 검사의 candidate narrowing 오류7개는 never 함수 선언으로 수정했고 최초 실패 로그는 보존했다.

첫 관련21파일557개 실행은529pass28fail이었다. 기존 mapped-quotation26개와 실제 보관 공식파일 evidence2개가 공통 SEO 제목만 예상하고 옵션명 합성을 반영하지 않았다. 수정 전 HEAD의 app/db218개를 메모리에서532회 읽기 주입해 같은62개 중34pass28fail을 재현했다. 제목 기대값을 literal로 바로잡자 기존에 가려졌던 고시 소재2개가 나타났으며, 이것도 HEAD218개/472회 읽기에서 양사 모두 동일 재현했다. 이 증거는 HEAD app/db와 당시 working-tree tests/helpers/fixtures/dependencies의 조합이며 완전한 clean checkout 실행은 아니다. 라벨 소재의 사용자 편집과 고시의 초기 ‘해당사항없음’을 독립으로 검사한 뒤, 정확한 견적 고시 필드에 명시 수동값을 넣어 공통/옵션 공란의 우선순위와 실제 Excel 셀을 검사하도록 fixture를 보강했다. 앱의 제목·고시 규칙이나 검증 guard를 완화하지 않았다. 최초·중간 실패 로그와 source 주입 증거는 덮어쓰지 않았다.

## 최종 검사와 배포

- 최종 관련 **21고유파일557/557pass**, 신규25(서버8·순수규칙8·UI/부모9) 포함. fail/cancel/skip/todo0,98.93초. source/config/tests1,302개 전후 SHA가 같고 추가·삭제0이다. focused8/17/19/62와 최초·중간·HEAD 실행을 중복 합산하지 않았다. 전체 저장소 suite 결과가 아니다.
- 독립 서버·화면·기존 fixture3회 최종 리뷰에서 actionable issue0. 중간 리뷰의 도움말/필수성/선택값 비교·현재 공란 표기·중복검사 Map 보완을 반영했다. 현재·보관 회사/필드·미저장 입력을 정확히 묶는 guard와 일반 저장의 CAS를 유지한다.
- types768·app/db 및 변경 MJS lint384·schema44tables17indexes29modules·bounded build384·diff check exit0. 빌드와 최종 통합 사이에는 검증을 보강한 기존 테스트2개 외에 소스 변경이 없었다. `outputs/step718-final-verifier.mjs`의 preflight/postflight가 원본 범위·SHA, 리뷰·로그·확장 ZIP·소스 고정을 다시 검사한다. `outputs/step718-release-inputs.json`, `outputs/step718-final-validation.json`에 고정했다.
- 기존 Worker `39dd3d6b-1936-455c-8214-9fac23240e05` 배포exit0: <https://sourceflow.jjwwhhjj1116.workers.dev/>. 새 resource/migration/유료 provider/OAuth/R2 권한0. 확장0.2.78 및 ZIP SHA `37c5b8fccc9ccd9abbebc03b82a8bc652ff0141267dfc7bd1a0ab17a64688b83` 변경0, 설치 업데이트·재조회·새로고침 요청0이다.
- 배포 후 기존 Chrome4의 별도 검수 탭에서 YOOFAM PLUS 제목·jwhj1116 로그인·AI상품등록 화면을 읽고 기록했다. 상품을 열거나 수정하지 않고 검수 탭만 닫았다. 신규 비교 패널의 운영 상품 실사용·전체 pixel parity 검증으로 확대하지 않는다. AX는 `outputs/step718-deployed-app-readonly.txt`에 보관했다.

## 범위와 남은 검증

수집 당시 보관된 원본 descriptor가 있는 값만 비교할 수 있다. 보관하지 않은 중간 SHA나 옛 형식의 descriptor 없는 값은 추론하지 않으며 기존 overrides 보존·일반 경고를 유지한다. 새 공식 인증이나 양식의 의미가 같다는 보장은 추가하지 않는다. 같은 이름은 제안 근거일 뿐 자동 복사의 권한이 아니다.

브라우저는 기존 Chrome4의 검수용 빈 Supplier Hub 등록 화면·공식 다운로드 대화상자만 읽었다. 유앤채 로그인은 확인됐지만 코드80719 검색 후 화면에 결과가 나타나지 않아 새 파일 다운로드·카테고리 일치 성공으로 기록하지 않는다. 파일 업로드·약관 동의·검증/제출은 하지 않았고 검수용 탭만 닫았다. 기존 사용자 탭과 작업 상품은 그대로다.

실제 비교 컴포넌트를 합성 자료로 SSR한 정적 미리보기는 `outputs/step718-workbook-review-preview.html`에 보관했다. 브라우저의127.0.0.1 검수 서버 접속은 `ERR_CONNECTION_TIMED_OUT`으로 끝났으므로 시각 검수 성공으로 세지 않는다. 해당 검수 탭과 로컬 서버만 정리했다. 이 결과를 Supplier Hub 로그아웃·권한 문제나 외부 사이트 차단 증거로 확대하지 않는다.

실제 신규1688 전체 SKU·가격·이미지·상세 수집, 모든 카테고리의 공식 양식/기본값 동등성, 실제 Hub docId/qvtRequestId/SKU 접수는 이 검증으로 증명하지 않는다. 이전 자동 승인 검토에서 거절한1688 도메인과 URL을 다른 도구·앱·확장·CLI·프록시로 재접근하지 않는다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`와 운영 제출 gate는 유지한다. 확장·권한·migration·새 자원·유료 서비스 변경은 없다.
