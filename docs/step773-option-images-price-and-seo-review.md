# Step773 — 옵션 사진·원가 재계산·SEO 적용 후 편집

2026-10-21. 기준 커밋 `a071b36345062a1e693eef23383ff7403926a0a9`.

1688 수집본에서 카테고리를 선택한 뒤 단계별로 편집하고 견적서를 준비하는 과정에서 확인된 세 가지 누락을 보완했다. 기존 업무 상품은 열거나 수정·삭제·전송하지 않았다.

## 구현

1. **SKU 없는 옵션의 사진 연결.** 최초 신규 상품 생성 시에만 owner/product/job, 검증한 수집본 전체 SHA, 저장된 page sourceKey와 최초 옵션 ID의 연결을 발급한다. 이 연결을 확인한 옵션 사진만 SEO 썸네일과 견적서 대표이미지 후보에 제공한다. 현재 배열 순서나 같은 이름만으로 연결을 복원하지 않는다. 삭제·원문명/SKU 재작성은 연결을 폐기하며, 다른 상품으로 복사·분할한 문서는 이전 연결을 사용하지 못한다. 과거 상품의 연결을 소급 생성하지 않는다. 수동 이미지와 명시 공란을 보존한다. 기존 SKU 경로는 유지한다.
2. **원가 변경의 행별 재계산.** 유효한 개당 위안 원가가 바뀌면 그 행의 공급가·판매가를 기존 2단계 공식/현재 정책으로 즉시 다시 계산한다. 같은 숫자는 수동 가격을 유지하고, 원래 숫자로 되돌리는 변경은 다시 계산한다. 다른 행, 수동 MSRP/공란/OSRP, 전역 재계산 모드는 유지한다. 기존 원자 저장 POST 한 번으로 저장한다. 저장 사전검사도 최신 입력 snapshot을 사용한다.
3. **SEO 적용 후 최신 편집 연결.** 통합 적용 응답의 상품/새 버전/콘텐츠·옵션 revision/적용 개수를 검증한 뒤 현재 job의 receipt만 전달한다. 같은 상품의 최신 SEO GET이 receipt와 정확히 일치하면 상품명 입력으로 한 번 이동한다. 생성 결과 미리보기와 명시 적용 절차는 유지한다. 수동 미저장 입력, 숨긴 단계, owner/product/version ABA, 다른 job, 불확실 응답은 이동하지 않는다. 단계별 callback incarnation을 구분하고, 진행 중 요청의 잠금은 시작 때 획득한 callback으로만 해제한다.

이 SEO 이동은 원본의 같은 입력란 갱신 흐름을 참고한 자체 접근성 보완이다. 원본과 팝업 위치·전체 인터랙션까지 같다고 주장하지 않는다.

## REA 근거와 독립 검토

- 보관 Couplus route `chunk-6b0db3f8.8a741991.js`, SHA `5b92873c674c4b76c0e6ce4961caedbf8728ca86f6a15b6d9dc8cdfce80ad1d9`의 기존 증거를 재사용했다. 같은 producer나 거절된 사이트 접근을 반복하지 않았다.
- 부모 Evidence `ev_69740e390a2cc1e539a4a65a84e5c7065e2e6db9dcbc8a6311d0b4bfce5a3166`, 요약 `ev_26cdc76017d63fa2bb683d4165db034bae99266f6a3ad48bb3b45253f2ce9634`.
- 원가 change→해당 행 재계산, 생성 완료→같은 상품 입력 갱신을 근거로 사용했다. 원본 코드는 복사하지 않았다. 상세 범위·조각 SHA는 `outputs/step773-rea-seo-ui.json`에 있다.
- 독립 검토에서 발견한 단계 ABA와 요청 잠금 해제 문제를 수정했다. 실제 generator/child의 합성 pending apply→숨김→재진입→ACK 검증은 잠금 정상 해제를 확인했다. `outputs/step773-composition-active-review-repro.json`.

## 검수

- 최종 고유 합집합 **28파일 347/347 통과**. 중복 집중 실행을 더하지 않았다. 양사 실제 로컬 API/임시 SQLite, 수집본 보존, 옵션 사진, 삭제/재생성/복사/분할, 원가·MSRP, SEO 저장·경합·단계 이동 범위를 포함한다. `outputs/step773-final-validation.json`.
- 초기 실패는 VM realm 객체 비교와 새 pure dependency를 모르는 fixture loader였다. 실제 모듈을 로드하고 기존 단언을 유지했다. React callback dependency 비교도 JSON 문자열에서 Object.is로 바로잡아 실제 lifecycle 경계를 검사한다.
- TypeScript, 변경 파일 ESLint 오류·경고 0, 운영 빌드 통과. 테스트 뒤 추가한 lint 사유 주석은 주석 제거 후 TypeScript 출력이 완전히 같음을 기록했다. `outputs/step773-comment-only-proof.json`.
- 같은 Chrome의 격리 localhost에서 실제 Dashboard/핸들러/SQLite와 합성 수집 원문·유효 PNG·합성 AI 응답을 사용했다. 옵션 썸네일 두 개의 서로 다른 파일과 decode 성공, 수동 SEO 보존, 확인된 적용 후 최신 상품명 입력 focus, 직접 수정 저장을 확인했다. 양성 적용 검수만 새 fixture의 SEO provenance를 generated로 준비했다. 원문과 업무 데이터 변경이 아니다.
- 브라우저에서 수동 공급가10000/판매가16000→개당 원가5.99를 입력하면 해당 행만5100/8500, 자동 MSRP11050으로 재계산됐다. 단일 가격 POST200 후 7단계에 수정 상품명·옵션명·동일 가격·옵션별 사진이 표시됐다. 보호 합성 상품/파일은 불변이다. `outputs/step773-browser-final-checkpoint.json`, `outputs/step773-browser-qa/proof.json`, `outputs/step773-ui/`.
- 확장 소스·권한·버전은 변경하지 않았다. 2.1.13 ZIP 90파일/1081792bytes/SHA `58f96ad427ca7d4add2200bc7dd6de849dbdaae778308f32993a5d7abd93d444` 재검사 통과. 확장 새로고침 요청 없음.

## 미검증 범위

실제 1688 재접근은 이전 자동 승인 검토의 거절 이후 재시도하지 않았다. 이번 검수는 실상품 수집 성공이나 Supplier Hub 접수 성공의 증거가 아니다. Supplier Hub 원격 업로드 원본 바이트 검증, 최종 동의와 docId/QVT 접수·옵션별 SKU 대응은 미검증이며 두 LIVE_VERIFIED gate는 false다. 모든 카테고리·모든 상태의 1~7단계 UI 동등성이나 전체 AI 품질도 완료로 보고하지 않는다. 신규 리소스, DB migration, 인증 정책 변경은 없다.

배포 Worker version, 커밋·푸시 결과와 최종 파일 SHA는 `outputs/step773-final-validation.json`에 추가한다.
