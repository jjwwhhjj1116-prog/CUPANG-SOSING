# Step716 — 기본설정 공통 이미지의 선택·저장 경계

기준 HEAD는 `9f0cdaa`다. 이 조사자는 보관된 Couplus artifact와 기존 REA 자료만 읽었다. 앱·테스트·계정·원본 설정·작업 상품을 수정하지 않았고 브라우저·네트워크·vendor 코드도 실행하지 않았다. 새 분석은 아직 답이 없던 **상·하단 공통 이미지 입력 14개 메서드**로 제한했다. 기존 Step668의 설정 초기화·저장·번역 조건 분석, Step689/690의 상세 합성 배너 적용, Step698의 가격 재계산을 다시 조사한 결과로 세지 않는다.

## 우선 수정할 차이

원본의 이미지 선택은 로컬 초안이다. `handleTopImageSelect`·`handleTopImageDrop`·`handleTopImagePaste`는 같은 `processTopImage(File)`로 모인다. 하단도 대칭이다. 해당 메서드는 JPG/JPEG/PNG/GIF 확장자를 확인하고 File, `URL.createObjectURL(File)` 미리보기와 FileReader data URL을 준비한다. `imagesToUpload.top/bottom`에는 File·data·회사코드 기반 filename·contentType·type을 보관한다. 이 단계에서 업로드 action이나 설정 API를 호출하지 않는다. 표시 안내도 저장 시 업로드된다는 의미다.

반면 조사 시작 시 자체 `WorkspaceSettingsEditor.uploadBanner`는 파일 선택 직후 `POST /api/files`를 호출하고, 응답 key를 받으면 top/bottom 사용 스위치도 true로 바꿨다. 뒤에 취소해도 그 파일 전송은 이미 발생한다. 이는 확인된 구체적 저장 경계 차이다. 당시 자체 파일 SHA256은 `e683f8629a8d66ed67d2c6ae85b896886e8488e9ca015a9ea83669d5f5eb8ae4`다. 이 해시는 구현 담당자가 이후 수정한 최종 소스를 뜻하지 않는다.

두 번째 차이는 동일한 이미지 입력 과정의 조작이다. 원본 빈 이미지 영역의 render에는 click·drop·paste가 연결돼 있고, 기존 미리보기와 `이미지 변경` 버튼으로 같은 file input을 연다. `삭제`는 이미지 초안을 지우는 동작이며 `useTopImage/useBottomImage`를 false로 쓰지 않는다. 조사 시작 시 자체는 file input만 제공했고 `선택 해제`가 key와 사용 스위치를 함께 비웠다. 원본 process 메서드도 사용 스위치를 자동으로 true로 바꾸지 않는다. 따라서 **사용 여부와 선택한 파일을 독립적인 초안으로 유지**하는 것이 이 범위의 재구성 근거다.

## 원본 저장의 정확한 입출력

기존 Step668에서 보존한 `initializeSettings`는 store의 defaultSettings를 recursive deep clone한다. `saveSettings`는 pending top/bottom 이미지가 있으면 차례로 `uploadImageToS3(data, filename, type)`를 호출하고, URL을 받았을 때 settingsData의 해당 URL을 바꾼다. 이 helper는 store action `uploadImageToS3`에 `{imageData, filename, type}`을 전달하며 `imageUrl` 속성 또는 문자열 응답을 URL로 소비한다. 실제 private backend와 저장소 계약은 이 helper만으로 알 수 없다.

이후 `POST /api/savesetting`의 입력은 `{defaultSettings: settingsData, geminiAPIKey, geminiModel}`다. 응답 `data.success`가 참일 때만 store commit, File/preview/pending 초기화, 성공 안내, `showSettings=false`와 `settings-saved` emit이 실행된다. 응답 실패와 catch에서는 실패 안내를 표시하며 성공 commit·닫기·pending 초기화는 실행하지 않는다. finally는 `imageUploading=false`로 복구한다. 이 관찰은 source 분기이며 실제 서버 저장을 실행한 증거가 아니다.

원본 `showSettings` computed setter는 `input` emit을 사용한다. 이 컴포넌트의 methods 목록에는 별도의 cancel/reset/default-apply 메서드가 없다. 추가로 읽은 부모 `toggleSettings` `[352367,352421)`는 boolean 반전만 하며 부모 render도 해당 컴포넌트를 조건 없이 배치한다. 설정 본체는 `b-collapse`에 showSettings를 전달하고 초기화는 created에서 호출한다. 검토한 source 안에는 닫기·재열기 때 이미지 초안을 명시적으로 폐기하는 분기가 없다. 다만 캡처하지 않은 프레임워크 lifecycle까지 실행 검증한 것은 아니므로 재열기 결과 전체를 확정하지 않는다. 자체 취소에서 미저장 파일을 폐기하고 object URL을 해제하는 것은 자체 자원 관리 설계이며 원본이 같은 cleanup을 한다는 주장이 아니다.

## 그대로 복사하지 않을 원본의 약한 분기

- `uploadImageToS3`가 null을 반환하면 원본 save는 오류 로그만 남기고 다음 설정 API로 진행할 수 있다. 업로드와 설정 저장의 원자성은 확보됐다고 볼 수 없다. 자체에서는 업로드 실패 시 저장을 중단하고 초안을 보존하는 경계를 권한다.
- `isSettingsEqual`은 비교 전에 양쪽의 topImageUrl/bottomImageUrl을 삭제한다. pending 이미지가 없고 URL만 삭제된 경우 다른 변경이 없으면 save가 API 없이 닫히는 조건이 성립한다. 이를 정상적인 삭제 저장 완료의 증거로 삼지 않는다.
- `removeTop/BottomImage`는 File·preview를 먼저 비우지만 pending 비우기는 기존 저장 URL이 truthy인 블록 안에 있다. 새 pending 파일만 있는 경우까지 완전한 삭제 동작이라고 확대하지 않는다.

자체에서는 명시적 이미지 삭제 intent를 추적하고 사용 토글은 보존하며, 미리보기 선택·취소에는 서버 쓰기를 만들지 않는 방향이 일관된다. 원본의 확인된 로컬 선택→명시 저장 패턴을 맞추는 작업과 위 약한 분기를 그대로 복제하는 작업은 구분한다. 기존 저장 상품의 이미지·가격·카테고리를 다시 쓰는 변경은 필요하지 않다.

## 이번에 바꾸지 않는 범위

원본 `AI 서버 자동 처리`는 안내 render이며 이 영역에 별도 켜기/끄기 모델이 없다. 해당 문구만으로 본 앱에 동일한 private AI backend가 연결됐다고 표시할 수 없다. 비노출속성 checkbox는 실제 boolean 설정과 연결돼 있으나 초기 컴포넌트 default와 현재 계정의 저장값은 다르다. 사용자별 저장값을 원본 초기값으로 덮어쓰지 않는다. 번역 OFF 때 프롬프트·카피라이트 값을 보존하는 조건은 Step668에서 이미 처리했다. 자체 가격 preset 버튼을 원본의 범용 기본값 복구 버튼으로 부르지도 않는다. 이번 이미지 조사로 환율 서비스·금액 계산 전부 또는 모든 설정 동일구현을 선언하지 않는다.

## 추가 질문 — 초기 최소마진 ON·0 상태 전달

별도의 좁은 질문으로 신규 초안이 기본설정의 최소마진 선택 상태를 잃는지 확인했다. `createProductObject`와 `runInitialProcessing` 자체에는 pricingInfo 필드가 없다. 후자는 `executeSingleTask`의 pricing 작업자를 호출한다. main bundle `getDefaultPricingInfo` `[162503,162637)`는 store 기본설정을 `pricingPolicy.resolve`로 전달한다. `resolve` `[294733,295561)`는 boolean `enableMinSupplyMargin`과 금액 `minSupplyMarginAmount`를 분리하며, 금액 fallback은 undefined/null/빈 문자열만 처리하므로 **true와 0이 함께 보존**된다.

초기 작업자의 `calculatePricing` `[163184,165093)`는 반환 객체에 `info:t`를 그대로 넣는다. `process` `[160870,162502)`와 `updateProductWithCoupangDocPartial` `[158769,160673)`는 그 결과 전체를 pricing에 저장하며 금액>0에서 스위치를 다시 추론하지 않는다. 초기 산식은 비율 가격 계산 후 최소액 하한을 보정하는 기존 분기다. 이 근거는 선택 상태 보존을 뒷받침하며 초기 산식을 Stage2 직접 최소액 산식으로 바꾸라는 근거가 아니다.

조사 시 자체 `collection-product.ts`의 신규 정책은 최소액만 전달했고 선택 marker를 생략했다. `priceMinimumMarginEnabled`는 marker가 없을 때 금액>0을 사용하므로 신규 ON·0은 가격창에서 OFF로 보일 수 있다. 명시적으로 캡처한 boolean을 신규 정책에 보존하되 Stage2 recalculationMode를 새로 넣지 않고, 과거 상품을 일괄 수정하지 않는 범위가 적절하다. Step695의 명시적 Stage2 저장과 구분한다. 정확한 main source SHA·6개 함수 범위·writer·자체 파일 hash는 `outputs/step716-settings-minimum-initial-policy.json`에 있다.

이 추가 범위는 기존 utility Evidence `ev_0ab0458b3894fb5a1d96e3e4891548c831252b6d63182a881d355b9dc9bdf86a`와 원본 source 읽기를 재사용했다. 이 parent가 초기 worker 전체를 분석했다고 확대하지 않았으며 새 가격 REA producer나 원본 실행을 만들지 않았다. main SHA256은 `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`, resolve slice SHA256은 `3f81b7e2942f5fabdc2969c32ae6e7cf4e6b8993f7ff9e40f2e31e269523fd6c`다.

## 근거와 범위

원본 `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js` SHA256은 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`다. 아래 범위는 UTF-16 start-inclusive/end-exclusive이며 UTF-8 byte 범위와 모든 slice SHA는 `outputs/step716-settings-source-manifest.json`에 보관했다.

| 메서드 | UTF-16 범위 | slice SHA256 |
| --- | --- | --- |
| processTopImage | `[319767,320857)` | `e623758df1a2e3025443edc444bd37bda952620f02733a5773a96c8aa7dbbb54` |
| removeTopImage | `[320858,321176)` | `31c4c7f1ccba7f7bef5bc0d2dea9d662abc3c5bcfca9be921546471fe8a860e5` |
| processBottomImage | `[321654,322774)` | `55287db9869e1aa220b9ea480fa809f5b94e452b10276a57f281d81b173392a1` |
| removeBottomImage | `[322775,323111)` | `fcf1c65ba27c2cb0203c4ec165bc1044c5505f80e1f1e612d95ce843533fb276` |
| fileToBase64 | `[323112,323248)` | `47902d3221ac7e12aee324130c88fdbf23bb13aaf122ffc1fb2a9e6cdc7b22ff` |
| uploadImageToS3 | `[323249,323822)` | `90be9d1b57f75c7273ccd7905b02f390e88796ae707e711617ce9289968edf8d` |
| saveSettings (Step668 재사용) | `[315112,318057)` | `b24251f8973c99ae2387852bf17d062ec0f8ab942ca2cd618722c5216a0a1516` |

새 REA parent는 `ev_386151d788f509bd821d65cbbe3e3b4ca409791dfea9c7fefd22bbb0aea18f0b`, summary는 `ev_4eedad7720f8cb480ecfc7b1db924eb4a14cd6718b4a1e7a44aff359b91cdd73`다. inert 선택 파일 SHA256 `f246c6c70b4e51bbc4453ed344af6f34853b18c0083607f27deafb6bfd63bf2c`, directory SHA256 `078d0b42ae811ef5fad3f5069ded357ec484d02fed2ed43b8cf92678aadea744`, 1개 파일/5,279bytes/AST1,037/parse failure0이다. 선택 파일의 syntax coverage가 complete라는 뜻이며 semantic unknown198과 private backend·동적 runtime은 남는다.

초기화·저장은 Step668 parent `ev_bc28ce3f2ffa700fce520a3778b217e98b26fa54d6c52b5e32256504b970a90e`와 보관된 portable bundle을 재사용했다. 이 ID는 이번 MCP 연결의 retained ledger에는 없지만 `outputs/step668-settings-condition-audit/rea-evidence-bundle.json`에 완전 기록이 있다. intake 전용 Step715 Evidence를 설정 근거로 사용하지 않았다. 새 summary/portable ledger는 `outputs/step716-settings-rea-summary.json`과 `outputs/step716-settings-evidence-bundle.json`이다. 새 runtime/session을 열지 않았으므로 닫을 세션도 없다. 실제 사용자 두 계정에서의 저장·재열기·업로드 성공과 모든 1~7단계·Supplier Hub 접수는 이 정적 조사의 검증 완료 범위가 아니다.
