# Step664 — 카테고리 선택과 상품추가 대기열 처리

기준 commit `fc051069de51ad8ebf05a152b71ea2a410743d76`, Worker `35c3566b-0542-42ab-95f0-b8b76bec2347`. 기록된 쿠플러스 클라이언트의 상품추가·확장 요청·대기열 처리를 정적으로 분석하고, 현재 카테고리 선택만 적용하도록 보강했다. 운영 상품이나 기존 쿠플러스 작업 자료는 편집하지 않았다.

## 원본 근거

기록된 UI chunk SHA `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`, main SHA `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`를 사용했다. Step660의 상품추가·상품 생성 분석을 재사용하고 다음 여섯 메서드만 추가 분석했다. 원본 코드·bootstrap은 실행하지 않았다.

| 메서드 | UTF-16 범위 | SHA-256 |
| --- | --- | --- |
| requestProductInfoFromExtension | [410741,411765) | d68bf7c9e8a1ae5589f3f56415c76e539e13f4263529323cf5fd6d83164997df |
| generateRegistrationId | [466255,466661) | bc589bca3ff027c53459830e9f1b48f9b12784aea1a203d5d8e1b7a1e7004071 |
| startQueueProcessing | [402804,403644) | 5a2b9c7a1e20c61b03c7cf4df7cce07784413a07cf5f971e19ac9578d023779d |
| recordQueueFailure | [403645,404193) | 666df0c2476da265c536de4917fce90284cbca89e66f19b86304d69d15ac0d0a |
| failCurrentQueueItem | [404194,404543) | 4b3c8c441938fa257153c66812e14a4e686023707215c285dc7d66d2892a4323 |
| processNextQueueItem | [404544,409116) | 4845a7f40fc6cc8dafbd4feef77825660496e745f5ffcd7332cae7fdb89f12b3 |

REA parent `ev_e209eb6877550c205e52dbed56ee1b857dfdcdc78fb0a47b1f3c2e568287f8ae`, summary `ev_2fcfbdf55751e14e711ac8c20fb5a7176f185e0b60bee91c44d922ff0e20e823`. 구문 분석 실패는 0, 의미 미확정 항목은 423개다. 전체 프로그램을 모두 이해했다는 근거로 삼지 않는다. 선택 메서드·범위·hash·연관 구간은 ignored `outputs/step664-intake-audit/`에 보관하며 제삼자 원본 코드는 Git에 제출하지 않는다.

최종 카테고리 선택 후 상품추가 화면에 링크·특징·키워드·읽기 전용 카테고리가 표시된다. 확장의 `GET_PRODUCT_INFO` 요청에는 keyword, subject, subjectTrans, productFeature, 현재 suppliercode, categoryCode, categoryPathString, isOption:false를 전달하고 pendingProductData를 보존한다. 메시지 requestId는 `product_info_`와 시각이며 상품 등록번호와 별개다. 등록번호는 로컬 날짜 YYMMDD를 `/api/rocketReg/issueRegistrationId`에 전달해 받는다. 비공개 서버의 순번 형식·유일성·멱등 구현은 미확인으로 남겼고 임의의 번호 알고리즘을 만들지 않았다.

대기열은 선택 행을 우선하고 선택이 없으면 전체를 대상으로 한다. 빈 링크는 건너뛰며 실패한 행의 오류·실패 횟수를 기록한 뒤 다음 행을 처리한다. 성공 행은 원본 대기열에서 제거되고, 다음 시작에서는 실패 표시를 초기화해 재시도한다. 실패 후 1초, 성공 후 2초 예약을 관찰했지만 앱에 불필요한 지연을 새로 넣거나 처리 속도를 주장하지 않았다. 기본 시작 단계는 SEO·가격이며 더 뒤 단계는 등록번호로 작업을 이어간다. 등록전송은 별도 진입점이다.

원본 클라이언트는 link와 keyword의 truthy 조건으로 처리 건수를 센다. YOOFAM은 사용자가 명시한 “카테고리＋URL로 초안 작성”을 유지하므로 키워드를 새 필수값으로 만들거나 특징·키워드를 지어내지 않는다. 원본의 10행 설정은 화면 페이지 크기이며 URL 상한이 아니다. 서버의 실제 일괄 상한은 미확정이다. 앱의 기존 50행 상한, 엄격한 1688 주소 검증, 중복 URL 표시, 회사·카테고리·기본설정 스냅샷, 수동 검토와 실제 회신 요구는 보존했다.

## 구현

`intakeRowsForCollection`이 선택 건수, 처리 대상 체크박스와 실제 요청의 빈 URL 규칙을 통일한다. 공란 행은 모든 입력을 남겨두고 URL을 입력하면 자동으로 후보가 된다. 사용자가 제외한 행은 그대로 제외된다. saved 행은 새 시작에 포함하지 않는다. 잘못된 런타임 값은 원래 검증을 거치며 빈 입력으로 숨기지 않는다.

`submitIntakeQueue`는 오류 행에 원인을 표시한 다음 나머지 정상 행을 순서대로 처리한다. 오류 행만 있으면 요청을 보내지 않는다. URL이 모두 공란이면 요청과 저장 완료 표시가 없다. 오류 콜백에서 취소하면 이후 콜백·요청을 즉시 멈춘다. 중복 canonical URL의 두 행은 수정 가능한 오류로 남기고 다른 URL은 계속 처리한다. 회사·카테고리 revision·기대 기본설정·기존 요청 보존과 기본설정 변경 시 중단 조건은 바꾸지 않았다.

화면 행 번호는 처리할 행 목록과 독립적으로 유지한다. `[1: URL A, 2: 공란, 3: URL A]`의 중복 안내는 1·3행을 가리킨다. 잘못된 URL의 단일 오류도 실제 화면 번호를 쓴다. 마지막 검토에서 발견한 번호 압축 문제를 최종 빌드 전에 수정했다.

상품추가 부모 컴포넌트는 카테고리 선택마다 owner·epoch·target·seed를 묶어 보존한다. 닫기·다음 선택·계정 layout 변경·unmount 이후 이전 session은 무효다. 이전 onSelected/onProfile/onAdvanced, 원문 소비와 지연 onRows updater가 새 창이나 계정에 적용되지 않는다. 성공한 ticket은 다음 session까지 유지해 정상적인 지연 updater가 한 번 적용되게 한다. 중복 콜백/행 ID는 두 번째 행을 만들지 않는다. seed ID와 실제 URL이 모두 맞아야 해당 원문을 소비한다. 확정 후 현재 URL 입력칸으로 이동한다.

이는 확인된 계정 간 DB 취약점으로 보고하지 않는다. 실제 `useIntakeDraft` 래퍼에는 이미 동기 owner/epoch 검사가 있고 자식 CategoryPicker도 이전 요청을 취소한다. 이번 변경은 부모의 콜백 경계를 보강했다. CategoryPicker, Supplier Hub 분류/API 및 공식 양식 처리는 변경하지 않았다.

기존 `category-guided-seo-flow` fixture는 Step627의 자동 Excel fork를 기대했지만 Step654에서 Single 기본값·Excel 명시 선택으로 바뀌었다. workbook 출력 검사에 한정해 `connectExcel:true`를 넣었다. 별도 profile 생성, 원본 파일 바이트, 기존 profile 보존과 출력 단언은 유지했으며 앱 동작을 옛 방식으로 되돌리지 않았다.

## 검수

최종 동일 소스 **11파일 124개 통과**, 실패·취소·skip 0: 신규 카테고리 lifecycle 38, 기존 입력/UI 56, queue 14, partial-start 실제 로컬 API/SQLite 14, category-guided workbook/SEO 2. 선행 94/122/124회나 중복 owner 실행을 최종 수에 다시 더하지 않았다. TypeScript와 변경 앱·helper·test lint는 오류·경고 0이다.

지정한 기존 Chrome profile의 자체 로컬 화면에서 실제 IntakeQueuePanel, CategoryPicker, collection-jobs POST와 임시 SQLite를 사용했다. 회사·인증·분류 schema·외부 collection 경계는 명시적인 합성 fixture다. 실제 회원 로그인, 전체 분류 동등성 또는 1688 본문 수집의 증거로 사용하지 않는다. Supplier Hub 카탈로그·collection에 fixture alias를 연결해 실제 Chrome/Hub/provider 호출을 차단했다.

두 회사 각각 카테고리 취소→저장 분류 확정→실제 URL 포커스→정상/공란/오류 URL 3행→시작을 검수했다. 최종 로컬 POST는 회사마다 한 번, 총 두 번이었다. canonical URL, 회사 코드·이름, profile/revision/path, 특징·키워드와 기대 기본설정을 실제 API 저장 context와 대조했다. 공란 행과 입력은 보존되고 잘못된 URL은 실제 3행을 가리켰다. collector는 합성 경계에서 의도적으로 멈춰 초안 완성이나 외부 등록을 거짓으로 표시하지 않았다.

보관된 DOM/API 증거 **41/41 대조 통과**. 외부 fixture fetch 기록 0, 실제 Hub/1688/provider/upload 호출 0. 회사 전환은 별도 임시 DB를 고르는 합성 동작으로 실제 두 회원의 로그인 검증이 아니다.

최종 Chrome PNG는 `outputs/step664-native-intake-final.png`에 보관했다. 앞선 유앤채 PNG는 마지막 행 번호 수정 전 화면이므로 구별한다. 일부 screenshot timeout 후 최종 clip 133654 bytes는 성공했다. 자체 탭·로컬 서버는 종료했고 기존 사용자의 Couplus/Hub/app 탭은 유지했다.

## 남은 실제 검증

Step660에서 실제 관찰한 D1 Free 일일 row-read 한도 제한의 reset은 **2026-10-15 09:00 KST**다. reset 전 운영 상품 GET을 반복하거나 관리 API로 앱 자료를 우회하지 않았다. 새 DB·결제 플랜·Access 완화·DB migration·확장 업데이트도 없다. 준비된 확장은 0.2.72 그대로이며 실제 설치 버전을 새로 확인한 것은 아니다.

새 실제 1688 상품의 전체 SKU/이미지, 모든 카테고리의 양식/기본값 동등성, Hub 동의→최종 접수→SKU/회신 대조는 미완료다. `SINGLE_DOCUMENT_LIVE_VERIFIED`와 운영 개별 전송 gate는 false 그대로다. 이전 URL 도구 정책 거절은 REA/CLI/확장/API/다른 브라우저로 우회하지 않는다. 합성 결과를 운영 등록 완료나 100% 완성으로 보고하지 않는다.

## 배포

최종 bounded build 통과 후 기존 무료 Worker `sourceflow`에 Version `d7486e3d-4bbc-437a-b159-e3be8a8a8e18`을 배포했다. 앞선 `08cfa292-b948-45d2-93a7-d74f68c7bf20`은 행 번호 수정 전 중간 버전으로 최신 완료본과 구별한다. 바인딩·공급자·회사 권한·DB 자료·과금 플랜은 변경하지 않았다. 운영 상품 readback은 위 D1 제한 때문에 반복하지 않았으므로 새 배포 후 실제 상품 전체 흐름 검증이라고 주장하지 않는다.
