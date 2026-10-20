# Step 759 — 추가 이미지 저장·사이즈표 결과·전송 원본 연결

기준 커밋 `1483f25`. 기존 실상품과 Couplus 작업 상품은 열거나 수정하지 않았다. 이번 변경은 단계별 편집 동작과 private 원본 API의 연결이며, 실제 1688 수집 또는 Supplier Hub 접수 완료를 의미하지 않는다.

## 대조한 REA 근거

변하지 않은 배포 JavaScript와 기존 화면 증거를 재사용했다. 같은 SHA를 다시 수집하거나 동일 producer를 반복하지 않았다. 아래 범위는 UTF-16, 끝 제외다.

- Couplus `outputs/step754-current-couplus/chunk-6b0db3f8.8a741991.js`, SHA `5b92873c674c4b76c0e6ce4961caedbf8728ca86f6a15b6d9dc8cdfce80ad1d9`: 추가 이미지 중앙 도구/하단 순서 `[67980,71380)`, 후보 미리보기 `[74180,75152)`, 드래그 `[76599,77553)`, ↑↓ `[77718,78556)`, 확인 후 삭제 `[78557,78912)`, 문서 저장 `[79952,80244)`, 명시 저장 `[80245,81137)`, ＋ 추가 `[85024,85978)`.
- 같은 Couplus: 상세 페이지 이동은 로컬 HTML 수정 `[121038,123060)`, 처리/원본 이미지 삭제 확인 `[123060,125176)` / `[126741,128445)`, 명시 상세 저장 `[132036,137106)`. 추가 이미지의 즉시 저장을 상세 페이지에 적용하지 않았다.
- 같은 Couplus: 사이즈표 처리→저장 결과/다운로드/재작성→수동 표 렌더 `[277426,282868)`, 수동 PNG 저장 `[286341,287665)`. 재작성은 기존 원격 파일을 먼저 삭제하는 동작이 아니다.
- Supplier Hub SR SHA `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`: 이미지 multipart/조회 `[2878532,2879318)`, 파일명 wire `[2857743,2860409)`, 상세 파일명 쉼표 연결 `[2874905,2875705)`, 다중 이미지 `[4111200,4113400)`. 공개 URL 기반 기존 payload와 파일명 기반 native body는 서로 다른 검토 대상이다.

## 단계별 화면과 입력

`OptionImageEditor`의 `saveOnChange`는 기본 false이며 실제 wizard의 추가 이미지 단계만 켠다. 후보 사진 클릭은 미리보기만 열고, ＋ 추가·↑↓·드래그·확인 후 삭제/비우기/복원은 기존 정확한 옵션의 CAS 저장→readback을 사용한다. 중앙 미리보기에 현재 선택한 사진의 편집/중국어·영어 번역을 모았고 하단에는 순서/삭제를 둔다. 저장 실패 또는 불확실한 결과는 draft를 보존하고, 명시 저장/조회 복구 전 다음 변경을 막는다. 독립 추가 이미지 편집기와 상세 이미지 단계는 명시 저장을 유지한다.

`SizeChartWorkspace`는 현재 상품의 저장된 사이즈표가 한 장이며 owner·상품 이미지 목록에 포함되고, product→content→product의 상품/버전/이미지 목록이 같을 때 결과 화면을 연다. 인증된 원본 미리보기·PNG 다운로드·확인 후 재작성으로 구성한다. 재작성 확인은 로컬 편집 모드만 열며 기존 파일·표·견적 참조를 즉시 바꾸지 않는다. 표 정보 저장/PNG 생성/첨부 후 새 저장본을 확인하면 결과로 돌아간다. 입력 중 단계 왕복과 기존 sourceStep/dirty 보호를 유지한다.

## 앱 원본에서 native multipart까지

새 읽기 전용 `GET /api/products/{id}/native-assets`는 명시적으로 opt-in한 별도 계획이다. 기본 `supplier-hub-single-package`의 공개 URL payload·review·fingerprint는 변경하지 않는다. 저장 원문 schema의 정확한 wire와 포함 옵션 순서, 회사·소유자·상품·버전·저장 revision·원본 해시를 사용한다.

- source plan은 private-key leaf 이름과 역할별 안전한 전송 이름, 파일명 기반 body, original/prepared body SHA를 만든다. 서버에서 원격 docId나 create checkpoint를 발명하지 않는다. 원문에 저장한 동의 true는 original body에 유지하고 prepared body 해시에서만 기존 준비 계약대로 false로 정규화한다.
- `?sourcePlanSha256=…&key=…`는 같은 현재 계획에 포함된 인증 원본만 돌려준다. 회사·회원 상태와 상품/옵션/견적/카테고리 source fence, 실제 파일 metadata/형식/길이/SHA를 반환 전 다시 확인한다. private/no-store/nosniff와 RFC5987 파일명을 사용한다.
- 네이티브 전용 안전한 read selection은 다중 사이즈표·라벨 원본도 읽을 수 있다. 기존 legacy 단일 이미지 제한과 기본 호출은 그대로다. 외부 키·다른 상품 pool·알 수 없는 wire는 읽지 않는다.
- 실제 API/SQLite 합성 integration에서 이 응답을 기존 `prepareNativeAssetMultipart`에 넣어 모든 파일 body와 파일명 wire의 일치를 확인했다. 테스트의 새 문서 checkpoint는 별도로 고정한 합성 값이며 실제 Hub create 결과가 아니다.
- 독립 검토가 발견한 한도 차이를 고쳤다. 고유 원본 20MiB를 여러 역할에 재사용해 70MiB의 multipart 부품이 되면 기존 consumer의 64MiB 한도와 같은 오류로 source plan부터 막는다. PDF는 기존 별도 8MiB 계약이다.

현재 source plan의 `bytesVerified`, `transportReady`, `registered`, `remoteWrites`, `submissionReady`는 false다. multipart 준비의 bytesVerified는 생성 시점 원본 검증일 뿐, 업로드·원격 저장·접수 증거가 아니다. FormData는 변경 가능한 객체라 미래 전송 직전에 다시 검증해야 한다.

## 검수 범위

23개 고유 파일의 207개 case가 최종 통과했다. 첫 run은 205/207이었고 기존 DetailPanel 테스트 도우미가 필수 onProfileSelected 콜백을 제공하지 않은 두 건을 수정했다. 기존 scope/mount/draft 단언을 유지한 6개 회귀를 다시 통과했다. TypeScript·변경 파일 ESLint·운영 빌드·생성 확장/ZIP·diff 검사도 통과했다. 원본 API·멀티파트 integration, legacy package/size/legal 회귀, 추가/상세 이미지 입력, 사이즈표 결과, Dashboard와 카테고리 단계 연결을 함께 검사했다. `outputs/step759-final-validation.json`에 최종 소스 SHA와 결과를 기록했다.

Chrome 2의 실제 DashboardClient와 실제 로컬 API/임시 SQLite로 새 합성 상품 하나를 검수했다. 후보 미리보기까지 쓰기 0, ＋ 추가와 ↑ 이동은 quotation-fields PUT 200 두 번이었다. 선택 파일 순서와 기존 합성 상품·파일 불변을 별도 proof로 확인했다. 화면은 `outputs/step759-ui/additional-instant-save.png`에 보관했다.

삭제 확인창 진입 후 CUA가 `Emulation.setFocusEmulationEnabled` 시간 초과를 반환해 브라우저에서 삭제 확정과 이후 사이즈표 결과 화면까지 완료했다고 주장하지 않는다. 확인창 accept/AX/Escape/탭 닫기도 같은 오류였다. 단위/실제 로컬 API 회귀의 확인 취소·확정·중간 scope 변경·사이즈표 결과 검증과 구분한다. 운영 사이트나 기존 상품에 대한 변경은 없다.

UI 합성 양식은 완전한 native identity를 제공하지 않아 package GET이 `409 SINGLE_IDENTITY`로 거절될 수 있다. 별도 native API integration은 완전한 합성 양식을 사용하며, 이 둘을 실제 원격 접수로 합산하지 않는다. 1688·Supplier Hub·native 외부 요청은 0이다.

기존 무료 Worker 버전 `b9c93707-a6cf-4e45-b458-e9a047294ca4`에 배포했다. 새 리소스·migration·권한·요금제는 추가하지 않았다. 확장 runtime 2.1.7 및 ZIP SHA `cc2302f6f10bc7d48b7c1477ff857f4b683b5940568b92d92b2f35ca7a2b50ff`는 불변이며 새로고침을 요청하지 않았다.

## 남은 경계

실제 native adapter에는 아직 owned-new-doc create→검토한 filename body→upload/list/readback checkpoint→update→최종 동의→docId/qvt/SKU receipt의 연결이 필요하다. 기존 공개 URL body 검토 해시 아래에서 파일명 body로 바꿔 보내면 안 된다. 두 `LIVE_VERIFIED` gate는 false를 유지한다. 실제 1688 제공자와 전체 카테고리/상태 UI 동일성, 최종 접수는 미완료다. 이전에 거절된 1688 접근을 브라우저·서버·확장·캐시 등 다른 수단으로 재시도하지 않았다.
