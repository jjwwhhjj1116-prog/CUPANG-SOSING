# Step702 — 6단계 기본 표시사항의 항목 구조 편집

2026-10-18 KST. 기준 HEAD `f519254`. REA 설치 지침·JavaScript 안내와 기존 보관 분석을 재사용했다. 이 감사의 소유 범위는 본 문서와 `outputs/step702-analysis-*`이다. 앱·테스트는 별도 담당자가 수정한다. 새 producer, vendor 실행, 네트워크, 브라우저, 기존 작업 상품 접근은 모두 0이다.

## 확인된 차이와 수정 범위

쿠플러스의 6단계 기본 한글 표시사항 편집기는 항목명 변경, 순서 변경, 선택 항목 삭제, 새 항목 추가를 지원한다. 항목 구조는 상품 공통의 순서 있는 배열로 저장되고 다시 열 때 복원된다. 필수 항목은 제품명 하나다. 자체 기준 버전의 실제 기본 편집기 `ProductLabelEditor`와 `productLabelPlan()`은 고정9개 필드만 순회하므로 이 구조 변경을 저장하거나 기본 PNG에 반영할 수 없다.

자체의 `ProductContentEditor`에는 이미 별도의20개 표시사항 `labelLayout`과 `customLabels` 편집이 있다. 그것이 없는 기능이라고 보고한 것은 아니다. `dashboard-client.tsx`는 이 기능을 ‘추가 표시사항·이전 자료’ 상세 영역에, 그 조판을 ‘이전 공통 표시사항 PNG·추가 항목 조판’에 배치한다. 우선 표시되는 기본9항목 편집기와 해당 PNG 경로는 이를 읽지 않는다. 기존20개 구조를 자동으로 기본9개에 합치면 기존 자료의 순서와 표시 의미가 바뀌므로 별도의 상품 공통 기본 구조가 적절하다.

이번 구현 대상은 기본 구조의 항목명·순서·선택 항목 삭제·사용자 항목 추가와 값 저장, 기본 PNG의 저장 구조 반영이다. 구조는 모든 옵션 공통이며 값의 기존 공통·옵션 덮어쓰기 의미는 보존한다. 카테고리별 법적 고시, 견적 가격, 원본 이미지, 기존20개 자료를 바꾸는 작업이 아니다.

## 보관 근거

부모 Evidence는 `ev_cd5b12712ef6b71c2acfc13858957b76b067e15d1319aac6ac68b3c3a642258a`, `ev_80058b8130c110cfd1ec44a0c48cf2441311a5ce02c3a66e52f40c0fbf65b42f`를 재사용했다. 아래 위치는 원문 UTF-16 code unit의 시작 포함·끝 제외 범위다. 함수 wrapper 해시가 아닌 원문 slice의 UTF-8 SHA-256이다.

| 보관 소스 | SHA-256 |
| --- | --- |
| `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js` | `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc` |
| `outputs/step652-current-couplus/main.a20c7114.js` | `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad` |

| 원본 UI 메서드 | 범위 | slice SHA-256 |
| --- | --- | --- |
| `initializeData` | `[147365,148105)` | `fa849a886b5849729b7df449899aadafee968d2dd7c591527a1939c3cf8ea42c` |
| `saveLabel` | `[148571,148738)` | `3bcfbef1976d3de5244d9f2231f7d423e59cf508c0f9c7f623cada75aab5e2bf` |
| `removeItem` | `[148826,148980)` | `6b2b608e59c9cc0bfca7ac02dd2beee6948f3f86e5dbee0fe204b622e2136701` |
| `addNewItem` | `[148981,149253)` | `ead93d31991f813f0ee9975aba6e2502f83bffe8708e82c89d81a2ea8cc45acf` |
| `clearAll` | `[150172,150333)` | `888b09c70caf9aff77d8e67ec2fb59e5190f009427208c9cb48d4877157c50c8` |
| `saveManualLabels` | `[150334,152482)` | `44c4e768b548e7c8e215de4eea359c1bea618cd4a1765923ceac9982be92c4ce` |

완전한 좁은 원문·순서·자체 기준 버전 해시는 `outputs/step702-analysis-label-structure-static.json`에 있다. 재현 스크립트는 같은 이름의 `.mjs`이며 vendor 코드를 실행하지 않고 문자열·기준 버전 소스만 읽는다. 정적 단언12개가 통과했다. release 테스트 합계 기여는0이다.

## 원본의 저장·복원 계약

원본 기본 순서는 아래와 같다. `manufacturer`와 `origin`의 UI 항목명은 뒤의 PNG 고정 매핑과 다르므로 내부 별칭을 자체 의미키에 그대로 복제하지 않는다.

| 원본 id | UI 항목명 | 필수 |
| --- | --- | --- |
| `productName` | 제품명 | true |
| `manufacturer` | 수입 및 판매원 | false |
| `origin` | 제조원 | false |
| `madein` | 제조국 | false |
| `content` | 내용량 | false |
| `material` | 원료명 및 성분명(재질) | false |
| `type` | 상품 유형 | false |
| `caution` | 사용 시 주의사항 | false |
| `standard` | 사용 기준 | false |

항목명 저장은 공백을 trim하고 비어 있지 않을 때만 바꾼다. 삭제는 `required`이면 차단하고 그렇지 않으면 확인 후 배열에서 제거한다. 새 항목은 `custom_`와 `Date.now()`를 합친 id, 항목명 ‘새 항목’, 빈 값, `required:false`로 끝에 추가된다. `draggable`의 model은 같은 `labelItems` 배열을 직접 갱신하므로 저장 순서가 편집 순서다.

`saveManualLabels()`는 현재 배열을 순회해 값 객체 `koreanLabels`를 만들고, 같은 배열의 `{id,label,required}`만 map해서 root `koreanLabelStructure`를 만든다. 옵션에는 같은 값 객체·생성 이미지·완료 상태가 복제되며 옵션별 구조를 저장하는 코드는 없다. 문서를 다시 열면 root 구조 배열을 먼저 복원하고 저장 값 객체를 합친 후 각 id에 대응하는 값을 넣는다.

생성 라벨은 모든 옵션 문서의 정확한 `제품 한글 표시사항 라벨 또는 도안 이미지` 파일 값에 반영된다. 이 함수에는 `legalPage` 또는 `notices` 쓰기가 없다. 따라서 Stage6 구조·값 저장을 이유로 Step700의 초기 법적 고시 정책을 해제하거나 자동으로 채우면 원본 근거와 맞지 않는다.

원본 ‘전체 삭제’는 선택 항목을 배열에서 삭제하고 필수 항목만 남겨 빈 값으로 만든다. `resetToDefault()`는9개 기본 배열로 바꾼 후 `initializeData()`를 다시 부르므로 저장 구조가 있으면 그 로직이 재진입한다. 이 정적 특이점만으로 서버 저장 후 전체 초기화 결과를 관측했다고 주장하지 않는다. 이번 구현의 ‘기본9항목 구조 복원’은 명시적인 자체 동작이며, vendor reset의 재진입 문제를 복제한다는 뜻이 아니다.

## 원본 PNG의 항목명 불일치와 명시적 재구성

UI의 `Q`는 보관 module `8efc`이며 `saveManualLabels()`가 `generateLabelImage(t)`에 넘기는 것은 **값 객체만**이다. root 구조·수정한 항목명 배열은 넘기지 않는다.

| main 메서드 | 범위 | slice SHA-256 |
| --- | --- | --- |
| `generateLabelImage` | `[369303,369567)` | `bfa98ff76b25fa2c9c54337ed46c5ff941e5a8692ae9143910901357deb6e7b8` |
| `generateHtmlToImage` | `[171704,172361)` | `a670a09c949ad476d719b27df4eaf755579a06f75a6b755a0f263d566308f4ef` |

이것은 미확인 서버 호출이 아니라 보관 클라이언트 DOM renderer다. `for(const a in labels) if(labels[a])`로 값이 truthy인 행만 만들고 `labelNameMap[a] || a`를 항목명으로 쓴다. `generateLabelImage`의 map에는 `manufacturer:'제조원'`, `importer:'수입 및 판매원'`이 있으며 UI의 `origin` 키는 없다. 사용자 항목의 수정 이름도 이 map에 없다. 이 코드 경로만 보면 UI에서 저장한 수정 항목명은 PNG에 전달되지 않고, 사용자 항목에는 raw id가 쓰일 수 있다는 정적 추론이 성립한다. 실제 현재 쿠플러스 서버·화면의 출력이나 다른 배포 버전에서 보정하는지는 관측하지 않았다.

자체는 저장한 구조의 사람이 읽는 항목명·순서를 기본 PNG에도 반영하도록 재구성한다. 이는 사용자의 구조 편집 의도를 일관되게 보존하는 **명시적 구현 선택**이며, 위 원본 PNG의 별칭·raw custom id 문제까지 동일하다고 주장하지 않는다. 기본9개 의미키와 기존 PNG 크기·검증을 보존하고, 구조 없는 기존 자료는 기존9개 fallback을 유지한다. 새 사용자 id의 충돌 방지·길이 제한·최대 개수·서버 검증도 자체 보호 조건이며 원본이 같은 제한을 갖는다고 주장하지 않는다. 원본의 빈 값 행 생략·500px DOM 모양까지 이번 변경의 동등성으로 확대하지 않는다.

## 독립 최종 검수

구현 담당자의 source freeze 뒤에 실제 primary UI 연결, 상품 공통 구조와 옵션 값 범위, 필수 제품명 보호, 사용자 id/이름/중복·순서 검증, 저장 ACK 확인, 입력 보존·경쟁 저장, plan/proof/cache와 구조 변경의 연결을 읽기·자체 순수 probe로 확인했다. 실제 API·두 회사 격리 통합 검수는 별도 담당자 소유이며 중복 실행하거나 결과 개수를 합산하지 않는다. 전송 gate, 동의·접수 증거 조건과 `SINGLE_DOCUMENT_LIVE_VERIFIED=false`는 그대로 유지한다.

독립 검토에서 한 가지 새 경계 오류를 찾았다. 다른 창에서 구조를 바꾼 뒤 ‘입력 취소·저장 표시사항 다시 조회’를 눌러도 입력 유지용 구조 충돌 검사를 그대로 사용해 최신 구조를 받아들이지 못했다. 수정 전 근거는 `outputs/step702-analysis-refresh-cancel-before.{mjs,json}`에 남겼다. 유효한 before/latest 저장본에서 빈 draft도 거절되는 순수 재현과 실제 UI callback 연결을 확인했다.

담당자는 명시적 입력 취소 조회에만 `acceptStructureChange`를 전달하도록 고쳤다. 값 draft가 하나라도 있거나 구조 draft가 전달된 경우에는 이 flag 사용 자체를 거절한다. 다른 상품·카테고리·선택 옵션·과거 버전 검사와 입력 유지 시의 구조 충돌 검사는 보존된다. 이 보정으로 저장 결과를 확인하지 못한 경우의 입력 유지·ACK 복구와 명시적 취소를 구분한다.

최종 기록은 `outputs/step702-analysis-independent-review.{mjs,json}`이다. **자체 순수 실행·소스 검사12그룹 모두 통과**했으며 검사 전후 아래 소스들의 해시도 같다. 이는 새 자동 테스트12개나 실제 사이트 검증12개를 추가했다는 뜻이 아니며 release 검사 합계에 가산하지 않는다. 원본 코드 실행0, 외부 요청0, 브라우저0, 기존 상품 쓰기0이다.

| 최종 독립 검수 소스 | SHA-256 |
| --- | --- |
| `app/product-label.ts` | `03519cde73ab920e93c4f8da1b8468787d1f56f39de560ea79836ebf81bbb106` |
| `db/product-labels.ts` | `b3c2fc70dd486039adff04de7cd3c9ca8f632478f40572cdf896a1917a5e94c6` |
| `app/api/products/[id]/product-labels/route.ts` | `4315603af1409fd110b342457a0133fe09c4d49d07ad16f8800bf2d2b01e1ae4` |
| `app/document-image-render.ts` | `6f79fded82f063308894e8dd2270c43530f6b743a14154806f9acd0cf77b386a` |
| `app/components/product-label-editor.tsx` | `d5e3ac4dc6156bd9f88d65071365b578d45acbb70a34cf9d023640da003377b8` |
| `app/globals.css` | `858219b224887484bd02770ad94cba82e60e76345db6918429942029d19c00c5` |

고정9개 구조가 없는 기존 자료의 plan은 이전과 같다. 새 구조에서는 저장 순서·이름·사용자 항목이 plan과 upload id·서버 PNG proof에 함께 들어간다. 삭제한 고정·사용자 값은 별도 override 자료로 보관되고 구조를 다시 추가하면 공통·옵션의 직접 공란까지 복원된다. 저장 ACK는 요청하지 않은 archived 값 변경, 기존 자동값 변경, 다른 저장 구조와 사용자 항목의 위조 자동값·출처를 거절한다. 카테고리 법적 고시·content·options·기존20개 추가 편집기의 자료는 쓰지 않는다.

마지막 UI 배치 정리 후 같은12개 검사그룹을 한 번 다시 실행했다. 이전 소스 검수 기록은 `outputs/step702-analysis-independent-review-before-layout.json`에 보존했다. 종전9개 소스 중 기본 편집기 markup 외8개 해시는 그대로다. JSX AST로 한 행의 직접 자식이 이름 label·내용 label·작업 div의3개이며5개 작업 버튼이 같은 div에 들어 있음을 확인했다. CSS는 기본3열,900px 이하2열·작업 다음 행,600px 이하1열을 지정하고 이름·내용의 최소 폭을0으로 둔다. callback·저장 조건을 바꾸는 수정은 없고 추가 지적도 없다. 이 재실행은 별도12개나 새 테스트로 합산하지 않는다. 브라우저로 픽셀 배치를 관측한 것은 아니다.

원본의 동적 실행·서버 보정, 실제 브라우저 글꼴·픽셀 일치, 실제 Supplier Hub의 생성·검증·접수 완료는 여전히 이 감사의 관측 범위 밖이다. 새로운 미해결 actionable 지적은 없다.
