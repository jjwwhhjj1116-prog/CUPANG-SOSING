# Step688 — 상세 작업 사진의 수동 편집과 독립 보관

2026-10-16. 동결 앱 소스의 **이번 변경 관련 고유 58개 파일 711개 검사**·타입·32파일 lint·스키마·bounded 빌드와 양 회사 격리 네이티브 capture의 오프라인 불변 검증을 통과했다. 관련 전체 회귀의 legacy fixture 12개는 앱 변경 없이 교체 검사를 완료했으며 아래에 집계 방식을 구분했다. **기존 무료 Worker 배포 완료**, version `84f19e23-5fb2-4ad9-aa01-fff6990b012d`다. 저장소 전체 테스트를 실행했다는 의미는 아니다.

## 변경 결과

저장한 상세 구성의 본문 사진에서 `현재 사진 편집`을 열어 문구·스타일·브러시·자르기를 검토한 뒤 `검토한 작업 사진 보관`으로 저장할 수 있다. 이 action은 immutable 결과 PNG와 자체 편집 문서를 보관하고, **선택한 고정 photoId의 현재 결과 및 해당 workspace 행만** 바꾼다. 상품 이미지 후보 목록과 product clock, 견적 이미지·HTML·ALT, content/options/labels는 바꾸지 않는다.

처음 편집하는 사진의 실제 배경은 현재 선택한 key다. workspace의 originKey는 그 행을 처음 보관했을 때의 사진이므로 현재 배경과 다를 수 있다. 저장한 자체 결과를 다시 열면 검증된 원래 렌더 배경과 자체 편집 문서를 복원한다. 잘라낸 현재 결과 위에 이전 문구·브러시를 다시 그리지 않는다. 같은 current key를 쓰는 사진이 둘이어도 서로 다른 photoId를 유지하며 한 위치만 바꾼다.

수동 원본 열기와 저장 문서 복원은 읽기만 한다. OCR·원문 번역은 각각 명시적인 별도 action이다. 기존 공통 편집기의 문구 순서·선택 상태·언어·스타일·브러시·자르기 schema와 PNG 검토 경로를 사용하며, 외부 vendor 세션이나 최초 수집 원문을 복원했다고 주장하지 않는다.

## 상품과 견적에 사용하는 명시적 절차

workspace에만 있는 새 결과는 그대로 견적 초안에 넣지 않는다. 다음 순서를 구분한다.

1. `편집 결과를 상품 이미지에 추가`를 누르면 현재 workspace의 검증된 current photo key 중 없는 것만 상품 이미지 pool 뒤에 붙인다. 과거 결과·origin·base·sidecar 전체를 추가하는 동작이 아니다.
2. 이 별도 첨부는 단일 product UPDATE로 image_keys와 product clock을 바꾸며 견적/content/options는 유지한다. 최신 부모 저장본으로 다시 연다.
3. 기존 `작업 사진을 선택 옵션 초안으로`는 GET으로 파일·문서·현재 기준을 확인하고 사진 key와 순서만 로컬 수동 초안에 전달한다. 기존 견적 HTML 원문은 공란과 공백까지 유지한다.
4. 기존 `선택 옵션 이미지 저장`을 눌러 명시적인 quote PUT을 수행한다. 상세 통합 PNG/전체 상세 저장은 그 뒤 기존 별도 검토 경로를 사용한다.

이 네 단계를 하나의 atomic 견적 적용이라고 표현하지 않는다. 첨부 전 사진 편집 저장은 workspace-only이며, 상품 pool 첨부와 견적 저장은 각각 별도의 명시 쓰기다. root generated HTML은 작업 사진 구성에서 생성한 별도 문서로 유지한다. 기존 literal 견적 HTML이나 Step686의 저장 전 HTML snapshot을 대체하지 않는다.

## 저장·권한·복구 경계

- 닫힌 `FreeImageSource.workspaceTarget`은 detail-workspace kind, profile/option/photoId, workspace revision/digest/binding을 가진다. role은 detail이며 quotationTarget/optionImages와 동시에 사용할 수 없다. 기존 견적 슬롯을 임시로 만들지 않고 별도 workspace-image-text API를 사용한다.
- 실제 DB 승인 회원·회사·상품·정확한 source/profile/category/path와 workspace 원문을 확인한다. 결과·sidecar·실제 배경의 SHA/bytes/치수와 읽기 한도를 검증하며 owner prefix나 URL 일치만으로 다른 사진·상품·fork·가족의 편집 기록을 빌리지 않는다.
- pool 밖의 현재 결과는 정확한 기존 workspace photoId와 봉인된 R2 증거로만 허용한다. pool 첨부 뒤에도 자체 workspace 결과의 편집 문서는 원래 photoId/option/profile/회사/context에 고정한다. UI는 다른 새 photoId에 해당 편집 세션을 복사하는 후보를 제공하지 않는다.
- 사진 편집의 한 행 CAS는 현재 revision/digest/photoId/current key와 raw 원천 snapshot/member 조건을 결합한다. ID/origin/role/순서/다른 사진은 보존하고 현재 key와 생성 HTML 및 실제 파일 증거만 갱신한다. 새 record 검증은 SQL 전에 수행한다.
- 독립 문서 적용 뒤 product clock이 바뀌는 상품 pool 첨부를 했더라도, 재열기는 현재 workspace와 실제 result/base/doc에서 새 proof를 발급한다. 역사적인 sidecar의 source clock을 현재 권한으로 재사용하지 않는다.
- SQL 실행 결과나 RETURNING 뒤 확인이 불명확하면 503으로 유지한다. 바깥 replay가 403/409로 실패해도 기존 불명확한 저장을 definite rejection으로 바꾸지 않는다. 동일 PNG/문서 identity의 읽기 복구가 먼저이며 자동 apply/attachment POST를 하지 않는다. 이미지 저장 복구는 JSON recover action을 쓰지만 DB/R2 쓰기를 수행하지 않는다.
- 외부 부모 편집 때문에 이전 receipt를 확정할 수 없으면 명시적인 최신 구성 GET 경로로 다시 연다. 이 경로는 이전 요청의 성공/실패를 주장하지 않으며 superseded 첨부 attempt를 재POST하지 않는다. 로컬 편집 대신 최신 서버 구성을 여는 선택을 화면에서 설명한다.
- 현재 화면 세대·active/disabled·상품/옵션/profile·원본/result를 대조하고 늦은 응답을 채택하지 않는다. photo editor close guard는 live dirty/pending/brush 상태를 동기적으로 검사한다. 부모 이미지·HTML·통합 이미지 작업과 동시 조작을 잠그며 명시 초안 채택 전에 부모 dirty/보호 배너/현재 기준을 다시 확인한다.
- 보호 배너의 ID/원본/current/역할과 현재 역할 증거는 Step687의 엄격 정책을 유지한다. 설정이 달라지면 409로 원래 문서를 보존한다.

## 구현 파일

| 책임 | 파일 |
| --- | --- |
| 진짜 workspace source·identity와 자체 문서 출력 key | `app/free-image-translation.ts`, `app/free-image-edit-record.ts` |
| workspace 결과의 원본/문서 복원·저장·읽기 복구·명시 번역 API | `app/api/products/[id]/workspace-image-text/route.ts`, `db/detail-workspace-image-edits.ts` |
| 기존 작업 문서 schema와 실제 파일·회원·원문 CAS | `app/detail-workspace.ts`, `db/detail-workspaces.ts` |
| 실제 PNG/편집 문서 검토와 workspace transport | `app/detail-workspace-image-client.ts`, `app/free-image-translation-client.ts` |
| 수동 편집 화면과 기존 작업 사진 연결 | `app/components/free-image-translation-panel.tsx`, `app/components/detail-workspace-panel.tsx` |
| 별도 명시 상품 pool 첨부 | `app/api/products/[id]/detail-workspace/attach/route.ts`, `db/detail-workspace-attachment.ts`, `app/detail-workspace-attachment.ts`, `app/detail-workspace-attachment-client.ts` |
| 최신 부모 기준·기존 GET-only 초안 채택·명시 quote 저장 연결 | `app/components/option-image-editor.tsx`, `app/detail-workspace-client.ts` |

vendor 보관 근거, Evidence ID·조각 offset·digest와 독립 정적 검토의 한계는 [Step688 대조 감사](step688-workspace-photo-edit-parity-audit.md)에 있다. 자체 source review와 runtime 검수 결과를 구분한다. 최종 네이티브 capture의 sourceHashes가 검토 hash와 다르면 해당 변경을 이전 검토에 자동 포함하지 않는다.

## 확인한 검사와 진행 중인 검사

| 검사 | 현재 상태 | 근거 |
| --- | --- | --- |
| 전체 타입 | exit 0 보고 | `outputs/step688-final-types.log` |
| focused lint | 최종 32파일 exit 0 / warnings 0. 초기 test unused 변수 warning 2는 수정 후 해소 | `outputs/step688-final-lint.log`, `outputs/step688-final-lint-files.json` |
| bounded 운영 빌드 | exit 0, 이 빌드는 배포하지 않음 | `outputs/step688-final-build.log` |
| 스키마 | 44 tables / 17 indexes / 29 runtime modules. fresh/repeated 메모리 검사 통과 | `outputs/step688-schema.log` |
| 동결 backend 모델/API | 4개 파일 35개 통과 / 실패 0. 기존 18개와 신규 17개 포함 | `outputs/step688-backend-final.log` |
| root attachment/옵션 편집기 연결 | 2개 파일 11개 통과 / 실패 0 | `outputs/step688-root-tests.log` |
| UI 기존 회귀 | 87개 통과 / 실패 0 | `outputs/step688-ui-regressions.log` |
| 실제 workspace client 연결 | 8개 통과 / 실패 0 | `outputs/step688-workspace-image-client.log` |
| 신규 workspace photo panel | 7개 통과 / 실패 0 | `outputs/step688-workspace-image-panel.log` |
| 관련 전체 회귀 | **고유 50파일 650개 통과. 최초 638개 통과와 fixture 조정 후 교체 12/12 통과를 결합** | `outputs/step688-regression.log`, `outputs/step688-regression-files.json`, `outputs/step688-regression-repaired.log`, `outputs/step688-regression-repair-lint.log` |
| 중복 제거한 최종 검사 | **관련 고유 58파일 711개 통과, 미해결 실패 0** = 전체 회귀650 + 별도 backend35 + root11 + 신규 UI15 | `outputs/step688-final-validation.json` 및 위 담당 범위별 최종 로그 |

UI의 87+8+7은 부분 검사 102개지만 legacy87은 전체 회귀650에 들어 있다. 최종 고유 집계에는 신규 실제 client8+panel7의 15개만 별도로 더한다. 파일 수는 전체50+backend4+root2+신규UI2=58이다. backend/root/UI 부분 결과를 다시 더하지 않는다.

전체 회귀 최초 실행은 638통과/12실패였다. 이 12개는 승인 회원 누락 2건과 새 PNG+편집 sidecar의 파일 수 기대치 10건이며, 테스트·helper 4파일만 조정했다. sidecar SHA/source/document 연결 assertion도 보강했다. 앱 소스 변경 없이 해당 12개를 재실행해 **12/12 통과 / 0실패, duration 44,447.8931ms**, repair lint exit 0을 확인했다. 처음부터 한 번의 깨끗한 650개 실행이었다고 표현하지 않는다. sourceFrozen 판정은 유지한다. `step688-client-panel-tests.log` 등 초기 실패·수정 전 로그는 보존하지만 최종 성공 결과로 세지 않는다. 이 문서 작성 agent는 테스트를 중복 실행하지 않았다.

## 격리 네이티브 검수 결과

root가 허용된 자체 localhost 3688 검수 화면에서 실제 React·HTTP API·격리 SQLite/파일 저장소를 사용했다. 운영 상품이나 외부 계정·provider를 대상으로 하지 않았다. 이 문서 작성 agent는 브라우저·서버·HTTP를 제어하지 않고, 양 회사 capture 완료 신호를 받은 뒤 `outputs/step688-native-verify.mjs`를 오프라인 실행했다. **exit 0 / PASS**, 결과는 `outputs/step688-native-verified.json`이다.

두 회사 모두 실제 UI에서 다음 흐름을 완료했고 캡처와 오프라인 검증을 대조했다.

- 최초 구성 rev1의 본문 A는 origin key2, 본문 B는 key1이다. A의 current를 key1로 교체해 독립 ID 두 행이 같은 current를 갖는 rev2를 보관했다.
- A를 수동으로 열어 문구·bold·800×90 배경의 780×70 crop을 실제 Canvas에서 검토하고 workspace-only apply rev3를 완료했다. quote/pool은 그대로다.
- 닫고 다시 열어 원래 렌더 배경과 저장한 1차 문구·bold·crop이 자동 복원되는 것을 확인했다. 최종 문구로 두 번째 편집을 적용해 rev4를 보관했다.
- B를 이동한 뒤 B만 제거하고 A의 고정 ID·origin key2·새 current G2를 유지한 rev5를 보관했다. 현재 G2만 상품 pool에 1회 명시 첨부한 뒤 fresh parent·GET-only 초안 채택·명시 quote PUT 1회·실제 reload/재열기까지 완료했다. reload 뒤 회사 선택도 해당 회사로 유지했다.

| 회사 | 실제 결과 |
| --- | --- |
| 와이홉 A01464742 | rev1→2→3→4→5, workspace 사진 apply 2회, 명시 첨부 1회, quote PUT 1회, reload 후 구성 3장 재열기 완료. 의도한 실패 주입 없음. |
| 유앤채 A01526306 | 동일 흐름 완료. 첫 사진 apply는 실제 commit 후 client ACK 503을 주입했고 JSON read-only recover로 확인했다. 추가 multipart apply는 없었다. 첨부도 실제 commit 후 ACK 503을 주입하고 GET으로 확인했으며 두 번째 attachment POST는 없었다. |

실제 HTTP는 **80회 중 78회 성공 / 의도한 ACK 503 2회**다. 서버가 실제 commit한 원본 ACK 자료 2개는 별도 보존하고 synthetic client 응답과 중복 계산하지 않았다. 회사별 workspace PUT 3회(rev1·rev2·rev5), 사진 apply 2회(rev3·rev4), 상품 pool 첨부 POST 1회, quote PUT 1회를 확인했다. 유앤채 JSON recover 1회는 DB/R2 쓰기 없이 같은 결과를 확인한다.

각 mutating HTTP의 실제 44-table 전후 snapshot을 검사했다. workspace PUT/apply는 workspace 한 테이블만, attachment는 product image_keys/updated_at만, quote PUT은 기존 명시 선택 옵션 이미지 aliases와 관련 clock/status만 바꾼다. 마지막 전체 비교에서 관련 없는 **41개 테이블은 불변**이다. 회사별 기존 **R2 25개(사진 23개+기존 sidecar 2개)**의 SHA/bytes/metadata가 그대로이며, 새 파일 4개는 결과 PNG 2개+자체 sidecar 2개다. 새 파일의 실제 bytes와 PNG 치수, sidecar 원문·digest·원본/result/source identity·출력 key 연결을 대조했다.

DOM의 재열기 heading은 800×90 배경이며 1차 문구·bold·780×70 crop이 복원된다. 화면의 선택 current identity는 G1이고 실제 HTTP source/base는 key1로 별도 확인했으므로 origin key2나 이미 잘라낸 G1을 배경으로 재렌더한 결과가 아니다. 최종 문구는 회사별 `검수 최종`으로 자체 문서에 남고 새 PNG는 780×70이다. 독립 ID·최초 reference·배너 역할을 보존하고, G2만 pool에 추가한 다음 GET-only local adopt와 별도 quote PUT을 수행한다. literal 견적 HTML은 공백·CRLF까지 API/DB에서 정확히 유지한다. DOM textarea의 CRLF→LF 정규화는 별도로 비교했다.

최종 근거는 `outputs/step688-native-proof.json`의 실제 요청/전후 table/R2 bytes/hash, `outputs/step688-native-dom-proof.json`, `outputs/step688-native-verified.json`이다. `sourceFrozen:true`와 capture의 모든 sourceHashes가 검증 시점 소스와 일치함을 확인했다. 실행 명령은 다음이며 앱·테스트를 추가 실행하지 않았다.

```powershell
& 'C:/Users/7500F/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' 'outputs/step688-native-verify.mjs'
```

양 회사 모두 스크린샷은 `Page.captureScreenshot` CDP 5,000ms timeout으로 확보되지 않았다. `screenshotsComplete:false`이고 screenshot:null/error를 보존했다. 실제 DOM·요청 증거의 통과를 캡처 이미지 확보로 표현하지 않는다. root가 소유 검수 탭 727931898을 닫고 서버 session 97553을 Ctrl+C로 종료했으며 3688 포트 Listen 0을 확인했다. 공유 기존 업무 탭은 정리 대상이 아니었다.

## 마이그레이션·배포 상태

이번 변경의 새 DB 테이블은 0개이며 새 D1 migration은 없다. 기존 Step687의 0027 작업공간 테이블을 사용한다. schema checker는 메모리 fresh/repeated 검사를 수행한 것이며 이번 운영 DB 변경 실행을 의미하지 않는다.

기존 무료 Worker <https://sourceflow.jjwwhhjj1116.workers.dev/>에 배포 완료했다. 배포 명령 exit 0, version `84f19e23-5fb2-4ad9-aa01-fff6990b012d`이며 `outputs/step688-deploy.log`의 성공 기록과 일치한다. 이번에 새 migration·리소스·권한 scope·확장 업데이트를 추가하지 않았다. 검증 manifest는 `outputs/step688-final-validation.json`이고, 58개 고유 파일/711개 고유 검사·미해결 실패 0 및 네이티브 80요청/78성공/의도한 ACK 손실 2회를 구분해 기록한다.

## 남은 범위

이번 범위는 고정 workspace photoId에 결합한 수동 편집/명시 OCR·번역 경로, 자체 결과·편집 문서의 독립 보관과 재열기, 별도 상품 pool 첨부 및 기존 명시 견적 적용 연결이다. 네이티브 수동 경로 통과만으로 실제 OCR·번역 provider의 품질이나 Couplus의 숨은 외부 편집 세션 동등성을 주장하지 않는다.

- 작업 문서에서 직접 최종 통합 PNG를 만들어 견적까지 적용하는 한 흐름은 아직 별도다. 기존 초안 채택·견적 저장·통합 상세 절차를 명시적으로 사용한다.
- 사용자 간격 UI와 배너 설정 변경 뒤 과거 문서의 명시적 reset/migration은 남아 있다. 현재 bounded imageMargin schema나 409 보존을 전체 기능으로 세지 않는다.
- 저장한 편집 문서 재열기는 지원하지만 미저장 브라우저 편집 초안의 무제한 영속 복구를 보장하지 않는다. 기존 큰 frozen view의 sessionStorage quota 한계도 남는다.
- 다른 새 photoId/옵션/문맥에 workspace 편집 세션을 복사하는 기능은 지원하지 않는다. 원본 reference의 의미도 이 작업 문서의 최초 선택 사진으로 한정한다.
- 전체 신규 SKU/이미지 수집·공식 카테고리 양식·실제 Supplier Hub 동의/접수번호/SKU 대조 및 전체 업무 pipeline 동등성은 별도다. 실제 Hub 접수나 모든 단계 완료를 주장하지 않는다. `SINGLE_DOCUMENT_LIVE_VERIFIED` 및 기존 gate 판정은 이번 기능으로 변경하지 않는다.
