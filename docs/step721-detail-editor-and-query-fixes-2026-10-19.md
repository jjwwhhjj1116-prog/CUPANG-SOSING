# Step721 — 상세 사진 편집 모달·반복 조회·삭제 목록 페이지 보완

2026-10-19. 기준 HEAD `0c9f9ae3037a4494fdf31c6022e36fad198b54ac`.

이번 변경은 ① 5단계 사진 편집을 큰 중앙 모달로 여는 연결, ② 실제 React/Chrome에서 발견한 일괄 이미지·분할 적용 패널 사이의 반복 GET, ③ 삭제된 상품 200개 이후에 접근하지 못하는 목록 한도를 보완한다. 무료 OCR은 기존 기능을 실제 브라우저에서 추가 검수한 것이며 새 OCR 기능 구현으로 세지 않는다.

**최종 전체 aggregate와 운영 배포는 작성 시점 pending이다.** 아래 작업별 focused/subset 결과를 전체 완료나 배포 성공으로 해석하지 않는다. 원본 정적 분석, 자체 로컬 브라우저 실행, 합성 API/SQLite 검사도 각각 구분한다.

## 1. 5단계 사진 편집: 원본 모달 표현 연결

상세 원본 대조는 [상호작용 감사](step721-image-interaction-parity-audit.md)에 있다. 보관된 shipped JavaScript에서 Stage3·4는 inline `ImageEditor`, Stage5는 `editProcessedGroup` → `showEditor` → 중앙 `xl`·제목 `이미지 편집`의 `b-modal` 연결을 확인했다. 정적 클라이언트 구문이며 원본 provider/외부 iframe의 실제 편집·저장 성공을 관찰한 증거는 아니다.

수정 전 자체 `DetailPanel`의 실제 Stage5 카드 callback을 VM에서 호출하면 정확한 source/quotation target은 편집기에 도달하지만 dialog 수는 0이었다. 이 재현과 첫 selector 오류를 각각 `outputs/step721-original-prechange-reproduce.json`, `...-harness-miss.json`에 보존했다.

- 변경 파일: `app/components/detail-image-edit-dialog.tsx`, `detail-workspace-panel.tsx`, `dashboard-client.tsx`.
- Stage5 최종 옵션 사진, 공통 상세 역할 사진, workspace 사진 편집을 큰 모달로 연결한다. Stage3·4의 inline 표현은 유지한다.
- 같은 child 위치를 유지하며 열림 조건으로 편집기를 교체하지 않는다. 닫기·배경·Escape는 기존 live dirty/busy/pending/저장 결과 불명 guard를 따른다. focus/Tab·형제 inert·오래된 source/option/version callback 방어를 연결한다.
- 원본의 일부 즉시 저장과 자체의 초안·명시 저장 정책 차이는 유지한다. 원격 iframe 내부 도구·원본의 느슨한 완료 판정·timeout fallback을 복제한 변경은 아니다.

최종 전용 2파일 **15/15** 통과, 별도 관련 6파일 **99/99** 통과가 작업자 proof에 기록돼 있다. 99개에는 앞선 신규 9개가 포함되고 최종 15개에도 겹치므로 **114개로 합산하지 않는다**. dialog unit은 DOM adapter, 부모 integration은 자식 stub을 사용한다. child type/props와 guard 검증을 실제 React 내부 상태·픽셀 지속성 전체의 증거로 확대하지 않는다. 해당 작업자의 lint/type 검사 0 보고도 root의 최종 통합 검사를 대신하지 않는다.

근거: `outputs/step721-original-final-proof.json`, `...-dialog-focused-final.log`, `...-dialog-related-final.log`.

## 2. 실제 Chrome에서 발견한 batch ↔ family 반복 GET

root의 실제 Chrome4·React 로컬 QA에서 Stage5를 열어 놓기만 해도 `/quotation-fields` GET과 disabled UI 전환이 반복됐다. 실제 로컬 handler 요청에는 quotation-fields 200과 detail-family 403이 있었다. 성공 응답 여부와 무관하게 생기는 부모·자식 의존성 순환이었다.

`Dashboard`는 일괄 이미지 패널의 busy를 분할 적용 패널의 disabled로, 분할 패널의 busy를 일괄 패널의 disabled로 전달한다. 두 자식은 disabled 변화마다 자동 조회를 시작했다. family 종료 → batch 잠금 해제·GET·busy → family 잠금 → batch 종료 → family 잠금 해제·GET·busy가 반복됐다. `OptionImageEditor`는 이미 같은 saved-source 조회 guard가 있어 직접 원인보다는 반복 잠금의 영향을 받았다. 해당 파일은 수정하지 않았다.

실제 TSX 두 자식을 같은 부모 busy callback 상태로 연결한 신규 fixture에서 선재현했다. 응답 전에 부모 busy가 commit되도록 지연하면 family **200과 403 모두 45 render turn 안에 24 GET**을 만들며 정착하지 않았다. 변경 전 6개 중 1 pass·5 fail 로그와 두 원문 소스를 보존했다. 즉시 resolve한 Promise가 첫 순환을 숨긴 초기 진단 로그도 남겼다.

- 변경 파일: `app/components/detail-image-batch-panel.tsx`, `detail-family-apply-panel.tsx`.
- 자동 조회를 정확한 기준에 묶는다. batch는 product/option/profile/stage/version/refresh, family는 product/profile/version/refresh를 쓴다. busy/active/disabled는 조회 기준이 아니라 실행 제어다.
- 성공 또는 오류로 끝난 같은 기준의 조회는 다른 패널 잠금 해제로 반복하지 않는다. 시작하지 못한 조회는 기록하지 않고, abort된 조회는 자기 attempt만 해제해 unlock·실제 기준 변경 후 다시 읽는다.
- family의 명시 재조회는 유지한다. batch 초기 조회 오류에는 `저장 이미지 다시 확인` 버튼을 제공한다. 자동 OCR·번역·쓰기나 다른 상품으로의 결과 이전은 추가하지 않는다.
- 기존 prepare generation, pending/uncertain·저장 guard는 유지한다. 복원한 pending의 GET-only 복구가 끝났다고 catalog GET을 덧붙이지 않도록 현재 자동조회 기준을 seal한다. 다음 조회는 부모의 실제 refresh 또는 명시 재조회가 맡는다.

신규 고유 검사는 **6개**다. 최종 신규 6개 + 기존 family 10개 **16/16**, lint 3파일 exit 0, source diff check 0, 새 테스트 whitespace 검사 0을 확인했다. 기존 batch 14개는 같은 최종 batch SHA에서 앞선 관련 실행으로 통과했다. 그 앞선 실행 전체는 **30개 중 29 pass·1 fail**이었으며, 복구 뒤 불필요한 catalog 조회 1건을 소스에서 고친 뒤 family 10개를 다시 통과시켰다. 기존 assertion은 바꾸지 않았다. 이를 최종 단일 실행 30/30이나 46개 검사로 표시하지 않는다.

새 회귀는 co-mounted callback·Object.is·render-phase restart·layout/passive commit adapter와 지연 transport fixture를 사용한다. native React/실제 backend 실행은 root 브라우저 근거와 별도다. root 독립 읽기 리뷰는 findings 0이며, 정확한 idle 요청 수의 브라우저 수정 후 확인은 root 최종 기록을 따른다.

근거: `outputs/step721-browser-before-requests.json`, `...-ocr-idle-before-proof.json`, `...-ocr-idle-before.log`, `...-ocr-idle-related-before-recovery-fix.log`, `...-ocr-idle-focused-final.log`, `...-ocr-idle-proof.json`, `outputs/step721-idle-independent-review.json`.

## 3. 삭제된 상품 200개 이후 복원 접근

격리 SQLite에 owner 삭제 상품 201개와 다른 owner 상품을 넣은 재현에서 기존 삭제 목록·dialog는 복원 버튼 200개만 노출했다. 누락된 상품도 ID를 알면 직접 복원 요청은 HTTP 200이어서, 복원 권한 부재가 아니라 목록 잘림이었다. 초기의 “삭제 상품 개별 GET은 404” 가정은 실제 기존 GET 200 계약으로 반증됐으며, 잘못된 가정의 실패 로그를 앱 결함 선재현으로 쓰지 않는다.

- 변경 파일: `app/api/products/removed/route.ts`, `app/product-removal-pagination.ts`, `app/components/product-removal-dialog.tsx`, `db/queries.ts`.
- 전용 `GET /api/products/removed`에 인증 owner 범위의 cursor 페이지를 추가한다. 정렬은 `removed_at DESC, product_id DESC`, 기본 50개·최대 100개다. 기존 `/api/products?removed=only` 계약은 유지한다.
- dialog에 이전/다음 페이지와 첫 페이지 새로고침을 제공한다. 오래된 페이지·owner·unmount callback은 복원을 시작하지 못한다.
- 복원 DELETE body, product-version·removed_at CAS, 접수 이력 보호와 연관 자료·파일 보존은 유지한다.

신규 6개 + 기존 backend 10개 + 기존 dialog 8개 **24/24** 통과, scoped lint 0·diff check 0이 기록돼 있다. 같은 삭제 시각의 203개를 5페이지에서 중복 없이 방문하고, 실제 dialog·로컬 route에서 201번째를 복원하며 남은 200개를 보존했다. 다른 owner cursor, 잘못된 query, 경계 행 복원, 교체된 삭제 마커, 늦은 callback도 검사했다. 합성 owner/auth·SQLite/hook adapter 범위이며 운영 자료나 실회원 증거는 아니다.

**384MiB TypeScript 시도는 heap OOM으로 exit 134, 검사 미완료**다. 타입 진단이 없었다고 타입 통과로 표시하지 않는다. root의 최종 전역 검사 결과는 pending이다. 삭제 목록 pagination의 native browser 검수도 작업별 proof와 별도로 root 결과를 따른다.

근거: `outputs/step721-management-pagination-proof.json`, `...-pagination-initial.log`, `...-pagination-typecheck.log`, `...-removal-initial-assumption.log`, `outputs/step721-removal-independent-review.json`.

## 실제 Chrome4 무료 OCR → 직접 한국어 편집 → PNG 저장

root는 승인된 foreground 로컬 React 서버의 실제 Dashboard에서 합성 중국어 글자 사진을 선택했다. native browser Tesseract Worker의 중국어 OCR, UI에서 한국어 직접 입력, 실제 Canvas PNG 미리보기, 실제 로컬 `image-text` multipart API·SQLite·private-file fixture 적용을 완료했다. 이 실행의 번역 문구는 **UI 직접 입력**이며 Google 번역 요청을 실행하지 않았다.

`outputs/step721-browser-save-proof.json`과 생성 script는 저장된 content를 다시 읽고 원본·결과 파일을 조회해 아래를 확인한다.

| 항목 | 확인값 |
| --- | --- |
| 합성 상품 / 원본 key | `synthetic-document-652` / `owner/detail-body.png` |
| 원본 SHA-256 | `5237b35b0d75718628f4d4e41e9a186f6d6cb13f8345977f02acb597b159d1c5` |
| 편집 PNG SHA-256 | `71c2c040c0301884c2c4e24ee2de9d7aa992334412843627b0dcbb3db96f6f04` |
| 결과 크기 | 780 × 180 px, 8,916 bytes |
| 저장 역할 | 본문 detail을 새 private PNG로 연결; detailTop/detailBottom 배너 역할 유지 |
| 원본 | 기존 private 원본 파일과 SHA 보존 |

저장 key는 source identity와 결과 SHA를 포함한 `owner/free-image-synthetic-document-652-…-71c2c040…png`다. 요청 기록은 source/원본 GET 200, `image-text` POST 200, content·원본·결과 GET 200을 포함한다. 화면·픽셀 근거는 `outputs/step721-browser-ocr-applied.png`, `...-applied-ax.txt`, `outputs/step721-browser-edited-korean.png`, 요청은 `outputs/step721-browser-ocr-requests.json`에 있다. 위 save proof SHA-256은 `b53bbc01685234852be138f01e13595c5b8f81fab4002693f384c15898105dd9`다.

이것은 코드 생성 글자 PNG, 합성 auth/SQLite/private files를 사용하는 로컬 검수다. 실제 1688 수집·원본 사이트 요청·Google 요청·유료 이미지 생성·Supplier Hub 전송·기존 실상품·운영 자료 변경은 0이다. 글자 사진 한 장의 성공을 상품 사진 전반의 OCR 정확도나 모든 category/company의 저장 성공으로 확대하지 않는다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`와 기존 전송 gate를 유지한다.

앞선 감사는 실제 public browser bundle의 LSTM 초기화, 6개 URL 분기, public/dist 17개 자산의 SHA 일치를 확인했다. 이것은 Node SDK getCore 어댑터와 구분한 VM 증거다. 당시 Miniflare ASSETS 확인의 loopback EACCES 실패는 로그에 남겼으며 앱 결함으로 분류하지 않았다. root가 정상 foreground 서버를 열어 실제 Chrome 검수를 진행한 후의 결과가 위 저장 근거다. 그 사실로 운영 CDN/Access/CSP/MIME·IndexedDB cache 전체 검증까지 완료됐다고 주장하지 않는다.

## 동결 근거와 최종 통합 상태

| 묶음 | 동결·검수 기준 |
| --- | --- |
| 원본 모달 연결 | `outputs/step721-original-final-proof.json`에 3앱·2테스트·원본 감사 문서별 SHA; proof SHA `5cdf4e53bcb45d2fbed0b9346962c2dc20c4a0a348778216d6cc202b74474cc6` |
| 반복 GET | batch `67f8086305f48f03ab19803fb2e181d36f55d5f5c4bc4734ae5a1cc5db1bf576`; family `d90bc8aa586cc1c95b7467ab8592bd259e2081d1c2ad0c02bf4f8bc67826d762`; 신규 test `602f287aaca6e14a4f4bd8beffd9f6c2f34f3b4cdbbb4bda2061cf61a0e98238` |
| 반복 GET proof | `outputs/step721-browser-ocr-idle-proof.json` SHA `b3bbe5629385d6a91569a68917325f23214fe8c2f6c4fb6975aec939288e907a` |
| 삭제 목록 | `outputs/step721-management-pagination-proof.json`에 4앱·2테스트 SHA; proof SHA `edb0895a432e236b3f2aaec5447e9ec3057a26465a3cd95535bb51b3f1ae5545` |

위 hash는 최초 작업별 동결 기준이다. 최종 모달에는 실제 Chrome 후검수에서 발견한 로딩 중 초점 이탈 보강을 추가했다. 현재 모달 SHA는 `c1a0ce01dd48e951c0eb830029934e750133435695dff8dfcdbf9ab1691b0764`이며 이전 원본 모달 SHA를 대체한다. 두 신규 회귀는 이전 소스에서 실패하고 수정 후 통과했다. 마지막 Chrome에서 로딩 중 dialog 내부 초점, Tab/Shift+Tab 순환, 미저장 한국어 초안의 Escape 보호, 정리 후 원래 카드로 초점 복원을 확인했다. `outputs/step721-browser-final-proof.json`과 `...-final-modal.png`가 최종 브라우저 근거다.

중복 React key는 합성 이미지 SHA 때문이 아니었다. 7단계의 형제 `QuotationWorkbookReview`·`LegacyQuotationImport`가 같은 key를 사용했다. 각각 `workbook:`·`legacy:` 접두사만 추가해 기존 revision/fingerprint/changes 기준을 보존했다. 변경 후 실제 Chrome 콘솔 오류·경고는 0이었다. 이 사실만으로 종전 데이터 손실을 단정하지 않는다. 원본 외부 iframe 도구·provider 내부·서버 transaction과 전체 Couplus 동등성은 여전히 미확인이다.

| root 최종 항목 | 작성 시점 상태 |
| --- | --- |
| 전체 관련 파일 aggregate | 최종 **20개 파일 / 298개 검사 전부 통과**, 실패·취소·skip·todo 0; 1,311개 source/config/test hash 변경 0 |
| 최종 전역 types / lint / build | types 통과; lint 오류 0·기존 경고 6; 스키마 44개 테이블/17개 인덱스/29개 모듈 일치; 운영 빌드·고정 OCR·확장 ZIP 검사 통과 |
| 운영 배포·운영 버전·배포 후 검수 | 기존 무료 Worker 배포 성공, `a45cdff1-af7b-43ed-87cc-3468f3462d17`; 같은 Chrome4의 운영 첫 화면 정상·콘솔 오류/경고 0; 상품/단계/설정 편집 0 |

초기 185/170/15 실패는 보존했다. 오래된 5개 custom React fixture는 원래 assertion 원문을 보존하고 wrapper 자식 전달·layout effect·현재 SizeChartWorkspace 계약을 반영했다. HEAD에서도 layout 미지원 9건과 이전 size 편집기 가정 1건을 재현했다. 다음 187/187 통과 실행은 중간 근거이며 최종 수치에 합산하지 않는다. 확대된 견적서 테스트 1개 파일은 heap256 MiB에서 OOM(exit134)했으며 source 변경 없이 heap512 MiB의 최종 20개 파일 실행에서 298/298 통과했다. 관련 로그와 초기 lint의 기존 helper export `module` 규칙 오류를 보존했다. helper의 ESM export 별칭은 유지하고 지역 변수 이름만 정리했다.

최종 결과는 `outputs/step721-final-validation.json`, 실행 로그는 `step721-related-final.log`·`step721-types.log`·`step721-lint.log`·`step721-schema.log`·`step721-build.log`·`step721-deploy.log`다. 확장 ZIP 0.2.78은 기존 SHA 그대로이며 확장 새로고침을 요청하지 않았다. 실제 1688 신규 수집과 Supplier Hub 실접수는 이 검수에 포함하지 않으며 `SINGLE_DOCUMENT_LIVE_VERIFIED=false`를 유지한다.
