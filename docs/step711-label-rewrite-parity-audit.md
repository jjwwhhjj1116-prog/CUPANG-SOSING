# Step711 — 한글표시사항 완료 화면과 재작성 경계

2026-10-18 KST. 2026-10-14에 보관한 Couplus 원문과 Step709·710의 정확한 라벨 Evidence만 재사용했다. 원본과 자체 앱의 실행·브라우저·네트워크·운영 상품 접근은 모두0이다. 새 REA producer·projection도0이며, producer를 재실행하지 않고 기존 inert 선택본과 원문 range를 대조했다. 소유 변경은 본 문서와 `outputs/step711-label-rewrite-analysis-*`뿐이다.

## 확인된 표시 조건과 우선순위

`KoreanLabelEdit` render는 다음 순서로 **한 분기만** 만든다.

1. `isProcessing`이 truthy이면 spinner와 진행 문구.
2. 그렇지 않고 `currentKoreanLabelImage`가 truthy이면 완료 카드.
3. 둘 다 아니면 항목 편집 폼.

완료 여부를 `koreanLabelStatus === 'completed'`로 비교하지 않는다. getter의 정확한 식은 다음과 같다. 아래 이름은 원문 minified 지역변수를 사람이 읽기 쉽게 바꾼 설명이며 별도 실행 코드가 아니다.

```text
rootStatus 또는 selectedOptionStatus 중 하나가 truthy이면:
    선택 옵션이 있고 그 옵션 image가 truthy이면 그 image
    아니면 root image 또는 null
두 status 모두 falsy이면 null
```

따라서 선택 옵션 image가 있어도 두 status가 비어 있으면 편집 화면이고, root status만 truthy여도 선택 옵션 image가 우선한다. 선택 옵션 status만 truthy이고 옵션 image가 없으면 root image를 사용할 수 있다. 이는 저장 구문의 조건에서 도출한 정적 의미다. `pending`·`error` 등의 값이 실제 서버에서 이 필드에 저장되는지, 그런 상태로 이미지가 함께 존재하는지는 미관측이다. 임의의 truthy 문자열도 이 식을 통과한다는 사실을 실제 상태 목록으로 확대하면 안 된다.

여기에는 견적 `labelImageFiles` 조회나 첫 이미지 선택, 생성 이력 순회, 별도의 `editMode` state가 없다. root/선택 옵션의 단일 `koreanLabelImage`만 고른다. 항목 값의 선택은 별도 watcher가 선택 옵션 `koreanLabels`를 먼저 읽고 없으면 root 값을 읽는다. `initializeData`는 root 구조·기본값·root 저장값으로 다시 채운다. 이미지 선택 규칙과 값 초기화 규칙은 같다고 가정할 수 없다.

## 버튼과 독립 삭제의 범위

| 화면 | 해당 컴포넌트의 버튼 | 의미 |
| --- | --- | --- |
| 완료 카드 | `이미지 다운로드`, `재작성` | 현재 getter 이미지 다운로드, `resetLabels` 호출 |
| 편집 폼 | `기본값 복원`, `전체 삭제`, 행별 X, `새 항목 추가`, `정보 저장하기`, `한글 표시사항 생성 시작` | 항목 구성·값 편집 및 저장/생성 |
| 진행 중 | 위 카드와 폼 없음 | spinner와 진행 문구 |

`정보 저장하기`는 완료 카드에서 숨겨진다. 단순히 disabled인 동일 버튼을 계속 보여주는 구조가 아니다. 이 저장 메서드는 현재 값과 구조를 모으고 이미지 생성·업로드 후 root와 모든 옵션의 이미지/상태를 `completed`로 갱신하는 payload를 요청한다. 이 때문에 성공 후 완료 분기로 갈 수 있다는 정적 추론은 가능하지만, 이번에 API나 UI 전이를 실행해 확인하지 않았다. `한글 표시사항 생성 시작`은 데이터 요청 메서드에 연결되며 그 메서드 자체가 `saveManualLabels`를 호출하지는 않는다.

**완료 카드에 생성 이미지만 독립 삭제하는 버튼은 없다.** 전체 render의 완료 분기에는 정확히 위2개의 `b-button`만 있다. 편집 폼의 `전체 삭제`는 필수 항목만 남기고 local 항목 값을 비우며, 행별 X는 `removeItem`으로 항목 배열을 수정한다. 둘을 완료 이미지 삭제로 해석할 근거가 없다. 이 부재는 완전한 `KoreanLabelEdit` object/render 범위에 한정한다. 다른 화면 전체에 이미지 삭제 기능이 없다고 주장하지 않는다.

보관된 Stage6 UI snapshot의 마지막 wizard에도 완료 이미지·다운로드·재작성과 바깥 단계 이동 `이전`·`다음`만 보인다. 이는 보관 시점에 그 화면이 표시되었다는 독립 기록이고, 재작성 실행이나 getter 입력값까지 관측한 기록은 아니다.

## 재작성은 무엇을 바꾸는가

Step710에서 확정한 `resetLabels` 계약을 그대로 유지한다. 확인창 후 `updateProductPartial`에 root와 **모든 옵션**의 `koreanLabelImage=null`, `koreanLabelStatus=null`, `updatedAt`을 보낸다. 성공 경로에서는 처리 상태를 끄고 forceUpdate와 `initializeData()`를 요청한다. 값 `koreanLabels`·구조 `koreanLabelStructure`·견적 `labelImageFiles`는 이 payload에 없다. 저장소의 실제 반영·서버 추가 mutation·실패 원자성은 미확인이다.

원문 그대로 상태가 반영되었다면 getter의 두 status가 falsy가 되므로 편집 분기로 돌아간다는 것은 정적 추론이다. 파일 삭제 API는 호출하지 않는다. 견적 이미지 참조가 별도로 남을 수 있다는 점과 완료 카드가 사라지는 것은 함께 성립한다. 그러므로 `재작성`을 `견적에서 제외`나 물리 파일 삭제와 동일하게 구현할 근거는 없다.

## 자체 기준과 가장 좁은 남은 차이

기준은 작업 트리가 아닌 Git HEAD `0d9f9491ccaa4f3e091cb5cf0d558151359067f0`이다. 이 버전의 `ProductLabelEditor` SHA-256은 `b48f4bd80ed495b3bb1bc5bb3ad1b0094d28b552d9c8b66c1b87063b191e689f`다. 편집 폼은 계속 제공되고, local `reviewed` PNG와 `ProductLabelReferenceEditor`의 저장 최종 결과가 별도로 표시된다. 후자의 결과는 freshness·소유 파일 검증을 거쳐 사용자 선택 또는 첫 저장 참조로 고른다. `clearPreview()`는 local preview만 null로 만든다. 기준 파일에 `재작성` 버튼은 없다.

따라서 이미 구현된 저장 결과·다운로드·최종 라벨 선택을 누락 기능으로 다시 보고하지 않는다. 원본과 확인된 좁은 조작 차이는 **완료 결과와 편집 폼의 상호배타적 제시 및 명시적인 재작성 진입 경로**다. 원본의 root/전체 옵션 초기화 payload를 자체에 추가해야만 그 진입 경로를 만들 수 있다는 결론은 성립하지 않는다. 자체의 기존 공통값/옵션 직접값·파일 보존·명시적 견적 연결 계약을 유지하면서 편집 진입을 구성할 수 있다. 그 경우 local 전환은 재구성 설계이며, 원본의 영속 초기화와 완전히 같다고 표기하지 않아야 한다.

새 영속 `rewrite` flag, 생성 이력 삭제, 견적 참조 자동 비우기, 모든 옵션 일괄 초기화가 필요하다는 근거는 이번 구문에 없다. 특히 실제 작업 중인 기존 상품을 초기화해 원본 전이를 시험할 필요가 없다. 앱·테스트 수정과 그 재구성 정책 결정은 본 read-only 분석 범위 밖이다.

## 정확한 근거와 한계

원문: `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`, SHA-256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`. 범위는 UTF-16 시작 포함·끝 제외이며 slice SHA는 원문 UTF-8 digest다.

| 구문 | 원문 범위 | slice SHA-256 |
| --- | --- | --- |
| 진행 우선 test | `[139835,139849)` | `9ff9f39b826debaa846d41e6d6e334d8cb232bf3e8faa8ea4e321af515152f1b` |
| 완료 image test | `[139998,140023)` | `115ece5e3ea92a37ae118b70b3e52cc7176f83af530f99a88af1234dc8d59432` |
| 전체 완료 분기 | `[140024,140856)` | `2bb058f4724b11c2ca71c2b68e4010abbbaf368f79744908960419821ea2c14b` |
| 전체 편집 분기 | `[140857,144441)` | `dbb38e2291f46c3a30b4115fd6a018fdfe92f2d9c9737557187e10973fb19a6c` |
| 이미지 선택 getter | `[145870,146252)` | `d6e05f6d48c092c93ba68be4f6044263630b4abfdfe55042bf98ddc7d7611dfb` |
| 정보 저장하기 버튼 | `[144091,144260)` | `d5bf623e7e928c684649f019b57757448f73b634b38b2bc8c2f4576267760e59` |
| 재작성 메서드 | `[153053,154081)` | `d55d35abb4ce0944233daeb6c13386800d255438a9a65e8d58aa80a8d4ddcef6` |

REA 부모 Evidence: `ev_e75a73c89a0fb3139ccd6768d2e5ee09872a42df9617e5bd8772a2528dc53e20`.

component item: `ev_b28873cbf7dc751135cfbf8c85477b8ca50ca65b9535b0330ab649f8f8e85e73`.

재사용 render projection: `ev_5ee1e516e33a25fee98e69e4dbd2316ccce3dd2d75abf2fdb619647599f162b2`, node `jag_node_2ba1875f32dc75a2ffdd3bf9652e1fa09ec7d461253a7612d9c73ca0102f02c3`. render inert 선택본 SHA는 `1ada26dc0bcdc2d6c18da9f01d0e39f02b4f2d51b6a1fac476031bf636978701`, component 선택본 SHA는 `f782852d2b4c904a7edf100283e8d8afba19d0dee5fe7f611f11153d2ef877e5`다.

재사용 projection의 authority는 `shipped-artifact`, confidence는 `derived`, coverage는 선택 view 내1개 item 확인이다. 부모에는 semantic graph unknown683개와 graph coverage `unknown`이 남아 있다. 이 조사는 graph 전체를 완전하다고 가정하지 않고 digest로 고정한 원문 object/render의 직접 식과 handler를 확인했다. 일반적인 dynamic property·runtime reachability 한계는 원 Evidence와 manifest에 보존했다.

추출 스크립트와 모든 버튼·메서드 raw slice·digest·보관 UI snapshot의 정확한 줄·자체 기준 identity는 `outputs/step711-label-rewrite-analysis-extract.mjs`와 `-manifest.json`에 있다. snapshot은 `outputs/step652-current-stage6.txt`의721–737행이며 SHA-256은 `151837a6db3e5adc56eab9f7b488a2adb60b05bc6facee3d7492d5f564de57b1`이다. 스크립트 검증은 원문 identity/range와 완료 분기의 버튼 수·handler를 확인하는 정적 보조 검사이며 앱 회귀/release 테스트 개수에 기여하지 않는다. 새 분석/실행 세션을 열지 않아 종료할 소유 자원은 없다. 미해결은 서버 반영 결과와 실제 재작성 후 화면·다른 화면의 독립 이미지 삭제 기능이며, 본 질문의 render/버튼/요청 payload에는 추가 실행이 필요하지 않다.
