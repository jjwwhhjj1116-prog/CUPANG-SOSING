# 1688 URL 수집의 Cloudflare 실행 차이와 Chrome 공개 원문 경로

## 확인한 문제

지정 상품은 `https://detail.1688.com/offer/813724060928.html`이다. 실제 Cloudflare 실행 환경에서 공개 PC 조회는 HTTP 302를 반환했고, 별도로 실행한 공식 모바일 페이지 조회는 HTTP 200 HTML을 반환했지만 상품 초기 데이터가 없어 해석에 실패했다. 302의 로그인/확인 페이지를 따라가거나 상품 데이터로 간주하지 않았다. 기존 확장의 PC JSON-LD 수집만으로는 JSON-LD가 없는 1688 상품을 해결할 수 없었다.

검사는 고정 상품 하나만 읽는 임시 Worker에서 실행했다. 인증정보·DB·R2 바인딩은 없었다. 해당 진단 Worker `yoofam-source-probe-step519`는 검사 후 삭제했다. 운영 앱과 공개 이미지 Worker는 유지했다. 상세 결과 파일은 Git에 포함하지 않는 outputs/step519-source-probe에 있다.

## 구현한 흐름

사용자 카테고리/URL 선택 → 서버 공개 수집 → 서버에서 수집하지 못한 경우 원래 앱 탭에 연결된 Chrome 확장의 익명 공개 모바일 조회 → 서버의 원문 재검증 → 소유자별 수집 기록 → 기존 상품/이미지/SEO·옵션·가격 초안 반영이다. 이후 1~7단계 검토/수정과 명시적 등록전송 흐름을 유지한다. URL 수집 중 Hub 전송은 실행하지 않는다.

- 확장 0.2.29는 공개 모바일 페이지, 그 상품의 SKU 서비스, 해당 페이지가 지정한 상세 CDN을 순서대로 조회한다. 모두 manual redirect/credentials omit/no-store GET이다. 상품번호·가격·MOQ·SKU·이미지 관계를 확인한 후에만 상세 주소를 요청한다.
- 공개 모바일 조회가 성공하면 상품 탭 query/create/remove를 수행하지 않는다. 실패하면 기존 PC JSON-LD 경로를 사용할 수 있다. 요청한 앱의 창/주소 변경이나 취소는 이 대체 경로를 허용하지 않는다. 다른 Chrome 프로필이나 새 Chrome 창을 열지 않는다.
- 서버와 확장이 동일한 공유 수집기·parse5 기반 원문 파서를 사용한다. MD5는 공식 공개 lib-mtop 요청 형식의 UTF-8 체크섬으로만 사용한다. 회원 비밀번호/로그인 인증용 알고리즘이 아니다.
- 새 형식은 1688-public-mobile-capture-v1이며 원문 HTML/SKU JSON/상세 문자열만 전달한다. 서버는 상품번호·공개 플래그·SKU·CNY 가격·수량·Alibaba CDN 주소를 다시 검사한다. 확장이 주장하는 정규화 상품/견적서/등록 완료 객체는 받지 않는다. 정규화 결과의 provider는 chrome-public-mobile-v1이다. 각 원문은 2 MiB, JSON HTTP 본문은 8 MiB 이내다. 기존 JSON-LD 한도 1.5 MB와 소유자/취소/중복 저장 검사를 유지한다.
- 확장이 프로필 쿠키·비밀번호·로그인 토큰·세션 저장소를 읽지 않는다. 이번 익명 요청에 새로 응답한 mtop 전송값 두 개만 정확히 같은 확장 initiator의 다음 SKU GET에 일시적으로 사용한다. 웹 페이지/다른 확장/다른 URL의 응답은 제외한다. 네트워크 요청 뒤 정리하고 중단된 Worker의 잔여 임시 규칙도 제거한다. 원문 응답, 앱 메시지, DB 수집 기록, 콘솔에 전송값을 포함하지 않는다.

Chrome의 fetch에서 숨겨지는 응답 헤더와 금지되는 요청 헤더를 처리할 때만 공개 SKU 서비스의 읽기 전용 webRequest와 정확한 URL/확장 initiator에 제한한 session rule을 사용한다. [Chrome webRequest 문서](https://developer.chrome.com/docs/extensions/reference/api/webRequest), [Chrome declarativeNetRequest 문서](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)를 참고했다. 실제 Chrome에서 이 네트워크 동작을 성공시킨 검사는 아직 아니다.

## 검증 결과와 범위

2026-09-30 14:15:56 UTC에 생성한 실제 확장 모듈로 PC의 익명 공개 HTTP 전송을 실행했다. 4회 요청, 원문 수집 4,355 ms에 옵션 6개/CNY 3.6·5.5/이미지 19개(상세 11개)/속성 24개를 다시 확인했다. 같은 원문을 실제 API/SQLite 초안 경로에 전달해 chrome-public-mobile-v1 기록, 옵션 6개, SEO 요청 1회와 초안 저장을 확인했다. 전체 5,625 ms였다.

이 검사는 실제 공개 상품 데이터와 생성한 모듈을 사용했지만 **Chrome 네트워크 헤더/이벤트는 실행하지 않았다**. SKU 전송에 PC의 익명 HTTP 도구를 사용했다. 인증·AI 응답·다운로드 이미지 바이트는 fixture이고 DB는 임시 SQLite였다. 운영 상품 저장·운영 AI 품질·실상품 이미지 번역·실계정 Hub 접수를 입증하지 않는다. 80719는 관찰된 폼의 테스트 계약이며 이 선글라스의 실제 상업 카테고리로 분류한 것이 아니다.

추가 회귀 검사 12개와 기존 검사를 합쳐 전체 1,477/1,477 통과했다. 원문 재검증, 공개 전송값 범위, 창/주소/취소, 요청 실패 후 정리, Worker 재시작 후 정리, 정리 실패 시 중단, 원문 크기/잘못된 JSON, 서버 실패→확장→소유자 수집 기록→SEO·가격 초안 경로를 검사했다. TypeScript와 변경 파일 lint는 오류 0, Cloudflare 운영 빌드도 통과했다. 전체 저장소 lint에는 기존 account/batch-translation/option-prices의 React effect 오류와 Git에서 제외한 outputs 진단 코드 오류가 남아 있으며 전체 lint 통과로 보고하지 않는다.

현재 Chrome 바인딩의 작업 탭 목록은 []이다. 사이트의 로그인 실패나 차단을 확인한 결과가 아니며, 다른 Chrome 프로필을 찾아 조작하거나 새 창을 만들지 않았다. 실제 Chrome에서 URL 입력→초안 생성, 전체 카테고리의 공식 양식/기본값 대조, 두 회사의 실제 견적서 등록 완료는 남은 실검증이다. 전체 완료율 수치를 산정할 근거는 없다.

## 적용

새 확장 원본은 extensions/supplier-hub, 다운로드 ZIP은 public/downloads/yoofam-plus-supplier-hub-extension-0.2.29.zip이다. 기존 Chrome에 로드한 해당 확장을 갱신/새로고침하고 앱 페이지를 새로고침해야 새 수집 경로가 적용된다. 빌드/검사 명령은 npm run build:extension / npm run check:extension이며 운영 빌드가 파서와 다운로드 ZIP의 일치를 확인한다. DB 마이그레이션과 공개 이미지 Worker 변경은 없다.

운영 앱 배포 버전은 `5dbf4b13-8c38-4ac3-98ab-387c4ddaa1cb`, 주소는 https://sourceflow.jjwwhhjj1116.workers.dev 이다. 앱·새 확장 다운로드·수집 원문 API의 익명 요청은 모두 Access HTTP 302 로그인 보호를 유지한다. 이는 인증한 사용자의 초안 생성 또는 Chrome 확장 실행 검증이 아니다. 확장 ZIP은 30개 파일/366,181바이트, SHA-256 `80a1d38d37bcd65b6b6d8e83e7c268d289b95320f00c91d0ae80147b21684444`이며 공개 배포 산출물과 로컬 원본 ZIP 바이트가 일치한다. Access 뒤의 운영 다운로드 바이트는 익명 검사로 확인하지 못했다. ZIP과 생성 모듈은 UTF-8/LF로 정규화해 Windows의 Git CRLF 설정과 관계없이 재현한다.
