# Step746 — 현재 쿠플러스 URL 수집 경계 재확인

요청: 기존 작업 상품을 보존하면서 쿠플러스의 실제 URL 수집 경로를 REA로 분석하고 YOOFAM에 필요한 CLI/서버 연결을 구현·검증한다. 기준 commit은 `3c0e8eaa7a45a8e374d918b8d8533b367c292234`다. 이번 조사에서 새로운 수집 성공이나 등록전송 성공을 얻지 못했으며 실행 코드는 변경하지 않았다.

## 현재 화면과 배포 파일

2026-10-19, 기존 Chrome4에 별도로 연 쿠플러스 AI상품등록 탭에서 공개 스크립트 참조와 CLI 안내만 확인했다. 기존 작업 상품·설정·대기열을 열거나 수정하지 않았고, URL 입력·상품추가·수집 API·등록전송·CLI 명령·설치/업데이트를 실행하지 않았다. 임시 분석 탭은 닫았다.

화면의 연결 상태는 **CLI1.3.36**, 업데이트 권장은 **1.3.37**이었다. UI에 실제로 참조된 공개 JavaScript5개와 공식 CLI archive를 인증 정보 없이 별도 outputs에 다운로드했다. 현재 route는 이전 Step725와 다른 파일이다.

| 공개 파일 | bytes | SHA-256 |
| --- | ---: | --- |
| `chunk-6b0db3f8.8a741991.js` | 556935 | `5b92873c674c4b76c0e6ce4961caedbf8728ca86f6a15b6d9dc8cdfce80ad1d9` |
| `main.604a4c32.js` | 587746 | `027a17c12b60164e856058cbe449b827d38bf1ec0f7d98bb23acbff2c6c25b67` |
| `couplus-cli-latest.tgz` (1.3.37) | 9170840 | `9089561e73521ffea12e4be1a3abc6ffa70e2716ecdf121ee2464a4b4979b4f3` |

CLI archive는 Step725의1.3.37 보관본과 일치한다. 이전1.3.24/1.3.2의 도구 계약을 현재 버전이라고 혼합하지 않았다. REA 재사용·확인 범위는 `step746-cli-acquisition-audit.md`에 따로 기록한다.

## 현재 일반 추가 경로

TypeScript AST로 현재 route의 정확한 method 범위를 읽었으며 vendor JavaScript를 실행하지 않았다. 범위는 UTF-16 code unit, end-exclusive, slice digest는 UTF-8이다.

| 메서드 | 현재 범위 | slice SHA-256 |
| --- | --- | --- |
| `handleAddProduct` | `[412097,412954)` | `2c08c174d1abb501f2b04228f11a9799af78f94f77887b531077ba13f52cdada` |
| `requestProductInfoFromExtension` | `[412955,413979)` | `d68bf7c9e8a1ae5589f3f56415c76e539e13f4263529323cf5fd6d83164997df` |
| `answerProductInfoFromServer` | `[413980,414761)` | `7e72aae28a53852bd8bbbd31d2a8fcc1f749ab61bffde0e31f517fdf0e866b72` |

세 함수의 bytes는 이전에 보관·분석한 계약과 동일하다.

1. 일반 상품추가는 링크와 타겟 키워드를 확인하고 URL의 offer 번호를 추출한다.
2. 자체 서버의 `/api/aiPage/getProductInfo`에 `[{productId:<offer 번호>}]`를 POST한다.
3. 응답의 `data.result[0].result.result`를 구조화 상품 원문으로 사용한다.
4. 원문을 받은 **다음** 확장에 `GET_PRODUCT_INFO`를 보낸다. 원문/번역 제목·특징·키워드와 선택 카테고리/회사코드를 함께 전달한다.
5. 카테고리 양식과 원문으로 옵션·가격·이미지 후보·속성·견적 골격을 만들고 저장한 뒤 초기 SEO/가격 작업을 진행한다.

현재 main의 `get1688ProductInfo` helper도 같은 서버 endpoint를 사용한다. 새 `createProductObject`의 차이는 저장 전 `_light` 목록 문서를 거절하는 guard 추가이며 수집 공급자 변경이 아니다. 이를 새로운1688 수집 기능으로 세지 않았다.

REA 현재 연결에는 이전 record가 없어 portable bundle을 실제 `inspect-evidence-bundle`로 재열람했다. `ev_cd515dbbeab22000b72ee021eb669326d3fa3695cede4a815ccd90c6966e239a`가 존재함을 확인했다. 이 parent는 이전 응답 branch의 범위이며, 현재 endpoint 전체·서버 내부를 분석했다는 근거로 확대하지 않는다. 현재 함수 동일성은 위 source-bound AST 범위와 digest 대조가 별도 근거다.

## YOOFAM의 실제 연결 상태

자체 `/api/collection-jobs/[id]/collect`는 서버 수집→offer/원문 검증→owner/job에 연결된 불변 원문 저장 경로를 이미 가진다. 기본 provider는 PC JSON-LD/공개 모바일 페이지이며 별도 배포 설정 시 소유자의 공식 상품조회 API connector를 선택한다. 이것은 쿠플러스 private 상품 서버와 동일한 데이터 원천·성공률·속도가 검증됐다는 뜻이 아니다.

현재 기존 Worker에서 **secret 이름만** 조회했으며 `ALIBABA_*` 설정 이름은0개였다. 비밀값은 읽지 않았다. 기존 배포 artifact에도 공식 API 활성화 설정이 없다. 이 상태에서 공식 connector 코드를 가지고 있다는 것과 운영에서 해당 상품조회 서비스를 사용한다는 것은 다르다. 공개 fallback의 실제 성공 여부는 따로 검증해야 하며, 키가 없다는 사실만으로 공개 수집 실패를 판정하지 않는다.

현재 코드의 구현 부품과 아직 확보하지 못한 운영 조건:

| 항목 | 현재 판정 |
| --- | --- |
| URL→서버 수집 요청→원문 저장→선택 카테고리/회사별 초안 | 구현 있음, 격리 검증과 신규 실상품 검증은 구분 |
| Chrome 확장 수집/Hub 연결 | 0.2.88 구현 있음, 대상 상품 실수집 성공은 이번에 미관측 |
| 전용 YOOFAM CLI 설치본 | 없음 |
| 소유자의 공식 상품조회 API 운영 설정 | 현재 구성되지 않음 |
| 쿠플러스 private 서버의 실제 공급자·캐시·인증·재시도 | 공개 UI/CLI 밖이므로 미확인 |
| CLI만 추가하면 같은 수집 성공을 얻는다는 근거 | 없음 |

따라서 필요한 핵심은 **실제 상품 원문을 공급하는 정당한 운영 연결과 검증**이다. 실행 프로그램이나 비어 있는 중계 endpoint만 추가해 이 공백을 해결했다고 보고하면 안 된다. 원문에 없는 SKU·가격·MOQ·치수·무게를 만들어 단계/접수를 완료 처리하지 않는다. 다른 회사나 기존 작업 상품의 자료로 새 상품 검증을 대체하지 않는다.

## 이번 지정 상품의 실행 한계

`963861920029`는 Step745에서 Chrome 읽기 도구의 site-safety gate가 `detail.1688.com` 관측 권한을 거절했다. 정책은 같은 목적을 앱·확장·CLI·서버·Couplus 조회·대체 브라우저로 우회하는 것도 금지했다. 이번 요청에서 같은 주소를 다시 열거나 상품 서버를 호출하지 않았다. 이 정책 오류를 YOOFAM 수집기의 실제 HTTP 실패 응답으로 바꾸어 설명하지 않는다.

해당 상품의 실제 원문·옵션·가격·이미지를 얻지 못했으므로 새 상품/견적서 생성·수집·전송·접수는0건이다. 운영 기존 상품 변경도0건이며 두 native live gate는 false다. 이 조사 결과로 전체 동일 구현이나 실제 접수 완료를 주장할 수 없다.
