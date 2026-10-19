# Step738 — 공개 모바일 상품의 갤러리와 옵션 사진 분리

2026-10-19 KST. 기준 commit `5681dd6166deeead24f0a5c76c6384f57df0d235`.

## 변경한 동작

공개 모바일 상품 페이지의 `offerImgList`와 첫 두 옵션 속성의 사진을 하나의 additional 목록으로 저장하던 경우, 옵션 전용 사진까지 추가이미지 초안에 자동 선택됐다. 새 full/partial 모바일 원문은 실제 페이지에서 읽은 갤러리 prefix를 `1688-public-mobile-gallery-v1`로 보존한다. 공통 추가이미지는 해당 갤러리에서 선택하며 옵션 전용 사진은 원본 자료함과 SKU별 대표 연결에 유지한다. 사용자가 직접 추가이미지로 선택하는 것도 가능하다.

SKU-only 응답의 `picUrl` 한 장은 전체 페이지 갤러리의 근거가 아니므로 marker를 생성하지 않는다. 원문 SKU·옵션명·원가·MOQ·재고·정렬·첫/둘째 속성의 대표 사진 선택은 그대로다. 상세 조회가 일시 실패한 partial 원문도 이미 확인한 페이지 갤러리는 보존하며 상세 사진을 만들어 넣지 않는다.

Chrome/server full·partial provider와 저장·재검증·이미지 가져오기까지 같은 marker를 유지한다. OpenAPI marker와 public marker의 허용 provider는 분리했다. supplement는 최초 원문의 marker만 보존한다. marker가 없는 기존/SKU-only 원문에 나중 capture의 marker를 복사하지 않는다. 이전 수집 결과나 상품에 적용하는 migration과 일괄 재수집은 없다.

## 원본 비교의 근거와 한계

REA의 기존 보관 Evidence와 현재 route artifact의 `processOptions`를 재사용했다. 이 함수에서 일반 추가이미지 후보는 `productImage.images`이며 SKU 속성 사진은 별도다. 분석 파일·SHA·함수 범위·출처는 [독립 감사](step738-public-gallery-audit.md)에 있다. vendor backend의 실제 공급 경로가 자사 public 모바일 경로와 같다는 증거는 아니며, 처음 갤러리 사진을 최종 견적서의 additional에 반드시 중복해야 한다는 의미도 아니다. 새 producer/브라우저 원문 요청은 하지 않았다.

## 검증

- 관련 29개 파일의 **249/249 테스트 통과**, 실패·취소·skip·todo 0. 최초 원문, 이미지 자료함, 초안, 견적서 export, 수정·삭제·수동 공란, 재시도와 두 회사 격리 경로를 검수했다. 외부 HTTP·모델·사진 바이트·Hub 수신은 격리 fixture이며 실제 수집·접수 숫자로 합산하지 않는다.
- 별도 REA 담당의 inert parser 단언 10/10 통과, runtime actionable 지적 0. 위 249개에 합산하지 않았다.
- TypeScript, 변경 파일 ESLint, 운영 빌드, 생성된 Chrome 모듈·확장 ZIP 검사와 `git diff --check` 통과.
- 검사 시작부터 빌드 완료까지 앱/DB/확장/스크립트/테스트 **1,369개 source SHA 불변**. 검토한 파일 SHA도 독립 review와 일치했다.
- 확장 **0.2.86**, 60개 파일, 754,692바이트, SHA-256 `b1526960677d7d5d423b014fe9c51165e2076360c4c46d827185bcc2241d03d4`. manifest 변경은 버전뿐이며 권한·host 확대는 없다. 브라우저에 이 버전이 실제 적용됐다는 검증은 하지 않았다.

운영 Worker 버전은 `8fc84a02-97d7-463b-b3f0-a95b50b56827`이다. 기존 변수와 데이터 구조를 유지해 배포했다. 기존 Chrome4의 앱 탭 `727933758`만 새로고침해 기존 `YP-22E079FC` 1건과 대기열 1건이 표시되는 것을 확인하고 `outputs/step738-deployed-dashboard.png`를 보관했다. 기존 상품의 추가이미지 7장 등 기존 선택은 유지됐다. 화면 확인은 기존 목록 보존의 증거이며 새 수집 흐름의 실제 접수 증거가 아니다.

검사 기록은 `outputs/step738-related-final-{freeze,proof}.json`, `outputs/step738-final-validation.json`, `outputs/step738-public-gallery-review.json`에 있다. 운영 상품 수정·Couplus 수정·Hub 전송은 0건이다.

## 남아 있는 실제 검증

새 1688 상품의 실제 수집, 모든 카테고리별 최신 양식·자동작성 값의 실서비스 대조, 이미지 번역 품질과 최종 Supplier Hub 접수는 이번에 확인하지 못했다. 이전 명시적 재승인 후에도 site-safety gate가 지정된 1688/Open1688 읽기를 거절한 경계를 유지했다. 우회 요청이나 임의 상품 사실 생성은 하지 않았다. `SINGLE_DOCUMENT_LIVE_VERIFIED`와 `PRODUCT_DOCUMENT_LIVE_VERIFIED`는 모두 false다. 이 수정과 배포를 전체 워크프로세스 완료나 새 견적서 접수 성공으로 보고하지 않는다.
