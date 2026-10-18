# Step694 — 사이즈표 한 장을 견적서 전송 자료에 연결

2026-10-18 KST. 기준 `47c0f58408e2287d38d8fc389ecebcb742a28dc2`. 저장한 사이즈표가 있는 견적서에서 Single 전송 자료 준비가 차단되던 연결 누락을 수정했다. 기존 작업 상품, 운영 DB, 공유 Chrome 및 쿠플러스/Supplier Hub에는 접근하지 않았다.

## 확인한 원본 동작과 수정

보관된 쿠플러스 `saveManualSizeChart`는 기존 사이즈표 URL을 재사용하거나 새로 업로드한 이미지 URL 한 개를 받아 `coupangDoc.jsonDocument[n].imagePage.images.sizeChartImage`에 직접 저장한다. REA 원본 위치·SHA·관찰 범위는 [등록전송 대조 문서](step694-submission-parity-audit.md)에 기록했다. 정적 저장 동작을 실제 Supplier Hub 접수 증거로 취급하지 않는다.

자체 견적서 편집기·콘텐츠 연결·projection은 이미 이 exact wire를 처리하지만, 이미지 전송 자료의 역할 판정에는 빠져 있었다. 선택한 본인 소유 PNG 한 장도 `SINGLE_IMAGE_ENCODING_UNVERIFIED`로 거절되는 것을 양사 합성 입력으로 재현했다. 이 때문에 견적서 전체의 준비가 차단됐다.

`singleAssetSelection`에 bare `imagePage.images.sizeChartImage`를 `size` 역할로 연결했다. 기존 이미지와 같은 소유권·실제 바이트·SHA/MIME·공개 파일 불변성 검증을 통과한 파일의 서명 URL 한 개를 원래 문서 위치에 넣는다. 미리보기에도 사이즈표 역할을 표시한다. 같은 파일을 다른 이미지 역할에서 쓰면 기존 URL을 재사용한다. 원본 이미지 재생성이나 이미지 번역은 수행하지 않는다.

수동 공란·공통 값과 옵션별 수정·제외 옵션·회사/카테고리·원가·명시 동의값은 그대로 유지한다. 소유권이 다른 key, 손상된 파일, 다른 path 또는 named array로 가장한 wire를 허용하지 않는다. 소유한 이미지도 두 장 이상이면 `SINGLE_IMAGE_COUNT`로 명시적으로 차단한다. 쿠플러스의 이 저장 경로에서 여러 URL의 encoding을 확인하지 못했으므로 첫 장으로 줄이거나 구분자로 합치지 않는다. 기존 Excel의 다중 첨부 지원은 변경하지 않는다.

## 검수와 경계

새 검사는 합성 카테고리 스키마·PNG·인증과 격리 SQLite/R2를 사용한다. 실제 앱의 projection/준비 API/공개 이미지 응답/전송 packet 생성 경로를 검증하며, 새1688 수집 또는 실제 Hub 등록을 실행하는 검사가 아니다. 원본의 초기 차단 재현과 독립 검토는 각각 별도 JSON에 보관하며 릴리스 테스트 수에 더하지 않는다.

독립 검토18개 항목이 통과했고 추가 지적은 없다. 소스/화면 문구 읽기와 자체 함수의 합성 실행을 구분한다. 브라우저 렌더링·새 화면 캡처·원본 vendor 코드 실행은 하지 않았다. 최종 테스트 목록·실제 로그·소스 SHA·빌드·배포 버전은 `outputs/step694-final-validation.json`에 기록한다.

최종 관련 검사는 **7개 고유 테스트 파일78개**다. 신규 사이즈표 unit9개/API7개, 기존 이미지 자산·projection·전송 packet의5개 파일62개가 통과했다. 최초 신규 실행의15통과/1실패는 공개 파일을 모두 준비하지 않은 채 손상된 사이즈표만 넣은 테스트 구성 문제였다. 기존 GET은 앞선 미준비 파일에서 정상적으로 prepared=false를 반환한다. 실제 자료 준비 완료 후 사이즈표 본문만 손상시키는 구성으로 고쳐 GET의 실제 바이트 검증/409를 확인했고,16개를 모두 다시 실행했다. 초기 로그를 보존했고 반복15개를 총계에 더하지 않았다. 앱 소스 수정은 추가하지 않았다.

두 회사 각각 실제 package 핸들러4회(GET/POST/GET/GET), 총8회와 별도 media 핸들러6회를 검증했다. 유앤채의 실제 POST200 뒤 응답만 합성503으로 유실시켜 재POST 없이 GET으로 준비 상태를 복구했다. 각 회사의 원본13파일과44개 DB 테이블의 행은 바뀌지 않았다. 준비 POST가 만든 불변 공개 사본9개 중 사이즈표2개의 실제 PNG 응답 SHA를 대조했다. 제외 옵션의 사이즈표는 출판하지 않았고 이후 GET은 파일을 쓰지 않았다. 각 옵션의 `singlePackagePacket`에는 해당 옵션 문서 한 개와 사이즈표 URL 한 개가 유지된다. 구체적인 요청·소스 SHA·경계는 `outputs/step694-size-chart-api-proof.json`에 있다.

전체 TypeScript(768MiB), 변경 앱 lint(384MiB),44테이블/17인덱스/29런타임 모듈의 fresh/repeated 메모리 스키마 검사와 bounded Worker 빌드가 exit0이다. 첫 앱 lint의128MiB 실행은 메모리 부족이었고 원본 로그를 보존했다. 최종 성공 검사는384MiB에서 실행했으며 그 둘을 구분한다. 새 DB migration이나 리소스를 만들지 않는다.

신규 MJS3개 lint도 통과했다. 최종 verifier는15개 소스/테스트 SHA, 실제 검사 로그·양사 격리 API 기록·정적 독립 검토 및 배포 버전을 대조해 통과했다. 전체 저장소 테스트나 새 브라우저 검수로 확대하지 않는다.

기존 무료 Worker 배포는 exit0이다. 주소는 <https://sourceflow.jjwwhhjj1116.workers.dev>, version `492b191d-e77d-4faa-84ac-0ee374f3272d`, 로그는 `outputs/step694-deploy.log`다. 확장 파일·ZIP·다운로드 링크는 바꾸지 않았고 준비 버전0.2.75, 마지막 실제 설치 확인0.2.64를 그대로 구분한다. Chrome 확장 교체·새로고침이나 운영 브라우저 열기, 새 리소스·유료 플랜·DB migration·OAuth/R2 권한 변경은 없다.

실제 신규1688 전체 옵션/사진 수집, 모든 카테고리 공식 양식/기본값, 나머지 편집 동작 및 Supplier Hub 동의·최종 접수번호/SKU 대조는 전체 완료 조건으로 남는다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`와 운영 전송 gate를 유지한다. 이 자료의 준비·공개 성공을 견적서 접수 완료로 표시하지 않는다.
