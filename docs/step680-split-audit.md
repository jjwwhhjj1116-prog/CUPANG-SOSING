# Step680 — 보존 Couplus 분할 생성·상세 형제 적용 정적 조사

2026-10-15. 앱·DB·검사 코드는 수정하지 않았다. 보관 JavaScript만 읽었고 Couplus·Chrome·1688·Supplier Hub에는 접근하지 않았다. 아래는 정적 관찰과 그에 따른 재구현 제안이며 실제 서버 실행·저장 성공의 관찰이 아니다.

## 자료와 Evidence

- `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`: SHA-256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`, 553,312 bytes.
- `outputs/step652-current-couplus/main.a20c7114.js`: SHA-256 `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`, 579,613 bytes.
- 기존 Step676 Evidence bundle을 import하여 재사용했다. `ev_782e7a89a96a33a05f38b2d977a5ee4001676f0891cc87373d600c7252192396`는 기존 `selected` 분석(일반 save 포함), `ev_8ec3fd01351174fefebdc0fccae8f936ebf1c20201f4c59c76aff551e848ec3c`는 `headers-selected` 분석이다. 최초 하위 세션에서는 retained parent가 없어 오류였지만 bundle import로 해결했다.
- 새 좁은 분석 parent: `ev_9ba78b705b9c68a727604eaf0bebe7f726bbbe8fea6c6d38d50ac77d2b88e1ba`; summary: `ev_c9d9ee950f92f5a97fb95a891ec7d8399335a204dc7f1ac4e0705f3cb3dec293`. 원문 AST 조각 19개, 파싱 실패 0. derived 디렉터리 SHA-256 `def2f227803a683ea0f048dfa61d9a6f0cca00589482bbaaeaefadf7d304ad97`. 의미 관계에는 1,572개 unknown이 있어 호출 성공·동적 도달 가능성의 증거로 쓰지 않는다.
- 원문 범위, UTF-8 byte 범위, 조각 SHA 및 derived SHA는 `outputs/step680-split-audit/source-manifest.json`; 정확한 inert 조각은 같은 폴더 `selected/`; portable bundle은 `rea-evidence-bundle.json`이다. 아래 범위는 모두 **원문 UTF-16, 끝 제외**다.
- 후속 중복 판정 질문만 추가로 분석했다. parent `ev_71725cfba122fe7b69681be4db2041374d90c7a8ec714ad90e6b599911130af9`, summary `ev_4ca7f8535b40b14905349ff7aef537d60a719883d6a2938d34ad3b4b083bd7b0`. 조각 7개, 파싱 실패 0, derived SHA-256 `0af588eaaa0cd197bee99cd7fa80e6817360e831b17c6ba2bbe0d78d0d54c5cd`. 원문·조각 연결은 `duplicate-manifest.json`과 `duplicate-selected/`에 있다. 이 분석의 의미 관계에는 434개 unknown이 있다.

## 이번 구현에 직접 쓸 중복 비교 범위

부모 작업은 명시적 분할 가족 모델이 아직 없는 점을 반영해, 7단계/등록 검토 화면에서 **노출속성 중복 비교·검토**부터 제공하기로 했다. 자동 분할·형제 전파·Couplus/Hub의 확정 거절 판정을 뜻하지 않는다. 아래 두 원본 판정을 섞어서 하나의 완전 일치 규칙이라고 표현하면 안 된다.

| 관찰 | 최초 등록 세부정보 생성 검사 | 분할 후 재검사 |
| --- | --- | --- |
| 원문 | main `[42164,42809)` | `[57317,59153)`, `[62486,63004)` |
| 비교 key | `JSON.stringify(exposedAttributes)` 전체 원본 | `JSON.stringify(attributes.map(a => ({ name: a.attributeName, value: a.attributeValue })))` |
| 포함 범위 | 공통 `coupangDoc.jsonDocument` 전체 | 같은 공통 문서 전체; 개별 상품 처리에서는 options 수 1 이하일 때 검사 생략 |
| 선택/제외/등록 상태 | 별도 필터 없음 | 별도 필터 없음 |
| 순서/공백/빈 값/NA | 배열 순서, 문자 공백, 빈 값과 `N/A` 등 원문 값을 그대로 비교 | 동일하게 보존 |
| 부가 object 속성 | key에 포함 | name/value 이외 속성은 제외 |
| 빈 attributes 배열 `[]` | truthy여서 서로 동일하다고 판정 가능 | map 결과 `[]`로 서로 동일 |
| attributes 필드 전체 null/undefined/빈 문자열 | falsy여서 건너뜀 | falsy여서 건너뜀 |
| 배열 내부 null 원소 | raw JSON에 포함되며 별도 제거 없음 | property 접근에서 throw할 수 있음; 안전한 malformed 처리 없음 |

공통 prerequisite `checkCoupangDocExists` main `[34337,34490)`는 product/coupangDoc/jsonDocument가 존재하고 jsonDocument가 배열이며 길이 > 0임을 확인한다. 각 문서는 productPage/commonAttributes/exposedAttributes의 truthiness만 확인한다. 속성 배열 정렬·이름/값 trim·대소문자 통일·NA 치환·빈 속성 제거는 확인한 두 detector 모두 하지 않는다. raw 검사에서는 문서의 추가 메타데이터나 배열 순서가 다르면 같은 이름/값이어도 다른 key가 될 수 있다.

재구현 판단: 검토 항목은 사용자의 현재 저장 자료에서 비교 범위와 누락/손상 여부를 함께 보여 주어야 한다. 값이 미입력인 경우를 원본과 같은 의미의 확정적인 실제 중복이나 Hub 반려로 단정하지 않는다. 완전한 분할 생성·원본/자식 관계·선택 대상 상세 적용은 별도 후속 작업으로 남는다.

## 일반 저장과 명시 적용은 별개

`saveDetailPage`는 chunk `[131264,136334)`에서 현재 상품과 그 상품의 모든 옵션만 저장한다. 분할 형제 순회가 없다. 상세 형제 적용은 별도 `applyDetailToSiblings` `[100938,102402)`다.

형제 버튼 `[87871,88185)`은 `splitSiblings.length > 0`일 때 보이며 현재 `detailImages.length === 0`이면 disabled다. 대화상자 `[94665,95599)`에는 대상별 체크박스와 등록 전송됨 배지가 있다. `openSiblingApply` `[100658,100937)`는 `registered === true`인 대상만 기본 미선택한다. 사용자가 직접 체크할 수 있어 등록 완료는 강제 금지가 아니다.

형제 식별은 `splitSiblings` `[96974,97367)` 및 `getSplitBaseId` `[100598,100657)`에서 수행한다. 별도 `parentId`나 nested 배열을 읽지 않는다.

1. 현재 상품과 후보 모두 `registrationId`가 있어야 한다.
2. 양쪽 `_id`가 truthy이면 문자열 `_id`가 같은 자신을 제외한다. 어느 쪽 `_id`가 없으면 같은 `registrationId`를 제외한다.
3. `String(registrationId || '').replace(/_\d+$/, '')`의 결과가 같아야 한다. 끝의 `_숫자` 한 묶음만 제거한다.
4. 구매링크는 둘 다 존재하면 정확히 같아야 한다. 한쪽이라도 falsy이면 링크 검사를 통과한다.

`applyDetailToSiblings`는 체크 대상이 없으면 경고만 한다. 대상이 있으면 `isPropagating=true` → 현재 상품 `saveDetailPage()` → store의 현재 `product`를 읽고 상세 이미지 배열·공통 `jsonDocument[0]`의 `detailedImage`(falsy이면 이미지 쉼표 연결)를 취한다. 각 대상을 store에서 `_id || registrationId` 문자열로 다시 찾되 실제 저장 대상은 `_id`가 있어야 한다. 순차 저장하며 개별 실패를 수집하고 성공/일부 실패 안내 후 모달을 닫는다. 전체 원자성은 없다.

`saveDetailPage`가 내부 catch에서 오류를 삼키고 성공 Boolean을 반환하지 않으므로, `await`만으로 원본 저장 성공을 보장하지 않는다. 처리 이미지 0의 조기 return도 같은 반환이다. 재구현에서는 저장 성공과 재조회된 버전을 확인한 후 복제를 진행하는 편이 필요하다. 이는 재구현 판단이다.

## 형제 대상에 실제로 복사하는 범위

`applyDetailToOneProduct(target, source, detailImages, detailedImage)` chunk `[102403,103651)`의 정확한 patch:

| 범위 | 기록 값 |
| --- | --- |
| root `detailImages` | 전달받은 배열 복사 |
| root `detailHtml` | `source.detailHtml || ''` |
| root `processedDetailImages` | `JSON.parse(JSON.stringify(source.processedDetailImages || []))` |
| root `detailImageStatus` | `completed` |
| root `detailImageStatusObj` | `{ status: 'completed', images: [...detailImages] }` |
| root `originDetailImages` | 원본 상품 값 deep copy, 없으면 `[]` |
| root `lastModified` | `new Date` |
| target 공통 `coupangDoc.jsonDocument`의 모든 존재 `imagePage.details` | `detailedImage` 덮기, `htmlProductDetailContent=''` |
| target 모든 options | `detailImages`, 상태와 상태 객체를 같은 값으로 덮기 |
| target 각 option `coupangDoc.jsonDocument[0].imagePage.details`가 존재할 때 | `detailedImage` 덮기, `htmlProductDetailContent=''` |

**상세 root 상태와 견적 문서를 함께 갱신한다.** 복사 patch에 `altText`, 대표/추가 이미지, 법정 표시사항, 상품명, 가격, 등록 플래그는 없다. 따라서 대상의 ALT는 유지된다. 일반 상세 저장의 ALT 재작성 정책을 형제 대상에 그대로 확장하면 원본과 다르다.

저장은 `this.$store.dispatch('updateProductPartial', { productId: target._id, updateFields: patch })`다. main mutation `[237772,238755)`은 점 경로를 store 객체에 적용한다. action `[282440,283788)`은 먼저 store commit을 하고 `POST /api/aiRocketReg/updatePartial`에 같은 payload를 보낸 뒤 `data.요청결과 === 'success'`를 검사한다. 실패 시 throw하지만 이미 적용한 store를 되돌리는 코드는 이 action에 없다. 백엔드 저장 방식·트랜잭션·영속 성공 여부는 미확인이다.

## 분할 생성의 호출과 그룹 정책

확인한 첫 호출은 **quotationService.process의 등록 세부정보 생성 후 자동 분기**다. SEO 편집 전용 클릭이나 상세 저장 분기가 아니다. main `[42164,...]`의 중복 검사는 각 공통 견적 문서의 `productPage.commonAttributes.exposedAttributes` 전체를 `JSON.stringify`해 동일한 옵션 인덱스를 묶는다. 이어 `j.length > 0` 분기 `[42972,50374)`가 `DETECT_ADDITIONAL_ATTRIBUTES` AI 요청을 하고, 파싱한 속성 목록으로 `splitProductByAdditionalAttributes(product, attributes)`를 호출한다. AI 결과가 모두 같으면 개선 프롬프트로 한 번 재요청하고 여전히 같으면 옵션명별 분리 정책을 사용한다. 분할 뒤에는 새 상품들의 노출속성을 다시 검사하여 재분리를 시도하는 경로도 main의 `processExposedAttributesForSplitProducts`/`handleProductResplit`에 보인다.

`groupOptionsByAdditionalAttributes(options, attributeRows, originalSnapshot)` main `[69794,72574)`:

- 모든 row의 `attributes`가 배열이 아니거나 빈 배열인 경우, 또는 2개 이상 row의 attributes 전체 JSON이 모두 같은 경우: 응답의 optionNumber를 옵션에서 찾아 **옵션별 개별 그룹**. label은 `korName || name || ''`.
- 그 외: 계층형 object는 level 정렬 후 `level:value` 목록 JSON, value object는 value들을 정렬한 JSON, primitive 배열은 정렬한 JSON을 그룹 key로 쓴다. label은 해당 value들을 공백으로 연결한다. 해당 row 속성이 없으면 `옵션명:${optionNumber}`를 고유 key로 쓴다.
- 같은 속성 그룹에 이미 있는 옵션과 원본 견적의 노출속성을 `{ name: attributeName, value: attributeValue }` 목록 JSON으로 비교해 같으면 별도 그룹을 만든다.
- 응답 optionNumber와 일치하는 옵션이 없으면 무시한다. **모든 원본 옵션이 정확히 한 그룹에 한 번 들어가는지 확인하는 검증은 이 메서드에 없다.** 따라서 이 결손 동작을 안전한 재구현의 분할 검증으로 취급하면 안 된다.

## 원본 유지와 독립 새 상품 저장

`splitProductByAdditionalAttributes` main `[67903,69793)`는 원본을 JSON deep clone하여 snapshot을 만든다. 그룹이 1개 이하이면 `success:false`로 끝난다. 그룹 1은 `updateOriginalProductForSplit(original, group)`로 갱신하고, 그룹 2 이후는 `createNewProductForSplit(snapshot, group, groupOrdinal)`로 만든다. 원본 상품은 삭제하지 않는다.

`updateOriginalProductForSplit` `[72575,75935)`는 원래 `_id`와 `registrationId`를 유지한 채 첫 그룹 옵션과 그에 해당하는 공통 견적 문서·pricing 옵션만 남긴다. optionNumber는 `registrationId + 세 자리 순번`으로 다시 부여한다. 상품명/SEO명/견적 상품명 등에 그룹 label을 `, `로 붙인다. 부분 저장 성공 후 원본 객체와 store를 갱신한다.

`createNewProductForSplit(originalSnapshot, group, groupOrdinal)` `[75936,79290)`의 `groupOrdinal`은 로그에만 사용한다. 실질 신규 registrationId는 `issueSplitRegistrationId(original.registrationId)`가 반환한다. snapshot 전체를 deep clone한 뒤 `_id`를 삭제하고 새 registrationId를 넣는다. root registered/verified=false, 옵션은 해당 subset만 남기고 새 번호를 부여하며 registered/verified=false, registrationStatus=''로 만든다. 공통 견적 문서는 기존 옵션 index에서 subset을 복제하고 상품명을 갱신한다. pricing도 subset으로 줄인다. `coupangDoc.docId`는 보존한다. 원본 clone의 다른 내용·첨부는 기본적으로 유지하며 별도의 영속 `parentProductId`/`splitProducts` 필드를 추가하지 않는다.

`saveRocketProduct` `[455255,455464)`는 **`POST /api/rocketReg/saveItems`에 `[newProduct]`**를 보낸다. 응답 `res === 'success'`를 요구하고 `savedItems[0]`를 우선 결과로 쓴다. `issueSplitRegistrationId` `[455465,455723)`는 `POST /api/rocketReg/issueSplitRegistrationId`에 `{ baseRegistrationId }`를 보내며 성공 응답의 registrationId가 truthy인지 요구할 뿐이다. `_1`, `_2` 등의 번호 발급 정책·서버 유일성/경합 처리·DB 구조는 이 보관 클라이언트로 확정할 수 없다.

분할 완료 이벤트의 `splitProducts`는 `[원본, ...새 상품]`을 화면에 전달하는 event detail이다. chunk `handleProductSplitCompleted` `[412548,413435)`는 목록의 기존 원본 자리를 첫 상품으로 갱신하고 나머지 상품을 다음 행들에 삽입한다. 따라서 코드 관찰상 **독립 상품 레코드/행을 저장·표시하려는 구조**이며 root 내부 nested 제품 배열의 증거가 아니다. 서버 DB의 물리 테이블 표현은 미확인이다.

원본 갱신과 새 상품 저장은 순차 요청이다. 새 상품 생성 실패는 해당 항목을 결과에서 제외하고 계속하며 최종 `totalProducts`는 계획된 그룹 수다. 원본 변경 rollback도 이 분할 함수에 없다. `success:true`와 계획 그룹 수를 모두 저장 완료로 해석하면 안 된다.

## YOOFAM PLUS 연결 판단과 구현 방향

현재 앱은 하나의 `productId` 아래 공통 + 평면 옵션별 견적 수정값을 저장한다. `app/components/dashboard-client.tsx:713`, `app/components/option-image-editor.tsx`, `app/product-options.ts:23`, `app/quotation-schema.ts:68,570,612`, `app/detail-save-plan.ts`가 해당 구조다. 현재 `collection_context.forkedFrom`은 독립 수집 draft의 출처이며 Couplus 분할 그룹이 아니다. 기존 fork의 출처나 URL 일치만으로 상세를 전파해서는 안 된다.

재구현 판단: 먼저 명시적인 분할 그룹/원본·자식 관계와 선택 옵션의 완전한 분할을 저장해야 한다. 첫 그룹의 원본 유지와 나머지 독립 상품 생성, 각 상품의 옵션/견적/가격 subset을 별도 계획으로 확인한다. 신규 내부 ID와 표시 번호는 앱 설계로 분리하며 Couplus 서버 번호 발급을 추정하지 않는다. 그 뒤 해당 그룹 내 사용자가 선택한 상품에만 상세 적용을 제공한다. 원본 상세 저장 성공을 재조회로 검증하고, 대상별 기존 ALT·대표/추가 이미지·표시사항을 보존하는 범위의 patch와 실패 보고를 구현할 수 있다.

실제 Couplus API·서버·등록 접수·번호 정책과 현재 앱의 신규 분할 기능은 이 조사로 구현/실행/검증한 것이 아니다. 이 조사 소유의 네이티브 세션·브라우저·프로세스는 열지 않았으며 정리할 런타임 자원은 없다.
