# Step741 — 수집 저장 응답 지연과 초안 복구

2026-10-19 KST. 기준 commit `464b72fdd4c74233ac726304ea0134358ce01d70`. 이번 runtime 수정은 `app/intake-collection-recovery.ts` 한 파일이다. 원문 사이트의 새로운 수집 제공자를 추가하거나 실제 Supplier Hub 접수를 완료한 변경은 아니다.

## 확인한 결함과 수정

기존 helper는 fetch headers 뒤 `response.json()`이 끝나지 않으면 계속 기다렸다. abort를 무시하는 transport에서는 부모 signal을 취소해도 공개 Promise가 끝나지 않았다. 순수 재현은 `outputs/step741-source-ack-before-fix.json`에 보존했다. 그 재현에서 추가 timing 인자는 기존 함수가 지원하지 않아 무시됐으므로, 기존 함수가 특정 5ms 기한을 지원했다고 주장하지 않는다.

이제 POST의 headers와 JSON 전체를 40초로 제한한다. 응답을 확정하지 못했을 때는 **동일 collection job의 저장 결과 GET 1회만** 10초 안에 조회한다. POST를 다시 보내거나 Chrome 수집을 새로 시작하지 않는다. 각 요청의 child signal을 분리해 POST 시간 초과가 부모 signal과 결과 조회를 취소하지 않게 했다. 늦게 도착한 응답은 초안에 반영하지 않는다. 부모 취소 시에는 transport가 늦어도 바로 종료하며, 서버에 이미 저장된 원문은 다음 조회에서 재사용할 수 있다.

이미 받은 4xx headers는 본문이 지연돼도 terminal이다. 성공 JSON의 job·상품·원문 URL·저장시각이 다르면 조회로 덮어 정상 처리하지 않는다. Chrome fallback 권한은 제때 파싱된 기존 `collect`의 422 `SOURCE_NOT_COLLECTED`에만 남는다. configuration503도 terminal이다. 타이머와 listener를 정리하고 지연 body 취소 실패가 결과를 가리지 않게 했다.

40초/10초는 자체 서버 수집 예산에 맞춘 복구 기한이다. Couplus가 같은 시간을 사용한다는 근거는 없다. 내부 테스트 인자 `timeoutMs`와 `recoveryTimeoutMs`는 HTTP body나 query로 전송하지 않는다. 회사 기본설정·카테고리 코드·원문 가격·이미지·수동 수정·권한·DB 형식은 변경하지 않았다.

## 검수 근거와 한계

수동 clock으로 headers/body 지연, 취소를 무시하는 transport, 늦은 성공/실패, 이미 확인한4xx, recovery 지연, 잘못된 identity와 내부 기한 값을 검사했다. 별도 두 회사의 실제 자체 API/SQLite 경로에서는 먼저 보관 fixture의 원문을 저장한 뒤 ACK만 보류했다. 복구 후 6개 옵션·19개 이미지의 초안, 직접 수정과 2개 옵션 선택, 견적 준비·whole-product packet preview까지 연결했다. 닫은 화면을 다시 시작할 때 원문 재수집 없이 저장된 자료를 사용한 것도 확인했다. 회사·카테고리·수동 제목·공란·3333/4444/5555 직접 금액·옵션 순서와 원문 bytes를 단언한다.

원문 HTTP·AI·이미지·양식은 격리 fixture다. 이 검사를 실제1688 수집이나 Hub 접수로 집계하지 않는다. 원본의 전체 전송 body metadata·자료형·옵션 순서 비교는 [독립 전송 감사](step741-transmission-audit.md), 실제 수정의 race·권한·취소 검토는 [독립 ACK 검수](step741-source-ack-review.md)에 있다. 독립 순수 검수는 release test 수에 중복 합산하지 않는다.

최초 회귀 실행은 29개 파일339건 중337통과·2실패였다. 실행 전후 source1,373개 SHA가 같았다. 두 실패는 수정 전 ACK helper를 기준 commit에서 그대로 주입한 별도 실행에서도 동일하게 재현됐다. 주입은 파일 읽기 한 경로에만 적용했고 source나 운영 자료를 수정하지 않았다. `outputs/step741-related-release-*`와 `outputs/step741-baseline-stale-tests.log`에 보존한다.

두 기존 검사의 기대값을 이미 적용된 계약에 맞게 바로잡았다. 회사 미기록 자료는 여전히 회사 추정·견적 생성이 거절되며 저장 bytes 불변을 검사한다. 초기 제조자/수입자 고시는 기본설정의 상호를 자동 복사한다는 오래된 단언 대신 공통행과 6개 옵션 각각의 `해당사항없음`과 `couplus-default` 출처를 확인한다. browser-source 검사는 이미 얻은 JSON-LD를 재캡처하는 7회 DOM 읽기·supplement1회 기대 대신 4회 읽기·supplement0회·capture1회와 import 이전 순서를 확인한다. 실제 원문 옵션·원가·재고·provider 단언은 유지했다. 두 보정에 runtime 변경은 없다.

첫 보정의 전체 실행은338/339였다. 추가한 행 수 단언이 공통행을 빠뜨려6을 기대한 검사 작성 오류였으며 격리 API 응답은 공통1+옵션6의7행이었다. 단언을 공통1개·옵션6개·총7개로 각각 명시했다. 해당 중간 실패와 원본 응답도 보존한다.

이번에는 기존 상품·카테고리 선택·입력 대기열을 조작하지 않는다. 배포 후 같은 Chrome4의 앱 목록만 읽어 확인한다. 기존 상품 재수집·수정·삭제·전송, Hub 견적 쓰기는 없다. 확장0.2.86 및 두 native live gate `false`를 유지한다.

실제 신규1688 원문 획득과 신규 견적의 접수번호·qvt/SKU 연결은 미검증이다. 이전 site-safety 거절 주소를 재시도하거나 프로그램·서버·확장·다른 경로로 우회하지 않는다. 전 카테고리 동일성이나 전체 완성률을 이번 결과로 주장하지 않는다.

## 최종 결과

같은29개 파일의 최종 동결 실행은 **339/339 통과**, 실패·취소·skip·todo0이다. source1,373개 SHA가 실행 전후 같았고 배포 뒤에도 같았다. focused73건·별도 workflow6건·기대값 확인2건은 이339건에 중복 합산하지 않는다. TypeScript 전체 검사, 변경7개 파일 lint, `git diff --check`, 기존 확장·OCR 자산과 production binding을 확인하는 운영 빌드도 통과했다. 로그는 `outputs/step741-related-verified-*`, `outputs/step741-types.log`, `outputs/step741-final-lint.log`, `outputs/step741-build.log`에 있다.

기존 Worker에 `--keep-vars`로 배포한 버전은 **`28ae3186-1594-4282-b03a-bc2df00687ea`**다. DB migration·새 리소스·권한·유료 provider·확장 배포는 없다. 기존 Chrome4의 앱을 명시적으로 새로고침한 뒤 로딩 완료를 기다려 YOOFAM PLUS 목록을 읽었다. `YP-22E079FC`, 옵션6개, 공급4,260원·판매7,100원, 등록대기 및 대기열1건 표시가 그대로 남았다. 상품·카테고리·입력창·기본설정·전송 버튼은 누르지 않았다. 이것은 목록 확인이며 상품 DB 전체 시계나 실제 신규 접수를 확인한 주장은 아니다.

화면은 `outputs/step741-deployed-dashboard.png`, 최종 결합 검증은 `outputs/step741-final-validation.json`에 보관했다. 실제 원문 획득·접수 완료는 여전히 앞서 명시한 미검증 범위다.
