# Step689 — 작업 문서에서 최종 통합 상세로 저장하는 기능 대조

2026-10-16. REA/upstream JavaScript 지침에 따라 Step683–688의 보관 Evidence와 정확한 source-bound slice를 재사용했다. 동일 producer 분석을 반복하지 않았고 브라우저·Couplus MCP·공유 계정/탭·1688·provider·외부 API를 사용하지 않았다. 기존 운영 상품·앱·테스트·DB는 변경하지 않았다. 아래 vendor **관찰**은 shipped client의 정적 동작이며 실제 서버 저장이나 변환 이미지의 픽셀/MIME를 새로 관찰한 결과가 아니다.

## 기능 판정

확인되는 기능은 **현재 작업 사진의 결과 URL을 정해진 순서로 합쳐 하나의 최종 이미지를 만들고, 공통 및 모든 옵션의 상세 이미지를 그 결과로 바꾸며 견적 HTML은 비우는 것**이다. 작업용 root HTML·개별 처리 그룹은 별도로 보관한다. 편집 화면의 20px padding/760px 사진/imageMargin을 그대로 rasterize해 최종 견적으로 쓰는 구조가 아니다.

Step688의 자체 workspace를 이 흐름에 연결할 때는 저장된 사진의 **현재 key**와 고정 ID·순서·보호 역할을 사용해야 한다. originKey로 되돌리거나 이미 저장한 현재 결과 위에 text/crop/brush를 다시 렌더하지 않는다. 미리보기는 읽기만 하고, 공통·전체 옵션 저장은 사용자가 검토한 최종 PNG와 정확한 workspace revision/digest를 결합한 별도 명시 action으로 한다. 임시 견적 PUT이나 모든 개별 사진의 사전 pool 첨부를 성공 조건으로 만들어서는 독립 작업 문서에서 마지막 저장으로 넘어가는 기능 차이가 남는다.

## 재사용 근거

- chunk `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`: SHA256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`, 553,312 bytes.
- main `outputs/step652-current-couplus/main.a20c7114.js`: SHA256 `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`, 579,613 bytes.
- save/group Evidence `ev_782e7a89a96a33a05f38b2d977a5ee4001676f0891cc87373d600c7252192396`; parent `ev_9ba78b705b9c68a727604eaf0bebe7f726bbbe8fea6c6d38d50ac77d2b88e1ba`, summary `ev_c9d9ee950f92f5a97fb95a891ec7d8399335a204dc7f1ac4e0705f3cb3dec293`. 후자는 parse 실패 0이지만 semantic unknown 1,572개로 실제 서버 실행을 증명하지 않는다.
- exact slice 모음 `outputs/step685-detail-composition-audit.json`: SHA256 `9c91c92a7a52fcdcee47c1545a17292f3d80e6afe579fd276d2c127e600ccb75`. 이번에는 여기의 기존 save/HTML slice만 다시 읽었다.
- 편집 세션 parent `ev_6373190d88287217f0a505c6e86baff55ba4c1447b792b744463771033bf7809`, summary `ev_c9c4ef6a6c24aba3f82a41d2f2c85fec2b199086d3d4eb432d17bd4a702a5170`는 외부 iframe 경계의 근거다. 최종 converter 내부나 provider의 편집 레이어 영속성을 이 Evidence로 보충하지 않는다.

offset은 chunk UTF-16/끝 제외다.

| 근거 | 범위 | 조각 SHA256 |
| --- | --- | --- |
| processedGroups | `[97368,99354)` | `9d3cabdad8e9190415db560f063d0bcad1afd56f5dc072735611434c2482e900` |
| created | `[99562,100016)` | `6dc5ac588ea96c77db4510c329f00869b1f335e93dda0e42b1d2a29e5172d648` |
| initializeDetailHtml | `[104047,105462)` | `802ba71944eca352f121750fe5bdc81a845abab25a8b6f3cbcee3069c2345e15` |
| applyImageMargin | `[109142,109677)` | `e7d6faa25b3e4fb5db1f6ad0ba1a04ec6c8867fa66b6e8b0f3bb9d35b3fad99a` |
| generateDetailHtmlFromProcessed | `[127674,128968)` | `ec174e97f07a711634eb1f44fe0fbcc3c411d9918c51adae12efa4265c91a59f` |
| saveDetailPage | `[131264,136334)` | `757d3e6097a2084225181b9e0cbf205687e1cb93061ea886e7b66b3f53dc28f2` |

## 관찰: 편집 HTML과 최종 출력 레이아웃

| 항목 | root 편집용 생성 HTML | saveDetailPage의 최종 이미지용 HTML |
| --- | --- | --- |
| wrapper | `width:100%; max-width:800px; margin:0 auto; background-color:#ffffff; padding:20px;` | `width:800px; margin:0; padding:0; background-color:#ffffff; box-sizing:border-box;` |
| 사진 container | `margin-bottom:${imageMargin}px; text-align:center;` | `margin:0; padding:0; text-align:center; width:800px;` |
| img | `max-width:100%; height:auto; width:760px; display:block; margin:0 auto;` | `width:800px; display:block; margin:0 auto; padding:0;`, 본문에는 `width="800"` 속성도 있음 |
| 사진 간격 | 각 div에 imageMargin. 마지막·배너에도 붙음 | imageMargin 참조 없음. 사진 사이 별도 margin/padding 없음 |
| 사진 원천 | 현재 그룹 url | 현재 그룹 url. root HTML 문자열 자체를 converter에 넣지 않음 |
| 결과 저장 | 현재 root detailHtml 문자열 | `convertHtmlToImage(finalHtml, registrationId)` 반환 문자열을 견적에 사용 |

위 표는 정확한 CSS 선언이다. root 편집 wrapper의 실제 computed 외곽 폭은 전역 CSS/renderer 환경까지 읽지 않은 상태에서 확정하지 않는다. 최종 converter의 높이 반올림·색상 profile·압축·실제 MIME와 픽셀 단위 일치는 미확인이다. 이 메서드의 반환값은 URL 문자열이며 PNG 파일임을 확인한 증거가 아니다. 자체 Canvas의 폭800/흰 배경/정수 높이/실제 PNG 검증은 자체의 명확한 구현 정책으로 구분한다.

`applyImageMargin`은 정상 정수를 현재 root HTML div style에 치환한다. root save의 최종 HTML 생성은 이 숫자를 읽지 않는다. 현재 보관 render 범위에는 해당 간격 control 연결이 확인되지 않았으므로 사용자 spacing UI를 완료했다고 추정하지 않는다.

## 관찰: 순서와 배너 URL의 shape

최종 저장의 정확한 핵심 식은 다음과 같다.

```js
const top = processedGroups.find(group => group.isTopImage);
const bottom = processedGroups.find(group => group.isBottomImage);
const body = processedGroups.filter(group => !group.isSettingImage)
  .sort((a, b) => a.index - b.index);
// top.url 한 번 → body의 각 group.url → bottom.url 한 번
```

실제 변수명은 minified `r/n/l`이며 위 코드는 읽기 쉽게 이름만 바꾼 인용 표현이다. top/bottom은 **첫 flag 그룹 한 개씩**이다. `${top.url}`/`${bottom.url}`를 img src에 한 번 보간하며 url 배열을 순회하지 않는다. processedGroups의 setting producer도 현재 설정의 `topImageUrl` 하나와 `bottomImageUrl` 하나를 각각 `url`에 넣는다. URL 배열을 지원한다는 근거는 없다. 타입을 강제하지 않는 client 코드가 존재한다는 것과 배열이 의미 있게 처리된다는 주장은 다르다.

본문은 숫자 index 정렬이며 original/translated/translationFailed 구분 없이 current url을 사용한다. `originalUrls`나 `originDetailImages`를 최종 입력으로 선택하는 식은 이 경로에 없다. 첫/끝 flag 배너와 non-setting 분류가 중첩된 비정상 객체, 같은 index·중복 flag의 손실 없는 처리는 보장되지 않는다. 자체의 explicit top/body/bottom·고정 ID·저장 배열 순서로 불일치를 제거하는 것이 재구현 판단이다.

자체 workspace schema에서 복수 보호 배너가 유효하다면 모두 현재 순서로 보존해 합치는 것이 안전한 자체 확장 정책이다. vendor의 첫 배너만 고르는 식을 그대로 가져와 저장된 보호 행을 조용히 누락시키면 안 된다. 엄격한 단일 배너 계약을 선택하려면 복수 행을 저장 전에 명시 거부해야 한다. 현재 앱의 실제 상하단 source 제약과 독립 문서 schema의 배열 형태도 별도로 확인해야 한다.

## 관찰: 공통·전체 옵션·HTML·ALT 저장

saveDetailPage의 처리 그룹 조건은 nonempty다. 모든 그룹에 번역 성공이나 requestId가 있어야 한다는 검사는 없다. 이 조건이 충족되면 얕은 product 복사본에 root detailHtml, URL 있는 non-setting processedDetailImages와 root detailImages/완료 상태를 설정한다. root detailImages는 non-data URL 목록 뒤에 개별 data URL의 업로드 성공분을 push하므로 최종 HTML 정렬과 항상 같은 순서라는 보장은 없다.

| 대상 | 정확한 정적 저장 동작 |
| --- | --- |
| 상품 공통 견적 | 존재하는 `coupangDoc.jsonDocument[0].imagePage.details`만 최종 detailedImage와 `htmlProductDetailContent=''`로 변경 |
| 모든 옵션 | 별도 included/export 필터 없이 options 전체의 root detailImages와 완료 상태를 같은 목록으로 변경 |
| 각 옵션 견적 | 존재하는 각 `coupangDoc.jsonDocument[0].imagePage.details`만 최종 detailedImage와 HTML `''`로 변경 |
| 공통 ALT | 기존 altText가 truthy이면 유지. falsy이면 truthy `product.seo.metaDescription`, 아니면 `productName + ' 상세 설명'` |
| 옵션 ALT | 기존 ALT 여부와 무관하게 위 raw base로 덮음. raw `option.korName`이 truthy이면 `' - ' + korName` suffix |
| root 작업 자료 | 로컬 root HTML과 non-setting 처리 그룹의 기존 속성을 보존. 최종 빈 견적 HTML과 별개 |

문서·imagePage/details를 새로 만드는 코드는 이 메서드에 없다. 공통 jsonDocument 전체를 덮는 동작도 아니다. 형제 상품 적용은 별도 `[100938,102402)`의 명시 action이고 일반 save에 자동 형제 순회는 없다. 그 target patch는 ALT를 보존하므로 일반 상세 저장의 옵션 ALT 정책을 가족에게 자동 확대하지 않는다.

truthy는 문자열 trim이 아니다. 공백 metaDescription/korName/기존 공통 ALT도 내용으로 취급된다. SEO 제목이나 화면 옵션 label로 raw productName/korName을 임의 대체하지 않는다. 최종 이미지와 HTML을 바꾸는 것에 ALT 변경도 결합되므로 자체 미리보기는 덮는 범위와 기존 값을 함께 검토할 수 있어야 한다.

## 관찰의 한계: 완료·실패·백업

data URL 업로드 실패를 개별 catch로 삼키며, 최종 converter의 throw/빈 결과는 URL 쉼표 연결 fallback으로 내려갈 수 있다. 원본/실패 그룹이 있어도 완료 상태를 설정하고 shallow nested 옵션/견적 객체를 요청 전에 바꿀 수 있다. updateRocketProduct를 await한 뒤 toast를 띄우지만 메서드 바깥 catch는 오류를 재throw하거나 성공 Boolean을 반환하지 않는다. 이런 상태/토스트·쉼표 fallback을 자체 PNG 저장 성공 증거로 복제하지 않는다.

이 정확한 saveDetailPage slice에는 immutable backup/undo archive, 이전 raw null/blank snapshot, revision CAS나 명시 receipt를 생성하는 식이 없다. **해당 메서드에서 확인되지 않았다는 범위**이며 vendor 전체 앱/서버에 백업이 없다는 주장이 아니다. 전체 product payload가 서버에서 어떻게 원자적으로 영속되는지와 원격 파일 보관 정책도 미확인이다.

## 자체 연결의 최소 계약과 검토 항목

다음은 vendor가 보장한 구조가 아니라 Step688 데이터에 맞춘 재구현 계약이다. root가 검토 중인 `workspace:{revision,digest}` opt-in을 기존 atomic detail-save에 결합하는 방식은 이 경계와 맞는다. 최종 schema/route는 담당자가 결정한다.

1. **저장된 workspace를 현재 서버에서 다시 증명한다.** 승인 회사/회원·상품·선택 옵션·정확한 context/profile와 현재 quote/source view, workspace row 원문/revision/digest·현재 배너 설정 및 실제 origin/current/base/sidecar를 확인한다. pool 밖 key는 해당 고정 photoId의 검증된 현재 결과만 허용한다. owned filename만으로 기존 일반 상세 저장의 pool 검사를 느슨하게 만들지 않는다.
2. **현재 배열의 current key를 그대로 합친다.** 같은 key의 독립 ID·중복 위치를 보존한다. 보호 행을 포함한 전체 순서를 쓰고 origin을 대신 렌더하지 않는다. 완성된 현재 사진을 입력으로 쓰므로 자체 편집 레이어를 다시 적용하지 않는다. 생성 HTML은 보존/검토 자료이며 실행하지 않는다.
3. **최종 레이아웃을 별도로 고정한다.** 폭800·흰 배경·full bleed·padding0·사진 간격0을 사용한다. workspace generatedHtml의 20px/760px/imageMargin과 분리한다. 현재 compositor의 방향 반영 decode·크기/전체 용량/출력 한도·실제 PNG SHA/bytes/800px/예상 높이 검증을 유지한다. 높이 `Math.round` 등은 자체 정책이며 vendor 픽셀 동일성 주장과 분리한다.
4. **미리보기는 무쓰기다.** 전체 입력 파일 조회 전후 현재 quote와 workspace를 다시 확인하며 바뀌면 preview를 폐기한다. 옵션·프로필·사진/역할/순서·record revision·active/disabled ABA가 바뀐 오래된 preview를 최종 승인으로 쓰지 않는다. 기존 dirty HTML/이미지 초안을 덮지 않는다.
5. **명시 최종 저장만 공통+모든 실제 행에 적용한다.** 기존 detailSaveChanges/text policy를 재사용해 현재 category의 canonical 및 정확한 primary 연결을 함께 갱신한다. 제외 옵션도 포함하고, 현재 출력 key+HTML `''`+raw ALT 규칙을 미리 보여준다. 다른 category scope·수집 원문·option identity·가격·표시사항은 유지한다. readOnly/누락·모순 alias는 쓰기 전에 거부한다.
6. **기존 문서와 before를 같이 보존한다.** workspace 문서/ID/원본/현재 결과/생성 HTML을 최종 PNG로 치환하지 않는다. 새 receipt는 검토한 workspace revision/digest와 순서 있는 실제 현재 입력, 최종 PNG를 결합한다. 기존 `detailSaveManualBackup`의 raw null 대 공란·공통/전체 옵션 ALT 및 HTML before와 기존 상세 backup history를 보존한다. 선택 옵션의 literal 저장 전 HTML snapshot을 새 root generatedHTML로 바꾸어 부르지 않는다.
7. **atomic claim은 실제 DB 경계만 말한다.** final PNG/문서가 먼저 R2에 남는 것만으로 저장 성공이 아니다. exact workspace 원문과 raw 원천/member/product/quote를 final SQL 조건에 묶고, 결과 receipt를 검증한다. 불명확한 ACK는 읽기 복구만 먼저 수행하며 자동 렌더/POST/전체옵션 재적용을 하지 않는다. 저장 후 current clock이 바뀐 workspace는 새 proof로 다시 열 수 있어야 한다.

일반 상세 저장의 기존 `ordered-inputs-html-v1` 증거와 새 workspace opt-in의 증거를 이름만 합쳐 legacy/family 자료를 새 문서로 승격하지 않는다. 새 상태가 없는 과거 상품의 읽기는 유지하되 새 작업만 명시적으로 사용 불가로 표시하는 것이 적절하다. 직접 전체옵션 저장 전에는 workspace 편집 저장·상품 pool 첨부·선택 옵션 quote PUT을 몰래 실행하지 않는다.

## 남은 미확인과 후속

최종 converter의 실제 runtime 환경·MIME·픽셀·네트워크/서버 protocol, vendor 자체 backup·트랜잭션은 이번 retained slice로 확정할 수 없다. 원래 iframe 편집 세션도 별도의 unknown이다. 기능 재현은 현재 사진을 정해진 순서/레이아웃으로 합치고 작업 문서를 보존한 채 공통·전체옵션 최종 견적을 명시적으로 저장하는 수준으로 한정한다. Supplier Hub 실접수나 전체 업무 pipeline 완료를 증명하지 않는다.

동결된 자체 route/plan/DB/client/renderer/UI의 9개 파일을 source-only로 독립 검토했다. 실제 hash와 검토 경계는 `outputs/step689-independent-review.json`이다. 최종 route SHA256은 `11a6ec08f43175a90cb2892d62d79e9a1febe06c1b443809291c3106d3472f70`이며 closed proof의 key 순서를 semantic revision/digest 비교로 처리한 보강까지 포함한다. old quoted input이 공란이면 workspace 렌더가 불필요하게 막히던 연결도 별도 whole-view/workspace 검증으로 수정됐음을 확인했다.

현재 사진·실제 파일·800px full-bleed, 선택적 workspace/legacy 경계, raw member/source/quote+exact workspace CAS, atomic pool/all-option/HTML/ALT/full snapshot backup, 저장 후 503·GET receipt, UI의 exact prepared generation/checkbox·부모 dirty/peer I/O·늦은 callback·최신 읽기 escape를 대조했다. 보강 후 새 치명 문제는 이 좁은 검토에서 발견하지 못했다.

이후 root의 양 회사 격리 UI capture 완료 신호를 받아 `outputs/step689-native-verify.mjs`를 오프라인 실행했다. 실제 upload Created201을200으로 가정한 verifier assertion만 실제 기록에 맞게 고친 뒤 exit0/PASS였으며 앱·원본 capture는 바꾸지 않았다. `outputs/step689-native-verified.json`은 sourceFrozen:true, 실제HTTP117(성공116+의도한 ACK5031), 회사별 oldR2 25개/관련없는41table 불변·newR2 3개·실제800×262 full-bleed 경계pixels·공통+6옵션 이미지/빈HTML/ALT·full snapshot/rawbefore/literal HTML archive·workspace 원문 보존 및 GET-only prepare/download/ACK 복구를 기록한다. 스크린샷은 양쪽 CDP5,000ms timeout으로 없으며 vendor converter 실행 관찰이나 전체 픽셀 동등성을 증명하지 않는다.

자체 관련 테스트 고유33파일369개 통과 및 상세 구현 범위는 [구현·검증 문서](step689-workspace-final-detail-save-2026-10-16.md)와 `outputs/step689-final-validation.json`을 따른다. 기존 무료 Worker 배포 exit0, version `7bac9a5f-c1ce-4169-b2cf-2b11cb3c5f26`는 `outputs/step689-deploy.log`와 일치한다. 이 배포가 vendor 동등성 전체나 Hub 접수를 증명하지 않는다. 이 agent는 새 분석/브라우저 자원을 열지 않았으므로 정리할 소유 세션은 없다.
