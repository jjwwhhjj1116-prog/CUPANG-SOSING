# Step683 — Couplus 상세 편집 자료·저장·형제 적용 정적 대조

2026-10-15. 보관된 JavaScript만 읽었다. Couplus·브라우저·Supplier Hub·1688·외부 API에 접근하지 않았고 실행/저장 성공을 관찰하지 않았다. 이 조사 소유의 구현 파일·기존 상품·DB는 수정하지 않았다. 아래 **관찰**은 클라이언트 정적 코드이며, **재구현 판단**은 현재 YOOFAM PLUS 구조에 연결한 설계 제안이다.

## 근거와 범위

| 보관 자료 | SHA-256 | 크기 |
| --- | --- | ---: |
| `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js` | `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc` | 553,312 bytes |
| `outputs/step652-current-couplus/main.a20c7114.js` | `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad` | 579,613 bytes |

Step676/680의 retained Evidence를 재사용했다. 일반 저장/편집 기초는 `ev_782e7a89a96a33a05f38b2d977a5ee4001676f0891cc87373d600c7252192396`, 별도 headers 분석은 `ev_8ec3fd01351174fefebdc0fccae8f936ebf1c20201f4c59c76aff551e848ec3c`다. 형제 적용·분할 분석 parent는 `ev_9ba78b705b9c68a727604eaf0bebe7f726bbbe8fea6c6d38d50ac77d2b88e1ba`, summary는 `ev_c9d9ee950f92f5a97fb95a891ec7d8399335a204dc7f1ac4e0705f3cb3dec293`다. 이 parent의 조각 19개는 파싱 실패 0이지만 의미 unknown 1,572개여서 런타임 도달성이나 서버 성공의 증거가 아니다. 기존 portable bundle은 `outputs/step680-split-audit/rea-evidence-bundle.json`이다.

완료된 분석을 재실행하지 않았다. 남은 load/translation 질문만 같은 원본의 좁은 AST 범위로 확인하여 `outputs/step683-detail-editor-audit-inventory.json`에 원문 범위·UTF-8 범위·조각 SHA와 선택 원문을 보관했다. 생성기는 `step683-detail-editor-audit-inspect.mjs`이며 원본 전체 SHA를 먼저 검사하고 파싱만 한다. 새 REA producer Evidence를 발급한 결과는 아니므로 신규 load/서비스 세부사항은 이 source-bound manifest로 인용한다. 아래 범위는 모두 **UTF-16, 끝 제외**, `chunk`/`main`은 위 파일을 뜻한다.

## 결론: 통합 상세와 다시 편집할 입력은 별개

**관찰:** Couplus에는 최종 견적서 상세 이미지와 별도로 root `detailHtml`, `processedDetailImages`, `originDetailImages`가 있다. 수동 일반 저장과 형제 적용은 이 root 자료도 저장한다. 새로 연 편집기는 최종 견적서 PNG를 분해하는 대신 root 그룹을 불러온다. 따라서 Step682의 최종 통합 PNG 견적 연결만으로 Couplus의 재편집/재번역 상태까지 같아지지는 않는다.

**재구현 판단:** 현 앱에서 안전하게 다음으로 제공할 단위는 **실제 일반 상세 저장에 사용했던 순서 있는 소유 이미지 입력 목록을 다시 편집 초안으로 여는 것**이다. 저장 당시 파일 키·SHA·치수·출력 PNG 증거·카테고리·원본 상품/옵션을 묶어 보존하고, 복사한 대상에서는 그 원래 출처를 유지한다. 이는 Couplus 전체 편집 상태 복제보다 좁은 기능이다. vendor `RequestId`, OCR, 번역 성공 상태를 우리 작업의 검증 증거처럼 만들거나, 대상의 수집 원문/ALT/다른 옵션/카테고리를 덮어쓰면 안 된다.

## 로드와 화면 그룹

`chunk data [96154,96573)`의 편집 상태는 `detailHtml`, `imageMargin`, `processedGroupsMap`, 현재 그룹/편집 index, `editorRequestId`, `editorImageUrl`, loading/processing 플래그 등이다. `detailImages [96882,96973)`는 `product.detailImages || []`를 읽는다. `originDetailImages`를 직접 편집 입력으로 읽는 getter가 아니다.

`created [99562,100016)`는 truthy root `detailHtml`을 그대로 로컬에 넣고, falsy이면 HTML을 다시 생성한다. 이어 root `processedDetailImages`가 truthy이면 map을 비우고 `index !== undefined`인 각 그룹을 그 index 키에 넣는다. 동일 index는 뒤 항목이 덮는다. 스키마/해시/소유자 검사나 stale 검사는 이 로드 경로에서 확인되지 않는다. stored `detailHtml=''`는 재오픈 시 명시적 공백으로 유지되지 않는다.

`processedGroups [97368,99354)`는 두 분기를 가진다.

- root 처리 배열이 비어 있지 않으면 현재 설정의 상단 이미지(index -1), map의 그룹, 현재 설정의 하단 이미지(index -3)를 조합한다. 현재 상·하단 URL과 같은 그룹은 content에서 빼며, map에 없는 원본 index를 detailImages로 자동 보충하지 않는다.
- 그 외에는 현재 detailImages를 돌며 현재 설정 배너를 한 번씩 만들고, map 항목이 있으면 사용하며 없으면 `{index,url,originalUrls:[url],processType:'original',isProcessed:false}`를 만든다.

배너 객체에는 `processType:'setting'`, `isSettingImage:true`, `isTopImage`/`isBottomImage`, `isProcessed:false`가 있다. `imageGroups [99394,99560)`의 **5개씩 묶기**는 현재 이미지 목록의 화면 그룹이다. 서비스의 대표 번역 결과는 `groupSize:1`이며, 다섯 장을 합친 번역 단위라고 해석할 근거가 없다.

`initializeDetailHtml [104047,105462)`와 `generateDetailHtmlFromProcessed [127674,128968)`는 max-width 800px/padding 20px wrapper 안에 폭 760px 이미지를 만든다. 후자는 content 그룹을 numeric index로 정렬하고, 상·하단은 따로 배치하며 `imageMargin`을 적용한다. 처리 그룹이 0개이면 기존 HTML을 그대로 둔다. `compiledHtml`은 로컬 detailHtml을 반환하며 render의 `innerHTML`로 전달된다. 로컬 map의 for-in 순서와 HTML의 index 정렬을 같은 규칙으로 단정하지 않는다.

`mounted [100017,100453)`는 500ms 뒤 첫 처리 그룹 또는 첫 원본 그룹을 선택하고 Delete key listener를 등록한다. `beforeDestroy [100454,100529)`는 listener를 제거한다. 이 컴포넌트의 끝까지 확인한 범위에는 상품 변경을 다시 hydrate하는 watch가 없다. 실제 화면 이동/재사용 정책은 정적 조각만으로 확정하지 못했다.

## 번역 결과와 편집 동작

대표 단일 번역은 `main translateSingleImage [466160,472260)`이고, UI 호출은 `chunk [115388,116718)`다. 그룹의 공통 형태는 다음과 같다. 모든 값이 항상 있는 정규 스키마는 아니다.

```text
index, url, originalUrls:[입력 URL], processType:'translated',
requestId, translationData, groupSize:1, lastEdited,
isTranslated, [ocrInfo], [isBase64], [translationFailed], [failReason]
```

서비스는 이미지 번역 요청의 RequestId를 얻고 OCR 조회 → 텍스트 번역 → OCR 렌더 결과 URL을 사용한다. 텍스트 없음은 원본 URL/`isTranslated:false`로 반환할 수 있고, RequestId 없음·OCR 실패 등은 원본 URL과 `translationFailed:true`/사유를 돌려줄 수 있다. `processType:'translated'`나 requestId 존재만으로 번역 성공을 뜻하지 않는다. provider 응답/권한/URL 영속성은 미확인이다.

영문 번역 `main [472261,475848)`는 `{sourceLanguage:'ENG',targetLanguage:'KOR',imgUrl}`를 요청하며 그룹에 언어 필드를 붙인다. 기본 단일 번역 요청에는 명시적 sourceLanguage가 없다. `retranslateImage [491676,492329)`는 `originalUrls[0]`이 있으면 그 URL, 아니면 현재 그룹 URL을 **기본 단일 번역 함수**에 넘긴다. 영문 그룹의 언어 필드를 보고 영문 함수를 선택하는 분기는 없다. 기본 provider 언어를 중국어라고 확정할 수는 없다.

UI `processAllImages [113493,115197)`는 배너를 제외하고 같은 index의 requestId가 truthy이면 건너뛴다. `translationFailed`는 보지 않는다. 반면 자동 서비스 `process [504716,514814)`는 `requestId && !translationFailed`일 때 건너뛰고 실패 항목을 한 번 재시도한다. 자동 서비스는 실패 수에 따라 `partially_completed`/`completed`와 `detailImageWarning`을 작성한다. 따라서 두 경로의 완료/재시도 규칙을 합치면 원본과 달라진다. legacy `processDetailImages [492330,495081)`에는 `originalUrl` 단수·`translatedData` 등 다른 형태도 있어 `processedDetailImages`를 한 종류의 완벽한 문서로 가정할 수 없다.

`openEditor [108282,109141)`는 선택한 처리 그룹 URL/requestId를 ImageEditor에 전달한다. 원본 5개 화면 그룹에서는 첫 URL만 선택한다. `handleEditorImageEdited [111813,113270)`는 반환된 URL/requestId 또는 이전 값을 골라 기존 그룹을 spread하고 `lastEdited`를 갱신한다. 로컬 HTML의 이전 URL을 바꾸고 다시 HTML을 생성한다. 이 메서드는 서버 저장을 호출하지 않는다. 이동도 index/map/HTML 로컬 변경이다. `deleteImage [122288,124404)`는 store commit만 하지만 `deleteOriginalImage [125969,127673)`와 업로드 `[129855,131176)`는 `updateRocketProduct`를 호출한다. 모든 편집을 오직 최종 저장 버튼에서만 저장한다고 주장할 수 없다.

## 일반 상세 저장의 정확한 경계

`chunk saveDetailPage [131264,136334)`의 기존 조각 SHA는 `757d3e6097a2084225181b9e0cbf205687e1cb93061ea886e7b66b3f53dc28f2`다.

1. `processedGroups.length===0`만 차단한다. 원본/실패 그룹도 배열에 있으므로 모든 이미지의 번역 성공을 요구하지 않는다.
2. root detailHtml에 현재 로컬 HTML, processedDetailImages에 URL이 있는 non-setting 그룹을 넣는다. data URL은 개별 업로드를 시도하고 URL/HTML을 치환하지만 개별 업로드 오류는 삼킨다.
3. root detailImages는 data URL이 아닌 모든 그룹 URL과 업로드 성공 URL이며 설정 배너를 포함할 수 있다. root 상태와 statusObj는 `completed`, lastModified는 현재 시각이다.
4. 별도 폭 800px/padding 0 HTML을 만들어 하나의 이미지로 변환한다. 실패/빈 결과에서는 개별 URL 쉼표 연결로 fallback한다. 이 최종 값은 root 편집 HTML/입력 목록과 다를 수 있다.
5. 현재 상품 공통 첫 견적서와 모든 옵션 첫 견적서의 상세 이미지에 최종 값을 넣고 견적 상세 HTML은 `''`로 만든다. root ALT가 falsy이면 SEO metaDescription 또는 상품명 기반으로 채우고, 옵션 ALT는 옵션명 suffix 정책으로 다시 쓴다.
6. `updateRocketProduct`를 await한다. 내부 catch는 안내 후 오류를 반환값으로 다시 던지지 않는다. 형제 적용 caller의 await만으로 성공을 증명할 수 없다.

자동 서비스 `[504716,514814)`는 성공 시 root detailImages를 통합 이미지 한 장, root detailHtml을 그 단일 이미지 HTML로 만들 수 있다. 반면 `processedDetailImages`에는 non-banner 개별 그룹을 남긴다. 공통 견적 전체 문서의 ALT 규칙도 수동 저장과 다르다. 자동 저장 root 목록만으로 다시 편집할 개별 입력을 복원하는 것은 손실이 있다.

## 명시적 형제 적용의 patch

일반 저장에는 형제 순회가 없다. `applyDetailToSiblings [100938,102402)`만 선택 대상에 적용한다. source 저장 뒤 store의 상품을 다시 읽고 root detailImages 배열 및 공통 첫 견적서 상세 값(없으면 URL 쉼표 연결)을 취한다. `applyDetailToOneProduct [102403,103651)`의 조각 SHA는 `f8988ff9d2732237eaac51eaca66c635b4b4df2dd71fa60bcf8d3e5ed5913bf7`다.

| 대상 필드 | 값 |
| --- | --- |
| root detailImages | source 배열 복사 |
| root detailHtml | `source.detailHtml || ''` |
| root processedDetailImages | source 값 또는 []의 JSON deep copy |
| root detailImageStatus / statusObj | `completed` / `{status:'completed',images:[...sourceImages]}` |
| root originDetailImages | source 값 또는 []의 JSON deep copy |
| root lastModified | 현재 Date |
| 공통 모든 기존 `jsonDocument[].imagePage.details` | 최종 상세 이미지, HTML `''` |
| 모든 옵션 root 상세 목록/상태 | sourceImages 및 completed |
| 각 옵션 첫 기존 견적서 imagePage.details | 최종 상세 이미지, HTML `''` |

ALT·대표/추가 이미지·가격·표시사항·옵션 identity는 patch에 없다. `detailImageWarning`도 patch에 없어 대상의 옛 경고가 남을 수 있다. source 그룹에 `translationFailed:true`가 있어도 대상 root 상태는 completed다. JSON deep copy는 Date를 문자열로 바꾸고 undefined 속성을 버린다(언어 표준에 따른 해석). 대상의 전역 상·하단 설정은 복사하지 않으므로 재오픈한 편집 화면의 배너와 복사한 최종 PNG가 같다는 보장도 없다.

대상은 각각 순차 `updateProductPartial`을 호출한다. 개별 실패를 모으며 트랜잭션/rollback은 없다. store를 먼저 바꾸는 action이어서 서버 실패 후 로컬 값이 남을 수 있다. 정적 클라이언트가 의도하는 저장을 관찰한 것이며 서버 DB 구조·실제 영속 성공은 미확인이다. Step681/682가 명시적 가족/선택/검토/CAS/원자 저장을 사용하는 것은 안전한 재구현 정책이며 Couplus에서 관찰한 동작을 그대로 실행한 기록이 아니다.

## originDetailImages는 불변 수집 원문이 아니다

`main searchRocketProducts [271948,273130)` 안 `[272609,272750)`은 조회한 **현재 detailImages**를 `[{originalUrl:url,img:url}]`로 정규화하여 originDetailImages를 다시 만든다. 없으면 `[272751,272774)`에서 []다. chunk의 단건 누락 상품 로드 `[366833,366959)`도 같은 형태다. main mutation `[248239,248298)`은 새 값이 falsy이면 이전 origin을 보존할 수 있고, 자동 서비스 patch `[513252,513505)`는 기존 origin이 truthy이면 사용하며 없을 때 결과 이미지 URL로 만든다.

그러므로 이름이 origin이라는 이유로 원 사이트의 최초 이미지·불변 출처·현재 processedGroups의 입력이라고 단정할 수 없다. 현 앱의 immutable 수집 자료를 이 배열로 덮어쓰는 대응은 잘못이다. 저장 당시의 실제 입력을 보존하는 자체 증거 문서는 더 좁고 분명한 의미를 가져야 한다.

## 현재 모델에 대한 재구현 판단과 남은 범위

현재 `ProductContent.detail.description`은 일반 텍스트이며 HTML과 동등하지 않다. 현 견적의 상세 이미지/HTML은 카테고리별 동적 필드 연결이고, ALT는 별도 보존해야 한다. 무료 이미지 번역 증거는 상품/버전/원본 키/SHA/역할/치수 및 견적 대상 fingerprint에 결합되어 있어 다른 상품으로 그대로 재사용할 수 없다. vendor의 URL·requestId·OCR 객체를 이 증거로 포장하지 않는다.

최소 후속 동작은 저장된 통합 상세의 **실제 순서 있는 입력 키/SHA/치수**를 별도 버전 문서로 유지하고, 명시적 가족 적용 시 출력 PNG와 함께 복사하되 출처 상품/옵션은 보존하는 것이다. 재열기 버튼은 검증된 입력을 초안에 넣는 읽기 작업이며, 사용자가 기존 상세 저장을 실행하기 전에는 견적/ALT/HTML/다른 초안에 쓰지 않아야 한다. 없는/오래된 문서는 일반 legacy 조회를 막지 않고 새 작업에만 조건을 적용한다. 이 최소 기능은 OCR 텍스트·박스·폰트·vendor 편집 이력을 재현한 기능이라고 표시하면 안 된다.

전체 Couplus와 동일한 편집/번역 흐름에는 처리 그룹 schema 정규화, 실제 OCR/번역 provenance와 편집 도구, 실패별 재시도 규칙, HTML/배너 설정/정렬/삭제/업로드 저장시점 대조가 더 필요하다. provider 백엔드·URL 만료·서버 저장 정책·실제 사용자가 어느 legacy 메서드에 도달하는지는 미확인이다. 정적 자료의 버그/느슨한 검증까지 제품 요구로 복제하지 않는다. 기존 상품에 대한 자동 백필·원문 교체·자동 형제 전파는 이번 감사에서 요구하거나 수행하지 않았다.

## 재현 가능한 fixture

`outputs/step683-detail-editor-audit-fixtures.json`은 위 source range에 결합한 **합성 검토 fixture**다. 실제 응답/사용자 자료나 Couplus 실행 캡처가 아니다. 실패 그룹의 completed 저장, root HTML/견적 HTML의 분리, 현재 목록으로 origin 재생성, 빈 HTML의 재생성, 영문 그룹의 기본 재번역, UI/자동 재시도 차이, 중복 index 마지막 값 등의 반례를 보관했다. 미검증 provider 성공을 fixture 결과라고 주장하지 않는다.

이 조사에서 새 네이티브/REA 런타임 세션·브라우저·프로세스를 열지 않았으므로 종료할 소유 자원은 없다.
