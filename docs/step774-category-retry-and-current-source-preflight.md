# Step774 — 추천 카테고리 재시도와 전송 전 현재 원본 확인

2026-10-21. 기준 커밋 `caea04f9f0f7c5e6b97649c4f8a2e573ca49512e`.

## 변경

- 추천 후보의 상세 카테고리 조회가 실패하면 기존 라디오 선택과 오류를 유지하고 **선택한 카테고리 다시 적용**을 제공한다. 같은 후보를 명시적으로 재적용하므로 추천 API를 다시 호출하지 않는다. source/profile/category/owner 또는 검색어가 바뀌면 이전 요청·오류·버튼은 폐기한다. 같은 값으로 돌아와도 과거 callback을 재사용하지 못한다. 완료 뒤 프로필 목록 갱신이 중복 저장을 허용하지 않는다.
- 전체 상품 견적의 preview가 실제 앱의 현재 로그인 회원·회사·견적 본문·전송 이력·세션을 다시 읽어 확인한다. packet 자체 검증만 통과한 상태를 현재 원본 확인으로 취급하지 않는다. native 원본과 기존 legacy 원본의 실제 adapter를 사용하며 원래 응답 형식은 유지한다. preview는 Hub 탭·문서·파일·동의·전송·접수 기록을 만들지 않는다. 실제 Hub 로그인 검증을 수행했다고 표시하지 않는다.
- 직렬 원본 조회에 맞춰 확장 전체 preflight는 90초, 앱 응답 대기는 95초로 같은 모듈에서 정의한다. 시간이 초과되면 늦게 온 원본·adapter가 성공 결과나 후속 작업을 만들지 못하며 adapter를 한 번 정리한다. 이미 실행된 Chrome 읽기 script는 해당 API로 취소할 수 없으나 늦은 결과를 성공 처리하지 않는다. 다른 action의 제한 시간과 두 live release gate는 유지한다.
- 통합 확장 2.1.14와 앱의 다섯 다운로드 링크를 갱신했다. 권한·호스트·기존 archive를 보존한다. 설치된 Chrome의 확장 버전 적용은 이번 배포 검수에 포함하지 않는다.

## REA 계약 재검토와 실제 브라우저 관찰

보관 Supplier Hub artifact `outputs/step548-hub-main.js` SHA `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`을 기존 근거와 함께 재검토했다. 역사 parent Evidence는 `ev_7bccb57e05307a52efc7ae3b1f8a61f5f96ef3cd32e29faeaf569b4b78483157`, summary는 `ev_786c61028e9543ec0f0a5ae873667c78adf08a28629811cca462f14164110e87`이다. 현재 세션에서 보존되지 않은 전체 Evidence를 새 조회한 것처럼 주장하지 않는다. 원본 선택 범위·조각 SHA는 `outputs/step774-native-ack-contract-review.json`에 보존했다.

원본은 multipart 업로드 응답·파일 목록·문서 저장·단계 및 최종 validation을 사용한다. **업로드 파일 전체를 다시 내려받아 SHA를 비교하는 것은 확인된 원본의 필수 업무 단계가 아니다.** 이전 인계에서 그 부재 자체를 접수의 직접 차단 원인처럼 기술한 부분을 정정한다. 현재 자체 adapter도 정확한 ACK와 같은 문서의 파일 목록이 일치하면 본문 갱신을 허용하며 `remoteBytesVerified:false`를 별도로 유지한다. 실제 접수 차단은 미검증 live release gate이며, 원격 바이트 재다운로드만으로 해소되는 문제가 아니다.

기존 Chrome의 Supplier Hub에서 **유앤채 / A01526306** 로그인과 빈 신규 개별상품등록 화면을 확인했다. 기존 상품 행은 열지 않았다. 신규 화면에도 입력·저장·문서 생성·파일 업로드·동의·제출은 하지 않았다. 회사 확인 screenshot과 관찰 기록은 `outputs/step774-ui/hub-new-document-account.png`, `outputs/step774-hub-live-entry.json`이다. 현재 script URL을 관찰했을 뿐 내려받거나 실행을 분석한 것은 아니다.

## 검수

실제 React 부모·추천 라디오 자식과 실제 로컬 settings/profile API·임시 SQLite를 연결한 Chrome 검수에서 추천 1회 → 상세 조회 503 → 같은 후보 재적용 → 상세 조회 200 → 현재 회사 Single 양식 1회 → profile POST 201 1회 → 선택 완료를 확인했다. 외부 추천·양식 제공자는 합성 자료이며 실상품 분류 정확도 검증이 아니다. 보호 합성 상품과 파일은 변경되지 않았다. `outputs/step774-browser-final-checkpoint.json`, `outputs/step774-category-browser/proof.json`, `outputs/step774-ui/category-retry.png`, `outputs/step774-ui/category-selected.png`.

독립 검토에서 확정된 오류 이후 profile/category ABA와 느린 preview 응답의 두 P2를 발견해 수정했다. 과거 버튼의 재승격·완료 후 중복 저장·지연 성공·timeout 후 늦은 응답·정리를 검사한다. native/legacy 두 회사 adapter와 기존 receiver·receipt 로컬 회귀도 포함한다. 최종 **18파일 210/210 고유 검사 통과**다. 마지막 절대 시각 guard 추가 뒤 영향을 받는 17파일을 재검사했으며 변경하지 않은 느린 native receipt-chain 두 회사 검사는 앞선 합집합 결과를 유지했다. TypeScript·변경 파일 ESLint 오류/경고 0·운영 빌드 통과다. 실제 원격 접수 성공을 의미하지 않는다. 검사 목록·단언명, 확장 ZIP의 정확한 SHA·Worker 버전·커밋과 push 결과는 `outputs/step774-final-validation.json`에 기록한다. 집중·중복 재실행 개수는 합산하지 않는다.

초기 검수 서버의 CSS import 조건·누락된 provider export를 보완했다. 브라우저의 전체 화면 캡처가 시간 초과되어 문서 영역을 지정해 캡처했다. 로컬 profile 생성은 201 응답이므로 검수 assertion을 그 계약에 맞췄다. 기존 wire 검사의 과거 버전 2.1.7 고정값은 유효한 manifest 버전 형식과 다섯 실제 링크·권한·호스트의 일치 검증으로 바꿨다.

## 남은 범위

실제 1688 읽기는 이전 자동 승인 검토 거절 이후 재시도하지 않았다. 실상품 수집부터 원격 신규 문서의 업로드·저장·validation·동의·docId/QVT 접수까지의 연결은 아직 검증하지 못했다. 두 `LIVE_VERIFIED`는 false다. 접수 파일 처리와 옵션별 발급 SKU도 구분한다. 모든 카테고리와 1~7단계의 모든 팝업·입력 상호작용이 원본과 같다고 보고하지 않는다. 이번 변경은 신규 리소스·DB migration·인증 정책 변경을 포함하지 않는다.
