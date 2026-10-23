# Step805 — RS 상세 문서 수집의 정적 계약

2026-10-23 KST. 기준 HEAD `ffaebba`. 대상은 사용자가 지정한 RS 쿠팡 셀러 운영 도우미 확장 `jbfdblccnofegmdfhdceabhlmfbjepge`의 보관 버전 **1.0.88**이다. 질문은 수동 상품 수집에서 일반 속성·포장 정보·상세 이미지를 어떤 경로로 얻는가이다. 기존 Step747 분석을 재사용했으며 이 문서 외 소스·테스트·확장은 수정하지 않았다.

## 결론

RS 1.0.88의 수동 수집기는 SKU 내장 JSON과 DOM에서 옵션 이름·이미지·가격을 읽는다. **일반 상품 속성과 포장 중량을 수집·전송하는 필드는 없다.** 상세 이미지는 DOM 외에 페이지 script의 `detailUrl`을 추출하여 해당 문서의 text에서 이미지 URL을 찾는다. 수동 경로에서 별도 1688 상품조회 API나 CLI를 호출하는 계약은 확인되지 않았다.

이는 보관 산출물의 정적 동작이다. 현재 실제 1688 페이지에서 수집이 성공하거나 특정 상품의 상세 이미지가 존재한다는 실행 증거가 아니다. 사용자 화면의 속성 표·옵션별 10g가 이 RS 경로로 전달된다고 주장할 수 없다.

## 상세 문서의 정확한 계약

원문은 `outputs/step747-rs/extracted/content-1688.js`와 `background.js`다.

| 경계 | 원문 위치 | 확인한 계약 |
|---|---|---|
| 내장 텍스트 | content 484–485행 | `_embedText()`는 길이 300 초과이고 `skuModel\|offerImgList\|detailUrl\|mainImageList` literal을 포함하는 모든 `script.textContent`를 연결한다. `_unesc()`는 `\\u002f`·`\\/`와 나머지 backslash를 제거한다. 실제 global 객체를 읽지 않는다. |
| URL 추출 | content 493행 | `extractDetailUrl()`은 정확한 JSON 키 문자열 `"detailUrl"`의 첫 regex match를 선택한다. 전체 JSON을 parse하지 않는다. `//`이면 `https:`를 붙인다. |
| 문서 요청 | content 495–503행 | `{type:'ROS_FETCH',url:u}` 메시지 응답을 최대 15초 기다린다. text가 비면 content의 `fetch(u).text()`로 fallback한다. fallback 자체의 timeout은 이 함수에 없다. |
| background 응답 | background 1085–1090행 | `fetch(msg.url,{credentials:'omit'})` → `r.text()` → `{ok:true,text:t}`. HTTP status·content-type·최종 redirect URL 검사가 없다. 오류 시 `{ok:false,error}`다. |
| 이미지 추출 | content 501–503행 | 응답의 JSON·HTML 구조를 해석하지 않고 text 전체에서 absolute HTTP(S), `alicdn`, `.jpg/.jpeg/.png/.webp` URL을 regex로 추출한다. 일반 slash·escaped slash·unicode slash를 지원하고 중복을 제거한다. |
| DOM 합류 | content 506–522행 | `SEL_DESC`의 img, desc 영역의 CSS background, `fetchDescImages()` 결과를 합친다. main/sku와 겹치는 URL을 제외하고 상세 최대 80개를 다운로드·축소한다. |

`ensureDescLoaded()`는 456행에 존재하지만 위 `buildImagePool()` 경로에서 호출되지 않는다. 따라서 RS 상세 수집을 단순히 스크롤 후 DOM 이미지만 읽는 방식으로 설명하면 빠진 경로가 생긴다.

## URL 검증과 기존 권한의 경계

**RS 원형에는 detail URL의 host/path 및 offer binding 검증이 없다.** `extractDetailUrl()`과 `ROS_FETCH`는 현재 offer ID를 추출하거나 비교하지 않으며, 첫 `detailUrl`이 어느 상품의 것인지 확인하지 않는다. 특정 detail host/path template도 이 코드에 없다. 이미지 URL의 `alicdn` 정규식은 정확한 hostname allowlist 검증을 대신하지 않는다.

RS 보관 manifest는 `*://*.1688.com/*`, `*://*.alicdn.com/*` host permission을 갖는다. 현재 YOOFAM manifest에 `detail.1688.com/*`와 `itemcdn.tmall.com/1688offer/*` 권한이 이미 있다는 점은 부모 작업의 manifest 확인 결과다. **기존 권한은 그 범위에 대한 연결 가능성을 뜻하며, RS가 실제로 그 URL 형태를 사용하거나 현재 offer의 문서라는 증거는 아니다.** 이번 담당은 추가 manifest 분석이나 권한 변경을 하지 않았다.

이 RS 보관 디렉터리에는 현재 조사 상품의 원본 페이지·detail 응답 fixture가 없다. 확인한 원문과 보관 결과만으로 `itemcdn.tmall.com/1688offer/...`의 실제 path·query·offer 소속 검증식을 확정할 수 없다. 알려진 host/path를 바탕으로 URL을 만들어 실제 요청하는 것으로 이 공백을 메우지 않았다.

독립 일반 기능은 합성 오프라인 fixture로 `내장 상세 문서 참조 → 허용 host/path와 상품 소속 검증 → 제한된 text 해석 → 역할을 보존한 이미지 목록`을 구현할 수 있다. RS의 첫 match·무검증 전달을 그대로 채택할 이유는 없다. status·redirect·크기·시간·중복·원문 출처를 별도로 다루어야 한다. 이 문서는 구현이나 실제 수집 성공을 검증하지 않는다.

## 속성·포장 정보의 범위

`collect1688()`의 내장 JSON/DOM 두 분기는 옵션을 `{name,img,price}`로 새로 만들고 번역 후 `nameZh`를 추가한다. `_addToStudio()`의 최종 product 필드는 `name,nameZh,nameWarn,nameWhy,nameCands,src,thumb,options,images,trFail`뿐이다. 일반 속성·포장·중량 필드가 없으며 `.shipping`·`.weight` property read도 없다. 원본 skuModel에 추가 사실이 존재하는지는 이 코드만으로 알 수 없다.

전송 전 main/sku/desc 이미지는 하나의 `images[]`로 평탄화된다. RS가 상세 이미지 역할을 앱까지 보존하거나 속성·포장값을 다른 필드에 전달한다고 추론하지 않는다. YOOFAM의 속성·포장 보완은 RS와 별개의 명시적인 원문 추출·검증 작업이다.

## 보관 증거와 재검증

등록된 REA MCP의 실제 schema를 사용했다. 현재 ledger가 0건이어서 아래 portable bundle을 import한 뒤 같은 retained parent의 summary만 조회했다. 새 producer·runtime 관측은 0회다. content 단일 파일만 해당 REA parent의 범위이고 background·manifest는 별도 보관 정적 원문 확인이다.

- container Evidence: `ev_8f0285f7431d7aed1058bfe64a7d6fc8246d4595c53a5edebddd9ade54ed8d9c`
- extraction Evidence: `ev_5d065ab6accf6edc34f511d426bf14f2fb9acbecb7572c95bd0f0edbbcc68393`
- REA parent: `ev_5e23b694a30378c27c01eec2c169297c72138e2320926ab507812e2c56ebd298`
- summary: `ev_97b31888e05cec12bd7808e18732cd47d610284498406958bbc1ced6cbcc52db`
- asset view: `ev_cfdbce779cde42754a594f6bbfa41c00960b04c34f31be4e110ef70f259f95be`
- 선택 디렉터리 SHA-256: `b639d9ac5ca199955be340697988e1761a383f0049b977bba30bd05eb8371480`
- CRX: 301,297 bytes, SHA-256 `0a060fff4d07b3149f3af1e0693f25ce8d3e3fd973e955bb44f051648b404d53`
- 내부 ZIP SHA-256: `88c47bf2e66518a4d645ae4211d38af37506302a9540cdd2ef3fe5a5693ea462`
- content SHA-256: `199540b324c9a15ee323504c9216a411131bc3ce52cb51f1177ccfc9749b0242`
- background SHA-256: `d404c5d18350ed9b30cf09106c3ba594ad79052d945f1103010aae21e06a328d`
- bundle: `outputs/step747-rs-analysis-evidence-bundle.json`, 24,701,738 bytes, SHA-256 `a2da96f7626dd4cfc6437b34aa7a246cf48698768b995bcbc651481f999ba9f7`

다음은 기존 `outputs/step747-rs-analysis-proof.json`의 범위를 원문 bytes와 재대조한 결과이며 모두 일치했다. 범위 끝은 제외한다.

| 함수 | UTF-16 범위 | UTF-8 byte 범위 | 원문 slice SHA-256 |
|---|---|---|---|
| extractDetailUrl | [26687,26875) | [33950,34138) | `bb19330e42c827ea260967a0f0a87805823963eac31c41225facde1125b8e124` |
| fetchDescImages | [26955,27742) | [34272,35063) | `182dd9efbd8724184c4ed77915c87d73278fcba0c74de61b8837098e332799bf` |
| buildImagePool | [27779,29441) | [35128,37055) | `deabece901752b4796eaf615fa0911c683ca5764b7ff436964b69aef958a14e7` |
| collect1688 | [29445,32434) | [37059,40464) | `0a67cbcffb7bf2f58cff7617bf05b673c3525674fb9b8202005aed13b4ac75db` |
| _addToStudio | [43924,52982) | [55473,68151) | `06d84ea092f6b90c8b590ed212b5c352039b926874ff43ccb2e07c7c69446505` |
| ROS_FETCH (background) | [68119,68421) | [82251,82553) | `91367604d4c8031859b43397909daebb210ad7712d324acf0371194d3d8e4df8` |

원문 5개 SHA와 위 6개 slice를 검증했다. REA parse failure는 0, application coverage는 선택한 content 한 파일 안에서 complete이고 semantic unknown은 1,810개다. 이 범위를 전체 RS/서버 또는 실행 성공으로 확대하지 않는다.

## 미해결 및 실행 범위

현재 offer의 실제 `detailUrl`, 응답 content-type·내용, URL과 offer의 관계, 현행 1688 DOM 호환성, 실제 상세 이미지 수는 미관측이다. 실제 속성·포장 데이터의 정밀한 DOM/JSON 출처도 이 RS 수집기에서 해결되지 않는다.

실제 1688·RS·Couplus 네트워크 요청, 브라우저·로그인·수집 실행, 쿠키·키 사용, 벤더 호출, 운영 상품 접근·변경, 새 소프트웨어 설치는 모두 0이다. 기존 사이트 접근 거절의 우회는 수행하지 않았다. 새 native/browser/runtime 세션을 열지 않아 닫을 소유 자원이 없다. 기존 분석과 정적 원문을 재사용했으며 최종 문서 저장 외 추가 분석은 하지 않았다.
