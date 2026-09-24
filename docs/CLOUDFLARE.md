# Cloudflare 운영 연결 준비

이 문서는 서버 인증과 기존 저장소 바인딩의 연결 방법을 설명한다. 실제 계정 연결·리소스 생성·배포 결과는 `HANDOFF.md`의 최신 기록으로 확인한다. 여기에 설명한 빌드·검사 스크립트는 로그인·리소스 생성·DB 적용·배포를 수행하지 않는다. 유료 서비스 호출과 Supplier Hub 등록의 개별 실행 승인은 배포 승인과 별개다.

## 기존 프로젝트와 저장소 유지

- `.openai/hosting.json`의 `project_id`는 `appgprj_6a8d4a6c78908191acecd48b7e0d1620`이다. 기존 Sites 프로젝트를 이어서 사용하는 식별자이므로 새 프로젝트 ID로 교체하지 않는다.
- 기존 바인딩 이름은 D1 `DB`, R2 `FILES`다. 애플리케이션이 이 이름으로 접근하므로 운영에서도 동일하게 연결한다.
- `deployment/cloudflare-config.mjs`의 `00000000-0000-4000-8000-000000000000`은 로컬 개발용 D1 식별자다. 운영 빌드와 배포 산출물 검사는 이 값을 거절한다.
- Access 인증 사용자는 검증한 조직·사용자 ID로 별도의 데이터 공간을 사용한다. 기존 `local-demo` 자료는 자동으로 다른 계정에 귀속시키거나 삭제하지 않는다. 이전 데이터가 필요하면 확인된 계정으로 명시적인 이관 작업을 별도로 준비한다.

## 필요한 Access 설정

Cloudflare Access가 원본 서버로 전달하는 `Cf-Access-Jwt-Assertion`의 서명을 Worker에서도 검증해야 한다. 공개 키는 설정된 팀 도메인의 `/cdn-cgi/access/certs`에서 가져온다. 검증 방법과 Application Audience 위치는 [Cloudflare JWT 검증 문서](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)를 기준으로 한다.

다음 두 서버 환경 변수를 연결한다. 이 값은 조직·애플리케이션 식별자이며 API 비밀 키나 사용자의 로그인 JWT를 입력하는 항목이 아니다.

| 환경 변수 | 값 |
| --- | --- |
| `CLOUDFLARE_ACCESS_TEAM_DOMAIN` | 해당 조직의 `https://<team>.cloudflareaccess.com` 또는 `<team>.cloudflareaccess.com` |
| `CLOUDFLARE_ACCESS_AUD` | 보호할 SourceFlow Access 애플리케이션의 Application Audience (AUD) Tag |

운영 Access 정책은 이 사이트에 접근할 실제 사용자만 허용하도록 설정한다. Worker의 공개 주소·사용자 지정 도메인과 API 경로 모두 동일한 인증 경계를 통과해야 한다. 웹 화면을 보호하더라도 원본 서버는 JWT 검증을 생략하지 않는다.

## 서버 코드 연결 계약

`app/cloudflare-access.ts`는 환경 변수를 스스로 읽지 않는다. 서버 요청 처리부가 환경 변수를 명시적으로 전달한다.

```ts
import {
  authenticateCloudflareAccess,
  AccessAuthenticationError,
  hasProductionAccessConfig,
} from '@/app/cloudflare-access';

const config = {
  teamDomain: env.CLOUDFLARE_ACCESS_TEAM_DOMAIN,
  audience: env.CLOUDFLARE_ACCESS_AUD,
};

// Boolean은 구성 문법만 확인한다. 인증 성공을 뜻하지 않는다.
const configured = hasProductionAccessConfig(config);

try {
  const identity = await authenticateCloudflareAccess(request.headers, config);
  // 모든 D1 조회·수정과 R2 파일 조회에서 identity.userId로 소유권을 제한한다.
} catch (error) {
  if (error instanceof AccessAuthenticationError) {
    return Response.json({ error: error.message, code: error.code }, {
      status: error.status,
      headers: { 'cache-control': 'no-store' },
    });
  }
  throw error;
}
```

현재 `app/chatgpt-auth.ts`가 운영 요청에서 이 검증 함수를 호출하고, 검증 성공 시에만 `verifiedAccess: true`를 반환하도록 연결되어 있다. 작업 화면과 API의 기존 일괄 `production → 503` 조건은 검증된 사용자만 허용하는 조건으로 바뀌었다. 구성 누락·인증 실패는 기존 API 계약에 따라 503을 유지한다. 소유자 결정은 `getWorkspaceOwnerId()`를 사용하며, 인증 관문과 실제 조회 사이에 인증이 실패하더라도 운영 요청을 `local-demo`로 바꾸지 않는다. 기존 `oai-authenticated-user-*` 헤더와 `Cf-Access-Authenticated-User-Email`만으로 운영 사용자를 결정하지 않는다.

반환 형식은 `{ userId, subject, issuer, email, displayName, fullName: null }`이다. `userId`는 검증된 `issuer + "\n" + sub`의 SHA-256에 `cf:`를 붙인 값이다. 이메일이 바뀌어도 같은 `sub`의 자료는 유지되며, 다른 조직은 분리된다. Access에서 사용자를 제거 후 재등록하면 `sub`가 바뀔 수 있다. 사람 계정의 애플리케이션 토큰만 허용하며 빈 `sub`인 서비스 토큰은 허용하지 않는다. 관련 클레임은 [Cloudflare 애플리케이션 토큰 문서](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)에 설명되어 있다.

## 검증 범위와 제한

구현은 네이티브 WebCrypto의 `RSASSA-PKCS1-v1_5`/SHA-256으로 서명을 확인한다. 알고리즘은 RS256으로 고정하며 서명 전에 신원 객체를 반환하지 않는다. 정확한 `iss`, 해당 애플리케이션 `aud`, `type: app`, `exp`, `iat`, 제공된 경우 `nbf`, 사람 계정의 `sub`·이메일 형식을 확인한다. 시간 허용 오차는 0초이며, 키를 기다리는 동안 만료된 토큰도 다시 검사하여 거절한다.

- JWT 최대 16KB, JWKS 응답 최대 128KB, 키 최대 10개, RSA 2048~4096비트.
- 공개 키 캐시는 isolate별 최대 8개 조직, 유효기간 5분이다. 동시 요청은 같은 키 조회를 공유한다.
- 알 수 없는 `kid`에 대한 재조회 및 장애 재시도는 최소 30초 간격이다. 키 교체 직후에는 이 간격 내에서 한시적으로 재로그인 안내가 발생할 수 있다.
- 키 조회는 설정된 HTTPS 팀 도메인만 사용하고 리디렉션을 따르지 않으며 5초 후 중단한다. 토큰 안의 `jku`, `jwk`, `x5u` 등으로 공개 키 위치를 지정할 수 없다.
- 만료된 캐시를 장애 시 신뢰하지 않는다. 아직 유효한 캐시에 있는 검증 키는 그 캐시 유효기간 동안 사용할 수 있다.
- 독립 검증 모듈의 `not_configured`, `jwks_unavailable`은 503이고, `missing_token`, `invalid_token`은 401이다. 현재 애플리케이션의 공통 관문은 기존 미인증 API 계약을 유지하여 503으로 응답한다. 응답에는 원본 JWT·네트워크 오류 세부 정보·키 자료를 포함하지 않는다.

Access 인증은 사이트 계정을 확인하는 단계다. 유료 AI 작업 승인, 외부 상품 등록 승인, 역할별 권한, 변경 요청의 CSRF 방어, 데이터 보존 정책은 별도 요청 처리 정책으로 유지해야 한다.

## 검증과 다음 연결

`tests/cloudflare-access.test.mjs`는 메모리에서 생성한 RSA 테스트 키와 모의 JWKS만 사용한다. 실제 토큰·키·Cloudflare 계정을 읽지 않는다. 정상 서명, 헤더 위조, 알고리즘·클레임·서명 변조, 키 회전, 동시 조회, 캐시 만료·장애, 과대 응답을 검사한다. `tests/access-integration.test.mjs`는 실제 인증 모듈을 화면·API와 함께 실행하여 위조 헤더 거절, 사용자별 자료 분리, 인증 실패 중 `local-demo`로 떨어지는 경합 방지, 미인증 파일·상품 접근 차단을 검사한다.

화면·API 연결과 로컬 동작 및 미구성 운영 거절 테스트는 구현했다. 실제 조직·AUD 구성, Access 앞단 로그인과 Worker 간 전달, 요청 원본·역할별 권한 정책 및 운영 데이터 이관은 승인된 운영 연결 단계에서 확인한다. Supplier Hub 전송과 유료 작업의 개별 승인 조건은 로그인 성공 여부와 별도로 유지된다.

## D1 스키마 기준 파일과 로컬 검증

`db/migrations/0001_sourceflow_bootstrap.sql`은 기존 13개 테이블·7개 명시적 인덱스의 기준 스키마다. `0002_quotation_fields.sql`이 견적 수정 저장을, `0003_archive_indexes.sql`이 날짜별 상품 조회 인덱스를 추가한다. `0004`~`0006`이 수집 결과·상품 연결·이미지 연결을 추가하며 전체는 17개 테이블·10개 명시적 인덱스다. 기존 런타임의 `CREATE IF NOT EXISTS` 호출은 호환성을 위해 유지하며 상품·설정·작업 기록을 지우지 않는다. 2026-09-22 전용 원격 `sourceflow-db`에 세 migration을 적용하고 스키마와 상품0건을 확인했다. 실제 계정/배포 진행은 HANDOFF 16절을 참고한다.

| 영역 | 테이블 |
| --- | --- |
| 기존 상품·설정·가격 정책 | `products`, `workspace_settings`, `product_price_policy` |
| 수집 요청과 선택 당시 설정 | `collection_jobs`, `collection_context` |
| 카테고리·견적서 연결 | `category_profiles` |
| 상품 콘텐츠·옵션 | `product_content`, `product_options` |
| 견적 공통·옵션별 수정 | `product_quotation_fields` |
| 자동화 상태·중복 요청 영수증·이력 | `product_automation`, `product_automation_receipts`, `product_automation_history` |
| 승인된 번역·이미지 작업 기록 | `translation_jobs`, `image_jobs` |

Node.js 22.13 이상과 설치된 개발 의존성으로 저장소 루트에서 다음 명령을 실행할 수 있다. 두 명령 모두 SQLite `:memory:`만 사용한다. 브라우저, 인증 정보, `.wrangler`의 개발 데이터, 네트워크나 Cloudflare 계정에 접근하지 않는다.

```sh
node scripts/check-db-schema.mjs
node --test tests/db-schema.test.mjs
```

첫 명령은 TypeScript 구문 트리에서 `db/`의 정적 DDL을 읽고, 기준 SQL과 각각 빈 메모리 DB에 적용한다. 테이블·열·기본값·CHECK·외래 키·복합 UNIQUE·부분 인덱스를 비교한다. 같은 테이블의 중복 선언은 정의가 동일할 때만 허용한다. 동적 DDL이나 지원하지 않는 런타임 스키마 변경을 발견하면 실패한다. 실제 DB 경로나 바인딩을 전달하는 옵션은 없다.

회귀 테스트는 새 스키마 생성, 순서대로 두 번 적용해도 변하지 않는 결과, `drizzle/0000_spooky_wendell_rand.sql` 기반의 기존 스키마 확장, 기존 상품·수정값·작업 기록 보존을 검사한다. 처리 중·결과 불확실 상태의 유료 작업과 중복 요청 기록도 그대로 남는지 확인한다. 외래 키, 활성 수집 요청 중복 방지, 양수 버전 제약과 스키마 누락 탐지도 검사한다. D1이 외래 키를 기본 적용하는 동작에 맞춰 테스트에서도 외래 키를 활성화했다. [Cloudflare 외래 키 문서](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)

기존 Drizzle 마이그레이션의 상품·설정 PK에는 `NOT NULL`이 명시되어 있고, 기존 런타임 DDL에는 그 표기가 없다. 기준 SQL은 현재 런타임 정의와 일치하며, 기존 테이블에는 `IF NOT EXISTS`로 아무 변경도 가하지 않는다. 따라서 기존의 더 엄격한 PK 선언·기본값·인덱스와 저장 행을 그대로 보존한다. 이전 데이터를 새 Access 사용자에게 자동 이관하지 않는다.

## 승인 후 운영 적용에서 남은 확인

- `vite.config.ts`는 기본적으로 로컬 바인딩을 사용한다. 아래 명시적 운영 빌드에서는 확인된 실제 계정·D1·R2 식별자를 요구하며 원본 `db/migrations`를 산출물의 `dist/.openai/migrations`로 복사한다. 출력 Wrangler 설정의 D1 `migrations_dir`는 `../.openai/migrations`이므로 파일 전체를 이동해도 산출물 안의 SQL을 사용한다. Cloudflare는 사용자 지정 경로와 적용 이력 테이블을 지원한다. [Cloudflare D1 마이그레이션 문서](https://developers.cloudflare.com/d1/reference/migrations/)
- 기준 SQL은 빈 DB와 알려진 기존 스키마를 확장한다. 이름이 같은 기존 테이블에 누락·변경된 열이 있으면 이를 자동 복구하지 않는다. 운영 적용 전에 대상 DB의 실제 스키마·마이그레이션 이력과 백업을 확인하고, 차이가 있으면 별도 업그레이드를 준비해야 한다.
- `db/schema.ts`와 `drizzle.config.ts`는 기존 상품·설정만 표현한다. `db:generate` 결과만으로 새 런타임 테이블 전체를 관리할 수 없다. 현재 기준 SQL과 기존 `drizzle/0000`을 무조건 연속 적용하거나 이미 존재하는 원본 테이블을 다시 생성하는 절차를 사용하지 않는다. 이후 컬럼 변경은 별도 번호의 마이그레이션과 기존 스키마 업그레이드 테스트를 함께 추가하고 검사 스크립트도 그 순서에 맞춰 확장한다.
- SQLite 메모리 검증은 Cloudflare D1의 운영 바인딩·마이그레이션 실행·트랜잭션 제한·용량·복구까지 검증한 결과가 아니다. 실제 D1 적용과 배포 승인을 받은 다음 대상 환경에서 확인해야 한다. R2 `FILES`의 원본 XLSX·이미지·견적서 파일은 이 SQL의 대상이 아니며, 저장소 연결과 기존 파일 보존도 별도로 확인한다.

## 로컬 빌드와 운영 산출물 준비

`npm run dev`와 `npm run build`는 계정 설정 없이 계속 사용할 수 있다. 일반 빌드는 로컬 검증용이며, 산출물에 `SOURCEFLOW_DEPLOYMENT_MODE=local-preview`, `workers_dev=false`, `preview_urls=false`가 들어간다. `node scripts/check-cloudflare-artifact.mjs`는 이 산출물의 배포를 거절한다. 운영 빌드 직후 다시 일반 빌드를 실행하면 `dist`는 로컬 검증용으로 교체되므로 배포 전 검사를 다시 수행해야 한다.

운영 계정과 전용 리소스를 확인한 뒤 `deployment/cloudflare.env.example`을 참고해 git에서 제외된 `.env.production.local`에 다음 식별자를 입력한다. 파일에는 비밀 키나 OAuth/API 토큰을 넣지 않는다.

| 키 | 필요한 실제 값 |
| --- | --- |
| `SOURCEFLOW_WORKER_NAME` | 재사용하거나 생성할 SourceFlow Worker 이름 |
| `CLOUDFLARE_ACCOUNT_ID` | 로그인한 계정의 32자리 계정 ID |
| `SOURCEFLOW_D1_DATABASE_NAME` | SourceFlow 전용 D1 이름 |
| `SOURCEFLOW_D1_DATABASE_ID` | 해당 D1의 실제 UUID |
| `SOURCEFLOW_R2_BUCKET_NAME` | SourceFlow 전용 비공개 R2 버킷 이름 |
| `CLOUDFLARE_ACCESS_TEAM_DOMAIN` | 조직의 `https://<team>.cloudflareaccess.com` |
| `CLOUDFLARE_ACCESS_AUD` | SourceFlow Access 애플리케이션의 64자리 AUD |
| `SOURCEFLOW_CUSTOM_DOMAIN` | 선택값: 소유한 호스트 이름. 비우면 Worker의 `workers.dev` 주소 사용 |

빌드와 검사만 수행하는 명령은 다음과 같다.

```sh
node --env-file=.env.production.local scripts/build-cloudflare.mjs
node scripts/check-cloudflare-artifact.mjs
```

빌드 스크립트는 필수 구성이 유효한지 확인한 다음 `SOURCEFLOW_DEPLOY_TARGET=cloudflare`를 지정하여 설치된 `vinext build`를 실행한다. 이 환경 변수를 로컬 개발에 지정하면 실행을 거절한다. 설치된 Cloudflare Vite 플러그인 1.37.1의 `config` 옵션으로 운영 바인딩을 전달하고 `remoteBindings: false`로 로컬 빌드·개발의 원격 저장소 접근을 비활성화한다. `rsc`와 `ssr` 환경 연결은 기존대로 유지한다. [Cloudflare Vite 플러그인 API](https://developers.cloudflare.com/workers/vite-plugin/reference/api/)

설치된 Sites 플러그인 0.2.0은 옵션이 없는 `sites()`를 사용하며 `.openai/hosting.json`과 기존 `drizzle` 메타데이터를 복사한다. 새 운영 스크립트가 전체 런타임 마이그레이션을 별도로 추가한다. 검사 대상은 `dist/server/wrangler.json`, 실제 Worker 진입 파일·클라이언트 파일, 원본과 동일한 Sites 설정, 실제 형식의 DB·R2·Access 설정, 원본과 바이트가 같은 SQL이다. `.dev.vars`를 포함하거나 로컬 표시·placeholder가 남은 산출물은 거절한다. Worker 호환성 날짜는 설치된 workerd에서 검증한 `2026-05-15`로 고정했다.

운영에서는 `preview_urls=false`를 유지한다. 사용자 지정 도메인이 있으면 `workers.dev`를 끄고 그 호스트만 등록한다. 도메인이 없으면 지정 Worker의 `workers.dev` 주소 전체를 Access 애플리케이션으로 보호해야 한다. 모든 페이지·API 경로를 포함하는 로그인 정책과 허용 계정을 확인하고, 서버의 JWT 재검증도 그대로 유지한다. Access의 팀 도메인·AUD 설정만으로 앞단 로그인 정책이 자동 생성되지는 않는다. [Cloudflare 미리보기 URL 문서](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)

검사 통과는 식별자에 해당하는 리소스가 실제로 존재하거나 현재 로그인 계정이 소유한다는 증거가 아니다. 담당 작업에서 계정 이메일·계정 ID, 대상 Worker·D1·R2, Access 정책과 AUD를 대조한 뒤 D1 마이그레이션과 `dist/server/wrangler.json` 기반 배포를 실행해야 한다. OpenAI 등 유료 공급자 키는 빌드 변수와 분리된 Worker secret으로 연결하고, 개별 유료 호출 승인을 유지한다. 이 준비 과정에서 기존 다른 앱의 리소스를 변경하지 않는다.


## 2026-09-24 운영 DB 확인

기존 전용 D1에 누락된 `0004_collection_results.sql`, `0005_collection_products.sql`, `0006_collection_images.sql`을 적용했다. 원격 마이그레이션 조회에서 미적용 0건, 읽기 전용 테이블 목록 조회에서 애플리케이션 테이블 17개를 확인했다. 기존 행의 조회·수정·삭제는 수행하지 않았다.

`GET /api/integrations`는 연결 쿼리와 별도로 `databaseSchema`를 반환한다. `tables_present`는 필요한 테이블 이름이 존재한다는 뜻이며 열 구조·인덱스·저장 동작·외부 서비스 연동의 검증이 아니다. 누락 시 `missing_tables`와 목록을 반환하고 메타데이터 조회 실패는 `unavailable`로 표시한다. 진단 API는 스키마를 변경하지 않는다.

Access 이메일 허용 정책의 별도 승인 및 실제 AUD 확인은 대기 중이다. 이 DB 적용을 Worker 배포 또는 실제 1688 수집·Supplier Hub 전송 완료로 간주하지 않는다.

## 2026-09-24 Access 정책 연결 및 실제 배포

사용자가 허용 이메일 정책 등록과 개발·연결·배포 진행을 승인했다. 기존 Zero Trust Free 팀에 SourceFlow 자체호스팅 앱과 본인 이메일 한 개만 포함하는 Allow 정책을 저장했다. 앱 설정에서 발급된 실제 AUD를 Git 제외 `.env.production.local`에 반영했다. 이 절은 위 승인 대기 기록의 후속 결과다.

운영 URL: https://sourceflow.jjwwhhjj1116.workers.dev

운영 빌드 및 산출물 검사, Wrangler dry-run 후 기존 D1/R2 바인딩으로 배포했다. 실제 Workers 런타임에서 `redirect: 'error'`가 지원되지 않아 JWKS fetch가 실패하는 문제를 재현하고 `manual`로 수정했다. 200 이외 응답은 계속 거절하며 리다이렉트를 따라가지 않는다. RSA 서명·issuer·audience·시간·계정 검증을 유지한다. 로그인 실패 화면은 비밀정보 없이 오류 코드와 키 조회 단계만 표시한다. 공개 문서는 현재 `error`를 나열하지만 이번 설치 런타임과 운영에서 확인한 동작을 우선했다.

로그인 없는 홈페이지·상품·연동·파일 API 요청이 Access 로그인으로 302 전환되는 것을 확인했다. Chrome 기존 Cloudflare 로그인으로 실제 작업 화면 진입과 운영 D1 쿼리/필수 테이블 확인을 완료했다. R2는 바인딩 존재만 확인했으며 파일 읽기/쓰기, AI 실호출, 실제 상품 수집·등록은 검증하지 않았다. 로컬 자료를 운영 사용자에게 자동 이전하지 않았다.
