# Step 758 — 단계별 입력·저장 방식 대조

기준 커밋 `49e4c84`. 기존 실상품과 Couplus 작업 상품은 열거나 수정하지 않았다. 이번 변경은 대표 이미지의 즉시 저장, 카테고리별 조건부 사이즈표 단계, 한글 표시사항 항목명 입력 방식을 다룬다. 전체 기능 동일성과 실제 접수 완료를 의미하지 않는다.

## 재사용한 REA 근거

새 원문 수집이나 동일 producer 반복 없이 보관된 동일 SHA의 실제 배포 JavaScript와 기존 스크린샷을 사용했다. 문자열 범위는 UTF-16, 끝 제외다.

- Couplus route SHA `5b92873c674c4b76c0e6ce4961caedbf8728ca86f6a15b6d9dc8cdfce80ad1d9`: 대표 후보 선택 즉시 option/document 저장 `[44092,46478)`. Wizard 전체 8개 `[288513,289146)`, 사이즈표 필터 `[289146,289485)`, 원문 required 조건 `[290169,290652)`.
- 같은 route: 표시사항 항목명 click/edit/Enter/blur/Escape `[149974,150410)`, 편집 화면 `[141629,145213)`. 여러 줄 내용, 저장→PNG→첨부→견적 연결은 기존 검증 흐름을 유지했다.
- Supplier Hub SR SHA `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`: 이미지 multipart/조회 `[2878532,2879318)`, 파일명 기반 본문 변환 `[2857743,2860409)`, 상세 이미지 쉼표 연결 `[2874905,2875705)`, 다중 이미지 UI `[4111200,4113400)`.

## 적용한 동작

### 대표 이미지

Wizard의 `imageView`에서만 `saveOnSelect`를 켰다. 후보 선택·비우기·자동값 복원은 기존 private GET→CAS PUT→정확한 저장 결과 조회를 사용한다. 다른 화면의 독립 편집기는 명시 저장을 유지한다. 중복 클릭과 잠금·옵션·화면 변경은 실제 PUT 전에 막으며, 실패한 선택을 보존하고 불확실한 결과를 자동 재시도하지 않는다. 명시 복구 버튼으로 결과를 먼저 확인한다.

### 카테고리와 사이즈표

새 읽기 전용 `registration-layout` API는 기존 `stableQuotationFieldsView`가 선택한 회사·상품·캡처/프로필·원문과 최종 source fence를 그대로 사용한다. 원문 `properties.imagePage.properties.images.properties`가 있고 `images.required`에 `sizeChartImage`가 있을 때만 상세 이미지 다음에 사이즈표를 삽입한다. 카테고리 이름, 기존 이미지, nullable 필드나 추정 의류 분류로 판단하지 않는다.

회사/상품/프로필과 상품 버전의 응답 토큰을 분리해 A→B→A 늦은 응답을 버린다. 같은 카테고리에서 버전만 다시 읽을 때는 직전 단계 이름을 표시용으로 유지하되 새 응답 전에는 단계 이동을 막는다. 다른 소유자·상품·프로필에는 이 표시도 넘기지 않는다.

`SizeChartWorkspace`는 단일 인스턴스를 숨김/표시하므로 입력 중 다른 단계로 이동해도 표를 잃지 않는다. 미저장 표가 있으면 견적서를 열 때 해당 단계로 돌아간다. 필수 여부와 관계없이 옵션 보드와 추가 작업에서 사이즈표를 직접 열 수 있다. 단계 수가 달라도 잘못된 번호를 안내하지 않도록 보조 문구의 고정 `7단계` 표현을 정리했다.

### 한글 표시사항

항목명 클릭→포커스/선택, Enter 또는 blur→비공란 이름을 구조 초안에 확정, Escape→후보만 취소한다. 이름 후보가 남아 있으면 dirty 보호와 저장·생성·드래그·참조 변경 잠금을 적용한다. 원문·옵션·활성 화면 변경 뒤 늦은 입력 이벤트는 확정하지 않는다. 본문은 기존 여러 줄 입력을 유지하며, 정보 저장은 기존 CAS/PNG/연결 검증을 그대로 사용한다. 삭제·복원 확인창 등 아직 남은 Couplus UI 차이를 이번 변경에서 완료했다고 주장하지 않는다.

### Native multipart 준비 구성요소

새 `native-asset-multipart.mjs`는 independently supplied expected identity/plan SHA/new-document target과 이미지/PDF bytes를 검증해 요청 기술자와 파일명 바인딩만 만든다. 이미지의 `additionalImageFiles`, 법적 첨부의 `uploadFiles`, 역할·슬롯·파일명 순서를 보존한다. fetch, 쿠키, 실제 업로더/adapter 연결은 없다.

FormData는 반환 후 변경 가능한 객체다. SHA 검증은 생성 시점만 증명한다. 미래 dispatcher는 전송 직전에 본문 filename/type/length/SHA와 회사·원문·옵션·새 문서 identity를 다시 확인해야 한다. 현재 `actualUploadVerified`, `transportReady`, `registered`, `remoteWrites`, `submissionReady`는 false이고 기존 두 live gate도 false다.

## 검증

- 관련 38개 고유 파일, 377개 고유 case 최종 통과. 별도 worker/focused 반복 실행을 더하지 않았다.
- 첫 31파일 run은 314/315. 기존 DetailPanel 테스트 도우미가 새 필수 `onProfileSelected` 콜백을 제공하지 않은 한 건을 수정했고, 기존 scope/mount/draft 단언을 유지한 4개 Dashboard와 5개 hook 회귀를 통과했다. 이어 보조 문구/입구 관련 7파일 62개를 통과했다.
- TypeScript, 변경 파일 ESLint, 운영 빌드, 생성 확장/ZIP 검사, diff 검사 통과. 독립 읽기 검토에서 새 navigation/보존 경계와 multipart 생성 시점의 재현 가능한 결함은 발견하지 못했다.
- 실제 DashboardClient, 실제 로컬 API/임시 SQLite와 합성 수집 원문/AI/이미지로 격리 검수했다. 최종 run의 새 상품 하나에서 대표 이미지 PUT, 표 정보 PATCH→PNG POST201→첨부 POST200, 라벨 text PUT→PNG POST201→첨부 POST200→견적 참조 PUT, 견적 모델명 직접 수정 PUT까지 9개 쓰기 성공을 확인했다.
- 화면에서도 사이즈표의 가격 단계 왕복 후 보존·미저장 견적 진입 시 복귀, 이름 Escape 취소·Enter 확정·여러 줄 본문, 라벨 생성 완료 화면, 최종 견적의 대표/사이즈/라벨 파일 참조와 `QA-758` 저장을 확인했다. 기존 합성 상품 연결 행과 파일 SHA는 불변이다.
- 첫 합성 양식은 `couplus-paths-v1` 입력 바인딩 표식을 빠뜨려 사이즈표 필드를 일반 문자열로 보여줬다. 이전 proof를 보존하고 검수 fixture만 보완해 최종 run을 분리했다. 최종 fixture도 완전한 native 분류·고시·버전 식별자가 없어 package 조회는 `409 SINGLE_IDENTITY`로 거절됐다. 이 거절을 접수 검증으로 세지 않았다.

증거: `outputs/step758-final-validation.json`, 재현 producer `outputs/step758-final-proof.mjs`, 전체 UI harness `outputs/step758-browser-qa.mjs`, `outputs/step758-ui/` 스크린샷. 실제 1688/Hub/native 요청은 모두 0이다.

## 배포와 남은 필수 작업

기존 Worker 최종 버전 `56823356-748c-449e-bc8b-d42ef205be24`에 배포했다. 새 리소스·migration·AI 요금제·확장 권한은 추가하지 않았다. 확장 실행 버전 2.1.7은 그대로이며, ZIP에 아직 연결하지 않은 새 순수 모듈을 포함해 86파일/1,008,312 bytes, SHA `cc2302f6f10bc7d48b7c1477ff857f4b683b5940568b92d92b2f35ca7a2b50ff`다. 이 변경 때문에 사용자에게 확장 새로고침을 요청하지 않았다.

실제 1688 수집의 현재 제공자 동등성, 모든 카테고리/상태의 세부 UI 동일성, native multipart·packet 운송 연결, 동의 처리와 원격 docId/qvt/SKU terminal 접수는 아직 완료되지 않았다. 이전 거절된 1688 접근을 다른 수단으로 재시도하지 않았다. 기존 작업 상품 보존과 두 회사/소유권/원문 검증을 유지한 채 실제 새 상품의 유효 사실과 완전한 공식 양식으로 운송·접수 경계를 연결·검증해야 한다.
