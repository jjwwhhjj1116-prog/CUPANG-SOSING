# Step658 — 실제 등록 파일 ID와 접수 상태 연결

2026-10-14. Step657의 접수 정적 분석에 따라 concrete receipt GET을 구현했다. 기존 실상품을 수정·삭제·불러오기·전송하거나 1688에 접근하지 않았다. 실제 서비스의 새 문서 접수 성공이나 전체 쿠플러스 동일 구현 완료를 주장하지 않는다.

## 구현한 조회와 판정

최종 확인 뒤 자기 새 문서에 저장한 제출 요청 기록이 있을 때만 GET `/sr/draft/api/drafts/register-requested`를 허용한다. 제출 전 문서번호·상품명·카테고리·버전·본문 digest·요청 ID·시각을 기록한다. 이 기록은 누르기 전의 의도이며 실제 native POST 본문·서버 ACK 관찰을 뜻하지 않는다. POST 응답이 유실되더라도 제출을 다시 누르지 않고 fresh 결과 목록만 조회한다.

조회는 원래 앱의 현재 회원·회사·저장본과 Hub의 회사·탭·창·최상위 프레임·브라우저 document UUID·활성 문서 관찰이 전후 일치해야 한다. 요청은 GET·same Hub origin·no-store·redirect error이며 본문은 없다. 성공 응답의 정확한 URL·JSON Content-Type·HTTP200·직접 배열을 확인한다. 원문은6MiB, 목록은10,000행 이하로 제한하고 자기 새 docId의 유일한 행만 상품명·카테고리와 대조한다. 이전 작업 문서는 후보가 아니다.

원문의 `qvtRequestId`를 등록 파일 ID로 보존하고 `receiptId` alias와 자료형까지 일치시킨다. `SUBMITTED`는 처리 중, `REJECTED`는 반려, `FINISHED`는 등록 파일 처리 완료로 분리한다. 세 경우 모두 SKU 관계를 추정하지 않으며 `registered/success=false`다. 화면에는 문서 ID와 등록 파일 ID를 별도로 표시하고 완료 시 SKU 확인 전임을 명시한다. 반려 오류의 원문 remark 스키마는 확인되지 않아 임의 오류 배열을 만들지 않는다.

빈 목록, 다른 문서, 중복·타입이 바뀐 ID, 알 수 없는 상태, 생략된 파일 ID, wrapper·HTML·redirect·오류 응답은 성공으로 표시하지 않는다. 이미 확인한 등록 파일 ID의 교체, 더 오래된 관찰, 완료에서 처리 중으로의 역행은 기존 증거를 보존하고 조회 오류로 처리한다. Core 저장 기록과 앱 표시 양쪽에서 이를 검사한다. 읽기 조회 실패를 새 쓰기 요청의 응답 유실로 오인하지 않는다.

Worker 교체·브라우저 문서 변경으로 현재 관찰이 없으면 복구를 허용하지 않는다. 이번 범위는 같은 활성 관찰의 GET 복구이며, restart 뒤의 새 접수 수용이나 native 최종 요청 관찰을 구현했다고 주장하지 않는다. 기존 실전송 gate는 false다.

## 근거와 한계

현재 Hub bundle SHA-256 `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`과 보관한 REA Evidence `ev_7bccb57e05307a52efc7ae3b1f8a61f5f96ef3cd32e29faeaf569b4b78483157`, `ev_eec07247224a1bfd75967f307b1af673ddf3399ec2b5ad64c355a6073e0f1f48`, `ev_ad6079002eb8e54c2ffb2aec03b1f4cc27263deb155f0890f033a046182418a8`를 재사용했다. 범위/hash는 Step657 기록과 로컬 `outputs/step658-single-receipt-unit.md`에 연결했다. 별도 현재 라이브 응답을 관찰한 것은 아니다.

getRequests `[2868035,2868195)`와 K4 `[4153982,4159515)`는 직접 배열과 docId/status/qvtRequestId 등을 소비한다. 빈 응답 때 기존 표가 남고, 복사 지원이 없으면 파일 ID의 fallback 텍스트가 보일 수 있어 DOM 완료 문구·표만으로 성공 판정하지 않는다. 다른 retail SKU 검색과 docId/qvtRequestId의 join은 여전히 확인되지 않았다. 서버 timestamp·미발급 파일 ID의 실제 사례도 남아 있다.

## 검수와 배포 자료

최종 Single 검사318/318과 확장·공개 수집 모의·카테고리·불러오기 회귀163/163, 고유 관련481개 모두 통과(fail/skip/cancel0). 신규 회귀48개는 pure receipt14, core5, concrete adapter20, 앱 UI9이며 전체 수에 이미 포함했다. TypeScript, 변경 lint 오류·경고0, 운영 빌드, 확장·Cloudflare 산출물 검사 통과. 개발 중 optional receipt narrowing 타입 오류는 수정 후 최종 전체 검사를 통과한 소스만 집계했다.

같은 사용자 Chrome의 별도 합성 화면에서 실제 React client/review를 검수했다. 양사×실전송 불허/합성 단계 응답의4사례를 기록했다. 전송 불허는 preview만 실행했다. 단계 사례는 상품정보·이미지·최종 확인을 한 번씩 거친 뒤 같은 문서·파일 ID로 처리 중→완료→반려를 조회했고, 최종 의도는1회·후속 동작은 observe2회였다. 완료와 SKU 확인 전을 분리했고 SKU를 만들지 않았다. 외부 요청·운영 쓰기·Hub 전송은0이다. 합성 시퀀스는 실제 서버의 상태 역전 사례나 실제 접수 성공의 증거가 아니다.

격리 채널 `YOOFAM_STEP658_NATIVE/RESULT`, 기록 `outputs/step658-native-receipt-{A01526306,A01464742}-{gate-false,staged}.json`, DOM 보관 `outputs/step658-native-yooandchae-rejected-dom.txt`. Source SHA는 client `b02b183d3a73fda16f5d1213ebb78e15060d39232339bf31fe26b1e70a43bf03`, review `34e610be9566f237186bec086a3c476f27644d779a099d3d1c95aaa5ce04eaea`. 합성 화면 PNG 캡처는 두 번의 CDP 타임아웃으로 저장하지 못했고, DOM·proof 검수는 완료했다. 원래 Step656 proof와 source를 덮어쓰지 않았다.

확장 **0.2.71**:52파일,701,652bytes. ZIP SHA-256 `541296ce2a879e35c321407d09d62bfaa9cb0e4202316d825ce200ef9b1fe2e3`. 이전 ZIP·DB·계정별 기본값·무료 번역/AI 정책·기존 권한은 유지한다. 실제 새1688 원문 수집, 모든 카테고리 기본값, native 최종 제출·접수 원문 응답 및 SKU 관계의 실증 검수는 남아 있다.

운영 배포 **`9f674413-25f3-4a9d-a0e8-f7440fe61fbb`** 완료. 같은 Chrome의 실제 앱에서 0.2.71 다운로드와 기존 두 대기열 URL·카테고리69900/81452·양식 연결 보존을 확인했다. 기존 `YP-22E079FC`는 미선택, 옵션6개, 공급4,260원·판매7,100원, 대표3·추가7·상세11·표시사항0장이 유지됐다. 자료 준비·상품 편집·수집·저장·전송은 누르지 않았고 대기열을 닫아 목록으로 돌려놓았다. `outputs/step658-production-preservation.json`, `step658-production-intake.png`에 보관했다. 사용자 설치 확장의 0.2.71 reload나 실제 접수 조회 실행은 아직 확인하지 않았다.
