# Step727 — 현재 쿠플러스 1~7단계 저장 연결과 전체 작업 재개 차이

2026-10-19 KST. 사용자 지정 대상은 `https://www.couplus.co.kr/AIRocketReg`의 로켓배송 AI상품등록이다. REA 두 skill과 JavaScript artifact guide를 읽고, Step725에서 실제 로그인 화면의 DOM 주소로 확보한 현재 main/route bytes와 기존 REA Evidence를 재사용했다. 이번 담당은 원본·1688·Hub에 요청하거나 vendor 코드를 실행하지 않았다. 기존 작업 상품·기본설정·운영 자료도 열거나 변경하지 않았다. 앱/테스트는 다른 담당의 동결 범위이므로 수정하지 않았다.

## 바로 연결할 구현 차이 한 건

**자체 전체 작업 재개에 미완료 SEO 생성·재시도 경계가 없다.** 원본 현재 main의 `processProduct`는 completed/disabled를 제외한 작업을 고르고, 남은 `seo → pricing`을 먼저 실행한다. 이미지·표시사항·조건부 사이즈표를 처리한 뒤 견적을 실행하며, 그 직전 미완료 작업을 한 번 재시도하는 분기도 있다. 이 계약은 원본을 실행해서 재현한 결과가 아니라 아래 digest로 고정한 shipped source의 직접 관찰이다.

반면 현재 자체 `BatchWorkPanel.run → runBatchProduct`는 최신 상품 GET, `work-draft` POST, `automation` POST를 호출한 다음 이미지 작업 화면으로 간다. automation API의 `executeLocalAutomation`은 `stage.id !== 'pricing'`이면 실행하지 않는다. 이 경로에는 번역 생성 호출이 없으며, 별도 `BatchTranslationPanel`도 완료 번역을 조회·적용하는 화면이다. 따라서 **최초 SEO가 실패했거나 적용되지 않은 상품에서 전체 작업을 재개하는 경우**에 해당 단계가 복구되지 않은 채 이미지 초안으로 넘어가는 코드 경계가 있다. 실제 특정 사용자 상품에서 재현한 운영 오류라고 확대하지 않는다.

`collectIntakeProduct`는 원문 반영 후 이미 `prepareIntakeSeoOutcome`를 호출한다. 상품별 SEO 화면에도 실제 생성 기능이 있다. 이 발견은 “SEO 기능이 없다”거나 “URL 초안을 처음부터 다시 만들어야 한다”는 결론이 아니다. 이 누락은 Step726의 포함 옵션 전체 문서 검토와 별개다.

후속 구현은 선택 상품의 현재 owner/company, productVersion, content/options revision, 저장 원문·카테고리·특징·키워드와 SEO 이력을 확인한 뒤 **미완료 SEO만 명시적 무료 생성·검토에 연결**하는 것으로 좁힌다. 이미 저장한 제목·옵션명·검색어·수동 공란과 완료 결과는 그대로 보존해야 한다. `prepareIntakeSeoOutcome`를 무조건 재호출하는 것은 해결이 아니다. 그 helper는 기존 canonical Google terminal failure를 그대로 반환하는 보호 분기가 있어, 실패 보존을 새 재시도로 오해하면 안 된다. 새 요청의 draft 저장/검토 필요/명시 실패/불명확 ACK를 구분하고, 계정·원문·revision이 바뀐 결과는 적용하지 않아야 한다. 429/실패를 자동 반복하거나 유료 요청 승인·전송을 새로 열 필요는 없다.

## 단계별 원본 저장 연결

현재 route의 `goToStep`은 SEO·가격·대표·추가·상세·사이즈표·한글표시사항·견적, 총 8개 작업명을 순서대로 사용한다. schema상 사이즈표가 필요 없으면 `filteredSteps`와 `filteredStepsTitles`가 해당 항목을 제거해 화면은 7단계다. 사이즈표를 무조건 넣거나 삭제해 단계 번호를 고정하는 계약이 아니다. `nextStep`/`prevStep`는 이동이며 전체 저장/등록 동작을 대신하지 않는다.

| 표시 작업 | 선택한 현재 원본 메서드에서 직접 확인한 저장 경계 |
| --- | --- |
| SEO | `saveSeoData`는 상품명·150자 이하로 정리한 태그·optionNumber별 한국어 옵션명을 구성하고 SEO 전용 `updateProductWithCoupangDocPartial`을 기다린다. 메서드 호출만으로 private backend의 저장 원자성까지 입증하지 않는다. |
| 가격 | `savePricing`은 옵션 배열과 같은 순서의 `coupangDoc.jsonDocument`, SEO 옵션, pricing 옵션을 함께 부분 갱신한다. 견적 `purchasePrice`에는 **공급가**를 넣고, `coupangSalePrice`에는 판매가를 넣는다. 원가 CNY를 견적 공급가 칸으로 복사하는 구조가 아니다. MSRP/OSRP 선택은 schema 조건에 따른다. 새 번들 옵션은 표시사항을 무효화하는 분기가 있다. |
| 대표이미지 | `updateProcessedImage`는 선택 옵션을 요구하고, `updateOptionImage` 후 대표이미지 전용 부분 문서 helper를 호출한다. URL/Data URL 분기는 있지만 helper 경고 후 성공 결과가 나올 수 있으므로 이 성공 boolean을 실제 영속 이미지 증거로 그대로 복제하지 않는다. |
| 추가이미지 | `saveAdditionalImages`와 `updateAdditionalImagesInCoupangDoc`는 `textRemoved === true`인 처리 목록을 전용 문서 helper에 넘긴다. 원문 후보 목록 전체를 완료된 추가이미지로 승격하는 근거가 아니다. |
| 상세이미지 | `saveDetailPage`는 편집한 그룹·순서·사용 중인 상/하단 배너로 800px HTML을 구성하고 통합 이미지 생성 후 `imagePage.details.detailedImage`에 연결한다. base64 업로드·이미지 합성 실패 시 URL 목록 fallback도 있다. 이 fallback을 본 앱의 성공 이미지 proof로 대신하지 않는다. |
| 한글표시사항 | `saveManualLabels`는 입력값으로 새 라벨 이미지를 생성·업로드한 뒤 상품·옵션 값과 전체 문서의 `labelImages`를 부분 갱신한다. 지정 labelImageType의 파일 필드를 사용한다. 입력폼만 저장한 상태와 실제 PNG 연결은 다르다. |
| 견적서 | 선택 옵션의 field path를 pending에 보관하고, 저장 시 선택적으로 전체 옵션에 확장한 뒤 schema 검증한다. `savePendingChanges`는 검증에 따라 completed/partially_completed를 기록하며, 성공 뒤 다시 초기화한다. 저장 버튼은 blur 후 pending 저장을 기다린다. 필수값 공란을 임의 기본값으로 채운다는 계약은 아니다. |
| 조건부 사이즈표 | `saveManualSizeChart`는 sizeType/sizeUnits/sizes/measurements와 이미지·옵션 상태·문서 image 필드를 갱신한다. 기존 sizeChartImage가 있으면 새 이미지 생성을 생략하는 원본 분기를 실제 내용 최신성의 증거로 사용하지 않는다. |

초기 URL 저장 직후의 기본 호출은 여전히 SEO와 가격 두 작업이다. 이미지 원본과 기본 견적 골격이 있다는 것, 단계의 처리가 끝났다는 것, 사용자가 수정·저장했다는 것, 실제 Hub가 접수했다는 것은 각각 구분한다. 원본의 전체 작업 재시도 순서는 재구성 근거로 삼되, 약한 catch나 로컬 완료 badge를 접수 성공으로 모사하지 않는다.

## 기본설정과 가격 계약

기본설정 버튼은 새 URL이나 modal을 열지 않는다. 현재 route `toggleSettings`는 `showSettings` boolean만 반전한다. 같은 페이지에서 검색·상품표 앞의 `RocketSettingsPanel`에 v-model을 전달하고 내부 b-collapse가 펼쳐지는 구조다. 이 클릭 메서드에 네트워크나 기존 상품 변경, 비동기 선행 조건은 없다. 부모 담당의 같은 Chrome4 읽기 검수에서도 인라인 펼침을 확인했고 `outputs/step727-original-settings.ax.txt`와 PNG에 보관했다. 그 화면의 저장값을 두 회사의 공통 초기값으로 복사하지 않는다.

현재 main `calculatePricing`에서 총 원가를 C, 공급 마진율을 a, 쿠팡 마진율을 b, 반올림 단위를 U라고 하면 일반 초기 경로는 `S = round((C / (1-a))/U) × U`, `P = round((S / (1-b))/U) × U`다. 최소 공급마진 스위치가 켜지고 `S-C`가 최소액 M보다 작으면 `S = round((C+M)/U) × U`로 보정하고 판매가를 다시 계산한다. 별도 가격창 `recalculateOption`은 최소 보장이 켜진 경우 **곧바로 C+M**을 사용한다. 이 두 분기를 하나로 합치는 변경을 권하지 않는다. 일반 원가는 CNY 합계×환율이며 통합통관 모드는 별도의 고정 검수·바코드·부가세 처리를 거친다. 고정 목표 판매가 소싱은 또 다른 명시 분기다.

이 메서드들의 현재 bytes는 Step725에서 이미 이전 source와 raw 동일 또는 선언된 helper alias 변경만 확인했다. 이번에 가격을 새로 바꾸거나 과거 상품을 재계산하지 않았다. 자체 `pricing.ts`의 decimal/rational 계산을 실제 원본 모든 IEEE-754 경계와 실행 동등하다고 선언하지도 않는다.

## 등록전송과 확인되지 않은 범위

현재 `verifyProducts`/`processNextVerification`의 raw slice digest는 Step724에서 분석한 보관 source와 같다. 검토한 선택 상품/분할 그룹마다 전체 `jsonDocument` 배열을 한 VERIFY body로 보내며, 옵션마다 native create를 반복하는 구조가 아니다. 설치 확장 Evidence `ev_17ed0cebd00b285e0bc489221547e437d2b3f69d9b636a813eb942a0a2a3a49a`와 summary `ev_05abd95724353b22c4ca14685b3e8dbe88bc4f0cee756eea76a4dd6873b7f42c`의 범위는 기존 [Step724 문서](step724-original-option-document-contract.md)를 그대로 재사용한다. 실제 native 다중 옵션 수용·최종 동의·접수 ID·옵션별 SKU join을 관측했다는 뜻은 아니다.

REA로 공개 클라이언트를 분석한 사실은 쿠플러스의 private 원문 공급자·키·캐시·모델·서버 비용·1688 실제 응답을 확보했다는 뜻이 아니다. 기존 작업 상품을 사용하지 않았으므로 실제 접수 검증도 이 담당의 완료 범위가 아니다. 해당 운영 gate를 해제하는 근거는 만들지 않았다.

## Evidence, digest와 재현 자료

- 현재 main: `outputs/step725-current-ui/main.a878a60f.js`, SHA-256 `36a8e3252cba8096da3e9b06eaf3c338699dce35280a0080484a5c7181d20fb7`.
- 현재 route: `outputs/step725-current-ui/chunk-36123f1a.155d5b9e.js`, SHA-256 `2fb15d370c331f65d982a886f2888b813ccae67277e87f806182c70032821664`.
- 전체 작업 기존 REA parent: `ev_ac226470ee37b350778dd9cdc96642263193ceaa2d239b448d0761bb328ef9ed`. 현재 MCP retained ledger는 0건이었다. 같은 producer를 다시 실행하지 않고 기존 `outputs/step667-intake-seo-audit/rea-evidence-bundle.json`을 설치 REA CLI `inspect-evidence-bundle`로 조회해 8 records 중 정확한 parent 1건을 확인했다. parent subject SHA는 `630f944f3e689a1fc2d534ccbffc57523bd09d68a41c7824b7838e1ede96a42b`다. 이 parent를 현재 main 전체의 새 분석 ID라고 부르지 않는다.
- `outputs/step727-rea-stage-contract-original.json`: 현재 두 source의 선택 **33개 메서드** UTF-16 half-open/UTF-8 byte 범위·raw slice SHA·작업 관련 메서드 identity 목록. 원본 파일은 inert source로만 파싱했다.
- `outputs/step727-rea-stage-contract-rea-summary.json`: portable parent의 REA summary. `step727-rea-stage-contract-proof.json`에는 bundle 전체 digest, source/자체 8파일 digest, 관찰/추론/unknown·실행 수가 있다.
- `outputs/step727-rea-stage-contract-extract.mjs`와 `step727-rea-stage-contract-proof.mjs`: exact source bytes·선택 slice·현재 자체 call boundary와 이전 parent를 재검증한다. 앱 테스트 통과 수로 집계하는 파일이 아니다.

| 핵심 current source 메서드 | UTF-16 범위, 끝 제외 | raw SHA-256 |
| --- | --- | --- |
| main processProduct | `[304992,307769)` | `d5985483829bd03f0f64235c06341f017506729a22a7edf6d3ffd6b0907116ac` |
| main executeSingleTask | `[309497,311547)` | `4cb687b04e43b0c8529b726996f0e8bff904cc60f611541efdf33489f709a49e` |
| route saveSeoData | `[199514,201506)` | `1c98c75b1737c5e08d5760512962b9f11ff05378fbc456ccaf06537882390831` |
| route savePricing | `[180480,184602)` | `da54aa8a394c3860bb6707595658baa49d613ec5386c831830ecf0f6a5ab5ab6` |
| route savePendingChanges | `[260778,263303)` | `e4cc5af3cdfa99d669132b0805f0e2259ad11e88ecf3bf037dae1678ce9d7c2f` |
| route toggleSettings | `[352684,352738)` | `b73b3c16d0d08638ddfbdfa33044d92f6089a7cb26c69db7daf0b551cb76b741` |

이번 담당의 새 REA producer·vendor 실행·브라우저·네트워크·운영 read/write·기존 상품 변경은 모두 0이다. portable CLI summary 1건과 정적 추출/검증을 수행했으며 열린 native/runtime/browser 세션은 없다.
