# Step708 — 사이즈표 이미지 추출·번역의 정적 계약

2026-10-18 KST. Step707의 수동 표와 별도로, 보관된 Couplus 페이지·설치 확장 10.92의 사이즈표 AI 경로를 조사했다. 실제 사이트·계정·브라우저·원본 코드·모델 실행·네트워크·상품 쓰기는 0이다. REA 스킬의 정적 근거·실행 관찰 구분을 유지했다. 앱 구현은 다른 담당자 소유이며 이 문서는 구현·실제 추출 성공을 증명하지 않는다.

## 먼저 구분할 연결 경계

**현재 보관 페이지의 기본 경로는 자체 서버 API다.** `66e4`의 `const b=!0` 때문에 `requestExtensionWithPromise`는 이름과 달리 `/api/ai/rocket/gemini`에 POST한다. `SIZE_CHART` 요청은 `images`를 `imageUrls`로 바꾸고 prompt가 없으면 일반 이미지 분석 문구를 넣는다. POST 본문은 `workType`, `task`, `requestArr`, `productId`이며, 호출부가 전달한 `productInfo`는 이 서버 분기의 본문에 포함하지 않는다. 60초 timeout·2회 재시도 설정이 호출부에 있고 로그인/권한 오류는 재시도하지 않는다. **서버 내부가 이미지 추출 프롬프트를 보강하는지, 사용하는 모델·공급자·검증이 무엇인지는 알 수 없다.**

설치 확장 `script.js`에는 별도 `AiRocketSizeChartRequest` → `SIZE_CHART_EXTRACTION` relay가 있다. 그러나 같은 설치본 `background.js`에는 그 receiver literal이 없고, import `extractSizeChartFromImages as h`의 lexical 참조도 0개다. 반면 일반 `AiRocketRegRequest` receiver가 `processAIRocketRequest as u`를 호출하는 참조는 1개다. 따라서 아래 전용 추출 함수는 복원에 도움이 되는 **정적 구현 자료**지만, 현재 페이지에서 실제 실행됐거나 현재 private 서버와 동일하다고 주장할 수 없다.

Step707 문서의 “확장으로 SIZE_CHART를 보낸다”는 문장은 서비스 호출의 명목상 계약에 관한 설명이다. 실제 보관 버전의 선택된 server 분기는 위와 같으며, helper 이름만으로 확장이 실제 추출을 담당한다고 결론내리면 안 된다.

## 전용 추출 함수에서 확인된 입력과 지침

설치본 `dist/gemini.bundle.js`의 export `extractSizeChartFromImages`는 함수 `ne`다. 입력은 `productId`, `images`, `productInfo`, `apiKey`와 선택적 `geminiModel`이다. 이미지 또는 API 키가 없으면 `hasSizeChart:false`와 오류 메시지를 반환한다. 모델 기본 문자열은 `gemini-2.0-flash`다. 원본 현재 모델 가용성이나 계정 과금은 조회하지 않았다.

프롬프트는 다음 행동을 요구한다.

- 원본 이미지에 치수표·규격표·스펙표가 있는지 구분한다.
- 사이즈별 열과 측정 항목별 행·값·단위를 추출한다.
- 중국어·영어 항목은 한국어로 번역하고 숫자는 정확히 유지한다.
- 신발 사이즈는 한국의 mm 기준으로, 중국 무게 단위 斤은 kg으로 변환하도록 요청한다.
- 표가 없으면 `hasSizeChart:false`를 반환하도록 한다.

이는 모델에 대한 **요청 지침**이며 올바른 환산이나 정확한 추출을 실제 보장하는 로직이 아니다. 이 함수에는 환산식을 실행하거나 원문 숫자와 결과 숫자를 대조하는 코드가 없다. 사용자 확인 전 단위 변환값을 실측 사실로 확정해서는 안 된다.

호출자 `c715.requestSizeChartData`의 이미지 선택은 Step707 근거를 재사용했다. `originDetailImages`가 있으면 그 목록의 앞 30개를 선택하고 각 `originalUrl || img || ''`를 사용한다. 없으면 `detailImages` 앞 30개에서 문자열 또는 `img || url || ''`를 쓴다. 현재 코드가 공란 URL을 제거하거나 모든 배열 값을 검증한다고 이 선택만으로 보장할 수는 없다. 전용 함수는 받은 배열 전체를 `Promise.all(images.map(imageToInlineData))`로 읽으며 별도 30장 제한을 다시 적용하지 않는다.

`imageToInlineData`는 URL을 fetch해 Blob→FileReader data URL→inlineData로 만든다. MIME은 Blob.type 또는 image/jpeg다. 이 helper에는 HTTP status·바이트 크기·이미지 해상도·외부 소유권·URL allowlist 검증이 보이지 않는다. 자체 구현은 기존 소유 이미지·실제 바이트·SHA·MIME 검증을 재사용하고 불필요한 원본 URL 재요청을 할 필요가 없다. 조사에서 URL을 실제 fetch하지 않았다.

## 응답 구조와 원본 parser의 한계

전용 함수의 기대 형태는 다음 구조다. 이는 실제 응답 예제가 아니라 코드에서 추출한 형식이다.

```text
hasSizeChart: boolean
sizeChart:
  sizeType
  sizeUnits?                       # parser는 읽지만 prompt 예시에는 없음
  sizes[]
  measurements[]:
    name
    unit?                          # cm, kg 등 행마다 서로 다를 수 있음
    values[]
```

`measurements.unit`는 원본 parser가 행 객체를 그대로 보존하므로 남는다. top-level `sizeUnits`만 있는 Step707 수동 표와 단위 의미가 같다고 가정할 수 없다. 혼합 단위를 하나의 단위로 덮어쓰거나 숫자를 자동 환산해서 저장하는 것은 이 계약을 따르는 구현이 아니다. 자체 수동 모델로 적용할 때는 행 단위를 보존한 검토 형태나 명시적인 행명 단위 표시가 필요하다.

원본 parser는 코드펜스 문자열을 제거하고 JSON.parse한다. `hasSizeChart`가 boolean이 아니면 false, false면 바로 false, sizeChart가 없으면 false다. sizeType이 truthy이고 sizes·measurements가 배열인지 확인한다. 측정행 중 name이 truthy이며 values 배열이 비어 있지 않은 행만 남긴다. 사이즈 또는 남은 행이 없으면 false다. 그 외에는 true와 표를 반환한다.

다음 검증은 이 parser에서 확인되지 않았다: sizeType/name/unit의 문자열 타입, 각 cell의 문자열/숫자 타입, 열·행 길이 일치, 중복 헤더, 유한 숫자·문자 제한, 배열 상한, 원문 이미지/상품 지문과 결과의 결속. 빈 표·잘못된 JSON·비정상 응답은 모두 `hasSizeChart:false`로 축약되므로 “표가 없음”과 “추출 실패”가 명확히 구분되지 않는다. outer catch는 false와 error를 반환한다. 자체는 이 약한 검증을 그대로 복제하지 말고 기존 자료·회사·카테고리·콘텐츠 revision·이미지 SHA에 묶은 검토 초안으로 제한해야 한다.

또한 원본은 모델 생성 시 `generation_config:{responseMimeType:'application/json',temperature:0.2}`를 넣는다. 하지만 **같은 번들의 SDK constructor는 camelCase `generationConfig`만 읽는다.** 따라서 이 snake_case 설정이 실제 요청에 적용됐다고 주장할 수 없다. SDK의 `generateContent`는 `this.generationConfig`를 전송하며 잘못 전달된 설정은 여기에 들어가지 않는다. 자체 공급자에는 실제 지원되는 필드로 구조화 응답을 요청해야 한다.

## 표를 못 찾은 이후의 동작

Step707 `c715` consumer는 `hasSizeChart:true`면 표를 PNG화·업로드하고 exact size wire에 저장한다. false 응답을 받고 모든 이미지가 끝나면 `createPracticalSizeChart`로 옵션명/상세페이지 참조 기본 표를 만들고 completed로 저장하는 코드가 있다. 이미지가 처음부터 없는 경우도 기본 표를 만든다. 이 기본 표가 소싱 이미지에서 읽은 실측치라고 볼 근거는 없다.

따라서 자체 미검출·실패 상태는 기존 수동 표나 활성 이미지를 변경하지 않고, 사용자가 표를 확인·수정·적용하도록 남기는 것이 적절하다. “원본에 표가 없다”, “공급자 실패”, “응답 검증 실패”를 구분하고 자동으로 완료·견적 첨부·Hub 전송하지 않는다. source 이미지에서 인식한 수치·단위·행/열은 editable 초안이며 사용자가 확인한 후 Step707의 저장·PNG·Single 한 장 경로로 연결할 수 있다. 이 재구성 권고는 원본 서버의 미공개 구현을 확인했다는 뜻이 아니다.

## Evidence·지문·범위

새 REA parent **`ev_ff6a1df2c61a65cb7ab07858d43f8114fc3f4ca6e4a11cc8632ae343782cd080`**, summary **`ev_b70137b52993e4acd5142fc70783f8656680e94d32a64f46c28c555c548f2f1d`**. 6개 새 inert selection, 7,391 bytes, 6 parsed/0 parse failures/1,183 AST nodes. 선택 inventory는 complete이고 semantic coverage는 unknown, unknown 310개다. 선택 root SHA-256은 `aa9b73368c7e27f5fdd3fdda00fa66a2eaefea72cad4ad09cc9a84a4ae21e90e`다. 별도 Babel lexical binding 점검은 코드 실행 없이 import binding 참조만 읽었다.

원본 설치본의 지문:

- background.js: `fb03e8a70bc684e8b08539d8eb507720170eca8cf6fa4cb74af549f13179ec99`
- script.js: `0547785f8b746c75dc509dc96c4cfb9c290aff941499aaeb9c3b1af33ce9edc1`
- dist/gemini.bundle.js: `fdf8ea108cd421401590ee38a8b979faa4076337ed8466635398a285f073b252`
- 보관 main.a20c7114.js: `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`

범위는 UTF-16 code units, 끝 제외이며 slice SHA는 UTF-8 exact 원문 기준이다.

| 항목 | 원본 범위 | slice SHA-256 |
| --- | --- | --- |
| content relay | script `[43181,43415)` | `1a4fb4425c0a934341d834e2f227233246855b18cb1042d780e5f0ef121d50c5` |
| SDK constructor | gemini `[14448,14794)` | `4480f0002f9c7627716e715f31a654a5c497c1b85cd9475e1640ff942773043c` |
| SDK generateContent | gemini `[14794,15184)` | `833215f3ca753553a1621cd96623642b9823be53369b4386efcef2efbdeb3375` |
| 일반 AI receiver helper | gemini `[45592,46621)` | `e05e8cb5e10ec3e960825a5bbf53245e212a24d148a0c89b309ea1e0327d6bd8` |
| 전용 표 추출·prompt·parser | gemini `[69012,72259)` | `bf8110ee57b7ff6ea9c22eacc6c53595ec8cefb48d282c871f8b5eb3496f6b47` |
| 이미지 inline helper | gemini `[94816,95194)` | `a964c66444047ad3d329129ab9216852067a67c9656e693595a4ad2babcd9ae6` |
| 서버모드 상수 | main `[302778,302782)` | `a88f08bcd34c3c81701389db15ff8e5a8596e1fc652bd1982aa0379c96c0d04a` |
| 공통 서버 분기 — 이전 선택 재사용 | main `[318074,320894)` | `4900856c2e23a1a49b0fae8f11a36506ecd591198554ecf9787e43a2bbd7c437` |

재현 추출기·manifest: `outputs/step708-analysis-extract.mjs`, `outputs/step708-analysis-source-manifest.json`. canonical REA bundle: `outputs/step708-analysis-rea-evidence-bundle.json`. 앞 30장 및 consumer 저장/기본표 근거는 Step707 parent `ev_944840a429dc0a462f1348cc02d0b41601a53c440a2cd6b0d5c1c8a9a0bf4ab3`와 그 exact source manifest를 재사용했다. 그 producer를 다시 실행하지 않았다.

현재 실행 중 확장 버전·프로필, 실제 서버 prompt/model·반환형태, 원본 이미지 읽기 성공·번역/환산 품질, 전체 카테고리와 실제 Supplier Hub 접수/SKU는 미확인이다. 새 runtime/native session은 열지 않았고 기존 작업 상품·운영 데이터·release gate는 변경하지 않았다.
