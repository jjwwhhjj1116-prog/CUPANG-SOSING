# Step737 — 초기 갤러리 후보와 SKU 사진의 출처 구분

2026-10-19 KST. Couplus `AIRocketReg`의 보관된 shipped UI와 현재 자체 정규화·이미지 초안만 대조했다. REA wrapper와 upstream 지침을 읽고 Step725·729·730·731·735 및 Step691~693·720의 기존 분석을 재사용했다. 이 담당은 앱·테스트·확장을 수정하지 않았고 브라우저·네트워크·계정·CLI 런타임·운영 DB·기존 상품에는 접근하지 않았다. 새 REA producer나 소유한 native/runtime 세션도 없다.

## 확인한 남은 차이

Couplus `processOptions`는 기본 옵션과 실제 SKU 모두에 `additionalImageStatus:{status:"pending",images:t.productImage.images}`를 넣는다. 따라서 **초기 4단계의 원문 후보**는 상품 갤러리다. 첫·둘째 SKU 속성 사진은 각각 `option1.imageUrl`·`option2.imageUrl`로 별도 보관하고, 선택한 사진은 `mainImageStatus.image`로 연결한다. 이 후보 보관과 최종 견적서의 추가이미지 선택은 다른 경계다.

현재 `parseAlibabaProduct`는 갤러리 첫 사진을 `main`, 나머지를 `additional`로 등록한 다음 첫·둘째 SKU 사진도 `additional` 역할로 같은 배열에 추가한다. `CollectionResult`는 이 배열의 역할과 선택된 `options.imageIndex`만 보존한다. 어떤 `additional`이 원래 갤러리인지, 어떤 것이 선택하지 않은 두 번째 SKU 후보인지 구분하는 자료가 없다. `collectedImageDraft`는 `additional` 전체를 공통 추가이미지 초안에 넣는다. 순차 이미지 저장의 `saveCollectionImage → attachCollectedImage`도 같은 역할을 사용한다.

완전히 합성한 원문을 실제 자체 parser와 `collectedImageDraft`에 넣어 재현했다. 원래 갤러리는 `gallery-main, gallery-additional`이고 SKU 사진은 갤러리에 없는 `sku-first, sku-second`다. 현재 공통 추가 초안은 `gallery-additional, sku-first, sku-second`였다. SKU 대표 연결은 `sku-first`로 유지됐다. 수동 공통 추가이미지 공란은 재반영에서 보존됐다. 따라서 원본 후보를 보존하려던 Step692의 수정 자체를 되돌릴 이유는 없으며, 남은 차이는 **원본 갤러리와 SKU 후보의 출처·자동 배치 구분**이다.

원본의 첫 갤러리 사진을 최초 최종 견적서의 additional wire에도 반드시 중복 삽입해야 한다는 결론은 내리지 않는다. Step693·720에서 `getAdditionalImageUrls`가 root.additionalImages를 읽고 pending 옵션 갤러리를 직접 읽지 않는 경계를 이미 기록했다. 이번 감사는 그 미확인 사항을 완료 기능으로 바꾸지 않는다.

## 원본과 증거

| 항목 | 정확한 근거 |
| --- | --- |
| 현재 보관 route | `outputs/step725-current-ui/chunk-36123f1a.155d5b9e.js` / SHA-256 `2fb15d370c331f65d982a886f2888b813ccae67277e87f806182c70032821664` |
| 현재 `processOptions` | UTF-16 `[467246,469661)` / slice SHA-256 `3b006f4f7a14b17fcdaf1846dc7fbb3717ae87b35952a86bbc7bbf2af672f5bb` |
| 기본 옵션 갤러리 assignment | UTF-16 `[467876,467945)` / UTF-8 `[515273,515342)` |
| 실제 SKU 갤러리 assignment | UTF-16 `[469293,469362)` / UTF-8 `[516736,516805)` |
| 두 assignment의 같은 slice SHA | `4282ce4a4a8838c6b7926056e638ee7a6eb051e11998c390e55295a5d8a57d3c` |
| 이전 보관 route | `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js` / SHA-256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc` |
| 이전 `processOptions` | UTF-16 `[466662,469077)` / slice SHA-256 `4a5671380c795a5b6e598bc3abfcdf54cb66318a62119f43478964ee68b0e3f0` |
| 재사용 REA 선택 source parent | `ev_5869fb5a1a6ec67485ac76e74414a221ecb4eb7a035d0344c07e66b28c7bcec2` |
| 재사용 summary | `ev_40f57053660d6ff48348b5af5719c9cd3a761514c4acbf5cdeb4b62b7cadf68a` |

이전 함수의 helper alias `Bt→Gt`, `Vt→Wt`만 바꾸면 현재 함수 전체와 정확히 같다. 현재 bytes·slice hash를 다시 확인했으므로 이전 source-bound Evidence의 해당 계약을 재사용했다. 이 REA record는 선택한 함수 한 개, AST558, parse failure0, application/semantic partial과 unknown11/231이며 서버·Vuex·`this`·이미지 후속 실행 전체를 보증하지 않는다. 원본의 live 상품 응답이나 runtime을 새로 관찰한 증거가 아니다.

재현기 `outputs/step737-intake-parity-proof.mjs`와 결과 `outputs/step737-intake-parity-proof.json`은 원본 identity·범위·hash, 당시 자체 소스6개의 SHA, 실행 전후 동결과 합성 결과를 보관한다. 이것은 릴리스 검사 총계가 아니라 좁은 문제 재현이다.

## 최소 재구성 권고

1. 신규 **OpenAPI 후보 parser**가 검증한 `productImage.images` 순서를 정규화할 때만 선택적 원문 marker(예: `sourceGallery:{format:'1688-openapi-gallery-v1',imageIndices:[...]}`)를 만들고 해당 receipt에 보존한다. 첫/둘째 SKU 후보와 `imageIndex`는 현재대로 남긴다. 새 marker는 source provider·정확한 key·dense integer list·중복·범위·해당 image의 non-detail 역할·첫 main 위치와 원래 정규화 순서를 검증한다. 임의 SKU 후보를 gallery로 역산하지 않는다.
2. marker가 없는 기존·모바일·JSON-LD receipt는 현재 정책을 그대로 유지한다. 과거 원문을 다시 수집하거나 immutable receipt·기존 상품의 이미지 배치를 소급 변경하지 않는다. 공급자 정보를 새로 받았다는 증거가 없는데 provider를 바꾸거나 marker를 추가해서는 안 된다. source 보완이 provider를 바꾸는 기존 경로에서도 marker를 보존할 수 있는지 검증 규칙을 함께 확인한다.
3. marker가 있는 새 receipt에서는 갤러리와 선택 SKU 사진을 **모두 원본 자료함에 보관**하되, 공통 추가 초안에 비갤러리 SKU 후보를 자동 선택하지 않는다. 기존 `main/additional/detail` 파일 역할 모델을 이 문제 하나 때문에 넓힐 필요는 없다. 초기 Stage4 후보/그룹 표시가 source marker를 읽는 경우에도 사용자의 전체 자료함 선택은 유지한다. 첫 gallery의 최종 견적 추가이미지 중복은 별도 근거 없이 구현하지 않는다.
4. `saveCollectionImage`의 기존 `assignToStage`는 공통 배치와 옵션 대표 연결을 함께 제어한다. 비갤러리 SKU 후보의 공통 배치만 막으려고 이 값을 false로 바꾸면 Step692의 실제 SKU 대표 연결도 사라진다. 공통 배치 허용 여부만 별도로 계산하고 SKU 연결·원본 파일 저장은 기존 flag·정확한 SKU guard를 유지한다. 순차 저장, 이미 저장한 파일 재사용, `collectedImageDraft`, 경고 계산이 같은 허용 판정을 써야 한다. 후보 전용 파일을 의도적으로 공통 추가이미지에 넣지 않은 경우에는 잘못된 미배치 경고를 내지 않는다.
5. 수동 공통 추가사진·명시 공란·번역/생성 provenance·선택 제외/파일 분리·추가30개/전체50개 제한·현재 SKU 연결·두 회사 소유권 보호를 유지한다. gallery/SKU가 같은 URL이면 해당 gallery index를 재사용하고, 상세의 독립 순서는 유지한다. marker 손상이나 다른 provider의 marker는 실패해야 하며 조용한 추정으로 복구하지 않는다.

최소 검사 범위는 gallery 밖 첫/둘째 SKU 후보·gallery와 동일 URL·선택되지 않은 둘째 후보·모바일/기본 옵션/옛 receipt 유지·명시적 공란·수동 공통 변경·순차/일괄 저장·재시도·추가 초안·경고·marker 재저장/보완·두 회사 격리다. 실제 새 1688 취득·가격 공급자·모든 카테고리·이미지 번역 품질·Supplier Hub 접수와 native live gate는 이번 감사로 검증되거나 바뀌지 않는다.

## 수정 후 독립 검토

root가 구현한 `sourceGallery`와 공통 배치 분리를 읽고 검토했다. `parseAlibabaProduct`는 갤러리 정규화 직후 고유 prefix를 보존하고, 실제 SKU의 첫·둘째 후보·대표 index·파일 역할은 그대로 둔다. validator는 marker key/descriptor·배열의 밀집 prefix·image 역할·허용 provider를 확인한다. 기존 receipt는 marker를 요구하거나 추가하지 않는다. 원본 pending 후보와 최종 견적 wire의 차이를 지킨 좁은 구현이며, 첫 갤러리 사진을 추가 wire에 중복 삽입하는 변경은 없다.

공통 추가 초안 predicate는 `collectedImageDraft`와 순차 저장·이미 저장한 원본의 경고에 적용된다. DB 저장의 공통 배치 flag는 기존 `assignToStage`와 분리돼 실제 SKU 대표 연결을 끊지 않는다. 수동/번역/제외 상태 보호 조건은 바뀌지 않았으며, append-only supplement는 원래 marker·이미지 prefix·옵션 identity를 보존한다. 모바일/JSON-LD/예전 receipt에 새 marker를 추정해 붙이는 코드도 없다.

격리된 자체 source 실행의 독립 단언9개에서 신규/legacy 배치, SKU 대표와 선택하지 않은 둘째 후보 보존, 수동 공란·제외 옵션·번역 배치·분리 파일 보호, gallery=SKU URL 재사용, 후보 전용 경고 억제와 실제 SKU 미연결 경고 유지, 신규/legacy supplement, 손상 marker/provider/symbol/sparse/accessor 거절을 확인했다. getter 실행은0이었다. 해당 실행 전후 소스8개의 SHA는 동일했고 actionable 지적은 없었다. `outputs/step737-intake-parity-review.{mjs,json}`에 조건·소스 SHA·범위와 결과를 보관했다. 이9개는 root의 릴리스 검사 총계에 중복 합산하지 않는다. 실제 HTTP·이미지 번역·live Chrome·운영 DB·접수 검증으로 확대하지 않는다.
