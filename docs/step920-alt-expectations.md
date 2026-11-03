# Step920 — 초기 ALT 기대값과 안내 정합

2026-11-03. 상세·견적 runtime fallback은 변경하지 않았다. 실제 상품, 브라우저, 외부 서비스, 인증 파일은 사용하거나 수정하지 않았다.

## 판정 근거

- `tests/quotation-schema.test.mjs`의 두 빈 ALT 기대값은 `179c74113`(2026-09-30)에서 작성됐다. `4574ced38`(2026-10-30)은 미입력 상태인 빈 `unverified` ALT에 저장된 SEO 상품명, 없으면 수집 상품명을 사용하는 정책을 명시적으로 추가했다. [Step865 기록](step865-image-vision-recovery-and-quotation-defaults.md)과 당시 실제 API 회귀 `fresh automatic ALT follows saved SEO while explicit blank ALT and quotation overrides remain blank`가 이 동작을 기록한다.
- 수동·수집·번역·생성 출처로 저장한 빈 ALT와 견적 공통·옵션 수동값은 초기 fallback보다 우선한다. SEO 설명만으로 상세 HTML을 만들지 않는 규칙도 별개로 유지한다.
- [Step679](step679-detail-alt-text-parity-2026-10-15.md)와 [Step689](step689-workspace-composite-parity-audit.md)의 보존된 COUPLUS `saveDetailPage` 증거는 **명시적 상세 저장**의 공통 ALT truthiness 유지·채우기와 모든 옵션 ALT 재작성을 보여준다. 이는 신규 초안의 SEO→ALT 초기 fallback을 증명하는 자료가 아니며, 이번 변경을 COUPLUS 초기값 동등성 검증으로 주장하지 않는다.

## 변경 범위

두 schema 테스트는 초기 ALT와 출력 ALT만 현재 저장된 SEO 상품명으로 기대하도록 맞췄다. 초기 상세 HTML 공란, SEO 설명 미삽입, 배너 보존, 이후 직접 작성한 상세 설명·ALT·수동 HTML 검사는 유지했다. 카테고리 미리보기의 초기 ALT 안내도 같은 정책으로 맞췄으며 canonical 및 정확한 native ALT 필드가 동일한 안내를 표시하는 회귀를 추가했다.

기존 intake 대기열 UI 테스트 세 개의 `useState` 모형은 lazy initializer를 실행하지 않고 함수 자체를 상태값으로 저장했다. 실제 컴포넌트의 `useState(() => ... null)`이 truthy 함수로 바뀌어 처음부터 카테고리 창이 열린 것으로 잘못 처리했다. 세 모형의 초기값 계산만 React 계약에 맞췄으며 기존 URL·분류·선택·작업 목표 기대값은 변경하지 않았다. 실제 대기열 runtime 결함으로 판정하지 않는다.

명시적 상세 저장 정책, 생성·추론·전송·저장 권한과 CAS 동작에는 변경이 없다.

## 검증과 한계

- 두 schema 회귀, 실제 카테고리 미리보기 안내, 기존 공란 보존 API 회귀의 집중 실행은 **4/4 통과**했다. 새 안내 검사는 수정 전 실패를 확인했다.
- 최초 세 파일 전체 실행은 217/220이었고 HEAD `52e99ce8`의 원래 테스트·loader로 같은 세 대기열 실패를 확인했다. 위 lazy initializer 모형만 정정한 뒤 schema·카테고리 미리보기·fields API 전체 **220/220 통과**, 실패·건너뜀·취소 0을 확인했다. 집중·기준 실행은 중복 합산하지 않는다.
- 최종 변경 파일 ESLint와 `git diff --check`는 통과했다. 최종 로그는 `outputs/step920-alt-focused-final-tests.log`, `step920-alt-final-lint.log`다. 앞선 RED·집중·HEAD 기준 로그도 같은 접두사로 보관했다. 브라우저·운영 저장·외부 호출은 실행하지 않았다.
