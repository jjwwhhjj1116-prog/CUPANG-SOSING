# Step705 — 상품 수집 경로 재대조·개별 견적 연결 보완

2026-10-18 KST. 시작 commit `daebe0472258a0a13bdbd21ca68dc8ade48a3990`. 사용자 목표는 카테고리 선택 → 1688 URL → 1~7단계 초안 → 직접 수정 → Supplier Hub 등록전송 → 실제 접수 확인이며, 기존 작업 상품은 변경하지 않는다. 이번 변경은 전체 동일 구현이나 실제 접수 완료가 아니다.

## URL 수집의 확인된 차이

REA와 보관된 원본에서 일반 상품추가가 `POST /api/aiPage/getProductInfo`에 `[{productId}]`를 보내고 구조화된 상품 원문을 먼저 받는 것을 확인했다. 그 다음 확장의 `GET_PRODUCT_INFO`는 Supplier Hub 회사·카테고리 schema와 새 문서 골격을 연결한다. CLI 설치나 이 확장 메시지를 1688 원문 수집 자체와 혼동해서는 안 된다. 정확한 함수 범위·SHA·응답 필드는 `step705-url-source-collection-parity-audit.md`에 기록했다.

현재 자체 기본 수집기는 공개 PC JSON-LD와 모바일 원문/SKU 조회이며, 공식 OpenAPI는 별도 서버 설정이 있어야 사용한다. 쿠플러스 서버 내부 공급자·API 인증·캐시는 보관 프런트 코드만으로 확인하지 못했다. 구형 확장의 별도 PC 초기 데이터 reader도 옵션 구조만 해석하며 offer identity·개별 가격·통화·MOQ 계약은 증명하지 않는다. 따라서 없는 원가·SKU를 추측해 채우거나, 사용되지 않는 파서를 추가한 것을 수집 완료라고 표현하지 않았다. 이번에 public collector나 provider 선택 코드를 변경하지 않았다.

실제 Chrome에서 설치된 확장은 **0.2.72**로 관찰했다. 이 버전의 보관 ZIP을 격리 실행하자 Chrome 수집 준비가 일시 실패한 뒤 rejected Promise를 계속 재사용하여 명시 재시도도 실패하는 결함을 재현했다. 이미 준비된 최신 transport는 실패 cache를 해제하여 다음 직접 재시도가 회복된다. 이 수정은 새 **0.2.76** 패키지에 포함된다. 현재 운영 브라우저에서도 같은 일시 실패가 발생했다는 증거는 없다. 구버전 content script와 현재 앱의 별도 UUID PING/CAPTURE 연결은 합성 원문으로 정상 검수했다.

## 공식 견적서 동의값 연결

실제 보관81452 schema의 imagePage에는 images/details만 있지만 원본 initializer는 `msrpAgree`, `labelContactAgreed`를 추가한다. 자체 projection이 이 둘을 빠뜨리면 receiver가 자기 자료를 동의 단계에서 거절했다. `couplus-required-v1`와 정확한 native imagePage 구조에서 schema가 생략한 두 제어값만 false로 보완한다. 원본처럼 자동 true로 동의하지 않으며 현재 문서의 단계별 약관을 직접 확인한 뒤 기존 receiver가 해당 단계 값만 바꾼다.

기존 schema/digest·회사/카테고리/고시/version·저장값·수동 공란·이미지 참조는 유지한다. schema가 같은 이름을 잘못된 자료형으로 선언하면 조용히 덮어쓰지 않는다. 원본 근거·독립7개 검수 그룹은 `step705-native-consent-bridge-parity-audit.md`에 있다.

## 기존 작업 탭 보존

개별 전송 adapter가 기존 Supplier Hub 탭을 선택·이동하던 경로를 제거했다. 전송 요청마다 같은 Chrome 창에 비활성 새 탭 하나를 만들고, 먼저 `target-requested`와 반환된 탭 ID/요청 ID/packet digest를 `target-created`로 영속 저장한 뒤 회사·문서를 확인한다. 기존 탭을 조회·선택·이동·닫지 않는다.

탭 생성 응답 또는 저장 ACK가 유실되면 다른 탭을 선택하거나 대체 탭을 만들지 않는다. 저장 결과가 확인된 경우에만 같은 탭 ID를 재사용한다. 다른 회사·닫힌 탭·다른 창·로그인 redirect·소유 증거 없는 예전 checkpoint도 기존 탭으로 되돌리지 않는다. 앱은 새 상태를 정확히 검증하고 생성 결과 미확정 상태에는 읽기 복구만 제공한다. 이 경로의 실제 운영 활성화 gate는 여전히 false다.

## 배포와 검수 경계

- Chrome 확장 **0.2.76**, 다운로드 ZIP 53파일/709,685bytes, SHA-256 `8b8dcfd757a6e33ca031cb4d911ea5a313b752e44242b42b28c6627c4d8caa1f`. 새 권한은 추가하지 않았다. 기존0.2.75 ZIP은 보존했다.
- 다운로드 링크4곳을 갱신하고, 구버전이 기존 feature flag를 모두 반환해도 최신 복구 수정 다운로드를 표시한다. 다운로드 버전을 설치된 버전으로 표시하지 않는다.
- 실제 자체 API/격리 SQLite·R2 자료 준비 → 실제 client packet → receiver checkpoint·단계 동의를 두 회사로 검수했다. 상품 원문·PNG·Chrome 탭·Hub 응답·사용자 동의는 합성이며, synthetic pending과 실제 접수 성공을 구분한다. 기존 사업자료와 private 이미지·packet·원문은 보존했다.
- 최종 **20고유 파일284/284 테스트 통과**, fail/cancel/skip0. 관련 source 1,242개 전후 hash가 동일하다. `outputs/step705-related-final-proof.json`, `step705-prepared-consent-proof.json`, `step705-final-validation.json`에 기록했다. 반복 실행·REA 순수 검수 그룹은 최종 고유 테스트 수에 더하지 않는다. 전체 저장소 suite나 브라우저 픽셀 일치를 주장하지 않는다.
- 전역 TypeScript·app/db ESLint·변경 extension/test ESLint·memory schema44tables/17indexes/29modules·bounded 운영 빌드 통과. 기존 무료 Worker **fe1cd524-ad4a-49dd-907e-7ec97e759f02** 배포 exit0. 새 DB migration·유료 resource·OAuth/R2 권한은 추가하지 않았다.

이번 실제 Chrome 확인은 자체 앱과 유앤채 `A01526306` 로그인·빈 신규 Hub 등록 화면·설치 버전 읽기에 한정된다. 기존 상품/대기열 두 건을 실행·수정하지 않았다. 1688 공개 도메인 및 새 지정 상품 URL 읽기는 조사용 브라우저 정책과 자동 승인 검토가 거절했으며 다른 도구·확장·서버로 우회하지 않았다. 이 거절은 앱 수집 기능 자체가 불가능하다는 증거가 아니다.

**남은 핵심:** 실제 원천에서 신규 상품의 전체 SKU·원가·이미지·MOQ를 검증하고, 그 자료로 1~7단계 수정·Supplier Hub 최종 문서와 접수번호·SKU를 대조해야 한다. 현재 `SINGLE_DOCUMENT_LIVE_VERIFIED=false`를 유지한다. 원문 수집·모든 카테고리·실제 접수·전체 완성률을 완료로 표시하지 않는다.
