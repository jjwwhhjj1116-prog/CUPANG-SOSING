# Step669 — 상품·옵션 등록번호 연결

신규 상품은 서버에서 발급한 표시번호를 저장하고 목록, 옵션 팝업, 견적서 인쇄 제목, 삭제 목록과 상품 관리에서 같은 번호를 사용한다. 옵션을 검색하거나 순서를 바꾸고 삭제했다 다시 추가해도 저장된 옵션번호는 바뀌지 않는다. 내부 UUID, URL, 가격, SEO, 원문, 파일과 전송 식별자는 계속 기존 식별자를 사용한다. 운영 상품의 번호를 다시 매기거나 데이터를 보충하는 작업은 없다.

## 쿠플러스 근거와 구현 정책

REA는 보관된 배포 UI의 `generateRegistrationId`를 확인했다. 날짜 접두사는 브라우저 로컬 시간의 YYMMDD이며 `/api/rocketReg/issueRegistrationId`에 제출한다. 성공 응답의 번호를 그대로 저장한다. 옵션번호는 발급번호의 앞 아홉 글자에 1부터 시작하는 최소 세 자리 옵션 순번을 붙여 생성·저장한다. SKU가 없는 경우 끝자리는 001이다.

생성 함수의 UTF-16 위치는 [466255,466661), UTF-8 위치는 [513664,514094), 함수 SHA-256은 `bc589bca3ff027c53459830e9f1b48f9b12784aea1a203d5d8e1b7a1e7004071`이다. 신규 REA Evidence는 `ev_320af53e7a0551f6d4d42a021453037b7e2f6319f628ab72730730a6cf6fc974`; 옵션 생성·저장은 정확한 원본 digest가 일치한 `ev_1983224a44e1100a435aca7caaa76ebb6e1d9df782252092d57dcc695765e8ee`를 재사용했다. 원본과 선택 메서드, 모든 위치·digest·unknown은 ignored `outputs/step669-registration-number-audit/source-manifest.json`에 있다. vendor 코드 실행·상품 수정·새 사이트 접근은 없었다.

쿠플러스 서버 내부의 일별 순번, 회사별 분리, 동시 발급과 초기화 규칙은 확인되지 않았다. **회원별 KST 날짜와 001~999 순번, 12자리 번호는 YOOFAM의 발급 정책**이다. 서버 내부까지 동일하다는 주장은 하지 않는다. 쿠플러스의 `padStart`는 1000 이상을 자르지 않지만 YOOFAM은 999를 넘으면 저장 전체를 실패시켜 중복·잘린 번호를 만들지 않는다.

## 저장·조회 경계

- `0024_product_registration.sql`은 표시번호용 세 테이블만 추가한다. 상품 생성과 카운터·번호 저장을 같은 D1 batch에 넣는다. 수동 생성, 실제 수집 결과 승격, 명시적인 새 초안 만들기에 적용한다. 실패한 companion, 취소·경합·조건 불일치와 초과 발급은 전체 트랜잭션을 되돌린다.
- 기존 상품 조회나 승격 재시도는 번호를 발급하지 않는다. 번호가 없는 기존 API 객체에서는 속성 자체를 생략하고 기존 YP 표시를 유지한다. 새 초안은 새 번호를 받고 원본 상품은 그대로이다.
- 옵션 UUID와 순번의 별도 매핑을 저장한다. 삭제된 UUID의 매핑도 보존한다. 옵션 저장 성공의 `changes()`, 정확한 payload·revision·상품 clock을 확인한 뒤 처음 보는 UUID만 다음 순번을 받는다. 수집·fork의 최초 옵션 매핑도 같은 생성 batch에 포함한다.
- 옵션 API는 현재 rows에 해당하는 `optionRegistrationNumbers`만 별도로 반환한다. 기존 옵션 payload, provenance와 UUID는 바꾸지 않는다. UI는 잘못된 번호·중복·다른 상품 접두사·존재하지 않는 옵션 매핑을 거절하고, 매핑이 없으면 실제 옵션 ID를 표시한다.
- 목록·상세·편집·가격 저장 응답·삭제 복원과 상품 관리 조회에서 번호를 유지한다. 상품 관리의 번호 검색은 소유자와 저장번호에 한정하며 같은 URL의 수집 요청에 상품번호를 붙이지 않는다.
- 표시번호를 자동작성·견적서 편집·다운로드의 입력 fingerprint에서 제외했다. 표시 메타데이터는 검토값을 무효화하지 않으며 실제 가격·원문 변경은 계속 검증한다. CSV의 상품 ID와 파일명은 UUID를 유지한다.

## 검수

최종 18개 파일 **324/324 통과**, fail/cancel/skip 0. 타입 검사와 변경 파일 lint, 스키마 및 배포용 빌드가 통과했다. 현재 스키마는 앱 테이블 40개, 명시 인덱스 17개, runtime 모듈 26개이다. 증거는 ignored `outputs/step669-final-tests.log`, `step669-final-types.log`, `step669-final-lint.log`, `step669-build.log`에 있다. 타입 검사의 처음 128/512MB 실행은 메모리 한도로 실패했으며 최종 1536MB 실행이 성공했다.

기존 테스트 하나는 현재 저장된 일반 검토용 표시사항 기본값과 다른 빈 문자열을 기대했다. 정확한 HEAD 테스트를 별도 ignored 파일에서 실행해 같은 실패를 확인했고, 초기화 소스의 HEAD blob과 작업 파일은 `26c208dd43d19c36628527dfa89d03f25d86ede2`로 일치했다. 생성된 검토용 기본값이라는 provenance와 미선택·잘못된 ID의 빈 기본값을 검사하도록 기대만 갱신했다. 표시사항 기본값의 앱 코드는 수정하지 않았다. 이는 모든 실제 카테고리의 적합성이나 상품 제조국을 확인한 증거가 아니다.

지정된 기존 Chrome 프로필에서 실제 RegistrationBoard·ProductOptionBoard·ProductRemovalDialog, 실제 API와 임시 SQLite 회원 세션 fixture를 사용했다. 최종 실행에서 와이홉 fixture의 신규 POST, 옵션 GET과 실제 순서 변경 PATCH가 성공했다. DOM 5개 조건은 신규 번호와 legacy 표시 보존, B 검색 후 002, SEO 콜백의 원래 UUID, 재정렬 저장과 002 유지이다. API 근거 12개 요청, 번호 행 1개, 기존 두 fixture 상품 그대로, legacy 번호 추가 0, 실제 앱 소스 hash 그대로이다. 실제 회원 로그인·운영 DB·1688 수집·번역 provider·Hub 전송은 실행하지 않았다.

검수 삭제 확인창에서 CDP focus 명령이 응답하지 않았다. 실제 Chrome 삭제·복원 완주, PNG와 자체 탭의 수동 정리 성공을 주장하지 않는다. 삭제·복원과 두 계정 분리는 실제 SQLite/API 회귀 검사로 검증했다. 근거는 ignored `step669-native-dom-checks.json`, `step669-native-filter-dom.txt`, `step669-native-reordered-dom.txt`, `step669-number-native-proof.json`이다. 준비 과정의 fixture 런타임·요청 형식 오류는 수정했으며 최종 실행 근거만 완료 조건에 사용했다.

## 배포 상태와 남은 작업

기존 무료 D1에 `0024`의 빈 테이블만 추가하려는 요청은 Cloudflare 인증 오류 10000으로 거절됐다. migration 적용·운영 상품 변경·새 Worker 배포는 완료되지 않았다. 현재 운영 버전은 Step668의 `c9f47c1e-9d46-49c7-8eb4-fef0f70d8021`이다. 인증 복구 뒤 준비된 SQL 적용과 같은 무료 Worker 배포를 이어간다. 새 DB·유료 자원·권한 확대는 없다.

구현 커밋 `10633b9fe7f7bc1dbbe7255945447e46b1e01eec`은 GitHub main에 푸시했고 HEAD와 origin/main이 일치했다. 공식 Wrangler 인증 복구 요청에서 R2 쓰기 권한을 포함한 첫 시도는 자동 승인 검토가 거절했다. 현재 배포에 필요한 `account:read`, `user:read`, `workers:write`, `d1:write`로 줄인 공식 인증 요청은 실행됐으며, 같은 Chrome의 Cloudflare `Consent Application` 탭에서 사용자 인증 완료를 기다린다. R2·offline 권한을 다시 요청하거나 거절을 우회하지 않았다. 콜백·인증 성공과 배포 성공은 아직 확인되지 않았다.

실제 새 URL 전체 SKU·이미지 수집, 모든 카테고리 양식·기본값 대조와 Supplier Hub 동의→최종 등록→접수증/SKU 대조는 남아 있다. `SINGLE_DOCUMENT_LIVE_VERIFIED`와 운영 mutation gate는 false이다. 과거 거절된 URL을 다른 도구로 우회하거나 기존 작업 상품을 수정하지 않는다. 이 단계의 통과는 전체 제품 완성률이나 실제 Hub 등록 성공률이 아니다.
