# Step922 — 실제 수집 원문과 Qwen 견적 응답 수정

2026-11-03. 기준 `1ef47678`. 원래 접수된886034098637/문서2347603과 다른 기존 상품은 수정하지 않았다. 새로운965495834905 한 건을 공식 요가양말/필라테스양말103689에 연결해 등록번호261103001001로 가져왔으며, 이 새 상품만 전체 자동 작업을 실행했다.

## 실제 HTML에서 확인한 누락 원인

사용자가 저장한 HTML(125557bytes, SHA256 `58ae93b1bad3677825beaf7d3e7682e4defbdadce95bce500ecd213258f64520`)은 `window.context`에 기록된 데이터 인자를 사용한다. 기존 파서는 SKU8개는 읽었지만 이 carrier의 속성·포장표·상세문서 연결을 놓쳤다. 인자에는 따옴표 없는 숫자 object key가 있어 JSON.parse 전체 호출도 실패한다.

새 `page-context-literal.mjs`는 관찰된 module 정리 wrapper의 리터럴 인자만 비실행으로 읽는다. 문자열·값·배열을 건드리지 않고 object key 위치의 십진 정수 키만 정규화하며 중복·계산식·prototype·실행형 값·다른 wrapper를 거절한다. 고정 경로의 네 상품 identity, SKU 모델, 공개 여부, 단위와 원문 충돌을 검증한다. 추천상품·상점 하위 자료로 범위를 확장하지 않는다.

실제 원본 파일에 수정한 parser를 실행해 **옵션8/속성23/50g 중량8행/상세문서 참조1**을 확인했다. 단위가 없는 별도0.05 값은 사용하지 않는다. 50g는 포장정보의 商品件重尺 표에 선언된 상품 개당 중량이며 독립 실측·총중량을 보장하지 않는다. 치수0은 미확인으로 유지한다. 파일에 상세사진 자체는 없고 기존에 허용된 itemcdn 문서 주소만 있어, 실제 상세사진 저장 완료는 이 검증에 포함되지 않는다.

원본 HTML과 인증·세션 값은 ignored outputs에만 보관했다. 커밋한 fixture에는 필요한 공개 상품 사실과 wrapper만 남겼다. 원문 스크립트 실행·URL 요청은 하지 않았다. REA HTML 구조 parent `ev_0435da7a07effdbe1cb658bfcd5bdee8ce8669bb3f4858a06c83a8f90bc45774`; embedded literal 필드 조사는 별도 inert AST/원문 digest로 확인했으며 REA의 JS 실행 coverage로 주장하지 않는다.

## 실제 자동 작업과 견적 수정

실제 새 양말의 첫 자동 작업은 옵션8개 가격 저장을 완료했다. SEO는 원문에 없는 방수 표현을 포함한 Qwen 결과를 거절했고 원문을 보존했다. 대표·추가사진 일부는 복잡한 배경/잘못된 Vision block으로 검토 상태, 상세 원본은0장, 카테고리 필수 사이즈표 없음, 표시사항의 내용량 근거 부족을 표시했다. 견적 AI는 잘못된 응답 항목 형태로 실패했다. 이를 완성·접수 성공으로 취급하지 않는다.

견적 요청의 JSON schema를 이미 만들면서 Qwen adapter에서 삭제하던 계약 공백을 수정했다. 새 version2 `qwen-json-schema-v2` 정책은 생성된 schema를 전달하고 기존 표준 Qwen parser로 문서화된 parsed-object 응답을 지원한다. 채팅 응답은 원문을 보존해 중복 키를 검사한다. version1의 읽기·입력·응답 처리는 유지한다. 회원·회사·현재 원문·양식·fieldKey·수동값·일일 공유40호출·재시도 금지는 바꾸지 않았다. 설정 정책이 바뀌면 예전 실행 결과를 새 정책으로 승격하지 않는다.

공식 [모델 입력 규격](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/)과 [JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)를 대조했다. 요청 규격을 전달하는 것이 실제 모델의 의미·정답을 보장하지 않으므로 최종 검증을 유지한다.

## 검증 범위

- 최종 관련10개 suite **80/80**, 실패·건너뜀·취소0. 타입·변경 authored15파일 lint·확장 build/check·운영 빌드 통과. 로그 `outputs/step922-final-tests.txt`, `step922-types.txt`, `step922-lint.txt`, `step922-extension-check.txt`, `step922-build.txt`.
- 실제125557byte HTML의 비실행 검증은 `outputs/step922-recorded-html-verification.json`; 별도 source 독립36건은 `step922-context-independent-review.json`. 테스트와 중복 합산하지 않는다.
- 합성 한 옵션의 실제 runner→native 원본 검사→독립 전송 packet 검증을 양 회사에 연결했다. 법적 해당 여부 미확인·후속 설정 변경은 차단했다. 모델·상품·Hub 접수는 합성 검증으로 대체하지 않는다.
- 합성8옵션×갤러리12개는 Vision API96요청 중 실제 모델12회·완료 재사용84회였다. 옵션별 source/CAS 보호를 약화하는 cache 변경은 하지 않았다. 로컬 소요시간은 운영 지연 추정치가 아니다.

남은 실제 검수는 설치된2.1.82의 사용자 재수집, 저장된 상세문서 결과, 새 원문 연결 및 필수 입력 확인 후의 단계별 저장·최종 접수다. 미확인 치수·사이즈표·법적 해당 여부를 임의로 채우거나 기존 문서를 재전송하지 않는다.
