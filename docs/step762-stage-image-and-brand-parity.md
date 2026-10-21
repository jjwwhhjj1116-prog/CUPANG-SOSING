# Step762 — 추가·상세 이미지 다중 업로드와 견적 브랜드 선택

2026-10-21. Couplus의 단계별 입력 차이를 보관된 원본 JavaScript와 다시 대조하고, 추가이미지·상세이미지의 다중 업로드와 견적서 브랜드 선택을 보완했다. 기존 업무 상품과 Couplus 작업 상품은 수정하지 않았다. 아래 UI/API 성공은 합성 상품을 사용한 로컬 검증이며 실제 1688 수집이나 Supplier Hub 접수가 아니다.

## 원본 근거와 구현 범위

REA 부모 `ev_69740e390a2cc1e539a4a65a84e5c7065e2e6db9dcbc8a6311d0b4bfce5a3166`, 저장 요약 `ev_26cdc76017d63fa2bb683d4165db034bae99266f6a3ad48bb3b45253f2ce9634`와 동일 원본을 재사용했다. 현재 세션의 부모 조회 한 번이 missing/integrity mismatch로 끝나 저장 요약·일치하는 SHA를 사용했으며, 동일 producer를 반복하지 않았다.

- Route: `outputs/step754-current-couplus/chunk-6b0db3f8.8a741991.js`, SHA `5b92873c674c4b76c0e6ce4961caedbf8728ca86f6a15b6d9dc8cdfce80ad1d9`.
- Main: `outputs/step754-current-couplus/main.604a4c32.js`, SHA `027a17c12b60164e856058cbe449b827d38bf1ec0f7d98bb23acbff2c6c25b67`.
- 범위·조각 SHA·정적 관찰과 미확인 항목: `outputs/step762-rea-stage-spec.json`.

| 원본에서 확인한 입력 | 정적 범위, UTF-16 끝 제외 | 이번 반영 |
| --- | --- | --- |
| 추가이미지: 다중 선택 → 이름·수·크기 대기 목록 → `업로드 시작` | Route `[64790,65540)`, `[71060,71275)`, `[83263,84083)` | 선택만으로 쓰지 않고 명시 시작 후 순서대로 업로드 |
| 상세이미지: 다중 선택 직후 순차 업로드 | Route `[130627,131949)` | 선택 즉시 업로드, 중단된 대기 항목은 명시 이어서 처리 |
| 견적 브랜드: `브랜드 없음`의 값은 `''`, 회원 기본 브랜드를 쉼표로 나눈 선택지 | Route `[205678,206690)` | 현재 상품의 정확한 등록 설정을 응답 전용 선택지로 제공 |

원본 업로드 helper는 파일별 실패를 잡고 성공 결과를 순서대로 반환한다(Main `[225737,226598)`). 원본의 실제 서버 제한이나 부분 저장·업로드 응답 유실 결과까지 관찰한 것은 아니다. 자체의 파일 검증, 대기 항목 제외, 실패 항목 보존과 ACK 복구는 기존 자료를 보호하기 위한 일관성 처리이며, 원본의 모든 제어를 그대로 관찰했다고 주장하지 않는다.

SEO도 원본의 상단 브랜드·상품 특징·타깃 키워드 3열, 상품명·태그와 옵션명 2열, 중앙 명시 저장을 대조했다. 기존 자체 helper가 이미 브랜드 기본값의 첫 쉼표 항목을 사용하므로 이 기능을 새 구현으로 계산하지 않았다. 원본 로그의 `즉시 저장` 문구와 달리 견적 일괄 적용은 실제로 pending 변경을 쌓은 후 저장 버튼에서 전송한다. 로그 문구만 보고 자동 쓰기를 추가하지 않았다.

## 이미지 저장과 브랜드 입력

추가·상세 이미지 파일은 기존 private 파일 API와 현재 상품 보관함 첨부 API를 이용한다. 실제 헤더·MIME, 기존 10MiB 파일 제한과 보관·대기 합계 150개 제한을 검사하며, 확인된 파일 키를 선택 순서대로 추가한다. 현재 owner/product/stage/version, active·busy·disabled 상태와 오래된 callback을 검사한다. 업로드 응답이 불명확하면 파일 식별과 불확실 상태를 남겨 자동 재업로드하지 않는다. 첨부 ACK가 불명확하면 나머지 처리를 중단하고 GET으로 조회하며, 정확히 같은 기준일 때만 파일 키의 명시 재첨부를 허용한다.

**이번 업로드는 상품 공통 보관함에 이미지를 추가한다. 기존 옵션의 추가·상세 역할에 자동으로 붙이지 않는다.** 업로드 후 기존 옵션 편집기에서 역할·순서·삭제를 선택한다. 기존 옵션·원문·정책·설정·이미지 바이트를 업로드 때문에 바꾸지 않는다.

견적 브랜드 선택지는 현재 owner와 승인 회사, 상품에 캡처된 등록 설정을 확인한 snapshot에서 가져온다. 이후 회원 설정을 바꿨다는 이유로 기존 상품의 캡처된 브랜드를 바꾸지 않는다. 선택지 표시 자체는 쓰기를 만들지 않고, `브랜드 없음`을 직접 선택하면 빈 문자열을 초안에 넣으며 기존 견적 입력 저장으로 확정한다. 저장된 목록 외 브랜드·수동 공란을 보존하고 enum·readOnly 및 해당 wire의 미지원 규격을 우회하지 않는다. 선택지 제어용 토큰은 저장하지 않는다.

독립 검수에서 오래된 옵션 callback, 미지원 const 경로의 새 selector 노출, 잘못된 선택지 응답의 렌더 오류를 발견해 수정했다. 최종 재검수에서 A→B와 A→B→A 뒤의 오래된 callback은 변경·쓰기 0, 새 callback은 해당 옵션에 PUT 1회로 저장됐다. exact/상위 미지원 경로·enum·readOnly 보호, 잘못된 응답 7종, 기존 값·공란·`None=''`·disabled도 확인했다. `outputs/step762-brand-review.json`에 초기 재현과 최종 소스 SHA를 함께 보존했다.

## 전송 복구와 작업 단계 이동 보완

확장 native 업로드 복구는 응답을 잃은 기존 작업에서 소유 문서와 보관 ledger를 검증한 후 파일 목록만 조회하는 진단을 추가했다. multipart 업로드·문서 update·submit은 반복하지 않는다. 이미지 목록은 GET, 고시 파일 목록은 기존 `POST /get-files-by-type`의 빈 객체 조회이며 업로드 요청이 아니다. 현재 actor/source/frame/문서·계획 SHA와 파일명·로컬 바이트 정보를 다시 확인하되, 원격 목록에 없는 SHA·길이·타입을 임의로 검증 완료로 만들지 않는다. 원래 checkpoint와 ledger는 유지한다.

메타데이터 일치만으로 원격 바이트·업로드 ACK 복구·문서 업데이트 허용·옵션 SKU 연결·접수를 증명할 수 없다. `remoteBytesVerified`, `actualUploadVerified`, `canContinue`, `registered`는 false이며 unresolved 상태를 유지한다. 근거는 `outputs/step762-native-upload-recovery-proof.json`이다.

기존 작업 단계 이동 테스트의 폐기된 PriceEditor stub을 실제 가격 정책·옵션 표로 교체했다. 이 과정에서 이미지 수정만 있어도 가격 단계가 수정된 것으로 표시되는 회귀를 찾아 `sourceDirty`를 전체 저장 dirty와 분리했다. 정책 초안 유지, 이미지 단독 수정은 대표이미지로만 이동, 혼합 수정은 두 원본 단계 유지, 저장 API 무호출을 확인했다. 기존 잠금이나 단언을 완화하지 않았다. 근거는 `outputs/step762-workspace-navigation-repair.json`이다.

## 검증 결과와 남은 작업

임시 SQLite·합성 R2·실제 컴포넌트/API handler로 양사 `A01464742`, `A01526306`를 검증했다. 이미지 관련 집중 39건, native 복구 관련 45건, 단계 이동 2건은 각각의 증거에 기록되어 있으며 서로 겹치는 focused 실행을 최종 고유 검사 수에 합산하지 않는다. 최초 전체 실행의 3건 실패를 수정한 뒤 최종 suite 439건이 통과했다. 개별 브랜드·단계 이동 재현 기록과 최종 전체 실행 기록을 구분한다.

기존 Chrome 2의 로컬 검수 탭에서 실제 Dashboard와 API·임시 SQLite를 사용해 합성 상품 `synthetic-document-652`(와이홉)을 확인했다. 추가이미지 2개 선택 후 명시 시작, 상세이미지 2개 선택 직후 시작으로 각각 파일 POST `201`과 보관함 첨부 POST `200`을 확인했다(총 파일 4회·첨부 4회). 보호 합성 상품은 불변이며 실제 source/Hub/native 요청은 0이다. 현재 증거는 `outputs/step762-browser-qa/proof.json`, 화면은 `outputs/step762-ui/additional-pending-final.png`, `detail-multiple-upload-final.png`다. 초기 첨부 `400` 기록은 `step762-browser-initial-proof.json`에 보존했다. 번역 원문·detail-family `409`가 발생한 합성 자료로 실제 번역 성공을 주장하지 않는다.

Couplus 기본설정은 `outputs/step762-ui/couplus-settings-readonly.png`의 읽기 전용 화면만 확인했으며, 기존 상품을 열어 저장·삭제·전송하지 않았다. 합성 상품의 첫 옵션에서 브랜드를 유앤채로 선택해 명시 저장 PUT 1회 `200`, 견적 입력 v2와 미저장 0을 확인했다. 최신 코드를 다시 번들한 뒤 같은 탭을 reload하고 첫 옵션 견적서를 다시 열어 유앤채 유지·저장 버튼 비활성화를 확인했다. 화면은 `outputs/step762-ui/quotation-brand-reopened.png`, DOM은 `outputs/step762-browser-qa/brand-reload-dom.json`이다. 재연결 때 브라우저 공급자의 번호가 Chrome 2에서 4로 바뀌었지만 원래 검수 탭 ID `727935094`와 사용자 Couplus 탭 ID `727934487`를 그대로 사용했다.

최종 32개 고유 테스트 파일 439건은 실패·취소·생략 없이 통과했다. 전체 lint에서 별도 기존 source-registration 테스트의 훅 함수 명명 오류를 발견해 동작·단언을 유지하며 수정했고 해당 3건도 통과했다(총 33개 고유 파일 442건). types·lint(오류 0, 경고 46)·운영 build를 통과했다. 기존 Worker 배포 version은 `aea91b42-b45f-49ca-a5c4-487f5741577f`이며 새 리소스·DB migration은 없다. 최종 source SHA·검사·커밋은 `outputs/step762-final-validation.json`을 참조한다. 확장 패키지는 2.1.9, 90파일·1,061,081bytes·SHA `d51506dc889316963e3d793b57cdaa94a6a46f147d0045e5c40ee9488441b235`다. 두 생성 모듈·패키지의 `--check`를 통과했고 기존 2.1.8 ZIP SHA는 불변이다. 권한·host 확대는 없으며 설치된 확장의 현재 실행 버전을 확인한 것은 아니다.

사이즈표는 여전히 정보 저장 후 별도 PNG 생성·견적 첨부의 두 동작이며, 원본의 카드 입력·실시간 읽기 전용 표·한 번 저장 coordinator 차이는 남아 있다. 전체 카테고리·상태에서 1~7단계 상세 UI가 완전히 같다는 검증, 실제 1688 수집 동등성, Supplier Hub 실제 원본 업로드/readback·최종 동의·docId/qvt/SKU 접수는 미완료다. `PRODUCT_DOCUMENT_LIVE_VERIFIED=false`, `SINGLE_DOCUMENT_LIVE_VERIFIED=false`를 유지한다. 합성 검증을 실제 접수나 임의 완료율로 보고하지 않는다.
