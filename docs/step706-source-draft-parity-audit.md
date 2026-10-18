# Step706 — 수집 원문이 초안·견적 AI에 전달되는 범위

2026-10-18. 기준 commit `ba8f83de82e6e118a05c44090459245186456b3c`. Step705의 URL 자체 서버 조회·확장 양식 연결은 재조사하지 않았다. 이번에는 보관 클라이언트의 **수집 응답 → 저장 상품 → 7단계 참고자료**와 초기 SEO/가격의 실패·완료 조건만 정적으로 대조했다. 외부·브라우저·vendor 실행·기존 상품 변경0이며 앱·테스트를 편집하지 않았다.

## 확정된 작은 차이

현재 견적 AI는 이미 수집·번역되어 카테고리 필드에 정확하게 연결된 일반 상품 속성을 참고자료에서 빠뜨린다.

원본은 `prepareAttributeRequest`에서 `productAttribute:e.attributes||[]` 전체를 만들고 공통 비노출·공통 기타·옵션별 속성 생성 prompt에 넣는다. 자체는 초기 수집 속성들을 `CollectionResult.attributes`와 번역 후 `content.categoryAttributes.values`에 저장한다. resolver도 같은 카테고리·정확한 이름 또는 유효한 field signature binding으로 이를 양식에 채운다. **이 초기 자동 연결은 이미 구현되어 있다.**

그런데 `buildQuotationAiPlan().facts.attributes`는 label의7개 값만 넣고 `categoryAttributes.values`는 넣지 않는다. 일반 속성으로 채운 필드는 source:`content`이며 manual-common/manual-option 보호값이 아니므로 견적 AI의 writable 대상에 남는다. 따라서 참고할 원문 번역값을 잃은 상태로 새 제안을 만들 수 있는 정보 누락이다. 실제 모델이 틀린 값을 생성·저장했다는 실행 관측과는 구분한다.

독립 순수 재현 `outputs/step706-analysis-category-attribute-loss.{mjs,json}`:

1. 합성 공식 양식에 ‘호환 기종’을 추가하고 같은 카테고리의 server-created 속성값 ‘전용기기-706A’를 준다.
2. 실제 자체 resolver는 해당 셀을 값 ‘전용기기-706A’, source:`content`로 채운다.
3. 같은 저장본의 견적 AI facts 전체에 이 값이 없고 해당 field ID는 모든 target의 writable 목록에 남는다.
4. 별도 수동 override로 바꾸면 기존 manual 보호는 그대로 작동한다.

semantic 단언8개와 파일 hash 불변을 확인했으며 release 검사 개수에는0개를 더한다. 원격 AI·DB·기존 상품은 사용하지 않았다. 수정 전 `app/quotation-ai.ts` SHA는 `61f55c4800557fcc775d363bd06913e8067e827b78479c81bcacd0ad9f6295cd`다.

가장 좁은 재구현은 같은 카테고리의 내부 생성 속성 snapshot을 **AI 참고자료**에 추가하는 것이다. label7개·수동값 보호·원문 회사/상품/카테고리·기존 binding signature 검증은 유지한다. sourceName은 출처 설명이며 새 field binding 권한으로 쓰지 않는다. 수집 서비스 공급자 연결, 배송 단위 추정 또는 자동 등록 완료로 확대하지 않는다.

## 원본 데이터가 실제 쓰이는 곳

보관 UI SHA `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`; main SHA `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`.

| 응답 원문 | 원본 클라이언트의 소비 | 자체와의 대조·제한 |
| --- | --- | --- |
| `subject`, `subjectTrans` | `createProductObject`의 productName/productNameTrans. 초기 문서명과 SEO prompt의 원문·번역 이름으로 전달 | 자체는 원문 제목과 독립된 번역·SEO 이력을 유지한다. API의 subjectTrans가 한국어라는 증거가 없어 무조건 한국어로 재사용할 근거는 없음 |
| `productAttribute` | 상품 attributes로 보존 → prepareAttributeRequest → AI의 전체 속성 JSON 참고 | 일반 수집 속성·번역 category snapshot은 자체에도 존재. 이번 차이는 **나중 견적 AI 참고자료에 넣지 않는 부분** |
| `productShippingInfo` | 상품에 보존 → alibaba.productShippingInfo → 공통·옵션 AI의 물류 참고 JSON | 자체 CollectionResult에는 해당 객체가 없다. raw 배송의 규격·단위·SKU 연결을 보지 못했으므로 임의 해석하지 않음 |
| `description` | 신규 상품에서는 extractDetailImages로 상세 이미지 목록을 만든다 | 신규 product literal에는 description 필드를 별도로 넣지 않는다. 이후 prepareAttributeRequest의 `e.description||''`가 실제로 채워지는지는 saveItems 서버 후처리가 미확인. 자체의 보존된 설명을 지울 근거가 아님 |
| `productImage.images` | productImage 첫 장·mainImages 전체, 옵션 이미지 후보/추가 이미지의 초기값 | 첫 두 SKU 이미지→공통 첫 사진의 기존 조사·수정을 반복하지 않음 |
| `productSkuInfos` | SKU별 옵션명·원가·재고·사진 및 옵션별 문서 초기화 | 전체 원가 동일 여부·상품 첫 가격·기본 옵션 분기는 이전 조사/구현 범위. 새 누락으로 다시 보고하지 않음 |

원본 `prepareAttributeRequest`에는 배송이 없을 때 `skuShippingInfoList:[{weightKg:1,lengthCm:30,widthCm:20,heightCm:10}]`를 만드는 fallback이 있다. 이는 실제 측정 증거가 아니다. 또 prompt는 물류를 추정하도록 안내한다. 이 기본 숫자를 실제 수집 원문이나 사용자 확인 사실로 복제하지 않는다. 이번 수정에는 배송 무게·치수·원가·MOQ 정규화가 없다.

원본 저장 literal은 description에서 추출한 이미지·상하단 배너와 가격/옵션 상태를 준비하지만, URL 추가 직후 모든 이미지 가공·표시사항·견적 AI와 Hub 등록까지 완료한다는 증거는 없다. 초기 SEO/가격 이후 나머지는 전체 작업으로 진행하는 분기가 별도로 존재한다.

## 초기 SEO/가격 실패·중복·완료 판정

원본 `runInitialProcessing`은 initial flag를 켜고 SEO task를 await한 뒤 최신 store 상품으로 pricing을 await한다. 마지막 toast는 ‘초기화 완료’다. 그러나 task await 자체가 성공한 저장본을 보장하지 않는다.

- `executeSingleTask`는 시작에 feature status를 processing으로 바꾸고 running key Set에 추가한다. 이 함수 안에는 같은 key가 이미 있으면 진입을 거절하는 검사가 없다. 실제 UI의 동시 호출 가능성까지 관찰한 것은 아니다.
- 일반 task 오류/반환 error를 feature error로 기록하고 다음 작업을 진행한다. 특별한 SEO `GEMINI_API_ERROR:` 예외만 다시 throw한다.
- SEO `process`는 partial-save 실패를 내부 catch한 뒤에도 완료 task를 commit하고 status completed를 반환할 수 있다.
- 따라서 원본 성공 toast나 resolved Promise를 서버 저장·모든 옵션 완성의 증거로 쓰면 안 된다. 이를 동일구현이라는 이유로 자체의 저장 확인·버전 검증·실패 이력·중복 방지 대신 적용하지 않는다.

자체 `prepareIntakeSeoOutcome`은 문구가 아니라 완료 callback, review-required, manual-ready를 분리한다. 저장 preview/동일 버전/fingerprint/apply 결과를 확인하고 누락 속성·설명·실패 이력·명시적 수동값을 보존한다. 같은 원문 요청 재시도와 실제 새 수집·생성을 구분하는 점은 원본과 다른 보호 설계이며 이번 기능 누락으로 보고하지 않는다.

## 범위·Evidence

기존 REA parent `ev_cd5b12712ef6b71c2acfc13858957b76b067e15d1319aac6ac68b3c3a642258a`, `ev_80058b8130c110cfd1ec44a0c48cf2441311a5ce02c3a66e52f40c0fbf65b42f`, intake parent `ev_1983224a44e1100a435aca7caaa76ebb6e1d9df782252092d57dcc695765e8ee`를 재사용했다. 새 producer는 실행하지 않았다.

이번 source-bound manifest `outputs/step706-analysis-source-consumer-methods.json`:

| 메서드 | 원문 UTF-16 | slice SHA-256 |
| --- | --- | --- |
| prepareAttributeRequest | `[136502,138303)` | `cba34822c2f614e3b1bc8277332ca061e50fb023449f77019900a0f9e1d5273c` |
| generateCommonUnexposedAttributes | `[89468,92566)` | `a5174347126588476e767cbec39b913b79a943294dcf08d5b0c4296ff31363fd` |
| generateCommonOtherAttributes | `[92567,97852)` | `688c09e2ad21eb4d8afc4e294c0978f852ceb474dae0968e80498ababec32b44` |
| generateDifferentiatedAttributesBatch | `[101708,107197)` | `69b80c486fb0515c139d2c5fdb9146f35fbefef6c9c8b403f506cb80ba4bad88` |

초기 처리·SEO 저장·task runner는 보관 `outputs/step660-intake-rea-manifest.json`과 exact wrapper를 재사용했다. 일반 수집 backend의 실제 provider/응답·속도·신규 상품 전체 원문 수집은 이 감사로 해결/검증한 것이 아니다. 실제 AI 응답·Hub 접수·최종 등록 성공도 관측하지 않았다.

## 수정 후 독립 검수

root의 동결된 `app/quotation-ai.ts`, SHA `b634c1ae0c11ba613578197946c5df0b63395f016547dcf86256d793459e5eac`를 독립 검수했다. sourceName은 optional 참고 설명이며 provenance는 고정 `category-source-translation`이다. 카테고리가 정확하게 같을 때만 primitive name/value·출처·job 연결을 검증하고50개·문자 길이·제어문자·기존 전체 plan/prompt 크기 제한을 유지한다. 초기 resolver·bindings와 기존 label·수동값 보호를 변경하지 않았다.

`outputs/step706-analysis-independent-review.{mjs,json}`의 순수 검수8개 그룹이 통과했다. 같은 category의 참고값 전달·다른 category/legacy 미혼합·sourceName의 비권한성·manual common 공란과 option 값 보호·malformed 값의 typed AI_SOURCE·개수/길이 경계·기존4개 AI 단계 prompt 전달·stablePlan 전체 request identity 연결을 확인했다. provider는 로컬 stub4회만 호출했고 원격 AI 요청은0이다. 추가 actionable finding0, release 검사 수 기여0이다.

현재 request fingerprint는 새 plan.facts를 포함한다. 코드 recipe 변경만으로 이전 완료 job이나 저장한 상품을 자동 재작성·무효화했다고 주장하지 않는다. 앱·테스트는 root/다른 담당이 소유하며, 실제1688 수집 provider·새 상품 전체 원문·모델 품질·Hub 접수는 이번 참고자료 연결 수정과 별개의 미검증 범위다.
