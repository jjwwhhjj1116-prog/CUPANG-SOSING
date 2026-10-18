# Step722 — 기본설정·상품추가에서 1단계 SEO까지의 재검토

2026-10-19 KST. 기준 `2ad230bd99830563f37968b3fa59aea9d073120c`. 이미 완료한 Step665·699·713·715~717·720의 메서드를 다시 전체 분석하지 않았다. 질문은 브랜드·상품 특징·키워드 입력과 수동 저장 이후의 연결에 **아직 남은 의미 있는 차이**가 있는지다. 이 조사자는 앱·테스트·계정 설정·기존 작업 상품을 변경하지 않았으며, 브라우저·네트워크·원본 함수 실행도 하지 않았다.

## 결론과 현재 설정값

이번 한정 범위에서 새로 확정한 기능 결함은 없다. 현재 자체 소스에는 참고 메모, 첫 브랜드 초기화, 공란 타겟의 새 요청 차단, 진행 중 두 편집 영역의 잠금, 상품명·검색태그·옵션명의 명시적 통합 저장 및 견적 문서 제목 연결이 있다. 이를 전체 기능 동일성이나 실제 신규 URL의 완료 증거로 확대하지 않는다. 새 결함을 찾지 못했다는 이유로 원본에 없는 검사 API나 자동 저장 기능을 만들 근거도 없다.

root가 같은 기존 Chrome에서 실제로 읽은 Couplus 계정은 `yooandchae / 유앤채`다. 현재 저장된 일반 환율은 **310**, 쿠팡 마진율은 **45%**이고, 자체 관리자 저장값은 **350**, **40%**다. 통합통관 환율290·사용 ON, 공급마진50%, 최소액3000·ON, 반올림10원, MSRP1.3, 번들 OFF는 같았다. 브랜드·제조사·수입판매원, 박스50, 상단 ON·하단 OFF, 이미지 번역·카피라이트·누끼 ON, 비노출속성 OFF도 같은 것으로 보고됐다. 이 비교는 **서로 다른 현재 저장 설정**이며 원본의 보편적 초기값이나 산식 오류의 증거가 아니다. 두 사이트 설정은 저장하거나 수정하지 않았다.

root의 실제 읽기 자료는 `outputs/step722-original-settings-ax.txt`와 `outputs/step722-own-settings-ax.txt`다. 이 조사자는 그 텍스트와 root의 관측 보고를 재사용했다. 원본 PNG 캡처는 시간 초과였으므로 화면 이미지가 보관됐다고 표현하지 않는다. 자체 `newWorkspaceSettings`의350/50/40/10 값은 과거 관측값을 바탕으로 한 신규 계정 preset이고, `defaultSettings`의190/40/35/100은 과거 저장 자료의 누락 필드 호환 규칙이다. 이미 저장된 사용자의 설정을 새 값으로 덮어쓰는 근거로 둘을 혼동하면 안 된다.

root는 실제 원본에서 상품 대기열→상품 추가→카테고리 선택을 열어16개 최상위 항목·단계별 하위 선택·검색 화면까지 읽은 뒤 취소했다. URL 제출이나 상품 생성은 하지 않았다. `outputs/step722-original-add-ax.txt`, `step722-original-category-ax.txt` 및 자체 `step722-own-add-ax.txt`에 보관됐다. 원본의 상품 추가/SEO+가격/작업 개시/등록 전송4개 목표와 자체3개 목표는 일치하지 않는다. 이는 실제 등록전송 검증이 false인 자체의 현재 안전 범위이며, 미검증된 실제 자동등록을 완료 기능처럼 추가해 그 차이를 숨길 수는 없다. 이 읽기가 하위 카테고리 전수·양식·기본값 전체의 동일성을 입증하는 것도 아니다. root의 검수용 탭은 닫혔고 기존 사용자 탭·상품은 변경하지 않았다.

## 원본 입력·저장과 자체 대응

| 항목 | 보관 원본에서 확인한 경계 | 현재 자체 대응 |
| --- | --- | --- |
| 브랜드 | `initializeData`는 `(defaultBrand || product.brand).split(',')[0]`; 최초 상품 생성·SEO prompt는 첫 구간 trim | `initialSeoGuidanceMemo`가 편집 재열기 첫 구간을 사용. linked 최초 적용 route는 captured 설정 브랜드의 첫 구간만 trim |
| 특징·타겟 | 현재 상품 값을 복원하고 blur 때 store를 갱신. 새 AI 요청은 타겟 trim이 비면 금지 | owner·product·원문 기준 memo, 확정한 공란 보존, 버튼과 handler의 새 요청 guard. 복구 GET은 새 요청 guard와 구분 |
| 작성 예시·요청 | 브랜드·특징·타겟 예시와 AI 생성. processing이면 두 편집 영역을 대체 | 실제 source-bound 생성/적용 중 양쪽 표시와 저장 잠금. raw 입력·요청은 unmount로 없애지 않음 |
| 상품명·태그·옵션명 | 제목100/태그150, 옵션 이미지·원문·한국어 이름, 명시적 저장 | `SeoWorkspaceEditor`가 제목·태그·옵션명 변경분을 함께 저장. raw 태그를 먼저 보여주고150자/정리된 저장안을 별도로 제시 |
| 후속 문서 | 기존 문서 저장 시 공통 SEO 제목, 문서 없는 converter fallback에 옵션 suffix | exact SEO 값·clock과 결합한 `couplus-seo-save-v1` 정책. 수동 문서 값·명시 공란·별도 옵션값 보존 |

자체 대응 근거는 `seo-workspace-generator.tsx`, `seo-guidance-session.ts`, `seo-workspace-editor.tsx`, `seo-workspace.ts`, `seo-title-document.ts`와 `api/products/[id]/translation-apply/route.ts`의 읽기다. 참고 메모가 확정됐다고 즉시 상품 원문·번역 결과·견적 문서·가격을 덮어쓰지 않는다. 수동 SEO 저장도 source·content·options clock을 검증하고 변경한 필드만 저장한다. 이 더 강한 보호가 원본의 private backend에서 같은 방식으로 구현됐다는 주장은 아니다.

## 확인한 표현 차이와 기각한 가설

원본 Stage1 renderer `[189560,195318)`에는 브랜드·특징·타겟, 상품명 예시, AI 생성, 제목/태그, 옵션명과 저장이 있다. 이 한정된 renderer와 연결 메서드에서 별도의 **상품명 검사 버튼·검사 API·SEO 점수 화면은 확인되지 않았다**. 서비스 metadata나 marketing 요약만으로 추가 기능이 필수라고 추정하지 않았다. 동적 component나 캡처하지 않은 private 경로 전체가 없다는 증거는 아니다.

원본 `getOptionImage`는 `mainImageStatus.image`를 우선하고 없으면 `option1.imageUrl`을 쓴다. `processedImage`를 먼저 써야 한다는 가설은 이 원문으로 뒷받침되지 않아 기각했다. 원본 원문 옵션 표시에는 option1/2의 이름과 번역을 괄호로 합치는 표현이 있다. 자체는 원문 label과 편집 가능한 한국어 이름을 분리한다. 이는 표현 차이이며 현재 확보한 자료로 옵션 데이터가 유실된 기능 결함이라 판정하지 않는다.

원본 `canSave`는 제목 trim의 비어 있음만 검사하지만 자체는 사용자가 직접 저장한 공란도 보존한다. 원본 태그 textarea가150자 제한인 것과 자체가 초과 입력 원문을 남기고 저장안을 제시하는 것도 기존 의도적 차이다. 이 조사에서 저장 보호를 약화하거나 기존 수동 공란을 다시 채우지 않았다.

실제 기본설정의 최소마진 안내 문장도 같지는 않다. 원본은 원가+최소액의 직접 산식을 안내하고, 자체는 비율로 구한 가격과 최소액 하한 중 큰 값을 설명한다. Step716에서 원본 **최초 worker의 비율+하한 계산**과 **Stage2 직접 저장의 최소액 모드**를 이미 구분했다. 안내 한 문장을 근거로 초기 작업자와 Stage2를 같은 산식으로 변경하거나 저장 설정을 재작성해서는 안 된다. 이 범위는 표현·scope의 차이로 남기며 새로운 계산 결함이라 하지 않는다.

## 근거의 정확한 범위

보관 UI chunk SHA-256은 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`, main SHA-256은 `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`다. UTF-16 start-inclusive/end-exclusive 범위와 UTF-8 slice SHA는 `outputs/step722-original-source-manifest.json`에 보관한다.

| 원본 경계 | 범위 | slice SHA-256 |
| --- | --- | --- |
| Stage1 renderer | `[189560,195318)` | `302eb4efc52b0b608eda30d28e69e03b3dfac23a888bea55068bb0afefda5134` |
| canSave | `[195936,195986)` | `34c8ad012b2427c98d1caf262d1561c8140b4c5514aa430d8438494d8b193b67` |
| canStartAiGeneration | `[195987,196046)` | `02819dd4c58ca01f770a48ebd6ef79330dc43f08adee6c2086770a52e368b5af` |
| initializeData | `[196149,196800)` | `76c4eb1205afcd804b61589dd149cbaf4cfcdc09e511b4e828a3aa23a807ec30` |
| startAiGeneration | `[197919,198564)` | `c6928aa8ff8ee8467e792c023fa9caeb748bca1f7aa27763cd6e00de81c0dcf8` |
| saveSeoData | `[198565,200557)` | `d64e11c06db33017e8e91d24023592dad3d3fd9e6f78fb6ebdd39ce3df75cc42` |

REA parent `ev_8e9a17009e057dc9e4c5a48432308c2edcfb8d712d5a3c552093e3fff505d021`를 현재 retained ledger에서 재사용했고 summary projection `ev_dac9f79ffbfcfd87fce83ee93d80aa26c79fad5574e27a702147d6f3685f1e3f`를 읽었다. 이 parent는 inert 선택4파일/5,058bytes, parse failure0이지만 semantic unknown281개다. 기존 module page `ev_e7c15edf09e2d9980bf1d74eaf5d46d2d93e0f9661a00f93f954a62d6a90fc2c`와 module item `ev_50b27f0d6fcbb167b59aa7ed9aa191fd3442991822f96d7fe954cc65ffcc3a01`도 유지한다. 새 original producer는 실행하지 않았다.

intake `ev_cd515dbbeab22000b72ee021eb669326d3fa3695cede4a815ccd90c6966e239a`, category `ev_031002beee6d4de040b6b091d765d7ecae06affbb798dec64f5d4c46af65ad05`, 초기 상태 `ev_4d3580bc08888e08a5c432ba8009d993800d8eb5935954ce2cb31c56502dab68`, 브랜드 `ev_cd5b12712ef6b71c2acfc13858957b76b067e15d1319aac6ac68b3c3a642258a`는 기존 결과의 범위를 그대로 인용했다. 이번 summary가 그 메서드를 새로 분석한 것으로 세지 않는다.

private1688 수집 provider·서버 cache·실행 속도·모델의 실제 SEO 결과, 모든 카테고리 양식, 신규 상품 수집·수정·Supplier Hub 접수와 receipt/SKU 대조는 이 읽기만으로 입증되지 않는다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`와 기존 상품 불변 조건을 유지한다. 이 조사에서 연 runtime/session은0이며 자동 테스트 실행도0이다.
