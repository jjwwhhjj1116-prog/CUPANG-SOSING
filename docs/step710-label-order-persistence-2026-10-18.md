# Step710 — 표시사항 순서만 바꾼 저장과 PNG·Single 연결 검수

기준 `9269d061b4b42661da53205b3d2bc19c37b90883`. 이번 담당 범위는 순수 모델·저장·PNG 증빙·전송 자료 연결의 읽기 감사와 신규 격리 통합 검사다. 기본 편집기의 드래그 동작과 최종 UI 검수는 별도 담당이다. 앱·DB 구현은 수정하지 않았다.

## 감사 결과

기존 Step702의 `product_labels.structure`가 상품 공통 항목 배열 순서를 저장한다. `resolveProductLabels`는 그 ID에 대응하는 공통·옵션 직접값을 따로 해석하고, `productLabelPlan`은 저장 배열 순서대로 출력한다. Step703에 따라 정확히 빈 문자열인 행만 PNG에서 생략하므로 보이지 않는 빈 행 이동은 PNG를 바꾸지 않을 수 있다. 실제 출력 행의 순서가 바뀌면 plan SHA와 업로드 recipe가 달라진다.

`PUT /api/products/:id/product-labels?profileId=...`는 `changes:[]`와 명시적 `structure`만으로 저장할 수 있다. 기존 revision·원문 fingerprint 아래에서 구조와 상품 시각을 전진시키며, 공통·옵션 내용값과 견적 값은 수정하지 않는다. 조회에서 배열을 정렬하거나 초기화하지 않는다. 이 경로에서 확정된 기능 결함은 발견되지 않았다.

기존 `tests/product-label-structure-api.test.mjs`는 양사 동적 구조·명칭 변경·옵션 공란·PNG 증빙·Single 준비를 검사한다. 그러나 명칭·값이 전혀 바뀌지 않은 **순서만 변경하는 metadata-only 저장**은 별도 명시 사례가 없었다. 신규 `tests/product-label-order-api.test.mjs`에 이 사례를 추가했다. 기존 테스트 기대값을 변경하거나 보호 단언을 완화하지 않았다.

## 새 실제 자체 API 검수

기존 `tests/helpers/supplier-hub-single-size-chart.mjs`의 `sizeChartApiFixture`를 재사용했다. 회사코드는 유앤채 `A01526306`, 와이홉 `A01464742`이며 계정·상품·속성·카테고리 양식·파일은 격리된 합성 fixture다. 실제 SQLite/D1 어댑터, 자체 route handler, R2 어댑터와 Single 자료 준비·packet 함수를 실행한다. 운영 계정이나 기존 작업 상품을 읽지 않는다.

두 회사 각각 다음을 하나의 흐름으로 확인했다.

- 공통4행 구조와 옵션별 재질 직접값·공란, 제외 옵션값을 저장하고 공통·두 옵션의 PNG를 각각 명시적으로 연결한다. 공통 첨부가 기존 옵션 직접 참조를 덮지 않는다.
- 항목명과 내용값을 유지한 채 배열 순서만 바꿔 `changes:[]`로 저장한다. 재조회·DB payload가 정확히 그 순서이며 모든 공통·옵션 값·공란·원천과 관련 revision이 보존된다.
- 실제 renderer를 기록 canvas로 실행해 출력 항목명의 순서를 대조한다. 빈 옵션 재질은 공통값으로 되살아나지 않고 해당 PNG에서 계속 생략된다.
- 양쪽 기존 PNG가 현재 출력과 달라 stale로 차단된다. 한 옵션만 재생성하면 다른 옵션의 기존 참조와 stale 상태가 유지된다. 두 옵션을 각각 명시적으로 재생성·연결한 뒤에만 준비 가능 상태가 된다.
- 이전 PNG 바이트는 삭제하지 않는다. 공통 재생성도 두 옵션의 새 직접 참조를 유지한다. 원문·내용·옵션 가격·설정·프로필·제외 옵션·다른 상품은 변경되지 않는다.
- 최종 Single 준비 후 각 옵션의 정확한 새 라벨 키가 공개 불변 URL 하나로 연결된다. media handler의 PNG 바이트 SHA와 `singlePackagePacket`의 `imagePage.images.labelImages` URL을 대조한다. 준비 중 업무 DB·비공개 원본 파일은 변하지 않는다.

신규 두 사례는 **2/2 통과**, 실패·취소·건너뛰기0이다. scoped MJS ESLint와 `git diff --check`는 exit0이다. 별도 전체 저장소 검사나 운영 빌드는 이 담당 범위에서 실행하지 않았다. 같은 검사를 반복하거나 기존 Step702 검수 수를 새 통과 수에 합산하지 않았다.

실제 renderer는 합성 canvas에서 글자 그리기 호출을 기록하고 유효한 합성 PNG를 반환한다. 따라서 글리프 픽셀 품질을 증명하는 검사가 아니다. 각 회사의 추적 API 요청141회와 별도 media GET2회를 증거에 구분했다. fixture 초기화 요청·handler 내부 호출을 합친 전 요청 수라고 표현하지 않는다.

## 증거와 범위

- 테스트: `tests/product-label-order-api.test.mjs`
- 실행: `outputs/step710-label-order-api-initial.log`
- lint: `outputs/step710-label-order-lint.log`
- JSON 증거: `outputs/step710-label-order-api-proof.json`
- 테스트 SHA-256: `6ad1d51808ceb429fc8949995249b43c3f1a5372d2922ef1bcfefac29dae426f`
- JSON 증거 SHA-256: `10213fbbbe5b263e9b60aec6eadf25232888ba3c8e1ac400b9c4610af92325fb`

JSON은 해당 흐름의 순수·백엔드·renderer·Single 관련 파일과 테스트·helper의 SHA를 고정 대조한다. 다른 담당자가 작업 중인 편집기 파일은 이 실행의 소스 동결 목록에 넣지 않았다. 최종 드래그 UI 소스와 검수 결과는 별도 최종 검증기에 결합한다.

브라우저 동작·외부 요청·provider 호출·운영 상품 변경·Supplier Hub 쓰기는 모두0이다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`, `registered:false`, `remoteWrites:false`, `submissionReady:false`를 유지한다. 이 검수는 자체 준비와 packet의 보존을 증명하며 실제 Supplier Hub 접수·SKU 발급이나 Couplus 전체 기능 동등성을 증명하지 않는다. 원본 표시사항 순서 배열과 자체 PNG 재구성의 차이는 Step702·709 감사 문서의 한계를 그대로 따른다.
