# Step711 — 표시사항 재작성 세대와 PNG 원천 증빙

2026-10-18 KST. 이 담당 범위는 순수 표시사항 모델·PNG recipe·서버 증빙·첨부 및 최종 참조 검증이다. 서버 재작성 POST와 DB 원자적 저장, 확인창·편집기 동작은 다른 담당자가 구현·검수한다. 기존 작업 상품·운영 DB·브라우저·외부 서비스를 접근하지 않았다.

## 의미와 원본 근거의 경계

보관 원본 `resetLabels`는 상품 공통·옵션의 생성 이미지와 상태를 초기화하며 저장 문구·항목 구조와 견적의 파일 참조를 함께 삭제하지 않는다. 정확한 원문 범위·Evidence는 별도 REA 감사에 따른다. 자체에는 같은 생성 상태 필드가 없고, 최종 파일의 인증된 plan 증빙으로 현재 여부를 판정한다. 따라서 기존 문구·구조·참조·파일을 보관하면서 새 생성을 구분하는 선택적 `renderEpoch`를 추가했다. 이는 원본의 내부 저장 구조를 그대로 복사한 것이라고 주장하지 않는다.

`ProductLabelsState`와 `ProductLabelsView`의 `renderEpoch?:number`는 서버 소유다. 없는 기존 자료는 세대0으로 해석하고 응답·저장·recipe에 필드를 보태지 않는다. 필드가 있으면 양의 안전한 정수여야 하며 명시적0·null·문자열·소수·overflow는 거절한다. 일반 문구·구조 저장에서 세대를 바꾸지 않는다. 재작성 POST의 현재 세대+1 저장은 별도 백엔드 CAS 경로의 책임이다.

## PNG와 참조 검증

- `productLabelPreviewSignature`는 필드가 있을 때만 `renderEpoch`를 추가한다. 기존 무표식 자료의 JSON 문자열과 업로드 ID는 정확히 그대로다. 문구와 출력 plan이 같아도 명시적 재작성 후에는 새 업로드 recipe가 된다.
- 서버가 검증해 발급하는 PNG metadata는 선택적 `productLabelRenderEpoch`를 정규 양의 정수 문자열로 기록한다. 파일 조회가 반환하는 receipt는 선택적 양의 정수 `renderEpoch`를 사용한다. 잘못된 형식의 표식은 인증된 생성 파일로 받아들이지 않는다.
- 전송 검수는 현재 표시사항 세대와 인증된 PNG 세대를 plan·카테고리 비교 전에 대조한다. 과거 세대의 파일은 출력 내용이 동일해도 `GENERATED_PRODUCT_LABEL_STALE`이다. Step703의 정확한 전체 빈행 호환 plan도 같은 세대 안에서만 허용한다.
- 표식이 없는 수동·레거시 이미지에는 이 정책을 추정 적용하지 않는다. 파일명을 보고 생성 파일로 분류하거나 기존 파일을 삭제하지 않는다.
- 새 첨부는 현재 렌더 세대와 서버 receipt 세대가 정확히 같아야 한다. 응답 유실 후 같은 현재 recipe의 파일을 GET으로 복구하는 경로는 유지한다. 이전 렌더 저장본은 현재 source/signature 대조에서 중단된다. 새 세대 PNG의 명시적 연결 때만 같은 상품·옵션·프로필·카테고리 범위의 이전 생성 참조를 교체한다.
- 일반 문구 저장 응답과 입력 유지 조회는 예상하지 않은 세대 변경을 수용하지 않는다. 미저장 내용·구조가 없는 명시적 최신본 취소 조회만 새 세대를 받아들인다. 최종 참조의 조회·저장 ACK·유지 조회도 세대 변경을 무시하지 않는다.

## 담당 검수

신규 `tests/product-label-rewrite.test.mjs`의7개 사례가 무표식 기존 recipe의 정확한 동일성, 같은 plan의 세대별 identity, 유효·손상 세대, 일반 저장·refresh 충돌, metadata/receipt 왕복, 과거 PNG stale·수동 파일 보존, 현재 PNG GET 복구·위조 세대 첨부 차단과 참조 ACK 보호를 확인한다.

신규7개와 관련 기존3파일26개를 한 번에 실행해 **4개 고유 파일33/33 통과**했다. 실패·취소·건너뛰기0이다. 기존 파일은 `product-label-empty-rows`, `product-label-structure`, `product-label-references`이며 보호 단언을 수정하지 않았다. 이 중 일부 기존 참조 검사는 격리된 실제 자체 API/SQLite를 실행한다. 신규7개는 순수 모델·실제 첨부/참조 helper와 경계 응답 fixture를 사용하며 실제 이미지 픽셀이나 Supplier Hub 접수를 증명하지 않는다.

로그는 `outputs/step711-rewrite-proof-initial.log`, scoped app5파일·신규 MJS lint 로그는 `outputs/step711-rewrite-proof-lint.log`다. 둘 다 exit0이며 `git diff --check`도 exit0이다. 각 파일 SHA와 정확한 실행 목록·개수는 `outputs/step711-rewrite-proof-final.json`에 있다. 부모 담당자의 최종 통합 검수와 중복 합산하지 않는다. 운영 빌드·전체 타입·전체 저장소 검수·배포는 이 담당 범위에서 실행하지 않았다.

새 리소스·migration·확장·유료 서비스·재시도 정책·전송 gate는 변경하지 않는다. 원문·문구·구조·가격·이미지 바이트와 실제 등록 상태를 조회에서 소급 갱신하지 않는다. 서버 POST·DB 및 UI의 별도 검수 결과를 결합하기 전 전체 워크플로 완료로 보고하지 않는다.

## 추가 실제 연결 검수 — 상속한 이전 공통 PNG

최초33개 focused 검수 이후, 새 세대의 PNG를 실제 생성·첨부해 Single packet까지 만드는 추가 검수를 요청받았다. 이 과정에서 이전 공통 생성 PNG를 옵션이 상속한 경우의 실제 결함을 확인했다. 재작성 뒤 옵션별 새 PNG를 첨부해도 기존의 다른-scope 보존 규칙이 그 이전 공통 PNG를 함께 남겼다. 그 결과 양쪽 옵션 모두 `GENERATED_PRODUCT_LABEL_STALE`로 전송 준비가 막혔다.

수정 전 실제 자체 API 증거는 `outputs/step711-rewrite-single-common-before.json`과 `-before-final.log`에 있다. 공통 PNG만 연결했을 때는 준비 가능했으나, 세대1 재작성 후 새 옵션 PNG 두 개를 만들고 연결해도 이전 공통 키가 각 옵션의 최종 목록에 남는 것을 확인했다. 앞선 probe 두 번은 fixture의 기본 수동 이미지까지 같은 활성 라벨에 남아 기존의 `SINGLE_IMAGE_COUNT` 한도에 먼저 막혔다. 그 로그도 보존했으며, 한 장 제한이나 전송 보호를 완화하지 않고 fixture를 한 개 활성 라벨부터 시작하도록 정리한 뒤 본 결함을 재현했다.

`productLabelReferenceSelection`에 현재 세대를 선택적으로 전달한다. 다음 조건을 모두 만족하는 이전 공통 생성 파일만 새 옵션의 직접 참조 목록에서 대체한다.

- 현재 세대가 양의 안전한 정수이고 인증된 이전 파일 세대와 다르다.
- 파일은 같은 상품·프로필·카테고리의 공통 생성 증빙을 가진다.
- 해당 옵션의 모든 linked label 필드에 직접 override가 없다.
- 공통 linked 필드가 실제 해석된 참조와 동일하며 이전 키를 포함한다.

공통에 저장된 참조와 원본 파일은 바꾸지 않는다. 사용자가 옵션에 직접 다시 선택한 공통 파일, 동일 세대나 기존 무표식 세대의 다른-scope 파일, 다른 프로필·상품과 수동 파일은 계속 보존한다. 자동 원문 이미지의 역할이나 소유자를 추측해 제거하지 않는다. batch의 사전 목록 계산과 receipt 세대 대조도 부모 담당자가 같은 현재 세대를 전달하도록 맞췄다.

신규 `tests/product-label-rewrite-single.test.mjs`는 양사 **2/2 통과**했다. 실제 저장 구조·옵션 공란을 유지한 채, 옵션 직접 생성 PNG 하나와 공통에서 상속한 생성 PNG 하나를 세대1로 재작성한다. 준비 POST가 먼저 stale로 차단됨을 확인하고, 실제 renderer 그리기 순서→파일 업로드→서버 metadata→files GET receipt의 세대1→옵션별 연결을 실행한다. 첫 옵션만 생성하면 다른 옵션은 계속 stale이며, 두 번째 옵션을 생성·연결한 뒤에만 준비 가능하다. 최종 Single packet에 정확한 새 공개 URL 한 개와 media 바이트 SHA가 도달한다.

공통 이전 참조·파일, 제외 옵션의 수동 라벨 참조, 내용·구조·수동 공란·가격·설정·원문·다른 상품이 보존됨을 단언했다. 기존 Single 한 장 형식 때문에 수동 파일 보존은 제외 옵션·이미지 풀과 순수 선택 경계에서 검증했다. 수동·생성 파일 두 개를 한 장으로 간주하거나 지원하지 않는 다중 파일 전송을 성공으로 처리하지 않았다.

각 회사의 추적 API 요청은108회, 별도 media GET은2회다. 초기 fixture 요청이나 route 내부 호출을 합친 모든 호출 수는 아니다. 증거는 `outputs/step711-rewrite-single-proof.json`, 실행은 `outputs/step711-rewrite-single-focused.log`, scoped lint는 `outputs/step711-rewrite-single-lint.log`다. 실제 renderer에는 기록 canvas와 유효 합성 PNG를 사용하므로 글리프 픽셀·실제 브라우저·외부 URL 가용성·Hub 수락은 주장하지 않는다.

최초33개 검사와 `outputs/step711-rewrite-proof-final.json`은 **상속 보정 전 attachment SHA를 가진 역사적 실행 자료로 그대로 보존**했다. 이를 최신 attachment로 검사한 것처럼 해시를 바꾸지 않는다. 새2개 및 부모의 최종 통합 실행이 최신 소스를 대조하며, 별도 실행 수를 합산해 부풀리지 않는다. 이 추가 절의 문서 내용도 최초 focused manifest 작성 이후에 덧붙였으므로 그 초기 문서 해시는 당시 버전의 기록이다.
