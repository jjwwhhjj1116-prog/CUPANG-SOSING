# Step747 — RS 수동 1688 수집 → 앱 전달 계약

확인 결과, RS는 사용자가 현재 상품 페이지의 **상품 수집** 버튼을 누르면 페이지에 이미 들어 있는 SKU JSON과 DOM을 읽고, 이미지 다운로드·번역 후 확장 저장소 대기열을 통해 앱에 전달합니다. 이 수동 경로에서 CLI나 별도 1688 상품조회 API는 확인되지 않았습니다. 같은 UX는 독립 구현할 수 있으나 RS가 버리는 SKU 식별자·이미지 역할·MOQ·물류 사실까지 버리면 YOOFAM의 견적 검증을 충족하지 못합니다.

## 대상·실제 REA 근거

- 확장 ID `jbfdblccnofegmdfhdceabhlmfbjepge`, 실제 보관 manifest **1.0.88**. 웹스토어에 캐시된 1.0.85와 구분합니다.
- 부모가 공식 Google 배포에서 보관한 CRX 301,297바이트 SHA `0a060fff4d07b3149f3af1e0693f25ce8d3e3fd973e955bb44f051648b404d53`, 내부 ZIP SHA `88c47bf2e66518a4d645ae4211d38af37506302a9540cdd2ef3fe5a5693ea462`.
- 부모의 컨테이너 Evidence `ev_8f0285f7431d7aed1058bfe64a7d6fc8246d4595c53a5edebddd9ade54ed8d9c`, 추출 Evidence `ev_5d065ab6accf6edc34f511d426bf14f2fb9acbecb7572c95bd0f0edbbcc68393`.
- 이번 실제 REA producer는 **content-1688.js 1파일 70,862바이트만** 선택: parent `ev_5e23b694a30378c27c01eec2c169297c72138e2320926ab507812e2c56ebd298`, summary `ev_97b31888e05cec12bd7808e18732cd47d610284498406958bbc1ced6cbcc52db`, asset view `ev_cfdbce779cde42754a594f6bbfa41c00960b04c34f31be4e110ef70f259f95be`.
- 선택 digest `b639d9ac5ca199955be340697988e1761a383f0049b977bba30bd05eb8371480`; parse failure 0, application coverage complete within that one file, semantic unknowns **1,810**. Background/bridge 아래 범위는 별도 inert AST 검사이며 이 REA 부모 범위를 확대하지 않았습니다.
- 재현 원문·정확한 SHA·UTF-8 byte 범위: `outputs/step747-rs-analysis-proof.json`. 아래 범위 단위는 UTF-16 끝 제외입니다. Portable Evidence는 `outputs/step747-rs-analysis-evidence-bundle.json`에 보관했습니다(세션의 다른 보관 Evidence도 포함).

## 버튼에서 상품 원문까지

| 경계 | 원문 범위와 확인한 계약 |
|---|---|
| 버튼/프레임 | manifest는 `*://*.1688.com/*`, `rs-fab.js` 다음 `content-1688.js`, isolated content world, all_frames. `injectAddButton [52986,54097)`은 FAB `p1688` click→`addToStudio`; `maybeInject [54580,54702)`는 offer/detail/p URL에서 표시. iframe 표시 여부는 FAB 반환을 따름. |
| 사전 조건 | `_addToStudio [43924,52982)`는 `ROS_APP_OPEN` 4초 응답, 확장 저장소 `ros_auth` 확인 후 진행. 이 값은 RS 앱 조건이지 Hub 회사코드 검증이 아님. |
| 실제 SKU JSON 원천 | `getSkuModel [16525,16960)`은 **script.textContent**에서 `"skuModel"` 뒤 첫 `{`부터 문자열을 고려한 균형 객체를 잘라 `JSON.parse`. 주석의 “window.context”와 달리 실제 window/global 객체를 읽지 않음. JSON-LD 전용 parser나 XHR/fetch 가로채기 아님. Slice SHA `cea1a6c232be3f93bbe6bcb3ff045aefd3e8f8f60566663736defa2cd1c82871`. |
| 옵션/가격 | `optionsFromContext [17134,19027)`은 `skuProps[].value[].{name,imageUrl|image|picUrl|imageURI}`와 `skuInfoMap|skuInfoMapOriginal[k]`의 `specAttrs`, `discountPrice|price|skuPrice|consignPrice`만 사용. `specAttrs` 없으면 map key를 **조합 이름**으로 사용. 가격 없으면 `skuPriceScale|skuPriceScaleOriginal|priceScale`의 양수 중 최댓값을 사용. Slice SHA `bd095f1c8534539b9d7af5f104f6487580aa3a0d12a367938829bec4a3bbc796`. |
| DOM 보완 | 옵션 이미지는 속성 스와치 이름으로 보완. SKU JSON 없으면 속성 그룹 조합(최대 200)·SKU 가격행·옵션 DOM fallback. 최종 옵션은 `{name,img,price}`에 번역 후 `nameZh` 추가. 공급 원본 SKU ID는 유지하지 않음. |
| 상품명 | `getProductName`, `nameTitleCands`, `nameElemCands`, `readProductName`은 script의 subject/subjectTrans/offerTitle/offerSubject/productTitle/productName, OG/title/description, 제목 DOM 후보를 평가. 약한 결과·번역 실패 경고와 중국어 원문을 보존. 선택적인 RS `/api/name` 호출은 제목 개선이며 수집 자체와 분리됨. |
| 이미지 | `extractGallery [26107,26684)`는 offerImgList/mainImageList + DOM preview. `buildImagePool [27779,29441)`는 main/sku/desc를 구분하고 겹침 제외. 상세는 embedded detailUrl→`ROS_FETCH`로 HTML 읽기→alicdn URL 추출(`fetchDescImages [26955,27742)`). 기본 페이지에서 상품 상세 API를 호출하는 방식이 아님. |

**제공되지 않는 사실:** content-1688.js에 `skuId/specId`, currency/CNY, MOQ/minOrder/beginAmount/minOrderQuantity, shipping/weight property read가 없습니다. 원본 skuInfoMap에 추가 필드가 실제 존재하는지, 그 값이 무엇인지는 이 코드로 확인할 수 없습니다. `offerId`도 별도 추출하지 않고 `src=location.href`를 보냅니다. 이 부재를 실제 SKU ID·CNY 통화·MOQ=1로 추정해 채우면 안 됩니다.

이미지는 CDN에서 받아 dataURL로 줄입니다(동시성 6, main40/sku40/desc80 한도, 예산 24MiB). 이는 원본 URL·해상도·역할을 갖춘 immutable 원문 receipt와 다릅니다. 후기 영역은 선택자 단계에서 제외합니다. `main-inject.js`는 manifest상 Supplier Hub의 MAIN world용이며 이 1688 수집 경로의 global 추출기가 아닙니다.

## 확장 메시지·저장·앱 ACK

수집기 최종 메시지:

```text
ROS_ADD_PRODUCT { product: {
  name, nameZh, nameWarn, nameWhy, nameCands,
  src: location.href, thumb, options:[{name,nameZh,img,price}],
  images:[dataURL...], trFail
} }
```

전송 전 images는 옵션 이미지→main→sku→desc 순서로 **평탄화·중복 제거**됩니다. main/sku/desc 역할, counts/skipped는 상품 전송 객체에 없습니다. 60초 ACK timeout은 “저장됐을 수도 있으니 앱 확인”으로 표시하며 성공으로 단정하지 않습니다. 외부 180초 Promise.race는 버튼을 되살리지만 이미 실행 중인 `_addToStudio`를 취소하는 계약은 아닙니다.

1. Background `ROS_ADD_PRODUCT [62615,66001)`는 `ros_prod:<전체src>`에 `{options,images,ts,trFail,koKept}` 저장. `packProd [40946,41617)`는 옵션 img를 images의 `imgRef`로 바꿔 중복 저장을 줄이고 나머지 옵션 필드를 보존. 이미지 저장 실패여도 light 상품 대기열은 별도 저장하고 imgWarn 반환.
2. light `{name,nameZh,nameWarn,src,thumb,imgWarn,_ts,_pid,...진단}`를 `ros_pending`에 append. 열린 앱 탭에 origin helper→bridge 재주입. ACK `{ok:true,delivered:tabs.length>0,imgWarn,koKept}`는 **대기열 저장/탭 존재**를 뜻하며 앱 저장·Hub 접수 증명이 아님.
3. 앱 bridge `drainPending [7673,8782)`는 `ROS_PULL_PENDING`으로 받아도 지우지 않음. `registerProducts [3664,7047)`는 localStorage `rkt_products`에 추가/갱신, `/api/store?acct=...`에 `{data:{rkt_products:<JSON문자열>}}` 저장(`pushStoreKey [2883,3661)`). HTTP 성공과 JSON `ok!==false`를 검사.
4. 로컬 저장 fail 또는 서버 ok false이면 ACK하지 않음. 성공하면 `ROS_ACK_PENDING {ids:[_pid...]}`. Background `[69859,70547)`는 일치 `_pid`만 삭제하고 `{ok:true,removed,left}` 반환. Pull/ACK는 허용 RS origin의 sender만 사용.
5. RS 앱 중복 기준은 **동일 name+전체src**, 이름 확인불가일 때 일부 src fallback. 이름이 같고 src가 다르면 숫자 suffix. 전체 쿼리 URL·번역 이름에 의존하므로 YOOFAM의 안정적인 offer/member/company identity나 기존 작업 불변성을 대신할 수 없음. `ros_prod:<src>` 자체는 회원/회사 key가 아님.

## 독립 구현 권고·한계

- 사용자가 누른 현재 페이지에서만 정적 사실을 취득→회원/회사에 묶인 **미검토 inbox receipt** 저장→앱에서 명시적으로 카테고리 확인→필수 사실 검증 후 Stage1–7 초안 생성. 기존 상품 재수집/덮어쓰기와 자동 Hub 제출을 이 버튼에 붙이지 않습니다.
- source URL/추출 경로/원문 이름/실제 SKU 식별자/가격·통화의 증거/이미지 역할을 따로 보존합니다. RS의 가격 범위 max, 0원, 임의 조합 이름은 수집 사실로 표시할 수 있어도 검증된 실제 SKU 원가로 승격하지 않습니다. 확인 못한 MOQ·물류값은 unknown 유지.
- 자체 일회성 capture ID와 idempotency key, sender document/origin·member/company binding, 서버 저장 확인 후 ACK를 구현합니다. RS 사설 `/api/name`·`/api/store`·auth 저장소 또는 vendor 런타임을 복사·호출할 필요가 없습니다.
- 이 연구는 정적 계약입니다. 실제 RS 수집 성공률·속도·현재 1688 문서 호환성·앱 저장·Supplier Hub 접수는 관측하지 않았습니다. 특히 이전 거절 상품 `963861920029`를 RS/확장/다른 경로로 수집하지 않았습니다.

검증: inert AST assertions exit 0, 선택 source 5개/정확 범위 34개 SHA 저장. 신규 REA producer는 content 단일파일 1회. vendor 실행·브라우저·네트워크·운영 데이터 접근/변경 0, 앱/테스트/확장 수정 0. 이 조사에서 연 native/session 자원 없음.
