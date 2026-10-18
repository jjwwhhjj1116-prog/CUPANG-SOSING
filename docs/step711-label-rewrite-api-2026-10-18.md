# Step 711 — 표시사항 재작성 API와 생성 세대 보존

## 구현

`POST /api/products/:id/product-labels?profileId=...`를 추가했다. 요청 본문은 `expectedRevision`, `expectedInputFingerprint` 두 키만 허용한다. 서버가 현재 저장본의 `renderEpoch`를 1 증가시키며, 해당 값이 없는 기존 저장본은 0세대로 취급해 첫 재작성에서 1을 기록한다. 외부 요청이 세대 값을 지정하거나 문구·항목 구조를 함께 전달할 수 없다.

POST는 기존 PUT과 같은 운영 인증·소유자·회사·카테고리 프로필·원천 자료 확인, 동일 출처 검사, 96KiB 본문 제한과 저장 CAS를 사용한다. 원천 확인과 `product_labels`의 revision, `products.updated_at` 갱신은 기존 D1 배치 트랜잭션을 공유한다. 이전 요청을 다시 보내거나 저장 직전에 원천이 달라진 경우 409를 반환하며 세대를 다시 올리지 않는다. revision과 세대는 안전한 정수 범위 안에서만 증가한다.

재작성은 라벨 생성 레시피를 바꾸는 작업이다. 저장한 문구 override와 항목 구조는 그대로 보존한다. 제품 내용·옵션·가격·기본설정·카테고리·견적 override·최종 이미지 참조·이미지 풀·파일을 수정하거나 삭제하지 않는다. 상품의 견적 상태는 기존 라벨 저장 동작과 동일하게 대기로 바뀐다. 이전 생성 PNG는 새 세대와 일치하지 않으므로 기존 검사기가 `GENERATED_PRODUCT_LABEL_STALE`로 판정하며, 새 PNG 생성·연결은 별도 명시적 작업으로 남는다.

## 이전 저장본과 일반 저장 호환성

- 세대가 없는 GET 응답·DB payload에는 `renderEpoch`를 추가하지 않는다. 기존 fingerprint 입력 구조도 동일하게 유지한다.
- 세대가 있는 경우에만 GET view와 라벨 원천 fingerprint에 값을 포함한다.
- `saveProductLabels`는 revision이 존재할 때 현재 상태를 읽고, 이전 내부 호출자가 새 인자를 생략해도 기존 세대와 공유 구조를 보존한다. 명시적 세대는 양의 안전한 정수이며 현재 값 또는 바로 다음 값만 허용한다.
- 일반 PUT은 세대 입력을 받지 않으며 저장 한도 계산에 이미 존재하는 세대를 포함한다. POST도 새 세대 필드 자체의 바이트를 512KiB 저장 한도에 포함한다.
- 제품 시각이 증가하면 기존 견적 원천 resolver의 `quotationInputFingerprint`도 갱신된다. 견적 revision·저장값이 그대로라는 이유로 해당 fingerprint까지 동일해야 한다고 가정하지 않는다.

## 검수

`tests/product-label-rewrite-api.test.mjs`는 유앤채 `A01526306`와 와이홉 `A01464742` 각각에서 실제 라벨·견적 route, SQLite SQL 트랜잭션, PNG 메타데이터 검사기를 실행한다. 상품·카테고리·PNG와 인증은 격리된 합성 fixture다. 두 시나리오 모두 통과했다.

검증한 경로:

1. 레거시 세대 부재 → 명시적 POST 세대 1과 revision·상품 시각 증가 → 동일 이전 POST 409, 추가 증가 없음.
2. 세대가 있는 일반 문구·구조 PUT → 세대 1 유지 → 다시 POST 세대 2 → 두 선택 인자를 생략한 이전 내부 저장에서도 세대와 구조 유지.
3. 원본 문구·구조·옵션의 수동 공란·제외 옵션 값·견적 참조·파일·이미지 풀·다른 소유자 자료 보존.
4. 정확히 같은 라벨 계획의 이전 PNG도 세대가 달라지면 STALE 판정. 수동 파일과 공란은 자동 선택·교체하지 않음.
5. 수동 세대 주입, 잘못된 본문·쿼리·프로필·소유자·회사·운영 인증·Origin·본문 크기 거절. 거절 전후 업무 테이블 불변.
6. 실제 SQL 쓰기 직전에 상품 원천 시각을 바꾸는 동시성 주입으로 409 확인. 라벨 부분 저장 없음.
7. 512KiB 바로 아래의 유효한 레거시 payload에서 새 세대 필드가 한도를 넘기면 413. 최대 안전 정수 세대에서 재작성은 409. 잘못 저장된 세대는 GET에서 503으로 거절하며 읽기로 데이터를 변경하지 않음.

최종 결과는 **2/2 통과**, 2878.217ms이며 해당 파일들의 ESLint와 `git diff --check`도 통과했다. 최초 실행에서는 테스트가 견적 원천 fingerprint까지 불변이라고 가정해 실패했으며, 실제 상품 시각 연동을 확인한 후 테스트 기대값을 수정했다. 최초 로그는 `outputs/step711-rewrite-api-tests-initial-fingerprint-expectation.log`에 보존했고 최종 로그는 `outputs/step711-rewrite-api-tests.log`다.

증빙: `outputs/step711-rewrite-api-proof.json`.

## 고정 소스

| 파일 | SHA-256 |
| --- | --- |
| `db/product-labels.ts` | `2c243c238185c4a5c313a8b75787293dae0a2d54dc65edf423a4928cb7567a64` |
| `app/api/products/[id]/product-labels/route.ts` | `f40f16767534a071bd7dab07b26ede437cb2cad3fb56b28a1060cbc62d484b5a` |
| `tests/product-label-rewrite-api.test.mjs` | `1dc26768d92629aad248ccca7b0cb5c7a87468bd4aa06b07ee7b49d5aa4b11e5` |
| `outputs/step711-rewrite-api-proof.json` | `f9ea5a61a396fdb3c7ce529ef14d1df6acfd151740c948d725555f67e1d09cbe` |

브라우저 조작, 외부 요청, 공급자·AI 호출, 실제 상품 변경과 Supplier Hub 전송은 0건이다. 이 검증은 실제 외부 접수 완료나 브라우저 글꼴·이미지 픽셀 일치를 주장하지 않는다. 부모 UI와 새 클라이언트, 전체 빌드·배포는 루트 작업자의 별도 검증 범위다.
