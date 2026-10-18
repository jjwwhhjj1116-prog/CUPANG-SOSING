# Step718 — 7단계는 상품에 저장된 문서와 schema를 읽는다

2026-10-18 KST. 자체 기준 `7419b60`이다. 이번 질문은 기존 상품의 7단계 열기·수정 저장·등록전송에서 문서와 카테고리 양식의 출처가 어디인가에 한정한다. 기존 Step714 저장 범위·Step693 초기 문서·Step701 전송 protocol 증거를 먼저 읽었다. 원본·브라우저·네트워크·1688·Hub·운영 데이터 접근과 실행은 0이며 앱·테스트는 수정하지 않았다.

## 확인한 동작

원본 7단계는 **선택된 상품의 `rocketRegInfo.schemaString`과 `coupangDoc.jsonDocument`를 읽는다.** 조사한 component의 초기화·저장·전송 경로에는 현재 전역 카테고리를 조회해 기존 상품의 문서 전체를 새 기본값으로 생성하는 동작이 없다. 이는 선택한 shipped code의 정적 관찰이며, 비공개 서버나 외부 Vuex mutation까지 불변이라는 보장은 아니다.

최초 상품 생성과 이후 편집은 서로 다른 경로다. `createProductObject`는 원본 응답의 `rocketRegInfo`를 상품에 넣고 `initializeCoupangDoc(createResult, defaultSettings, rocketRegInfo, options)`의 결과를 같은 상품의 `coupangDoc`에 넣어 `saveItems`로 보낸다. 이 최초 생성 helper에서는 전달 schema 또는 당시 extension 응답을 사용해 기본 구조를 만든다. 이것을 기존 상품의 7단계가 열릴 때마다 다시 호출하는 것으로 해석하면 안 된다.

7단계 mount는 `initializeSchema()`를 먼저 호출한다. 이 함수는 `this.product.rocketRegInfo.schemaString`을 파싱한다. 이후 `initializeData()`는 `getCurrentCoupangDoc()`에서 현재 옵션 번호와 상품 옵션 배열의 index를 찾아 저장된 문서를 가져온다. 상품 단위 문서가 없으면 예전 형식인 `selectedOption.coupangDoc`를 fallback으로 읽는다. 옵션이 바뀌는 watcher는 `initializeData()`를 다시 호출하며, 조사한 watcher에는 전역 카테고리 재조회나 `initializeSchema()` 재호출이 없다.

저장 문서가 있으면 해당 문서를 deep clone해 `docData`로 사용한다. 다만 화면을 채우는 과정에는 required 골격 보충·비노출 값 정규화와 저장 schema에 없는 `msrp`/`osrp` 제거가 있다. 따라서 원본 화면이 저장 문서를 아무 변화 없이 그대로 표시한다고까지 주장하지 않는다. `ensureRequiredFields`는 falsey 검사도 사용한다. 자체의 수동 공란·0·false 보존을 약화시켜 이 구현 특성을 복제할 근거는 아니다. 이 초기화 helper 자체에는 서버 저장 호출이 없다.

문서가 없을 때만 `createBaseQuotationData(product, selectedOption/첫 옵션)` → `convertToJsonDocument` → `ensureRequiredFields` fallback으로 화면 자료를 만든다. 이 fallback의 호출 인자는 상품·옵션이며, 조사한 함수 본문에는 카테고리 서비스 요청이 없다. 외부 helper와 서버의 모든 동작까지 이번 선택으로 증명하지는 않는다.

## 수정 저장과 등록전송

Step714에서 확인한 `savePendingChanges`는 `coupangDoc.jsonDocument.<옵션 index>.<field>` pending 경로와 상태를 `updateProductPartial`에 전달한다. `applyPendingToData`는 기존 상품 문서 배열을 clone한 뒤 pending을 덮어씌워 검증용 자료를 만든다. 검증은 component에 저장된 `this.schema`를 참조한다. 전체 옵션 적용의 범위·충돌과 초기화 버튼의 한계는 Step714 문서를 그대로 적용한다. 성공 경로의 `initializeData()`도 상품의 저장 문서를 다시 읽는 방식이며, 현재 전역 카테고리로 새 문서를 생성하지 않는다. private partial API의 원자성·정규화·서버 내부 schema 재검사는 미관측이다.

보관된 `processNextVerification`은 전송 큐의 상품에 문서와 옵션 수에 맞는 문서 배열이 있는지 확인하고 `body: product.coupangDoc`를 `VERIFY_ROCKET_REG_DOC`로 전달한다. 이 메서드에도 카테고리 schema 재조회나 초기 문서 생성은 없다. 전송 전에 모델번호 길이 제한, 첫 문서의 상품명을 root 상품명에 동기화하고 누락 모델번호를 채우는 국소 보정은 존재한다. 저장 문서의 bytes를 전혀 바꾸지 않는 sender라고 표현하지 않는다. 설치 확장 create/update는 전달받은 문서 본문을 사용하는 기존 Step701 protocol 근거를 재사용했으며 새 원본 전송을 실행하지 않았다.

## 자체 코드와 구분해야 할 차이

읽은 자체 `quotation-fields-snapshot.ts`와 `exports/quotation-source.ts`는 linked 수집 상품에 명시적인 profile이 있어도 **Hub schema를 수집 당시 `captured.category.hubSchema`로 되돌린다.** 따라서 자체가 현재 전역 Hub schema를 무조건 덮어쓴다고 설명하면 틀리다. 회사·profile ID·category code/path 검증과 서버 source clock 보호도 유지된다.

별도 차이는 `QuotationPanel`의 기본 선택 처리다. Step717은 captured 기본 선택을 다른 단계에 명시 선택으로 통지하지 않도록 바꿨지만, Stage7 자체의 `overrideProfileId`에는 여전히 현재 저장 profile ID가 들어간다. 이 경우 captured schema와 함께 **현재 template·profile revision·fingerprint 문맥**이 붙는다. queryless 수집 문맥과 명시적인 현재 profile 문맥은 같은 ID·카테고리 경로여도 완전히 같다고 볼 수 없다. 실제 값을 바꾸는지와 미저장 입력을 초기화하는지는 자체 fixture에서 별도로 재현해야 하며, 정적 원본 분석만으로 발생했다고 주장하지 않는다.

재구현 권고는 기존 상품의 captured 문서/schema를 기본 편집 문맥으로 유지하고, 현재 저장 profile/template의 명시 선택과 구분하는 것이다. 사용자가 의도한 새 양식 연결은 회사·category·revision·source 검사를 거쳐야 하며, 수동값을 조용히 지우거나 다른 상품/회사로 옮겨서는 안 된다. 원본은 저장된 완성 문서 모델이고 자체는 콘텐츠·옵션·수동 override를 해석하는 모델이므로, 내부 구조가 같다는 주장도 하지 않는다. 현재 template로 Excel을 내보내는 별도 기능의 적합성까지 이 조사로 판정하지 않는다.

## 정확한 source와 Evidence

원본 파일은 `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`, SHA-256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`다. 다음 범위는 UTF-16 code unit, 끝 제외이며 SHA는 원본 method slice를 UTF-8로 계산했다. 전체 범위·digest·읽은 자체 소스 hash는 `outputs/step718-original-manifest.json`에 있다.

| 경계 | 원본 범위 | raw method SHA-256 |
| --- | --- | --- |
| `initializeSchema` | `[232631,232814)` | `5f1632d2bb4bb1c12bc37985ae44578a49614217e224cc0136fe64c80c30e91e` |
| `initializeData` | `[232815,233811)` | `37b9503dd011192547861ec353d838004cf125606416b1d169d9a1eb5d66f9d1` |
| `getCurrentCoupangDoc` | `[235015,235560)` | `ce5e2956cc6e9a45d7ccde0adec274158ac66149c36282b6f38676bd6a43fae7` |
| `ensureRequiredFields` | `[243595,244132)` | `68039a9f2514ca2638102107669323cc59335cffe8747478dcbc4430d6cb1151` |
| `ensureSchemaBasedPriceFields` | `[244133,244874)` | `39f2bcfaa4025692ea15b9e87b05331022d76e83138da864c8458ae1b40b706f` |
| `savePendingChanges` | `[260643,263110)` | `4e3f79e717ec223efc472b41306b479e866b41f2aced3658d3be2e485def9726` |
| `applyPendingToData` | `[271036,271805)` | `6aa4f2e4d7f1b473d923fda3d97b151ff1bf76f103575762d19a707ee35efcd0` |
| `createProductObject` | `[436576,441156)` | `d359e61ea580bfcdead25cbecbbcb27390a41394bd3ee7b6238a04f74a4e3e53` |
| `initializeCoupangDoc` | `[444537,448566)` | `0b7c3e36d3c1048f75303995f3f4c8a5caa89ee1c5f9455a8d9201f0fff16eae` |
| `processNextVerification` | `[487753,492058)` | `e9a6114a4e9f82db46ff8b700d9fed5e915a310effe6fd8864729d5e5edcd706` |

과거 Step652 manifest의 `sliceSha256` 중 초기화 `41c70c…`와 전송 `e3a383…`는 실제로 **선택 wrapper 파일 전체 hash**다. 이번에 실제 파일 hash와 대조해 raw method hash와 분리했다. 원본 전체 SHA와 범위는 달라지지 않았으며 과거 Evidence를 새 분석으로 세지 않는다.

Step714 parent `ev_cc551a2398fd601ef51033ba716ee835ac9ad2317f899dd9409f8c032a10e841`를 REA `get_evidence_bundle` exact summary로 먼저 조회해 complete retained record와 선택 subject SHA `dda7841fe14c7a99aca12d13398e1bf63d3188f7727576e5512d32c151940b22`를 확인했다. 해당 parent는 저장·옵션 getter13개 선택 문맥이며 이번 schema 초기화·mount/watcher 전체의 근거로 확대하지 않았다. 초기 문서 parent `ev_d49bd95d5e4610573ee111bbc753a6055e2f0913515c0f96f146f2ff50050a6b`와 확장 protocol parent `ev_17ed0cebd00b285e0bc489221547e437d2b3f69d9b636a813eb942a0a2a3a49a`는 기존 보관 문맥이다.

새로 필요한 schema/저장 문서/lifecycle8개 node만 exact inert wrapper `outputs/step718-original-selected/quotationSavedContext.js`로 선택해 REA 정적 분석을 한 번 수행했다. wrapper SHA `b1f3962f4f719b1903abee8ef2c1456711afaa6444f76bd8eddc4a003a027cd3`, directory SHA `e140d61396fc41555717a43d3f1b6752bd0c1b4ea4f9424181401ead4a82681e`다. 새 parent는 `ev_acbeaa1a4da8f0951a2b43de776d411385c556877af4b1bd2c06c65835d20b96`, summary는 `ev_86adc4631244b3cb03ad6aa08f8e73df73f90275f045ad7a64ec1664064d9cf2`다. 4,579 bytes·1파일·AST959개·parse failure0이며 선택 application 범위는 complete, semantic 범위는 unknown·미확정246개다. 외부 `this`/Vuex/다른 helper/backend의 실제 동작은 해결하지 않는다.

portable ledger `outputs/step718-original-evidence-bundle.json`은 8,172,582 bytes·19 records이며 새 record는 parent/summary2개뿐이다. 나머지17개 retained 문맥을 이번 새 분석으로 세지 않는다. native/browser session은 열지 않아 종료할 세션도 없다. 현재 Couplus 화면·원격 저장·모든 category 기본값·실제 신규1688 수집과 Supplier Hub 최종 접수·SKU는 미관측이고, production 제출 gate나 기존 작업 상품 보호를 바꾸는 근거가 아니다.
