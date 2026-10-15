# Step680 — 노출 속성 중복 비교

2026-10-15 기록. 7단계 견적 입력과 등록 검토에 노출 속성 값이 같은 옵션을 확인하는 기능을 추가했다. 자동 분할이나 상품 간 상세 전파는 구현하지 않았다.

## 원본 근거와 비교 범위

보관 Couplus 자료의 정적 조사·Evidence·원문 범위는 [분할 생성·상세 형제 적용 조사](step680-split-audit.md)에 기록했다. 최초 detector는 `exposedAttributes` 전체 JSON을, 재검사는 이름/값 목록 JSON을 비교하며 별도의 포함 옵션 필터가 없다. 일반 `saveDetailPage`는 현재 상품과 그 옵션만 저장한다. 형제 상세 적용은 별도 명시 함수이므로 일반 상세 저장에 형제 전파가 있다고 해석하지 않는다.

이번 앱은 **현재 견적에 포함된 실제 옵션의 최종 scalar 값 목록만** 비교한다. 공통 행·견적 제외 옵션·표시 이름은 비교 key에서 제외한다. 배열 부가 메타데이터까지 비교하는 원본 전체 JSON detector와 같다고 주장하지 않는다. 공백·공란·숫자 표기·`해당사항없음`은 정규화하지 않고 문자열 그대로 비교한다. 같은 값은 실제 구분값 누락을 확인할 검토 사유이며 Supplier Hub 확정 거절 판정이 아니다.

## 구현

- `app/quotation-exposed-duplicates.ts`가 확인된 카테고리의 노출 scalar 필드를 선택한다. 공식 이름 있는 Hub 연결이 있으면 fallback 별칭보다 우선하며, 중복 ID·모호한 연결·누락 셀·지원하지 않는 형식은 비교 불가로 처리한다. 최대 200개 포함 옵션·400개 필드 범위에서 완전한 그룹만 반환한다.
- `app/components/quotation-exposed-duplicates.tsx`는 그룹 수와 옵션 수, 같은 값 목록, 해당 옵션의 속성으로 이동하는 버튼을 제공한다. 한 번에 선택한 그룹의 표만 펼쳐 DOM을 제한한다. 표시 번호는 안내에만 쓰고 이동은 옵션 UUID와 실제 필드 ID를 사용한다.
- `app/components/quotation-fields-editor.tsx`는 기존 셀 resolver로 미저장 입력을 읽는다. 공통 입력 상속, 옵션별 공란, 수동 수정 해제 후 공통·자동값 상속도 현재 비교에 반영한다. 이동은 입력을 저장하거나 초기화하지 않으며 저장 중·조회 중·충돌 중에는 새 비교 동작을 잠근다.
- `app/submission-review.ts`는 같은 그룹의 포함 옵션마다 `DUPLICATE_EXPOSED_ATTRIBUTES` 검토 안내를 추가한다. 오류 수나 강제 전송 조건을 추가하지 않는다. 저장된 검토 결과는 기존 API·견적 미리보기·XLSX/ZIP 자료에 반영되며 비교 자체는 저장·외부 호출을 하지 않는다.

## 검증 결과

최종 고유 검사 253개가 서로 다른 8개 파일에서 통과했다. 재실행을 중복 합산하지 않았다.

| 범위 | 고유 검사 | 최종 로그 |
| --- | ---: | --- |
| 새 비교 helper 13 + 등록 검토 27 | 40 | `outputs/step680-exposed-review-final.log` |
| 기존 편집기·필수값·API 회귀 | 139 | `outputs/step680-editor-regressions.log` |
| 등록 검토 화면·전송 회귀 | 68 | `outputs/step680-submission-regressions.log` |
| 새 비교 화면 | 6 | `outputs/step680-panel-tests.log` |

`outputs/step680-types.log`, `outputs/step680-lint.log`, `outputs/step680-build.log`의 타입·린트·빌드 종료 코드는 모두 0이다. 독립 읽기 전용 소스 검수의 지적은 0건이다.

같은 Chrome3의 실제 `QuotationFieldsEditor`·API·임시 SQLite로 두 회사 각각 옵션 6개를 확인했다. 최초 2개 그룹·4개 옵션에서 정확한 UUID의 색상 필드로 이동한 뒤 미저장 값을 수정하면 1개 그룹·2개 옵션으로 줄었다. 회사별 명시 PUT 1회가 200으로 완료됐고 재조회·회사 전환 뒤에도 공백을 포함한 값을 그대로 확인했다.

`outputs/step680-native-verification.json`은 `passed: true`, `sourceFrozen: true`, HTTP 16회, 쓰기 2회, DOM 확인 8개를 기록한다. 원천 자료와 정상 저장 시계 변경을 제외한 상품 필드는 유지됐다. `outputs/step680-native-comparison.png`는 합성 자료를 표시한 실제 네이티브 프레임 캡처다.

초기 네이티브 장치가 raw Buffer를 객체 요청 adapter에 전달해 400을 받은 문제는 실제 Request 핸들러를 직접 호출하도록 검사 장치만 고쳤다. 앱 코드는 바꾸지 않았다. 원본 상품 비교에서는 정상 저장에 따른 `updated_at` 변경만 비교 대상에서 제외했다.

## 확인하지 않은 범위

관련 자식 AI 화면의 GET 409는 fixture에 캡처된 상세 스키마가 없기 때문이며 SingleHistory 조회도 인증 fixture의 한계가 있다. 따라서 HTTP 16회 전체 성공, 실제 AI 생성 또는 실제 회원 인증 성공으로 보고하지 않는다. 작업 중인 상품·Couplus 브라우저를 제어하거나 신규 외부 1688·Supplier Hub·운영 상품에 쓰지 않았다.

실제 신규 상품 수집부터 Hub 최종 접수까지의 전체 흐름과 모든 카테고리는 이번 검사로 입증되지 않는다. 분할 생성·명시적 분할 계보·선택 대상 상세 적용도 아직 구현하지 않았다. 기존 `collection_context.forkedFrom`은 독립 원문 초안의 출처이며 분할 관계나 전파 대상으로 재사용하지 않는다. 배포와 운영 확인은 별도 기록한다.

## 배포와 정리

기존 무료 Worker 버전 `c659a710-a7ff-4e7f-8c8f-ffa8f9ef3bf4` 배포를 완료했다. 새 마이그레이션·리소스·권한·확장 업데이트는 없다. 운영 탭에서 미저장·저장 중·대화상자 0을 확인한 뒤 새로고침했고, 올바른 제목·목록 1행·로딩 종료·경고 0을 확인했다. 운영 상품은 열거나 수정하지 않았다. `outputs/step680-production-verification.json`, `production-dom.txt`, `production.png`, `deploy.log`에 기록했다. 임시 검수 탭과 생성 도중 남은 빈 탭을 닫았고, 로컬 3670 서버 종료와 리스너 부재를 확인했다. 기존 Couplus·Supplier Hub 탭은 조작하지 않았다.
