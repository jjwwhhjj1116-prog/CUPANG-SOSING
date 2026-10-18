# Step704 — 한글 표시사항 AI 초안과 저장값 PNG 생성 분리

2026-10-18 KST. 기준 HEAD `e5612771d1be01273ac09064c4d46207a9d44749`. REA 설치 지침과 보관 UI/main Evidence를 재사용한 정적 조사다. 새 producer·vendor 실행·네트워크·브라우저·기존 작업 상품 접근은0이다. 소유는 본 문서와 `outputs/step704-analysis-*`이며 앱·테스트는 담당자가 수정한다.

## 확인된 핵심 차이

원본 기본6단계의 ‘한글 표시사항 생성 시작’ 버튼은 저장된 값을 PNG로 그리는 함수가 아니다. `startKoreanLabelProcessing()`은 상품 전체로 `requestKoreanLabelData()`를 호출하고, store action은 `KOREAN_LABELS` 작업과 상품 기반 prompt를 확장에 보낸다. 자체 기준 버전의 같은 이름 버튼은 `renderDocument(productLabelPlan(...))`로 저장된 표시사항 PNG만 만든다.

자체에는 이미 수집 속성 번역·표시사항 연결과 라벨 이미지 번역 기능이 있다. 이것들이 전혀 없다는 지적이 아니다. 그러나 제목·상품 속성·묶음 정보를 사용해 **내용량·재질·상품 유형3개를 제안하는 원본의 별도 라벨 초안 요청**은 기본 버튼 경로에 없다. 이 차이가 이번 구현 대상으로 가장 직접적이다.

## 원본 입력·출력 계약

단일 라벨 prompt는 다음 원문 입력을 사용한다.

| 입력 | 원본 선택 규칙 |
| --- | --- |
| 상품명 | `product.seo.productName || product.productName` |
| 상품 속성 | `attributes`가 있으면 JSON 문자열, 없으면 ‘상품 상세 정보 참조’ |
| 묶음 안내 | `pricing.bundleInfo.hasBundling`이면 제목에 `(bundleText)`를 붙이고 내용량에 이를 반영하라고 별도 안내 |
| 상품 identity | 확장 요청 `productId`에 `registrationId` |

요구 출력은 JSON의 `content`, `material`, `type` 문자열3개다. 각각 내용량·원료명 및 성분명(재질)·상품 유형이며 정보가 없으면 `상세정보참조`를 반환하라고 지정한다. 이 prompt에는 이미지 파일·URL·OCR 입력이 없다. 제조원·수입원·원산지·주의사항·사용 기준·인증·법적 고시는 AI 반환 필드에 포함하지 않는다.

자체 기본 표시사항의 대응 의미키는 `netContents ← content`, `material ← material`, `productType ← type`다. 원본의 `type`을 HTTP/작업 종류나 견적 카테고리 코드로 해석하면 안 된다. 그3개 값의 원본 prompt는 상품 속성 텍스트를 참고한 제안이며 실제 재질·내용량·유형이 검증됐다는 의미가 아니다.

라벨 service의 extension wrapper는 `requestExtensionWithPromise({workType:type, productId, requestArr:[{prompt}]}, {timeout:45000,maxRetries:2})` 형태를 사용한다. 단일 결과 소비 함수는 객체, JSON 문자열, `batchResults[0].result`, 또는 코드 펜스를 제거한 `batchResults[0].processedText`를 읽는다. 파싱 후 root `koreanLabels`에3개 필드를 합친다.

## 저장 경로와 관찰 한계

별도 `handleResult()`에는3필드 합치기, 필요 시 라벨 PNG 생성·업로드, 옵션 상태 완료 처리, `updateProductWithCoupangDocPartial()` 호출이 보인다. 해당 helper는 root 라벨 값·이미지·완료 상태와 견적의 정확한 `제품 한글 표시사항 라벨 또는 도안 이미지` 파일 값을 저장한다.

`processKoreanLabels()`의 별도 일괄 service 경로는 옵션 번호별 `content/material/type` 결과를 요구하고 검증한 뒤 옵션별 PNG와 견적 이미지 값을 저장한다. `validateLabelResponse()`는 비어 있거나 trim하면 공란인 세 필드를 `상세정보참조`로 대체한다. `contentForBundle()`은 이 생성 결과의 내용량에 묶음 수량을 반영한다. 이 함수가 수동 편집한 모든 내용량을 항상 다시 계산한다는 뜻은 아니다. 이번 구현은 이 자동 일괄 저장·완료 처리 전체를 복제하지 않는다.

특히 검사한 store action과 mutation에는 정적 불일치가 있다. action은 확장 응답을 변수로 받지 않고 고정 기본값을 `labels` 이름으로 commit한다. mutation은 `aiLabels`와 `koreanLabelImage`를 읽는다. 따라서 UI 버튼→해당 action만으로 현재 실제 쿠플러스에서3필드·PNG 저장이 성공한다고 단정할 수 없다. 별도 service의 처리 코드는 관찰했지만 동적으로 어느 소비자가 이 버튼의 응답을 완료하는지, 실제 모델 출력·서버 보정·retry 결과는 실행 관찰하지 않았다. 이 불일치를 자체의 정상 동작 계약으로 복제하지 않는다.

## 근거와 digest

부모 Evidence:

- `ev_cd5b12712ef6b71c2acfc13858957b76b067e15d1319aac6ac68b3c3a642258a`.
- `ev_80058b8130c110cfd1ec44a0c48cf2441311a5ce02c3a66e52f40c0fbf65b42f`.

| 보관 artifact | SHA-256 |
| --- | --- |
| `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js` | `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc` |
| `outputs/step652-current-couplus/main.a20c7114.js` | `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad` |

아래 범위는 원문 UTF-16 시작 포함·끝 제외이며 SHA는 원문 slice의 UTF-8 digest다.

| 원본 메서드 | 범위 | slice SHA-256 |
| --- | --- | --- |
| UI `startKoreanLabelProcessing` | `[152483,152773)` | `786fb2c9de273127861dd8a2d4410273f8c0c2a03c17d09bd498775a87ce3be4` |
| `requestKoreanLabelData` | `[273131,273562)` | `f8fef68d539075a007c6e3d4f09c9caea00ad84284d084539fd43e4bfac3ede7` |
| `SET_KOREAN_LABEL_DATA` | `[252599,252789)` | `a4e3978b514bbc55823d622ef7b0f9345d6613c5ce80a32e4b8590fe7de09db6` |
| `promptForKoreanLabels` | `[376366,377587)` | `cf5040d7cc3445e4dcc66e4cd35ef87ef4b1b37dcbd0ff46ce8e659531d04f59` |
| `requestExtension` | `[381133,381474)` | `181d323f90c1f6da45b92ee9760ed0d6b7ee23f89806c459082de044bc9fccee` |
| `handleResult` | `[365824,368991)` | `fe05c286fca7c905fac8739c7a8216635cc9f5e8f7cc7a01bae35c5e0364ba1f` |
| `updateProductWithCoupangDocPartial` | `[362069,363339)` | `414dd1e4d9465418393eea9fae4ef3267eb99ad09a5466959d2a3c2df18bc40a` |
| `generateAllOptionLabels` | `[369969,371225)` | `20a9b1e9e0c284421ac7b3b7a72855aa8c77ffcec66b12ed170268af61064f7b` |
| `applyBatchLabelResults` | `[377588,380631)` | `278dc27c0d53537668ff54540f5ca4bb779dcb9242ef0ee0ca1dae943dd23da6` |

전체 좁은16개 원문 slice, 개별 digest와 자체 기준 버전 비교는 `outputs/step704-analysis-label-ai-static.{mjs,json}`에 있다. 정적 검사9그룹 통과, release 테스트 합계 기여0이다. 첫 probe는 template literal 안의 JSON key 따옴표가 역슬래시로 escape돼 있다고 잘못 가정해 실패했다. 실제 원문 따옴표로 검사하도록 고쳤으며 vendor 실행이나 앱 결함이 아니다.

## 선택한 재구성 경계

담당자는 이미 설정된 무료 Workers AI binding을 사용한 **별도 읽기 전용 라벨 초안 요청**을 구현한다. 기존 저장값으로 PNG를 만드는 동작과 이름·버튼을 분리하고, 반환3필드는 검토·선택 후 기존 표시사항 PUT로 사용자가 저장하도록 구성한다. 실제 저장한 수동값·공란·기본설정·카테고리 자료를 AI 호출 자체로 덮어쓰지 않는다.

이 구현은 원본의3필드 요청 범위와 원문 입력을 복원하지만, 동일 모델 출력·확장 backend·자동 업로드·자동 완료 상태를 재현했다고 주장하지 않는다. 제조원·수입원·원산지·주의사항·사용 기준을 이 요청에서 생성하거나, 법적 고시·가격·회사·Hub 전송을 바꾸지 않는다. source/상품·옵션·프로필 identity와 요청 전후 저장 fingerprint를 결합해 낡은 결과를 다른 편집 대상에 적용하지 않아야 한다.

## 최종 독립 검수

구현 freeze 뒤 `outputs/step704-analysis-independent-review.{mjs,json}`로 자체 순수 함수·로컬 AI binding stub·소스/AST 검사9그룹이 통과했다. 실제 route/API/SQLite·컴포넌트 통합 검수는 다른 담당자 소유이며 여기서 중복 실행하지 않았다. 이9그룹은 새 회귀 테스트9개나 실제 사이트 검증9개가 아니고 release 합계 기여는0이다. 외부 요청·vendor 실행·브라우저·운영 상품 쓰기0이며 검사 전후7개 관련 소스 SHA도 같다. 새로운 actionable 지적은 없다.

| 최종 구현 소스 | SHA-256 |
| --- | --- |
| `app/product-label-draft.ts` | `59456b55082a47d60c687cab2b3d21a07f1e5873c63b8cb1e5acbaab50df75ca` |
| `app/api/products/[id]/product-label-draft/route.ts` | `7325c8e687e5eea8b36e5f07deb033f36c24f504f500558edc1492cb9184bc6c` |
| `app/components/product-label-editor.tsx` | `98fa1e30e5fae64767536f12f507b2cf22262cc8abc1dfe36f66ff1ddf56556f` |
| `app/quotation-ai.ts` | `61f55c4800557fcc775d363bd06913e8067e827b78479c81bcacd0ad9f6295cd` |

요청 본문에는 옵션 id·현재 라벨 revision/fingerprint만 허용한다. 호출자가 AI prompt·provider·다른 출력 필드를 덧붙일 수 없다. 대상은 현재 구조에 남은3개 의미키뿐이며 공통·옵션 직접값/공란, content의 수동값, 삭제한 항목과 사용자 항목은 제안 대상으로 자동 덮어쓰지 않는다. 수집된 중국어 값처럼 수동 확정하지 않은 내용은 한국어 검토 초안으로 제안할 수 있다. 선택 옵션의 원문·번역명·묶음 수량을 전달하되 다른 옵션의 정보는 섞지 않도록 명시한다.

route는 회사 승인·owner·역할을 확인하고 현재 공식 견적 resolver가 결정한 **선택 옵션의 최종 상품명**과 연결된 수집 원문을 사용한다. 자체 prompt는 설명·카테고리도 별도 참고 자료로 포함하므로 원본 prompt 문자열과 완전히 같다는 주장은 하지 않는다. 최종 소스는 명시적 공란 상품명을 `productName:''`로 보존하고 원문 상품명은 `originalTitle`에 따로 둔다. 원본 prompt의 `SEO상품명 || 상품명` fallback을 그대로 적용하지 않는 차이이며, AI 응답이 제품명 필드를 바꾸지는 않는다.

사업 자료에 대해서는 읽기 전용이다. 다만 이미 존재하는 공유 AI 일일40회 제한의 예약을 수행하며 기존 DB helper의 테이블/index 초기 준비도 있을 수 있으므로 **모든 DB 쓰기가0인 endpoint라고 표현하면 안 된다**. 상품·content·옵션·라벨·견적·실행 job·파일을 AI 생성 호출만으로 저장하는 경로는 없다. 무료 Workers AI 설정과 binding이 없으면 거절하며 다른 유료 provider로 fallback하지 않는다. 예약 뒤에는 AI 전후의 회사·원문·옵션·설정·카테고리·저장 fingerprint를 다시 확인한다.

응답은 기존 전체 JSON parser를 재사용해 중복 key·prototype key·설명/코드펜스·추가 key·숫자/null 등 잘못된3필드를 거절한다. 공유 quotation parser 파일은 `strictJson`의 export 추가 외 기존 파일과 byte 수준으로 같음을 확인했다. 빈 문자열 AI 응답은 기존 값을 지우지 않고 해당 제안을 생략한다. 공백 문자열은 일반 텍스트로 남긴다. provider 오류에 대한 자동 재요청이나 기본값 자동 저장은 없다.

실제 UI callback은 현재 scope·source·진행 중 요청·dirty 입력을 확인하고 한 번 POST한 후 결과와 최신 GET을 검증한다. 제안은 local draft와 변경 전/후 검토 영역에만 놓이고 PNG 생성·업로드·Hub 전송을 호출하지 않는다. 사용자가 수정 후 ‘정보 저장하기’를 눌러야 기존 CAS·ACK 검사를 거쳐 저장한다. 별도 ‘저장한 표시사항 PNG 미리보기’ 버튼은 이 검토값이 실제 저장된 뒤에 쓸 수 있다. source 변경·unmount 시 요청 취소와 응답 무시, 기존 입력 유지 보호도 유지한다.

초기 독립 probe는 이전 설명의 blank-title fallback을 기대해 실패했고, 실제 최종 소스의 명시적 공란 보존으로 정정했다. 또 두 컴포넌트에 같은 이름의 `save` 함수가 있어 AST가 마지막 함수를 잘못 고른 것을 기본 `ProductLabelEditor` 범위로 좁혔다. 둘 다 감사 fixture의 가정 문제이며 앱 결함이나 추가 구현 수정은 아니었다. 실제 Workers AI 출력·원본 확장 runtime·동일 모델 결과·Supplier Hub 접수는 이 검수로 증명하지 않는다.
