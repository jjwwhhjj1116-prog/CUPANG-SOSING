# Step685 — 저장된 상세 조합 작업 공간의 기능 대조

2026-10-16. Step683/684의 보관 Evidence와 원문 조각을 재사용했다. **새 REA producer/MCP·브라우저·Couplus·Supplier Hub·1688·외부 API에는 접근하지 않았다.** 구현/DB/기존 상품은 변경하지 않았다. 아래 관찰은 shipped client의 정적 동작이며 실제 클릭·파일 저장·provider 실행의 관찰이 아니다. 재구현 판단은 vendor의 인덱스 결함이나 느슨한 검증을 복제하기 위한 요구가 아니다.

## 근거와 범위

- chunk `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`: SHA256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`, 553,312 bytes.
- main `outputs/step652-current-couplus/main.a20c7114.js`: SHA256 `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`, 579,613 bytes.
- 기존 save/group Evidence `ev_782e7a89a96a33a05f38b2d977a5ee4001676f0891cc87373d600c7252192396`; 형제 적용 parent `ev_9ba78b705b9c68a727604eaf0bebe7f726bbbe8fea6c6d38d50ac77d2b88e1ba`; iframe 한정 parent `ev_6373190d88287217f0a505c6e86baff55ba4c1447b792b744463771033bf7809`, summary `ev_c9c4ef6a6c24aba3f82a41d2f2c85fec2b199086d3d4eb432d17bd4a702a5170`.
- 그 Evidence의 범위/unknown과 portable bundle 위치는 [Step683](step683-detail-editor-parity-audit.md), [Step684](step684-edit-session-parity-audit.md)에 있다. 기존 분석을 재실행하지 않았다.
- 새 `outputs/step685-detail-composition-audit.json`은 기존 Step683 manifest의 동일 SHA 조각 20개를 다시 묶은 인용 자료다. SHA256 `9c91c92a7a52fcdcee47c1545a17292f3d80e6afe579fd276d2c127e600ccb75`. 생성기는 `step685-detail-composition-audit-inspect.mjs`; 파싱/실행 없이 원본 및 기존 조각 SHA를 대조하고 exact slice만 저장한다. 새 producer Evidence는 아니다.
- render reference 대조 범위 chunk UTF-16 `[85900,95620)`, SHA256 `ec87d61cd8cca89bd0147458dea115ac3d0b561ff3d121ea2afeac74201eff61`. 아래 offset도 UTF-16/끝 제외다. method 존재와 render 연결을 구분한다.

## 기능상 결론

Couplus는 **순서가 있는 개별 상세 사진/처리 그룹 + 별도 root HTML + 최종 견적 상세 이미지**를 함께 다룬다. 최종 통합 PNG 한 장만 보존하면 원래 사진의 이동·삭제·번역 결과 교체·재편집을 이어갈 수 없다. root `detailHtml`도 최종 PNG의 동일한 표현이라고 단정할 수 없다.

현재 render에 연결된 최소 기능은 개별 사진 위·아래 이동, 확인 후 삭제(마우스/hover Delete), 사진 번역/영문 번역, 처리 결과 편집, 업로드, 전체 번역, 상세 저장이다. 미리보기는 `compiledHtml`을 사용한다. 외부 iframe의 crop/brush/text 내부 동작은 Step684처럼 미확인이고 자체 저장 편집 문서로 별도 구현해야 한다.

## 로드: 조합 문서가 우선이고 PNG 분해가 아니다

`created [99562,100016)`는 truthy product.detailHtml을 로컬 HTML에 그대로 넣고 falsy이면 현재 사진으로 재생성한다. 처리 배열이 있으면 index가 정의된 그룹을 processedGroupsMap에 넣으며 같은 index는 마지막 값이 덮는다. `processedGroups [97368,99354)`는 저장된 nonempty 처리 배열이 있을 때 map과 **현재 설정**의 상·하단 이미지를 조합한다. 저장 그룹이 없는 분기에서는 detailImages 각 위치에 map 값 또는 original 그룹을 사용한다.

처리 그룹을 다시 여는 데 최종 견적 PNG를 분할하지 않는다. 자동 서비스가 root detailImages를 통합 PNG 한 장으로 바꿔도 processedDetailImages에는 개별 결과가 남을 수 있다. root originDetailImages는 조회 시 현재 detailImages에서 재생성되는 경로가 있어 불변 최초 수집 사진이 아니다. 자체 immutable 수집 원문을 이것으로 덮어쓰면 안 된다.

## 사진 순서와 삭제의 정확한 동작

| 현재 render 연결 | 정적 관찰 | 저장 경계 |
| --- | --- | --- |
| ↑/↓ → moveImageUp/Down `[120266,122287)` | group.index로 현재 배열 위치를 찾고 인접 두 그룹을 spread한 뒤 index를 서로 바꾸어 map 두 키에 넣는다. URL·원본 참조·처리 metadata도 해당 그룹과 함께 이동한다. HTML 재생성. | 서버 action 없음. 로컬 map/HTML 변경. |
| 처리 그룹 삭제 → deleteImage `[122288,124404)` | map 해당 index가 있어야 하고 confirm 후 삭제. root detailImages[index]가 있으면 그 항목도 제거하고 더 큰 map index를 -1 재배치. 없으면 map만 삭제. HTML 재생성. | root 배열을 바꾼 분기는 store commit만 하며 이 메서드에는 서버 action 없음. |
| original 사진 삭제 → deleteOriginalImage `[125969,127673)` | 범위/배너 검사 후 confirm. root 사진 한 위치 및 대응 map 항목을 제거하고 큰 index를 -1로 재배치. | updateRocketProduct를 await한 다음 원본 목록으로 HTML 초기화. |
| fallback 원본 목록 ↑/↓ → moveOriginalImageUp/Down `[124405,125968)` | root detailImages의 인접 두 URL을 바꾸고 HTML 초기화. 처리 map을 함께 교환하지 않는다. | updateRocketProduct 호출을 await하지 않는다. |
| hover Delete → handleKeyDown `[103652,103895)` | hovered index가 있고 setting이 아니면 processType original 여부에 따라 위 두 삭제 중 하나를 호출. | 같은 확인 절차를 거친다. |

이동 render 참조는 90969/91266, 삭제는 91548/91579, fallback 원본 이동은 92858/93127, 원본 삭제는 93365다. 삭제 메서드에 S3 파일 삭제 요청은 없다. 조합에서 빼는 동작을 실제 원본 파일 삭제로 해석하지 않는다.

배너는 render 자체 이동/삭제 버튼이 비활성이고 setting 안내가 나온다. 다만 처리 이동 메서드는 인접 대상이 setting인지 검사하지 않아 맨 앞/뒤 content가 배너 index와 교환되는 코드를 포함한다. original 배너 보호 helper는 현재 설정 URL 외 파일명 topimage/bottomimage도 추정한다. **자체 모델은 명시적 역할/보호 상태로 배너를 고정하고 content끼리만 이동**하는 것이 기능 의도에 맞는다. filename 추정·음수 index 교환을 요구로 복제하지 않는다.

현재 root 배열과 map의 index 결합 때문에, 이동 후 original 삭제 또는 통합 PNG 한 장인 root 목록에서 처리 사진을 지울 때 두 자료의 위치가 항상 같은 뜻이라고 볼 수 없다. 또한 마지막 처리 그룹 삭제 후 HTML generator는 빈 배열이면 return하여 예전 HTML이 남을 수 있다. 자체 구현은 사진별 고정 ID·명시적 순서 및 빈 조합 HTML을 사용해 이런 잔존을 막아야 한다.

## 번역/수동 편집: 원본 참조와 현재 결과를 분리

현재 카드의 번역 버튼은 `translateSingleImage(group.url,group.index)` 또는 영문 함수를 호출한다(render 90408/90616 및 원본 fallback 92345/92543). 단일 번역 `[115388,117763)`는 반환 그룹의 index를 원래 위치로 강제하고 map 항목을 **반환 그룹 전체로 교체**한 뒤 HTML을 재생성한다. 이 UI 메서드는 product 서버 저장을 호출하지 않는다.

main 단일 처리 `[466160,472260)`의 대표 결과는 `url=current result`, `originalUrls:[이번 호출의 입력 URL]`, index, requestId, translationData, groupSize:1, lastEdited 및 선택적인 OCR/실패 정보를 가진다. 따라서 originalUrls는 **해당 번역의 입력**이지 언제나 최초 수집 원본이라는 뜻은 아니다. 전체 영문/기본 번역은 root detailImages를 입력으로 돌 수 있으므로 이전 저장이 그 목록을 결과 URL로 바꿨다면 이미 처리된 사진을 새 입력으로 쓸 수도 있다.

`retranslateImage`는 component `[119357,120265)`와 service main `[491676,492329)`에 있다. service는 `originalUrls[0]`이 있으면 그것, 아니면 current url을 기본 단일 번역에 넘긴다. 그러나 현재 detail render에는 `retranslateImage` 참조가 없다. “화면에서 재번역을 누르면 반드시 최초 원본으로 돌아간다”는 실행 주장은 할 수 없다.

실제 처리 사진 편집 버튼은 Step684에서 확정한 `editProcessedGroup [105785,106435)`다. `processType!='original' && group.requestId`일 때 보이고 iframe에 id와 현재 URL prop을 전달한다. 수동 편집 callback `[111813,113270)`는 기존 그룹을 spread하여 url/requestId/lastEdited만 바꾸므로 originalUrls·기존 OCR/번역/실패 상태는 유지된다. 자체 저장 편집 문서는 이 vendor 객체를 우리 작업 성공 증빙으로 삼지 않는다.

기능 재현의 핵심은 **사진 위치를 유지하면서 현재 결과만 명시적으로 교체하고, 다시 편집할 실제 배경/원본과 검토한 편집값을 계속 보관**하는 것이다. 언어·실패·재시도는 실제 자체 작업 증거로 표현한다. 원본과 현재 결과를 URL 일치·파일명·index만으로 추정하지 않는다.

## HTML과 최종 PNG는 서로 다른 자료

`generateDetailHtmlFromProcessed [127674,128968)`는 상단/하단을 분리하고 content를 numeric index 순으로 정렬한다. max-width 800px/padding 20px wrapper에 760px 사진을 넣고 imageMargin을 적용하여 로컬 detailHtml을 **전체 재작성**한다. 순서 이동·처리 삭제·번역·수동 편집이 이 함수를 부른다. 업로드 `[129855,131176)`는 성공한 사진을 root 목록/map에 append하고 product를 await 저장한 다음 HTML 초기화/재생성을 한다.

`saveDetailPage [131264,136334)`는 서로 다른 값을 저장한다.

1. root detailHtml에는 현재 로컬 문자열을 넣는다.
2. processedDetailImages에는 URL 있는 non-setting 그룹을 남긴다.
3. root detailImages에는 현재 그룹들의 비-data URL 및 업로드 성공 URL을 넣는다.
4. **최종 PNG 변환에는 저장한 root HTML을 그대로 쓰지 않는다.** 그룹으로 별도 폭 800px/padding 0 HTML을 만들어 통합 이미지를 만든다. 실패/빈 결과에서는 URL 쉼표 연결 fallback이 있다.
5. 공통/모든 옵션 첫 견적서에 최종 상세 이미지 값을 넣고 견적 상세 HTML은 `''`로 만든다. 일반 저장의 ALT 규칙과 별도 형제 적용의 ALT 보존 규칙은 Step683에 정리했다.

그러므로 root HTML의 보존·미리보기와 견적 최종 PNG의 생성·현재 연결 증거를 하나로 취급하면 안 된다. 수정된 조합에 예전 최종 PNG의 영수증을 그대로 “현재 결과”라고 재사용해서도 안 된다.

**현재 render에는 textarea/direct detailHtml/imageMargin/applyImageMargin 참조가 없다.** HTML 직접 입력 UI가 있다는 근거는 없고, 확인한 것은 compiledHtml 미리보기와 사진 액션을 통한 생성이다. applyImageMargin 메서드 `[109142,109677)`는 존재하지만 현재 버튼/입력과 연결된 근거가 없다. HTML 직접 편집을 자체 추가한다면 이는 독립 기능 정책이며 vendor UI에서 관찰한 동작처럼 표현하지 않는다. 저장된 빈 HTML을 truthiness로 재생성하는 vendor 동작도 수동 공란 보존 요구로 복제하지 않는다.

## 자체 최소 완결 모델 — 재구현 판단

아래는 특정 파일/DB 설계를 확정하는 계약이 아니다. root가 현재 소스와 연결해 결정할 **후속 전체 조합 기능**의 최소 의미 단위다. 아래 전체 기능을 Step685에서 구현/검증했다는 뜻이 아니다.

| 자료 | 반드시 구분할 내용 |
| --- | --- |
| 작업 공간 identity | 버전 format, 소유자/승인 회사, 상품, 카테고리/프로필 scope, revision/updatedAt, 현재 저장 기준 fingerprint. URL/수집 fork를 가족/작업 공간으로 추정하지 않음. |
| 순서 있는 photos | 각 위치의 고정 photoId, 역할(content/top/bottom), 명시적 보호 상태, 실제 원본 또는 작업 배경의 key/SHA/치수, 현재 결과의 key/SHA/치수. 같은 파일을 두 위치에 썼으면 서로 다른 photoId로 순서/삭제를 구분하고 조용히 dedup하지 않음. |
| 사진별 편집 증거 | 자체 검증한 저장 text/style/crop/brush 문서/기록의 참조와 digest. 현재 결과가 그 문서의 결과인지 검증. 과거 job 권한·vendor requestId를 새 대상 권한으로 복제하지 않음. |
| root HTML | 조합으로 생성한 문자열과 final quote HTML/최종 PNG를 분리. 직접 수정 지원 시 generated/manual 같은 명시적 authority와 정확한 문자열(공란 포함) 필요. 사진 변경 때 manual 문자열을 어떻게 처리하는지 명시하고 무단 재작성하지 않음. |
| 최종 출력 연결 | 실제 통합 PNG key/SHA/bytes/치수, 그것을 만든 조합/HTML/레이아웃 버전 digest, 적용 receipt/현재 견적 연결. 편집 후 이전 출력은 유지하되 최신 조합과 일치하는지 구분. |

조합의 개별 사진은 현재 견적 슬롯의 통합 PNG와 다르다. **Step684의 quotationTarget.value/slot에 가짜 개별 사진 목록을 넣어서 편집 API를 재사용하면 안 된다.** 사진 편집은 workspace photoId+revision/fingerprint+현재 resultKey에 결합한 별도 대상과 명시적 채택이 필요하다. 그 채택은 해당 조합의 현재 결과/HTML을 바꾸고, 견적 PNG는 사용자가 최종 재합성/저장을 확인할 때까지 유지한다. 원본 배경에서 저장한 레이어를 다시 그리며 결과 PNG 위에 중복으로 그리지 않는다.

순서/삭제/번역 결과 교체 후 HTML 미리보기가 같은 순서를 나타내고, 저장·재오픈해도 동일한 photoId/원본/결과/편집값이 복원되어야 한다. 상·하단 설정은 저장 당시 snapshot 또는 현재 설정 중 어느 것이 authority인지 명시하고 예전 PNG와 현재 배너가 같은 상태라고 오인하지 않는다. 빈 조합은 편집 가능하더라도 최종 출력 생성/적용을 허용할지는 별도 명시 검증이 필요하다.

작업 공간 저장과 최종 견적 갱신은 각각 explicit action이어야 한다. 현재 회사/카테고리/사진/원문 payload CAS와 실제 소유 파일 바이트를 검증하고, 부분 저장·늦은 응답·불명확한 ACK·다른 상품/옵션·active/version/disabled 전환에서 과거 결과를 채택하지 않는다. 다른 카테고리/ALT/대표·추가 이미지/표시사항/원문/기존 상품을 자동 변경하거나 백필하지 않는다. 파일을 조합에서 빼는 것과 파일 삭제도 분리한다.

## Step685에서 실제로 좁힌 재연결 범위

구현 담당 root는 이 감사 뒤 전체 조합 작업 공간을 한 번에 확장하기보다, **동일 상품의 저장 편집 결과가 재정렬되거나 다른 현재 견적 슬롯에서 선택됐을 때 다시 편집하지 못하는 제한**을 우선 해소하기로 했다. 다음은 자체 구현 계약이며 Couplus에서 관찰한 이름/프로토콜이 아니다. 후속 frozen-source 읽기 검토에서 닫힌 policy, 기존 identity 보존, 현재 target 검증과 freshSource/저장 guard 연결을 확인했으며 추가 결함은 찾지 못했다. 이는 실제 브라우저 동작이나 운영 상품 성공 판정은 아니다.

- 새 명시적 요청 `editor=saved-current-target-v1` 및 `source.editorSource.anchorPolicy='current-target-v1'`에서만 현재 타깃으로 새 증거를 발급한다. 기존 `editor=saved`의 원래 option/role/field/slot 일치 정책과 기존 identity는 유지한다.
- 새 요청도 현재 선택한 result key가 해당 견적의 실제 slot/linked fields에 있고 본인 소유/같은 상품인지 먼저 검증한다. 저장 record/sidecar/결과 PNG의 실제 바이트·SHA·치수 및 원본 배경도 검증한다.
- 같은 상품·회사·category context/profile 안에서만 이전 record의 option/role/field/slot과 다른 **현재 선택 대상**으로 재연결할 수 있다. 다른 상품·같은 URL의 fork/가족·다른 회사·카테고리/프로필로 문서 권한을 복제하지 않는다.
- 과거 quotationTarget/job proof를 재사용하지 않고 현재 revision/fingerprint/정확한 결과 연결에 새로 결합한다. 원본 배경과 편집 문서는 보존하며 이후 명시적 미리보기/저장은 현재 선택한 견적 위치만 대상으로 한다.

이는 현재 실제 견적 슬롯의 편집 결과를 다시 여는 기능이다. 미래 조합 작업 공간에만 있는 가상 photoId를 견적 slot처럼 취급하는 기능이 아니다. 별도 root HTML/전체 사진 순서·삭제의 지속 문서, 조합 변경 후 finalPNG 재생성 등 위의 전체 작업 공간 범위는 후속 잔여로 구분한다. 단순 “다른 슬롯도 허용” 검사를 지우는 방식보다, 새 policy를 닫힌 값으로 검사하고 실제 현재 target + 같은 소유·상품·회사·context + 봉인된 source/result/document 증거를 재확인하는 방식이 필요하다.

## 남은 사실 확인과 검증 기준

vendor 서버의 group 영속 schema, 외부 편집 세션 보존 기간, 숨겨진 route가 legacy 메서드를 호출하는지, root 임의 HTML의 실제 사용자 입력 경로는 미확인이다. 정적 자료만으로 전체 UI/서버 동일 구현을 주장하지 않는다. 자동/수동 번역 실패 후 completed 처리, 일부 즉시 저장과 일부 로컬 변경, 인덱스/배너 교환, 마지막 사진 삭제 후 stale HTML 등은 복제해야 할 기능 요구가 아니다.

자체 기능 확인에는 (1) 서로 다른 원본/번역 결과가 이동 후에도 짝을 유지함, (2) 같은 파일의 중복 위치에서 한 위치만 삭제함, (3) 보호 배너 고정과 일반 사진 이동, (4) 사진 교체가 해당 조합만 바꿈, (5) root HTML과 견적 HTML/PNG의 별도 상태 및 수동 공란 보존, (6) 저장/재오픈/응답 유실에서 정확한 조합 복원, (7) 기존 상품·원문·다른 scope 불변을 포함하는 것이 적절하다. 이는 권고 검증 목록이며 이 감사에서 실행한 제품 검사 결과는 아니다.

이 조사에서 새 런타임·브라우저·프로세스·MCP 세션을 열지 않았으며 정리할 소유 자원은 없다.
