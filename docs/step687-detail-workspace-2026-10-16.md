# Step687 — 견적서와 분리된 상세 편집 구성

2026-10-16. 앱 소스 동결 후 전체 회귀·타입·lint·빌드·스키마와 격리 네이티브 불변 검증을 마쳤다. 운영 마이그레이션 0027 적용과 기존 무료 Worker 배포를 완료했다.

## 변경 결과

상세 사진을 최종 견적서에 먼저 반영하지 않고, 사진 순서·역할·최초 선택 사진의 연결과 현재 결과를 별도 작업 문서로 보관하고 다시 열 수 있다. `상세 편집 구성 열기`는 명시적인 읽기이며, 본문 사진을 이동·추가·제거하거나 상품에 이미 저장된 사진으로 교체한 뒤 `편집 구성 보관`을 누른다. 이 보관은 상품과 견적서의 이미지·HTML·ALT를 바꾸지 않는다.

저장한 구성을 사용할 때는 `작업 사진을 선택 옵션 초안으로`를 명시적으로 누른다. 현재 파일과 저장 증거를 다시 확인하고 사진 키와 순서만 기존 옵션 편집기의 로컬 초안으로 전달한다. 기존 수동 견적 HTML은 공란까지 유지한다. `선택 옵션 이미지 저장`을 누르기 전에는 실제 견적서를 바꾸지 않는다. 최종 통합 PNG 생성·전체 상세 저장은 기존 별도 검토 절차를 따른다.

새 생성 HTML은 작업 문서의 현재 사진 구성에서 만드는 별도 자료다. 고정 800px wrapper/20px padding과 760px 사진으로 생성하고 텍스트로만 조회한다. 이를 실행하거나 견적 HTML에 자동 입력하지 않는다. Step686의 **저장 전 유효 견적 HTML 원문 snapshot**도 별도 자료로 유지한다. 이번 생성 HTML을 과거 vendor root HTML 원문이라고 부르지 않는다.

## 저장·권한·복구 경계

- 새 `product_detail_workspaces` 테이블에 상품·선택 옵션·정확한 카테고리 문맥별 문서를 저장한다. scope는 source/profile/category/path 전체의 정규 SHA로 나눈다. 같은 category 코드나 URL만으로 다른 문서·상품·fork·가족을 연결하지 않는다.
- 사진은 고정 ID, originKey, current key, top/body/bottom 역할을 가진다. 새 위치는 originKey=current key에서 시작하고, 한 번 저장한 live ID의 최초 연결과 역할은 바꿀 수 없다. 같은 파일의 반복 위치는 서로 다른 ID로 보관한다. 사진 제거가 원본 파일 삭제를 실행하지 않는다.
- originKey는 **이 작업 문서에서 처음 선택한 사진**이다. 최초 수집 원본이나 현재 결과가 그 파일에서 변환됐다는 의미를 자동 부여하지 않는다. 교체는 현재 상품의 실제 소유 파일 목록에서 명시적으로 선택한다.
- 원본 연결과 현재 결과의 실제 SHA·bytes·표시 치수, 전체 읽기 용량, 정규 문서 digest를 검증한다. 승인 회사·실제 DB 회원과 전체 원천 원문 및 이전 작업 행의 CAS가 SQL 저장 조건에 들어간다. 독립 문서 저장은 견적/상품/content/options/labels 행을 갱신하지 않는다.
- 상단→본문→하단 순서를 검사하고 보호된 행의 ID·원본·현재 key·역할을 유지한다. 현재 상하단 역할 증거가 저장된 문서와 다르면 409로 거부하고 JSON은 보존한다. 과거 배너를 현재 설정으로 조용히 바꾸거나 filename으로 역할을 추정하지 않는다.
- 저장 응답이 불명확하면 pending 문서를 session에 유지하고 GET으로 먼저 확인한다. 같은 이전 문서와 전체 원래 견적 view가 확인된 경우에만 같은 requestId·문서의 명시적 retry를 준비한다. 자동 PUT은 하지 않는다.
- 미커밋 문서는 같지만 unrelated 원천 view가 바뀌었으면 GET으로 최신 기준을 확인해 새 보관을 준비하고 다시 저장 클릭을 받는다. 손상된 로컬 receipt에는 명시적인 최신 구성 GET 복구 경로가 있다. 늦은 응답·scope/active/disabled 전환은 현재 초안이나 성공 표시로 채택하지 않는다.
- 작업 I/O/미확정 결과는 부모의 사진·HTML·통합 이미지 동작을 잠근다. 초안 채택은 부모의 최신 상품/옵션/프로필·배너 증거·dirty 상태를 다시 검사하고 키만 전달한다.

## 구현 파일

| 책임 | 파일 |
| --- | --- |
| 문서 schema·생성 HTML·정규 identity/digest | `app/detail-workspace.ts` |
| 실제 파일·회원·원천 검증과 독립 행 CAS | `db/detail-workspaces.ts` |
| 명시적 GET/PUT API | `app/api/products/[id]/detail-workspace/route.ts` |
| 읽기·보관·GET 복구·초안 채택 검증 | `app/detail-workspace-client.ts` |
| 구성 편집·보관·재열기 화면 | `app/components/detail-workspace-panel.tsx` |
| 기존 옵션 편집기의 잠금·키 초안 연결 | `app/components/option-image-editor.tsx` |
| 별도 테이블의 additive migration | `db/migrations/0027_detail_workspaces.sql` |

초기 네이티브 검수에서 두 sibling 컴포넌트가 같은 React key를 사용하던 문제가 확인되어 `workspace:${scope}`와 `composite:${scope}`로 구분했다. 현재 파일에서 두 prefix를 확인했다. 최종 `OptionImageEditor` SHA256은 `feba75189f875f3725bbc443f7126e2065fe2f51e74f40d3806b44ed32f53223`이며 최종 네이티브 서버의 `sourceHashes`와 일치한다. 최초 key 실패 자료는 보존하고 수정 전 실행을 성공 사례로 세지 않는다.

보관 Couplus 근거와 기능상 한계는 [정적 대조 감사](step687-detail-workspace-parity-audit.md)에 있다. 최종 네이티브 sibling-key 수정 전의 읽기 검토 manifest는 `outputs/step687-independent-review.json`이다. 해당 manifest의 옵션 편집기 SHA를 최종 prefix 수정본의 SHA로 오인하지 않는다. 최종 검수 source set은 `outputs/step687-native-proof.json`의 frozen hash 목록을 따른다.

## 현재까지 확인한 검증

| 검사 | 현재 상태 | 근거 |
| --- | --- | --- |
| 전체 타입 검사 | exit 0 | `outputs/step687-final-types.log` |
| 변경된 소스·테스트 13개 focused lint | exit 0 | `outputs/step687-final-lint.log` |
| bounded 운영 빌드/산출물 검사 | exit 0, 배포 실행 없음 | `outputs/step687-final-build.log` |
| 스키마 | 44 tables / 17 indexes / 29 runtime modules 일치. fresh/repeated 메모리 검사 통과 | `outputs/step687-schema.log` |
| backend 모델/API | 담당 worker의 18개 통과 보고 | `outputs/step687-workspace-backend-final.log` 및 model/context/banner 로그 |
| client/panel 및 실제 client→API 연결 | 담당 worker의 28개 통과, 양 회사 연결 통과 보고 | `outputs/step687-workspace-client.log` 및 관련 개별 검사 |
| 부모 옵션 편집기 연결 | 5개 통과 보고 | `outputs/step687-option-integration.log` |
| 관련 전체 회귀 | **29개 파일, 고유 347개 통과 / 실패 0. duration 520,119.7403ms** | `outputs/step687-final-tests.log`, `outputs/step687-final-test-files.json` |

이 문서 작성 agent는 위 테스트를 중복 재실행하지 않았다. root가 확인한 최종 실행 결과와 담당 worker의 검사 근거를 반영했다. 전체 회귀는 한 실행의 고유 347개이며 부분 검사 결과를 다시 더하지 않는다.

## 격리 네이티브 검수 결과

root가 허용된 자체 Chrome 2의 새 localhost 3687 검수 탭에서 실제 React 화면·HTTP API·메모리 SQLite/파일 저장소를 사용했다. 실제 운영 상품·외부 계정·OCR/번역 provider는 사용하지 않았다. 다른 채팅의 Couplus/Hub/1688 탭은 검수 대상이 아니었다.

검수 절차는 회사별로 구성 rev1 보관 → 닫고 재열기 → 본문 순서 변경/기존 결과 key 교체/삭제 → rev2 보관 → 사진 키만 옵션 초안에 채택 → 명시적인 견적 PUT 1회 → 새로고침/재열기다.

| 회사 | 확인한 결과 |
| --- | --- |
| 와이홉 A01464742 | 위 흐름 완료. 새로고침 후 최신 부모 저장본으로 구성 rev2를 재열었다. |
| 유앤채 A01526306 | 위 저장·초안·명시 견적 PUT 흐름 완료. 첫 구성 PUT은 실제 commit 200 뒤 client ACK만 503으로 주입했고 GET-only로 확인했으며 자동 재PUT하지 않았다. 검수 fixture 새로고침은 와이홉을 기본 선택했으므로 회사 선택기를 명시적으로 유앤채로 바꾸고 읽기 전용 최신 부모 조회 후 rev2를 재열었다. 자동 유앤채 새로고침이 성공했다고 표시하지 않는다. |

`outputs/step687-native-verified.json`의 최종 offline 검증은 **PASS**다. 실제 HTTP 48회 중 47회 성공, 1회는 의도한 유앤채 ACK 503이다. 회사별 workspace PUT 2회와 견적 PUT 1회를 확인했다. 구성 조회·검증·키만 초안에 채택하는 단계는 GET만 사용하며, 독립 구성 저장 중에는 견적/상품이 바뀌지 않는다.

회사별 44개 테이블 중 관련 없는 41개 테이블, 기존 R2 파일 25개와 메타데이터가 그대로다. UI image pool의 사진 23개와 편집 문서 sidecar JSON 2개를 구분해 계산했으며 이를 사진 25장으로 세지 않는다. 사진 ID·최초 연결·역할, 기존 literal 견적 HTML의 공백·CRLF를 정확히 보존했고 명시 견적 PUT은 선택 옵션의 사진 키와 순서만 바꿨다. 사진을 옮긴 단계에서 generated HTML을 견적 HTML로 복사하지 않았다.

근거는 `outputs/step687-native-proof.json`의 실제 요청/원문/서버 시작 hash, `outputs/step687-native-dom-proof.json`의 DOM 자료, `outputs/step687-native-verified.json`의 최종 불변 검증이다. 검수 서버는 최종 prefix 수정 소스로 준비됐고 `sourceFrozen:true`를 기록했다. CDP 스크린샷은 두 회사 모두 5,000ms timeout으로 확보되지 않았다. `screenshotsComplete:false`이며 DOM·요청 증거를 화면 캡처 성공으로 표현하지 않는다.

소유 검수 탭은 닫았고 로컬 서버 session 30519는 Ctrl+C로 종료했다. 3687 포트 Listen 0을 확인했다. 공유된 기존 업무 탭은 정리 대상에 포함하지 않았다.

## 마이그레이션·배포 상태

`0027_detail_workspaces.sql`은 운영 원격 DB에 적용 성공했다. 근거는 `outputs/step687-migration-apply.log`다. 스키마 checker 자체는 fresh/repeated 메모리 검사만 수행했으며 원격 적용은 별도의 명시적 migration 실행이다.

기존 무료 Worker <https://sourceflow.jjwwhhjj1116.workers.dev/>에 배포 완료했다. 배포 명령 exit 0, version `65deb039-6ef2-46b2-8b03-0f2f8eaf9fd0`. 근거는 `outputs/step687-deploy.log`다. 새 리소스·유료 요금제·OAuth·확장 업데이트는 없다.

## 남은 범위

이번 범위는 독립 문서의 사진 구성·현재 결과 파일 선택·생성 HTML 보관과 명시적 키 초안 채택이다. 다음 기능은 아직 완료하지 않았다.

- 작업 문서 photoId에 직접 결합한 OCR/번역·수동 text/style/crop/brush 편집 및 그 기록의 직접 채택.
- 문서에서 곧바로 최종 PNG를 생성·견적 적용하는 한 작업 흐름. 현재는 기존 옵션 초안 저장/통합 이미지 절차를 명시적으로 거친다.
- 사용자 간격 조절 UI. bounded imageMargin schema와 생성 HTML이 있다는 사실만으로 화면 조절 기능을 완료했다고 하지 않는다.
- 배너 설정 변경 후 과거 문서의 명시적 reset/migration. 현재는 409로 보존하며 자동 변환하지 않는다.
- 대규모 옵션에서 전체 frozen view를 보관한 sessionStorage가 브라우저 quota를 넘을 수 있다. 이 경우 PUT 전에 실패해 로컬 작업은 유지하지만 영속 pending 복원을 준비하지 못한다.
- 현재 회사 객체는 canonical key 순서를 전제로 엄격 비교한다. 의미가 같은 reordered 응답도 거부할 수 있으나 닫힌 자체 API는 canonical 응답을 내보내며 이를 위해 저장 값을 조용히 변환하지 않는다.
- 전체 신규 SKU·이미지 수집과 전 카테고리 공식 양식 검증, 실제 Supplier Hub 동의·접수번호/SKU 대조.

Couplus 전체 동등 구현이나 실제 접수 완료를 주장하지 않는다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`와 운영 전송 gate는 유지한다. 임의 완료율·스크린샷 확보·미실행 provider 결과를 표시하지 않는다.
