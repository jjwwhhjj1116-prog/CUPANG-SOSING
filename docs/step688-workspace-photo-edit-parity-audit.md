# Step688 — 작업 문서 사진 ID에 결합한 편집의 좁은 계약

2026-10-16. 기존 Step684/685/687 보관 Evidence와 exact source manifest만 재사용했다. 새 REA producer·브라우저·외부 iframe·Couplus MCP·Supplier Hub·1688·OCR/번역 provider를 실행하지 않았다. 보호된 공유 탭과 운영 자료에 접근하지 않았고 앱·테스트·DB는 변경하지 않았다. 아래 vendor **관찰**은 shipped client의 정적 의미이며 실행·서버 영속 성공은 아니다. 자체 **제안 계약**은 root의 후속 설계 검토 전 상태다.

## 답: 현재 결과를 바꾸되 편집 배경과 타깃 권위를 보존

다음 기능의 최소 단위는 **저장된 body photoId에서 실제 배경을 열기 → 수동 편집 또는 명시적 OCR → 검토 PNG 생성 → 해당 사진의 current 결과와 자체 편집 문서를 workspace에만 보관 → 닫고 다시 열어 같은 배경·편집값 복원**이다. 견적 슬롯을 임시로 만들거나 기존 견적 HTML/이미지를 먼저 변경하는 절차가 필요해서는 안 된다.

photoId는 위치와 분리하고, originKey는 작업 문서에서 처음 선택한 사진으로 보존한다. 렌더 배경은 그 originKey와 항상 같지 않다. 현재 사진이 검증된 자체 편집 결과이면 그 결과의 저장된 base+편집 문서를 열고, 아니면 현재 파일을 새 편집의 base로 삼는다. 현재 결과 PNG에 예전 text/brush를 다시 그려 이중 렌더하지 않는다. 이 기능을 vendor 외부 편집 세션 전체 복원이라고 부르지 않는다.

## 기존 근거

- chunk `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`: SHA256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`, 553,312 bytes.
- main `outputs/step652-current-couplus/main.a20c7114.js`: SHA256 `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`.
- iframe 한정 parent Evidence `ev_6373190d88287217f0a505c6e86baff55ba4c1447b792b744463771033bf7809`, summary `ev_c9c4ef6a6c24aba3f82a41d2f2c85fec2b199086d3d4eb432d17bd4a702a5170`. inert factory 1개/4,780 bytes, parse 실패 0/semantic unknown 221. 실제 provider 동작은 확인하지 않았다.
- save/group Evidence `ev_782e7a89a96a33a05f38b2d977a5ee4001676f0891cc87373d600c7252192396`, 형제 적용 parent `ev_9ba78b705b9c68a727604eaf0bebe7f726bbbe8fea6c6d38d50ac77d2b88e1ba`는 기존 [Step687 감사](step687-detail-workspace-parity-audit.md)와 같다.
- exact source는 `outputs/step684-edit-session-audit-manifest.json`, `outputs/step685-detail-composition-audit.json`에 이미 있다. 후자의 SHA256은 `9c91c92a7a52fcdcee47c1545a17292f3d80e6afe579fd276d2c127e600ccb75`다. 완료된 producer 분석을 반복하지 않았다.

offset은 UTF-16/끝 제외이며 아래는 chunk 기준이다.

| 근거 | 범위 | 조각 SHA256 |
| --- | --- | --- |
| 실제 편집 시작 editProcessedGroup | `[105785,106435)` | `48bc0bd3ad5e4f8e8fdc8f88014037ec5fa9c37aff806ca2968a9f6201be8d50` |
| 편집 완료 handleEditorImageEdited | `[111813,113270)` | `1fdc638324a271fed733a3d690ecbdf0c4dd8c975efa1b234b87fa52688e76c7` |
| UI 단일 번역 | `[115388,116718)` | `ac09b05ae5f9b5a56cf1dfc3f2ca49b86d6a6db02a0d7e92f9c52f3a6a4252db` |
| UI 영문 단일 번역 | `[116719,117763)` | `56d1041ec47aa36085d055a1de4e1d1a212f8f68561ef85597f2d222b7164c18` |
| HTML 재생성 | `[127674,128968)` | `ec174e97f07a711634eb1f44fe0fbcc3c411d9918c51adae12efa4265c91a59f` |
| 일반 상세 저장 | `[131264,136334)` | `757d3e6097a2084225181b9e0cbf205687e1cb93061ea886e7b66b3f53dc28f2` |
| iframe factory | `[496888,501157)` | `394455cadcdc457c6bed7ded780ec90082066ddc8a3984ddcba4bf9c486ac202` |

## 관찰: 입력·결과·편집 세션은 서로 다른 자료

실제 카드의 편집 버튼은 non-original && truthy group.requestId일 때 `editProcessedGroup(arrayIndex)`를 부른다. setting 배너에는 이 편집 버튼이 없다. 메서드는 group.requestId, translationData.requestId/RequestId/Data.RequestId 순으로 id를 찾고 현재 group.url과 함께 modal 상태를 설정한다. `translationData`와 `ocrInfo` 전체를 child에 넘기는 구조는 아니다. render 조건 때문에 translationData에만 id가 있는 그룹은 메서드 fallback이 있어도 버튼이 보이지 않을 수 있다.

child는 requestIds를 외부 iframe에 postMessage한다. 초기 imageUrl/OCR/폰트/crop/brush 문서를 iframe에 보내는 코드는 확인되지 않았다. URL event의 requestId는 기존 prop이며 raw message는 result에 담긴다. 5초 응답 timeout에도 이전 URL을 편집 event로 내보낼 수 있으므로 event 하나가 새 PNG·새 편집·성공 증거는 아니다.

| 자료 | 정적 관찰 | 자체 구현에서의 구분 |
| --- | --- | --- |
| group.url | 카드의 현재 결과. 단일 번역 버튼도 이 URL을 입력으로 전달한다. | current result key/SHA. |
| originalUrls | 대표 단일 서비스는 `[이번 호출 입력 URL]`을 저장한다. 이전 결과가 새 입력일 수 있다. | 해당 작업 base와 수집 원문을 분리. URL 이름만으로 최초 원본을 확정하지 않음. |
| requestId | 외부 번역/편집 세션을 선택하는 id. 실제 편집 버튼의 조건. | 자체 API 권한·저장 성공 증거로 사용하지 않음. |
| translationData/ocrInfo | 과거 서비스 응답과 OCR 자료. | 실제 자체 작업/검증한 편집 문서와 별도. |
| index | map 키·순서 번호. 편집 선택은 배열 위치를 기억한다. | 고정 photoId와 순서를 분리하고 오래된 위치로 결과를 채택하지 않음. |

수동 완료 callback은 기존 그룹을 shallow spread하고 **url/requestId/lastEdited만 바꾼다.** originalUrls, processType, groupSize, translationData, ocrInfo, isTranslated, translationFailed, failReason 및 그 외 속성은 남는다. raw event.result/msgId는 새 그룹 필드로 보관하지 않는다. 현재 HTML의 URL을 치환한 뒤 그룹으로 전체 HTML을 다시 생성하며 callback 자체에는 서버 저장이 없다.

단일 번역 UI는 서비스 반환 그룹을 해당 index에 **통째로 교체**하고 HTML을 다시 만든다. 이때의 originalUrls는 이번 작업 입력이다. 수동 편집의 spread 갱신과 같은 의미가 아니다. 그 메서드에도 product 저장은 없다. 일반 saveDetailPage가 URL 있는 non-setting 그룹을 보존하고 별도 최종 PNG/빈 견적 HTML을 적용한다. 재열기는 저장된 map을 읽는 것이며 마지막 편집의 독립 레이어를 PNG에서 역추정하지 않는다.

따라서 기능상 재현할 부분은 **같은 사진의 순서·원본 참조는 유지하면서 현재 결과만 명시적으로 바꾸고 재열 수 있음**이다. 오래된 성공/실패 metadata와 느슨한 iframe event 검증·timeout 성공 처리는 복제 대상이 아니다.

## 제안하는 최소 end-to-end 계약

다음은 자체 설계 권고다. 정확한 type/route 이름은 root가 결정하며 vendor의 숨은 서버 문서를 발견한 결과가 아니다.

1. **저장된 사진에서 명시적으로 연다.** 처음에는 저장된 body 사진만 지원하고 dirty 작업 문서는 먼저 보관하게 한다. 요청에는 owner/승인 회사·상품·정확한 context/profile·workspace revision/digest·photoId·현재 key/SHA가 결합된다. 동일 key의 두 위치도 photoId로 구분한다. 보호 배너는 새 경로를 통해 편집하지 않는다.
2. **닫힌 workspace-target을 따로 둔다.** 실제 quotationTarget의 option/field/slot/value를 꾸미지 않는다. 기존 quote-target과 workspace-target을 동시에 담지 못하게 하고, source proof는 현재 DB workspace/photo와 실제 파일에서 서버가 만든다. vendor id나 과거 job/quote proof를 새 workspace 권한으로 복사하지 않는다.
3. **세 가지 identity를 분리한다.** workspace originKey는 처음 선택한 사진, edit base는 이번 렌더의 실제 배경, current key는 지금 적용된 결과다. 현재 파일에 검증된 자체 편집 문서가 있으면 원래 base와 문서를 확인해 연다. 없다면 current를 새 base로 열되 최초 수집 원본이라는 주장은 하지 않는다. 다른 상품/가족·회사·문맥의 편집 문서를 URL 일치만으로 가져오지 않는다.
4. **열기와 provider 작업을 구분한다.** 수동 원본 열기/저장 편집 문서 복원은 읽기만 수행하고 OCR/번역을 자동 시작하지 않는다. OCR·언어 번역은 별도 명시 action이며 실제 요청 성공 증거가 있을 때만 provenance를 갱신한다. 기존 결과 열기 실패를 조용히 flattened 편집으로 낮추지 않는다.
5. **검토한 편집 문서와 PNG를 결합한다.** region 순서·원문/번역문·선택·스타일·erase/brush·crop·언어를 자체 schema로 검증한다. 미선택 영역도 보관·길이·치수·개수 검증 대상이다. runtime Blob/objectURL/AbortController는 저장 문서가 아니다. 현재 background에 같은 레이어를 중복 그리지 않는다.
6. **명시 적용은 정확한 사진만 저장한다.** immutable 출력 PNG와 자체 문서를 실제 SHA/bytes/치수로 검증하고, workspace revision/photoId/current key 및 전체 원문 CAS가 맞을 때 그 사진의 current 결과·검증된 편집 참조·generated HTML만 바꾼다. originKey/ID/역할/사진 순서/다른 사진·회사·scope는 보존한다. 원본·기존 결과·과거 문서는 삭제하지 않는다.
7. **불명확한 결과는 읽기로 확인한다.** deterministic operation identity는 workspace target·검토 source/base·편집 문서·출력 SHA를 결합한다. R2만 저장된 detached 파일은 적용 성공이 아니다. DB 채택 결과와 실제 결과/문서를 확인하고 ACK 유실은 GET으로 조정한다. 현재 사진이 바뀌면 다른 photoId/위치로 재지정하지 않는다. 자동 재렌더·재업로드·재적용은 하지 않는다.
8. **화면 세대와 부모 초안을 보호한다.** 상품/옵션/profile·workspace record·photoId·현재 결과·active/version/disabled 전환, 중간 저장/문서 변경, 더블클릭·언마운트를 검사한다. 오래된 편집 결과가 다른 사진에 채택되거나 기존 텍스트/이미지 초안을 덮지 않아야 한다. 성공 후에도 현재 서버 문서를 다시 읽어 정확한 한 사진 갱신인지 확인한다.

## 반드시 먼저 정할 파일 귀속 경계

Step687 문서는 origin/current key가 현재 product image pool에 속해야 하고, 기존 옵션 초안 채택도 이 pool membership을 검사한다. 새 PNG가 workspace에만 저장되면 기존 pool에는 없는 키다. 이를 해결하지 않고 현재 validator를 통과시키거나 실제 견적 슬롯을 임시 작성하는 방법은 허용되지 않는다.

root가 선택한 계약은 **상품/견적까지 불변인 workspace-only 편집 적용과, 나중의 별도 명시 첨부**다. 다음은 채택한 자체 정책이며 vendor 서버의 관찰 사실이 아니다.

1. 실제 `FreeImageSource.workspaceTarget`은 `kind:'detail-workspace'`, profile/option/photoId, workspace revision/digest/binding을 갖는다. role은 detail이고 quotationTarget/optionImages와 동시에 존재할 수 없다. 별도 workspace-image-text endpoint가 읽기·저장 편집 복원·OCR/번역·적용·복구를 담당한다. 기존 견적 route를 가짜 슬롯으로 통과시키지 않는다.
2. 명시 편집 적용은 immutable PNG+자체 sidecar를 보관한 뒤 workspace 한 행만 CAS로 바꾼다. product/image pool/quote/content/options/labels와 그 clock은 그대로다. 새 key가 pool 밖에 있을 때에는 정확한 이전 workspace record의 파일 및 실제 봉인된 R2 result/base/doc 증거로만 권한을 연장한다. owner prefix나 파일 이름, 다른 photoId의 과거 job proof만으로 허용하지 않는다. 원래 photoId·회사·정확한 context/profile 연결을 유지하고 재정렬은 위치 대신 ID로 확인한다.
3. **‘편집 결과를 상품 이미지에 추가’는 추가적인 명시 쓰기다.** 현재 workspace의 실제 검증된 current photo key 중 pool에 없는 것만 기존 순서 뒤에 붙인다. raw product snapshot·정확한 workspace payload·승인 member/context CAS 아래 단일 product UPDATE를 사용한다. 이 action은 product clock/image_keys를 바꾸지만 견적/content/options를 바꾸지 않는다. origin/history/sidecar/base 전부를 pool에 넣는 동작이 아니다.
4. 첨부 후에는 fresh parent를 다시 열고 기존 GET-only local adopt로 검토 초안을 만든 다음 기존의 명시 quote PUT을 사용한다. adopt 자체가 쓰기로 바뀌거나 세 action이 하나의 atomic quote 적용이라고 표현되어서는 안 된다. 첨부 ACK 유실은 읽기로 현재 pool/clock/receipt를 확인하며 자동 재첨부·견적 쓰기를 하지 않는다.
5. 첨부로 product clock이 바뀐 뒤에도 자체 편집 재열기는 현재 workspace record와 실제 result/base/doc를 기준으로 새 workspaceTarget proof를 발급해야 한다. sidecar의 역사적 source clock을 현재 권한으로 재사용하지 않는다. sidecar를 덮어써 과거 문서를 현재 proof로 바꾸지 않는다.

새 파일·문서만 저장됐지만 workspace가 갱신되지 않은 상태, workspace 저장은 됐지만 pool에는 없는 상태, pool 첨부는 됐지만 견적은 그대로인 상태를 각각 구분해야 한다. 아직 pool 밖인 키를 기존 quote 초안에 전달할 수 없으면 해당 action을 차단하고 명시 첨부 경로를 표시한다.

## 자체 소스의 좁은 독립 검토

아래는 2026-10-16 담당자가 동결을 알린 구현의 정적 검토다. vendor의 실행 관찰이나 실제 UI 검수 결과를 대신하지 않는다. 별도 endpoint·닫힌 workspaceTarget/identity·immutable PNG/문서 연결·현재 photoId·승인 member/회사/context 및 raw snapshot CAS를 대조했다. workspace 적용은 한 workspace 행만 바꾸고, 명시 attachment의 단일 product UPDATE와 이후 GET-only 초안 채택·기존 quote PUT을 분리한 구조다.

검토 중 발견한 저장 후 409/403의 의미 문제는 보강됐다. SQL 저장 실행의 결과가 불명확하거나 RETURNING 뒤 읽기 검증이 실패하면 503으로 남기며, 바깥 image apply의 replay가 실패해도 기존 503을 definite rejection으로 바꾸지 않는다. 따라서 client가 이미 저장됐을 수 있는 작업을 단순 거부로 분류해 pending을 지우는 경로를 피한다.

첨부 ACK 유실 뒤 다른 부모 편집이 생겨 이전 receipt를 확정할 수 없을 때에는 별도 ‘최신 상태로 다시 열기’ GET 동작이 있다. 이 동작은 이전 요청의 성공/실패를 주장하지 않고 old attempt를 superseded 처리하여 재POST하지 않는다. 사진 editor도 별도 최신 구성 GET으로 빠져나올 수 있다. 보통 닫기에는 child의 live dirty/pending/brush 상태를 동기적으로 확인하는 guard가 있다. 부모 초안과 바뀐 화면 세대에는 검증한 결과만 채택한다.

현재는 workspace 결과 파일을 **원래 photoId/option/profile/회사/context에 고정**한다. pool에 명시 첨부한 뒤에도 다른 새 photoId에 편집 세션을 복사하는 기능은 지원하지 않는다. 서버는 새 record를 SQL 전에 검증하고, UI의 추가/교체 후보도 해당 workspace 결과 복사를 숨긴다. 같은 ID의 재정렬·재열기와 현재 결과를 견적 후보로 첨부하는 기능 범위다.

독립 검토 시 읽은 소스 SHA256은 다음과 같다. 이후 root의 최종 capture/release manifest가 다른 hash를 갖는다면 그 최신 소스에 이 검토를 자동 확장하지 않는다.

| 파일 | SHA256 |
| --- | --- |
| app/detail-workspace.ts | `489cca6a525f64ce8b1dc74590cb026d3166d26bd69d11ababcd595e29765356` |
| db/detail-workspaces.ts | `74e982a0addf3e844f8de828aae71a161e66e1d73bf9f8addf7bc1146828e94a` |
| db/detail-workspace-image-edits.ts | `b2ab9f248a5de38753219285c013566e508d5a3de2524e37c44064e51f80fa77` |
| app/api/products/[id]/workspace-image-text/route.ts | `5081d052b9c28741c9e10177f39155f9dc2d530926a45af1d345dd04d4da3727` |
| app/detail-workspace-image-client.ts | `b99b873594e04962015a8788d0576fa4bc78c7f1753485bf596c9b1072b306e3` |
| app/components/detail-workspace-panel.tsx | `1d4e6a826ca4596467562e820c2dfe606697d54d974bf2967d505c34d2636756` |
| app/components/free-image-translation-panel.tsx | `44bc1b2c46a8a60e7c16a2d3af83cd3c7a5df6a11a608bcaedfd71a79e5ebe95` |
| app/components/option-image-editor.tsx | `b6136c337c32ff23c30c539383208bbee6383cade0677a392a20b73afbb06d2b` |
| app/detail-workspace-attachment-client.ts | `83a09f9241ce64b5d95feaa6866a9ec5b4291034ea50ada61367581ccca13577` |
| db/detail-workspace-attachment.ts | `cf319e5f94973512109530ae8687b9811c75b64f50b653e1d1c08c644baf4e5d` |

위 보강 후 새 치명 문제는 이 검토 범위에서 발견하지 못했다. 실제 테스트 수·배포 완료는 root의 별도 검증 문서와 원본 증거로 판정한다. 이후 root의 양 회사 격리 UI capture 완료 신호를 받아 `outputs/step688-native-verify.mjs`를 오프라인 실행했고 exit 0 / PASS였다. `outputs/step688-native-verified.json`에 실제 HTTP 80회(78성공+의도한 ACK 503 2회), sourceFrozen:true, 회사별 44개 중 41개 불변 테이블·기존 R2 25개 불변·신규 PNG2+sidecar2, 원래 base/doc 복원·고정 ID·G2만 명시 첨부·GET-only 초안 채택·별도 quote PUT 및 HTML 원문 보존을 기록했다. 이 결과는 자체 구현의 기능 검증이며 vendor 실행 관찰로 바꾸어 해석하지 않는다. 스크린샷은 두 회사 모두 CDP 5,000ms timeout으로 없으며 screenshotsComplete:false다. 상세 실행 범위는 [구현·검증 문서](step688-workspace-photo-edit-2026-10-16.md)를 따른다.

## 권고 검증과 남은 미확인

검증은 같은 key의 두 photoId 중 한 위치만 바뀜, 이동 후에도 ID에 맞는 결과 채택, 다른 사진/문서 revision 경쟁 거부, 원본 base에서 같은 레이어 복원, 미선택 영역·언어·style·crop 보존, 보호 배너·다른 사진·생성 HTML 외 literal 견적 HTML/ALT 불변, 취소/ABA/ACK 유실·R2와 DB 부분 실패를 포함하는 것이 적절하다. 새 결과가 product pool 밖에 있거나 pool 변경으로 부모 view가 바뀐 경우도 선택한 정책대로 검증해야 한다.

이 감사 agent는 실제 OCR·provider·UI·저장 요청을 실행하지 않았으며 root의 격리 자체 UI capture만 오프라인 검증했다. vendor 외부 세션의 유지 기간/레이어 schema/권한/실제 텍스트·brush·crop 동작은 미확인이다. 고정 photoId·독립 DB/workspace-target·명시 상품 pool 첨부는 vendor가 직접 보장한 구조가 아니라 자체의 안전한 재구현 계약이다. 위 동결 소스 검토와 자체 UI 검증이 기능 전체의 동등성이나 배포 완료 판정은 아니다.

새 런타임·브라우저·MCP 세션을 열지 않았으므로 정리할 소유 자원은 없다.
