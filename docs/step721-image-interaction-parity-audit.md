# Step721 — 대표·추가·상세 사진의 선택·편집·저장 상호작용 대조

2026-10-19. 보관된 shipped JavaScript를 REA 6.4로 정적 확인하고, 자체 React 소스와 연결했다. 기존 Couplus/1688/Supplier Hub 상품·브라우저·외부 iframe/provider·운영 자료는 열거나 변경하지 않았다. 아래 원본 관찰은 클라이언트 정적 구문이며 실제 클릭·번역·원격 저장 성공의 관찰이 아니다. 마케팅 페이지의 자동화/성공률은 실행 근거로 사용하지 않았다.

## 결론

crop·사진 삭제·순서 이동·번역/수동 편집·대표 전체 화면·상세 작업 구성은 이미 자체 구현에 있다. 이번 좁은 대조에서 확인한 실제 UI 차이는 **5단계 사진 편집이 원본에서는 중앙 큰 모달, 자체에서는 화면 아래 inline 편집기**였다는 점이다. 3·4단계 원본은 inline right editor이므로 이 두 단계까지 모달로 바꾸지 않는다.

원본의 일부 선택/삭제/순서 변경은 곧바로 문서를 갱신하지만 자체는 수동 초안과 명시 저장을 분리한다. 이는 기능 부재와 구별할 의도적인 저장 정책 차이다. 원본의 느슨한 완료 판단·이전 URL timeout fallback·배너 index 결함까지 복제하는 요구로 해석하지 않는다.

## 근거·새 분석 범위

- `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`: 553,312 bytes, SHA256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`.
- 같은 폴더 `main.a20c7114.js`: SHA256 `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`. 기존 helper 분석을 다시 실행하지 않았다.
- Step675 대표 확대 parent `ev_f212771bf00c7a08d98f8a961c3c8d31f59ace3877c40d19fbb9a13334646111`; Step676 추가/상세 `ev_782e7a89a96a33a05f38b2d977a5ee4001676f0891cc87373d600c7252192396`, headers `ev_8ec3fd01351174fefebdc0fccae8f936ebf1c20201f4c59c76aff551e848ec3c`; Step684 iframe `ev_6373190d88287217f0a505c6e86baff55ba4c1447b792b744463771033bf7809`를 기존 문서/정확한 source manifest로 재사용했다. 현재 연결의 retained 조회에는 이 과거 parent들이 없었으며, 이를 새로 생성했다고 표시하지 않는다.
- 새 미확인 질문인 Stage3 초기 복원/후보/옵션 후보 공유/결과 저장 8개 메서드만 inert carrier로 선택했다. REA parent `ev_2046d80e3b81001a7dfdc36e9ade00f4f120ef1451c2844294fdfcc737233f21`, summary `ev_e71c9d9a51d64d1b9993aeb62432262a532ea7d00ccbe1ca40ef41d59e5ea156`. 1파일 14,107 bytes, AST 2,981개, parse 실패0, semantic unknown618. 원문을 실행하지 않았다.
- carrier `outputs/step721-original-selected/mainImageInteractions.js` SHA256 `15eb4bfc8039d8fe570e7778ebc7f9ce5610905e09d52b3254fc0795ae71108f`, derived directory SHA256 `9a11e308a19b71d9d2ccc35c005c9e9847930c768e02b6071703359be936c41f`.
- `outputs/step721-original-manifest.json`에 새 exact method/render 원문·UTF-16/UTF-8 범위·raw SHA를 보관했다. SHA256 `931e06d32fc2b10818ee7b08d27edd5222385fd728052e48bfbe58b8d927d0ae`.
- 새 session portable bundle `outputs/step721-original-evidence-bundle.json`: 16,639,638 bytes/34 records, SHA256 `6c5511cefc4b7a98c5b8fa193b001e21dde48c173d683a5f46887948a0143f31`. 다른 보존 기록도 포함하므로 34개를 이번 새 분석으로 세지 않는다.

이하 범위는 chunk UTF-16/끝 제외다. render 조각은 source-bound 직접 AST 선택이며 새 8method producer의 분석 대상과 구분한다.

| 새 선택 | 범위 | raw SHA256 |
| --- | --- | --- |
| initializeMainImageData | [41936,43813) | ff9b312f48bb7f9c7eb903e77ca692ccf32086b7e9ed94404b65d24f6a2e2a9a |
| selectImage | [43895,45181) | 3f75c1a6319d16ba120113a6994ccdea09aeab549d337f2bed51681efaa21de5 |
| selectProcessedImage | [45182,46281) | b3595783d5114ec846b0f28291a37d69df4808dd206883fa7b521eb67646599a |
| applyResize | [48052,48766) | 8f6da2a70c6b61d6f535c2e792afd53d8e69972b0a4aa8eb2b3d50e94135616f |
| loadOptionImages | [48767,50981) | b50df4f6c8015e465e6c828ea787862b3691cfd749f44e1f4c53fa05deae50c3 |
| handleEditorImageEdited | [50982,53181) | 1766a936581b4e54c5dd53959ecd7160d3ae177d6c9ecdbcf69e2d80867f0fae |
| updateProcessedImage | [54269,57274) | c7cb107d74abc733d237759c8da1717f2111dd53b76b649adb7b2c0bc53ce8c6 |
| resetEditor | [57476,57750) | 25203e69b9002bbf65aa7d35740ed0f055a6d355a605708888e5f47741be5c72 |
| Stage3 inline ImageEditor | [34958,35277) | 9701d64b759707aa53e496ceb6674e1ee64a3c8dd2b8a06fbfb76512b1447b01 |
| Stage4 inline ImageEditor | [69919,70244) | 93b1bc66aa9309f6a6948f29673c623d42b14d18c50503e96a7cf5ed196076b2 |
| Stage5 이미지 편집 b-modal | [94232,94664) | d296f82de2872851fb66b13400d5019d8522ad93f0ddac4b99bf3d6fccfc6603 |

## 한정된 상호작용 체크리스트와 자체 연결

| 질문 | 원본에서 확인한 동작 | 현재 자체 연결/판정 |
| --- | --- | --- |
| Stage3 후보 종류 | 작업/메인/옵션/상세 4탭 [30511,30980). loadOptionImages는 모든 옵션의 option1/2 이미지와 mainImageStatus를 URL로 dedup해 후보로 모음. 처리 후보 우선 탭. | `OptionMainImageEditor` + `main-image-library.ts` 4탭 존재. 자체는 소유 파일·저장된 역할/옵션 자료를 분류하므로 모든 원본 갤러리 분류와 같다고 주장하지 않음. |
| Stage3 선택·복원 | 현재 옵션 processedImage 우선, 없으면 image; requestId 없다고 자동 번역 호출하지 않음. 후보를 누르면 현재 옵션을 갱신. requestId 있는 option 후보 분기는 updateOptionImage 후 일찍 return하고 일반 분기는 별도 doc partial도 호출. | 옵션 대상 최종 대표 선택·명시 저장/조회 존재. 현재 옵션만 바꾸며 다른 옵션의 후보를 선택하는 것과 모든 옵션 덮어쓰기를 구별. 원본의 조건별 즉시 저장은 자체 초안 정책과 다름. |
| 대표 전체 화면 | 현재 URI 그대로 확대, 배경/이미지/닫기·Escape로 닫음. 확대만으로 이미지나 문서 저장 안 함. [61729,61803), [62832,62919), overlay [36080,36483). | `ImageFullscreenPreview`와 최종 대표 버튼에 구현. focus/Tab/세대 무효화는 자체 보호 추가. 자동 carousel/좌우키 탐색의 근거 없음. |
| resize/crop | applyResize는 Canvas stretch→JPEG .9→현재 옵션 update. 그러나 확인한 Stage3 render [30000,37004)에 resizeWidth/resizeHeight/applyResize control 연결은 없음. 외부 iframe 내부 crop는 미확인. | `ProductContentEditor`의 수동 크기/회전/뒤집기와 `FreeImageTranslationPanel`+`FreeImageCropCanvas` crop 존재. resize 메서드 선언만으로 똑같은 원본 toolbar UI를 확정하지 않음. |
| Stage3/4 편집 | 원본은 오른쪽 inline `ImageEditor`, requestId로 외부 iframe 세션을 선택. Stage4 openEditor는 id 없으면 먼저 AI 처리 안내. | 수동/OCR/번역/brush/crop/문구·스타일 저장을 자체 패널에서 제공. Stage3/4 inline 유지. provider의 내부 도구/픽셀/세션 복원 동일성은 미확인. |
| Stage4 추가 선택/순서 | processedImages 중 textRemoved===true가 저장 후보. 두 draggable 목록, ↑↓, 선택 삭제가 있음. getter/setter와 full index의 차이는 기존 Step675/676 범위를 유지. | `OptionImageEditor(stage='additional')` 후보 체크/큰 보기/선택 strip/drag/↑↓/삭제/ZIP/저장 존재. key 기반 순서를 사용. 원본의 textRemoved 플래그를 실제 번역 성공 증거로 승격하지 않음. |
| Stage4 삭제·저장 시점 | removeImage [78360,78715)는 confirm 뒤 목록 제거·doc update. drag [76403,77356), ↑↓ [77521,78359)도 doc update. saveAdditionalImages는 명시 버튼이지만 유일한 쓰기 경계는 아님. | 자체 삭제/drag는 옵션 로컬 초안이며 명시 저장. 파일을 R2에서 지우는 동작 아님. 원본 confirm과 즉시 저장은 UX/정책 차이로 기록하되 안전한 초안 보존을 깨뜨리지 않음. |
| Stage4 키보드/preview | handleKeyDown [84121,84200)는 isPreviewMode의 Escape만 처리. preview branch는 있으나 확인한 실제 진입 버튼이 없음. | 좌우키/자동 slide/fullscreen 진입을 임의로 필수 기능으로 추가하지 않음. 현재 큰 후보 미리보기 제공. |
| Stage5 사진 toolbar | 본문 ↑↓·삭제·번역/영문 번역/조건부 편집. 설정 배너의 이동/삭제/번역 controls는 막음. 원본 자세한 caller/배너 index 문제는 Step684/685. | `OptionImageEditor(stage='detail')` 및 `DetailWorkspacePanel` 사진별 도구·보호 역할·고정 photoId 존재. 파일명/음수 index로 권한을 추정하지 않음. |
| Stage5 hover Delete | hovered index가 setting 아니면 processType별 deleteOriginalImage/deleteImage. 두 삭제는 confirm. [103652,103895). | 현재 옵션 상세 hover Delete와 입력/IME/수정키/저장 중 방어 존재. 원본 원본삭제 즉시 저장과 처리삭제 로컬 변경의 차이는 자체 명시 저장으로 구분. |
| Stage5 편집 모달 | 실제 `editProcessedGroup` [105785,106435)→showEditor. render [94232,94664)는 xl·중앙·hide-footer·title='이미지 편집' b-modal. | 이번에 `DetailImageEditDialog`로 최종 상세 사진과 workspace 사진을 연결. 큰 중앙 모달/닫기/focus/Tab/Escape를 제공하며 내부 편집기와 저장 경계는 유지. |
| 옵션 공유/최종 상세 저장 | 원본 saveDetailPage [131264,136334)는 현재 그룹을 별도 폭800·여백0 이미지로 만들고 공통/전체 옵션에 적용. 별도 형제 상품 선택 적용도 존재. | 기존 workspace 최종 합치기/전체 옵션 명시 저장·형제 적용 패널과 연결. 개별 옵션 초안 저장/작업 문서 보관/전체 최종 적용을 하나의 저장으로 혼동하지 않음. |
| 닫기와 원본/편집 보존 | iframe 메시지/5초 timeout의 이전 URL도 편집 완료 event가 될 수 있음. 정적 클라이언트만으로 새 파일/영속 성공을 확정할 수 없음. | 자체 실제 저장 ACK·원본/current/document·정확한 slot/photoId·version guard 유지. 미저장/진행/응답 불명 상태에서 모달을 닫아 초안을 잃지 않도록 기존 close guard를 연결. |

## 수정 전 재현과 이번 구현 경계

`outputs/step721-original-prechange-reproduce.json`은 변경 전 자체 `DetailPanel`을 transpile한 VM에서 실제 Stage5 카드 onEdit를 호출했다. sourceKey/정확한 quotationTarget/intent='manual'은 공용 편집기 props에 도달했지만 dialogCount=0이었다. HTTP0. 당시 dashboard SHA256 `5f8b53b6bd7bcd6626a54212b15646060c62df5ec263f662eb5a86a468f22762`; proof SHA256 `a3645c7613a3517462539fa866e47a3b30f2f9c3230b433dd6b39b35e612ec71`. 자식 component는 확장하지 않았고 DOM/실제 React state 유지의 증거로 사용하지 않는다. 첫 selector가 default import 이름을 놓친 harness 결과도 별도 `...harness-miss.json`에 보존했다.

전용 dialog wrapper는 항상 같은 child 위치를 유지하며 portal이나 open 조건으로 공용 편집기를 교체하지 않는다. Stage5 공통 detailTop/detail/detailBottom 번역과 최종 옵션 사진 편집을 같은 모달로 연다. workspace 사진은 기존 editor branch의 생명주기를 유지한다. 바깥 형제/단계/버튼은 inert로 막고 기존 workspace busy marker도 남긴다. 마커에 `data-free-image-editor`를 사용해 원래 자기 편집기를 제외하던 최종 적용 검사가 자신의 모달에 막히지 않게 한다. 기본 전체 dirty 탐색은 자식 초안을 계속 찾는다.

close button/배경/Escape는 기존 live dirty/busy/pending/불명 저장 guard를 확인한다. 같은 틱 두 번째 카드 진입은 open ref로 거절한다. 새 source/option/version에서는 오래된 close callback을 거절하며 기존 source/편집 문서/PNG/저장 request를 새 대상으로 바꾸지 않는다. 대표·추가 단계는 inline 표현을 유지한다. 원격 API/견적 schema/전송·receipt/확장·OCR worker는 수정하지 않았다.

## 검사 범위와 남은 unknown

새 전용 unit+연결 **15/15** 검사 통과(`outputs/step721-original-dialog-focused-final.log`). modal unit은 명시한 DOM adapter의 focus/Tab/Escape/배경·inert 복원/동일 node를 검사한다. DetailPanel integration은 실제 부모 render/callback을 쓰지만 자식 component를 stub하므로 **child type/props 유지**까지만 입증한다. 같은 child 위치는 소스 구조로 확인한 것이며 실제 React 내부 OCR/편집 state 지속이나 브라우저 pixel 검증으로 확대하지 않는다. workspace 연결은 기존 실제 구성 client fixture와 guard를 사용한다.

변경 앱에 대한 관련6파일 aggregate **99/99** 통과(`...dialog-related-final.log`); 여기에는 추가 전 새9case가 포함돼 있으므로 최종15개와 더해114개라고 세지 않는다. 그 aggregate 이후 추가6case는 위 최종15개에 포함한다. 최종 scoped lint 0, TypeScript 검사 0. root의 독립 검토/실제 React 로컬 화면 검수는 별도 결과를 따른다.

원본 외부 iframe 내부 crop/brush/text toolbar·키보드·원본 복원·보관 기간/요금·실제 runtime CSS·provider 및 서버 transaction은 미확인이다. 원본 preview의 숨은 동적 caller도 unknown이다. 이번 변경을 전체 Couplus 동일 구현, 실상품 1688 수집 또는 Supplier Hub 접수 완료로 표시하지 않는다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`를 유지한다. static 분석만 했으므로 연 소유 브라우저/REA 실행 세션은 없고 테스트 프로세스는 종료했다.
