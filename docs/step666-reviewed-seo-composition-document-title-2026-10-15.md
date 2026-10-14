# Step666 — 검토한 SEO 초안 적용과 견적서 상품명 연결

Step665 commit `ed79c4fa973702e8789d9fb0fe607a1fe05d5892`에서 이어서, 1단계의 명시적인 SEO 구성안 적용을 기존 견적서 상품명 규칙에 연결했다. 기존 운영 상품과 쿠플러스 작업 상품은 수정하지 않았다.

## 원본에서 확인한 호출 경계

보존된 쿠플러스 UI의 `startAiGeneration` `[197919,198564)`은 브랜드·특징·타겟 메모 갱신 후 `rt.process(this.product)`를 호출한다. UI의 `rt=s("27c2")` 바인딩은 `[195318,195330)`이며, main 모듈의 `process` `[216283,217373)`는 `generateSeoWithRetry` 결과를 `updateProductWithCoupangDocPartial(e,s)`에 전달한다. 같은 모듈의 writer `[184152,186443)`는 기존 문서의 `startPage.productName`에 생성된 `productName`을 그대로 기록한다. 이 경로에서는 옵션명을 붙이지 않는다.

재사용한 REA 증빙은 UI `ev_8e9a17009e057dc9e4c5a48432308c2edcfb8d712d5a3c552093e3fff505d021`, process `ev_1983224a44e1100a435aca7caaa76ebb6e1d9df782252092d57dcc695765e8ee`, writer `ev_6f9827b0f3963841858f7f1e736342f9b28b722b8092af77ffe7f723e83f40c9`이다. 원본 digest·범위는 Step665의 ignored manifests에 보관했다. 이번 확인은 정적 호출 연결이다. 실제 쿠플러스 서버 저장 성공이나 모든 초기 수집·일괄 번역 경로의 동일 writer 사용까지 입증하지 않는다.

## 구현한 적용 범위

`applySeoDocumentTitlePolicy`를 공유하여 수동 SEO 저장과 1단계의 명시적인 `seoComposition` 적용이 같은 제목 값·필드 clock 증빙을 사용하게 했다. `translation-apply`는 미리보기 반환, 검토 지문 대조, 무변경 거절을 마친 후 실제 적용된 title 또는 keywords patch에만 증빙을 추가한다. 현재 Google 초안의 사용자 구성안 적용 경계이며, Gemini 생성 품질이나 제공자 전체 동일성을 주장하지 않는다.

상품명이 수동 보호되어 검색태그만 적용되면 현재 보호된 상품명과 기존 clock을 사용한다. 수동 상품명 공란도 보존한다. 제목이 알려지지 않은 빈 legacy 자료는 product 제목 fallback을 유지한다. 수동 견적서 제목·공란은 자동값보다 우선한다. 다른 제목 writer가 값이나 clock을 바꾸면 기존 증빙은 무효가 되어 기존 fallback이 작동한다.

미리보기·SEO 무변경·상세본문만 적용·옵션 전용·일반 번역·`seoComposition` 없는 초기 수집은 새 정책을 만들지 않는다. 새 API 인자나 DB schema는 추가하지 않았다. 상품·콘텐츠·옵션·수집 원문 CAS와 원자 저장, 직접 수정값 보호, 라벨·본문·가격·포장·이미지 및 생성 이력의 기존 규칙을 유지했다. 생성 이력의 개별 필드 `/content` PATCH도 이번 확장 범위에 포함하지 않았다.

## 검증 결과

최종 9파일 **135/135 통과**, 실패·취소·skip 0이다. 신규 29개에는 두 회사의 실제 API/임시 SQLite 검수, 미리보기 무저장, 적용 후 재조회·견적서 연결, 증빙 주입 거절, 보호된 제목과 공란, 검색태그만 적용, 무변경·본문·옵션·일반 번역 제외, 상품·콘텐츠·옵션 CAS 경합이 포함된다. 기존 composition 14개와 공식 양식 연계 2개의 명시적 구성안 이후 제목 기대값을 새 근거에 따라 plain으로 수정했으며, 수동 견적서와 workbook의 나머지 검사는 유지했다.

worker의 5파일 79개는 위 135개에 포함된다. Step665의 456개 또는 선행 실패 실행과 중복 합산하지 않는다. 초기 실패는 합성 견적 수정값의 category scope, cross-VM 단언, 경합 주입 위치, 빈 설명을 가진 준비 자료에서 발생했다. 이를 실제 카테고리 저장 범위와 명시적인 설명 job으로 바로잡았고 앱 3파일은 추가 변경하지 않았다. 최종 타입 exit 0, 변경 6파일 lint exit 0, bounded build exit 0이다. 기존 vinext route classification 경고는 남아 있다.

같은 기존 Chrome의 로컬 화면에서 실제 `TranslationIntegratedPreview`와 저장 API를 사용했다. 각 회사에 미리보기 POST 1회, 적용 POST 1회, 콘텐츠·견적서 재조회 GET 각 1회를 수행했다. 두 회사 모두 20개 항목을 저장했고 자동 제목은 구성 상품명, 수동 제목과 명시 공란은 기존 값이었다. API/SQLite/DOM 증거 **30/30 조건 통과**다. 자료 준비에는 기록된 Google 응답을 사용하는 mock 요청이 회사별 2회 있었으며 실제 제공자·1688·Hub·운영 DB·업로드 호출은 0이다. 실제 회원 로그인이나 Supplier Hub 접수 완료 증거는 아니다.

로그와 근거는 ignored `outputs/step666-final-tests.log`, `step666-types.log`, `step666-owned-lint.log`, `step666-build.log`, `step666-native-proof-report.json`, 회사별 `step666-seo-native-*-proof.json`, `step666-seo-native-dom.txt`에 보관했다. 이 화면의 screenshot은 세 번 timeout되어 저장 성공을 주장하지 않는다. Step665의 성공 PNG는 별도 SEO 입력 재진입 검수다. 자체 검수 탭·서버만 닫았고 기존 사용자 탭은 유지했다.

## 배포와 남은 전체 검수

기존 무료 Worker 배포 exit 0. 최종 Version `911f5aa8-309a-444f-83f3-ac89c501faa4`, 주소 `https://sourceflow.jjwwhhjj1116.workers.dev/`. 새 자원·migration·권한 변경·확장 업데이트는 없다. 배포 로그는 `outputs/step666-deploy.log`다.

Step660에서 확인한 D1 Free 일일 조회 한도 초과는 2026-10-15 09:00 KST reset 전까지 남아 있다. 운영 상품 읽기를 반복하거나 다른 DB·관리 API·유료 플랜으로 우회하지 않았다. 기존 `SINGLE_DOCUMENT_LIVE_VERIFIED`와 운영 mutation gate는 false다. 실제 새 1688 URL의 전체 SKU·이미지 수집, 모든 카테고리 양식·기본값, 남은 단계 UI 기능, Hub 동의·최종 등록·receipt/SKU 대조는 별도 검수가 필요하다. 이번 변경을 전체 동일구현 완료로 보고하지 않는다.
