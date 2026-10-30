# 보관 SR 클라이언트의 인증서 파일 연결 재분석

대상은 사용자가 지정한 쿠플러스/서플라이허브 전송 흐름의 기존 보관 SR Main이다. 실제 문서 2347603이나 브라우저·서버는 이번 조사에서 읽거나 변경하지 않았다. 제품·첨부·본문·검증·접수 요청은 0건이다.

## 확인된 사실

원본 `outputs/step755-current-sr-main.js` SHA-256은 `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`이다. 아래 범위는 0부터 시작하는 반개방 UTF-16 범위이며 선택한 ASCII 구간에서는 바이트 범위도 같다. 원본을 실행하지 않고 TypeScript AST로 완전한 property를 추출했다. 접두·접미 래퍼와 각 구간 SHA는 `outputs/step876-reautils-manifest.json`에 남겼다.

| 구간 | 원문 동작 | 복구 시 의미 |
| --- | --- | --- |
| `[4124852,4127637)` | `certificates` UI가 schema의 두 property 이름을 `x`, `C`로 구하고, 실제 formData의 `row[C]`를 인증번호/해당없음 값으로 사용한다. `filesState.certificate`에서 `fileName.includes(a2(row))`인 첫 파일을 찾아 `{certificateNumber, certificateFile, na}`라는 **화면 셀 값**을 만든다. | `certificateFile`은 이 UI가 조립하는 값이다. 저장 본문에서 이름이 같은 독립 필드를 찾는 것만으로 실제 연결을 확인할 수 없다. schema-bound 인증행과 별도 파일 목록을 함께 봐야 한다. |
| 같은 구간의 `beforeChange` | 셀 변경 후 저장용 formData에는 `{[x]: schemaRowTitle, [C]: value}`를 넣는다. `certificateFile`을 추가하지 않는다. | 본문의 인증행 이름/값을 확인해야 하며, UI 셀 구조를 본문 스키마로 가정하면 안 된다. |
| `[2423652,2423680)`, `[4045246,4045319)` | 인증서 prefix는 `cert`, `a2(row)`는 `cert` + row index + `-`이다. | 인증서 파일과 인증행을 잇는 클라이언트 규칙은 `cert0-`, `cert1-` 등의 포함 여부다. 중복·모호한 후보를 자동 선택할 근거는 없다. |
| `[4044636,4045245)` | 인증서 추가는 새 파일명을 `cert{row}-` + 원래 파일명으로 만들고 `addFilesToUp('certificate', [file])`한다. 해당없음으로 비활성화된 행에 기존 파일이 있으면 삭제 대기 목록에 넣는다. | 인증행의 해당없음과 연결된 인증서가 함께 있으면 정상 없음으로 간주할 수 없다. 공식 UI도 두 상태의 정리를 수행한다. 이번 조사에서는 삭제를 실행하지 않았다. |
| `[2423075,2423230)` | LABEL은 `labelImages`, MAIN/ADDITIONAL/DETAIL 등과 함께 이미지 역할 목록이다. | LABEL과 `certificate` 파일 종류는 별도다. 이미지 파일명과 같다는 이유로 인증서 첨부를 LABEL로 바꿔 해석하면 안 된다. |

새 정적 REA parent Evidence는 `ev_b939d77987c3d40831cf22c380295c5fadf192554827914bf006356927b8fa59`, summary는 `ev_c5b5b4d7127939d5659d120a4cc7d5869854d656b9df9a214e5360fd248b6442`다. 5개 파일 3,769바이트를 모두 파싱했고 parse failure는 0건이다. 선택한 디렉터리 SHA는 `2795d9d079510638d8a037eab6b719a5531208c704dfccd041958bdc78fd6ae1`이다. 정적 의미 그래프에는 260개의 동적·외부 바인딩 unknown이 있어 실제 서버 동작이나 전역 의미 동등성을 증명하지 않는다. 이전 파일 store/이미지 역할 Evidence `ev_5ed30d7dd67e6a9e3c1b5487f4c1545180bef6e09db206ff03ede2faeeda1100`과 법적 파일 응답 shape Evidence `ev_64f4e04bff878949f9ec342ebe822032adbc6b50b090e789c5e5b08d4620a83f`를 재사용했다. 전체 보관 bundle은 `outputs/step876-reautils-evidence.json`이다.

## 목록 API의 범위와 한계

기존 확인 범위 `[2876636,2876999)`에서 `getFiles(docId, fileType)`은 `/draft/api/get-files-by-type/{docId}?`로 POST한 응답을 **응답의 fileType으로 groupBy**한다. 일반 draft loader는 fileType을 전달하지 않고 모든 법적 파일을 읽는다. 따라서 특정 인증서 목록만 호출한다고 가정하거나, 파일명으로 이미지 역할을 대체할 수 없다. 이 원문만으로 서버가 LABEL을 certificate로 반환한다고 증명할 수도 없다.

## 다음 읽기에 사용할 안전한 판단

1. 같은 문서의 실제 전체 법적 descriptor 목록, schema-bound `legalPage.certificates`의 행별 이름/값, 이미지 역할의 `labelImages` 참조를 함께 대조한다.
2. `fileType=certificate` 파일은 `cert{index}-` 규칙으로 어느 인증행과 연결되는지 구분하고, 그 행의 인증번호/해당없음 상태를 확인한다. 인증행과 연결되지 않으면 미연결 인증서로 표시한다. 이를 빈 목록으로 바꾸지 않는다.
3. 이미지 목록과 이름이 같더라도 실제 `s3Link`·역할 참조·파일 바이트의 동일성이 없으면 이미지 중복으로 판정하지 않는다. 같음이 확인돼도 법적 파일 역할이 바뀌었다는 증명은 아니다.
4. 이번 원문은 예상 밖 인증서 1건을 무시하고 전송해도 된다는 근거를 제공하지 않는다. 현재 비어 있어야 하는 계획과 실제 첨부가 다르면 읽기 진단을 제공하고, 정리가 필요한 파일인지 사용자가 검토할 수 있게 한다. 자동 삭제·재분류·재전송·새 문서 생성으로 통과시키지 않는다.

본문에 `certificateFile` 필드가 있다고 전제한 이전 후속 계획은 위 원문 규칙에 맞게 보완해야 한다. 실제 저장 문서의 schema/descriptor 값과 현재 서버 결과는 이번 정적 조사에서 미확인이다. 라이브 세션·provider·실행 프로세스는 열지 않았고 종료할 소유 런타임도 없다.

## 후속: 공식 SR의 다음 버튼은 저장을 실행한다

원래 요청의 파일·본문 재전송 금지 조건에서 공식 화면의 ‘다음’을 눌러도 되는지 추가로 확인했다. 결론은 **안 된다**. 단순 화면 이동과 저장이 결합돼 있다.

- 폼 footer `hb` `[3023661,3026031)`의 다음 버튼은 `type="submit"`이다.
- 단계 폼 `W4` `[4134287,4143643)`에서 `u=n.saveDraft`, `f=n.upAndDelFilesById`, `p=n.validateStep`로 연결한다. `onSubmit`은 동의 조건을 통과하면 **먼저 `u()`를 호출**한다. 현재 단계가 startPage이면 저장 성공 뒤 바로 후속 처리, 다른 단계이면 저장 성공 후 서버 단계 검증을 하고 후속 처리한다.
- `saveDraft` `[2868857,2870255)`는 현재 전체 form을 `convertFormToJSONDoc`로 변환하고, docId가 있으면 **POST `/draft/api/update`**를 호출한다. 변경 여부 비교나 읽기 전용 분기는 없다. docId가 없으면 create를 호출하는 별도 분기다.
- 최종 이전 단계까지의 후속 처리 `R()`은 `upAndDelFilesById()`를 부른다. 이 함수는 이전 파일 store 분석에서 확인했듯 업로드 대기·삭제 대기 목록을 보낼 수 있다. 성공 이벤트 후에야 `N()`이 다음 route로 이동한다. 따라서 입력을 직접 바꾸지 않았다는 사실만으로 파일/본문 쓰기가 없다고 보장할 수 없다.
- `validateStep` `[2871459,2872242)`는 별도 POST `/qvt/api/validate-step/{step}`이며 본문 update와 구별된다. 다음 버튼은 둘을 분리해서 호출하지 않는다.
- 이전 버튼은 `preventDefault` 후 router 이동/scroll/telemetry만 보인다. 그러나 startPage에는 이전 버튼이 없다. 상단 단계 표시줄 `Z4` `[4160125,4162514)`의 클릭은 `selectedStepNumber <= currentStepIndex`일 때만 이전 route로 이동한다. startPage에서는 미래 단계를 클릭해도 이동하지 않는다.

새 Next 분석 parent Evidence `ev_96936025b26ce0cebf6021c34efc5c48a480e8d631e4beb7e10dd47ad3fc596a`, summary `ev_c2e0c1cf8e3b5fd6cbdc413cecca083100248d89e9900fbddc47749a0144e7ae`. 5개 정확한 구간, 16,383바이트, 5/5 파싱·실패 0건. 구간 디렉터리 SHA `736eaa724771b03ab10084b1e767f6f0dcb1f3f03ca32641858956f76814eaff`; 1,209개 동적/외부 의미 unknown이 남는다. `outputs/step876-reautils-next-manifest.json`에 원본/래퍼 hash를 기록했다. 저장·검증·파일·단계 이동은 실행하지 않았다.
