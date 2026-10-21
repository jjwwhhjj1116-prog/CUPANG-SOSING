# Step769 — 지연 이미지 수집·추가 이미지 편집과 네이티브 연결 검수

기준 커밋은 `a5d5c18c8c5934783138a0015c81b0aa0814779b`다. 기존 업무 상품과 원본 사이트의 작업 상품을 열거나 수정·삭제·전송하지 않았다. 이번 기록은 보관한 출하 코드의 정적 근거, 합성 현재 문서, 격리 SQLite와 실제 애플리케이션 경로의 검수를 구분한다. 합성 자료를 실제 1688 수집이나 Supplier Hub 접수 완료로 보고하지 않는다.

## 보관한 REA 근거

Couplus route `outputs/step754-current-couplus/chunk-6b0db3f8.8a741991.js`의 SHA는 `5b92873c674c4b76c0e6ce4961caedbf8728ca86f6a15b6d9dc8cdfce80ad1d9`다. 동일 REA 부모 `ev_69740e390a2cc1e539a4a65a84e5c7065e2e6db9dcbc8a6311d0b4bfce5a3166`와 보관 요약 `ev_26cdc76017d63fa2bb683d4165db034bae99266f6a3ad48bb3b45253f2ce9634`를 재사용했다. 이전 부모 조회의 무결성 오류를 반복하거나 새 producer를 실행하지 않았다. `outputs/step769-rea-images.json`에 원본·자체 코드의 제한된 범위, UTF-16/UTF-8 위치와 조각 SHA를 남겼다. 이 파일의 자체 코드 SHA는 분석 시점의 스냅샷이며 최종 변경 파일 SHA와 구분한다.

원본 Stage4는 모든 이미지 갤러리, 현재 이미지 미리보기·편집·AI 처리, 현재 추가 이미지의 정렬·삭제, 일괄 처리·저장을 기본 화면에 둔다. 기존 자체 편집기에도 핵심 기능은 있었으나 Dashboard가 해당 옵션 편집기와 일괄 처리를 접힌 구역에 두고 공통 역할 편집기를 먼저 펼치는 차이가 확인됐다. 원본 Stage3의 네 갤러리·기본 메인 탭·미리보기는 이미 구현돼 있어 새 성과로 재집계하지 않았다. Stage3의 보조 동작 밀도는 남은 차이로 기록했으며 이번에 모두 동일해졌다고 주장하지 않는다.

원본 Stage4의 저장 범위는 상품 공통이다. 자체 시스템의 정확한 선택 옵션 격리를 유지하므로 원본의 공통 저장 범위까지 복제하지 않았다. 제한된 원본 함수 범위에서 이미지 개수 상한을 찾지 못한 것은 서버나 Supplier Hub의 상한이 없다는 증거가 아니며 기존 검증 한도를 완화하지 않았다. 원본 CSS·동일 상태의 실행 화면·외부 AI 동작·전체 픽셀 동일성은 이번 정적 근거로 증명되지 않는다.

RS 근거는 `outputs/step747-rs/extracted/content-1688.js`, SHA `199540b324c9a15ee323504c9216a411131bc3ce52cb51f1177ccfc9749b0242`, 부모 `ev_5e23b694a30378c27c01eec2c169297c72138e2320926ab507812e2c56ebd298`를 재사용했다. 보관 코드의 `data-lazyload-src`·`data-ks-lazyload`를 확인했으며, 첫 번째 truthy 값을 무조건 사용하는 동작은 복제하지 않았다. 세부 재현은 `outputs/step769-lazy-images-proof.json`에 있다.

## 현재 문서의 지연 이미지 수집

기존 수집 버튼과 DOM 옵션 reader가 같은 `readPageSourceElementImage`를 사용한다. 한 이미지 요소 안에서 현재 URL·`src`·지연 로딩 속성을 기존 유효 우선순위대로 확인하고, data URL placeholder나 다른 호스트의 값이 뒤의 유효 CDN URL을 가리지 않도록 보완했다. 버튼은 기존 `data-src` 우선순위를, 옵션 reader는 기존 `currentSrc` 우선순위를 유지한다.

후보마다 기존 HTTPS alicdn 검증을 적용한다. 다른 호스트·잘못된 프로토콜·인증정보·비표준 포트·fragment·과도한 길이를 거절하며, 같은 요소의 뒤 후보만 확인한다. 기존 갤러리·상세·SKU 선택 범위를 넓히지 않고 원가·SKU·MOQ·재고를 만들어 넣지 않는다. 스크롤, iframe, 공급자 스크립트 실행, 백그라운드 상품 조회나 새 네트워크 요청은 추가하지 않았다. 유효한 CDN 주소를 얻은 것만으로 다운로드된 이미지 픽셀이나 전체 공급자 이미지의 완전성을 주장하지 않는다.

이전 bundle은 스크립트 대표 이미지가 있으면 지연 상세 이미지를 빠뜨린 채 완료로 표시하거나, 갤러리만 있으면 placeholder 때문에 수집을 거절하는 합성 사례가 재현됐다. 생성된 실제 버튼을 실행해 이 차이를 수정 전후로 확인했다. 양사 trusted click → 실제 source-inbox POST → SQLite immutable 저장 → 정확한 회사·fingerprint ACK를 검증했다. 잘못된 이미지, untrusted click과 하위 프레임은 저장하지 않는다. 수집함 ACK와 상품 초안 생성은 별도 단계이며 이 버튼 검수를 실제 상품 생성·접수로 합산하지 않는다.

manifest와 다운로드 경로는 통합 확장 `2.1.12`를 가리킨다. 생성된 `page-collector.js`도 갱신했다. 권한이나 host 범위는 확대하지 않았으며 현재 사용자 Chrome에서 새 버전이 실행된다는 확인은 하지 않았다. ZIP은 90파일·1,079,300bytes, SHA `54ebc90b0f623e23ba32fb7ae36a3ea3ef0034d4cdf3d82e71e6a5efe8c20879`이며 생성·패키지 검사를 통과했다. 이전 ZIP들은 변경하지 않았다.

## Stage4의 기본 편집 화면

선택 옵션의 추가 이미지 편집기와 기존 일괄 처리 도구를 접힌 details 밖의 기본 화면에 배치했다. 후보 갤러리·현재 미리보기·편집·추가·정렬·삭제·즉시 저장 기능은 같은 인스턴스와 기존 handler를 사용한다. 공통 추가 이미지 역할 편집기만 기본 접힘으로 바꿨다. 선택 옵션이 없는 공통 작업의 기존 노출과 Stage5 기본 도구는 유지한다. 간결한 가로 도구 배치는 Stage4에도 적용한다.

새 편집기를 중복 mount하거나 저장 범위를 확장하지 않았다. 정확한 owner/product/option/profile/source clock, 숨은 단계와 다른 편집기의 dirty/busy 보호, 동기 잠금, stale callback, 알 수 없는 ACK의 읽기 우선 복구는 유지한다. 후보 미리보기만으로 쓰지 않고 기존 명시 추가·정렬·확인 삭제 동작이 저장을 시작한다. OCR 번역을 다른 AI 동작으로 이름만 바꾸거나 화면 진입 시 외부 AI를 자동 실행하지 않는다.

## 실제 Dashboard 경로의 별도 합성 브라우저 검수

최종 유효 PNG 검수는 `outputs/step769-browser-valid-qa/`의 별도 합성 상품·회사 와이홉·합성 프로필을 사용했다. 실제 Dashboard와 API, 임시 SQLite, 확인된 합성 저장 원문을 연결한다. `source-before.json`·`source-final.json`과 초기화 근거에는 translation-source 및 image-text-source GET200, 현재 옵션·역할·원본 key·해시가 기록돼 있다. source GET200은 합성 저장본의 연결 증거이며 실제 1688 요청 성공을 뜻하지 않는다.

Stage4 기본 편집 화면에서 공통 편집기가 접히고 옵션 갤러리가 바로 보이는 것을 확인했다. 추가와 순서 이동으로 quotation-fields PUT200이 정확히 두 번 발생했고, 새로고침 뒤 순서와 현재 이미지가 유지됐다. 수동 편집기를 열어 로컬 원본 GET200과 실제로 decode된 32×32 PNG를 확인했다. 이 검수는 편집기 진입·원본 픽셀 표시까지이며 수동 편집 결과 저장이나 OCR·번역 성공 검수로 확대하지 않는다. 재진입 후 7단계 이동도 확인했다.

`proof-final.json`·`final-checkpoint.json`·`state-final.json`과 `reopened-additional-observations.json`에 요청과 보존 상태가 있다. 보호 합성 상품은 변경되지 않았으며 원본 옵션·이미지 객체를 삭제하지 않았다. 실제 source/Hub/native 요청은 각각 0회다. 화면은 `outputs/step769-ui/additional-valid-saved.png`, `additional-valid-reopened.png`, `manual-editor-valid.png`, `stage7-valid-final.png`에 보관했다.

첫 브라우저 fixture의 PNG는 헤더만 유효해 실제 decode/image-text-source 경로에서 415가 났다. 이를 운영 코드의 형식 검증을 완화해 통과시키지 않고 유효한 로컬 PNG fixture로 수정했다. 이전 기록은 `outputs/step769-browser-qa/` 등에 보존한다. 삭제 확인창을 제어하던 native confirm/CDP 실패도 QA 경계 문제로 남겨두며, 삭제 쓰기는 없었다. **최종 브라우저 삭제 확정·저장은 검증하지 않았다.** 별도 컴포넌트 회귀의 확인 삭제 통과와 구분한다.

## 네이티브 전체 상품 연결의 합성 수직 회귀

새 `tests/native-product-receiver-receipt-flow.test.mjs`는 수기로 성공 observation을 작성하지 않는다. 실제 견적 저장·native-assets GET·현재 원본 검토·packet 생성, 실제 native adapter와 `createProductDocumentReceiver`, 명시적 합성 동의, 엄격한 register-requested 관찰, 실제 supplier-hub-product-receipt POST/GET을 연결한다. Chrome 표면·Hub transport·동의와 PNG만 격리 합성 fixture다.

양사 각각 포함 옵션 2개와 제외 옵션 1개를 사용했다. 두 옵션의 공급가 11,960/3,333, 판매가 19,930/4,444, 정상가 25,910/5,555와 문서 순서·상품명을 확인했다. private 원본 7개의 실제 바이트·해시·파일명과 MAIN→ADDITIONAL→LABEL→DETAIL 전송 순서, 업로드 전 checkpoint, 정확한 문서 본문을 검증했다. create→update→`/sr/qvt/api/validate-step/2..5` 이후 합성 동의 전 submit은 0회다.

합성 제출 후 다른 docId의 목록만 보이면 완료 화면 문구가 있어도 접수로 인정하지 않는다. 정확한 새 문서 row를 다시 읽어 pending으로 진행하고, 다른 QVT 식별값은 거절한다. 실제 receipt API도 잘못된 회사·문서·QVT 변경을 거절한다. 같은 durable store로 receiver를 재생성해 start/recover/resume을 반복해도 submit은 1회로 유지된다. FINISHED의 새 관찰을 보관해도 receipt row는 문서당 1개이며, 보호 합성 SQL·객체·기존 Hub 문서는 그대로다.

이 수직 연결에서 production 결함을 발견하거나 production을 수정하지 않았다. 최초 테스트의 검증 경로 예상과 helper의 primitive 복사 문제만 바로잡았으며 기존 운영 guard를 완화하지 않았다. 관련 6파일 45건의 집중 검사가 통과했고 lint·diff 검사를 통과했다. 증거는 `outputs/step769-native-chain-proof.json`·`step769-native-chain-tests.log`에 있다. 시나리오당 앱 handler 조회 1,377회와 private 원본 조회 7회가 관찰됐고, 조회를 고정 성공 값이나 캐시로 대신하지 않았다. 이 측정은 실제 운영 응답 시간이나 성능 개선 완료 증거는 아니다.

메타데이터 목록과 합성 submit을 원격 바이트 영속성·최종 SKU 발급으로 추론하지 않는다. `remoteBytesVerified=false`, `actualUploadVerified=false`, `registered=false`를 유지했다. 현재 native-registration/WIMS의 집계 결과로 포함 옵션별 SKU 대응이 증명되지 않았으므로 SKU를 임의 배정하지 않는다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`와 `PRODUCT_DOCUMENT_LIVE_VERIFIED=false`도 유지한다.

## 최종 검사·배포

지연 이미지 집중 6파일 54건, Stage4 집중 23건, 네이티브 연결 집중 6파일 45건의 통과 기록이 있다. 서로 겹치는 집중 검사 결과를 최종 고유 합계에 가산하지 않는다. 첫 100파일 묶음은 961건 통과·기본 노출 변경 전의 UI 기대 단언 1건 실패였으며 기록을 보존했다. 기대를 수정한 두 번째 묶음은 960건 통과·새 네이티브 시나리오 2건 실패였다. 상세 stack은 마지막 `dispatch:start` 검사가 실행될 때 120초가 지나, 후속 release gate 대신 앞선 `EXPIRED` 거절이 정상 발생했음을 보여준다.

이 시간 의존성을 운영 TTL이나 guard를 완화해서 해결하지 않았다. 새 테스트의 Date만 같은 논리 시각으로 고정하고 실제 timeout·abort 타이머와 API·원본 조회는 유지한다. 유효 시간 안의 release gate 거절을 먼저 검사하고, 명시적으로 TTL+1을 진행한 뒤 새 start의 EXPIRED 거절·durable checkpoint 불변·기존 recover/resume/observe를 따로 검증한다. 최종 검사는 소스가 동결된 서로 겹치지 않는 99파일·960건과 네이티브 1파일·2건으로 나눴으며 **고유 100파일·962건 모두 통과**했다. 실패·취소·생략은 0이다. 단일 Node 프로세스 실행으로 주장하거나 앞선 실패·집중 실행을 더하지 않는다. `outputs/step769-final-test-partitions.json`은 양쪽 파일 목록·로그 SHA·동결 소스 SHA를 검증한다.

타입·운영 빌드가 통과했고 lint 오류 0·기존 경고 48건을 유지한다. 마지막에 바꾼 테스트 fixture도 별도 lint를 통과했다. 기존 Worker 배포 버전은 `cd768b88-4cb7-4f8e-9a7b-f7ae9867ed21`이다. 새 리소스·마이그레이션·Access 정책 변경은 없다. 최종 소스·산출물·배포·커밋/푸시는 `outputs/step769-final-validation.json`에서 확인한다.

실제 1688 수집, 모든 카테고리·상태의 1~7단계 완전 동일성, 실제 AI 이미지 처리 품질, Supplier Hub 원본 업로드/readback·최종 동의·docId/qvt/SKU 실제 접수는 미검증이다. 이전 자동 승인 검토가 거절한 1688 주소에 직접 또는 간접 재접근하지 않았으며 새 CLI·서버·프록시를 우회 경로로 쓰지 않았다. 임의 완료율이나 전체 완료를 보고하지 않는다.
