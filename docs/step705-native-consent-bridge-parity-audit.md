# Step705 — 공식 카테고리 문서에서 빠진 native 동의 제어값

2026-10-18 KST. 기준 HEAD `e5612771d1be01273ac09064c4d46207a9d44749`. REA 지침과 기존 보관 UI·확장 Evidence를 재사용했다. 이 감사는 원본 정적 소스와 자체 격리 합성 재현만 사용했다. 브라우저·vendor 실행·외부 요청·기존 작업 상품 접근은0이다. 본 문서와 `outputs/step705-analysis-*`만 소유하고 앱·테스트는 담당자가 수정한다.

## 확정된 실제 연결 누락

공식 보관81452 카테고리 schema의 `imagePage.properties`에는 `images`, `details`만 있다. 쿠플러스 초기화는 이 schema를 추출한 **뒤에** `imagePage.msrpAgree`, `imagePage.labelContactAgreed`를 별도로 추가한다. 이 두 값은 원문 카테고리의 일반 입력 필드에만 의존하지 않는 native 단계 제어값이다.

자체 기준 버전 projection은 원문 properties만 순회하므로 해당 카테고리에서 두 값이 빠졌다. 옵션 packet은 이 문서를 그대로 사용한다. 그러나 기존 receiver는 상품정보·이미지 동의 단계에 도달하면 원래 packet의 `imagePage`에 정확한 단계 제어 key가 존재해야 한다고 검사한다. 결과적으로 자기 projection으로 만든 문서를 자기 동의 단계가 `AGREEMENT_REVIEW`로 거절하는 내부 연결 누락이 있다.

이는 현재 외부 사이트나 로그인 실패를 추측한 것이 아니다. 실제 보관 schema와 기준 버전 자체 projection·변경 없는 receiver로 격리 재현했다. `outputs/step705-analysis-consent-gap-before.{mjs,json}`에 raw image key와 projected key가 모두 `[images,details]`이고 단계 검증2~5 뒤 `navigation-requested`에서 동의 문서 연결 오류가 나는 것을 보존했다.

해당 예시는 다른 필수 입력94개도 미완료이므로 실제 전송 준비가 끝났다고 주장하지 않는다. 누락된 제어값 조건만 분리하려고 합성 adapter의 준비 상태·문서 생성·검증·페이지 도달을 명시적으로 제공했다. native Hub에 POST하거나 실제 동의·상품 등록을 한 것이 아니다. 코드 수정이 probe 작성 중 먼저 반영되어, 기준 commit의 자체 projection만 메모리 VM에 읽어 before 재현을 완성했다. 현재 앱을 이전 코드로 되돌리지 않았다.

## 원본·보관 근거

부모 Evidence:

- `ev_cd5b12712ef6b71c2acfc13858957b76b067e15d1319aac6ac68b3c3a642258a`.
- `ev_80058b8130c110cfd1ec44a0c48cf2441311a5ce02c3a66e52f40c0fbf65b42f`.
- 설치 확장 전송 경로는 기존 `ev_17ed0cebd00b285e0bc489221547e437d2b3f69d9b636a813eb942a0a2a3a49a`와 Step652 handoff ledger를 재사용한다.

| 소스 | 정확한 위치·SHA-256 |
| --- | --- |
| UI artifact | `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`; `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc` |
| `initializeCoupangDoc` | 원문 UTF-16 `[444537,448566)`; `0b7c3e36d3c1048f75303995f3f4c8a5caa89ee1c5f9455a8d9201f0fff16eae` |
| 공식81452 보관 profile | `outputs/step650-official-81452-profile-after.json`; `1652a076a3af43c5416c01df646513bacc4e74275aab17d05bf3d29ba6bfa814` |
| 수정 전 자체 projection | commit `e5612771d1be01273ac09064c4d46207a9d44749`, `app/supplier-hub-single-projection.ts`; `b5bd7190ec741d621ab982b642f18a21d73a7236f3f3f3c5ffc7a864c2509c80` |
| 기존 receiver | `extensions/supplier-hub/single-document.mjs`; `22ac26cfacaaedb2072cb8486929ad66eafa1541681c6a06df96065cbd98ec69` |

원본 initializer는 여러 옵션·단일 상품 양쪽 분기에서 schema를 문서에 추출한 후 아래와 같이 처리한다.

1. imagePage가 있으면 없거나 false인 `msrpAgree`를 true로 만든다.
2. imagePage가 없으면 images/details와 두 동의 제어값 true를 갖는 객체를 만든다.
3. imagePage의 `labelContactAgreed`가 없거나 false이면 true로 만든다.

즉 원본은 일반 카테고리 schema에 없는 두 키도 보완한다. 자체가 이 키를 복원해야 한다는 근거이며 **사용자 대신 true로 동의하라는 근거로 적용하지 않는다.** 원본 자동 true·DOM 자동 선택과 자체의 제출 시 명시적 동의 정책은 분리한다.

## 정확한 수정 경계

공식 문서 초기화 policy가 확인된 `couplus-required-v1`이고 원문에 imagePage object와 images/details object가 있는 native 형태에서만, schema가 생략한 정확한 두 제어값을 전송 준비 문서에 **false**로 추가한다. schema에 원래 선언된 boolean의 기존 저장 표현은 유지하고 실제 전달 packet의 기존 동의 지연 절차를 사용한다. 같은 이름의 잘못된 자료형을 덮어써 정상화하거나 임의의 schema 필드를 만드는 방식은 피한다.

카테고리 schemaString·digest, 저장된 content/견적·기본값, 회사·category/notice/version 식별값, 이미지 참조와 다른 값은 변하지 않아야 한다. 추가된 값은 검토 이슈로 표시하고 현재 약관 전문·현재 docId·단계·기한·사용자의 실제 확인이 일치한 뒤에만 기존 절차가 true로 변경한다. live gate와 제출·접수 판정은 그대로 유지한다.

## 이번 대조에서 이미 맞는 연결과 남은 조건

상품 추가 원본은 선택한 category의 `createResult`와 `rocketRegInfo.schemaString`을 초기 문서에 묶는다. display category code와 내부 kan category id, 고시 번호·version·scope는 서로 다른 식별값이다. 실제 보관81452 예시의 display code는81452, 내부 categoryId는5562, notice25, version188이다. 자체는 저장한 공식 schema metadata와 categoryPath를 검증해 이를 구분하고 옵션별 exact wire에 값을 채운다.

원본 전송은 평탄한 `convertDocToQuotationData`가 아니라 전체 coupangDoc다. 확장은 새 docId를 얻어 같은 본문을 update하고 검증 단계2~5를 지나 등록 화면으로 이동한다. 자체 packet은 선택 옵션의 startPage 제목을 root 제목에 맞추고 새 문서·회사·schema·source digest를 묶는다. 이 부분에서 새 필드 누락을 추가로 확인하지 않았다. 원본의 optional `remark` 전달만으로 실제 필수값이나 자체 결함을 추정하지 않았다.

원본이 ‘상품 등록 완료’ 문구·로컬 verified 상태로 성공 표시를 바꾼다고 자체도 접수를 건너뛰어서는 안 된다. 기존 자체는 제출·접수·최종 SKU 등록을 분리하고 exact docId·qvtRequestId·company·현재 source 증거를 요구한다. 이번 두 false 필드 보완은 그 실제 수용·등록 증거가 아니다. 모든 카테고리의 현재 native schema·서버 검증·동의 전 false 수용·최종 receipt와 SKU 관계는 별도의 실증이 필요하다. 이 감사에서는 그런 관측을 수행하지 않았다.

## 독립 최종 검수

담당자 freeze의 projection SHA `164220929accba8f0f9258efec120c39aada33a12e10dacc055683bb8900a168`에서 독립 자체 순수 검수7개 그룹이 통과했다. 실제81452 schema의 누락2키 false, raw/schema/digest 보존, 두 회사 synthetic의 선언된 bool/지연 packet, marker 없는 legacy 미주입, 같은 이름의 잘못된 자료형 거절, receiver own-property 단계 연결을 확인했다. 추가 actionable finding은0이다. `outputs/step705-analysis-independent-review.{mjs,json}`에 exact source SHA와 각 그룹을 기록했다. release 검사 수 기여는0이다.

동시 진행된 새 owned-target 기능 때문에 receiver/client 전체 SHA는 바뀌었다. 이 리뷰는 전체 receiver가 같다고 가정하지 않고 **`validateSingleDocumentPacket`, `pauseNavigation` 두 함수만** before와 정확히 같은 source임을 비교했다. 새 탭 생성·소유권·상태전이 통합은 다른 담당의 검수 범위다. baseline before probe도 자신의 이전 receiver/projection을 commit `e5612771…`에서 메모리로만 읽어 현재 변경과 분리했고 `AGREEMENT_REVIEW`를 다시 재현했다. 이는 이번 turn 시작 root 기준 `daebe047…`와 구분되는 의도적인 이전 자체 소스다.

실제 원격 동의/접수는 검증하지 않았다. vendor 함수 실행0, 앱·테스트 변경0이며 다른 담당자의 API·상태전이 검사 개수와 합산하지 않는다. 사용자 최신 지시에 따라 이후 분석은 별도 `step705-url-source-collection-parity-audit.md`의 원문 수집 경로에 집중했다.
