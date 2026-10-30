# 공식 SR 다음·최종 등록 버튼의 저장 부작용

보관된 공식 SR 출하 코드를 정적으로 대조해, 현재 읽기로 복구한 문서의 **파일·본문 재전송 금지**와 충돌하는 동작을 확인했다. 이번 확인은 브라우저·네트워크·문서 2347603을 읽거나 변경하지 않았다. vendor 코드를 실행하지 않았으며, 아래 내용은 실제 서버 실행 관측과 구분한다.

## 원본과 근거

원본은 `outputs/step755-current-sr-main.js`, SHA-256은 `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`이다. 아래 범위는 0부터 시작하는 반개방 UTF-16 offset이다.

| 구간 | 확인한 계약 |
| --- | --- |
| `W4` `[4134287,4143643)` | `u=saveDraft`, `p=validateStep`, `h=validateDraft`다. 폼 submit은 먼저 `u()`를 실행한다. 저장 성공 후 단계 2~5는 단계 검증을 하고, 마지막 단계는 `h()`를 실행한다. 중간 단계는 파일 대기열 처리 후 route를 이동한다. |
| `hb` `[3023661,3026031)` | 다음·등록 footer 버튼은 `type="submit"`이다. 단순한 route 이동 버튼이 아니다. |
| `saveDraft` `[2868857,2870255)` | 현재 form 전체를 `convertFormToJSONDoc`로 변환한다. 기존 docId가 있으면 POST `/draft/api/update`로 전체 본문을 보낸다. 변경이 없으면 저장을 생략하는 분기는 없다. |
| `validateDraft` `[2870643,2871458)` | POST `/qvt/api/validate-single-product`에 `{docId, version: schemaInfo.version}`만 보낸다. 최종 제출 동작이며, 별도의 읽기 전용 사전검사가 아니다. |

Next/Save의 기존 REA parent Evidence는 `ev_96936025b26ce0cebf6021c34efc5c48a480e8d631e4beb7e10dd47ad3fc596a`, summary는 `ev_c2e0c1cf8e3b5fd6cbdc413cecca083100248d89e9900fbddc47749a0144e7ae`다. 정확한 선택 범위와 SHA는 `outputs/step876-reautils-next-manifest.json`, 보관 bundle은 `outputs/step876-reautils-evidence.json`이다. 선택 5파일 16,383바이트를 5/5 파싱했고 실패는 0건이나, 동적·외부 의미 unknown 1,209개가 남아 있다. 동일 producer를 다시 실행하거나 이 Evidence를 서버 내부 동작 전체의 증명으로 확대하지 않았다.

최종 함수는 같은 원본 SHA의 정확한 범위를 추가로 읽었다. 해당 함수 raw UTF-8 SHA-256은 `a3bd933948a780d71a717cd119f72996d5f1363c46f8d90bf88bf51ef9f278ea`다. 응답은 단계 검증의 배열과 다른 **`data` 객체**다. 공식 코드는 numeric `code===200`과 `data.success`를 확인하고, 성공하면 draft/form을 초기화해 완료 화면을 표시한다. 실패하면 `data.errors`의 `columnName/message`를 모아 표시하며, 유효한 오류가 없으면 일반 제출 실패를 표시한다. `overallErrors`는 읽지만 이 handler에서 표시하지 않는다. 최종 성공 응답에 접수 식별값이 있다는 계약은 이 함수에 없다. 실제 접수는 별도 문서 연결 증거가 필요하다.

## 두 동의 제어값은 로컬 변경 후 전체 저장으로 전달된다

| 구간 | 확인한 계약 |
| --- | --- |
| MSRP UI `l2` `[4046952,4049205)` | 약관 UI 확인 후 `setMSRPAgree`를 호출한다. |
| `setMSRPAgree` `[2867090,2867249)` | 로컬 store의 `form.imagePage.msrpAgree`만 변경한다. 네트워크 호출이 없다. |
| 표시사항 UI `M4` `[4090538,4093327)` | 확인 동작은 `setCustomData('imagePage',{labelContactAgreed:true})`를 호출한다. |
| `setCustomData` `[2865247,2865384)` | 로컬 form의 해당 page 객체를 병합한다. 네트워크 호출이 없다. |
| `convertFormToJSONDoc` `[2857736,2860402)` | 두 동의값을 각 JSON member의 imagePage에 포함한다. 이 값이 앞의 전체 본문 update에 실린다. |

이 범위는 동일 SHA의 보관 원문에서 정적으로 확인했다. 별도 동의 저장 endpoint, 최종 요청에 동의 플래그를 추가하는 계약, 필드 단위 patch 계약은 **확인되지 않았다**. 따라서 저장 본문의 동의값이 false인 상태에서 UI checkbox만 true로 만든 것을 서버에 저장된 동의로 취급하면 안 된다. 확인되지 않은 endpoint나 body key를 만들어 이를 우회할 수 없다. 최종 제출 endpoint를 사전검사처럼 호출한 다음 공식 등록 버튼을 다시 눌러서도 안 된다.

## 자체 구현·검증에 대한 정정

기존 `singleDocumentNavigatePage`와 `singleDocumentSubmitPage`는 공식 `button[type="submit"]`을 클릭한다. 현재 읽기 복구의 명시적인 create/update 호출 차단만으로는 **vendor 버튼이 발생시키는 전체 본문 update**를 차단하지 못한다. 그러므로 별도 안전한 계약이 증명되기 전에는 재전송 금지 범위에서 이 클릭 전에 중단해야 한다.

이전 `saved-draft-recovered-lifecycle` 합성 검수는 자체 receiver·adapter와 3개 옵션 결과, 동의 challenge, 접수 연결, 중복 클릭 방지를 검사했다. 그러나 브라우저 helper의 다음 버튼은 route만 이동하고, 중간 동의값은 합성 서버 문서에 직접 반영하며, 최종 버튼은 제출 횟수와 합성 receipt만 갱신했다. 공식 `saveDraft → validateStep → validateDraft`의 네트워크 부작용은 재현하지 않았다. 따라서 해당 통과 결과는 실제 공식 UI를 통한 **본문 재전송 없는 접수**의 증명이 아니다. 단계 검증 배열 parser 등 독립적으로 검증한 범위까지 무효화하는 것은 아니다.

이 문서는 계약과 검수 범위의 정정만 기록한다. 동의 자동 설정, 새 문서 생성, 파일 저장·삭제, 본문 update, 단계·최종 제출 요청은 이번 조사에서 실행하지 않았다.
