# Step710 — 기본 한글표시사항 행 드래그와 재작성 범위

2026-10-18 KST. REA 설치 지침과 Step709의 정확한 라벨 선택 Evidence를 재사용했다. 소유 범위는 본 문서와 `outputs/step710-label-analysis*`뿐이다. 새 REA producer·원본 코드 실행·브라우저·네트워크·기존 상품 접근·앱/테스트 수정은 모두0이다. 현재 연결의 ledger가 비어 있었으므로 Step709 portable bundle을 import한 후 기존 부모의 render item만 조회했다. 같은 구문을 다시 분석하지 않았다.

## 확인된 기능 차이

원본 Stage6 기본 라벨 편집기는 각 행의 손잡이를 잡아 순서를 바꾸는 `draggable` 목록이다. 자체 기준 HEAD `9269d061b4b42661da53205b3d2bc19c37b90883`의 `ProductLabelEditor`는 위·아래 버튼만 제공한다. 저장할 수 있는 순서 모델은 이미 있으므로 이번의 좁은 차이는 **기존 항목 목록을 핸들 드래그로 재정렬하는 조작 방식**이다. 구조 저장·사용자 항목·PNG 이름/순서 기능이 없는 것으로 되돌려 보고하지 않는다.

기준 editor SHA-256은 `98fa1e30e5fae64767536f12f507b2cf22262cc8abc1dfe36f66ff1ddf56556f`이며 `moveField(id, offset)`은 인접 두 항목을 바꾼다. `draggable`, `onDragStart`, `onDragEnd`는 이 기준 소스에 없다. 기준 `app/product-label.ts` SHA는 `2578c29862215c66b1fbbcfb737eac8d017b1e31d38e13e12bb4259d0c8f8a36`이다. 기준은 Git 저장본으로 고정했으며 동시 작업자의 수정 중 파일을 결과 근거로 덮어쓰지 않는다.

## 드래그·필수 행·저장 계약

원본 `draggable`의 attrs는 `handle:'.drag-handle'`이다. model은 `labelItems`이며 callback이 같은 배열을 새 순서로 바꾼다. 시작/종료 이벤트는 `drag=true/false`만 설정한다. 이 두 이벤트나 model callback에는 서버 저장·PNG 생성·업로드가 없다. 목록 행의 key는 위치가 아닌 `s.id`다.

손잡이는 모든 `labelItems` 행에 같은 markup으로 표시한다. `draggable` attrs에는 `required`별 filter·disabled·고정 첫 행 조건이 없다. 기본 구조의 제품명만 `required:true`이고, `removeItem`은 필수 항목의 삭제만 거절한다. 따라서 **제품명도 재정렬할 수 있도록 구성되어 있다**는 정적 추론이 성립한다. 제품명이 항상 첫 행이어야 한다는 규칙을 추가하면 원본 근거와 맞지 않는다. 실제 drag 라이브러리 실행, touch/keyboard 지원·gesture threshold·animation·ghost 스타일은 이번에 관측하지 않았다.

새 항목은 `custom_ + Date.now()` id, 이름 `새 항목`, 빈 값, `required:false`로 현재 배열 끝에 추가된다. 선택 항목 삭제는 확인 후 같은 배열에서 splice한다. 필수 행의 이동·내용 수정과 필수 행의 삭제 보호는 서로 다른 조건이다. 자체의 충돌 없는 id·최대39개·이름 검증은 기존 재구성 정책으로 유지하면 된다.

사용자가 `saveManualLabels`를 누르면 현재 `labelItems` 순서로 값을 객체에 삽입하고, 같은 배열을 `{id,label,required}`로 map해 root `koreanLabelStructure`에 넣는다. 이 구조는 옵션별 배열이 아니다. 다시 열 때 `initializeData`가 저장된 배열을 먼저 map하므로 순서가 복원된다. 원본은 저장 과정에서 이미지·상태·같은 값 객체를 모든 옵션에 복제하지만, 자체는 이미 문서화한 공통 구조/옵션 직접값 보존 계약을 사용한다. 드래그 추가가 그 값 범위를 바꾸어야 한다는 근거는 없다.

자체의 좁은 구현은 손잡이에서 시작한 같은 현재 목록의 재정렬을 기존 `changeStructure`와 동일한 local structure draft로 만드는 것이다. 값·항목명은 안정된 field id에 결합하고, 저장 전에는 서버·PNG·견적을 바꾸지 않는다. 기존 위·아래 버튼을 접근 가능한 대체 조작으로 함께 둘 수 있다. 회사/상품/옵션/source 변경, 잠금, 처리 중·취소·오래된 드래그와 다른 목록에서 넘어온 항목의 거절은 자체가 이미 사용하는 편집 보호 조건을 따른다. 이런 보호를 원본 vendor가 동일하게 구현했다고 주장하지 않는다.

## PNG 순서와 항목명의 경계

`saveManualLabels`가 `generateLabelImage`에 넘기는 것은 저장 순서대로 만든 **값 객체**다. 기존 main 원문 `generateLabelImage`는 `[369303,369567)`, SHA `bfa98ff76b25fa2c9c54337ed46c5ff941e5a8692ae9143910901357deb6e7b8`; `generateHtmlToImage`는 `[171704,172361)`, SHA `a670a09c949ad476d719b27df4eaf755579a06f75a6b755a0f263d566308f4ef`다. main 전체 SHA는 `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`다.

원본 DOM renderer는 `for...in`으로 truthy 값만 출력하고 고정 `labelNameMap[id] || id`를 쓴다. 기본 id와 `custom_` id는 integer index가 아니므로 이 값 객체의 일반 문자열 key 순서는 삽입 순서를 따른다는 언어 규칙 해석이 가능하다. 실제 PNG 픽셀·서버 보정·다른 배포를 관측한 것은 아니다. 수정한 사람용 항목명 metadata는 PNG로 전달되지 않는 원본 불일치도 Step702와 같다. 자체는 이미 저장 구조의 사람용 이름·순서를 PNG에 반영하므로 핸들 조작은 그 기존 경로를 이용한다. 원본의 raw custom id·별칭 문제를 복제하지 않는다.

이 main PNG 두 함수는 Step709 label-selected REA 부모에 포함되지 않는다. 원문 SHA/range와 기존 exact raw slice를 독립 근거로 재검증했으며, 라벨 UI 부모가 이 main renderer까지 분석했다고 확대하지 않는다.

## 별도 결과 — 완료 화면의 ‘재작성’

완료 이미지 화면의 ‘재작성’ 버튼은 `resetLabels`에 연결된다. 이것은 local preview만 닫는 기능이 아니다. 확인 메시지 뒤 아래 payload를 만들어 `updateProductPartial`에 보낸다.

```text
root koreanLabelImage = null
root koreanLabelStatus = null
각 options[i].koreanLabelImage = null
각 options[i].koreanLabelStatus = null
updatedAt = Date.now()
```

그 후 forceUpdate와 `initializeData()`를 요청하고 재작성 가능 안내를 표시한다. `resetLabels` payload에는 `koreanLabels` 값·`koreanLabelStructure`·견적의 `labelImageFiles`가 없다. 따라서 저장 이미지/상태에 대한 **서버 변경 요청**이 있다는 점은 확정이고, 저장된 표시사항 내용·구조 또는 견적 파일을 모두 지운다는 주장은 근거가 없다. 실제 API 성공·트랜잭션·서버에서 추가하는 변경·새 화면 결과는 미확인이다.

이 버튼은 `clearAll`(필수 행만 남기고 local 내용을 비움), `resetToDefault`(기본 배열로 바꾼 뒤 initializeData 재진입), 자체의 `clearPreview`·명시적 입력 취소와 구별해야 한다. Step710의 핸들 드래그를 위해 이 영속 초기화 요청까지 새로 구현하거나 기존 상품에 실행할 필요는 없다. 재작성은 별도 범위로 남긴다.

## 정확한 근거

원문 UI는 `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`, SHA-256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`다. 범위는 UTF-16 시작 포함·끝 제외이고 SHA는 원문 slice의 UTF-8 digest다.

| 구문 | 범위 | slice SHA-256 |
| --- | --- | --- |
| draggable handle attrs | `[141575,141604)` | `d0c03e2d5f8357edf29bf4d2e21927569f67ded2cea1e81d5137bd46ab378859` |
| start/end 이벤트 | `[141605,141665)` | `6d45b650405e06e1e57b6d77249681331930e00397e7d696c7f8ca221af31b9f` |
| labelItems model | `[141666,141753)` | `ce8c46943d1f7ea48620e16db242a6a8742eba751cfea14dd5d924efec8089ce` |
| 행 손잡이 | `[141933,142031)` | `cdd11706e10057b5ed76a0e45f1c9ccfe13da39116853c464fd3e50680ec9a21` |
| 구조 복원 initializeData | `[147365,148105)` | `fa849a886b5849729b7df449899aadafee968d2dd7c591527a1939c3cf8ea42c` |
| 필수 항목 삭제 보호 | `[148826,148980)` | `6b2b608e59c9cc0bfca7ac02dd2beee6948f3f86e5dbee0fe204b622e2136701` |
| 새 항목 추가 | `[148981,149253)` | `ead93d31991f813f0ee9975aba6e2502f83bffe8708e82c89d81a2ea8cc45acf` |
| 순서 저장 saveManualLabels | `[150334,152482)` | `44c4e768b548e7c8e215de4eea359c1bea618cd4a1765923ceac9982be92c4ce` |
| 완료 화면 재작성 resetLabels | `[153053,154081)` | `d55d35abb4ce0944233daeb6c13386800d255438a9a65e8d58aa80a8d4ddcef6` |

기존 정확한 부모 Evidence는 `ev_e75a73c89a0fb3139ccd6768d2e5ee09872a42df9617e5bd8772a2528dc53e20`, summary는 `ev_300c1402706f80b6917d09557144a1614ad56761093a189a0ae388f09711b723`, component item은 `ev_b28873cbf7dc751135cfbf8c85477b8ca50ca65b9535b0330ab649f8f8e85e73`다. 이번에는 그 부모의 `label-render.js` 정확한 node `jag_node_2ba1875f32dc75a2ffdd3bf9652e1fa09ec7d461253a7612d9c73ca0102f02c3`를 선택했고 새 projection Evidence는 `ev_5ee1e516e33a25fee98e69e4dbd2316ccce3dd2d75abf2fdb619647599f162b2`다.

추출 스크립트·전체 좁은 raw slice와 digest·Git 기준 source identity는 `outputs/step710-label-analysis-extract.mjs`와 `-manifest.json`에, 새 render item은 `-render-view.json`에 있다. 부모 portable bundle은 기존 Step709 파일을 그대로 재사용한다. 새 producer는0이고 새 회귀/release 테스트 개수 기여도0이다. 초기 추출 도구의 Babel traverse 해석 위치를 기존 프로젝트 dependency로 바로잡았으며 원본 함수나 앱 코드는 실행하지 않았다. native/browser/runtime 실행 세션을 열지 않아 종료할 소유 실행 자원은 없다.
