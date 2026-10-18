# Step703 — 한글 표시사항의 빈 행 생성·전체 삭제

2026-10-18 KST. 기준 HEAD `17ec5d6`. Step702의 REA 보관 소스·Evidence와 설치 지침을 재사용한다. 소유 범위는 이 감사와 `outputs/step703-analysis-*`뿐이며 앱·테스트는 담당자가 수정한다. 외부 요청·vendor 실행·브라우저·실제 작업 상품 쓰기는0이다.

## 확인한 원본 동작

원본 PNG renderer는 `for(const id in labels) if(labels[id])`로 행을 고른다. UI 값은 일반 text input 문자열이며 trim modifier가 없다. 따라서 문자열 `''`는 생략하지만 `' '`, `'\t'`, `'\n'`, 전각 공백과 `'0'`는 남긴다. 값의 공백을 trim해서 빈 행으로 간주하는 규칙이 아니다.

`clearAll()`은 확인 메시지 후 선택 항목을 배열에서 삭제하고 필수 항목만 남긴다. 남은 필수 항목의 값은 `''`로 바꾸고 변경 표시를 켠다. 기본 구조에서 필수 항목은 `productName` 하나다. 단순히9개 행의 값을 비우거나 기본9개로 복원하는 동작과 다르다.

검사한 `saveManualLabels()`에는 제품명 값의 비공란·trim 검사가 없다. `required`는 구조 metadata로 저장될 뿐이며 항목 삭제 보호에 쓰인다. ‘정보 저장하기’ 버튼도 `isProcessing`만으로 disabled된다. 필수 구조 행이 존재한다는 사실을 제품명을 비워 저장할 수 없다는 규칙으로 해석하면 안 된다.

저장은 현재 배열의 모든 값을 root `koreanLabels`에 넣고 같은 값 객체를 모든 옵션에 복제한다. 자체의 기존 값 모델은 옵션별 직접값·공란을 따로 보존하므로, 전체 삭제를 상품 공통 구조 변경과 현재 편집 범위의 필수값 비우기로 구성한다면 다른 옵션의 직접값을 유지하는 명시적 재구성이다. 원본이 옵션별 값을 그대로 보존한다고 주장하지 않는다.

## 좁은 근거

기존 부모 Evidence:

- `ev_cd5b12712ef6b71c2acfc13858957b76b067e15d1319aac6ac68b3c3a642258a`.
- `ev_80058b8130c110cfd1ec44a0c48cf2441311a5ce02c3a66e52f40c0fbf65b42f`.

| 보관 항목 | 원문 범위·SHA-256 |
| --- | --- |
| UI artifact `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js` | `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc` |
| main artifact `outputs/step652-current-couplus/main.a20c7114.js` | `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad` |
| `generateHtmlToImage` | UTF-16 `[171704,172361)`; `a670a09c949ad476d719b27df4eaf755579a06f75a6b755a0f263d566308f4ef` |
| `clearAll` | `[150172,150333)`; `888b09c70caf9aff77d8e67ec2fb59e5190f009427208c9cb48d4877157c50c8` |
| `saveManualLabels` | `[150334,152482)`; `44c4e768b548e7c8e215de4eea359c1bea618cd4a1765923ceac9982be92c4ce` |
| text input·저장 버튼 | `[143000,144459)`; `f73fb5e86fd97577b4c414eeb9771df00a27868bb562ee0d8440ad781652e819` |

`outputs/step703-analysis-label-generation-static.{mjs,json}`에 전체 좁은 원문과 해시, 기준 버전 자체 소스 해시, 문자열9종의 JavaScript truthiness가 있다. vendor 함수는 실행하지 않았다. 정적·primitive 규칙 검사6그룹이 통과했고 release 테스트 합계에 가산하지 않는다. 첫 감사 probe는 저장 metadata의 `required:t.required`까지 값 검증으로 잘못 세어 실패했다. 이 저장 표현을 분리해 검사하도록 고쳤으며 앱 결함은 아니었다.

## 자체 차이와 구현 경계

기준 버전 `productLabelPlan()`은 구조의 모든 행을 출력하고 `.some(value => value.trim())`으로 생성 가능 여부를 검사한다. 이 둘은 원본의 문자열 truthiness와 다르다. 새 생성 plan은 **정확한 빈 문자열인 행만** 제외하고 공백 문자열은 그대로 보존해야 한다. 생성할 행이 모두 없으면 자체는 명시적인 오류를 유지할 수 있다. 원본의 빈 DOM 캔버스 생성까지 따라한다는 동등성 주장은 하지 않는다.

이미 작업 중인 제품의 기존 생성 라벨을 강제로 다시 만들게 하면 안 된다. 종전 full-row PNG proof는 **현재 저장된 구조·항목명·순서·값 그대로 만든 unfiltered plan의 정확한 hash가 기존 서버 proof와 일치할 때만** 호환 수용하는 것이 좁은 경계다. 새 filtered plan hash가 같아도 정상이며, 둘 다 다르면 stale 상태를 유지해야 한다.

이 호환 처리는 임의의 예전 plan, 다른 상품·회사·프로필·카테고리·옵션, 수정 전 값, raw 파일명만으로 증명하는 이미지를 허용하는 fallback이 아니다. 기존 owner/product/profile/category 및 서버 업로드 증거 검사는 유지한다. 새로운 생성·업로드 ID·metadata는 새 filtered plan을 사용하므로 새 요청에서 종전 빈 행을 다시 만들거나 과거 upload ID를 새 생성값인 것처럼 승인하지 않는다. 기존 unmarked/manual 이미지를 새 generated proof로 분류하지 않는 원칙도 유지한다.

## 독립 최종 검수

담당자 source freeze 뒤에 정확한 빈 문자열·공백 차이, 전체 삭제의 구조/현재 범위 값 저장, 원치 않는 다른 옵션·archived 값 변경 차단, 새 plan/upload/proof 연결과 exact-current full-row 호환을 독립 순수 실행·소스 읽기로 확인했다. 실제 API·두 회사·canvas 통합 검사는 별도 담당자 소유이며 이 감사에서 반복하거나 개수를 합산하지 않는다. 실제 Supplier Hub 접수 및 원본 서버·브라우저 실행은 미확인이고 live gate는 그대로 false다.

최종 `outputs/step703-analysis-independent-review.{mjs,json}`의 **검사9그룹이 모두 통과**했다. 이는 새 회귀 테스트9개나 실제 사이트 검증9개가 아니며 release 합계 기여는0이다. 원본 실행·네트워크·브라우저·실상품 쓰기0, 앱·테스트 편집0이며 검사 전후8개 관련 소스 SHA도 같다. 새로운 actionable 지적은 없다.

| 최종 변경 소스 | SHA-256 |
| --- | --- |
| `app/product-label.ts` | `2578c29862215c66b1fbbcfb737eac8d017b1e31d38e13e12bb4259d0c8f8a36` |
| `app/product-label-proof.ts` | `8428f8db837ecf1d2aa7dfa01bcfb71a30a4a508cc0983b189e043e40bc7449f` |
| `app/components/product-label-editor.tsx` | `fb0df0e87c9ff99e6472914dadbb12c25d272000874ed71e419b3df59fcffab1` |

새 생성 plan의 빈 행 제거는 저장값을 삭제하지 않는다. `''`만 빠지고 공백 문자열은 남으며, 모든 값이 정확한 공란이면 저장본은 유효하되 PNG 생성은 차단된다. 전체 삭제는 필수 행의 이름·id를 보존하고 현재 옵션의 제품명만 명시적 공란으로 저장할 수 있다. 다른 옵션의 직접 제품명과 삭제된 행의 archived 공통/사용자 값은 보존된다. 실제 UI handler가 조회·저장 요청 없이 local draft만 만들고 현재 scope/자료·요청 진행 상태를 검사하는 것도 AST·소스로 확인했다.

새 업로드·metadata는 filtered plan만 인정하고 과거 full-row 업로드 ID를 새 생성 증거로 허용하지 않는다. 기존 서버 proof의 과거 full-row 이미지는 현재 unfiltered plan의 정확한 SHA가 같을 때만 계속 유효하다. 출력되는 값·항목명 변경이나 과거 이미지에 있던 빈 행의 항목명·순서·삭제, 카테고리 변경은 그 과거 full-row 증거를 stale로 만든다. 잘못된 다른 상품·프로필·업로드 key·서버 marker의 기존 차단도 보존된다.

다만 **새 PNG에 실제 출력되지 않은 정확한 빈 행**의 이름·순서·삭제는 filtered plan을 바꾸지 않을 수 있다. 이 경우 새 PNG의 upload signature와 proof가 그대로 유효한 것이 맞다. 같은 변경도 종전 full-row PNG에는 빈 행 항목명이 출력되어 있었으므로 해당 과거 proof는 stale가 된다. 이3가지 분기와 서명 불변을 추가 순수 단언으로 확인했다. 추가 전 기록은 `outputs/step703-analysis-independent-review-before-empty-heading-cases.json`에 보존했고, 같은9그룹의 재실행을 별도 검사로 합산하지 않는다.

호환 분기는 기존의 수신 옵션 plan 비교를 사용한다. 기존 코드가 같은 내용의 공통 이미지를 옵션에서 사용할 수 있는지에 대해 새로운 metadata option-id 강제 일치 규칙을 덧붙이지 않았다. 비교하는 현재 plan과 기존 서버 범위를 유지했다는 뜻이며, 실제 픽셀·옵션 실물의 일치를 증명한다는 의미는 아니다.
