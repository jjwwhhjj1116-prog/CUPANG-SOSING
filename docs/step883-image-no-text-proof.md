# Step 883 — 이미지 외국어 없음의 서버 검증과 자동 작업 완료

2026-10-31. 기존 886 상품, 원래 요청과 문서 2347603, 저장 이미지·견적 본문은 변경하지 않았다. 이 문서의 동작 검증은 로컬 fixture와 메모리 SQLite를 사용했다.

## 원인과 계약

기존 Vision의 `blocks:[]`는 ‘외국어가 없음’과 ‘외국어가 있으나 읽을 수 없음’을 구분하지 않았다. 자동 작업은 이 결과를 skipped로 남겼고, 서버 목록에는 완료 근거가 없어 다음 전체 작업에서 다시 읽었다.

신규 요청만 `inspectionPolicy=foreign-text-inspection-v1`을 명시한다. 같은 승인 모델 `@cf/qwen/qwen3.8-27b`와 기존 paidAllowed 설정을 유지하며, 제공자가 `no-foreign-text`, `foreign-text`, `unreadable`을 명시하도록 응답 계약을 분리한다. 서버는 no-foreign-text와 빈 블록이 함께 있는 정상 완료 응답만 원본 유지 완료로 인정한다. 결정 누락·모순·잘린 응답·실패·미확정 결과는 완료 근거가 아니다. 기존 빈 응답을 새 결정으로 승격하지 않는다.

계약 버전은 새 요청의 fingerprint와 sourceScope에 포함된다. 기존 요청의 상태 조회와 원래 프롬프트는 기존 identity로 복구한다. 신규·구형 sourceScope의 running/uncertain 요청은 서로를 차단하므로 버전 변경으로 미확정 추론을 우회할 수 없다.

## 증거와 읽기

- 별도 `image_no_text_receipts`는 이미 completed인 Vision 원장과 일치하는 서버 원본키·SHA-256·크기·회원·회사·제공자 설정·inspection policy를 보관한다. 완료 시각은 해당 원장의 finished_at과 같다. migration 0038은 이 표만 추가한다.
- 목록은 40상품 단위, 최대 8,000행의 SELECT/JOIN으로 원장·승인 회원·현재 회사·현재 설정·현재 상품 이미지 풀을 대조한다. AI·R2 조회·파일 쓰기·상품 변경을 실행하지 않는다.
- 현재 포함 옵션의 최종 슬롯을 모두 대조한다. 원본 없음, 빈 선택, 새 이미지, 삭제된 이미지, 다른 상품·회원·회사·정책의 증거는 완료시키지 않는다. 동일 상품의 동일 불변 원본키는 옵션 또는 순서가 달라도 사실을 재사용한다. 가격·표시사항 저장으로 quotation revision이 달라졌다는 이유만으로 재OCR하지 않는다.
- 사용자가 작업을 다시 개시할 때 source GET은 기존처럼 실제 이미지 bytes와 SHA를 다시 확인하고 현재 receipt와 대조한다. 같은 메모리 세션의 완료 플래그도 이 검사를 건너뛰지 않는다. SHA나 현재 설정이 달라지면 오래된 증거를 사용하지 않는다.
- 증거가 맞으면 원본을 유지하며 OCR·렌더링·이미지 저장 0회로 해당 단계가 완료된다. 구형 빈 OCR 또는 unreadable만 있으면 검토 필요/차단이며 뒤 단계로 조용히 진행하지 않는다. 직접 저장된 수동 선택과 번역을 끈 설정의 기존 skip은 유지한다.
- 이전 실패 표시를 없애는 경우에는 모든 필요한 현재 no-op 증거가 그 실패보다 나중에 서버 확정됐어야 한다. 현재 running이나 더 최근 failed는 덮지 않는다.

공용 이미지 API는 원본키 덮어쓰기를 받지 않는다. 목록의 SHA는 해당 불변 키를 서버가 읽어 검증한 시점의 증거이며, 목록을 열 때마다 이미지 bytes를 다운로드했다는 뜻은 아니다. 실제 자동 작업 재개 시에는 bytes를 다시 대조한다.

## 검증

- focused 7파일 122/122 통과: `outputs/step883-image-noop-final-regressions.log`.
- 실제 제공자 응답 parser·원장 SQL·receipt 조회·등록 목록 연결, 구형/신규 요청 상호 fence, 현재 원본 SHA 변경, 다른 회원/회사/정책, 구형 빈 결과·unreadable 거부, current failed/running 우선순위를 포함한다.
- 단계별 runner는 server proof를 검증하고 모든 이미지의 OCR·렌더·쓰기 0회를 검사한다. 별도 전체 작업 통합 5/5는 양 회사의 1~7단계 orchestration에서 3~5 완료 후 6·7 진입을 확인한다: `outputs/step883-noop-workflow-verified-at-tests.txt`.
- 타입 검사와 대상 ESLint 통과. 기존 UI 회귀 fixture의 `.ts` hook 경로 및 CSS 모듈 로딩을 보완했다. 이미지 개수 검증은 유지하고, 포함 옵션에 빈 최종값이 있는 경우 배지가 대기인 현재 UI를 검증한다.

실제 886 원본과 문서의 접수 검증은 이 fixture 결과로 완료 주장하지 않는다. 과거 수집 누락이나 인페인팅 품질 문제도 이 변경으로 해결됐다고 주장하지 않는다.
