# Step714 — 7단계 ‘모든 옵션에 적용’ 저장 범위

2026-10-18 KST. 기준 `8dd690b048559d97c3f787c01d4416d6897f06d0`. Stage1·표시사항·초기 비노출 null 처리는 반복하지 않았다. 이번 질문은 견적 편집기의 전체 옵션 스위치와 명시적 저장 범위다. 보관된 Couplus chunk를 inert AST·문자열로 읽었으며 vendor 실행·브라우저·네트워크·기존 상품 접근과 변경은 모두 0이다.

## 확인한 차이와 구현 권고

원본의 ‘모든 옵션에 적용’은 `coupangDoc.jsonDocument` 배열 전체가 대상이다. `expandPendingChangesToAllOptions`는 각 pending 경로가 `coupangDoc.jsonDocument.<index>.<field>`이면 해당 field와 값을 0부터 배열 길이 전까지 전부 복사한다. 그 메서드에는 포함/제외 상태의 필터가 없다. 일반 field blur/dropdown의 ON 분기도 전체 배열의 pending 값을 만든다.

기준 자체 `quotationSavePlan`은 원본 옵션이 `included`여야 하고, 대상의 `!row.included`를 건너뛴다. 스위치도 ‘모든 포함 옵션에 적용’이며 제외 옵션을 선택하면 보이지 않는다. 따라서 저장 범위가 원본의 전체 문서와 다르다. 사용자에게 전체 범위를 명확히 보여주고 **현재 상품의 실제 옵션 전체를 대상으로 명시적인 저장**을 지원하는 것이 후속 구현으로 적합하다. 제외 옵션을 수정해도 그 옵션의 견적 포함 여부·전송 대상 자체를 바꾸는 것은 아니다.

이는 원본 document 배열과 자체 actual option identity를 연결하는 재구현 설계다. 원본의 전체 document가 모든 remote SKU와 항상 일치하거나 어떤 선행 필터도 없다는 뜻은 아니다. 실제 옵션·카테고리의 현재 identity와 양식을 검증하고, 공통값·다른 상품·다른 회사의 값으로 범위를 넓히지 않아야 한다.

## 버튼·blur·스위치의 정적 동작

- 스위치 ON/OFF handler는 모드 변경을 기록할 뿐 저장 요청을 하지 않는다.
- ON에서 field blur/dropdown은 `applySingleFieldToAllOptions`를 통해 pending에 전체 문서 경로를 넣는다. 일부 로그의 ‘즉시 저장’ 문구와 달리 이 helper는 서버 write를 호출하지 않는다.
- 저장 버튼은 중복 저장을 막고, 포커스된 입력에 blur를 발생시킨 후 50ms를 기다려 pending을 모은다. `savePendingChanges`는 스위치 ON이면 전체 확장 후 비노출 정규화·전체 schema 검사·상태 계산을 거쳐 `updateProductPartial`을 한 번 요청한다.
- pending이 없으면 요청을 하지 않는다. 성공 경로에는 pending 초기화와 `initializeData`가 있다. 비공개 API의 원자성·실제 저장 성공은 이 구문에서 관측하지 않았다.

원본의 save 확장은 현재 선택 옵션에만 한정하지 않고 **모든 pending 문서 경로**를 순서대로 펼친다. 서로 다른 옵션의 같은 field가 pending에 있으면 나중에 열거한 값이 모든 문서에 남을 수 있다. 이 모호한 충돌까지 복제할 권고는 하지 않는다. 자체의 현재 원본 옵션에서 수정한 항목만 복사하는 계획·전체 변경 미리보기·정확한 수동 공란·자동 연동 해제·서버 CAS·유실 ACK 조회 확인은 유지해야 한다. 원본처럼 완료율 상태만으로 실제 Supplier Hub 등록 완료를 표시해서도 안 된다.

## 원문 identity와 범위

보관 source는 `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`, SHA-256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`다. TypeScript parser로 원본을 실행하지 않고 exact method 범위를 선택했다. 단위는 UTF-16, 끝 제외이며 slice digest는 UTF-8이다. ignored `outputs/step714-quotation-analysis-extract.mjs`와 manifest에 재현 가능한 범위를 보관했다.

| 메서드 | 범위 | SHA-256 |
| --- | --- | --- |
| handleSaveButton | `[231412,232470)` | `ff09f7173ff67ae22195ccb9c650951a172caa144510538328cfc55cd110da1b` |
| onApplyToAllOptionsChange | `[254600,254757)` | `1b3a612cb95fd1f21b178283c22b477e84ae03b3cdeab2ebb7681d78030c0556` |
| handleSwitchToOn | `[254758,254835)` | `1bdc3db8788cd048254da954796d5336942da18a0d6ddbfed9f582bc01d00a1f` |
| handleSwitchToOff | `[254836,254914)` | `3f60c481dc29887b2721efa6d8e2318f7b353e78ed7c4a51f2365c1ee42b757e` |
| onFieldBlur | `[255302,255903)` | `c8bdf8416ecb3396289c157cfdb7f93e4587ad9156dc9dbcd03670e5ea08d9a3` |
| onDropdownChange | `[256456,256811)` | `9775f740e1c96a4018ceefb61cc3fc1689cdd8678ca9a59608dd1ea19cb7bb1b` |
| applySingleFieldToAllOptions | `[257562,258196)` | `035a0c5e1e04fe6f0e2be47523cc4b272f871f9bcaefdf1fd124289346e094b5` |
| savePendingChanges | `[260643,263110)` | `4e3f79e717ec223efc472b41306b479e866b41f2aced3658d3be2e485def9726` |
| expandPendingChangesToAllOptions | `[263345,264105)` | `15cc36eead149e79d7cf76869ebec82b17f84e99053fd26fab5cffad623e029c` |

## REA 재사용 범위 정정

설치된 REA의 advertised `get_evidence_bundle`로 기존 parent `ev_cd5b12712ef6b71c2acfc13858957b76b067e15d1319aac6ac68b3c3a642258a`를 조회했으나 새 연결에 retained record가 없어, 보관 `outputs/step670-price-number-audit/rea-evidence-bundle.json` 9 records를 import해 identity를 확인했다. 실제 subject는 `outputs/step670-price-number-audit/selected`, directory SHA `d19cb919a7e61650d8d1a417d7cc12c03b330c539b779ab1848c3c60470cca4e`다.

따라서 Step701에서 그 parent를 ‘UI/main 분석’이라고 묶은 설명은 **가격 선택 메서드 문맥**으로 한정해야 한다. 이번 quotation editor 메서드의 직접 Evidence로 인용하지 않았다. Stage7의 해당 메서드가 그 가격 분석에 없다는 구체적인 누락을 해결하려고, 위 원본의 정확한 13개 메서드를 비실행 class wrapper 한 파일로 선택해 실제 REA `analyze_javascript_application`을 한 번 실행했다. 전체 editor나 보관 bundle 전체의 producer를 반복한 것이 아니다. Step701의 초기 문서 별도 parent `ev_d49bd95d5e4610573ee111bbc753a6055e2f0913515c0f96f146f2ff50050a6b`는 초기값 문맥이며 이번 전체 옵션 저장 메서드와 구분한다.

새 REA parent는 `ev_cc551a2398fd601ef51033ba716ee835ac9ad2317f899dd9409f8c032a10e841`, summary는 `ev_f6d120632393aa948d64a9d67744b7278ad9ac46e25ba301fd37f4ee4d6345f2`다. 선택 파일 `outputs/step714-quotation-analysis-selected/quotationAllOptions.js`의 SHA는 `2faf6ea82697723962b927d8eb8ca17d3cc5222a7cd0d5f36372370d3b33e9ec`, 선택 directory SHA는 `dda7841fe14c7a99aca12d13398e1bf63d3188f7727576e5512d32c151940b22`다. 8,611 bytes·JavaScript 파싱1파일·AST1,494개·parse failure0이며 application 선택 범위는 complete, semantic coverage는 unknown·잔여357개다. 외부 `this`/Vuex/서버·다른 helper·watcher는 이 선택만으로 해결하지 않는다. 원본 코드는 실행하지 않았다.

portable ledger는 `outputs/step714-quotation-analysis-evidence-bundle.json`, SHA `c2214d9f8fe1d38d58d8ea1794ca9cb923f44a39c000f9f2e57c7fd87943bfbd`이며 이전 문맥9개와 새 parent/summary2개, 총11 records다. 이전 records까지 새로운 Stage7 분석 결과로 세지 않는다. native/browser session은 열지 않았다.

## 초기화와 미확정 사항

원본 `resetQuotation` `[249596,249908)`, SHA `9d0197af4feb44fcb99d048565fe115e2eb48b1644b1da90f33bc91e2c400f40`는 확인창 후 `initializeData`와 알림만 수행한다. 서버 write·pending 초기화가 이 메서드에 없다. 이를 전체 견적 수동값 삭제나 기본값 영속 재설정 기능으로 해석하지 않았다. 자체의 명시적인 입력 취소·저장본 재조회와 다른 자동 복원 도구가 이미 있으므로, 이 모순을 재현하기 위해 작업 중인 상품을 초기화할 이유가 없다.

실제 최신 Couplus 화면 전이·remote 저장·제외 옵션 정책, 모든 카테고리 문서 배열 identity, Supplier Hub 접수·SKU 결과는 미관측이다. 무게·가격·이미지·회사 권한과 source fingerprint를 약화시키거나 현재 전송 gate를 바꾸는 근거가 아니다. 이 좁은 저장 범위 감사로 전체 동일구현 또는 실제 접수 완료를 주장하지 않는다.

## 구현 후 독립 소스 검토

root가 `app/components/quotation-fields-editor.tsx`의 주 스위치와 계획을 바꾼 뒤 read-only로 diff를 대조했다. 검토 시 SHA는 `b83744b1f549cb08cb70a9069dc84d9d759a0c7d2004a22542c64689845aa4db`다. helper는 현재 옵션의 수정 항목만 실제 옵션 전체에 복사하며, 공통 row는 제외한다. 전송 제외 옵션도 source·target이 될 수 있지만 `included` 자체는 쓰지 않는다. 미리보기에서 제외 표시와 적용 범위를 보여준다. 주 스위치 밖의 별도 항목 선택 복사 도구의 `includedOnly` 기능은 그대로다.

명시적 공란·수정 해제 null·가격/포장 연결 확장·1,000개 저장 한도·현재 schema/owned image 검사·CAS와 저장 확인은 기존 경로를 유지한다. 새 ref guard는 옵션·applyAll·changes·view가 달라진 오래된 저장 callback과 저장 중 switch callback을 막는다. 새 provider·DB·계정·전송 mutation 범위를 추가하지 않는다. 이 diff에서 미해결 actionable 소스 지적은 없다. 실제 API/SQLite·컴포넌트 검수는 다른 담당자가 수행하므로 여기서 중복 실행하거나 검사 합계에 더하지 않았다.

이후 고정된 테스트6개도 소스만 독립 검토했다. 기존 무게·가격 기대값은 새 주 스위치의 전체 범위에 맞추고, 별도 `includedOnly` 복사·복원의 제외 보호는 유지한다. price-wire fixture의 변경은 실제 component가 쓰는 `useMemo` adapter 추가뿐이다. dimensions의 역사적 hash 비교는 `df4f532` 시점에 없던 표시용 `registration_number`만 복제 입력에서 제외한다. 현재 fingerprint helper도 그 한 필드만 제외하며, 저장 원문·기존 receipt bytes·명시 재저장 hash 변화 검사는 그대로다.

구형 physical-source 오류 회귀는 새 수집에 생긴 유효한 N/A 고시를 오류로 잘못 계산하지 않도록 **임시 SQLite의 marker-absent legacy fixture**로 범위를 명시했다. `initialLegalNotices` 형식을 먼저 확인한 뒤 그 marker만 테스트 자료에서 제거하며 production writer는 바꾸지 않는다. 원래 오류3개·브랜드만 복사·전송 차단·수정 후 출력 검사를 유지하고, 실제 가로·세로·높이 누락과 두 포장 오류를 추가 단언했다. 새 intake N/A 의미는 이 legacy 회귀의 검증 범위가 아니며 별도 정책 검사가 필요하다. 수정된 frozen 테스트 SHA와 보조 source SHA, 세부 oracle 제한은 `outputs/step714-independent-review.json`에 기록했다. 이 추가 검토도 테스트 실행·앱/테스트 변경은0이며 oracle 약화에 대한 미해결 지적은 없다.
