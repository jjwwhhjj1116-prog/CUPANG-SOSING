# Step707 — 사이즈표 수동 편집 계약과 남은 차이

2026-10-18 KST. 비교 기준 `4cd1a2dafc42633636192629e052cdb06b828e71`. REA 지침을 적용해 보관된 Couplus shipped JavaScript를 정적으로 읽었다. 기존 Step582/583의 미사용 진입 관찰, Step622의 진입 동작, Step636의 견적 연결, Step694의 Single 한 장 준비 수정을 재사용했다. 이미 고친 이미지 wire 연결을 새 결함으로 보고하지 않았다. 원본 앱 코드 실행, 브라우저, 네트워크, 운영 상품 수정은 모두 0이다.

## 확인된 새 차이

**Couplus 사이즈표는 행·열·문자열을 직접 편집하는 별도의 표다.** 기존 YOOFAM PLUS의 `documentImagePlan('size')`는 옵션의 포장 가로·세로·높이·무게·구성수량을 고정 6열로 이미지화한다. `ProductContent`에는 해당 수동 측정표 구조가 없었다. 따라서 단일 이미지의 견적 전송은 연결돼 있어도 의류의 총장·어깨너비와 같은 임의 측정행을 원본처럼 작성할 수 없었다. 이는 live 미검증을 결함으로 부르는 것이 아니라 저장 모델과 편집 기능의 확인 가능한 차이다.

다음 계약을 별도 수동 표로 구현할 수 있다. 기존 옵션의 실제 포장치수·가격·견적 값은 그대로 보존하고, 사용자 저장 표가 있을 때 그 표로 사이즈 PNG를 만든다. 이 문서는 구현 전 대조이며, 후속 구현·검사 결과를 대신하지 않는다.

| 원본 항목 | 정적으로 확인된 동작 |
| --- | --- |
| 자료 구조 | `sizeType`, `sizeUnits`, `sizes: string[]`, `measurements: {name, values: string[]}[]` |
| 사이즈 유형 | 자유 텍스트. 입력 예시는 일반 사이즈·의류 사이즈이며 enum 제한이 아니다. |
| 단위 | 선택값 `cm`, `mm`, `inch`, `㎡`. 입력값 자체에 숫자 강제 변환·단위 환산은 없다. |
| 사이즈 목록 | 쉼표로 나누고 각 값을 trim한 뒤 빈 값을 제외한다. `sizes`는 표의 열이다. |
| 측정 항목 | 이름 자유 입력, 항목 추가·삭제. `measurements`는 표의 행이며 각 사이즈별 값도 문자열 입력이다. |
| 열 수 변경 | 열을 늘리면 각 행에 `''`를 추가하고 줄이면 뒤쪽 값을 잘라낸다. |
| 수동 저장 | 이름이 있는 행만 저장하고 값 배열을 현재 열 수까지 slice한다. 별도 숫자 유효성 검사는 이 메서드에서 보이지 않는다. |
| 미리보기 | 첫 열 `측정 부위`, 뒤 열은 각 사이즈명. 빈 화면 셀은 `-`로 표시한다. |
| 결과 화면 | 저장한 이미지, 이미지 다운로드, 재작성, 다음 단계 버튼. 다운로드명은 `size_chart.png`. |
| 재작성 | 확인창 후 선택 상품의 `sizeChartImage`를 로컬 선택 상태에서 null로 바꾼다. 이 메서드 자체는 영구 저장을 하지 않는다. |

원본 `setupDefaultSizeChart`에는 카테고리명으로 의류·신발·가구·일반을 나눠 `60/65/70/75` 같은 예시 수치를 넣는 코드가 있다. **해당 값은 소싱 상품에서 측정한 값이 아니다.** 자체 신규 표는 항목 예시를 안내할 수 있지만 확인되지 않은 수치를 실상품 사양으로 저장·전송하지 않아야 한다. 자체 행·열·문자 수 제한을 추가한다면 운영상 제한이라고 명시하며 원본의 제한으로 주장하지 않는다.

## 사용/미사용과 저장 이미지

원본은 사용자 `enabled` 토글로 필요 여부를 정하지 않는다. `rocketRegInfo.schemaString`의 정확한 `properties.imagePage.properties.images.required` 배열에 `sizeChartImage`가 있는지 확인한다. 필요한 경우에만 wizard의 사이즈표 단계를 포함하고, 그 외에는 `disabled`/미사용으로 보인다. 해당 schema 파싱 실패도 false다. 모든 카테고리에 무조건 사이즈표가 필요하다고 추정할 수 없다.

`saveManualSizeChart`는 표 구조를 저장하고 `sizeChartStatus='completed'`, 모든 옵션의 동일 상태, 각 기존 옵션 문서의 `imagePage.images.sizeChartImage`를 단일 URL로 갱신한다. 이 저장 경로에서 상세 HTML이나 상세 이미지 배열에 표를 자동 삽입하는 대입은 없다. Step636/694의 자체 exact size wire 및 Single 단일 자산 준비 경로를 재사용하면 된다. 이 bounded 경로 밖의 전체 서버 처리나 타 기능의 상세 합성까지 부재를 증명한 것은 아니다.

원본은 기존 `selectedProduct.sizeChartImage`가 있으면 그 URL을 재사용하고, 없을 때만 새 표 PNG를 생성·업로드한다. 따라서 변경된 표가 기존 이미지와 일치한다고 이 코드만으로 보장할 수 없다. 자체는 변경한 저장 표의 지문으로 새 PNG를 만들고 최신 저장 revision에 묶어야 한다. 기존 파일 바이트나 기존 상품을 직접 덮어쓰는 방식으로 이 약점을 복제할 필요는 없다.

## 래스터와 AI/번역의 경계

원본 `generateSizeChartHtml`은 600px 컨테이너, 제목 `사이즈 정보`, 표의 첫 열 `측정 부위`, 사이즈별 열, 측정 행을 구성한다. footer는 `※ 상품 측정 방법에 따라 약간의 오차가 있을 수 있습니다.`다. 원본 `generateSizeChartImage`는 그 HTML을 html2canvas scale 2로 PNG화한다. 이는 픽셀 결과를 실제로 관찰한 기록이 아니다.

원본 HTML은 행에 별도 `unit` 속성이 있으면 이름 뒤에 붙이지만, 위 수동 저장의 top-level `sizeUnits`는 해당 renderer에서 사용되지 않는다. 자체에서는 저장한 단위를 사용자에게 분명히 보여주되 표의 수치 자체를 임의 환산하지 않는 것이 적절하다. 원본이 raw text를 HTML 문자열에 직접 결합하는 점도 자체에서 복제할 필요가 없다.

원본 AI 버튼은 `startSizeChartProcessing` → `c715.process` → `requestSizeChartData`로 이어진다. 후자는 `originDetailImages`를 우선하고 없으면 `detailImages`에서 최대 30장의 URL을 선택한다. 확장으로 `workType:'SIZE_CHART'`, `productId`, `requestArr:[{images}]`, `productInfo:{productName,categoryPath,options}`를 보내며 60초 timeout과 2회 재시도 설정이 있다. 응답의 `hasSizeChart`, `sizeChart`, 선택적 sourceImage/detectedArea를 받아 표 PNG·단일 wire를 저장한다. 이미지가 없거나 못 찾는 경우 `createPracticalSizeChart`의 `상세페이지 참조` 기본 표를 완료 처리하는 코드도 있다.

이 화면에 독립적인 사이즈표 텍스트 번역 버튼은 보이지 않는다. 이미지에서 원문 측정표를 찾아 한국어 항목으로 변환하는 실제 공급자, 모델 프롬프트, 정확도, 원본 단위 처리·실패 응답은 이 선택 자료만으로 확정되지 않는다. **수동 측정표 저장 기능을 고쳐도 원본 AI 검출·번역의 동일성이 완료되는 것은 아니다.** 사용자 확인 없는 기본 표 완료 토스트도 실제 접수나 실측 완료 근거가 아니다.

## 근거와 재사용 범위

새 REA parent **`ev_944840a429dc0a462f1348cc02d0b41601a53c440a2cd6b0d5c1c8a9a0bf4ab3`**, summary **`ev_c2d67d32d66e068e211b186f29d9d1a8b167994df7527dffe6c26db46d1868f8`**. 신규 질문에 해당하는 14개 inert selection, 17,564 UTF-8 bytes, 14 parsed/0 parse failures/3,453 AST nodes. 선택 집합의 inventory는 complete이며 semantic coverage는 unknown, conservative unknown 681개다. 원본 lexical helper·Vue/DOM/확장 호출은 실행하거나 해소하지 않았다. 선택 집합 SHA-256은 `eb7205c7257002aa2ba8f4e4829a6e8129571fc9a5d6c88707d8282f5518b257`이다.

원본 artifact SHA-256:

- `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`: `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`
- `outputs/step652-current-couplus/main.a20c7114.js`: `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`

아래 범위는 끝을 제외한 UTF-16 code units이며 slice SHA는 UTF-8로 인코딩한 exact 원문이다. 전체 14개 및 이전 저장/upload 2개의 검증된 지문은 `outputs/step707-analysis-source-manifest.json`에 있다.

| 항목 | 원본 범위 | slice SHA-256 |
| --- | --- | --- |
| SizeChartEdit render | chunk `[276364,281806)` | `0c603f72f9cffb97c97f438d246201b769e2eab80b2b1f59ae76a285e47072ab` |
| sizes 계산 | chunk `[282501,282576)` | `30e7c94c7cd19df2a565573b4b75c6e97dfe18160f8bdc46db5177e2e87672c5` |
| 열 수 변경 watcher | chunk `[283211,283369)` | `d068b44de51fcebcccc8402932c220f04e778afe1c3337c644cb5ef9b1d9baeb` |
| 기존 표 초기화 | chunk `[283546,283941)` | `b1670a8d6db5a61c01434ff17ae62ecb401efe36b7228f7fea0508022d90083a` |
| 카테고리 샘플 표 | chunk `[283942,285120)` | `3cbdbc78ff2f1f9a73b61667dbf85f9480d41b522030d9f9f5a52e19b963ea8c` |
| 측정행 추가 | chunk `[285121,285226)` | `48ffb41ac1bb3eae8fa1df81fb365cc02be5b8c7b1d11b3d95c9bae8e4931470` |
| 측정행 삭제 | chunk `[285227,285278)` | `000b732ad7c71fabbc720b3c5b976e86674cae82c568daa1b7f384bf4c12cf6a` |
| 수동 저장 — 이전 분석 재사용 | chunk `[285279,286603)` | `94fbd7139b9b9a5f143258b71b87befe587357c22686bb45e1fe98ec28b0d243` |
| 재작성 | chunk `[287160,287326)` | `f80866b73804e22d74ee539b98774e4db04e1ac8a18b8984983f8527636fd176` |
| required 판정 | chunk `[289105,289588)` | `05a1f793e7c424ec7bf815d54b8e086e94ee063d2253a410677bd678c46f59a0` |
| 표 HTML | main `[445534,446789)` | `e22f81e4bb88d31baf2487047512bdfa9a9dd6473676e11575f902acb4da550f` |
| AI 원본 이미지 선택 | main `[448523,451513)` | `86b57aa4c73cf081dc32c9e87f7d83eb96b5d19cb51c3b68047165db69f2e478` |

수동 save/upload는 이전 parent `ev_02780e2b058e642fc180a67b70caa803cccdc81f6dae0421b92e62c6c911e3a4`의 portable bundle와 exact selection 지문을 재사용했다. 현 MCP의 retained 레코드 검색에는 그 이전 ID가 없었으므로 전체 producer를 다시 돌리지 않았다. 보관 bundle에 원래 complete record가 있는 것을 확인했다. 새 선택의 canonical evidence는 `outputs/step707-analysis-rea-evidence-bundle.json`, 재현 추출기는 `outputs/step707-analysis-extract.mjs`다.

## 남은 검수

수동 표의 API·계정/회사 격리·최신 revision·미저장 입력 보호·PNG 재생성·한 장 교체·옵션별 직접 공란 우선·Single wire/첨부 연결은 실제 자체 테스트로 검증해야 한다. 별도 AI 이미지 측정표 검출·번역, 필요한 카테고리의 실제 UI, 최신 Supplier Hub 카테고리 전 범위, 새 실상품 수집부터 실제 Hub 접수/SKU 확인까지는 아직 미확인이다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`를 바꿀 근거가 없다. 이 분석은 native/runtime 세션을 열지 않았다.
