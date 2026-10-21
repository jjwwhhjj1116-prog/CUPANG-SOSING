# Step771 — 새 수집본 진입 차단 수정과 상세페이지 도구 정리

기준 커밋은 `9913701d801e72e842012f164fea584698419a05`이다. 기존 업무 상품·원본 사이트 작업 상품을 열거나 수정·삭제·전송하지 않았다. 새 합성 상품과 임시 SQLite에서 기존 애플리케이션/API를 검수했으며 실제 1688 수집이나 Supplier Hub 접수 성공으로 해석하지 않는다.

## 새 수집본의 카테고리 선택

기존 Dashboard는 products/settings/collection-jobs/category-profiles 중 하나라도 조회가 실패하면 공통 `loadError`를 만들고, 그 상태에서는 수집함의 새 상품을 카테고리 선택으로 보낼 수 없었다. 따라서 **과거 작업 목록 한 건의 손상**도 새 상품 등록을 막았다.

수집본 진입 가용성을 별도로 기록한다. products/settings/categories 조회, 승인 회사와 현재 owner가 모두 확인돼야 한다. 이전 collection-jobs 목록 조회만 실패하면 전체 경고는 유지하면서 새 수집본의 카테고리 검토를 열 수 있다. 설정·상품·카테고리 조회 실패나 회사/owner 불일치를 허용하지 않는다. 렌더 snapshot·owner scope·unmount·계정 전환 ABA와 보관한 오래된 콜백을 확인하며, 새 POST의 설정/양식 revision 검증도 유지한다. 자동 수집·이전 요청 수정·알 수 없는 저장의 자동 재시도는 추가하지 않았다.

`tests/dashboard-source-availability.test.mjs`는 양사에서 실제 임시 SQLite의 이전 context JSON 손상으로 목록 GET503을 만들고, products/settings/categories GET200 및 새 guarded collection POST200·정확한 새 job GET200을 확인한다. 설정/양식 revision 변경 POST409, 이전 손상 context 원문 불변, 생성 상품·파일 0을 확인한다. 이 검사는 진입과 요청 생성 경계이며 실제 1688 조회·초안 import·Hub 전송은 하지 않는다. Step770의 개별 초안 실제 API 수직 테스트는 이번 합집합에도 포함했다.

## Couplus 상세 단계와 대조한 변경

설치된 REA v37 지침에 따라 같은 보관 출하 코드와 기존 Evidence를 재사용했다. Couplus route SHA256은 `5b92873c674c4b76c0e6ce4961caedbf8728ca86f6a15b6d9dc8cdfce80ad1d9`, 부모는 `ev_69740e390a2cc1e539a4a65a84e5c7065e2e6db9dcbc8a6311d0b4bfce5a3166`, 요약은 `ev_26cdc76017d63fa2bb683d4165db034bae99266f6a3ad48bb3b45253f2ce9634`다. 실패했던 부모 조회나 동일 producer를 다시 실행하지 않았고 새로운 Evidence ID를 만들지 않았다. `outputs/step771-rea-detail-ui.json`에 원본 renderer 8범위·자체 대응 5범위 및 조각 SHA를 남겼다. 자체 SHA는 분석 당시 값이며 최종 파일과 구분한다.

원본 Stage5는 업로드·통합 다운로드·전체 번역/처리·저장을 상단에 두고 사진 목록으로 이어진다. 기존 자체 구현에 번역·합치기·수동 편집·사진 정렬·삭제가 이미 존재하지만, 긴 안내와 중복 언어 선택·ZIP·작업 구성으로 분산돼 있었다. 이번 변경은 새 백엔드를 중복 생성하지 않고 다음 표시만 바꾼다.

- 상세 단계의 기존 batch controller에만 간결한 표시를 적용한다. 두 명시적 언어 버튼과 사진/배너 수는 먼저 보이고 언어 select·중립 안내는 `번역 설정·안내`에 접는다. 원본의 AI 동작과 현재 OCR+번역의 품질이 같다는 의미는 아니다.
- 원본 ZIP·사용 안내는 선택 옵션의 `사진 편집 안내·원본 ZIP`에서 연다. 이미 기본 노출된 통합 controller는 한 번만 유지하며 다운로드·합치기는 보이고 안내만 접는다.
- 각 사진의 **번역·수정**과 **순서·삭제**를 별도 그룹으로 나눈다. 기존 버튼명·handler·확인·보호 배너·dirty/잠금·unknown ACK·정확한 옵션 저장 범위는 그대로다. 파일명으로 번역 완료를 추정하거나 원본/결과를 임의 분류하지 않는다.
- 오류·중단·검토 checkbox·알 수 없는 저장 결과 확인·전체 옵션 상세 저장의 범위/HTML 비우기 확인은 계속 바깥에 노출한다. 추가 이미지·공통 작업과 자동 실행 정책은 유지한다.
- 견적서 모델/태그 안내와 글자 수 사이 간격도 보완했다. 입력/저장 규칙은 바꾸지 않았다.

원본 previewMode의 실제 진입은 보관 renderer에서 확인하지 못해 구현 근거로 사용하지 않았다. 모든 카테고리·상태·CSS의 완전 동일성이나 새 생성형 AI 기능 완료를 주장하지 않는다. 원본 코드를 제품에 복사하지 않았다.

## 브라우저와 회귀 검수

기존 Chrome의 별도 localhost 탭에서 새 합성 수집본·유효 32×32 PNG 6개·실제 Dashboard/API/임시 SQLite를 사용했다. 상단 버튼과 사진별 두 그룹, 접힌 3개 안내, batch/composite 각 controller 1개를 확인했다. 사진 순서 수정은 서버 쓰기 0이고, 명시 저장 후 선택 옵션 `quotation-fields PUT200` 한 번만 발생한다. reload 후 새 순서가 유지되고 7단계 상세 이미지 항목도 같은 순서다. 공통/다른 옵션/수동 HTML/원문/content/options/파일/표시사항 값 및 보호 합성 상품은 불변이다. 표시사항 fingerprint와 product version의 견적 변경 반영은 정상 확인했다.

검수 화면은 `outputs/step771-ui/detail-reloaded.png`, 비교·DOM 관찰·원본 응답·컴파일 산출물 SHA는 `outputs/step771-browser-proof.json`에 있다. 실제 source/Hub/native 요청 0, `submissionReady=false`다. 브라우저에서 번역·합치기·다운로드·동의나 전송은 실행하지 않았다. 해당 동작의 명시적 검토·저장·ACK·원본 보존은 컴포넌트/API 회귀로 검증한다.

최종 고유 파일 목록·동결 SHA·결과는 `outputs/step771-final-test-files.json`, `step771-final-test-source.json`, `step771-final-coverage.json`과 `step771-final-validation.json`에 기록한다. 앞선 집중·반복 검사는 합산하지 않는다. 타입·운영 빌드는 통과했으며 변경 TS/TSX/테스트의 lint는 오류·경고 0이다. 기존 확장 2.1.12·ZIP·권한은 바꾸지 않으며 새로고침을 재요청하지 않는다. 기존 Worker만 배포하고 신규 리소스·DB 마이그레이션·Access 정책 변경은 없다.

최종 범위는 **22파일·241건**이다. 최초 실행은 239건 통과·기존 위치 삭제 fixture의 양사 2건 실패였다. 해당 fixture는 본문과 같은 파일을 상단 배너로 지정하고 첫 배너 삭제를 눌러, 현재 코드뿐 아니라 HEAD 원문에서도 올바르게 거절됐다. 기존 2건을 최초 집계에서 전부 제외하고, disposable SQLite에만 반복 본문을 두고 해당 본문 위치 하나를 삭제하도록 교정해 2/2 재검사했다. 상·하단 배너 잠금, 저장 전 무쓰기, 공통·타옵션 HTML·원본 보존과 실제 XLSX/ZIP 참조 검증을 유지했다. 새 중복 본문 쓰기는 운영 content API가 계속 거절한다. 생산 보호를 완화하지 않았다.

따라서 최종 coverage는 바이트가 같은 21파일·239건과 교정된 1파일·2건이며, 한 번의 Node 실행이 전부 성공했다고 주장하지 않는다. 최초 실패, HEAD 동일 실패 재현 및 최종 로그를 모두 보존했다. 초기 source JSON과 최종 coverage SHA의 차이는 이 fixture 파일뿐이다.

## 실제 접수 검증의 경계

기존 native 전송은 원본 바이트 검증·업로드 후 목록 metadata를 확인하지만 원격 파일을 재다운로드하는 검증 계약은 없다. 보관 Hub 코드 `outputs/step548-hub-main.js`의 이미지 표시 URL 조합 `[2879017,2879183)`은 존재하나, 그것만으로 원본 동일성·CORS·신뢰할 CDN을 확정할 수 없다. PDF 다운로드 계약도 미확인이다. `outputs/step771-native-gap.json`에 위치·SHA·자체 코드 흐름을 기록했고, metadata의 임의 호스트를 신뢰하는 fetch나 권한 확대, 미연결 검증 모듈은 추가하지 않았다.

이전 자동 승인 검토가 거절한 1688 직접·간접 재접근을 CLI·확장·서버·프록시로 시도하지 않았다. 실제 1688 수집·전체 AI 품질·모든 1~7단계 UI 완전 동일성·Hub 실제 업로드/readback·최종 동의와 docId/QVT 접수·옵션별 SKU 대응은 미검증이다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`, `PRODUCT_DOCUMENT_LIVE_VERIFIED=false`, `remoteBytesVerified=false`, `actualUploadVerified=false`를 유지한다. 합성 성공이나 저장된 metadata를 실제 접수로 보고하지 않는다.
