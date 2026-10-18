# Step720 — 수집 초안의 수동 편집과 최종 견적 연결 검수

기준 `4922d12495ee5f969c02633c4a767b3bdfb8146b`. 기존 작업 상품·저장 설정·실제 견적서는 수정하지 않았다. 이번에 추가한 것은 수정한 SEO/이미지와 최종 견적서가 일치하는 복합 회귀 테스트다. 해당 범위의 새 앱 결함은 확인하지 못했으며 추측한 기능 변경을 넣지 않았다. 앱·DB·확장·공유 helper·배포 설정은 기존 배포와 같다.

## 편집값 → Excel과 Single 문서

`tests/content-to-quotation-parity-flow.test.mjs`는 두 회사 문맥 × 선택값/명시 공란, 독립 fixture 4개를 검사한다. 합성 초기 상품·옵션·로컬 이미지·수집 context를 준비한 뒤 실제 SEO workspace PATCH와 content PATCH를 실행하고, 견적 preview/export와 Single GET/prepare까지 실제 handler/SQLite/로컬 R2로 연결했다. **실제 collector/import POST부터 시작하는 테스트가 아니다.** 업체 인증·81452 상세 schema·이미지는 합성이며 기존 실제 상품을 복사하거나 고치지 않았다.

검증하는 값은 다음과 같다.

- 사용자가 저장한 제목·설명·검색어가 공통 견적 제목·검색태그·HTML에 그대로 들어간다. `<보존>`은 HTML에서 escape되고 줄바꿈은 `<br>`로 연결된다.
- 대표 이미지 한 장, 추가 이미지 순서, 상단/본문 상세 이미지 순서, 표시사항 이미지가 현재 선택과 일치한다.
- XLSX 셀의 실제 파일명 → export map → 업로드 계획의 filename/archivePath와 행/필드/순서 reference → 물리 ZIP entry → 원본 이미지 SHA를 한 경로로 검증한다. 생성된 두 map을 따로 비교하는 것으로 끝내지 않는다.
- Single manifest의 옵션·역할·순서·원본 SHA와 문서의 정확한 URL wire가 일치하며 후보의 입력 지문이 검토 화면과 같다. 준비된 문서도 registered/remoteWrites는 false다.
- 포함 옵션 2개만 출력하고 제외 1개는 이미지·문서·계획에 섞이지 않는다. 수집 context·옵션·카테고리·설정·기존 파일 bytes는 보존한다. 최종 검토/파일 생성/준비 전후 13개 DB table도 바뀌지 않는다.
- 명시적인 제목 공란은 공란으로 남고 필수값 오류로 준비가 차단된다. HTML override의 null 해제는 content 연결로 복원한다. keywordText의 정리된 공란이 기존 문서 검색태그를 보존하는 기존 UI 계약과, 직접 keywords 배열의 명시 빈 목록 API 계약을 구분한다.

초기 4/4 통과 뒤 독립 검토가 ZIP 파일명과 실제 bytes 사이의 oracle 연결 부족 1개를 지적했다. 이를 보강한 최종 테스트 SHA는 `c5b17f9e7afafa0289d229bd7cfe8aff3a652326a49be41ffd5bdc0519c58fdb`다. 최종 집중 검사 4/4·lint 통과, 독립 재검토 issues 0이다. 초기/최종 집중 실행은 같은 4개이므로 중복 가산하지 않는다.

## 카테고리·URL·복구 경계

기존 초기 수집 경로는 category/URL 재선택 시 이전 연결을 지우고, owner/controller와 저장된 회사·profile revision·설정을 확인한다. 부분 이미지 수집 복구의 실제 로컬 route/SQLite 검사 3개는 수동 공란·선택 순서·제외 옵션과 독립 revision 경합을 보존했다. 새 결함은 확인하지 못했고 기존 테스트를 새 기능으로 세지 않는다.

추가로 원문 보완의 SKU 집합 변경을 격리 검수했다. 실제 로컬 route에서 수동 옵션명·원가·제외·견적 판매가 77,777원·제목·공란을 저장한 뒤, parser는 유효하지만 같은 개수 중 SKU 하나만 교체한 capture를 보냈다. 두 회사 모두 422이며 10개 table byte가 같았다. 원래 SKU 집합의 보완만 200이고 사용자 수정값·옵션 identity·원가·견적 override가 유지됐다. 이는 새 SKU를 조용히 기존 옵션에 합치지 않는 현재 계약이며, 외부 공급자·원문 사이트·모델·이미지 요청은 0이다.

## 실제 연결·무료 번역 확인

기존 Chrome4의 별도 앱 검수 탭에서 관리자로 연동 상태를 읽었다. 설치된 확장은 **0.2.72**이며 단일 SKU 수집 지원을 표시했다. 서버는 Google 무료 번역 설정과 D1 읽기 성공을 표시했다. R2 binding과 설정 표시는 실제 파일 쓰기/번역 성공 증거로 쓰지 않는다. 이미지 생성 모델·키 설정 필요 표시는 생성형 이미지 기능의 상태이며, 이미 구현된 무료 OCR/문구 편집 기능의 부재로 해석하지 않는다. 기존 상품·단계를 열지 않고 저장/새로고침/업로드 없이 검수 탭만 닫았다. 준비 ZIP 0.2.78과 설치 0.2.72를 구분한다.

사용자가 지정한 Google endpoint를 사용하는 실제 `translateGoogleFree`에 공개 검수 문구 `黑色运动护膝`를 zh-CN→ko로 한 번 보냈다. 결과는 **‘블랙 스포츠 무릎 패드’**, 감지 언어 zh-CN, 약 951ms, 실패 기록 0이다. 키·개인정보·실제 상품·1688 URL은 보내지 않았다. 이는 Node에서 실제 번역 모듈이 외부 endpoint를 호출한 증거이며, production Worker의 번역 호출이나 전체 상품 수집 성공을 증명하지 않는다. 유료 요청 0이다.

무료 OCR도 실제 Tesseract 7 엔진과 보관한 로컬 모델로 검수했다. 코드로 새 Microsoft YaHei PNG를 만들고 앱의 `createFreeOcrWorker` load→loadLanguage→initialize→recognize 프로토콜과 `readOcrRegions`를 실행했다. 결과는 `黑色 运动 护膝`(공백 정규화 후 입력과 같음), confidence 87, block 1개, 영역 x42/y47/w513/h84, 약 260ms다. 네트워크 요청 0·작업 종료 후 worker 0·listener 0이다. 인식 시간을 모델 다운로드/초기화 시간이나 평균 상품 처리시간으로 부르지 않는다.

이 검수는 Node worker port adapter가 브라우저의 고정 경로를 동일한 로컬 자산으로 매핑한 것이다. 프로젝트 type:module 아래 UMD를 CJS wrapper로 읽는 host 보정과 Node core loader의 full-core 선택이 있어 브라우저 Worker/CSP/cache 경로 검증과 다르다. 초기 host adapter 실패, 거친 5×7 시험 글꼴의 오인식과 낮은 confidence, mixed model 경고를 보존했다. 이를 앱 결함으로 분류하거나 성공 횟수에 합치지 않는다. 실제 중국어 상품 사진의 일반 정확도·완성된 번역 이미지 PNG·업로드·브라우저 편집을 검증한 것은 아니다.

## 원본과 완료 판정

REA 원본 감사는 `step720-intake-initialization-parity-audit.md`에 있다. 원본은 상품·옵션·견적 기본 구조를 저장하고 기본 SEO→가격을 초기 실행한다. 이미지 후보/문서 skeleton과 이미지 번역·표시사항 PNG·최종 견적 검토의 완료는 다르다. 새 정적 선택은 main의 상태 저장 action 2개뿐이다. 로컬 상태를 먼저 갱신하고 API를 호출하며 일부 실패/없는 상품도 성공처럼 반환될 수 있어 원본 진행률 100%나 badge를 실제 저장·Hub 접수 증거로 복제하지 않는다. 기존 초기화·가격·사진 선택·schema·SEO Evidence를 재사용했고 vendor 실행은 0이다.

최종 관련 **10고유파일 72/72 통과**, 신규 4개 포함, fail/cancel/skip/todo 0, 29.90초다. 소스/설정/시험 1,305파일의 전후 SHA·추가/삭제가 같고 두 독립 검토의 지적은 모두 해소됐다. 최초 종합 72개 중 70통과·2실패는 기존 Google 연동 fixture의 수동 SEO 문서 제목에 옵션명을 다시 붙일 것으로 기대한 오류였다. HEAD app/db 176파일·566회 읽기 주입에서 같은 2실패를 보존한 뒤, 현재 문서 권위와 문서 없는 fallback을 분리해 기존 회사·가격·이미지·공란·제외·재시도·XLSX 검사를 유지했다. 수정 후 3/3 통과다. 앱·공유 helper는 바뀌지 않았다. 실패·HEAD·집중·최종 반복 검사는 중복 가산하지 않는다.

변경된 시험 lint와 최종 동결 검증이 통과했다. 모든 runtime/config/dependency 소스가 Step719의 검증·배포 hash와 같아 타입·빌드·기존 Worker 배포를 반복하지 않았다. 현재 runtime은 Worker `a0a8d940-0725-4d63-baf9-3b676afc776c`다. 전체 저장소 suite를 실행했다고 주장하지 않는다.

이번 범위는 전 카테고리 동일성·실제 두 회원 로그인·중국어 상품 사진의 실제 브라우저 번역·새 1688 전체 SKU 수집·Supplier Hub 접수까지의 완성을 뜻하지 않는다. **SINGLE_DOCUMENT_LIVE_VERIFIED=false와 운영 게이트 false를 유지한다.** 기존에 거절된 source URL을 다른 도구/확장/CLI/프록시로 재접근하지 않았다. 최종 검사 수·동결 SHA·OCR 검수 결과·Git 상태는 `outputs/step720-final-validation.json`과 HANDOFF에 기록한다.
