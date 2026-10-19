# Step723 — 작업 개시에서 이미지 번역 검토·견적 적용 연결

기준 커밋 `32499cc9320a2bc33c177ca97ed2695c62ebeb20`. 기존 ‘작업 개시’는 원본 이미지 역할 초안과 가격 계산까지만 실행했다. 이번에는 그 뒤 로그인 계정의 저장된 이미지 번역 설정을 읽고, 포함 옵션의 대표→추가→상세 이미지 검토 목록으로 이어지도록 구현했다. 첫 작업의 번역 미리보기를 준비하고, 다음 옵션·단계는 해당 작업을 선택해 이어간다. 모든 이미지의 무검토 일괄 저장이나 쿠플러스 전체 동일 구현 완료를 뜻하지 않는다.

## 구현

- `app/batch-image-work.ts`: 읽기 전용 계획·그룹 갱신. 설정 OFF이면 이미지 조회·OCR 없이 종료한다. 설정·owner·회사 scope를 전후 대조하고, 원래 collection category를 profile 쿼리로 바꾸지 않는다. 빈 이미지·상하단 설정 배너·제외 옵션은 유지한다. 견적 override 시각이 null 또는 상품 시각보다 과거인 정상 초안도 허용한다.
- `BatchImageWorkPanel`: 제품·옵션·단계별 검토 대기열. 상품당 한 그룹씩 처리하여 브라우저 메모리를 제한한다. 준비만으로 업로드하지 않는다. 미적용·미확정 결과가 있으면 다른 작업·뒤로 이동을 막는다. 이전 편집기 callback, 조회 중 callback, 닫힌 화면의 늦은 응답은 현재 선택을 바꿀 수 없다.
- `DetailImageBatchPanel`: 명시 작업 시작에만 자동 준비를 한 번 실행한다. 확정 저장 버전을 부모에 전달하고, 유실 응답은 같은 이미지의 읽기 복구로 확인한다. 개발 모드 effect 재실행 시 취소된 최초 조회가 화면을 잠그는 문제도 수정했다.
- `detail-image-batch.ts`: 기존 추가·상세 처리에 대표 이미지 단일 슬롯을 추가했다. 실제 원본·역할·현재 옵션·견적 연결과 CAS를 그대로 검사한다. 대표 이미지 변경으로 같은 행의 대표/상세 중복 안내만 달라지는 정상 파생값은 정확히 재계산하여 확인하며, 다른 셀 변경은 거절한다.

기존 무료 OCR·Google 번역 경로를 재사용한다. 배경 제거·생성 카피는 기존 별도 편집 흐름이며 이번 무료 문구 번역에 포함하지 않는다. 새 provider·권한·요금제·DB migration·확장 변경은 없다. 설치 확장은 마지막 관측 0.2.72, 준비된 ZIP은 0.2.78이며 서로 같다고 주장하지 않는다.

## 검수

20개 고유 테스트 파일 **360/360 통과**, 실패·취소·skip·todo 0, 240014ms. source/config/test 1318개 SHA는 실행 전후 같았다. 새 테스트는 4파일 58건이며 부분 실행이나 양사 시나리오를 중복 합산하지 않는다. 기존 work panel 테스트의 기존 단언은 유지하고 새 검토 화면 연결·pending 이동 잠금을 추가했다. 타입, 앱/DB·변경 테스트 린트, 메모리 스키마 검사(44 tables/17 indexes/29 runtime modules), 운영 빌드 모두 통과했다.

같은 Chrome4의 격리 서버에서 실제 React와 로컬 Tesseract로 합성 `中文商品` 이미지를 읽었다. Google 응답은 고정된 합성 한국어 응답이다. 원본/미리보기→검토 체크→대표 이미지 1개 저장→실제 로컬 견적 export를 실행했고 XLSX 파일명 `image-005.png`와 ZIP 이미지 SHA가 일치했다. 원본 바이트·제외 옵션·상하단 배너·content/options를 보존했다. 이어서 상세 단계로 이동하여 본문 1장만 준비하고 배너 2장은 제외한 뒤 미적용 결과만 폐기했다. 운영 데이터·실제 외부 요청·실접수 0, 콘솔 오류/경고 0이다.

첫 브라우저 저장은 합성 auth 응답과 달리 SQLite approved 회원 행이 없어서 정상 서버 guard가 409로 거절했다. 실패 proof/DB/AX를 보존하고 QA fixture에 실제 승인 회원 행을 추가한 후 재검증했다. 앱 guard는 완화하지 않았다. 신규 main 검사 초기 파생 안내 실패, UI의 조회 중 busy 해제와 effect replay 실패, planner의 초기 fixture goal 차이도 별도 로그로 보존한다.

주요 근거는 `outputs/step723-related-final-proof.json`, `step723-browser-final-proof.json`, `step723-browser-qa/proof.json`, `step723-image-applied.png`, `step723-image-work-source-review.json`, `step723-main-batch-proof.json`이다. REA 원본 전송 근거는 `step723-original-transmission-audit.md`에 분리했다.

## 실제 사이트 및 남은 범위

같은 Chrome에서 Supplier Hub 신규 개별/대량 빈 양식과 유앤채 회사코드 A01526306, 16개 최상위 분류, 미선택 동의 항목을 읽었다. 기존 견적서·상품을 열거나 수정하지 않았고 업로드·동의·제출하지 않았다. 실제 접수 증거가 아니다.

원본은 여러 옵션을 하나의 문서로 전송하며, 자체 Single은 옵션 1개 제한과 미검증 gate가 남아 있다. 현재 기본 등록전송은 기존 Excel 대량 경로다. **SINGLE_DOCUMENT_LIVE_VERIFIED=false**를 유지한다. 새 실상품의 원문·이미지·포장 사실과 docId/qvtRequestId/SKU 실제 대조는 아직 미완료다. 접근이 거절된 1688 대상을 다른 도구·확장·CLI·프록시로 우회하지 않는다. 필요한 실상품 자료를 비동기로 요청했으며 없는 사실을 만들어 제출하지 않는다.

기존 무료 Worker 배포 버전은 `b8f6dd30-73e1-441b-a09b-d922fd32cb32`, 주소는 https://sourceflow.jjwwhhjj1116.workers.dev/ 이다. 운영 상품·설정 쓰기 없이 첫 화면만 최종 확인한다. Git commit/push와 배포 후 검증은 최종 proof에 기록한다.
