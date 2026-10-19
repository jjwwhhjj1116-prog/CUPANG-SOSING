# Step743 — 현재 QVT 상태와 ‘반려내역’ 제어 분리

구체적인 불일치를 확인했다. QVT는 canonical 검수 상태와 과거 이력 버튼을 같은 셀에 렌더한다. 셀 전체 `innerText`를 상태로 사용하면 정상 `상품 검수 완료`가 `상품 검수 완료 반려내역` 같은 값이 되어 완료 필터에서 거절되고, 자체 접수 근거의 `/반려|거절|실패/` 검사에도 반려로 분류된다. 임의 문자열에서 ‘반려’를 제거하는 대신, 확인된 native DOM 구조에서 상태와 이력 제어를 분리하는 수정이 필요했다.

범위는 현재 보관 QVT JS, 기존6페이지의 cell7, 자체 관련 순수 코드다. 브라우저·네트워크·운영 DB·자격정보·상품·원본 JS 실행은0회다. Step742에서 해결한 quotation UUID/estimation ID와 pagination을 다시 분석하지 않았다.

## 원문과 관측

원문 `outputs/step742-hub-main.js` 전체 SHA-256:
`9e9ba20c41ffb5a5e2ecafe5833fa8144e1eb371ec633350d79b6b52f4e0e4a6`.

다음 위치는 UTF-16 code unit, end-exclusive다. slice SHA는 UTF-8 기준이며 source slice와 입력 전체 SHA는 `outputs/step743-status-review.json`에 있다. 새 REA producer/Evidence ID는 만들지 않았으며 old-SR/Couplus Evidence를 현재 QVT의 증거로 확대하지 않았다.

| 현재 QVT 원문 | 범위 | slice SHA-256 |
| --- | --- | --- |
| filter state enum | `[868592,868640)` | `d6f558ffcb963a09ca12680eea0143b3ee70238816e426d697d75725befce6df` |
| statusOptions | `[870559,870778)` | `350b012e1ef5172a0efa2dad001bded49fa82b01716303e977550b496b07b051` |
| WIMS statusFormatter | `[3698881,3700549)` | `95fa433a4c65a40101165f9d3088da3b25cc8f16a54484e8dd2bb34b17293cec` |

상태 filter enum은 `INSPECTION`, `INSPECTION_COMPLETE`, `REJECTION`이며 statusOptions는 이3개에 전체 항목만 추가한다. 상태 formatter는 외부 DIV 안 첫 DIV에 state의 번역 라벨을 렌더하고, `REJECTION`이면 `text-danger`, `INSPECTION_COMPLETE`이면 `text-success`를 준다. 다른 state의 두 class는 비어 있다.

그 뒤에는 다음 독립적인 부가 제어를 조건부로 붙인다. 순서도 원문에 정해져 있다.

1. rejectStatus가 `REPLY_PARTIAL_COMPLETED` 또는 `REPLY_ALL_COMPLETED`이면 괄호 안 회신 요약 DIV. partial에는 `text-danger`와 tooltip이 추가된다.
2. `tcRejectPendingReply`이면 TC 회신 LINK.
3. rejectStatus가 `WAIT_FOR_REPLY` 또는 `REPLY_PARTIAL_COMPLETED`이면 일반 회신 LINK.
4. `rejectHistoryExist`이면 `BUTTON.btn.btn-default.btn-xs.btn-block.mt-1`. 버튼의 번역 키는 `WIMS.REJECT_HISTORY.TITLE`이며 클릭 handler는 `rejectHistoryEstimationId`를 설정한다. 이 조건은 현재 state가 REJECTION인지와 무관하다.

또 `rejectRemark==='DROP'`이면 첫 라벨을 `WIMS.REJECT.REJECT_REMARK.DROP` 번역으로 대체한다. 이 한글 번역과 회신 부가 제어의 한글 라벨은 이번 보관 원문에 literal로 없고 실제 셀에서도 관측되지 않았다. 색상만 보고 DROP을 기존 상태로 매핑하거나 모르는 라벨을 추정하면 안 된다.

보관6페이지의286행을 cell7만 정적으로 분류한 결과는 다음4형태다.

| canonical 라벨 | 첫 DIV class | 별도 부가 요소 | 행 수 |
| --- | --- | --- | ---: |
| 상품 검수중 | 빈 문자열 | 없음 | 88 |
| 상품 검수 반려 | text-danger | 없음 | 161 |
| 상품 검수 완료 | text-success | 없음 | 26 |
| 상품 검수 완료 | text-success | ‘반려내역’ BUTTON1개 | 11 |

완료는 합계37행이다. 정확한 HTML4개를 업무 ID 없이 `outputs/step743-status-observed-cells.json`에 저장했다. source 파일 SHA 및 decoded table의 셀 범위도 포함한다.

```html
<td><div><div class="">상품 검수중</div></div></td>
<td><div><div class="text-danger">상품 검수 반려</div></div></td>
<td><div><div class="text-success">상품 검수 완료</div></div></td>
<td><div><div class="text-success">상품 검수 완료</div><button class="btn btn-default btn-xs btn-block mt-1">반려내역</button></div></td>
```

마지막 형태의 BUTTON에는 class 외 HTML attribute가 없고 type도 없다. HTML만으로 computed visibility를 독립 관측한 것은 아니다. 실제 원문 handler를 실행하거나 이력 버튼을 클릭하지 않았다.

## 최소 추출 계약과 영향

렌더된 cell7의 직접 자식 DIV, 그 안 첫 상태 DIV와 정확한 라벨/class 조합을 함께 검증한다. 부가 요소가 있다면 이번에 관측한 정확한 history BUTTON1개만 허용한다. 전체 셀 표시문자, 순서, 제어 수가 상태+이력 라벨과 맞아야 한다. 다른 reply LINK·summary DIV·미지 라벨·class 충돌·중복/다른 버튼은 거절한다. ‘첫 DIV만 읽고 나머지는 무조건 무시’하는 방식으로 넓히지 않는다. 기존 text-only 테스트/표 형식은 알려진3개 canonical 문자열만 그대로 허용할 수 있다.

지원되는 canonical 값은 위3개다. 현재 원문은 unobserved DROP/회신 분기도 갖지만 이번 입력에서 번역/실제 DOM이 확인되지 않았으므로 그 분기의 표시값을 새 허용 상태로 추가할 근거가 없다. 이 제한은 그 기능이 원문에 없다는 뜻이 아니다.

자체 `extensions/supplier-hub/company-registration-page.mjs`는 기존에 `values[7]`을 셀 전체에서 만들고 선택 필터와 exact 비교했다. `app/company-registration-status.ts`도 같은 exact 필터를 재확인하고 panel은 `row.status`를 직접 출력한다. 따라서 이력 버튼11행은 완료 조회를 실패시키고 전체 조회에서는 버튼 라벨이 상태에 섞이는 구체적 문제가 된다.

추가로 자체 `app/supplier-hub-handoff.ts`의 `supplierHubRegistrationEvidence` 함수 `[9135,10273)`, slice SHA `571706532587ea0455c82d7042f532f76ec0c3fba486f84950cdb815fcc2c4af`를 imports 없이 별도로 transpile하여 합성값에 실행했다. `상품 검수 완료반려내역`과 `상품 검수 완료 반려내역`은 둘 다 completed exact filter에서 탈락하고 `rejected:true`가 됐다. canonical `상품 검수 완료`는 filter가 맞고 `rejected:false`였다. 이는 자체 순수 함수의 재현이며 실제 접수/승인 증명이 아니다.

이 문제의 수정은 reader가 native history 제어를 상태에서 분리하는 것이다. 저장된 임의 문자열이나 실제 반려/거절/실패 및 stage 반려를 무시하도록 기존 rejection 검사를 약화하면 안 된다.

## root 수정 독립 검수

root가 두 serialized reader 안에 넣은 `reviewStatus`를 읽었다. helper는 서로 동일하며 slice SHA는 `2dbcd4cf16e7e6dd2dee390ebbbedc94bc0110d4aaed20f7109a6b0515c70539`다. company reader 범위 `[4512,6055)`, single reader 범위 `[2927,4470)`다.

helper는 known text-only fallback, native 직접 DIV/라벨 class, optional history BUTTON1개·type 없음·element 자식 없음·정확 class/문자·제어 유일성·표시 여부·전체 셀 문자를 검사한다. unknown/회신 LINK 등은 null로 거절하고 양쪽 reader는 오류를 발생시킨다. closure는 각 serialized 최상위 함수 내부의 normalize와 표준 DOM으로 닫혀 있다. 자체 handoff rejection 정규식은 바뀌지 않았다. 이 좁은 수정에서 중대한 결함은 발견하지 못했다.

검수 결과:

- 독립 정적 native 모델: 보관286개 상태 셀과4개 실제 형태를 검증,9개 비정상 합성 형태 거절.
- `node --test tests/hub-qvt-review-status.test.mjs`: **13/13 통과**. 두 회사/4형태의 필터, 실제 serialized reader→집계→앱 validator/evidence/receipt summary, 진짜 상태/단계 반려 유지, malformed/unknown 거절, 다른 필터 거절 및6페이지 합성 이동을 포함한다.
- 완료+이력 행은 합성 흐름에서 `SKU ID 확인`으로 표시되고 `registered:false`를 유지한다. 상품 검수 승인이나 실제 제출 완료로 승격하지 않는다.
- `outputs/step743-status-review-implementation.mjs` 실행 전후 source9파일 SHA가 동일했다. root의286행 보관 replay는 별도 근거이며 이 격리13개 시험이나 실제 접수 건수로 집계하지 않는다.

| 최종 검수 소스 | SHA-256 |
| --- | --- |
| company-registration-page.mjs | `3a4122aa774ae5d6f256bae1d9483d7e4d3439ca08a3d9d109428ab847c947a9` |
| registration-result.mjs | `77a1e0b169ff44a85e8f555d0f334d6fa3cf3dc4057bea465b9da374124e47fa` |
| app/company-registration-status.ts | `f6b8fbbb4e7df9351354e8150f7f71fa28b816b36633559c4491a19820bffec0` |
| app/supplier-hub-handoff.ts | `679244aeaa41f159d497176c3853a8203b00c9371cb6bd5463a8f56c055ba004` |
| tests/hub-qvt-review-status.test.mjs | `920ef89b18aac416e0379739bd94f8d94e352674e256c00d3687d82eb3803fe3` |

전체 입력 SHA, 나머지 시험 소스 SHA와 stdout은 `outputs/step743-status-review.json` 및 `outputs/step743-status-review-implementation.json`에 보존했다. 미지 분기·전체 locale·전체 category·실제 접수는 이 검사의 증명 범위 밖이다.
