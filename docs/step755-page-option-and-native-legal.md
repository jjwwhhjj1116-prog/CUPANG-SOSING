# 수집 옵션 식별과 공식 인증서 원본 연결

기준 커밋은 `ebb1e443f77c59ccd8913ebabf5d6da2b096bbdb`다. 기존 작업 상품을 열거나 수정·삭제·전송하지 않았다.

## 수집본에서 공급자 SKU가 없는 옵션

RS 방식의 현재 페이지 수집본에는 각 원문 행을 구분하는 `key`가 있으나 실제 공급자 `skuId`는 없을 수 있다. 이전 수집함은 이 두 값을 같은 것으로 취급하여, 옵션명과 양수 위안 가격이 있어도 초안을 차단했다.

이제 두 실제 페이지 provider에 한하여 `yoofam-page-option-identity-v1` 증거를 사용한다. 정확한 offer ID와 1~200개의 중복 없는 전체 원문 행 키가 함께 있어야 한다. 원문 행 키는 공급자 SKU로 쓰지 않는다. 상품 옵션은 고유 내부 ID를 가지며, 미확인 공급자 SKU는 공란·`unverified`로 보존한다. 알려진 공급자 SKU 중복, CNY 미확인, 누락·0·음수 원가는 계속 거절한다. 기존 OpenAPI의 좁은 `offerDefault` 예외를 페이지 수집에 재사용하지 않는다.

미확인 SKU의 옵션 이미지는 자동으로 조인하지 않는다. 원본 이미지 풀을 보존하고 사용자가 수동으로 선택할 수 있다. 원문 행 키를 모바일 상품 API SKU로 취급하는 보충 조회도 막는다. 결과 표의 React 행 키는 원문 행 키를 사용하므로 여러 공란 SKU가 같은 행으로 덮이지 않는다. 최소 주문 수량 미확인은 앞 단계 정책과 같이 별도 경고로 남는다.

실제 로컬 API·SQLite에서 두 회사 모두 2개의 미확인 SKU와 1개의 확인 SKU를 가진 수집본의 상품화, 각 원가, 출처, 고유 내부 ID, 수동 편집 후 재실행 보존, 기존 상품·원문 불변을 검증했다. 잘못된 provider·offer·키 개수·중복·조작한 증거와 가격 누락도 거절한다.

## 카테고리 인증서 항목과 원본 PDF 연결

기존 법적 서류 원본에 선택적 `supplier-hub-native-legal-binding-v1` 연결을 추가했다. 서버가 현재 승인 회사·저장 카테고리 schema·포함 옵션 전체의 실제 인증 값으로 선택 항목을 만든다. 클라이언트는 서버가 제시한 target ID만 선택할 수 있다. 인증서 항목은 schema의 0 기반 행 순서, field ID, 정확한 이름·타입을 보존한 값에 연결된다. 옵션 순서나 PDF 업로드 순서로 인증서 번호를 추정하지 않는다.

현재 카테고리에 실제로 있는 bucket만 제시한다. 기존 일반 첨부를 임의로 인증 파일로 바꾸지 않으며 PDF만 연결한다. PNG/JPEG 원본의 보관·다운로드는 유지한다. 원본 storage key·파일명·바이트·길이·SHA256은 바꾸지 않는다. 아직 지원하지 않는 bucket이나 오래된 schema·인증 값, 포함 옵션의 불일치, 같은 슬롯 중복은 거절한다.

API는 연결 저장 시 content revision뿐 아니라 현재 상품·옵션·기본설정·카테고리 profile·수집본·견적 payload·회원 회사를 원자 INSERT 조건에서 함께 확인한다. 그 사이 다른 창의 편집이 들어오면 409를 돌려주고 경쟁 편집과 원본을 보존한다. 조건 SQL은 서버의 `sourceGuard`에서 만들며 request JSON으로 받지 않는다. 연결 해제는 현재 profile이 사라졌어도 저장된 연결 SHA로 가능하다. 어느 동작도 R2 원본 삭제나 7단계 견적서 내용 변경을 하지 않는다.

법적 서류 편집 UI에 PDF별 공식 항목 선택·해제를 추가했다. 오래된 연결은 재확인이 필요하다고 표시하며 다른 상품으로 전환·unmount·늦은 응답·불확실한 저장 응답에도 이전 미리보기를 유효하게 유지하지 않는다. Single 준비 응답은 `nativeLegal` sidecar를 포함하지만 실제 multipart 전달 미구현 오류는 그대로 유지한다.

## 실제 화면 검수와 관측 범위

같은 Chrome 2에서 실제 React + 로컬 API + SQLite를 사용했다. 상품·AI·카테고리·이미지·PDF 응답은 합성 fixtures이며 외부 1688와 Supplier Hub 요청은 각각 0이다.

- 수집본 v2의 두 옵션(SKU null, MOQ null, CNY 7/9) → 저장 분류 80719 → 초안 상품 → SEO 제목·태그·두 번째 옵션 수동 수정 → 저장 후 재조회에 같은 값이 남는다. 새 합성 상품 ID는 `8dd86969-1701-4ce2-aef7-c435fb918306`이다. 기존 합성 상품 및 접수 데이터 SHA와 첫 수집본 SHA는 같다. 증거는 `outputs/step755-browser-qa/proof.json`, `source-ready.png`, `seo-saved.png`다.
- 법적 서류 UI에서 합성 원본 PDF를 인증 항목에 선택하여 PATCH 200 후 GET에도 같은 연결이 남는다. 새 합성 상품은 `14c42a79-fea6-4172-b155-27cbd3ac4ec8`, 원본 PDF SHA256은 `115180c6cea2e52f19c453a6d688fd828c09e41248236e5b9ed830159258a404`다. 원본 바이트와 7단계 견적서는 같다. 증거는 `outputs/step755-legal-browser/proof.json`, `mapping-saved.png`다.
- 별도의 자체 탭에서 실제 Supplier Hub 신규 등록 화면에 읽기로 접속했고 계정 메뉴의 `Company Code: A01526306` / 유앤채를 확인했다. 상품명·카테고리·다음·저장·동의·업로드·최종 전송은 조작하지 않았다. 이는 접속 확인이며 접수 확인이 아니다. 증거는 `outputs/step755-hub-company.ax.txt`와 PNG다.

모든 자체 검수 탭·로컬 서버를 닫았으며 원래 사용자 탭은 유지했다. 두 회사의 API 검수와 별개로 이번 실제 Hub 화면 관측은 유앤채만 해당한다.

## 검증과 배포 범위

관련 54개 고유 파일의 최종 758개 검사가 모두 통과했다. 실패·취소·skip·todo는 0이며 실행 중 1,468개 소스·테스트·설정 입력 SHA가 같다. 반복·집중 실행 수는 합산하지 않는다. 첫 회귀의 메모리 초과 로그를 보관했다. 일반 DB content 저장소의 quotation runtime 의존을 제거하고 서버가 만든 조건을 전달하도록 정리한 뒤, 테스트 자식 프로세스 heap만 1GB로 조정했다. 운영 Worker 메모리 설정은 바꾸지 않았다. 이후 두 번째 757개와 최종 758개의 성공 로그도 별도로 보관한다.

최종 실행 후에는 다운로드 버튼 두 곳의 표시 버전만 실제 링크와 같은 2.1.6으로 바로잡았다. 이 두 문구 수정은 동작 변경이 아니며 최종 타입·린트·운영 빌드를 다시 검사했다. DB schema 검사는 46테이블·17인덱스·30모듈로 통과하며 migration은 없다.

확장 패키지는 2.1.6, 84개 파일·968,035바이트, SHA256 `65612f736c84b476e24aed1544ddbb10b98035a3491de2fbf9a843e9243d674d`다. 공통 validator를 포함한 생성 모듈과 ZIP 일치를 확인했다. 최소 호환 runtime은 2.1.4로 유지한다. 이번 변경에 설치된 Chrome 확장 새로고침을 요구하지 않았고 2.1.6이 설치됐다고 주장하지 않는다. 새 권한·유료 provider·리소스는 없다.

## 아직 완료되지 않은 실제 전송

보관한 REA 증거는 native `upload-files-by-type`의 `uploadFiles` multipart part, bucket, `cert{schemaIndex}-{originalName}` 별명을 보여준다. 실제 신규 등록 화면의 script DOM에서 현재 `https://supplier.coupang.com/sr/static/js/main.5239dce6.js`를 확인하여 실행 없이 내려받았고 SHA256이 보관한 Hub548 자산과 정확히 같은 `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`임을 확인했다. 동일 입력의 REA 결과를 재생산하지 않고 재사용한다. 최신 QVT 전용 자산으로 SR 계약을 추정하지 않는다.

현재 adapter는 JSON 요청 전용이며 원본 PDF multipart 전달·원격 보존과 최종 접수의 연결은 아직 구현/검증되지 않았다. 현재 서버의 업로드 헤더·CSRF·응답 전체·바이너리 재조회는 현재와 동일한 정적 client만으로도 확정할 수 없다.

`SINGLE_DOCUMENT_LIVE_VERIFIED=false`, `PRODUCT_DOCUMENT_LIVE_VERIFIED=false`와 `SINGLE_LEGAL_DOCUMENT_TRANSPORT_UNVERIFIED`를 유지한다. 원본 연결 저장 성공을 실제 인증서 업로드나 접수 성공으로 표시하지 않는다. 실제 새 1688 수집, 전체 카테고리 기본값과 단계 UI의 동등성, 전체 옵션 실제 접수는 미완료다. 이전 자동 승인 검토에서 거절된 1688 주소에 다른 도구·확장·서버·CLI로 재접근하지 않았다. 최종 배포·커밋·검사 정보는 `outputs/step755-final-validation.json`과 HANDOFF의 Step755를 따른다.
