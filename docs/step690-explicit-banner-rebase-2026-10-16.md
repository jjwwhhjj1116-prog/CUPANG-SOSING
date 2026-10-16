# Step690 — 편집 HTML 간격과 현재 상하단 배너의 명시적 재적용

2026-10-16. 상세 작업공간에서 편집용 HTML 사진 간격을 저장하고, 상품에 저장한 상하단 이미지 역할이 바뀌면 이전·현재 배너를 대조한 뒤 작업공간에만 반영하도록 구현했다. 간격과 배너 갱신은 최종 PNG·견적서와 독립적이다. 관련 고유16개 테스트 파일148개와 격리 양 회사 네이티브 검증을 완료했고 기존 무료 Worker에 배포했다. version `164c923e-cbf3-41a5-87b6-9afe0e2ae910`이다.

이 문서는 자체 구현과 검사 결과다. Couplus에 대한 근거는 [별도 정적 감사](step690-detail-settings-parity-audit.md)이며 새 vendor 실행·브라우저·Couplus MCP·공유 계정·1688·외부 provider를 조사하지 않았다. 네이티브 조작은 root가 허용된 자체 localhost3690 fixture에서 수행했고, 이 agent는 저장된 증거만 오프라인으로 검사했다. 기존 실제 운영 상품에는 쓰지 않았다.

## 구현된 동작

`편집 HTML 사진 간격 (px)`은 기존 workspace의0~200 정수 범위를 화면에 제공한다. 정상 값은 로컬 document.imageMargin과 generatedHtml을 함께 바꾸고 `편집 구성 보관`으로만 영속화한다. 빈 값·소수·음수·지수 표기·상한 밖 값은 그대로 보여주며 설명하고 보관·사진 편집·초안 채택·합치기를 막는다. 조용히0이나 가까운 정수로 바꾸지 않는다. 저장 후 다시 열면 해당 간격을 복원한다.

편집용 generatedHtml은 별도 자료다. 폭800 wrapper/padding20과 폭760 사진의 편집 표현에 저장한 간격을 사용한다. 견적의 literal HTML에 자동 대입하거나 실행하지 않는다. **최종 합친 PNG는 현재 사진을 폭800으로 여백 없이 이어 붙이며 편집용 간격을 적용하지 않는다.** 화면에도 이 차이를 표시한다.

현재 상하단 역할은 상품 content의 명시적 detailTop/detailBottom과 소유 pool 증거에서 읽는다. 설정 역할이 과거 문서와 다르면 일반 workspace GET/save는 계속409로 막고 원문을 보존한다. 오류를 계기로 배너를 자동 교체하지 않는다. `현재 배너로 변경 내용 확인`은 별도 GET으로 이전 record·현재 역할·실제 파일 증거를 대조한다. 사용자는 이전/현재 상단·하단을 확인하고 checkbox를 선택한 뒤 `현재 배너로 편집 구성 보관`을 누른다.

배너 갱신은 보호된 top/bottom 행만 현재 역할 순서로 만든다. body의 ID·originKey·현재 key·상대 순서와 imageMargin은 그대로 둔다. 같은 보호 배너는 ID를 유지하고 새 배너는 충돌하지 않는 ID와 origin=current를 받는다. 여러 보호 배너의 모델을 지원하며 live body current key와 새 배너가 겹치면409로 검토를 중단한다. 임의 filename이나 URL 이름으로 body를 지우지 않는다. 이 버튼은 product/content/options/labels/quote/pool/R2를 쓰지 않고 workspace 행만 한 revision 갱신한다.

## 경계와 저장 보장

별도 `/detail-workspace/banner-rebase` GET은 승인 회원·회사·상품·옵션·정확한 카테고리/profile 아래의 과거 보호 배너를 대조할 때만 현재 역할 일치 조건을 완화한다. 과거 record digest·필드 구조·실제 origin/current 파일 SHA/bytes/치수는 계속 확인한다. body와 workspace 결과에는 기존 편집 sidecar·실제 base 검사를 유지하며 임의 소유 key를 새 권한으로 받아들이지 않는다. 이전 배너가 현재 pool에서 빠진 경우에도 이 예외를 body에 전파하지 않는다.

PUT body는 optionId/expectedRevision/expectedDigest/expectedView/requestId 다섯 필드만 받는다. 클라이언트가 사진 문서나 임의 key를 제출하지 않는다. 서버가 현재 역할로 preview를 재구성하고 현재 파일 증거와 함께 requestId를 계산한다. exact 이전 workspace row와 전체 소유 raw snapshot·현재 회원/회사·context·role source를 SQL CAS에 묶어 현재 기준이 달라지면 쓰기를 막는다. 같은 완료 request의 재조회/재생은 새 revision을 만들지 않는다. no-op 갱신은409다.

클라이언트는 검토한 preview를 저장 직전 GET으로 다시 대조한다. 화면 세대·활성 상태·disabled·부모 dirty/동시 I/O가 바뀌면 오래된 승인을 쓰지 않는다. 불명확한 ACK 뒤에는 일반 GET으로 정확한 revision/requestId/document/files를 확인한다. 미적용이면 동일 preview를 다시 읽고 명시적 같은 요청 재시도만 준비한다. 자동 PUT은 하지 않는다. 기준이 바뀐 경우 별도 최신 GET escape는 이전 요청의 성공을 단정하지 않고 새 검토를 시작한다. SQL 이후 기준 변경/후속 읽기 실패는 확정 실패로 오인하지 않도록503을 유지한다.

현재 workspace 테이블은 live record 한 개를 교체한다. **배너 갱신 자체의 별도 과거 DB revision archive나 역사 복원 UI를 이번에 만들지는 않았다.** 기존 R2/편집 sidecar를 삭제하거나 다시 쓰지 않으며, 이후 명시적인 전체 상세 저장은 당시 rev4 full workspace를 기존 detail-save backup에 보관한다. 이 두 종류의 보존을 같은 기능으로 표현하지 않는다.

## 소스 검토와 관련 검사

독립 읽기 검토는 새 planner/client/route와 DB의 historical 보호 배너 예외·현재 역할/파일 재검증·exact 이전 row/raw CAS·postcommit503 경로를 확인했다. 검토한 핵심 SHA는 native capture sourceHashes와 일치한다.

| 파일 | SHA256 |
| --- | --- |
| app/detail-workspace-banner-rebase-client.ts | `c11d04981adc3c3b46e6b89e2a7313a9c8f7dd6c72b180a616083a5f5cc85876` |
| app/detail-workspace-banner-rebase.ts | `b96bc484ad4e11e44e549b37b9cb9cef838f2d4b91f81559c87cdd0a181ac403` |
| app/api/products/[id]/detail-workspace/banner-rebase/route.ts | `f9983bbe08ba79e5824349139451c0b684a4cbbbe5787bf549dbcfc135df947c` |
| db/detail-workspaces.ts | `347ddb3d6ebac0c06536409fe5a99212507faaece1f602020f3888afa37857a0` |
| app/components/detail-workspace-panel.tsx | `2b0d7449256eb487e48b3da07e4334076b35220f9f66f47b1d3afe83482659bb` |
| app/components/detail-workspace-rebase-panel.tsx | `1a1c8942b2d695e3b8701619c2423d55cf55ff66e5b998fee84320ba5389d30f` |

root/담당 worker의 고유 검사 집계는 다음과 같다. 반복 실행이나 영향 재실행을 추가 개수로 더하지 않았다.

| 검사 범위 | 고유 파일 | 고유 통과 |
| --- | ---: | ---: |
| 새 backend API/model | 2 | 15 |
| 새 banner client | 1 | 8 |
| UI 간격·배너·기존 panel 회귀 | 5 | 46 |
| 기존 공통 workspace API/client/model·사진·연결·최종 저장 회귀 | 8 | 79 |
| 합계 | 16 | 148 |

backend 최초 실행은12통과/fixture 원인의3실패였다. historical multiple banner 준비, 충돌 fixture의 유효 content 역할 이동, VM 객체 비교를 test-only로 보정한 뒤 해당3개가 통과했다. 이를 최초부터15개 한 번에 통과한 실행으로 표현하지 않는다. UI의 마지막 부모 callback identity guard는 최종 banner10개로 검사했고 나머지36개는 직전 묶음에서 통과했다. 같은 검사를 여러 번 합산하지 않았다. 공통 workspace79개는 파일/소스/fixture 수정 없이 통과했고 duration203615.3893ms다.

근거는 `outputs/step690-backend-checks.json`, `step690-banner-rebase-backend.log`, `step690-banner-rebase-repaired.log`, `step690-ui-checks.json`, `step690-workspace-regression-files.json`, `step690-workspace-regression.log`다. 최종 집계/해시는 `outputs/step690-final-validation.json`에 고유16파일148개로 기록했다. root의 최종 types/lint/build는 exit0이다. `outputs/step690-schema.log`는44 tables/17 indexes/29 runtime modules와 fresh/repeated memory migration 검사를 확인하며 실제 로컬/원격 DB를 열지 않았다. 신규 DB 테이블/migration은 없다. 관련 검사 완료를 저장소 전체 테스트 완료라고 확대하지 않는다.

## 양 회사 실제 격리 흐름

root가 와이홉 A01464742와 유앤채 A01526306에서 동일한 실제 React/HTTP·격리 SQLite/R2 흐름을 수행했다. 처음25개 pool 사진/27개 R2 객체에는 이전 상하단과 새 배너800×20·800×30이 이미 있었다. 초기 구성4장 rev1에서 간격24·body current key 교체·다른 body 제거로 rev2를 보관하고, 남은 body에 회사별 `배너 변경 검수` 문구·bold·780×70 crop을 적용해 rev3를 만들었다. body origin은 key2이고 실제 편집 base는 key1로 서로 달랐다.

와이홉은 raw201, 유앤채는 빈 간격 입력이 경고와 함께 저장을 막은 것을 DOM으로 확인한 뒤24를 저장했다. 이어 명시 content PATCH로 현재 상하단을 바꾸자 일반 GET409가 발생하고 이전 workspace를 자동 채택하지 않았다. 별도 GET preview를 검토하고 한 번의 배너 PUT으로 rev4를 보관했다. 본문 ID/origin/current·편집 문서·순서와 간격24는 그대로였다. 유앤채는 실제200 commit 직후 client ACK만503으로 바꾸었고 일반 GET 확인으로 복구했다. 두 번째 rebase PUT은 없었다.

rebase/reload 후 사진 editor를 다시 열어 실제 base800×90, 같은 저장 문구·bold·780×70 crop을 복원했다. crop 좌표를 보기 위한 local control 변경 뒤에는 로컬 초안을 정리하고 닫았고 추가 image apply는 없었다. 실제 PNG 다운로드 버튼·준비는 각각 GET만 사용해 원본 pixels를 읽었다. 최종 Canvas는 **800×122px = 새 top20 + 현재 crop72 + 새 bottom30**이었다. 저장한 편집 margin24와 padding20은 최종 이미지에 들어가지 않았다.

전체 상세 checkbox와 저장을 명시적으로 한 번 실행해 missing currentG+finalPNG만 pool에 추가했다. 공통+실제6옵션, 제외 옵션 포함 총7 scope의 canonical/primary detail image를 final 한 장으로 바꾸고 HTML을 비웠으며 기존 raw ALT 규칙을 적용했다. quote revision은 한 번 증가했다. literal 저장 전 HTML의 CRLF·공백, raw null 대 빈 값 before, ordered source SHA/치수, full rev4 workspace를 함께 backup했다. 별도 quote PUT·attachment POST는0이고 final save는 workspace 행을 그대로 두었다. 부모 최신 조회·같은 회사 reload 후 구성3장과 간격24가 다시 열렸다.

`outputs/step690-native-verified.json`은 **PASS, sourceFrozen:true**다. capture의 모든 sourceHashes가 검증 시점 파일 SHA와 일치했다.

| 실제 증거 | 결과 |
| --- | --- |
| client가 받은 HTTP | 159회: 성공2xx156회(정상 upload201 두 번 포함), 예상 일반 GET409 두 번, 의도한 유앤채 ACK503 한 번 |
| 중복 ACK 기록 | 실제 commit200 원본1개를 보존하되 synthetic client 응답과 중복 집계하지 않음 |
| 회사별 쓰기 | workspace PUT2 + image apply1 + content PATCH1 + rebase PUT1 + final upload1 + atomic detail-save1 |
| 회사별 DB | 44테이블 중 무관40개 불변. rebase PUT은 workspace만, content PATCH는 content/product clock·status만, final save는 product/quote만 변경 |
| 회사별 R2 | 기존27개의 SHA/bytes/http/custom metadata 불변. 신규3개는 workspaceG PNG+편집 sidecar+최종 PNG |
| prepare/download | DOM phase 경계 안의 실제 요청은 모두 GET200이며 source 파일을 읽음 |
| 최종 합성 | 실제 PNG800×122, 보호 strip 경계와 current source 오른쪽 edge pixels 일치. 다른 renderer와 전체 픽셀 동일성은 주장하지 않음 |
| 외부/실제 업무 | provider 요청0, 기존 실제 운영 상품 쓰기0 |

근거는 `outputs/step690-native-proof.json`, `step690-native-dom-proof.json`, `step690-native-verify.mjs`, `step690-native-verified.json`이다. verifier는 HTTP·브라우저·DB·provider를 호출하지 않고 실제 capture의 table 전후/파일 bytes/DOM을 검사했다. 최초 실행은 재열기 시점을 content PATCH 전으로 가정하여 실패했다. 실제 기록은 rebase/reload 뒤 복수 GET이므로 그 모든 응답의 같은 doc/base와 fresh rev4 proof를 검사하도록 verifier만 고쳤다. 앱·원본 capture는 바꾸지 않았다. 이후 invalid spacing DOM 검사 및 실제 capture 확장자 정리 후 재실행도 exit0/PASS였고 이 반복을 테스트 개수로 더하지 않았다.

```powershell
& 'C:/Users/7500F/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' 'outputs/step690-native-verify.mjs'
```

와이홉 캡처는 `outputs/step690-waihop-native.jpg`의 실제 **JPEG2109×1498/172727bytes**, SHA256 `aeb8aea23d5ea2a6780d8b3d57b5a7fdd18a94309e71916207acc82da45f3a55`다. 처음 파일 확장자가 png였으나 실제 format을 확인해 jpg로 정리했다. 유앤채 캡처는 CDP Page.captureScreenshot 5000ms timeout으로 없고 error가 기록되어 **screenshotsComplete:false**다. 양 회사 캡처 성공이라고 표현하지 않는다. 다운로드는 실제 버튼의 local Blob 전달/완료 문구를 확인했으며 별도 디스크 파일 저장 경로 검증으로 확대하지 않는다.

root가 소유 native 탭을 닫고 서버를 종료했으며3690 Listen0을 확인했다. 공유 기존 업무 탭은 정리 대상으로 다루지 않았다.

## parity 판단과 남은 범위

retained Couplus client에는 imageMargin 기본0과 parseInt 기반 HTML margin 적용 메서드가 있지만 확인한 render 경계에는 직접 control binding이 없어 실제 UI의 존재·범위·크기는 미확인이다. 자체0~200 정수 control은 명시적 bounded 기능이다. current defaultSettings를 읽는 computed group 목록은 설정 변경에 따라 재평가될 수 있으나 root HTML·저장 group·최종 PNG를 자동으로 정합화하는 watcher는 확인하지 못했다. 자체의 명시적 대조/PUT 정책을 vendor 서버 정책이나 동일한 자동 동작으로 부르지 않는다.

관련 Evidence `ev_782e7a89a96a33a05f38b2d977a5ee4001676f0891cc87373d600c7252192396`, iframe parent `ev_6373190d88287217f0a505c6e86baff55ba4c1447b792b744463771033bf7809`와 summary `ev_c9c4ef6a6c24aba3f82a41d2f2c85fec2b199086d3d4eb432d17bd4a702a5170` 및 정확한 slice/SHA는 [감사 문서](step690-detail-settings-parity-audit.md)에 유지한다. vendor root generatedHTML과 자체 별도 generatedHtml, vendor 전역 설정과 자체 product content 역할의 저장 schema를 구분한다.

이번 결과는 간격 입력과 안전한 현재 배너 재적용의 범위다. vendor 외부 OCR/번역 세션·converter MIME/픽셀·실제 Hub 접수·전체 신규 상품 업무 흐름·역사 reset/migration UI를 재현했다고 주장하지 않는다. `SINGLE_DOCUMENT_LIVE_VERIFIED`와 기존 live gate는 바꾸지 않는다.

기존 무료 Worker <https://sourceflow.jjwwhhjj1116.workers.dev>에 배포 완료했다. `outputs/step690-deploy.log`의 exit0/version `164c923e-cbf3-41a5-87b6-9afe0e2ae910`을 반영했다. 새 DB migration·리소스·유료 plan·권한 scope·확장 업데이트는 없다.
