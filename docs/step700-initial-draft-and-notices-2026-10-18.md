# Step700 — 최초 초안 진입과 법적 고시 기본값

2026-10-18 KST. 기준 `93f89deefd407910aab1932f300f04d398e96ab4`. Couplus 보관 원본과 자체 신규 수집 흐름을 대조한다. 기존 작업 상품은 변경하지 않는다.

## 초안 준비 결과

일반 OpenAI 요청은 준비·승인 대기 상태이고 원문·옵션·이미지가 저장돼 있어도, 자체 접수 UI가 완료/검토 상태만 인정해 오류로 표시하고 1~7단계를 자동으로 열지 않았다. 정상 준비 ACK를 검증해 원문 초안을 편집 가능한 상태로 알린다. 요청 승인·실행·번역 결과 적용을 대신하지 않는다. 이미지 저장 실패, 잘못된 상품/원문/검토 정보, 실패·진행 중·불확실한 요청은 성공으로 바꾸지 않는다.

이미지 저장으로 상품 버전이 바뀐 과거 검토 요청은 실행할 수 없다. 실제 SEO 화면은 현재 상품으로 요청을 다시 준비한 뒤 직접 승인하도록 유지한다. Google/Workers 자동 초안과 기존 Google 실패 후 원문 편집 경로는 별도 의미를 보존한다.

## 신규 고시 기본값

REA 정적 원본의 신규 문서 생성·최초 SEO·가격 저장은 품명/모델·재질·크기·제조자(수입자)·제조국 고시를 수집 정보로 채우지 않는다. 초기 named notices는 `해당사항없음`이고, 기본설정의 A/S·세탁주의·이전월 날짜 예외만 별도로 적용된다. 자체는 원문/생성 표시사항과 기본설정을 즉시 고시에 연결해 차이가 있었다. 근거는 `docs/step700-initial-legal-notices-parity-audit.md`와 재현 `outputs/step700-analysis-initial-notice.json`에 기록한다.

새 수집 초안에만 캡처한 카테고리·정확한 고시 필드의 초기값을 보관한다. 공급 원문과 6단계 표시사항은 보존한다. 원본 `saveManualLabels`도 legalPage/notices를 쓰지 않으므로 6단계 저장 자체가 초기 고시를 대체하지 않는다. 7단계의 정확한 필드 수동 입력·공란과 명시적 견적서 작성 결과는 기존 우선권을 유지한다. 기존 상품에는 소급 적용하지 않는다. 공식 카테고리/고시 필드가 바뀌면 이전 필드의 초기값을 새 필드로 추측 적용하지 않는다. 상세 표시사항 편집기의 세부 사양·KC 안내도 7단계 상품고시에서 확인·수정하도록 정정했다.

원본 설정 예외는 고정 `noticeItemName`/`noticeItemValue` 키에만 쓰므로, 다른 name/value 키를 가진 고시는 기본 N/A를 유지한다. 날짜는 설정 적용 가능한 첫 날짜 고시만 대상으로 한다. 독립 검수에서 이 경계의 초기 구현 차이를 추가로 발견해 builder·reader·첫 날짜 선택을 함께 수정했다. 원본 날짜의 실행 시각에 대응해 새 고시는 상품 생성 `now`의 이전 월로 동결한다. 별도 6단계의 기존 요청 캡처 시각 기준 날짜는 변경하지 않았다. 기존 달 계산 helper를 재사용하며 원본 `setMonth`의 31일 overflow를 재도입하지 않는다.

## 이번 실제 브라우저 확인

기존 승인 Chrome4의 별도 자체 검수 탭727932803에서 Supplier Hub 유앤채 로그인 헤더와 신규 빈 개별상품등록 화면을 읽었다. 기존 작업 탭과 저장 상품은 열어 수정하지 않았다. 빈 양식의 카테고리 구조에서 주방용품 → 주방수납/정리 → 주방수납바구니/바스켓을 선택한 결과 `주방용품>주방수납/정리>주방수납바구니/바스켓 (80719)`가 표시됐다. 자체/보관 Couplus의 80719 경로와 일치한다. Hub의 표시 단계는 기본정보·상품정보·이미지/콘텐츠·법적정보·물류 다섯 단계다.

상품명 입력·저장·다음·기존 상품 불러오기·전송·동의·계정 전환은 하지 않았다. 화면 캡처는 CDP capture timeout으로 두 번 실패해 새 스크린샷 증거가 없다. AX/DOM에 표시된 사실만 기록하며 카테고리 하나의 표시 확인을 전체 카테고리나 실제 접수 성공으로 확대하지 않는다. 자체 검수 탭은 닫았다.

## 최종 검수

관련 **24개 고유 테스트 파일 338개 통과**, 실패·취소·skip0이다. 새4파일23개(승인 대기 unit6/UI4, 고시 unit10/API3)와 기존20파일315개를 포함하며, 중간 실행과 독립17개 단언은 합산하지 않았다. 전체 repository suite를 실행했다는 뜻은 아니다. 최종 로그는 `outputs/step700-root-final-tests.log`다.

승인 대기 시험은 실제 IntakeQueuePanel/TranslationPanel callback과 자체 API·SQLite를 사용했다. 양사 각각6옵션/19이미지 원문 초안을 열었고, 이미지 저장 뒤 오래된 검토 요청의 실행 차단·현재 요청 재준비·명시 승인 요구를 확인했다. 실패/유실/잘못된 ACK는 오류로 유지했고 실제 이미지18/19 실패 후 회복도 검수했다. 승인·실행·결과 적용 요청은0이다. `outputs/step700-approval-api-proof.json`에 원문·수동 편집·회사·이미지 보존 SHA를 기록했다.

고시 시험은 양사 합성2SKU와 보관한81452 Single schema/원본 XLSX를 자체 실제 핸들러·SQLite에 사용했다. 신규 품명·재질·치수·제조자·제조국 N/A, 캡처 연락처·날짜·품질 예외, 6단계 동일값/공란·SEO/본문 저장 후 유지, 7단계 공통/개별 입력·공란 우선과 원본 XLSX 행9/10의 실제 셀을 대조했다. 보관 workbook SHA는 `9c4be4963b13a3af085e5814d76d0cb5bb6c8e9815ebe8c2ad4e4309d72e4782`다. 와이홉/유앤채 격리 검수에 같은 보관 양식을 재사용했으며 새 공식 양식 획득이나 실제 상품 분류 증거가 아니다. `outputs/step700-notice-api-proof.json`에 원문·가격·옵션·다른 owner·R2 불변 근거를 보관했다.

첫 root 회귀18파일은251통과/41실패였다. 새 고시 분리와 충돌하는25개 기대값을 정리했고, 나머지16개는 이미 적용된 초기 plain SEO 제목/이후 수동 편집의 옵션명 결합을 구분하지 않은 옛 기대였다. source label 값 보존을 추가 단언하고 명시 7단계 수정·공란 검사는 유지했다. 기존 fashion/other-goods/live-notice source binding 시험3개는 로컬 합성 content에서 초기 표식만 제거해 명시 legacy fixture로 분리했다. 첫 실패 로그는 보존했으며 앱의 기존 제목 규칙을 바꿔 시험을 맞추지 않았다.

TypeScript768MiB, app/db lint384MiB, 신규·수정 MJS17파일 lint, 44tables/17indexes/29runtime modules의 fresh/repeated memory schema, bounded production build가 모두 통과했다. 마지막 안내 문구 수정 뒤에도 type·해당 component lint·build가 통과했다. 최종 verifier는36개 source SHA·실제 로그·양사 증거·배포 ID를 대조해 통과했으며, `outputs/step700-release-inputs.json`과 `outputs/step700-final-validation.json`에 기록했다.

## 배포와 남은 검증

기존 무료 Worker **`04f5f3f9-f5f6-46e3-b1cb-e9daeb840205`** 배포 exit0, `outputs/step700-deploy.log`, https://sourceflow.jjwwhhjj1116.workers.dev/. 배포 후 최종 verifier도 통과했다. 확장·ZIP·다운로드 링크 변경은 없고 준비 버전0.2.75·마지막 실제 확인 설치0.2.64를 유지한다. 새 리소스·유료 플랜·DB migration·OAuth/R2 권한 변경은 없다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`와 운영 전송 gate를 유지한다. 실제 신규1688 full SKU/images·전 카테고리 양식·외부 번역·Hub 동의/접수번호/SKU 대조는 별도 미완료다.
