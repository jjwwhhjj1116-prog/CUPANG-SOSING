# SR 단계 검증의 다중 결과 배열 처리

보관된 공식 SR Main과 YOOFAM의 단계 검증·접수 상태 전이를 비교했다. 라이브 브라우저·서버·문서 2347603은 이번 조사에서 읽거나 변경하지 않았다. 아래 테스트는 합성 응답을 사용하며 실제 접수를 증명하지 않는다.

## 정적 근거

원본 `outputs/step755-current-sr-main.js`의 SHA-256을 다시 확인했다: `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`. 범위는 0부터 시작하는 반개방 UTF-16 offset이다.

- `validateStep` `[2871459,2872242)`는 POST `/qvt/api/validate-step/{step}`에 `{docId, version: schemaInfo.version}`을 보낸다. `code === 200`이면 **data 배열 전체**에서 실패 행을 골라 오류를 모은다. 결과가 한 행이어야 한다는 조건은 없다.
- 이 함수는 기존 REA parent Evidence `ev_96936025b26ce0cebf6021c34efc5c48a480e8d631e4beb7e10dd47ad3fc596a`, summary `ev_c2e0c1cf8e3b5fd6cbdc413cecca083100248d89e9900fbddc47749a0144e7ae`의 정확한 구간 분석에 포함되어 있다. 보관 bundle은 `outputs/step876-reautils-evidence.json`, 구간 manifest는 `outputs/step876-reautils-next-manifest.json`이다. 해당 분석은 5개 구간 16,383바이트를 5/5 파싱했고 실패는 0건이며, 1,209개의 동적/외부 의미 unknown이 남는다.
- 별도 `validateDraft` `[2870643,2871458)`는 POST `/qvt/api/validate-single-product`에 같은 `{docId, version}`을 보낸다. 최종 응답은 `data.success`인 **객체**다. 단계 응답의 배열 parser를 이 최종 응답에 적용하면 안 된다. 이 최종 함수는 같은 SHA의 보관 원문을 정적으로 확인했으며 별도 런타임 관측은 하지 않았다.
- 공식 Next handler `W4` `[4134287,4143643)`는 저장→단계 검증→파일 처리/다음 단계→최종 검증을 구별한다. 따라서 단계 검증 성공 자체는 접수 영수증이 아니다. 공식 UI의 Next가 본문 저장도 실행한다는 기존 분석은 `docs/step876-retained-certificate-association.md`에 있다.

## 확인된 구현 차이와 수정

기존 `validateSingleStepResponse`는 `data.length === 1`을 강제했다. 서버가 여러 결과를 반환하면 모두 성공이어도 실패했다. 동시에 직렬화된 Hub adapter는 `data[0].success`만 보고 validated로 표시해 뒤쪽 결과를 반영하지 않았다. **현재 서버가 원래 886 요청에 실제로 몇 행을 반환하는지는 미관측**이므로, 이를 현재 복구 실패의 실증된 원인으로 단정하지 않는다.

수정은 공식 배열 계약을 지원하되 확인 불가능한 성공을 만들지 않는다.

- 결과는 1~200행의 빈틈 없는 배열이어야 하고 모든 행의 success는 boolean이어야 한다. 결과 행 수가 상품 옵션 수와 반드시 같다고 가정하지 않는다.
- 모든 행이 true일 때만 성공한다. 하나라도 false이면 전체 단계를 거절하고 실패 오류를 모두 보존한다. 총 오류는 기존 제한과 같은 200개 이하이며 columnName/message의 형식·길이 제한도 유지한다.
- 빈 배열·빠진 data·빈틈 있는 배열·잘못된 오류·성공과 오류의 동시 표시는 거절한다. 공식 클라이언트는 비어 있는 오류 집계나 missing data를 관대하게 처리할 여지가 있지만, 이를 접수 가능한 성공 증거로 복제하지 않는다.
- 직렬화된 adapter도 전체 결과를 검사한다. 불명확한 응답은 원래 응답을 observed로 보관하되 validation-requested 상태를 유지한다. 요청 직전에 동일 상태를 기록하며, 같은 단계 요청 표식이 있어 자동 재전송하지 않는다. 읽기 복구는 저장된 동일 응답을 다시 검증한다.
- 단계 POST의 docId/version, 현재 읽기 복구의 파일·본문 재전송 금지, 별도 최종 제출·영수증 검증은 변경하지 않았다. registered는 단계 성공만으로 설정되지 않는다.

수정 파일은 `extensions/supplier-hub/single-document.mjs`, `extensions/supplier-hub/single-document-adapter.mjs`다. 두 직렬화 경계의 계약 일치는 `tests/supplier-hub-single-document.test.mjs`, `tests/supplier-hub-single-document-adapter.test.mjs`에서 검증한다. 3행 전체 성공, 2·3번째 행 실패, 전체 오류 수 제한, 불명확한 응답 보관과 같은 단계 재요청 차단을 포함한다.
