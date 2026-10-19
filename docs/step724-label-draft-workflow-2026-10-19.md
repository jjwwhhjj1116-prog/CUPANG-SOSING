# Step724 — 작업 개시에서 표시사항 초안·PNG·견적 연결

기준 커밋 `7c7a95d16af351f24afd2f26cca63128bcd303f9`. 이미지 검토 다음에 실제 6단계 편집기를 연결했다. 선택 상품의 포함 옵션별로 한글표시사항 초안을 준비하고, 사용자가 검토·저장한 내용으로 PNG를 만들어 견적서에 연결한다. 기존 상품이나 저장 설정을 자동 변경하는 기능은 아니다.

## 구현 범위

- `app/batch-label-draft.ts`: 로그인 계정·회사와 전체 저장 설정을 조회 전후 대조하고, 원래 카테고리 컨텍스트의 포함 옵션만 대기열에 넣는다. collection에 기록된 profile ID를 현재 선택 profile 쿼리로 바꾸지 않는다. 표시사항 revision 0의 null 시각과 다른 편집 뒤의 정상 과거 시각을 허용하며, 미래 시각·회사/설정/카테고리 변경은 거절한다. 이 계획 단계는 GET만 사용한다.
- `BatchLabelDraftPanel`: 선택 상품과 옵션을 그대로 이어받는 검토 대기열이다. 화면을 열거나 옵션을 명시 선택할 때 실제 `ProductLabelEditor`의 초안을 한 번 요청한다. 이미지 번역 OFF와 별개로 작동한다. 수정·미확정 저장·PNG가 남아 있으면 작업 전환을 막고, 이전 옵션이나 닫힌 화면의 늦은 응답을 채택하지 않는다.
- `BatchWorkPanel`: 가격·이미지 검토 다음의 `다음: 한글표시사항 초안 작성`, 초안 검토 다음의 `다음: 저장한 표시사항 PNG 일괄 생성·연결`을 추가했다. 선택 상품 코호트를 단계 사이에 유지한다. 작업 목록에서 표시사항 초안 검토를 직접 시작할 수도 있다.
- `ProductLabelEditor`: 명시 작업에서만 상품/옵션 scope당 자동 초안을 한 번 요청한다. 저장 버전 갱신이나 effect 재실행으로 모델을 반복 호출하지 않는다. 직접 수정한 값과 공란을 보존한다. 확인된 저장 응답만 부모에 전달하며, 생성 이미지가 미적용·미확정 상태이면 이동 잠금을 유지한다.

기존 무료 Workers AI 표시사항 경로를 재사용한다. AI는 내용량·재질·상품 유형 3개 항목의 제안을 반환하며 자동 저장하지 않는다. 제조원·수입원 등 나머지 항목은 실제 저장 설정과 상품 자료를 사용하고 사용자가 확인한다. 새 provider·요금제·권한·DB migration·확장 변경은 없다.

## 검수

20개 고유 파일 **211/211 통과**, 실패·취소·skip·todo 0, 133518ms. source/config/test 1323개 SHA가 실행 전후 같다. 새 테스트 3파일 46건과 기존 배치 화면에 추가한 2건, 총 신규 48건이다. 부분 실행·재실행·양사 시나리오를 중복 합산하지 않는다. 타입, 앱/DB와 변경 테스트 린트, 메모리 스키마 검사(44 tables/17 indexes/29 runtime modules), 운영 빌드가 통과했다. 독립 4파일 소스 검토의 확정 문제는 0이다.

`outputs/step724-related-final-proof.json`, `step724-label-work-source-review.json`, `step724-label-autostart-proof.json`에 근거를 남겼다. 자동 시작 테스트의 초기 3건 실패는 조회 보류 fixture 관측과 객체 동등성 기대의 문제였으며 초기 시험·로그를 보존했다. 해당 수정 전후 앱 SHA는 같다.

브라우저 검증 환경에서도 두 실패를 별도로 보존했다. 첫째, 합성 저장소가 Range 요청을 무시해 전체 PNG를 반환하여 실제 첨부 API의 1024바이트 검사에서 거절됐다. 합성 저장소 어댑터만 실제 Range 동작에 맞췄으며 독립 12건 검사와 소스 대조를 했다. 둘째, 검증 스크립트가 표시사항 PNG를 일반 `productImages` 배열에서 찾았다. 실제 export 계약의 별도 `labelImages` 배열을 확인하도록 교정했다. 앱의 이미지 검사·소유권·버전·증명 guard는 완화하지 않았다. 실패 당시 서버·proof·ZIP·화면 근거를 보존한다.

수정한 격리 서버를 새로 시작해 같은 Chrome4에서 실제 React 초안·저장·PNG·견적 export를 다시 실행했다. 첫 포함 옵션에 내용량 `2개`, 재질 `실리콘`, 상품 유형 `생활용품`을 검토·저장했다. 생성 PNG는 800×548이며, 저장한 계획 SHA와 이미지 증명이 일치한다. export의 별도 `labelImages` 배열에 해당 옵션 참조가 한 번 들어가고, XLSX 셀 `image-005.png`와 ZIP 내 PNG 바이트의 SHA가 일치했다. 이는 fixture의 파일 순서이며 파일명을 고정하는 구현이 아니다. 모델 fixture 요청 1회, 명시 multipart 업로드 1회, 외부 요청 0, 원문/content/options/원본 이미지·공통 공란·다른 옵션 공란·제외 옵션은 그대로다. 브라우저 콘솔 오류/경고 0이다. 검수 탭과 서버를 종료했다.

이 브라우저 검수의 원문·계정·카테고리 양식·모델 응답은 합성 자료다. PNG 생성과 로컬 API/SQLite/ZIP/XLSX 실행만 실제 실행이다. `outputs/step724-browser-final-proof.json`, `step724-browser-qa/proof.json`, `step724-label-connected.png`, `step724-qa-fixture-review.json`에 범위와 근거를 남겼다. 준비된 확장 0.2.78 ZIP은 변경하지 않았고, 마지막 관측 설치 버전 0.2.72와 구분한다.

## 원본 전송과 미완료 범위

REA의 보관된 원본 근거를 다시 대조했다. 쿠플러스는 상품 또는 분리된 상품 그룹의 전체 옵션 배열을 한 문서로 구성하고 create 한 번의 docId로 update/validate한다. 옵션 한 개를 보여주는 화면 wrapper를 옵션별 문서 생성으로 해석하면 안 된다. 자세한 source range·SHA와 제한은 `step724-original-option-document-contract.md`에 기록했다.

이 소스 근거는 Supplier Hub가 실제로 받은 docId·qvtRequestId·SKU 대조가 아니다. 자체 Single의 옵션 1개 제한과 **SINGLE_DOCUMENT_LIVE_VERIFIED=false**를 유지한다. 기본 등록전송은 기존 Excel 대량 경로이며, 이 작업으로 실제 접수나 전체 기능 동일 구현을 주장하지 않는다. 허용된 새 상품의 원문·이미지와 실제 포장 사실, 실제 접수 증거가 아직 필요하다. 기존 작업 상품은 변경하지 않는다.

기존 무료 Worker `44d6d2fc-898f-4b2c-a09e-cb9d0ef45b31`에 배포했다. 주소는 https://sourceflow.jjwwhhjj1116.workers.dev/ 이다. 배포 후 첫 화면의 로그인 계정·제목·로딩 완료와 콘솔만 확인하며 기존 상품·설정을 열어 저장하지 않는다. 최종 commit/push·배포·SHA 검증은 `outputs/step724-final-validation.json`에 남긴다.
