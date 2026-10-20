# 비공개 법적 서류의 전송 준비

기준 커밋은 Step755 `49794ac84d684b0397a5aa45ffe78a4f7257a0f4`다. 같은 턴에서 수집 옵션 식별·인증서 연결 수정의 배포를 마친 뒤, 실제 전송에 필요한 원본 파일 준비를 추가했다. 기존 작업 상품은 사용하지 않았다.

## 구현

`buildNativeLegalAttachmentPlan`은 현재 서버가 검증한 법적 서류 context와 회원·회사·상품·분류·저장본 정체성으로 계획을 만든다. 카테고리 schema SHA, 전체 source fingerprint, 편집 input fingerprint, 상품·content·옵션·견적·profile clock, 포함 옵션 순서가 고정된다. 실제 수집 시 저장한 category를 사용하는 경로에서는 profile ID가 있어도 조회한 live profile revision은 null일 수 있다. 이 값을 만들어 넣지 않고 captured source fingerprint와 함께 그대로 유지한다.

PDF 원본의 저장 키·이름·SHA256·길이와 정확한 현재 제출 항목을 보관한다. 인증서 전송 별명은 `cert{schemaIndex}-{원본명}`이며 schema 행이 기준이다. 원본 파일명이나 바이트를 바꾸지 않는다. bucket·행·원본·target 중복, 이름 충돌(Unicode NFC·대소문자 포함), 다른 소유자 경로, 위험한 이름, 오래된 인증값, 공란 해당 여부, 파일당 5MB·합계 8MB·10개 초과를 거절한다. 일부분만 유효한 계획은 반환하지 않는다.

독립 검토에서 native 인증서 화면이 접두사 대신 `fileName.includes('cert{row}-')`로 파일을 찾는다는 점을 확인했다. 원본 이름에 `cert0-`가 있는데 다른 행의 `cert1-`을 붙이면 두 행에서 같은 파일을 인증서로 오인할 수 있다. 인증서 원본 이름의 예약 `cert숫자-` 토큰을 계획과 바이트 검증에서 거절하며 원본을 자동 개명하지 않는다. 준비 오류는 기존 검토 화면에도 표시한다.

계획의 정규화 SHA를 Single package fingerprint에도 포함했다. plan은 별도 `nativeLegalAttachmentPlan` sidecar로 반환하며 초안 JSON 본문에 PDF·base64·임의 s3Link를 넣지 않는다. 원본 URL은 현재 앱의 인증된 상품별 `legal-documents?key=…` 상대 경로이며 public image capability로 바꾸지 않는다.

통합 확장에는 `validateNativeLegalBytePlan`과 `prepareNativeLegalBytes`를 추가했다. 호출자는 현재 인증된 package에서 얻은 expected identity와 expected plan SHA를 별도로 전달해야 한다. 자기 manifest를 바꾸고 SHA만 다시 계산해서 통과하지 못한다. helper는 주입된 original reader로 받은 각 PDF의 실제 길이·SHA·헤더를 검증하고, 모든 파일이 끝난 뒤에만 `uploadFiles` part와 정확한 File/Blob 별명을 반환한다. 비동기 대기 중 입력 객체·reader buffer가 바뀌거나 취소되면 이전 결과를 반환하지 않는다.

이 helper는 fetch·쿠키·토큰 읽기·Supplier Hub 요청을 하지 않는다. `bytesVerified:true`는 신뢰한 manifest와 원본 바이트가 같다는 뜻이며 인증의 진위·원격 업로드·등록 접수를 뜻하지 않는다. 반환 결과의 `transportReady`, `remoteWrites`, `registered`, `submissionReady`는 false다.

## 검수

순수 계획 테스트와 확장 바이트 테스트 외에 실제 로컬 API·SQLite 검수를 추가했다. 두 회사 각각 원본 PDF 업로드 → 현재 인증 항목 연결 → Single package 계획 조회 → 인증된 원본 GET → 확장 바이트 준비가 이어진다. 원본이 같은 키에서 바뀌면 GET/바이트 준비가 거절되며 외부 업로드는 없다. 인증값 수정은 이전 연결을 무효화한다. 명시적 profile 조회와 수집 당시 저장 category 경로를 둘 다 검증한다.

초기 통합 테스트의 실패는 legacy fixture가 category를 URL query로만 지정하여 legal API의 저장 카테고리 경로가 없던 것이었다. 실제 수집 상품과 같이 fixture에 collection/category link를 넣었으며 앱의 카테고리 검증은 완화하지 않았다. 첫 실패 로그는 보존한다.

현재 Supplier Hub SR 공식 자산은 Step755의 DOM에서 확인한 `main.5239dce6.js`이며 SHA256 `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`로 보관한 Hub548 REA 입력과 같다. multipart part·bucket·schema 인증서 별명 계약은 이 동일한 client 정적 근거를 재사용했다. 새 vendor 코드 실행이나 1688 재접근은 없다.

확장은 준비 helper를 포함한 별도 2.1.7 ZIP으로 배포하며 이전 ZIP은 바꾸지 않는다. minimum compatible runtime은 2.1.4로 유지하고 반복 새로고침을 요구하지 않는다. 새 권한·provider·리소스·migration은 없다. 검사 수와 배포·패키지 SHA·커밋은 `outputs/step756-final-validation.json`과 HANDOFF Step756에 기록한다.

## 남은 경계

실제 Hub 새 docId에 multipart를 보내고 파일 조회로 보존을 확인하는 adapter·packet 연동은 아직 구현되지 않았다. 지금의 helper는 그 입력 원본을 검증하는 준비 단계다. 실제 현재 헤더·CSRF·응답 전체·첨부 바이트 재조회와 최종 접수는 관측하지 않았다. `SINGLE_LEGAL_DOCUMENT_TRANSPORT_UNVERIFIED`와 두 live gate false를 유지한다. 실제 새 1688 수집 → 전체 단계 수정 → Hub 접수 완료를 주장하지 않는다.
