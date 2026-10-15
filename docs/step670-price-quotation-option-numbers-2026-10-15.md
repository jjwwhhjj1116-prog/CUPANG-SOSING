# Step670 — 가격표와 견적서의 저장 옵션번호 연결

기준 커밋은 `b7c2e886beb77d8e3077fdef4f1aefd8a4c72198`이다. Step669 번호 저장 구현은 이미 푸시됐지만 Cloudflare 인증 오류 10000으로 배포되지 않았다. 현재 운영 Worker는 Step668 `c9f47c1e-9d46-49c7-8eb4-fef0f70d8021`이며, 0024 원격 테이블 적용도 아직 미완료다.

## 확인한 쿠플러스 동작

REA로 보관된 JavaScript를 정적으로 대조했다. 실제 기존 상품을 수정하거나 벤더 코드를 실행하지 않았다.

- 가격표는 저장된 `optionNumber`를 표시하고 표 식별키로 사용한다. 공급가·판매가 재계산 및 저장 대상 검색은 그 번호를 조회한다. Evidence `ev_cd5b12712ef6b71c2acfc13858957b76b067e15d1319aac6ac68b3c3a642258a`.
- 검색은 행 필터, 정렬은 행 참조 배열 복사, 페이지는 배열 slice이며 옵션번호를 다시 쓰지 않는다. Evidence `ev_80058b8130c110cfd1ec44a0c48cf2441311a5ce02c3a66e52f40c0fbf65b42f`.
- 원본 UI chunk SHA256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`, 일반 표 chunk SHA256 `7a2d7bc1103eb97ff90329a716da2b5595e2d3a0a8f1c6c00b4239fb2a0c3678`. 옵션번호 표시 식은 UTF16 `[163109,163203)`, UTF8 `[178445,178539)`. 선택한 19개 범위의 원본/추출 해시 검사와 정적 파싱이 통과했다.
- 중국원가 슬롯은 index를 기대하지만 일반/고정 표 전달식은 item만 전달한다. 실제 재계산 실패를 관찰한 것은 아니다. Unknown `unk_6c78ad53f6ad7522fb380904ff58cab57d89b44c91f011e2e8b07e244f3a9032`.
- 현재 보관 가격 팝업은 페이지당 20개, 일반 표 전체 선택은 필터된 전체 행을 대상으로 한다. 현재 YOOFAM 가격표의 10개/현재 페이지 선택과 다른 지점으로 남겨 둔다. 이번 변경은 표시 번호와 저장 연결에 한정되며 전체 팝업 동일 구현 완료를 뜻하지 않는다. `sortable:false`가 있지만 별도 필터 정렬 함수는 이를 검사하지 않아 모든 정렬이 차단된다고 단정하지 않는다.
- 벤더 서버의 번호 할당/일자/회사 범위는 계속 미확정이다. Step669 자체 번호 정책을 벤더 서버와 완전히 동일하다고 주장하지 않는다.

원본 범위·해시·미확정 내용은 ignored `outputs/step670-price-number-audit/source-manifest.json`, `generic-source-manifest.json`, `rea-evidence-bundle.json`에 보관했다. 인증 자료나 원본 벤더 번들은 Git에 넣지 않았다.

## 구현

가격표가 내부 옵션 UUID 대신 API가 반환한 저장 옵션번호를 표시하고 번호로 검색한다. 검색/정렬/제거/복원은 번호를 생성하지 않으며 모든 입력·선택·저장·라우트는 기존 UUID를 사용한다. 저장 번호가 없는 이전 자료는 기존 표시를 유지한다.

QuotationFieldsView의 선택적 최상위 `optionRegistrationNumbers`는 기존 owner-scoped DB reader로 읽는다. 원천 지문을 만든 뒤 읽고 기존 최종 source-clock 검사 안에서 반환한다. 수정값, resolved/automatic fields, 저장 payload, 작업 지문과 CAS 입력에는 넣지 않는다. 이전 상품은 속성을 생략하고 번호를 배분하지 않는다.

가격 편집 헤더·권장소비자가 복원 이름·7단계 현황과 옵션 선택기에 같은 번호를 표시한다. 선택기 value 및 저장 요청은 UUID다. 옵션 응답은 현재 상품/행과 번호 형식·중복·접두어·외부 행·알려진 부모 접두어를 확인하며 잘못된 응답은 편집 입력을 유지한다. 이미 커밋된 그리드 저장의 번호 응답이 잘못된 경우 원천 저장을 반복하지 않고 명시적 읽기로 복구한다.

부모 번호 metadata가 뒤늦게 나타났다는 이유만으로 원가 입력을 다시 불러와 지우지 않도록 검사용 ref를 유지했다. 기존 가격 정책/버전/회사/프로필 전환 및 늦은 응답 차단 규칙을 유지한다.

## 검수

- 최종 12개 파일 **287/287** 통과, 실패/취소/skip 0. 신규 표시·실제 SQLite API·두 회사 소유권·영구 UUID 매핑·재정렬·누락/잘못된 metadata·미저장 공란·잃어버린 ACK·동시 편집·늦은 원천 응답을 포함한다. 초기 실패에는 UI 테스트 기대치 변경, fixture 라벨 불일치, 부모 metadata로 인한 입력 초기화가 있었고 최종 로그에서 모두 해소했다.
- 최종 타입 검사, 변경 소스 lint, 기존 Worker 배포용 build exit 0. 새 DB schema 변경은 없고 Step669 0024 배포 대기 상태를 유지한다.
- 로그: ignored `outputs/step670-final-tests.log`, `step670-final-types.log`, `step670-final-lint.log`, `step670-build.log`.
- 기존 Chrome 3에서 실제 가격/견적 편집 컴포넌트와 제품 API를 임시 SQLite/member-session fixture로 검수했다. 양사 신규 fixture 각각 번호 표시/검색과 선택 옵션 원가 PATCH 200, 와이홉 순서 변경 PATCH 200 후 같은 B 번호/7.99 유지, 유앤채 A 번호/5.99 유지. 유앤채 견적 선택기는 표시 번호와 원래 UUID를 함께 보존했고 모델 B 수정 PUT 200 후 새로 읽은 화면에서 같은 UUID 및 수정값을 확인했다. transient 저장 완료 문구는 부모 새로고침에 대체되어 해당 문구 자체를 성공 근거로 사용하지 않았다. 와이홉 견적 선택기 자체의 추가 native 관찰은 하지 않았고 양사 연결은 SQLite/API 검사로 확인했다.
- Native trace 48개, 신규 번호 행 2개, 두 legacy fixture 행 그대로/번호 metadata 0개, app source hash 고정. 실제 운영 DB/회원 로그인/1688/번역 provider/Supplier Hub/업로드 요청 0. ignored `outputs/step670-price-native-proof.json`, `step670-price-native-dom.json`. 캡처는 CDP Page.captureScreenshot 5초 timeout으로 PNG 없음. 임시 탭 close 성공, 임시 서버 종료. Chrome unsafe port 3659를 우회하지 않았으며 안전한 3660 사용 후 로컬 소켓 sandbox 제한을 정식 escalation으로 해결했다.

## 운영 반영과 남은 범위

이 변경의 빌드 완료는 배포 성공이 아니다. 이전 Wrangler callback session 99961은 시간 초과했다. 새 최소 scope(account:read/user:read/workers:write/d1:write) flow가 같은 Chrome 탭 727931209에서 로그인 대기 중이며 callback session 22367, ignored `outputs/step670-cloudflare-login.log`의 실제 성공 여부를 확인해야 한다. 권한 부여는 사용자가 수행한다. R2 write/별도 offline scope를 추가 요청하지 않는다. 인증 challenge/token을 Git·채팅으로 내보내지 않는다.

인증 성공 후 0024의 기존 무료 D1 additive 3-table SQL 적용과 현재 빌드의 같은 Worker 배포를 수행한다. 원격 인증 성공/DDL 성공/배포 성공을 각각 확인한다. 실패한 인증으로 운영 조회나 배포를 반복하지 않는다. D1 quota reset 시각이 지났다는 이유만으로 quota가 해제됐다고 주장하지 않는다.

전체 workflow의 새 1688 full SKU·이미지 수집, 모든 카테고리 공식 양식/기본값, 남은 단계 UI, Supplier Hub 동의·최종 접수 번호/SKU 검증은 남아 있다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`, 운영 변경 gate=false. 이전에 접근 거절된 1688 URL을 REA/CLI/API/확장/다른 브라우저로 우회하지 않는다. 기존 작업 상품은 수정하지 않는다. 임의 완료율이나 100% 완료를 보고하지 않는다.
