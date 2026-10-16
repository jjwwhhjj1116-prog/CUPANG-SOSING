# Step689 — 보관한 작업 구성의 최종 상세 이미지 저장

2026-10-16. 저장한 workspace의 현재 사진을 직접 합쳐 공통·전체 옵션 상세로 저장하는 경로를 연결했다. **관련 고유 33파일 369개 검사**, 타입·lint·스키마·bounded 빌드 및 양 회사 격리 네이티브 capture의 오프라인 검증을 통과했다. 저장소 전체 테스트 실행을 뜻하지 않는다. **기존 무료 Worker 배포 완료**, version `7bac9a5f-c1ce-4169-b2cf-2b11cb3c5f26`다.

## 변경 결과

`보관 구성 합치기`는 마지막으로 보관한 workspace의 현재 사진을 순서대로 읽어 800px PNG 미리보기를 만든다. `보관 구성 PNG 다운로드`도 같은 현재 사진을 읽어 로컬 PNG를 준비하며 상품·견적·workspace를 저장하지 않는다. 생성 HTML을 실행하거나 원래 originKey로 되돌려 합치지 않는다.

전체 저장 범위 확인 checkbox와 `보관 구성으로 상세 저장`을 명시적으로 누르면 최종 PNG를 저장하고, 현재 category의 공통 항목과 **모든 실제 옵션**의 상세 이미지를 같은 최종 key로 바꾸며 견적 HTML은 `''`로 만든다. 견적 제외 옵션도 포함한다. 공통 ALT는 truthy이면 유지하고, 모든 옵션 ALT는 저장된 raw SEO 설명/상품명·한국어 옵션명 정책으로 다시 작성한다. 공백을 trim하거나 화면 label/SEO 제목으로 raw 이름을 바꾸지 않는다.

개별 workspace 결과가 아직 상품 pool 밖에 있어도 미리보기와 최종 저장을 할 수 있다. 임시 선택 옵션 quote PUT이나 별도 `편집 결과를 상품 이미지에 추가`가 선행 조건이 아니다. 최종 저장의 한 DB transaction 안에서 필요한 현재 사진 key와 최종 PNG key만 pool에 추가하고 공통·전체 옵션의 견적 수정값과 백업을 함께 갱신한다. 이전 Step688의 별도 명시 첨부/키 초안 채택 경로는 그대로다.

## 최종 이미지와 작업 문서의 분리

최종 이미지는 **폭800·흰 배경·padding0·사진 간격0**으로 이어 붙인다. 각 사진의 표시 방향을 반영한 크기를 사용하며 높이는 사진마다 `max(1, round(height×800/width))`를 더한다. editor generated HTML의 20px padding/760px 사진 폭/imageMargin을 최종 PNG에 적용하지 않는다. 사진 순서와 동일 파일의 중복 위치는 보존한다. 복수 보호 배너가 유효하면 모두 문서 순서대로 유지한다.

이 레이아웃은 보관 Couplus save의 별도 full-bleed HTML과 기능상 대응한다. 다만 vendor converter의 실제 MIME·높이 반올림·압축·색관리·픽셀은 미확인이다. 실제 자체 Canvas에서 검토한 PNG를 저장하는 정책을 vendor와 픽셀 단위로 같다고 표현하지 않는다. 근거는 [Step689 대조 감사](step689-workspace-composite-parity-audit.md)다.

독립 workspace 행과 사진 ID·origin/current key·role·생성 HTML은 최종 PNG로 치환하지 않는다. 최종 저장 당시 **전체 workspace record**를 backup에 별도로 보관하고, 순서 있는 실제 현재 입력과 최종 PNG·선택 옵션의 literal 저장 전 유효 HTML도 보관한다. historical snapshot을 증명할 수 있는 자료이며 과거 workspace를 UI에서 reset/migrate하는 기능까지 제공한다는 의미는 아니다.

## 권한·원자성·복구 경계

- 기존 `/detail-save`에 선택적 `workspace:{revision,digest}` proof를 추가했다. 이 opt-in은 기존 ALT text policy와 ordered-inputs HTML editor policy를 함께 요구한다. legacy body/receipt를 workspace 요청으로 조용히 해석하지 않는다.
- 현재 서버 workspace의 승인 member·회사·상품·선택 옵션·정확한 context/profile·현재 역할 및 실제 origin/current/base/sidecar를 확인한다. pool 밖 key는 그 workspace의 고정 photoId에 봉인된 현재 결과만 허용한다.
- `workspace-detail-composite-v1` uploadId는 상품·옵션·category/context·현재 fingerprint·workspace proof·순서 있는 source SHA/치수·800px/높이·최종 PNG SHA를 결합한다. 서버는 실제 source bytes와 업로드 PNG SHA/bytes/형식/폭/예상 높이에서 다시 계산한다.
- 최종 SQL 조건은 기존 raw source/member 조건과 현재 quote 원문 및 정확한 workspace row payload/revision/requestId/updatedAt을 함께 검사한다. pool append·quote 범위 변경·before/receipt/editor/workspace backup이 같은 guarded transaction에 속한다. workspace 한 행 자체는 갱신하지 않는다.
- 기존 raw before는 공통·옵션별 canonical/primary 연결의 부재(null)와 명시 공란을 구분한다. 현재 category 이외의 override/packaging/before history·원천 content/options/labels·option identity와 기존 파일을 유지한다. 카테고리별 백업 5개/전체 quote payload 512KiB 한도는 기존 자료를 삭제하는 대신 쓰기를 거부한다.
- preview와 다운로드는 quote/workspace를 입력 파일 조회 전후 재확인한다. 선택 견적 이미지가 공란이어도 별도로 검증한 workspace source를 사용할 수 있다. readOnly·대상 schema·전체 옵션·동적 연결은 최종 plan에서 검사한다.
- 검토 checkbox는 정확한 PNG·workspace·view·화면 세대에 결합된다. source/옵션/profile·active/disabled ABA·dirty/peer I/O 전환 뒤 과거 승인을 재사용하지 않는다. 부모의 현재 초안과 보호 역할을 다시 검사한다.
- 저장 후 확인 실패는 workspace 경로에서 503으로 유지한다. ACK 유실에는 upload receipt/detail-save GET 및 실제 파일·견적을 읽어 확인하고, 자동 업로드/저장 POST를 하지 않는다. 이전 receipt를 확정할 수 없으면 별도 최신 구성 읽기 경로가 있으며 과거 요청 성공 여부를 단정하지 않는다.
- 미리보기·미확정 저장 동안 부모 사진/HTML/workspace 작업을 잠그고, 늦은 callback이 다른 화면·초안에 결과를 덮어쓰지 않게 한다. 저장 후에는 최신 부모 견적과 그대로 남은 workspace를 다시 열 수 있어야 한다.

## 구현 파일

| 책임 | 파일 |
| --- | --- |
| workspace current source 검증·준비·download 자료·apply/recover | `app/detail-workspace-composite-client.ts` |
| 기존 렌더러의 full-bleed sequence 재사용 | `app/detail-image-composite.ts` |
| 기존 upload/save/recovery의 workspace proof·full snapshot 검증 | `app/detail-save-client.ts` |
| receipt proof·full record backup 타입과 공통/전체 옵션 plan | `app/detail-save-plan.ts` |
| 실제 source/PNG/현재 workspace·member·backup API 검증 | `app/api/products/[id]/detail-save/route.ts` |
| 원천/member·정확한 workspace CAS 및 pool/quote/archive transaction | `db/quotation-fields.ts` |
| 명시 preview/download·전체 범위 승인·저장/복구 UI | `app/components/detail-workspace-composite-panel.tsx` |
| 독립 workspace·부모 옵션 이미지 편집기의 잠금/최신 결과 연결 | `app/components/detail-workspace-panel.tsx`, `app/components/option-image-editor.tsx` |

독립 검토에서는 old quoted input이 공란일 때 workspace 렌더가 불필요하게 막히던 연결을 보고했고 root가 workspace 전용 whole-view 검증으로 분리했다. 최종 동결 route/plan/DB guard·root client/renderer·UI 9파일의 narrow 정적 검토에서 새 차단 문제는 발견하지 못했다. `outputs/step689-independent-review.json`에 실제 hash를 기록했으며 최종 route SHA256은 `11a6ec08f43175a90cb2892d62d79e9a1febe06c1b443809291c3106d3472f70`다. closed workspace proof의 JSON key 순서가 달라도 revision/digest 의미로 비교하는 수정도 포함한다. 정적 검토는 실행 성공 증거가 아니며 최종 capture sourceHashes가 검토 당시 소스와 다르면 자동 확대하지 않는다.

## 최종 관련 검사

| 검사 | 현재 상태 | 근거 |
| --- | --- | --- |
| root 실제 client→API | 1파일 8개 통과. 빈 선택 견적·ACK 복구·full snapshot 포함 | `outputs/step689-workspace-client.log` |
| 전체 타입 | 최종 exit 0 | `outputs/step689-final-types.log` |
| focused lint | 최종 변경 앱/테스트 15파일 exit 0 및 별도 UI helper 1파일 exit 0. error/warning 0 | `outputs/step689-final-lint.log`, `outputs/step689-final-lint-files.json`, `outputs/step689-ui-helper-lint.log` |
| backend 타입/lint | 동결 source 검사 exit 0 보고 | `outputs/step689-backend-types.log`, `outputs/step689-backend-lint.log` |
| 신규 backend API | 고유 1파일 9개 통과. 초기8통과/fixture1실패 후 영향3개 재검사 모두 통과, 기존2개 중복 제외 | `outputs/step689-workspace-detail-save-api.log`, `outputs/step689-workspace-detail-save-repaired.log` |
| UI/부모 연결 | 7파일 56개 통과 = 신규 child10+부모3 및 기존43 | `outputs/step689-final-validation.json`의 실제 파일 목록 및 담당자 실행 보고 |
| 관련 legacy 회귀 | **24파일 296개 통과 / 0실패, duration 500,434.3894ms** | `outputs/step689-regression.log`, `outputs/step689-regression-files.json` |
| bounded 운영 빌드 | exit 0. 빌드 자체는 배포하지 않음 | `outputs/step689-build.log` |
| 스키마 | 44 tables / 17 indexes / 29 runtime modules. fresh/repeated 메모리 검사 exit 0 | `outputs/step689-schema.log` |
| 최종 중복 제거 집계 | **고유 33파일 369개 통과 / 미해결 실패 0** = legacy296+UI56+client8+API9 | `outputs/step689-final-validation.json` |

root의 legacy 부분 실행34개는 296개에 들어 있어 다시 더하지 않는다. API ACK 손실 주입기의 범위를 좁힌 test-only fixture 보강 후 영향3개가 통과했으며 그중2개는 최초 통과와 겹치므로 API 고유 수는9다. 이를 처음부터 한 번에 깨끗한9개 실행이었다고 표현하지 않는다. 앱 sourceFrozen은 유지했다. 기존 Step688 결과를 신규 고유 검사로 다시 세거나 저장소 전체 테스트 완료라고 주장하지 않는다. 이 문서 작성 agent는 테스트를 중복 실행하지 않았다.

## 격리 네이티브·오프라인 검증

root가 허용된 자체 localhost 3689 화면에서 양 회사의 실제 React/HTTP·격리 SQLite/R2 흐름을 완료했다. 구성 rev1→current key1 교체/다른 body 제거 rev2→수동 문구·bold·780×70 crop 편집 rev3→원래 800×90 base/doc 재열기→실제 다운로드 버튼·800×262 Canvas 미리보기 GET-only→checkbox와 전체 상세 저장 1회→부모 최신 조회 및 같은 회사 reload·작업 문서 3장 재열기 흐름이다. 와이홉 문구는 `와이홉 최종 상세 검수`였다. 재열기에서 crop control을 표시하며 dirty가 되어 보통 닫기를 막은 뒤 명시적인 최신 구성 GET escape로 나왔고 추가 사진 apply는 하지 않았다. 저장된 workspace는 그대로다.

`outputs/step689-native-verified.json`은 **PASS, sourceFrozen:true**다. capture의 모든 sourceHashes가 검증 시점 소스와 일치했다. 실제 HTTP **117회 중 116회 성공 / 의도한 ACK 503 1회**이며 서버 commit 원본 ACK 1개는 별도 보존하고 synthetic client 응답과 중복 계산하지 않았다.

| 회사 | 실제 저장·복구 결과 |
| --- | --- |
| 와이홉 A01464742 | workspace PUT2·사진 apply1·최종 PNG upload1·atomic detail-save1 완료. 중간 quote PUT/별도 attachment POST는0. final image1/빈 HTML과 원래 구성3장으로 reload/재열기. |
| 유앤채 A01526306 | 동일 흐름 완료. detail-save는 실제200 commit 후 client ACK503을 주입하고 GET recovery로 확인했다. 두 번째 upload/detail-save POST 없이 최종 image1/빈 HTML과 구성3장으로 같은 회사 reload/재열기. |

회사별 44-table snapshot에서 관련 없는 **41개 테이블은 불변**이다. workspace 저장/apply는 workspace만 바꾸고, 최종 detail-save는 product의 필요한 pool/clock/status와 quote payload만 갱신한다. 최종 저장의 workspace 행은 원문 그대로다. 기존 **R2 25개(사진23+기존 sidecar2)**의 SHA/bytes/metadata가 그대로이며 새3개는 G PNG+그 편집 sidecar+최종 PNG다. 현재G와 최종PNG만 pool에 추가하고 원래 source·과거 파일은 삭제하지 않았다.

공통+실제6옵션(제외 옵션 포함) 총7 scope의 canonical/primary 이미지·빈 HTML·raw ALT 규칙과 다른 필드/카테고리·상태 보존을 확인했다. quote revision은 한 번만 증가했고 full workspace record·순서 있는 source SHA/치수·literal 저장 전 HTML의 공백/CRLF·raw null 대 공란 before를 함께 archive했다. 실제 API/DB 전체 quote state를 재구성해 다른 scope·기존 history·packaging 등도 대조했다.

`outputs/step689-native-verify.mjs`는 실제 HTTP/DOM·mutating 요청별 table 전후 snapshot·R2 bytes를 오프라인 검사했다. 최종 폭800·높이262와 보호 strip 경계·현재 source의 오른쪽 edge pixels를 비교해 여백 없는 배치와 origin 대신 current 사용을 확인했다. 브라우저와 다른 renderer의 전체 픽셀 동일성은 주장하지 않는다. DOM phase 경계로 다운로드/준비 각각 GET200만 수행하고 실제 source pixels를 읽은 것을 확인했다. 다운로드 버튼의 실제 local Blob 전달과 상태 문구를 확인했으며 별도 디스크 저장 경로 검증으로 확대하지 않는다.

최종 근거는 `outputs/step689-native-proof.json`, `outputs/step689-native-dom-proof.json`, `outputs/step689-native-verified.json`이다. 최초 verifier는 `/api/files`의 정상 Created201을200으로 가정한 assertion에서 멈췄다. 실제 기록과 API 계약에 맞게 해당 assertion만201로 바꾸고 다시 실행해 exit0/PASS였다. 앱이나 원본 capture는 바꾸지 않았다. 실행 명령은 다음과 같고 이 agent는 브라우저·서버·HTTP·provider를 제어하지 않았다.

```powershell
& 'C:/Users/7500F/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' 'outputs/step689-native-verify.mjs'
```

양 회사 모두 스크린샷은 CDP `Page.captureScreenshot` 5,000ms timeout으로 없으며 `screenshotsComplete:false`다. DOM·HTTP 검증을 이미지 캡처 성공으로 표현하지 않는다. root가 소유 native 탭727931908을 닫고 서버 session37481을 Ctrl+C로 종료했으며 3689 포트 Listen0을 확인했다. 공유 기존 업무 탭은 정리 대상이 아니었다.

## 배포와 남은 범위

새 DB migration/테이블은 없다. 기존 무료 Worker <https://sourceflow.jjwwhhjj1116.workers.dev/>에 배포 완료했다. 배포 명령 exit0, version `7bac9a5f-c1ce-4169-b2cf-2b11cb3c5f26`이며 `outputs/step689-deploy.log`와 일치한다. 새 리소스·권한 scope·확장 업데이트는 없다. 검증 manifest는 `outputs/step689-final-validation.json`으로 관련 고유33파일369개·미해결 실패0과 실제 네이티브 capture의 결과를 구분해 기록한다.

- 전체 workspace historical reset/migration UI, 배너 설정 변경 뒤 명시적 재기준화와 사용자 spacing UI는 별도다.
- 저장한 현재 사진·작업 문서·literal HTML/수동 before를 보존하는 기능이며 vendor 외부 OCR/번역 세션 전체나 converter 픽셀 재현이 아니다.
- provider 품질·실제 Couplus/Hub 계정 동작·Supplier Hub 동의/접수번호/SKU 대조·전체 신규 상품 수집 및 모든 업무 단계 완료는 검증하지 않았다. `SINGLE_DOCUMENT_LIVE_VERIFIED` 및 기존 gate를 이번 기능으로 바꾸지 않는다.
