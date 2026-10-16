# Step690 — 편집 간격과 상하단 설정 배너 변경의 기능 대조

2026-10-16. 설치된 REA/upstream 지침과 기존 JavaScript 안내를 적용하고 Step683–689의 retained Evidence·정확한 동일 source slice만 재사용했다. 새 producer·REA 분석·브라우저·Couplus MCP·공유 계정/탭·1688·provider·외부 API를 호출하지 않았다. 기존 운영 상품·앱·테스트·DB는 변경하지 않았다. vendor **관찰**은 shipped client의 정적 동작이며 실제 설정 변경 클릭·서버 저장·converter 실행을 관찰한 결과가 아니다.

## 빠른 판정

1. `imageMargin`은 로컬 숫자0에서 시작하고 HTML 간격 적용 메서드가 있다. 그러나 확인한 상세 editor render에는 이 필드나 메서드의 control binding이 없다. **실제 사용자 간격 UI·min/max/step은 확인하지 못했다.** 자체의 0~200 정수 control은 명시적인 bounded 추가 기능이다.
2. 배너는 initial-only 자료가 아니다. 현재 store의 `settings[0].defaultSettings`를 읽는 computed getter가 다시 `processedGroups`를 계산한다. 정상 reactive store 변경 때 현재 카드 목록이 재평가된다는 해석은 타당하다. 다만 두 분기가 다르고 old group/root/HTML을 일관되게 갱신하는 handler는 없다. **자동으로 정합적인 영속 reconciliation이 된다고 볼 수 없다.**
3. 자체의 최소 후속은 editor-only 간격 control과 **이전 문서를 그대로 보존한 명시적 현재 배너 대조·검토·보관**이다. 공통/전체 옵션 견적이나 최종 PNG를 자동 갱신하지 않는다. 최종 이미지는 Step689의 폭800·흰 배경·여백/간격0을 유지한다.

## 근거와 범위

- chunk `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`: 553,312 bytes, SHA256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`. 이번 로컬 읽기에서도 동일 SHA를 확인했다.
- 기존 save/group Evidence `ev_782e7a89a96a33a05f38b2d977a5ee4001676f0891cc87373d600c7252192396`; parent `ev_9ba78b705b9c68a727604eaf0bebe7f726bbbe8fea6c6d38d50ac77d2b88e1ba`, summary `ev_c9d9ee950f92f5a97fb95a891ec7d8399335a204dc7f1ac4e0705f3cb3dec293`. 후자의 parse 실패0/semantic unknown1,572를 실행 보증으로 확대하지 않는다.
- 기존 iframe parent `ev_6373190d88287217f0a505c6e86baff55ba4c1447b792b744463771033bf7809`, summary `ev_c9c4ef6a6c24aba3f82a41d2f2c85fec2b199086d3d4eb432d17bd4a702a5170`는 editor 외부 세션의 경계이며 간격 control/배너 서버 정책을 증명하지 않는다.
- 기존 인용 자료는 `outputs/step683-detail-editor-audit-inventory.json`, `outputs/step685-detail-composition-audit.json`이다. 후자 SHA256은 `9c91c92a7a52fcdcee47c1545a17292f3d80e6afe579fd276d2c127e600ccb75`다. 추가로 동일 chunk의 해당 component 경계·computed header·reset 문자열을 좁게 읽었으며 새 Evidence를 만들지 않았다.

offset은 chunk UTF-16/끝 제외다.

| 근거 | 범위 | 조각 SHA256 |
| --- | --- | --- |
| 상세 render 기존 경계 | `[85900,95620)` | `ec87d61cd8cca89bd0147458dea115ac3d0b561ff3d121ea2afeac74201eff61` |
| DetailImageEdit object 전체 경계 | `[96046,139612)` | `a32ac3060f3f63a5cce55768e1d5e42a6db22e462f2df58e14ef70cd57025ac6` |
| data | `[96154,96573)` | `bba63d7b7eddfb048928c3588a16f4c808888701ff3e4ef68191172137a7dddc` |
| computed store header | `[96574,96848)` | `95a9245eecd57045053bacbb4d8fa94d47aff1f4ed80e549e132c220bf761366` |
| processedGroups | `[97368,99354)` | `9d3cabdad8e9190415db560f063d0bcad1afd56f5dc072735611434c2482e900` |
| created | `[99562,100016)` | `6dc5ac588ea96c77db4510c329f00869b1f335e93dda0e42b1d2a29e5172d648` |
| initializeDetailHtml | `[104047,105462)` | `802ba71944eca352f121750fe5bdc81a845abab25a8b6f3cbcee3069c2345e15` |
| applyImageMargin | `[109142,109677)` | `e7d6faa25b3e4fb5db1f6ad0ba1a04ec6c8867fa66b6e8b0f3bb9d35b3fad99a` |
| generateDetailHtmlFromProcessed | `[127674,128968)` | `ec174e97f07a711634eb1f44fe0fbcc3c411d9918c51adae12efa4265c91a59f` |
| initializeAllContent | `[128969,129432)` | `bcd663e1d38fa85d633b5b7c1734dc2cc13cd79ab935024a7c3103cb13c2857c` |
| saveDetailPage | `[131264,136334)` | `757d3e6097a2084225181b9e0cbf205687e1cb93061ea886e7b66b3f53dc28f2` |

## 관찰: 간격 default·handler·sizing

| 항목 | 정확한 관찰 |
| --- | --- |
| default | data의 `imageMargin:0`. created는 숫자를 root/defaultSettings에서 복원하지 않는다. |
| 정상 입력 | `parseInt(this.imageMargin)`를 사용한다. radix·상한 검사 없음. 소수는 정수로 절삭해 현재 HTML에 적용하지만 정상 branch에서 scalar 자체를 정수로 다시 쓰지는 않는다. |
| 음수/NaN | scalar를0으로 바꾸고 즉시 return. 기존 HTML의 margin을0으로 다시 쓰지 않는다. |
| 적용 대상 | `DOMParser`로 현재 `detailHtml`을 파싱하고 `div[style*="margin-bottom"]` 각 style의 첫 `/margin-bottom:[^;]+;/`를 정수px로 치환. `s.body.innerHTML`을 로컬 detailHtml에 대입하고 toast. |
| 적용하지 않는 것 | 처리 그룹/map·상품 저장·최종 PNG·견적 HTML/ALT를 변경하는 호출 없음. |
| editor 생성 HTML | 흰 wrapper `width:100%;max-width:800px;margin:0 auto;padding:20px`, img `width:760px;max-width:100%;height:auto;display:block;margin:0 auto`. 사진 div마다 `margin-bottom:${imageMargin}px;text-align:center`이며 마지막과 배너에도 붙음. |
| 재열기 | truthy root detailHtml을 그대로 읽지만 scalar는0으로 시작한다. 저장 문자열 간격과 숫자가 다를 수 있다. |

이 숫자는 top/bottom 설정 객체에서 읽는 field가 아니다. render `[85900,95620)`에서 imageMargin/applyImageMargin/‘간격’/‘여백’의 직접 참조는0개다. 따라서 현재 화면 control의 크기·label·input type·min/max/step은 unknown이다. 이 component object에서 `applyImageMargin`은 선언 한 번만 확인했다. 외부 동적 caller까지 존재하지 않는다고 주장하지 않는다.

최종 saveDetailPage는 별도 HTML을 만든다. wrapper/사진 container/img 폭800, padding0, margin0, 흰 배경이며 imageMargin을 참조하지 않는다. root generated HTML의 간격이 커져도 최종 저장 이미지에 그대로 들어간다고 해석하면 틀린다. 실제 converter MIME/높이 반올림/픽셀은 기존 [Step689 감사](step689-workspace-composite-parity-audit.md)의 unknown을 유지한다.

## 관찰: 현재 설정 배너가 목록에 들어오는 두 분기

computed header는 현재 store에서 다음 값을 읽는다.

```js
defaultSettings: state => state.settings && state.settings[0]
  && state.settings[0].defaultSettings ? state.settings[0].defaultSettings : {}
```

getter는 `defaultSettings.imageSettings || {}`에서 truthy `useTopImage && topImageUrl`, `useBottomImage && bottomImageUrl`을 선택한다. 설정이 없으면 배너를 만들지 않는다. 실제 persisted 설정의 기본 checkbox 값이나 global 설정 저장 handler 전체를 확인한 것은 아니다. URL은 각 하나의 scalar 값이며 배열을 순회하지 않는다.

| 현재 상품 branch | getter의 동작 | 설정 변경 시 주의 |
| --- | --- | --- |
| `product.processedDetailImages.length>0` | 현재 top이 있으면 index-1 setting 그룹을 앞에, map 그룹 중 현재 top/bottom URL과 같은 것은 제외해 본문에, 현재 bottom index-3 setting 그룹을 뒤에 추가 | 새 설정 URL이 root detailImages에 없어도 새 top/bottom을 주입한다. map을 바꾸거나 저장된 product 처리 배열을 다시 쓰지는 않는다. |
| 처리 배열이 없거나 빈 배열 | root detailImages를 순회. 현재 top/bottom URL과 같은 항목만 해당 root index의 setting으로 한 번 분류. 그 외 map 값 또는 original fallback | 새 URL B가 root 배열에 없으면 B를 새로 주입하지 않는다. 옛 배너 A는 더 이상 현재 설정과 같지 않으면 일반 body/original로 남을 수 있다. disable도 옛 A를 자동 삭제하는 뜻이 아니다. |

initializeDetailHtml은 또 다른 경로다. 현재 top→root detailImages **전체**→현재 bottom으로 생성하므로 root 배열에 옛 배너가 있으면 새 배너와 옛 항목이 함께 남거나 중복될 수 있다. processed 생성기와 완전히 같은 정책이 아니다.

## 관찰과 추론: 언제 갱신되는가

- **관찰:** processedGroups는 computed 값으로 현재 defaultSettings를 읽는다. created는 root HTML load/initialize와 저장 group map 복원을 한 번 수행한다. mounted는500ms 뒤 첫 그룹 선택과 keydown 등록이고 설정 reconcile handler가 아니다.
- **추론:** Vue의 정상적인 reactive store 변경이면 defaultSettings/processedGroups 의존 값이 바뀌어 카드 목록 getter가 재평가될 것이다. 실제 store mutation의 reactive 작동이나 열린 UI 설정 변경을 실행 관찰하지는 않았다.
- **관찰:** component object `[96046,139612)`의 `watch:` 선언은0개다. 설정 변경으로 root detailHtml을 자동 재생성하거나 updateRocketProduct를 호출하는 watcher는 이 경계에서 확인되지 않았다.
- **결과:** 카드의 현재 배너·저장된 root HTML·기존 최종 견적 이미지가 동시에 일치한다고 보장할 수 없다. 이후 사진 액션이 HTML 재생성을 호출하거나 최종 save가 현재 getter로 별도 이미지를 만들 수 있지만 그 시점과 설정 저장은 같은 transaction이 아니다.

`initializeAllContent`는 ‘모든 편집 내용’ 초기화 확인 뒤 `this.processedGroups=[]`·editor reset·initializeDetailHtml을 수행하는 문자열이다. computed-only 값에 대입하는 코드이며 `processedGroupsMap`이나 저장 group 배열을 지우는 명확한 동작은 없다. 이것을 특정 배너만 안전하게 새 설정으로 바꾸는 기능의 근거로 사용하지 않는다. 일반 helper `isTopOrBottomImage` `[129433,129799)`의 현재 URL/파일명 topimage·bottomimage 추정도 자체의 권한/역할 판정으로 복제하지 않는다.

## 자체의 안전한 최소 구현 권고

아래는 vendor의 숨은 서버 policy가 아니라 현재 앱 데이터에 맞춘 자체 정책이다.

1. **editor-only 간격 control:** 기존 workspace schema의0~200 정수 범위를 명시한다. 잘못된 숫자·소수·상한 밖 값은 설명하고 보관을 막으며 조용히 trim/절삭하지 않는다. document.imageMargin과 deterministic generatedHtml을 함께 로컬 변경하고 명시 보관으로만 저장한다. 최종800PNG는 간격0임을 control 바로 옆에 표시한다. generic quote HTML을 DOMParser로 고치거나 실행하지 않는다.
2. **기본 조회는 기존 엄격 정책 유지:** 현재 역할과 과거 보호 배너가 다르면 일반 workspace GET/save는 계속409로 원문을 보존한다. 불일치를 이유로 과거 문서를 새 배너로 조용히 덮지 않는다.
3. **별도 명시 대조 읽기:** 승인 회원/회사·상품/옵션·정확한 context/profile 아래 이전 record/files를 확인하되, 대조 준비용 read만 옛 layout과 현재 roles의 일치를 요구하지 않는다. 옛 문서의 digest/정규성·실제 origin/current/base/sidecar 권한은 그대로 검사한다. 파일을 읽었다는 사실이 새 row 쓰기나 견적 저장이 아니다.
4. **결정적인 preview:** 옛 top/bottom 보호 행만 제거/교체하고 body의 ID/origin/current/순서는 보존한다. 동일한 배너는 ID를 유지하고 새 배너는 새 ID와 origin=current로 만든다. 현재 top/body/bottom 순서·역할을 검증하고 바뀌는 행과 원래 문서를 함께 보여준다. 중복 파일의 body 위치를 filename/URL 추정으로 삭제하지 않는다. 새 배너 key가 live body current와 충돌하면 명시적인 conflict로 알리는 것이 최소 안전 정책이다.
5. **검토 후 독립 workspace 보관:** exact old row payload/revision/digest와 현재 raw source/member/context/role proof를 SQL CAS에 묶는다. 이전 전체 snapshot·실제 파일 증거를 보존하고 현재 body/edited result는 유지한다. quote/product/content/options/labels/pool 또는 기존 최종 PNG를 이 버튼으로 바꾸지 않는다. 설정 원천 자체를 저장하는 별도 액션과도 구분한다.
6. **실패·경쟁·ACK:** source·설정·옵션·workspace/화면 세대·dirty 상태가 바뀌면 오래된 preview 승인으로 보관하지 않는다. 불명확한 ACK는 읽기 확인만 먼저 수행한다. 자동 reconcile POST·견적 재저장·과거 파일 삭제를 하지 않는다.

자체 현재 상하단 source는 상품 content의 명시 역할과 pool 소유 증거이므로 vendor 전역 `defaultSettings.imageSettings`와 같은 저장 schema라고 부르지 않는다. 새 기능은 ‘현재 저장한 상하단 역할과 이전 작업 구성 대조’라는 의미로 설명하는 것이 정확하다. 과거의 immutable archive와 live workspace 교체, 설정 변경, 전체옵션 최종 상세 저장을 각각 구분한다.

## 남은 미확인과 후속

현재 vendor 간격 UI의 실제 존재·범위/크기·전역 설정 control의 실제 저장·열린 editor에서의 reactive runtime, 서버/파일 transaction은 미확인이다. 이 문서는 method가 있다는 사실과 화면에서 사용자에게 제공되는 기능을 구분한다. 해당 unknown을 자체 요구의 무제한 입력이나 자동 보관으로 보충하지 않는다.

root의 새 interface가 준비되면 pure plan·old/current 역할 충돌·본문/편집기록 보존·전체 원천/old row CAS·archive·일반409 유지·preview ABA·명시 ACK 복구를 source-only로 독립 검토한다. 현재 새 구현·테스트·native·배포를 완료했다고 판정하지 않는다. 이 조사에서 연 소유 runtime/브라우저 자원은 없다.
