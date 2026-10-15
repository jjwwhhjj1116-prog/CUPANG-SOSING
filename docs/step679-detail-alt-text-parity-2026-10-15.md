# Step679 — 상세 저장 대체 텍스트 규칙

2026-10-15 기록. Step678의 공통·전체 옵션 상세 저장에 Couplus의 저장 시 대체 텍스트 규칙을 추가했다. 작업 중인 실제 상품은 수정하지 않았다.

## 보관된 원본 근거

Step676 REA 증거 `ev_8ec3fd01351174fefebdc0fccae8f936ebf1c20201f4c59c76aff551e848ec3c`와 보관 청크 `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`의 `saveDetailPage` 범위 `[131264,136334)`를 재사용했다. 범위는 UTF-16 끝 제외 위치이며 청크 SHA-256은 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`다. 정적 코드 근거이며 새 원본 실행이나 실제 저장 관찰을 뜻하지 않는다.

원본은 `seo.metaDescription`이 truthy이면 그대로 쓰고, 아니면 원래 `productName + " 상세 설명"`을 사용한다. 공통 문서의 기존 `altText`가 truthy이면 유지한다. 모든 옵션의 `altText`는 기존 값과 관계없이 다시 쓰며, 해당 옵션의 원래 저장된 `korName`이 truthy일 때만 `" - " + korName`을 덧붙인다. 공백 문자열도 truthy이고 trim·원문 옵션명 대체·SKU 대체·잘라내기는 없다.

같은 보관 자료의 SEO 부분 저장은 SEO 상품명과 견적 문서 상품명을 바꾸지만 루트 `productName`은 바꾸지 않는다. `getDefaultTitle`은 필드 표시명 사전이다. 따라서 이번 원천은 저장된 `Product.title`, `content.seo.description.value`, `option.translatedName`이며 SEO 제목·`seoTitleDocument`·견적서 제목 수정값·옵션 표시명 fallback을 사용하지 않는다.

## 구현과 호환성

- 새 명시 저장은 일곱 번째 요청 항목 `textPolicy: "couplus-detail-alt-v1"`을 보낸다. 정확한 `imagePage.details.altText` 기본 필드와 canonical `altText`를 연결해 공통의 빈 값만 채우고, 견적 제외 옵션을 포함한 모든 저장 옵션의 대체 텍스트를 갱신한다. 기존 여섯 항목 POST는 이미지·HTML만 저장하며 대체 텍스트를 유지한다.
- 원천 자료는 `detailSaveTextBasis`라는 응답 전용 값으로 제공한다. 지문 계산 뒤 추가하지만 해당 상품명·SEO·옵션 원천은 이미 입력 지문과 기존 상품·내용·옵션 저장 시계의 검증 대상이다. 클라이언트가 보낸 임의 텍스트를 서버 저장 원천으로 사용하지 않는다.
- 영수증에 정책과 `textCommonFilled`를 기록해 처음 공통 값이 비어 있었는지를 재검증한다. 공통 값을 채운 뒤의 반복 요청에서도 같은 계획을 재현하며, 이전 정책 없는 영수증은 이전 이미지·HTML 계획으로 확인한다. 정책이 다른 요청을 같은 성공으로 인정하지 않는다.
- 응답 확인은 옵션별 수정값을 공통 수정값보다 우선한다. 전체 수동 값·수정하지 않은 공통 대체 텍스트·행 출처·응답 전용 원천과 최종 재조회를 확인한다. 응답 유실 복구는 조회만 수행하며 자동 재저장하지 않는다. 기존 숨김·단계 전환·중복 클릭 방어를 유지한다.
- 화면에서 공통 유지/채우기와 전체 옵션 재작성, HTML 비우기, 저장 범위를 알리고 공통·선택 옵션 대체 텍스트를 미리 보여준다. 기존 이미지·HTML 백업과 같은 원자 저장에 실제로 바꾸는 수동 대체 텍스트도 포함한다. 내부 생성 계획은 최대 1,206개 셀을 범위별 검증하며 외부 견적 PUT의 1,000개 제한은 유지한다. 길이 제한은 검증으로 거절하며 원문을 조용히 자르지 않는다.

## 검증 결과와 한계

최종 고유 검사 134개가 통과했다. 기존 API 10, 통합 이미지 10, 클라이언트 15, 화면 15, 원천 회귀 72, 대체 텍스트 12개이며 부분 재실행을 중복 합산하지 않았다. 공통 직접 입력과 공백 유지, 빈 SEO 설명의 원본 상품명 fallback, 빈 한국어 옵션명, 제외 옵션, 정확한 기본 필드/XLSX, 백업, 정책별 반복 요청, 경합, 잘못된 응답, 200개 옵션 경계를 확인했다. `outputs/step679-final-types.log`, `outputs/step679-final-lint.log`, `outputs/step679-build.log`의 최종 타입·린트·빌드 종료 코드는 모두 0이다.

`outputs/step679-native-verification.json`은 `passed: true`, HTTP 60회 모두 2xx, `sourceFrozen: true`다. 실제 Chrome의 React·Image·Canvas·API와 임시 자료로 두 회사 각각 옵션 6개, 백업 1개, 800×400 PNG 1개를 확인했다. EXIF 6 JPEG의 원시 100×800과 표시 800×100, 공통 값 유지/채우기, 옵션별 결과, 원천 자료와 원본 파일 바이트 보존을 대조했다. `outputs/step679-native-dom-proof.json`에는 DOM 근거 4개가 있다. 화면 캡처 시도는 실패했으므로 결과 PNG나 DOM 근거를 화면 캡처라고 보고하지 않는다.

회사·인증·수집 원문은 검사 fixture다. 실제 신규 1688 상품의 전체 수집부터 Supplier Hub 최종 접수번호까지 이어지는 검증은 아직 하지 않았다. 이 기록은 배포나 운영 검증 완료를 대신하지 않는다.

## 배포와 운영 조회

기존 무료 Worker에 버전 `b4a40888-2530-41ff-bff8-0629d9660ba9`를 배포했다. 새 리소스·마이그레이션·권한·확장 업데이트는 없다. 기존 운영 탭의 미저장/저장 중/대화상자 모두 0을 확인한 뒤 새로고침했고, YOOFAM PLUS 제목·상품 목록 1행·로딩 종료·경고 0을 확인했다. 작업 중인 상품은 열거나 수정하지 않았다. 실제 운영 홈 캡처는 `outputs/step679-production.png`, DOM과 배포 기록은 같은 접두사의 `production-dom.txt`, `deploy.log`다. 위에서 실패한 캡처는 임시 검사 화면이며 이 운영 홈 캡처와 구분한다.
