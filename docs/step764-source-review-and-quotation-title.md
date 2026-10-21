# Step764 — 수집정보 수정 후 초안 연결과 견적 상품명 입력

2026-10-21. 기존 업무 상품·원본 Couplus 작업 상품은 변경하지 않았다. 실제 접수 완료를 주장하지 않는다.

## 원본과 현재 구현 대조

기존 Chrome의 Couplus 화면에서 현재 script URL이 보관 route `chunk-6b0db3f8.8a741991.js`와 main `604a4c32`에 대응함을 읽기 전용으로 확인했다. 새 script 바이트를 내려받거나 기존 상품을 열어 저장하지 않았다. 정적 분석은 보관 route SHA `5b92873c674c4b76c0e6ce4961caedbf8728ca86f6a15b6d9dc8cdfce80ad1d9`와 REA 부모 `ev_69740e390a2cc1e539a4a65a84e5c7065e2e6db9dcbc8a6311d0b4bfce5a3166`, 저장 요약 `ev_26cdc76017d63fa2bb683d4165db034bae99266f6a3ad48bb3b45253f2ce9634`를 재사용했다. 현재 세션의 부모 조회는 보관 무결성 오류로 실패했고 동일 producer는 반복하지 않았다. [범위·바이트·SHA 명세](../outputs/step764-rea-stage-spec.json)에 관찰·추론·한계를 구분했다.

원본은 카테고리 schema의 `imagePage.images.required`에 `sizeChartImage`가 있으면 상세 다음 사이즈표를 넣어 8단계가 된다. 이 조건부 7/8단계는 **기준 커밋 50d1cc5에 이미 구현돼 있었다.** 이번 신규 기능으로 집계하지 않는다. 최초 미구현 판단은 명세에서 정정했다. 실제 보완은 단계 조회 실패를 숨기지 않고 같은 범위에서 다시 확인하는 동작이다.

원본 견적 `startPage.productName`은 읽기 전용이며 상품명은 SEO에서 수정하도록 안내한다. 기본 견적 상품명과 정확한 native title wire에 같은 입력 방식을 적용했다. 이름이 같은 사용자 정의 필드·다른 wire·workbook 전용 필드까지 일괄 잠그지 않는다. 별도 수동 견적 상품명·공란은 유지하고, 사용자가 명시적으로 복원을 선택해 초안 저장을 할 때만 수정값을 해제한다. 기존 수동값 API 계약은 유지했다.

## 수집정보 수정과 대기열 연결

수집본은 카테고리를 선택할 때 capture ID·fingerprint·revision으로 고정된다. 기존에는 검토 저장으로 revision이 증가해도 대기열은 이전 revision을 가리켜 초안 시작과 재검토가 막혔다.

검토 저장 ACK를 부모에 전달하고, 검토를 열었던 정확한 행·이전 선택이 현재도 같을 때 새 revision을 연결한다. 회사·회원·불변 원문·capture identity·다음 revision을 확인한다. 카테고리·특징·키워드·행 순서와 이미 작업에 연결된 행은 보존한다. 같은 URL의 다른 수집본이나 단순 목록 갱신을 새 선택으로 자동 채택하지 않는다. 원문이 같은 이전 revision은 명시적으로 다시 검토할 수 있다.

저장된 ACK는 수집 목록에 즉시 반영하고 진행 중이던 이전 GET을 폐기한다. 늦게 도착한 목록·닫힌 검토 창·이전 계정의 callback이 선택을 되돌리지 못한다. 검토 중 대기열을 닫는 기존 흐름은 유지하여 이전 카테고리 추천·양식 준비 요청도 취소한다. [수집 연결 증거](../outputs/step764-source-review-proof.json)를 보관했다.

최종 독립 검수에서 닫힌 검토 창의 `onAdd`·닫기 callback이 같은 회원의 새 검토 창을 닫는 문제와, 첫 ACK를 건너뛴 행까지 다음 ACK의 대상으로 진전시키는 문제를 재현했다. 닫기·추가 모두 현재 검토 세션에 묶었고, 동기 대기열 갱신에서 실제 ACK를 반영한 행만 다음 검토 저장에 연결했다. 같은 회원 재진입·회원 A→B→A·정상 반복 검토·선택 변경 행의 연결 해제를 포함한 회귀 검사를 추가했다. [최종 독립 검수](../outputs/step764-source-review-final-audit.json)에 기록했다.

## 단계 조회 실패와 SEO 이동

등록 단계 조회가 실패하면 오류와 `등록 단계 다시 확인`을 표시한다. 확인되지 않은 단계로 이동하거나 전송 준비를 진행하지 않는다. 같은 카테고리의 마지막 검증된 단계 이름은 표시용으로만 유지하며, 새 GET이 성공해야 이동을 재개한다. 수동 재조회는 현재 회원·상품·버전·프로필 범위에 묶이고 이전 scope/ABA callback은 무효다. 자동 무한 재시도는 없다.

견적서의 `SEO 설정에서 상품명 수정`은 같은 상품의 SEO 단계로 이동한다. 다른 단계 초안과 기존 수동값은 지우지 않는다. 오래된 상품·옵션·refresh callback과 같은 틱의 다른 입력을 무시하는 title 복원 동작도 검사했다. [단계 재조회](../outputs/step764-layout-retry-proof.json), [견적 상품명](../outputs/step764-quote-title-proof.json)에 집중 검수 내용을, 최종 기록에 소스 SHA를 기록했다.

## 검수 범위

최종 고유 검사·타입·린트·빌드·배포·커밋은 [최종 검증 기록](../outputs/step764-final-validation.json)을 참조한다. 집중·독립 검사를 최종 묶음과 중복 집계하지 않는다. 기존 역사 URL 테스트의 child hook null stub는 실제 등록 단계·수집 목록 hook으로 교체했고, 기존 URL·대기열·취소·늦은 callback 단언은 유지했다.

Chrome 검수는 실제 Dashboard·API·임시 SQLite·합성 원문/PNG를 사용했다. 단계 GET 실패 1회를 주입하고, 재조회 후 SEO 미저장 입력 보존·단계 재활성화를 확인했다. 견적 상품명은 읽기 전용이고 SEO 버튼으로 같은 상품에 돌아갔다. API 쓰기와 실제 공급자·Hub 요청을 차단했으므로 이는 실제 수집·실제 접수 증거가 아니다.

전체 카테고리와 상태의 1~7단계 완전 동일성, 실제 1688 수집 및 Supplier Hub 원본 업로드·readback·최종 동의·docId/qvt/SKU 접수는 미검증이다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`, `PRODUCT_DOCUMENT_LIVE_VERIFIED=false`를 유지한다. 원본의 전체 옵션 덮어쓰기와 자체 수동값 보존 정책도 구분한다.
