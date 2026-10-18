# Step719 — 단계 이동·닫기와 견적 미저장값

2026-10-18 KST. 보관한 Couplus AIRocketReg chunk에서 **단계 이동이 저장을 수행하는지**, 옵션 변경 때 견적 pending이 어떻게 처리되는지만 조사했다. Step714 저장과 Step718 문서 초기화 증거를 먼저 재사용했으며, 신규 REA 선택은 wizard·render·이탈 hook·부모 핸들러에 한정했다. 원본 실행·브라우저·네트워크·운영 상품 읽기/쓰기·1688 접근은 모두 0이다. 이 문서는 정적 관찰이며 최신 화면에서의 동작·원격 저장 성공을 관측한 보고서가 아니다.

## 단계·닫기 버튼의 경계

`ProductWizardModal`은 선택된 작업에 대응하는 component를 `e(t.currentComponent, …)`로 렌더한다. 선택한 render에는 `keep-alive` wrapper가 없다. 일반 Vue 의미상 다른 component 종류로 바뀌면 이전 component의 로컬 상태가 유지되지 않을 수 있다는 **추론**이 가능하지만, 실제 Vue/Bootstrap modal lifecycle은 실행하지 않았다. 같은 component 내부 옵션 이동과 component 교체도 구분해야 한다.

- `nextStep`·`prevStep`은 범위 안에서 `currentStep`을 증감할 뿐 저장·확인창을 호출하지 않는다.
- `goToStep`은 `currentStep`과 선택 work type을 바꾼다. 사이즈표가 요구되지 않는 상품에서는 해당 단계를 뺀 인덱스를 사용한다. 이 함수에도 저장·미저장 확인창이 없다.
- `closeWizard`는 `showModal=false`와 `closed` emit만 수행한다. 부모 `handleWizardClosed`도 저장된 Vuex 상품을 목록에 clone해 반영하고 work type을 비울 뿐 추가 서버 저장을 호출하지 않는다. 함수 내의 “이미 저장됐으므로 추가 저장 생략” 로그를 실제 모든 입력이 저장됐다는 증거로 해석하면 안 된다.
- render에서 이전/다음/완료 버튼은 `isProcessing`에 따라 disabled다. 상단 단계 클릭은 `go-to-step`을 emit하고, 별도 X 닫기 버튼에는 같은 disabled 조건이 없다. handler 자체에도 processing/dirty guard는 없다. 실제 클릭 가능성까지 실행으로 검증하지는 않았다.
- render의 다음/완료 조건은 원래 `steps.length`, 표시와 이동 범위는 `filteredSteps.length`를 참조한다. 사이즈표가 빠진 경우의 경계 불일치가 구문에 있으나, 이것을 자체 UI에 재현할 이유는 없다.

원본은 SEO·가격·이미지·표시사항·견적마다 저장 경로가 다르다. 예를 들어 대표이미지 선택 메서드는 옵션 이미지/견적 갱신을 호출하지만 SEO·가격·표시사항은 각각 명시적 저장 메서드를 가진다. 따라서 중앙 다음 버튼이 모든 단계를 자동 저장한다고 설명하거나, 반대로 모든 이미지 선택까지 저장 버튼 전에는 영속되지 않는다고 설명하면 둘 다 부정확하다. 이번 범위에서는 개별 이미지 처리/서비스의 저장 보장 전체를 다시 분석하지 않았다.

## 견적 7단계의 이탈·옵션 변경

`QuotationEdit.data`의 `autoSaveEnabled` 기본값은 false다. 정확한 원본 chunk에서 이 identifier는 data 선언과 두 이탈 hook, 총 3회만 나타나며 setter나 UI 활성화 참조는 발견되지 않았다. 다른 chunk·확장·runtime 주입까지 없다고 주장하는 전역 부재 증명은 아니다.

`beforeDestroy`는 **autoSaveEnabled와 hasPendingChanges가 모두 true인 경우에만** `savePendingChanges()`를 호출한다. false 분기에서는 저장하지 않는다는 로그만 남긴다. 호출은 await하지 않으며, 이 hook 자체에는 이동 취소·저장 실패 처리도 없다. `beforeRouteLeave`에는 autosave ON이면 Promise 저장 후 이동, 실패하면 `confirm`으로 계속 이동 여부를 묻는 코드가 있다. OFF이면 미저장 로그 후 `next()`로 이동한다. dynamic component의 단계 이동이 라우터 이탈 hook을 호출한다는 증거는 아니므로 둘을 섞어 해석하지 않는다.

옵션 목록의 `showWorkDetails(option, type)`은 선택 옵션과 work type을 설정하고 `open-wizard`를 emit한다. 별도 저장·dirty 확인은 없다. Step718의 견적 `selectedOption` watcher는 `initializeData()`를 호출한다. 이 함수는 해당 옵션의 **저장 문서**를 화면용으로 clone하며, `pendingChanges`나 `hasPendingChanges`를 비우지 않는다. 즉 같은 견적 component의 옵션 변경에서는 화면은 저장본으로 초기화되지만 이전 옵션 경로의 pending이 남을 수 있다. pending이 자동으로 삭제됐다고도, 이전 옵션의 미저장값이 화면에 항상 보존된다고도 주장하지 않는다. Step714의 성공한 `savePendingChanges` 경로에서만 pending을 비우고 다시 `initializeData`하는 구문이 확인됐다. 여러 옵션의 pending을 전체 적용으로 펼칠 때의 충돌 한계는 Step714 문서를 그대로 적용한다.

나머지 단계 object의 lifecycle property inventory도 범위를 기록했다. SEO·가격·한글표시사항·사이즈표에는 이탈 저장 hook이 없고, 대표·추가·상세이미지의 `beforeDestroy`는 keyboard listener 제거다. 이것은 각 component에 저장 handler가 없다는 뜻이 아니다. SEO의 product deep watcher, 가격의 selectedProduct watcher, 표시사항의 selectedOption watcher가 로컬 화면을 다시 초기화하는 경계도 존재한다. 이 watcher에 의해 runtime에서 어떤 미저장값이 실제 유실되는지는 별도 자체 재현이 필요하다.

## 재구현에 적용할 판단

원본과 맞출 핵심은 단계 구성·개별 편집/저장·선택 옵션·저장된 견적 연동이다. 중앙 이동을 성공한 저장이나 Supplier Hub 등록 완료로 간주하면 안 된다. 원본의 이탈 저장 OFF·로컬 draft 소실 가능성·filtered 단계 경계 문제까지 그대로 복제하라는 근거는 없다. 자체에서는 단계·옵션·회사·상품·양식 문맥별 초안을 보존하거나 명확히 취소할 수 있어야 하며, 저장 버튼의 정확한 범위·공란·CAS·전송 전 검증은 유지해야 한다. 특히 로컬 미저장값을 실제 전송 자료로 사용하거나 상태 badge를 Hub 접수 증거로 승격해서는 안 된다.

## 원본 identity와 Evidence

원본은 `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`, SHA-256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`다. 범위는 UTF-16 code unit, 끝 제외이며 raw slice SHA는 UTF-8이다. AST로 동일 범위를 검증하고 inert wrapper만 만들었으며 bundle bootstrap·코드·네트워크를 실행하지 않았다.

| 경계 | 원본 범위 | raw SHA-256 |
| --- | --- | --- |
| wizard render | `[27207,28928)` | `8356661f10bf9742ce717a85a9283984fafcd6e2c5232bb78063c63524c819ef` |
| progress render | `[28936,29585)` | `99ce84062950edd2cbe71a979cb525e095b75dbfc32311ba4acb519026f697b9` |
| ProductWizardModal object | `[287451,290469)` | `626c93d5ae18b78cc7e25c1bb7dd90e27b3fc0cfcb7c3890500c8c5b2f643dfc` |
| closeWizard | `[289615,289668)` | `441e7f9e2a853787064cf5be70a370e8feeb1bc50514848478f9435083fe8e02` |
| nextStep | `[289669,289743)` | `0e8166cf4ec48ba8515b4ac06e93e3f431f7b191ed5c1f940e86be9ef0e49859` |
| prevStep | `[289744,289794)` | `b4781ba885df3e879ed74904e9e7db78d5bf5637d822f57cfe4da61621f18e1a` |
| goToStep | `[289795,290194)` | `1e9b4e062c60d39ed0286798540643055ecc213146ea5f46bfd719cb0c6ce419` |
| QuotationEdit data | `[226914,227683)` | `d2d97857fcc8eab9cbca2af2e8273af5d352b617748042b0a12aedd186c6080a` |
| beforeDestroy | `[230665,230937)` | `1ee5cde7338a2d03c4efcac4ea081fcdded68932a9df6e03d8db3615bd93eec8` |
| beforeRouteLeave | `[230938,231320)` | `f3a655ebccf12a1a927f19c33c70da272bde84ecd42011e5d01dae6614583f0d` |
| showWorkDetails | `[337638,337804)` | `8dcd8122670cd80bfc4e909e9d4dea226e821aeef15f8ba97706b80d7f2bd543` |
| handleWizardClosed | `[477480,478060)` | `12fdcde8e4ab9414b2145161240eec4d0a6e981257dd2ca24b9d0a01a1792bbf` |

Step714 저장 parent `ev_cc551a2398fd601ef51033ba716ee835ac9ad2317f899dd9409f8c032a10e841`, Step718 초기화 parent `ev_acbeaa1a4da8f0951a2b43de776d411385c556877af4b1bd2c06c65835d20b96`를 재사용했다. 새 연결에는 retained record가 없어 `outputs/step718-original-evidence-bundle.json` 19개 record를 검증 import한 후 exact parent summary로 identity를 확인했다. 이전 producer를 다시 실행하지 않았다.

새 parent는 `ev_0280bf9c53889bc0ce2ab8827fe67af309ce06de1cd50b68deda147b8de7647c`, summary는 `ev_116943732b3d259b7299b2fbbf999a9368c917232a46fc6039fc624348f731d9`다. 새 선택은 `outputs/step719-original-selected/stageNavigation.js` SHA `9c6853b3607159416b2b9862538c205483253891907a31b7184a3a1d12bafd62`, directory SHA `d4fa66d40a225442b29ad3c1637931677b62ae217b091dbcde5f587fbe3db6c1`다. 8,468 bytes·파싱 1파일·AST 1,718개·parse failure 0이며 선택 application 범위 complete, semantic coverage unknown·잔여 350개다. 외부 this·Vuex·Vue/Bootstrap·서비스/backend의 의미는 해결하지 않는다.

manifest는 `outputs/step719-original-manifest.json`, 재현기는 `outputs/step719-original-extract.mjs`다. portable ledger `outputs/step719-original-evidence-bundle.json`은 9,730,604 bytes·21 records·SHA `105f7bb18b4db78c4bbb97c36a1dcfea6199d667e59f2cdaf997761df71b40ba`다. 그중 새 record는 parent/summary 2개이고 나머지 19개는 재사용이다. native/browser session을 열지 않았으므로 종료할 owned session은 없다. 실제 Couplus 저장·신규1688 수집·모든 category 동일성·Supplier Hub 실제 최종 접수는 미관측이며 production gate를 바꾸지 않는다.
