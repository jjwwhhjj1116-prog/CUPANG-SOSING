# Step654 — 개별 양식으로 카테고리 선택·URL 입력, Hub 문서 조회 수정

2026-10-14. 기존 사용자 Chrome만 사용했다. 기존 쿠플러스·YOOFAM·Supplier Hub 상품을 저장·수정·삭제·전송하지 않았다. 이 단계는 전체 카테고리 및 실제 1688→Supplier Hub 접수 완료를 의미하지 않는다.

## 카테고리 입력 지연 수정

현재 쿠플러스의 `selectCategory` [400689,401142), `completeSelection` [401143,402141)는 최종 카테고리의 코드·경로를 대기열에 넣고 URL·특징·키워드 입력을 준비한다. 이 구간에는 Excel 다운로드가 없다. 대상 chunk SHA-256은 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`이며 원문 구간은 실행하거나 앱 소스로 복사하지 않았다.

이전 YOOFAM은 새 live 카테고리를 선택할 때 개별 등록 양식 외에 공식 Excel과 별도 Excel schema까지 먼저 요구했다. Excel 조회 실패가 정상적인 URL 입력을 가로막았다. 기본 선택은 이제 현재 승인 회사·카테고리 코드·전체 경로·명시적 `Retail_Categorized_Single` 원문 양식을 확인하고 URL 입력으로 이동한다. 미확인/Excel scope는 저장 전에 거절한다. 이미 저장된 수동 분류와 Excel 연결은 보존한다. 접힌 고급 설정에서 Excel 연결을 선택한 경우에만 기존 파일·양식·열 매핑 및 원본 fallback 검사를 수행한다.

대기열과 견적 항목 미리보기는 정상 Single 연결을 `개별 견적 양식 연결`로 표시한다. Excel 부재를 개별 등록 오류로 표시하지 않는다. 기존 상품의 선택한 카테고리·설정 snapshot을 바꾸지 않는다.

## 현재 Supplier Hub의 정확한 문서 조회

같은 Chrome의 별도 읽기 탭에서 현재 등록 페이지에 로드된 `/sr/static/js/main.5239dce6.js`를 확인했다. 관찰된 공개 파일만 다운로드했으며, SHA-256 `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`로 기록된 분석 파일과 동일했다. 인증정보·브라우저 storage는 읽지 않았다.

REA 핵심 Evidence: `ev_7bccb57e05307a52efc7ae3b1f8a61f5f96ef3cd32e29faeaf569b4b78483157` (20구간 parse20/20), `ev_eec07247224a1bfd75967f307b1af673ddf3399ec2b5ad64c355a6073e0f1f48` (8구간 parse8/8). 정적 분석과 현재 파일 동일성 확인이며 실제 API 응답이나 접수 관찰은 아니다. 상세 기록·offset·해시는 로컬 `outputs/step654-hub-contract-findings.md`, 두 manifest에 보관한다.

- 목록 GET `/sr/draft/api/drafts`는 문서 목록이다.
- 전체 문서는 GET `/sr/draft/api/get-by-id/{docId}`의 직접 응답 객체이다. loader는 `jsonDocument`, `status`, `version`을 사용한다.
- 중간저장 행은 React key/closure에 docId를 갖지만 DOM `data-doc-id`를 출력하지 않는다. 정확한 문서 deep-link는 조사 구간에서 확인되지 않았다.
- 최종 제출은 POST `/sr/qvt/api/validate-single-product`의 `{docId,version}`이며 `code=200`·`data.success` 후 완료 UI로 이동한다.
- GET `/sr/draft/api/drafts/register-requested`는 `docId/status/qvtRequestId`를 표시한다. `SUBMITTED`, `REJECTED`, `FINISHED`를 실제 SKU 완료와 동일시하지 않는다. 완료 문구에는 문서·접수·SKU 식별값이 없다.
- MSRP와 라벨 연락처 동의는 중간 단계의 별도 UI/약관 절차이다. 기본값 true나 이전 포괄 승인은 현재 동의 증거가 아니다.

확장 adapter는 자기 요청이 새로 생성한 정확한 docId만 get-by-id로 조회한다. 목록을 전체 내용으로 오인하던 부분을 제거했다. 직접 응답 형태, 문서 ID, 편집 가능한 상태, Single scope와 한 옵션을 검사하고 코어가 저장 본문·버전을 별도로 비교한다. 기존 문서 조회, 잘못된 ID, wrapper, 누락/변경된 본문·버전, HTML/HTTP 오류를 거절한다. 생성/수정 ACK 유실은 조회로 복구하며 POST를 반복하지 않는다. 운영 Single mutation gate는 여전히 false이며 실제 문서 UI 연결·약관 확인·접수 증거를 확보하기 전 활성화하지 않는다.

## 검사와 운영 반영

최종 검사 194/194 PASS, fail/skip0: 카테고리·회사·선택·Excel 회귀 98, Single 코어/직렬화 adapter 52, 확장·모바일 수집·견적 미리보기 44. 마지막 그룹의 오래된 다운로드 주소 기대값을 현재 manifest와 실제 ZIP에 연결하고, 버전만 같아도 필요한 기능이 없으면 업데이트 표시가 유지됨을 검사했다. 초기 실패 진단 로그는 성공 집계에 포함하지 않는다.

두 회사의 실제 앱 API와 임시 SQLite로 설정→Single 분류→URL 수집 요청→합성 중국어 원문/옵션 및 번역→저장 7단계→Single 문서를 검수했다. 기존 합성 상품·19개 이미지·설정·원문 보존을 확인했다. 실제 1688/Google/모델/Hub를 호출한 시험은 아니다.

동일 Chrome의 loopback에서 실제 `CategoryPicker`, `IntakeQueuePanel`, `IntakeQuotationPreview`를 사용해 저장된 합성 Single 분류→URL 입력 focus→36개 견적 항목을 검수했다. 수집 시작·전송은 실행하지 않았다. 화면 `outputs/step654-native-intake.png`, DOM/proof는 같은 prefix 파일에 보관한다. 검수 서버와 소유 탭은 종료했다.

전체 TypeScript·운영 build/산출물 검사와 변경 lint를 수행한다. lint의 intake queue 기존 `onBusy` effect 의존성 경고 1개는 변경 범위 밖이며 오류는 없다. 새 DB migration은 없다. 기존 계정별 설정·D1/R2/Access·Google 무료 번역·무료 AI 제공자 정책을 유지한다.

확장 0.2.67 ZIP: 45파일, 618,808bytes, SHA-256 `abda99171fbad3742fe2577a551abe7f776f9b6d486533d553e9f15d0ee6b2e9`. 이전 ZIP은 보존한다. 사용자 Chrome의 새 버전 reload를 확인했다고 주장하지 않는다. 카테고리 선택 수정은 서버 앱 변경이며 이번에 확장 reload를 요구하지 않는다.

기존 Worker에 배포 완료: **`f9cc6ec6-497b-4d1a-8dd5-4dea298968bf`**, startup15ms. 같은 Chrome에서 관리자 로그인, 기존 `YP-22E079FC` 미선택 상태, 복구된 대기열의 두 URL·특징·키워드 보존을 읽기로 확인했다. 실제 Supplier Hub 카테고리 1단계 16개를 조회하고 새 Excel opt-in이 미선택임을 확인했다. 최종 분류 선택/설정 저장/수집 시작/전송은 실행하지 않았다. 팝업은 닫고 새 운영 페이지를 유지했다. 운영 화면 `outputs/step654-production-category.png`, `step654-production-proof.json`에 보관한다.

## 남은 동일 구현 범위

현재 통합통관 계산식은 구현돼 있지만 YOOFAM의 수동 통합 환율과 쿠플러스의 서버 제공 환율 방식은 다르다. 관찰한 290원을 모든 회원에 덮어쓰지 않았다. 실제 1688 원문 수집, 전체 카테고리 기본값, 새 문서의 정확한 UI load, 중간 약관의 현재 확인, 문서별 접수·SKU 완료는 미검증이다. 기존 작업을 불러오거나 수정하여 이 검증을 대체하지 않았다.
