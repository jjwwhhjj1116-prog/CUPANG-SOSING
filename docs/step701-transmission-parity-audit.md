# Step701 — 등록전송 문서의 비노출 기본 null 값

2026-10-18 KST. 기준 HEAD `e6f18e656c15ac2f1104fe5e5db872c6c24e5b7c`. REA 설치 지침과 기존 보관 source/evidence를 재사용했다. 새 producer·vendor 실행·브라우저·외부 네트워크·기존 작업 상품 접근은 없다. 감사 소유 범위는 이 문서와 `outputs/step701-analysis-*`이며 앱·테스트는 담당자가 수정한다.

## 확인된 전송 값 차이

실제 보관 81452 Single schema의 비노출 속성10개 중 **nullable 자유 텍스트3개가 자동 미입력일 때** 자체 Single 문서에는 빈 문자열이 들어간다. 원본 새 문서의 해당 값은 null이다. enum에 null이 있는 나머지7개는 자체에서도 null로 변환되어 이미 같다.

| 정확한 비노출 속성 | 저장한 편집값·출처 | 자체 projection 수정 전 | 원본 새 문서의 값 |
| --- | --- | --- | --- |
| Global Trade Item Number (`brace_gtin`) | `''`, `couplus-default` | `''` | null |
| Parent Manufacturer Part Number (`brace_parentPart`) | `''`, `couplus-default` | `''` | null |
| Manufacturer Part Number (`brace_part`) | `''`, `couplus-default` | `''` | null |

이 세 노드의 정확한 자료형은 `['string','null']`이며 enum은 없다. 자체 `primitive()`는 string을 허용하면 빈 문자열을 그대로 반환한다. 편집 모델에서 null을 빈 텍스트로 표현한 뒤 native 문서로 돌려놓는 경계에서 그 출처를 사용하지 않아 생긴 차이다. 누락된 소싱 값이나 Supplier Hub 거절을 추측한 것이 아니다.

수정 전 재현은 `outputs/step701-analysis-null-wire-gap.{mjs,json}`에 있다. 실제 보관 schema와 자체 resolver→projection만 실행했다. 같은 exact 필드의 옵션 수동 공란, 공통 수동 공란, 실제 문자열 `PART-701`은 현재 정상 보존됨을 별도로 검사했다. 원본·자체 입력 객체는 변하지 않았다. 이 보호 동작을 모두 null로 바꾸면 안 된다.

## 원본 근거와 전송 경로

기존 부모 evidence:

- UI/main 분석: `ev_cd5b12712ef6b71c2acfc13858957b76b067e15d1319aac6ac68b3c3a642258a`.
- 초기 문서 메서드: `ev_d49bd95d5e4610573ee111bbc753a6055e2f0913515c0f96f146f2ff50050a6b`.
- 설치 확장 문서 protocol: `ev_17ed0cebd00b285e0bc489221547e437d2b3f69d9b636a813eb942a0a2a3a49a`.

| 보관 항목 | 위치·SHA-256 |
| --- | --- |
| UI artifact | `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`; `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc` |
| `createCompleteArrayStructure` | UTF-16 `[457562,458219)`; `f65819b5c5808e9d5188db14f40163bfb344c6b73d05a7020c8420188d24d9c0` |
| 견적 편집기 `initializeData` | `[232815,233811)`; `37b9503dd011192547861ec353d838004cf125606416b1d169d9a1eb5d66f9d1` |
| `normalizeUnexposedAttributes` | `[233962,234409)`; `e992b2527ec43fa1b1369d06e3c1c8e4ec55ec23d49d7bc9170c7391c23bbb47` |
| `normalizeUnexposedAttributesInPendingChanges` | `[234410,235014)`; `5ebfcf159f34b671f65f2d28ee4e17f5ceb300e1b4ea708c95e651623e6cf3a4` |
| 실제 81452 보관 profile | `outputs/step650-official-81452-profile-after.json`; `1652a076a3af43c5416c01df646513bacc4e74275aab17d05bf3d29ba6bfa814` |
| 자체 projection 수정 전 | `app/supplier-hub-single-projection.ts`; `df546f5dfa7671bff603ed248de5ee5229e19b00bf808bd9936b97e8ae83e881` |

원본 `createCompleteArrayStructure`는 이름 배열을 만들 때 값에 `"unexposedAttributes"===e?null:"해당사항없음"`을 사용한다. 이는 자유 텍스트와 enum을 구분하지 않는다. 견적 편집기에서 저장한 문서를 읽을 때도 `normalizeUnexposedAttributes()`를 호출하며 비노출 값의 `해당사항없음`을 null로 정리한다. 원본 함수는 정적으로 읽었으며 실행하지 않았다.

최종 전송은 평탄한 `convertDocToQuotationData`를 필수 호출하는 방식으로 단정하지 않는다. Step694에서 확인했듯 그 함수의 literal 호출자는 보관 chunk에서 찾지 못했다. 실제 보관 `processNextVerification`는 전체 `coupangDoc`를 `VERIFY_ROCKET_REG_DOC`의 `body`로 보낸다. 설치 확장 receiver는 body 전체를 create helper에 전달하고, 새 docId를 넣은 같은 body를 update helper에 전달한다.

보관 `document-helper-X`는 `JSON.stringify(body)`를 create 요청에 쓰고 `document-helper-Q`는 이미 JSON으로 직렬화된 문자열을 update 본문에 쓴다. 초기 문서의 null을 빈 문자열로 바꾸는 변환은 이 선택 경로에 없다. exact provenance는 `outputs/step652-current-extension-provenance.json`과 `step652-current-extension-handoff-audit.json`에 보관되어 있다. 확장 background 원본 SHA는 `fb03e8a70bc684e8b08539d8eb507720170eca8cf6fa4cb74af549f13179ec99`이며 helper-X slice `[19245,19961)`는 `61f2c9fb751a407bb82a38a66f8f3dd34bd4128adbfd74f65762022d1f6dbe7d`, helper-Q `[19961,20720)`는 `aff91808e2e40c27f2e5e60ff2a67b594bb0a211c94f0d5d9f80eb619bf0f966`다. wrapper SHA와 원본 slice SHA는 구분했다.

## 권장 수정 경계

Single projection에서 **정확한 `productPage.unexposedAttributes` named wire**, 자동 기본값 출처 `couplus-default`, 저장값 `''`, 원문이 실제로 null을 허용하는 경우만 null로 복원한다. 이번 보정은 실제 세 필드와 같은 enum/dropdown 없는 nullable text에만 한정한다. enum 선택은 기존의 exact primitive 변환과 모호성 차단을 유지하며, 원문에서 허용하지 않는 null을 추측해서 추가하지 않는다.

공통/옵션 수동 공란, 실제 비노출 텍스트, 다른 nullable scalar, productPage의 모델번호, 법적 고시, 이미지, 소싱 값은 변경하지 않는다. 편집 화면의 저장 텍스트나 기존 원문·콘텐츠·옵션 DB도 다시 쓰지 않는다. 문서 준비는 저장값의 native 표현을 복원하는 것이며 사용자 검토나 접수 완료를 대신하지 않는다.

## 다른 전송 항목과 미확인

이번 좁은 조사에서 새로운 회사·제목·공지동의 전달 누락을 추가로 확인하지 못했다. 기존 코드는 회사 code/name과 새 소유 문서 identity를 묶고 선택 옵션의 startPage 제목을 root 제목에 맞춘다. 원본과 다른 단일 옵션 준비 범위, 동의 challenge와 실제 사용자 확인, 더 강한 접수·SKU 증거 요구는 기존에 명시한 범위다. 원본처럼 로컬 toast만으로 등록 완료로 표시하거나 동의를 자동 선택하도록 바꾸는 권고는 하지 않는다.

선택한 사이즈표·여러 대표이미지·다른 카테고리·private asset 공개·등록 완료 판정은 이 변경으로 재구현하지 않는다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`와 제출 gate도 유지해야 한다. 실제 native create/update/validate/submit 응답, 현재 쿠플러스의 서버 정규화, Supplier Hub의 null/빈 문자열 수용 차이·SKU 생성은 미확인이다. 원본과 다른 typed wire는 확인했지만 null 변경만으로 실제 등록 성공을 증명하지 않는다.

## 수정 후 독립 검수

구현 담당자는 `app/supplier-hub-single-projection.ts`의 scalar 경계만 수정했다. 정확한 product/hidden text·textarea, named `productPage.unexposedAttributes`, 자동 빈 기본값, 길이2의 string/null union, enum/dropdown 부재를 모두 요구한다. 다른 경우는 기존 `primitive()`를 사용한다. 문자열 편집값·DB·수동 공란·동의·접수 상태는 변경하지 않는다.

최종 projection SHA-256은 `b5bd7190ec741d621ab982b642f18a21d73a7236f3f3f3c5ffc7a864c2509c80`다. 독립 기록은 `outputs/step701-analysis-independent-review.{mjs,json}`이며 **8개 순수 단언 모두 통과**, 검사 전후 관련3개 앱 파일 SHA도 같다. API/package/client 통합 검수는 별도 담당자 소유이며 여기서 반복 실행하지 않았다. 이8개는 release 검사 합계에 가산하지 않는다.

실제 보관 81452의 비노출 자동값10개가 null이 되는 것을 확인했다. 이는 새 자유 텍스트3개와 기존 enum7개다. 각 자유 텍스트의 공통·옵션 수동 공란과 실제 문자열, 출처가 content/settings/schema/empty인 값은 보존된다. nullable scalar 모델명·법적 고시로 변환 범위가 퍼지지 않는다. null/string union 순서, nonnullable string, enum의 문자 공란·null 선택, 모호 enum 및 중복/3개 자료형의 기존 차단도 확인했다. 미해결 actionable 지적은 없다.

첫 검토 probe는 모호한 enum이 compiler에서 먼저 제외되어 있는데 그 필드에 fixture 값을 넣으려다 실패했다. 앱 결함이 아니라 검토 fixture의 가정 오류였으며, 기존 `SINGLE_UNSUPPORTED` 차단을 직접 단언하도록 고친 뒤 최종8개가 통과했다. 외부 요청·브라우저·vendor 실행·운영 데이터 쓰기는0이며 최종 Supplier Hub 수락 증거는 아니다.
