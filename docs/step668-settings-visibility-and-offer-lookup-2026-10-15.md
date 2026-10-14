# Step668 — 이미지 번역 설정 표시와 상품번호 조회 인덱스

Step667 commit `76b163940aff74c7c2b461426719f4f0c7dc4ff4`에서 이어서 기본설정의 확인된 조건부 표시를 맞추고, 수집 요청의 누적 이력 조회를 개선했다. 기존 쿠플러스 작업 상품과 운영 상품 내용은 수정하지 않았다.

## 쿠플러스에서 확인한 설정 동작

보존된 UI bundle의 이미지 번역 프롬프트는 `translateImages` 조건 안에 있다. UTF-16 [306296,306930), UTF-8 [332697,333491), SHA256 `b9bf25470c7f7cecbf2b068a8110110483b0b9174c3a445804fdd85359893afd`. 카피라이트도 같은 조건이며 UTF-16 [306931,307424), SHA256 `3aef2712b157b53ed796fb9802f979d266d411611d7a3d5efa5cb3f1539b8937`. 누끼 자동 적용은 그 조건 밖에 표시된다(UTF-16 [307425,307902)).

`initializeSettings` [313472,314604)는 저장 설정을 recursive deep clone한다. 이미지 checkbox callback은 해당 초안 boolean만 변경하며 프롬프트·카피라이트 값을 지우지 않는다. 검토한 watcher [312792,312906)는 `storeSettings.useIntegratedRate`에만 반응한다. 저장 버튼이 호출하는 `saveSettings` [315112,318057)는 전체 설정을 `/api/savesetting`에 전달하며 번역 OFF를 이유로 숨긴 값을 초기화하지 않는다. 이 범위의 정적 근거이며 실제 원본 저장 요청을 실행하지 않았다.

REA parent `ev_bc28ce3f2ffa700fce520a3778b217e98b26fa54d6c52b5e32256504b970a90e`, summary `ev_0a8c0c533d59642c64d329ef4f41eea956f6b36a05fa358c866caa241ccba364`. Parse failure0/semantic unknown180. 원본 digest·UTF8 범위·선택 근거는 ignored `outputs/step668-settings-condition-audit/source-manifest.json`에 있다.

앱에서는 프롬프트 입력만 무조건 표시되고 있었다. `draft.translateImages` 조건으로 표시하게 했다. 기존 카피라이트 조건과 독립적인 누끼 설정은 유지한다. 프롬프트·카피라이트 값을 지우는 코드는 추가하지 않았다. 저장·취소·owner scope·가격 산식·상품 변경 규칙도 유지한다.

## 수집 요청 조회 개선

`enqueueCollection`의 과거 offer claim 연결은 owner·offer·awaiting status로 이력을 찾고 최신 created_at/id를 고른다. 0017에서 과거 partial unique index를 폐기한 뒤 남은 index는 owner/time 또는 owner/source URL이었다. 새 URL miss의 실행 계획은 owner 기준 검색이므로 이력이 늘면 같은 계정의 이력을 더 훑는다.

실제 앱이 생성한 SQL을 사용한 로컬 SQLite3.45.1 검사에서 계정당 이력1000→10000일 때 miss의 VM operations는5101→50101이었다. 비고유 `(owner_id, offer_id, status, created_at DESC, id DESC)` index를 추가하면116→116이었다. 기존 offer·이미 claimed offer의 결과도 같았다. 이는 SQLite progress-handler VM 작업 수이며 D1 rows_read 측정값이 아니다. 운영 이력 수나 Step660 quota 소진의 실제 원인으로 단정하지 않는다. 근거는 ignored `outputs/step668-d1-query-audit/explain-report.json`.

`idx_collection_owner_offer_status_created`를 runtime ensure와 additive `0023_collection_offer_lookup.sql`에 동일하게 추가했다. `IF NOT EXISTS` 비고유 index이며 기존 query·status·회사 조건·최신 순서·claim 고유성은 바꾸지 않았다. 과거 unique index 폐기도 유지한다. 같은 offer의 여러 과거 이력과 soft removal/resourcing/restore 규칙을 유지한다.

## 검증

최종14파일 **100/100 통과**, 실패·취소·skip0. 설정55개와 DB45개는 이100개에 포함되며 중복 합산하지 않는다. 기존 설정 UI 검사에 프롬프트 숨김과 재활성화 시 값 복원 단언을 추가했다. 신규 offer lookup4개는 실제 emitted SQL·EXPLAIN·두 회사 owner 범위·새 URL·기존 claim·최신 이력·비고유성·반복 migration·전체 행 보존을 확인한다.

최초 DB 실행의 실패3개는 0023 추가에 따른 고정 migration 목록1개와 기존0017-vs-current runtime baseline2개였다. 0017의 기존 행·상태·원문·receipt/link 보존 단언을 유지하고, 이후 additive migrations 전후 모든 기존 행을 추가로 비교한 후 최신 runtime과 비교하게 했다. 최신37테이블·17인덱스에 맞춰 고정 기대값을 갱신했다. 검사를 단순히 삭제하거나 뜻밖의 테이블을 무시하지 않았다.

독립 읽기 검토에서 actionable 회귀 없음. 전체 타입 exit0, 변경6파일 lint exit0, schema checker exit0(37 app tables/17 named indexes/25 runtime modules), bounded build exit0. 기존 vinext route classification 경고는 남아 있다. 로그: ignored `outputs/step668-final-tests.log`, `step668-final-types.log`, `step668-final-lint.log`, `step668-build.log`, `step668-d1-query-audit/schema-check.log`.

기존 Chrome3에서 실제 `WorkspaceSettingsDialog/Editor`, 설정 API와 임시 SQLite의 두 fixture 회원 session을 사용했다. 번역OFF→숨김→ON→값 복원, OFF 저장→재열기→ON 복원, 미저장 누끼 변경 취소를 확인했다. 와이홉은 직접 수정한 multiline 지침·카피라이트ON, 유앤채는 공란 지침·카피라이트OFF가 각각 유지됐다. DOM22조건과 나머지 등록·가격·이미지 설정66필드 보존을 확인했다. 실제 API6요청(4GET/2PUT), 회사별 명시 저장1회, 취소 추가PUT0이었다.

실제 회원 로그인·운영 설정·1688·Hub·이미지 업로드·제공자 호출 검수는 아니다. 최초 자료의60초 session이 만료되어 로컬 fresh DB의 fixture session만30분으로 바꾸고 최종 실행을 새로 검수했다. 운영 인증은 변경하지 않았다. `outputs/step668-settings-native-proof.json`, `-dom-checks.json`, `-report.json`에 근거를 보관했다. Screenshot1회는5초 timeout이므로 이번 PNG 성공 파일이 없다. 자체 탭·서버만 닫고 사용자 탭은 유지했다.

## 운영 반영과 남은 검수

기존 무료 D1의 DB binding에 **0023의 CREATE INDEX 하나만** 실행해 success=true/exit0를 받았다. SQL은 데이터 UPDATE/DELETE·고유 제약 변경을 포함하지 않는다. Cloudflare 응답 meta는 changes1, rows_read6, rows_written3, attempts1이었다. 운영 상품 SELECT를 통한 우회 readback은 하지 않았다. raw index SQL 실행이므로 migration ledger의0023 등록을 주장하지 않으며, 이후 migration 실행은 IF NOT EXISTS로 안전하다. 로그 `outputs/step668-index-remote.log`.

기존 무료 Worker 배포 exit0, Version `c9f47c1e-9d46-49c7-8eb4-fef0f70d8021`, 주소 `https://sourceflow.jjwwhhjj1116.workers.dev/`. 새 DB·유료 resource·계정 권한·인증 변경·확장 업데이트는 없다.

Step660에서 관찰한 D1 Free 조회 한도의 reset은2026-10-15 09:00KST다. 이번 index 유지보수 성공을 quota 해제나 실상품 완주 성공으로 해석하지 않는다. prepared extension0.2.72/마지막 확인 installed0.2.64, SINGLE_DOCUMENT_LIVE_VERIFIED/운영 mutation gate=false 유지. 통합통관 환율 자동 공급의 비공개 provider 연결, 실제 새1688 URL 전체SKU/이미지, 모든 category/form/default와 남은 단계 UI, Hub 동의·최종 접수·receipt/SKU 대조는 미완료다. 이전 URL 접근 거절을 다른 도구로 우회하거나 기존 작업 상품을 수정하지 않는다.
