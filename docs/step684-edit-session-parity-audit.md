# Step684 — 상세 처리 그룹 재편집 세션의 좁은 정적 대조

2026-10-15. 보관된 Couplus JavaScript만 확인했다. 브라우저·외부 iframe·Couplus·Supplier Hub·1688/API에 접근하지 않았고 기존 상품/구현/DB는 변경하지 않았다. Step683의 저장·load·전체 번역 조사와 Evidence를 재사용하고, 빠져 있던 **ImageEditor bridge와 실제 편집 버튼 caller**만 좁게 추가 확인했다. 관찰은 정적 클라이언트 코드이며 외부 서버의 실행·영속 성공을 뜻하지 않는다.

## 근거

- 원본 `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`: SHA256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`, 553,312 bytes.
- 재사용 source/service: `main.a20c7114.js`: SHA256 `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`. Step683 report/manifest는 `docs/step683-detail-editor-parity-audit.md`와 `outputs/step683-detail-editor-audit-inventory.json`.
- 기존 save/shape Evidence: `ev_782e7a89a96a33a05f38b2d977a5ee4001676f0891cc87373d600c7252192396`; 형제 적용 parent `ev_9ba78b705b9c68a727604eaf0bebe7f726bbbe8fea6c6d38d50ac77d2b88e1ba`.
- 새 좁은 REA parent `ev_6373190d88287217f0a505c6e86baff55ba4c1447b792b744463771033bf7809`, summary `ev_c9c4ef6a6c24aba3f82a41d2f2c85fec2b199086d3d4eb432d17bd4a702a5170`. 기존 분석에 없던 e64e factory 하나만 inert 분석했다. 파일 1개/4,780 bytes, 파싱 실패 0, semantic unknown 221; 동적 도달·provider 성공은 확정하지 않는다.
- factory 원문 UTF-16 `[496888,501157)`, UTF-8 `[548469,553210)`, slice SHA256 `394455cadcdc457c6bed7ded780ec90082066ddc8a3984ddcba4bf9c486ac202`. inert wrapper 파일 SHA256 `bd6e6907a51cf81251297100c6f4d3c4dceae60287678b33cbb219b8bf0be892`, derived directory SHA256 `5546380150730c5b76fc2302dd34c9344e35c646472894ada0a9bee449f935b2`.
- exact slices/digests는 `outputs/step684-edit-session-audit-manifest.json`, 생성기는 `step684-edit-session-audit-inspect.mjs`, portable Evidence는 `step684-edit-session-audit-evidence.json`이다. 이하 offset은 UTF-16/끝 제외다.

## 실제 버튼은 editProcessedGroup

**관찰:** 상세 render `[90000,90780)`의 hover toolbar는 설정 배너에는 편집 도구 대신 설정 안내를 표시한다. 일반 그룹에서는 **`processType !== 'original' && group.requestId`가 truthy**일 때 `편집하기`를 표시하고 `editProcessedGroup(arrayIndex)`를 호출한다. 그 외에는 중국어→한국어/영어→한국어 번역 버튼이다. 실패 여부/isTranslated/ocrInfo는 편집 버튼 노출 조건이 아니다. 번역 실패 그룹도 requestId가 있으면 편집 버튼이 보일 수 있다.

`editProcessedGroup [105785,106435)`는 현재 그룹/편집 배열 index를 설정하고 id를 다음 순서로 고른다.

1. `group.requestId`.
2. 그것이 없고 translationData가 있으면 `translationData.requestId || translationData.RequestId || translationData.Data?.RequestId || ''`.
3. id가 없으면 “편집에 필요한 정보가 없습니다. AI 처리를 다시 시도해주세요.” 안내 후 열지 않는다.

찾은 id와 현재 group.url을 editorRequestId/editorImageUrl에 넣고 modal을 연다. 다만 render 자체가 group.requestId를 요구하므로 **translationData에만 id가 있는 그룹은 이 메서드의 fallback이 가능해도 화면의 편집 버튼은 나타나지 않는다.** `translationData` 전체나 `ocrInfo`를 child 편집기에 넘기지 않는다.

Step683에 존재만 기록한 `openEditor [108282,109141)`는 이 detail render에서 호출되지 않는다. `editProcessedImage [109828,110067)`→`handleImageWithoutRequestId [110068,110791)`도 별도 대체 메서드로, id 없으면 translateImage(group.url)에서 id를 받아 열지만 이름의 render 참조가 없다. 이 대체 경로를 실제 버튼 흐름으로 단정하지 않는다. **조사 중 초기 메시지의 “실제 버튼은 openEditor”라는 진술은 이 직접 caller 확인으로 정정한다.**

## child는 외부 iframe bridge

원본 e64e `ImageEditor`의 props는 `requestId`, `imageUrl`, `imageType`(기본 main)이고 detail은 imageType='detail'을 전달한다. 내부 로컬 상태는 loading/message/timer뿐이다. 텍스트 박스·번역문·폰트·색상·crop·brush의 편집 문서는 이 component에 없다.

| 경계 | 정적 관찰 |
| --- | --- |
| `getEditorUrl [500128,500291)` | `https://www.xiangjifanyi.com/image-editor/#/?enableCustomOCR=1&lang=KOR&logo=hidden&hideGuide=1&isCompareMode=false&t=<Date.now()>`를 반환한다. 이 URL을 열거나 확인하지 않았다. |
| `onIframeLoad [497989,498455)` | iframe과 truthy requestId가 있으면 `{name:'XJ_IMAGE_EDITOR_REQUESTIDS',requestIds:[requestId]}`를 해당 origin으로 postMessage한다. imageUrl/OCR/translationData는 보내지 않는다. id 없으면 loading만 숨긴다. |
| `resetEditor [499607,500127)` | truthy requestId가 있을 때 iframe src의 `?` 앞부분에 cache 시각을 붙여 다시 load한다. 자체 편집 문서를 복원하는 함수는 아니다. |
| `handleEditorMessage [498456,499575)` | `data.name==='XJ_IMAGE_EDITOR_URL' || data.url`이면 결과 URL event를 내보낸다. `XJ_SAVE_CLICKED` 또는 action='save'이면 saveImage 호출. |
| `saveImage [500292,501061)` | `{name:'XJ_SAVE_IMAGE'}`를 iframe에 보내고 5초 timeout을 둔다. 새 응답이 없으면 truthy requestId일 때 **이전 imageUrl을 image-edited event로 내보낸다.** |

**추론:** requestId를 통해 외부 편집 세션을 다시 여는 의도다. 외부 서비스가 텍스트·스타일·원본·편집 이력을 어떻게 저장하고 얼마나 오래 유지하는지는 이 shipped bridge로 알 수 없다. server-side session 복원 성공, provider 권한/요금/만료, 실제 crop/brush 지원 여부와 저장 schema는 미확인이다. child의 imageUrl prop는 결과 fallback에 쓰이며 초기 이미지 입력으로 iframe에 전달되는 코드는 이 factory에 없다.

수신 message handler는 origin을 로그로 남기지만 origin/source를 거부하는 분기를 확인하지 못했다. 이는 외부 메시지 검증을 생략해도 된다는 재구현 요구가 아니다. 자체 구현은 해당 bridge의 느슨함이나 timeout fallback을 성공 판정으로 복제하지 않는다. mounted는 window message listener와 loading 타이머를 등록하고 beforeDestroy는 주 listener/일부 타이머를 제거한다. 실제 외부 페이지의 수신/응답은 미관찰이다.

## 편집 event와 부모의 보존·갱신 범위

일반 message에서 child가 내보내는 값은 아래 형태다. URL은 `data.url || data.result?.url || imageUrl`이고 requestId는 **기존 prop**다.

```text
{ requestId: oldProp, imageUrl: chosenUrl, result: rawMessage,
  url: chosenUrl, msgId: localDiagnosticId }
```

timeout fallback도 old requestId/old imageUrl로 비슷한 event를 만든다. 새 URL·새 편집·새 파일이 생겼다는 보증이 아니다. 부모 `handleEditorImageEdited [111813,113270)`는 다음을 처리한다.

- URL: event.url 우선. 없으면 event.Data의 SslTranslateUrl/TranslateUrl, 이어 SslRmUrl/RmUrl. 없으면 이전 group.url.
- id: event.requestId || 현재 editorRequestId. 둘 다 없을 때만 event.RequestId를 추가 fallback한다. 일반 bridge는 old requestId를 보내므로 raw result 안의 새 id를 자동 채택하는 구조가 아니다.
- 기존 그룹을 shallow spread하고 **url, requestId, lastEdited**만 갱신하여 기존 group.index로 processedGroupsMap에 넣는다.
- 현재 detailHtml에 이전 URL이 있으면 literal URL을 정규식 escape하여 치환한다. editor 선택을 reset하고 local lastModifiedDate를 갱신한 뒤 그룹으로 HTML을 다시 만든다.

| 그룹 속성 | 편집 event 후 |
| --- | --- |
| index/originalUrls/processType/groupSize | 기존 값 유지 |
| translationData/ocrInfo | 기존 값 유지; raw result나 새 텍스트/스타일로 교체하지 않음 |
| isTranslated/isBase64/translationFailed/failReason | 기존 값 유지; 수동 편집 성공으로 정정하지 않음 |
| 임의의 그 외 metadata | spread로 유지 |
| rawMessage/result/msgId | 새 그룹 필드로 저장하지 않음 |
| url/requestId/lastEdited | 위 선택 규칙으로 갱신 |

이 callback 자체에는 updateRocketProduct/서버 쓰기가 없다. 최종 일반 상세 저장 `saveDetailPage [131264,136334)`에서 URL 있는 non-setting 그룹 전체를 processedDetailImages로 저장한다. 따라서 편집 URL과 예전 OCR/번역 상태가 함께 영속화될 수 있다. 부모의 closeEditor/saveAndCloseEditor 대체 메서드가 참조하는 isEditorReady/getEditResult는 이 retained child에서 정의되지 않았고, 이 두 caller도 실제 detail render에 직접 연결된 근거가 없다. 정상 버튼의 bridge event 경로와 혼동하지 않는다.

## 원본 재사용과 재번역의 구분

Step683의 `main retranslateImage [491676,492329)`는 group.originalUrls의 첫 항목이 있으면 그것, 없으면 현재 url을 기본 단일 번역 함수에 넘긴다. 수동 편집 callback은 originalUrls를 바꾸지 않으므로 **수동 결과 URL과 재번역 원본은 다를 수 있다.** 여러 originalUrls 중 첫 장만 고르며, 그룹의 OCR 박스나 편집된 문구를 재번역 입력으로 넘기는 구조가 아니다. imageGroups의 5개 화면 묶기와 단일 결과 groupSize:1도 별개다.

일반 저장은 processedDetailImages를 남기고 created 시 index map으로 복원하므로 기존 id가 유지된다면 편집 세션을 다시 여는 의도가 이어진다. originDetailImages는 조회 때 현재 detailImages에서 재생성될 수 있어 이 재편집의 확실한 원본 증거가 아니다. URL/id의 server 영속성과 보관 기간은 미확인이다.

## 자체 text/style/crop/brush 저장의 좁은 기능 목표

다음은 **재구현 판단**이며 Couplus의 숨은 server schema 복원이 아니다. 현재 자체 FreeImageRegion에는 원문/번역문/box/선택/translationProvenance/색/크기/스타일/erase/brush가 있고 crop은 별도 원본 좌표다. 이를 다시 편집할 수 있도록 저장하되, PNG와 편집 명령을 분리한다.

1. 원본 배경 파일의 소유 key/SHA/치수와 실제 적용 결과 파일의 key/SHA/치수를 구분해 저장한다. source를 결과 PNG로 바꿔 문구/brush를 다시 적용하면 이중 렌더가 된다.
2. 실제 검토한 region 순서, 원문/사용자 번역문, box, 선택, erase, 텍스트 style, brush 경로/지름/색, crop을 검증된 버전 문서로 보존한다. 현재 런타임의 File/Blob/objectURL/AbortController/진행 상태는 편집 문서가 아니다.
3. 상품·회사/소유자·역할과 정확한 옵션/필드/슬롯·현재 결과 연결을 묶는다. 다시 열 때 원본과 결과 바이트를 읽어 확인하고, 현재 결과 슬롯이 바뀌었으면 과거 문서를 자동 채택하지 않는다. 새 버전의 source/quotation binding을 재검증한다.
4. 과거 FreeImageSource/quotationTarget의 job proof·vendor requestId/OCR 객체를 새 apply 권한으로 복사하지 않는다. 생성 번역 provenance는 검토용 출처와 실제 서버 작업 증빙을 구분하며, 저장한 문자열만으로 새로운 생성 성공을 주장하지 않는다.
5. 다시 열기는 초안 복원이고 쓰기는 기존 명시적 미리보기·적용 확인 후에만 수행한다. 취소/유실·stale 응답·다른 상품/옵션/회사·active/version/disabled ABA가 현재 초안이나 견적을 바꾸지 않아야 한다. 없는 legacy 문서는 현재 이미지를 보며 새 편집을 시작할 수 있는 기존 흐름을 유지한다.

완료 기준은 “현재 적용된 결과가 맞는 이미지에서, 저장한 원본 배경과 같은 순서의 편집값을 복원하여 같은 미리보기를 만들고, 재검토 후 한 번 적용할 수 있음”이다. Couplus provider의 전체 편집기/번역 세션과 같다는 완료 주장은 하지 않는다. 기존 사용자 상품의 자동 백필·OCR 재실행·수집 원문 교체·자동 형제 전파는 이 목표에 포함하지 않는다.

`outputs/step684-edit-session-audit-fixtures.json`에는 source-bound 합성 반례를 보관했다. 실제 vendor 실행 자료는 아니다. 이 조사에서 소유한 네이티브/브라우저/REA runtime 세션·프로세스는 없으며 종료할 자원도 없다.
