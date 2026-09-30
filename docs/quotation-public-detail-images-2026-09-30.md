# 견적서 상세 HTML의 선택 이미지 연동 (2026-09-30)

5단계 미리보기에는 선택 이미지와 설명이 함께 나타났지만, 7단계에서 자동 생성하는 견적서 `detailHtml`에는 설명만 들어가던 차이를 수정했다. 저장한 상단·본문·하단 이미지 순서, 설명, 최종 옵션별 이미지/대체 텍스트를 같은 HTML로 연결한다. 수동 HTML과 명시적인 공란은 우선하며 저장값을 덮어쓰지 않는다.

## 적용 범위

- 견적서 편집, 제출 검토, Excel 및 quotation-fields JSON/CSV가 같은 자동 HTML을 사용한다. 새 상세 설명은 SEO 설명으로 대체하지 않는다. 설명과 대체 텍스트는 HTML로 이스케이프한다.
- 원본 이미지 파일명이나 소유자 ID를 URL에 노출하지 않는다. 서버 전용 키, 소유자와 정확한 이미지 저장 키로 HMAC-SHA256 토큰을 만든다. 같은 입력은 같은 주소를 사용하며 다른 소유자/이미지/서명 키는 다른 주소다.
- 미리보기, 편집 조회/저장과 source 확인은 공개 사본을 만들지 않는다. 사용자가 다운로드·첨부 준비·등록전송으로 파일 생성을 요청할 때, `detailHtml`에 실제 연결되는 포함 옵션의 이미지만 공개 사본을 만든다. 양식에 해당 열이 없거나 모든 관련 HTML이 수동 공란이면 공개하지 않는다.
- 파일 요청 전에 화면에 공개 이미지 수와 주소 보유자가 이미지를 볼 수 있다는 안내를 표시한다. 파일 응답이 성공한 경우에만 보고서의 `publishedByThisRequest`가 참이다. 이미 존재하는 동일 사본의 재사용도 명시적 파일 요청의 확인 작업에 포함된다.
- 이미지 전체의 존재·소유권·실제 파일 형식·10MB 제한을 확인한 후 복사를 시작한다. 실제 GIF 바이트는 미리보기에서 오류로 표시하고 파일 생성도 거절한다. 제외된 옵션의 삭제 이미지 연결은 편집 가능하게 남기며 포함 옵션의 정상 출력을 막지 않는다.
- `If-None-Match: *` 조건과 SHA-256 체크섬으로 사본을 생성한다. 기존 주소의 파일을 덮어쓰지 않으며, 동일한 파일인지 크기·해시·공개 표식을 확인한다. [R2 Worker API의 조건부 put 및 체크섬 계약](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
- 공개 사본 생성 전후 저장본을 다시 대조한다. 변경·저장 오류에 성공 응답을 보내지 않는다. 파일 생성과 외부 업로드는 분산 트랜잭션이 아니며 일부 사본 생성 후 실패한 경우 사본이 남을 수 있다.

## 운영 공개 주소와 로그인 보호

최초 운영 검사에서는 앱의 `/media/quotation/...`도 Cloudflare Access 로그인으로 HTTP 302 전환됐다. 앱의 로그인 정책을 변경하지 않고 이미지 전용 Worker를 분리했다.

- 앱: `https://sourceflow.jjwwhhjj1116.workers.dev`, 배포 `96dfa306-a3c0-417f-8096-1434bf7727f8`.
- 이미지 전용: `https://yoofam-plus-media.jjwwhhjj1116.workers.dev`, 배포 `b6395c71-a983-41c6-9005-9c4afd9e190e`.
- 이미지 Worker는 기존 FILES 버킷 하나만 바인딩한다. DB, 인증정보, AI, 상품 편집 경로를 연결하지 않는다. 정확한 `/media/quotation/<64자리 소문자 hex>`에 GET/HEAD만 허용하고 기타 경로/쓰기 요청은 거절한다.
- 조회는 `quotation-public-detail/` 네임스페이스의 공개 표식이 있는 객체에만 한정한다. 원래 비공개 키를 전달하거나 파일 목록을 조회하는 경로는 없다. 이미지 실제 형식·MIME·크기·해시를 대조한 뒤 nosniff, sandbox CSP, noindex/nofollow 헤더로 반환한다.
- 원래 R2 버킷을 공개로 바꾸지 않았다. 앱과 기존 `/api/files/...`는 계속 Access 로그인으로 보호된다. 이미지 주소를 아는 사람은 로그인 없이 공개 사본을 볼 수 있다.

서버에는 `YOOFAM_DETAIL_IMAGE_SECRET`(64자리 hex 서명 키)과 `YOOFAM_DETAIL_IMAGE_ORIGIN`(검사한 이미지 전용 HTTPS origin)을 Worker secret으로 설정했다. 키 값은 코드·문서·클라이언트에 포함하지 않는다. 두 설정 모두 없는 로컬 환경은 이전 설명 연동을 유지하고, 일부만 있거나 잘못된 설정은 오류로 처리한다. origin/키가 변경되면 견적서 지문이 달라져 이전 패키지를 다시 준비해야 한다.

운영 빌드 후 아래 순서로 이미지 Worker를 준비한다. 생성된 config는 검증한 앱의 계정과 버킷 식별자를 사용하며 Git 제외 산출물이다.

```powershell
node scripts/build-public-detail-worker.mjs
Push-Location dist/public-detail
../../node_modules/.bin/wrangler.cmd deploy --config wrangler.json --dry-run --outdir compiled
../../node_modules/.bin/wrangler.cmd deploy --config wrangler.json
Pop-Location
node scripts/check-public-detail-runtime.mjs
```

새 설치에서는 공개 이미지 Worker의 실제 HTTP 검사 후 앱 secret의 origin을 그 호스트로 연결한다. 공개 이미지 Worker에는 서명 키가 필요하지 않다. 앱 전체의 Access 정책이나 비공개 파일 접근을 해제하면 안 된다.

## 검증

- 최종 전체 테스트 **1,465/1,465** 통과(회귀 17개 추가). config/키 분리·이미지 순서·공란·옵션별 수정·제외/삭제 이미지·GIF 실제 바이트·수동 HTML·재시도·복사 실패·주소 불변·공개 경로 보호를 검사했다.
- 실제 API/SQLite에서 편집 값·Excel/JSON/CSV·미리보기와 파일 응답의 일치, 미리보기/편집 무게시, 명시적 파일 요청의 사본 생성, 변경된 서명 키의 이전 요청 거부를 검사했다. 인증·양식·이미지는 격리 fixture이며 실계정 접수 시험이 아니다.
- TypeScript, 변경 코드 lint, Cloudflare 앱 빌드/산출물 및 이미지 Worker dry-run 통과. 이미지 Worker dry-run에는 FILES 바인딩 하나만 나타났다.
- 컴파일한 앱과 이미지 전용 Worker를 native workerd/Miniflare와 임시 R2에 연결해 익명 PNG 200/바이트 일치, GET/HEAD, 원본 파일 격리, 쓰기/비공개 경로 거부, 조건부 put의 최초 생성/재요청 null을 확인했다. 운영 상품·견적서·이미지를 사용하지 않았다.
- 실제 운영 이미지 호스트에서 없는 토큰·잘못된 토큰·비공개 경로·홈페이지는 로그인 리다이렉트 없이 HTTP 404/no-store. 기존 앱 홈페이지와 비공개 파일은 HTTP 302 로그인 보호를 유지했다. 이는 공개 호스트 도달/경로 정책 검사이며 실상품 이미지의 운영 200 또는 Supplier Hub HTML 수락 근거는 아니다.
- 로그: Git 제외 `outputs/step518-full-tests-final.log`, `step518-build-final.log`, `step518-media-build-output.log`, `step518-runtime.log`, `step518-live-http.json`, 배포/secret 설정 로그. secret 설정 파일의 내용은 기록하거나 커밋하지 않는다.

## 남아 있는 실검증

이 변경은 기능상 공개 HTML 이미지 연결을 구현한 것이다. Couplus의 CloudFront 합성 상세 이미지나 전체 HTML 구조를 그대로 재현했다는 뜻은 아니다. 전체 카테고리의 Couplus 기본값·Supplier Hub 공식 양식 대조, 운영 AI/이미지 번역·법적 서류 첨부, 실계정 최종 접수는 별도 확인이 남아 있다. 공개 사본에 자동 만료·사용자 폐기 UI는 없으며 원본 삭제/계정 변경/서명 키 교체로 기존 공개 사본이 자동 삭제되지 않는다.

DB 마이그레이션과 확장 변경은 없다(0.2.28 유지). 앱을 새로고침하면 적용된다. 이번 작업에서는 기존 Couplus 작업 상품·실계정 Hub 견적서·Chrome 프로필을 조작하지 않았다. 기존 Chrome 바인딩의 탭 목록은 `[]`였으며 새 창/프로필을 열거나 추가 승인·로그인을 요청하지 않았다. 이 목록은 사이트 차단/로그아웃의 증거가 아니다.
