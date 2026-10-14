# Step667 — URL 최초 SEO 작성과 견적서 상품명 연결

Step666 commit `507747cdf7bcdadd48e369a1fab1a4473b70edb9`에서 이어서, 카테고리와 URL을 지정한 뒤 최초 SEO를 적용하는 경로도 쿠플러스의 같은 문서 작성 규칙에 연결했다. 기존 운영 상품과 쿠플러스 작업 상품은 수정하지 않았다.

## 확인한 원본 호출

보존된 쿠플러스 UI의 `createProductObject` [436576,441156)는 정상 입력에 대해 `initializeCoupangDoc`으로 옵션별 문서를 준비하고, `/api/rocketReg/saveItems` 결과의 첫 상품 또는 준비한 상품을 `runInitialProcessing`에 전달한다. `runInitialProcessing` [441157,442908)는 현재 상품을 다시 읽어 module66e4의 `executeSingleTask(...,"seo",...,false)`를 호출한다. main의 이 함수 [308020,310070)는 module27c2의 `process` [216283,217373)를 사용한다. 기존 writer [184152,186443)는 기존 문서의 `startPage.productName`에 생성된 기본 상품명을 기록한다.

범위는 원본 manifest의 UTF-16 index다. UI SHA256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`, main SHA256 `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`. ignored `outputs/step667-intake-seo-audit/source-manifest.json`에 대응 UTF-8 범위와 재사용 근거를 보관했다. 새 REA routing 근거는 parent `ev_ac226470ee37b350778dd9cdc96642263193ceaa2d239b448d0761bb328ef9ed`, summary `ev_4f4a33003a509b8895eeeca723b9dd421eace8afe03149d8e0b3b5e18ef39cf4`다. parse failure 0, semantic unknown 164이며 정적 분석에서 서버 저장 성공을 추론하지 않았다.

일괄 작업의 `processProduct` [303515,306292)도 선택한 SEO와 가격 작업을 같은 실행기에 순서대로 전달한다. 완료 SEO 또는 disabled SEO를 건너뛰는 분기가 있고, 명시 SEO 선택은 포함한다. collect-only는 최초 SEO를 실행하지 않는다. 문서 초기화에는 누락 입력·오류 시 빈 값·부분 결과 분기가 있으므로 모든 상황에 문서가 생성된다고 주장하지 않는다. 문서가 없거나 기존 증빙이 유효하지 않은 legacy의 옵션명 fallback은 유지한다.

## 실제 변경

`translation-apply`의 `seoComposition || canonicalIntake` 조건에서 기존 `applySeoDocumentTitlePolicy`를 사용한다. 기존 owner·승인 회사·연결 카테고리·현재 원문·수집 context·effective receipt·exact initial job 검사를 통과한 최초 적용에만 확장했다. 미리보기 반환, fingerprint 대조와 무변경 검사를 마친 뒤 실제 title 또는 keywords patch가 있어야 증빙이 생긴다.

상품명·검색태그의 기존 보호, 직접 입력한 제목과 공란, 공통/옵션/카테고리 범위의 견적 override, CAS와 원자 저장은 유지한다. 검색태그만 바뀌면 보호된 현재 제목과 clock을 사용한다. 설명 전용·옵션 전용·일반 번역·미리보기·무변경은 새 정책을 만들지 않는다. 새 API 인자·DB schema·provider 요청·이미지 작업을 추가하지 않았다. 최초 collect-only 자체는 SEO 요청 0이며 나중의 명시적인 검토 적용은 기존 허용 범위다.

## 카테고리 조회

현재 연결된 쿠플러스 조회 도구의 계정은 유앤채 A01526306이었다. 읽기 전용 `rocket_sourcing_searchCategory`에서 '무릎보호대' 3개, '보호대' 23개를 조회했다. `81452 헬스보호대`, leaf=true, 경로 `스포츠/레져>헬스/요가>헬스기구/용품>헬스보호대`를 확인했다. 같은 단어의 임산부·유아 카테고리가 따로 있어 이름만으로 첫 결과를 선택하지 않았다.

이는 실제 코드·경로 조회 근거다. 와이홉의 연결 도구 계정, 해당 1688 상품의 전체 SKU와 최종 분류, 공식 Excel의 모든 항목·기본값까지 확인한 결과가 아니다. 이 조회로 화면을 열거나 기존 상품을 수정하지 않았다. 작은 조회 근거는 ignored `outputs/step667-category-live-proof.json`에 보관했다.

## 검증과 배포

기존 Chrome3의 사용자 쿠플러스 탭에서 현재 계정 표시 `yooandchae`와 기본설정 패널을 읽었다. 개인 저장값은 브랜드 유앤채, 제조사 유앤채 협력업체, 수입/판매원 유앤채, SKU50이었다. 가격 화면은 일반환율350, 공급마진50%, 쿠팡40%, nearest10, MSRP1.3, 최소마진3000, 번들off였다. 통합통관 사용은 on이며 당시 화면 환율290원과 `(위안가 × 환율 + 200 + 100) × 1.1` 설명을 확인했다. 환율290은 당시 계정 화면값이며 전 계정의 고정 기본값으로 배포하지 않았다.

상단 이미지·이미지 번역·카피라이트·누끼 on, 하단 이미지·비노출속성 자동생성 off를 읽었다. 설정 저장·값 수정·작업 상품 수정은 하지 않고 패널을 닫았다. DOM 근거는 ignored `outputs/step667-couplus-basic-settings-dom.txt`에 보관했다. Screenshot API는 5초 timeout으로 PNG 저장에 실패했다. 이를 이미지 보관 성공이나 실제 앱 설정 동기화로 주장하지 않는다. 알려진 `/api/getExchangeRate`의 비공개 공급 방식 차이는 그대로이며 산식과 별개의 미완료 항목이다.

최종 12파일 **203/203 통과**, 실패·취소·skip 0. 신규 최초 문서 연결 34개에는 두 회사의 카테고리/URL→최초 SEO→견적서 재조회, 수동 제목/공란, keyword-only, late replay, source/company 변경, 상품·콘텐츠·옵션 CAS 거절이 포함된다. 기존 canonical 최초 기대값 네 곳만 기본 상품명으로 바꿨다. 이후 독립적인 content PATCH와 Excel의 기존 옵션명 fallback 기대값은 유지했다. worker의 120개는 최종 203개에 포함되므로 중복 합산하지 않는다.

독립 읽기 검토에서 actionable 회귀 없음. 전체 타입 exit0, 변경 5파일 lint exit0, bounded 운영 build exit0. 기존 vinext route classification 경고는 유지된다. 로그는 ignored `outputs/step667-final-tests.log`, `step667-types.log`, `step667-owned-lint.log`, `step667-build.log`, `step667-deploy.log`.

실제 기존 Chrome3의 로컬 화면에서도 `collectIntakeProduct`를 실행했다. 회사별 collect→result→product import→canonical translation prepare/approve/execute→preview/apply→콘텐츠·옵션·견적 조회가 실제 API와 분리된 임시 SQLite를 통과했다. 양사 저장본 재조회와 와이홉→유앤채→와이홉 전환 후 원래 회사 제목도 확인했다. 실제 Chrome HTTP trace는 총33요청/16POST였다. API 조건64개와 DOM 값 조건16개 모두 통과했다. 선행 Node 사전 검수는 이 브라우저 결과에 중복 합산하지 않는다.

이 자료는 안정된 합성 카테고리991234, 서랍 수납함/흰색 한 옵션/CNY5.5를 사용했다. 81452의 실제 무릎 상품·전체 SKU·이미지·공식 양식 검수와는 구분한다. Google 응답은 회사별 mock2회, 실제 외부 제공자·1688·Hub·운영DB·업로드 요청0이었다. 수동 공통 제목·옵션 공란, 원문 receipt/context·설정·가격·원가·이미지와 원래 helper seed 행이 보존됐다. 실제 두 회원 로그인 검수는 아니다.

회사별 `outputs/step667-native-{회사코드}-proof.json`, `step667-native-{waihop,uenchae}-dom.txt`, `-dom-values.json`, `step667-native-trace.json`, `step667-native-proof-report.json`에 근거를 보관했다. 앱 source hash는 빌드 후에도 동일했다. Couplus 기본설정과 로컬 결과 screenshot 각1회가 timeout되어 이번 PNG 성공 파일은 없다. 실제 DOM/API 근거를 대신 기록했으며 이전 단계 PNG를 이번 화면으로 제시하지 않는다. 자체 임시 서버·검수 탭을 닫았고 사용자 Couplus·Hub 탭은 유지했다.

기존 무료 Worker 배포 exit0, 최종 Version `a0f31027-8ae1-4e11-a647-7ccff0cee607`, 주소 `https://sourceflow.jjwwhhjj1116.workers.dev/`. 새 자원·migration·권한 변경·확장 업데이트는 없다.

## 남은 전체 검수

Step660에서 확인한 D1 Free 일일 조회 한도 초과의 reset은 2026-10-15 09:00 KST다. reset 전 운영 상품 읽기를 반복하거나 다른 DB·관리 API·유료 플랜으로 우회하지 않았다. prepared extension0.2.72/마지막 확인 installed0.2.64 유지. `SINGLE_DOCUMENT_LIVE_VERIFIED`와 운영 mutation gate는 false다.

실제 새 1688 URL 전체 SKU·이미지, 모든 카테고리의 공식 양식·기본값, 남은 단계 UI 기능, Hub 동의·최종 등록·receipt/SKU 대조는 완료되지 않았다. 과거 거절된 URL을 REA·CLI·확장·API·다른 브라우저로 우회하지 않았다. 이번 검증을 전체 동일구현 또는 최종 접수 완료로 보고하지 않는다.
