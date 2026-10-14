# Step662 — 1단계 상품명·검색태그·옵션명 통합 저장

기준 `8df079281743e92256df5d367633a841b007894c`. 쿠플러스의 기록된 클라이언트 저장 동작과 YOOFAM의 실제 컴포넌트를 대조하고 1단계 저장을 연결했다. 기존 작업 상품은 편집하지 않았다. 실시간 1688 수집·전체 카테고리·Supplier Hub 접수 완료를 주장하는 변경은 아니다.

## 확인한 차이

쿠플러스 현재 기록 chunk SHA-256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`의 `saveSeoData` UTF-16 [198565,200557), 구간 SHA-256 `d64e11c06db33017e8e91d24023592dad3d3fd9e6f78fb6ebdd39ce3df75cc42`는 상품명·파싱한 검색태그·옵션번호별 한국어 옵션명을 묶어 한 서비스 호출에 전달한다. 저장 중 잠금과 성공/실패 표시도 한 작업에 속한다.

한정된 메서드만 비실행 class wrapper로 선택해 설치된 REA로 조사했다. Parent Evidence `ev_3bb1acf8440f425095be2f253be6c6b74f7c2f9c4e88f3ec9186b4151555e2af`, summary `ev_4944c4f098c7bae5eb3476e3ae0b9d52ab64197140a54ce18ea030e102ed0dc0`. 선택 파일 1개, 파싱 실패 0, AST 494개이며 115개 semantic unknown이 남는다. `rt["a"]`의 외부 서비스 결합과 비공개 서버 원자성은 이 선택에서 미확인이다. 공급자 코드는 실행하거나 앱 소스로 복사하지 않았다. manifest와 전체 retained ledger는 ignored `outputs/step662-rea-seo-*`에 보관했다.

이전 YOOFAM은 공통 SEO와 옵션명 저장 버튼이 별도였다. 양쪽을 수정한 상태에서 공통 상품명·태그를 먼저 저장하면 상품 시계가 바뀌어 옵션명 저장이 막히고 다시 조회하면 해당 입력을 버리게 됐다. 옵션명을 먼저 저장한 뒤 공통 SEO를 저장하는 순서는 가능했으므로 모든 순서가 실패한다고 표현하지 않는다.

## 구현

`SeoWorkspaceEditor`는 상품명·검색태그와 한국어 옵션명을 한 화면에서 편집하고 `SEO 설정 저장` 한 번으로 반영한다. 명시적으로 수정한 항목만 보낸다. 같은 공란을 입력한 경우도 직접 수정으로 저장하며, 손대지 않은 기존 긴 문자열·다른 옵션·provenance는 덮지 않는다. 기존 고급 상품 설명 입력을 유지하고 선택 옵션의 견적 SEO 직접 입력은 별도 범위로 남긴다. 이미지 썸네일은 해당 상품의 저장 파일 또는 정확한 원문 SKU 이미지 연결만 사용한다.

새 `/api/products/:id/seo-workspace`는 활성 상품의 상품·콘텐츠·옵션 저장본을 읽고 상품 시계를 다시 대조한다. PATCH는 상품명·태그·설명과 정확한 옵션명 변경만 허용한다. 상품·콘텐츠·옵션 시계, 소유자, 삭제 상태 및 이미지 풀을 비교하는 기존 D1 batch 방식으로 한 번에 저장한다. 오류가 나면 전부 취소한다. 바꾸지 않은 테이블은 payload·revision·updatedAt 모두 그대로 둔다. 상품 가격·가격 정책·옵션 순서·포장정보·이미지·견적 수동 override는 수정하지 않는다. 기존 SEO 품명 연결은 원래 `applyContentPatch` 규칙을 따른다.

클라이언트는 전체 반환 상태를 실제 apply 함수로 계산한 기대값과 비교한다. 성공 응답이 유실되면 추가 PATCH 대신 명시적인 저장본 GET으로 확인한다. 이미 반영됐으면 완료로 확인하고, 미반영이 확실하면 입력을 유지한 뒤 다음 사용자 저장을 허용한다. 다른 변경과 충돌하면 비교 화면을 제공한다. 단계 전환·자료 시계 변경·언마운트·늦은 응답으로 현재 입력이 자동 저장되거나 지워지지 않는다. 다른 단계의 유지 중인 편집기는 교체하지 않는다.

기록된 쿠플러스 메서드는 원문 태그 문자열이 150자를 넘으면 끝의 태그를 제거하는 분기도 가진다. 이번 통합 저장은 기존 100자 상품명/150자 정규화 태그 검증을 유지하며 해당 자동 축약 분기까지 동일하다고 주장하지 않는다. 비공개 AI 결과·서버 동작도 미확인이다.

## 검수와 배포

로컬 실제 API·SQLite 검사와 기존 콘텐츠/옵션명 회귀 48개가 통과했다. 새 API 검사 22개는 두 회사의 통합 저장, 부분 저장, 같은 공란, 7단계 자동 제목·태그 연동과 수동 견적 override 보존, 권한·삭제·동시 변경 및 트랜잭션 rollback을 확인했다. 상품 가격·포장·이미지·견적 행은 그대로였다. 외부 네트워크·AI·이미지 업로드·Hub 요청은 없었다. 초기 fixture에서 기존 가격 정책 migration column을 생성하지 않은 실행은 실패 기록으로 보존하고 성공 수에 더하지 않았다.

새 클라이언트·편집기·dashboard 연결 검사 36개와 기존 단계·표시사항·SEO 검사 49개가 통과했다. 추가 dashboard 교차 단계 8파일은 최초 101개 중 86개 통과/15개 실패를 기록했다. 통합 편집기 교체에 맞춘 2파일 기대값과 오래된 React stub의 useLayoutEffect/useMemo 누락 3파일을 고친 뒤 해당 5파일 64개가 모두 통과했다. 변경 없는 나머지 3파일의 37개 통과를 합쳐 교차 단계 101개, 이번 작업의 서로 다른 검사 총 234개가 통과했다. 최초 실패 실행을 별도 성공 수로 더하지 않았다. 최종 TypeScript와 변경 소스·검사 lint는 오류/경고 0이다.

기존 사용자 Chrome과 같은 프로필에서 새 로컬 합성 탭 하나로 실제 React 편집기와 앱 API·임시 SQLite를 검수했다. 두 회사 각각 상품명·검색태그·첫 한국어 옵션명을 수정하고 두 번째 이름을 직접 공란으로 바꾼 뒤 저장 한 번 → 편집기 다시 열기 → GET 저장본 대조를 완료했다. 각각 실제 PATCH 1개, 상품 시계·content·options DML 3개이며 11/11 증거 검사를 통과했다. 저장된 수동 견적 제목/공란·가격·포장·이미지 풀과 authored PNG bytes가 보존됐다. 기존 운영 상품 수정·외부 제공자·업로드·Hub 호출은 0이다. 조회 시 기존 runtime CREATE 초기화 batch가 포함될 수 있으므로 전체 batch 개수를 PATCH/DML 횟수와 혼동하지 않는다. 전체 화면 캡처는 Page.captureScreenshot 시간 초과로 실패한 기록이 있고, 문맥을 보존한 viewport clip PNG 2장은 성공해 ignored outputs에 저장했다. 자체 검수 탭과 서버는 종료했다.

최종 bounded build가 통과했고 새 API route가 빌드에 포함됐다. 기존 무료 Worker sourceflow에 Version `bbc475f2-40f5-4a11-b280-d6b497f7bb90`을 배포했다. 새 DB migration이나 extension 버전 변경은 없다. 준비된 다운로드 확장은 0.2.72 그대로이며 현재 설치 버전을 새로 확인한 것은 아니다. D1 quota 초기화 전이라 배포 뒤 운영 상품 GET/저장 검수를 반복하지 않았다.

Step660의 D1 무료 일일 row-read 한도 제한은 아직 초기화 전이다. 운영 조회 우회·플랜 변경·새 DB·인증 완화는 하지 않았다. 전체 최신 카테고리와 새 실상품 전체 SKU·이미지 및 실제 Hub 문서 동의→접수→SKU 대조는 남는다. 운영 개별 등록 실행 gate는 false 그대로다. 로컬 합성 화면·검사·배포가 실제 접수를 증명하지 않는다.

Step661 문서의 저장 라벨 partial writer 원본 표기를 정정했다. 그 구간 [362069,363339)는 UI chunk가 아닌 main bundle `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`에 속한다. 구현이나 당시 검수 값은 바뀌지 않았다.

## Release

- Baseline: `8df079281743e92256df5d367633a841b007894c`.
- Tests: 234 distinct passing cases; type/lint 0 errors and 0 warnings.
- Native synthetic actual Chrome: 와이홉 A01464742 and 유앤채 A01526306, each 11/11 proof; actual PATCH once per company and reopening GET matched the saved values.
- Logs and native proof: ignored `outputs/step662-*`; screenshots `step662-seo-native-A01464742.png` / `step662-seo-native-A01526306.png`. These are synthetic local evidence, not production registration receipts.
- Build: passed. Worker version: `bbc475f2-40f5-4a11-b280-d6b497f7bb90`. No migration, subscription or extension update.
