# Step717 — 초기 카테고리 확인으로 수동 가격이 사라지는 문제

기준은 `1ef3c7ccd5478da7b10f9c03142086dd46ddeae2`다. 기존 작업 상품·설정·실제 견적서를 바꾸지 않고 카테고리 연결과 단계별 수동 수정의 경계를 조사했다.

## 연결 검토

보관한 Couplus 클라이언트에서 최종 카테고리 code/path를 새 대기열 행에 보관하고, 해당 URL의 원문을 받은 뒤 그 code의 schema/document를 연결하는 흐름을 확인했다. 실패 재시도도 행의 카테고리를 유지한다. REA의 새 조사와 기존 Step664/715 근거를 [카테고리 감사](step717-intake-category-parity-audit.md)에 구분했다. 자체 picker→회사·profile revision·공식 schema 캡처→collection/import의 기존 검증을 읽은 범위에서는 새로 확정된 불일치를 찾지 못했다. 이 결과가 모든 실제 카테고리의 기본값 동일성 검증을 뜻하지는 않는다.

기존 Chrome의 원본 ‘상품 추가’→빈 대기열→카테고리 선택 창을 읽고, 아무 카테고리도 확정하지 않은 채 두 창을 닫았다. 기존 상품·필터·URL·각 단계는 조작하지 않았다. AX를 보관했으나 screenshot은 CDP 시간 초과로 저장되지 않았다. 새 URL 요청과 상품 저장·전송은 없었다.

## 재현한 입력 유실

상품 상세 화면의 숨겨진 7단계도 처음부터 카테고리를 조회한다. 2단계 옵션 가격은 먼저 수집 당시의 기본 scope로 열리는데, 늦은 7단계 조회가 같은 captured profile ID를 부모에 명시 선택으로 통지했다. 가격 편집기는 이를 다른 scope로 판단해 대기 입력을 비웠다.

양사 회사 schema와 합성 인증·원문을 사용한 실제 자체 GET·격리 SQLite·React callback 검증에서 판매가 `22222` 입력이 저장값 `7100`으로 돌아가고 dirty가 false가 됐다. 해당 예시의 두 GET은 상품 버전·견적 revision·schema·해석된 행·옵션 포함 선택이 모두 같았고 PUT도 없었다. 이전 원문과 DB가 변하지 않아도 사용자 입력을 잃는 UI 문제다. 실제 두 회원 로그인이나 실제 Hub 조회·접수 증거는 아니다.

초기 자동 확인과 사용자의 명시 선택을 구분한다. 다만 같은 profile ID라도 현재 template과 수집 당시 frozen template, profile revision·fingerprint는 다를 수 있다. 따라서 가격 편집기의 scope 초기화 보호를 완화하거나 같은 카테고리라는 이유로 입력을 다른 원천에 이전하지 않는다. 7단계의 기존 자체 profile 선택·Excel export 동작 전체가 이 수정으로 동일 검증됐다는 주장도 하지 않는다.

## 수정과 집중 검증

`QuotationPanel`의 초기 응답에서 preferred profile이 없고, 원문 출처가 collection이며, 선택 결과가 존재하는 captured profile ID·카테고리 code/path와 정확히 일치할 때만 부모 통지를 기본 scope(`undefined`)로 유지한다. 7단계 자체의 선택 ID와 override, 선택 UI·준비·다운로드는 기존 동작을 유지한다. 명시 preferred 선택, 수동 상품의 자동 profile 선택, 카테고리 불일치·무효화, 사용자의 직접 select 변경은 기존처럼 전파한다. 옵션 가격 편집기의 scope·fingerprint·revision·저장 검증은 변경하지 않았다.

신규 7개 및 기존 quotation panel 31개의 집중 검사 **38/38**이 통과했다. 양사 사례는 실제 `DetailPanel`→늦은 `QuotationPanel` 효과→부모 scope→실제 `OptionQuotationPrices`→자체 API·격리 SQLite의 흐름을 사용했다. 다른 단계의 말단 컴포넌트와 ProductOptionsEditor의 외형은 fixture로 대체하므로 전체 브라우저·옵션 표 UI 검증이라는 뜻은 아니다. 입력 `22222` 보존, 명시 PUT 1회와 실제 작성 XLSX 값, 포함 5/제외 1 선택 및 수집 원문 보존을 확인했다.

현재 저장 profile의 revision·template dataStartRow를 바꾼 경우에도 queryless 쪽 frozen context/fingerprint가 그대로인 반면 explicit profile은 다른 fingerprint와 현재 template을 사용하는 차이를 검사했다. 두 원천을 같은 것으로 합치지 않았다. 7단계 자체가 현재 profile의 9행을 출력하는 기존 의미도 별도로 유지했다. 명시 preferred ID 유지, 수동 상품의 실제 다른 profile 전환에서 이전 초안 저장 차단, unknown의 기존 자동 선택, 카테고리 불일치, 취소 뒤 늦은 응답과 새 상품 재열기도 검사했다.

수정 전 HEAD 원문을 메모리 읽기에만 주입한 검사에서는 신규 7개 중 3개가 실패했다. 양사의 `22222`와 새로 연 상품의 `25555`가 저장값 `7100`으로 돌아가는 동일 결함이다. 원래 소스와 테스트 파일을 바꿔 재현하지 않았다. 신규 fixture의 첫 실행 5/7에서 남은 두 실패는 저장 성공 뒤 XLSX archive를 Array로 읽은 검사 코드 오류였고 Map 접근으로 수정했다. 이 로그와 최종 38/38 결과를 구분해 보존했다.

첫 종합 실행은 21개 파일 376개 중 365개가 통과했다. 기존 가격 fixture의 React `useMemo` 누락 9개와 공통 SEO 제목을 옵션 합성 견적 제목과 무조건 동일하다고 가정한 기존 카테고리 fixture 2개는 이전 HEAD에서도 같은 실패를 재현했다. 테스트 두 파일만 현재 계약에 맞춰 보완했다. 가격은 실제 dependency 비교·캐시 hook을 추가했고 기존 단언은 바꾸지 않았다. 카테고리는 기존 회사·profile·공식 양식·보호용 합성 상품 보존 검사를 유지하면서 저장 SEO 문서, 문서가 없을 때의 정확한 합성, 수동 견적과 명시 공란 우선순위를 강화했다. 앱 검증을 완화하지 않았다.

## 검증 경계

실제 신규 1688 전체 SKU/CNY/MOQ·사진/상세 수집과 Supplier Hub 최종 docId/qvtRequestId/SKU 접수 대조는 남아 있다. 이전 자동 승인 검토가 거절한 1688 URL·도메인을 다른 도구·앱·확장·CLI로 우회하지 않는다. 운영 전송 gate 및 `SINGLE_DOCUMENT_LIVE_VERIFIED=false`를 유지하며, 사용자 작업 상품은 보호한다.

## 최종 회귀와 배포

최종 같은 소스·테스트로 관련 **21개 파일 376/376 통과**(신규 7개 포함), fail/cancel/skip/todo 0, 174.55초다. 집중 38/10/23개와 HEAD·실패·반복 실행은 이 합계에 더하지 않았다. 소스/설정/시험 1,296개 SHA가 실행 전후 같았고 추가·삭제도 없었다. 전체 저장소 suite라는 의미는 아니다. 원본 유앤채 Excel 양식을 다른 회사 fixture에 재사용한 기존 가격 검사는 실제 와이홉 전용 양식 검증으로 세지 않는다.

타입·앱/DB와 변경 시험 lint·schema(44 tables, 17 indexes, 29 modules)·운영 빌드·diff 검사가 통과했다. 초기 scope 수정·신규 회귀와 기존 fixture 두 파일은 독립 읽기 검토를 받았고 잔여 지적은 없었다. `outputs/step717-final-verifier.mjs`가 최종 소스/검사·실패 재현·독립 검토·REA slice/재사용 증거·확장 ZIP·빌드·배포 ID를 대조한다.

기존 무료 Worker에 version `4aba3247-365f-4123-9725-9fad7dbe8730`을 배포했다: https://sourceflow.jjwwhhjj1116.workers.dev/ . 새 DB migration·리소스·유료 공급자·인증/R2 권한은 추가하지 않았다. 확장 소스·다운로드 0.2.78은 이번 변경이 없으며 ZIP SHA256은 `37c5b8fccc9ccd9abbebc03b82a8bc652ff0141267dfc7bd1a0ab17a64688b83` 그대로다. 설치 확장 갱신·재조회나 로그인·확장 새로고침 요청도 없었다. 브라우저에서 이 수정을 실제 작업 상품에 적용해 검증하지 않았고, 기존 상품·저장 설정·실제 Hub 견적에는 쓰기 작업이 없었다.
