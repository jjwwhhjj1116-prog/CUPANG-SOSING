# Step749 — RS 수집 후 상품명 기반 카테고리 추천 계약

확인일: 2026-10-19 (Asia/Seoul). RS의 초반 흐름은 **현재 페이지 수집 → 상품 목록 → 제안서 열기 → 현재 상품명으로 Supplier Hub 추천 3개 → 사용자가 전체 경로 하나 선택 → 선택한 코드로 옵션 노출속성 로드**다. 이후 YOOFAM의 SEO·가격·이미지·표시사항·견적 편집을 유지하는 독립 구현에 필요한 계약을 확인했다.

## 출처와 REA 범위

- 공개 대상: [RS 로켓 상품 등록](https://rocketstudio.kr/10_%EB%A1%9C%EC%BC%93%EC%83%81%ED%92%88%EB%93%B1%EB%A1%9D). 인증 없이 HTTP 200으로 받은 HTML을 정적 자료로만 읽었다. 로컬 보관 `outputs/step749-rs-category/registration.html`, UTF-8 360,027바이트, SHA-256 `e9b27466d63ac8a12703b033e3b7859d23bdae71ecacf575c682b2c3b2f54635`.
- 확장 자료는 Step747의 공식 배포 RS 1.0.88을 재사용했다. 이번에 읽은 `content-hub.js` SHA-256 `f1ab90c06f6faec758ac928195d19788ff3d3def7ecff2eedf9f1e294a6f4b14`.
- REA producer는 추천 웹 함수, Hub 추천 함수, Hub 스키마 함수의 **정확한 원문 발췌 3개**만 분석했다. 원문 위치/선택 digest: `outputs/step749-rs-category/source-proof.json`. 새 Evidence parent `ev_8294de0c975920bc27a54b9719987a0dded4997ae4733cfb25d277d0cf2e0157`; summary `ev_7825474b5fab96469fa909db49d6a149cecf95716f839d52249616b21ce78040`; module page `ev_3faf9a04400e29fc6e800e22bde82acd95d278d2817770aeb7dc827968a7b8a9`.
- 추천 Hub module view `ev_0117182f10eaabde6a21ab3be93fb4575bd0410aa386928a14a67dfd551802f6`; 웹 module view `ev_7ff2384ec619867186f5294039564b96089c0bb21f0cfa040193c3d3cdaa25de`. 선택 파일 3개/10,163바이트, parse failure 0. 선택 범위의 application coverage complete, semantic unknown 280. 전체 RS 서비스 분석 완료나 실제 실행 관측을 뜻하지 않는다.

## 확인한 추천·선택 계약

| 경계 | 정적 코드에서 확인한 동작 |
|---|---|
| 자동 추천 시점 | 새 `draft` 제안서를 열면 현재 목록 상품명으로 요청한다. 저장된 제안서를 다시 열 때는 저장된 카테고리를 유지하며 자동 재추천하지 않는다. 상품명 `input`은 600ms debounce, ‘추천 새로고침’은 현재 입력값으로 즉시 요청한다. |
| 웹 → 확장 | `ROS_RECO` 메시지의 입력은 `{productName: 현재 상품명}`이다. 카테고리 코드를 상품명이나 1688 URL에서 조합하지 않는다. |
| 실제 추천 원천 | Hub content script의 `getRecos`는 `GET https://supplier.coupang.com/sr/category/api/predict?productName=<encodeURIComponent(상품명)>`을 호출한다. `credentials: include`, JSON accept, AbortController 14초 제한. 401/403은 로그인 필요, 비정상 상태와 timeout은 실패를 돌려준다. RS 사설 AI 추천 API를 쓰는 경로가 아니다. |
| 응답 형태 | 응답 JSON **자체가 배열**이어야 한다. `data/items/result` wrapper 해제 없음. 앞 3개를 순서대로 `{index, label: fullPathName 또는 name, name, id: internalCategoryId, code: internalCategoryCode}`로 변환한다. |
| 추천 표시 | 전체 `label`을 라디오처럼 표시한다. 선택 전 세 후보, 선택 후 선택한 후보와 ‘다른 추천 보기’를 표시한다. 첨부 화면의 경로는 `>`로 구분돼 있지만 JS는 `fullPathName`을 그대로 쓰며 delimiter를 강제하지 않는다. |
| 선택 값 | `ppSelectReco`가 입력 표시값에 `label`, 별도 `dataset.code`에 `code`를 기록한다. 자동으로 첫 번째 후보를 확정하지 않는다. 저장 데이터도 `cat`과 `catCode`를 분리한다. 실제 전송 시 `catCode`가 없으면 중단한다. |
| 코드 → 폼 | 선택 후 `ROS_SCHEMA {code}`. Hub는 `GET /sr/schema/api/get-default-schemaform?internalDisplayCode=<code>&useCustomizedJsonSchema=true`, `data.schemaString`을 JSON.parse한다. `exposedAttributes`를 찾아 attributeName의 이름/입력유형/필수 여부/선택지/힌트를 옵션 열로 변환한다. 기존 옵션 행은 유지하며 **열만 교체**한다. |

웹 추천 발췌 원문 UTF-16 `[178890,182740)`, SHA `2bc741eb37a4aa2d279cc30dfac18a32dfa6d773ed9824845e1dccc2b1bb142c`. Hub 추천 `[10061,12303)`, SHA `1e7705ff19fdbfded427d5b8f4ac68df928dcba081fa7ecb9bf587c328162fd8`. Hub 스키마 `[14627,16865)`, SHA `730c114430285c9da95f95a21cd393d1d68223e2a0a76fe71485a085c9b9f7a6`. 위 범위는 끝 제외이며 UTF-8 byte 범위도 proof에 있다.

## 수집 옵션과 연결되는 부분

공개 HTML의 `ppOpen`, `pp1688Load`, `pp1688MakeRows`, `ppSaveInner`는 별도 정적 원문 검사 범위다. 이 함수들은 위 REA 3개 발췌 producer에 포함되지 않았으므로 그 Evidence의 분석 범위로 확대해 말하지 않는다.

`pp1688Load(src,name)`는 새로운 상품조회 요청 대신 `ROS_GET_PROD {src}`로 확장에 이미 수집된 옵션·이미지를 읽는다. 받은 옵션은 상품별 사본으로 보관하고 빈 응답으로 기존 사본을 지우지 않는다. 현재 상품·계정·제안서 sequence가 바뀌면 늦은 응답을 버린다. 옵션 선택 드롭다운과 이미지 풀을 갱신한다.

‘1688 옵션 가져오기(N)’ 버튼은 수집 옵션에서 편집 행을 별도로 만든다. 원가와 옵션 이미지를 가져오며 가격이 양수일 때 수량을 1로 놓는다. 이는 RS의 편집용 기본값이며 실제 MOQ나 원본 SKU ID의 증거가 아니다. 카테고리 선택은 이 행들을 지우지 않는다. 저장 전에 소재·상품유형·각 행의 필수 노출속성을 검사한다.

## 독립 구현에 반영할 사항

1. 수집 원문 receipt는 유지하고 상품명은 자유롭게 편집한다. 현재 이름으로 공식 Hub 추천을 요청한 뒤 전체 경로 3개 중 사용자가 고르게 한다. 코드·ID·경로를 서로 대체하지 않는다.
2. 선택한 leaf code를 기존 CategoryPicker의 검증·스키마·공식 견적 양식 경로로 전달한다. 이름 기반 추정 코드나 RS의 사설 저장소를 쓰지 않는다. 후보가 없거나 추천을 못 읽으면 기존 수동 카테고리 선택을 제공한다.
3. 계정/회사/수집 ID/현재 상품명/요청 sequence가 달라진 늦은 추천은 적용하지 않는다. RS 웹의 `ppRequestRecos` 자체에는 이 sequence 검증이 보이지 않으므로 해당 결함은 복제하지 않는다.
4. RS `getRecos`에는 추천 반환과 별개로 Hub 상품명 입력을 비동기로 채우는 부작용이 있다. **추천 기능에 이 부작용을 복제하지 않는다.** RS background도 아무 Hub 탭 첫 번째를 고른다. YOOFAM은 회원·회사·같은 Chrome 창 확인을 유지해야 한다.
5. 수집 성공·웹 저장·견적 초안 완성·실제 Hub 접수는 서로 다른 상태로 표시한다. 추천 성공을 Hub 등록 완료로 표시하지 않는다.

## 미확인 사항과 작업 경계

실제 predict 응답의 ID/code 예제·현재 추천 순위·쿠팡 내부 추천 알고리즘·실계정 성공 여부는 정적 자료에서 확인되지 않았다. 사용자가 보낸 화면에는 전체 경로가 있지만 숫자 ID/code는 없다. 이 조사에서 Hub API를 실행하거나 기존 상품을 열어 수정하지 않았고, 거절된 1688 상품을 직접·우회 조회하지 않았다. RS 벤더 JS 실행·토큰/쿠키 추출·상품 저장/전송·결제는 하지 않았다. 공개 문서 다운로드와 inert 분석만 수행했다.
