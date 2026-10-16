# Step686 — 저장 전 견적 HTML과 개별 사진 복원의 제한된 동등성

2026-10-16. Step683–685의 보관 Evidence와 인용 조각을 재사용했다. 새 REA 분석·MCP·브라우저·Couplus·Supplier Hub·1688·외부 API를 호출하지 않았다. 자체 소스는 읽기만 했고 구현·테스트·DB·기존 상품은 변경하지 않았다. vendor 관찰은 shipped client의 정적 동작이며 실제 서버 저장이나 사용자 클릭의 실행 증명이 아니다.

## 판정

기존 증거는 root HTML과 최종 견적 HTML이 별도임을 확정한다. 그러나 현재 자체 모델에는 vendor root HTML과 동등한 자료가 없다. root가 선택한 Step686의 완결 범위는 **실제 저장 직전 선택 옵션의 유효 견적 HTML 문자열을 공란까지 그대로 보관하고, 봉인된 개별 입력 사진 순서와 함께 명시적으로 다시 불러오는 것**이다. 새로 생성하거나 과거 root 문자열로 추정하지 않는다.

최종 견적은 통합 PNG와 `detailHtml=''`를 유지한다. 새 복원 버튼은 현재 증거를 확인한 뒤 사진과 저장 전 HTML을 로컬 수동 초안으로 넣으며, 사용자가 명시적으로 저장하기 전에는 견적·ALT·다른 초안을 바꾸지 않는다. 이 값의 이름은 **저장 전 견적 HTML**이어야 한다. vendor root generatedHTML 원문 복원, 전체 영속 조합 작업 공간, vendor OCR/번역 세션 재현으로 표시하면 근거를 넘는다.

## 재사용 근거

- chunk `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js`: SHA256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`, 553,312 bytes.
- main `outputs/step652-current-couplus/main.a20c7114.js`: SHA256 `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad`, 579,613 bytes.
- save/group Evidence `ev_782e7a89a96a33a05f38b2d977a5ee4001676f0891cc87373d600c7252192396` 및 parent `ev_9ba78b705b9c68a727604eaf0bebe7f726bbbe8fea6c6d38d50ac77d2b88e1ba`. 기존 iframe 한정 Evidence `ev_6373190d88287217f0a505c6e86baff55ba4c1447b792b744463771033bf7809`는 외부 편집기의 내부 문서를 증명하지 않는다.
- 인용 자료 `outputs/step685-detail-composition-audit.json`: SHA256 `9c91c92a7a52fcdcee47c1545a17292f3d80e6afe579fd276d2c127e600ccb75`. 기존 동일 source slice 20개를 묶은 자료이며 새 producer Evidence가 아니다.
- 상세한 범위·unknown·휴대용 Evidence bundle은 [Step683](step683-detail-editor-parity-audit.md), [Step684](step684-edit-session-parity-audit.md), [Step685](step685-detail-composition-parity-audit.md)에 있다. 아래 offset은 chunk UTF-16, 끝 제외다.

| 보관 조각 | 범위 | 조각 SHA256 |
| --- | --- | --- |
| processedGroups | `[97368,99354)` | `9d3cabdad8e9190415db560f063d0bcad1afd56f5dc072735611434c2482e900` |
| created | `[99562,100016)` | `6dc5ac588ea96c77db4510c329f00869b1f335e93dda0e42b1d2a29e5172d648` |
| initializeDetailHtml | `[104047,105462)` | `802ba71944eca352f121750fe5bdc81a845abab25a8b6f3cbcee3069c2345e15` |
| generateDetailHtmlFromProcessed | `[127674,128968)` | `ec174e97f07a711634eb1f44fe0fbcc3c411d9918c51adae12efa4265c91a59f` |
| saveDetailPage | `[131264,136334)` | `757d3e6097a2084225181b9e0cbf205687e1cb93061ea886e7b66b3f53dc28f2` |

## vendor에서 확인되는 자료의 분리

`created`는 truthy root `product.detailHtml`을 로컬에 그대로 넣고 falsy이면 현재 사진으로 HTML을 생성한다. 저장된 `processedDetailImages`가 있으면 각 `index`로 map을 복원한다. 최종 PNG를 나누어 개별 사진을 추정하지 않는다. 동일 index는 마지막 값이 덮으며 저장된 빈 HTML은 공란으로 보존되지 않는다는 약점도 있다. 자체 구현에서 이를 요구로 복제할 필요는 없다.

`generateDetailHtmlFromProcessed`는 상·하단과 본문을 구분하고 본문을 numeric index로 정렬한다. max-width 800px/padding 20px wrapper, 폭 760px 이미지, 현재 `imageMargin`으로 HTML을 전체 재생성한다. 이동·삭제·번역 결과·수동 편집 결과가 이 경로를 호출한다. 빈 그룹이면 return하여 예전 HTML이 남을 수 있다. `compiledHtml [99355,99393)`는 이 로컬 문자열이고 미리보기 render는 `innerHTML`로 사용한다.

`saveDetailPage`는 다음 세 자료를 별도로 취급한다.

| 저장 자료 | 정적 관찰 | 자체 매핑의 의미 |
| --- | --- | --- |
| root detailHtml | 현재 로컬 HTML 문자열 저장 | 편집용 생성 HTML의 별도 자료 |
| root processedDetailImages | URL 있는 non-setting 그룹 전체 보존 | 개별 현재 결과와 순서를 다시 여는 자료 |
| 최종 견적 이미지/HTML | 그룹으로 별도 폭 800px/padding 0 HTML을 만들어 통합 이미지 생성. 공통과 모든 옵션 첫 견적의 상세 이미지를 결과로 바꾸고 견적 HTML은 `''` | 최종 통합 PNG와 빈 HTML 연결 |

따라서 root 생성 HTML을 남기는 것과 견적 HTML을 비우는 것은 동시에 성립한다. root HTML을 빈 견적 HTML에서 복구하거나, 견적 HTML에 넣어야 root가 보존된다고 해석하면 틀린다. 최종 PNG는 root HTML을 그대로 rasterize한 결과도 아니다. 실패 시 URL 쉼표 fallback이 있지만 자체 저장 성공 증거로 복제하지 않는다.

자동 서비스는 root `detailImages`를 통합 PNG 한 장, root HTML을 단일 이미지 HTML로 바꾸면서도 개별 `processedDetailImages`를 남길 수 있다(main `[504716,514814)`, Step683). `originDetailImages`도 현재 `detailImages`에서 재생성되는 경로가 있으므로 불변 최초 수집 사진이 아니다. 자체 원문·현재 결과·통합 입력을 이 필드 이름으로 합치면 안 된다.

현재 상세 render `[85900,95620)`에는 textarea/direct `detailHtml`/`imageMargin`/`applyImageMargin` 참조가 없다. **사진 액션을 통한 HTML 생성과 미리보기는 확인됐지만 임의 root HTML 직접 입력 UI는 확인되지 않았다.** 저장 문자열의 정확한 보존과 arbitrary HTML 편집 기능은 다른 주장이다.

## 현재 자체 모델을 읽어서 확인한 범위

`app/detail-editor-inputs.ts`의 `saved-detail-inputs-v1`은 category, 원래 상품/옵션/upload/revision, 최종 출력 key/SHA/bytes 및 **순서 있는 입력 key/SHA/width/height**를 가진다. HTML 문자열·생성기 버전·간격·상하단 역할 snapshot·사진별 안정 ID·vendor 처리 그룹은 없다. exact-key validator이므로 기존 format에 HTML 필드를 조용히 덧붙이면 검증이 실패한다.

일반 상세 저장은 `detailSaveBackups[category scope]`의 receipt와 sources에서 이 자료를 재구성한다. 가족 적용은 같은 형태의 scoped metadata를 명시적으로 전달하며 원래 출처를 유지한다. unrelated 이후 수정이 있어도 현재 출력 연결이 같으면 예전 receipt revision을 쓸 수 있다. 전체 snapshot revision이 과거 receipt revision과 같아야 한다는 검사는 부적절하다. 현재 state/view revision·updatedAt·active scope overrides 일치는 별도로 필요하다.

`app/detail-editor-inputs-client.ts`는 현재 견적 전체를 파일 조회 전후 GET하여 비교하고, 최종 PNG의 실제 SHA/bytes/800px 폭/예상 높이 및 각 입력의 실제 SHA·orientation 반영 치수를 검증한다. 입력 순서와 같은 파일의 중복 위치를 보존한다. 이 함수는 GET만 한다. 서버 순수 메타데이터 helper만 호출한 것은 실제 파일 검증이 아니다.

현재 `OptionImageEditor` 복원 버튼은 검증된 키를 선택 옵션 `detailImages` **로컬 초안**에 넣는다. HTML 초안을 새로 덮지 않는다. 실제 견적 슬롯의 개별 사진을 편집·번역하려면 현재는 기존 명시적 옵션 이미지 PUT이 먼저 필요하다. 이후 통합 PNG를 만들고 전체 상세 저장을 할 수 있다. 이는 분리된 영속 작업 공간에서 사진만 편집한 뒤 마지막에 한 번 최종 적용하는 흐름과 다르다.

`ProductContent.detail.description`은 일반 텍스트이고 견적 자동 HTML에서 escape된다. 이를 root HTML 저장소로 바꾸면 원문/수동 설명 의미가 바뀐다. 견적 `detailHtml`에는 이미 수동 문자열·명시적 공란·자동값 복원(null)의 별도 정책이 있다. 저장 직전 견적 HTML 문자열을 새 root generated HTML의 권위 자료로 자동 채택하면 안 된다.

## Step686에서 결정한 구현 경계

다음은 root가 결정한 자체 정책이며 Couplus의 서버 schema/프로토콜이 아니다. 이 문서 작성 시점에 구현 소스의 frozen 검토는 아직 하지 않았다.

| 경계 | 결정된 내용 |
| --- | --- |
| 새 일반 상세 저장 | 명시적 opt-in `editorPolicy='ordered-inputs-html-v1'`만 처리. 최종 PNG와 기존 receipt/ordered sources에 저장 직전 **선택 옵션의 primary 및 effective 견적 HTML** snapshot을 결합한다. |
| snapshot 출처 | `backup.editor`에 context·승인 회사·정확한 문자열을 보관하고 receipt에 digest를 결합. 기존 `backup.before`의 raw override 존재/공란 자료도 유지한다. 새로운 root/vendor HTML로 이름 붙이지 않는다. |
| 새 복원 조회 | 명시적 GET `saved-composition-v1`. 본인 일반 상세 저장의 자료만 대상으로 현재 정확한 PNG·선택 옵션의 빈 HTML·실제 파일 bytes·현재 context·승인 회사를 확인한 뒤 fresh proof를 만든다. |
| 명시적 초안 채택 | 저장된 literal HTML을 `''`까지 그대로 새 수동 초안에 넣고 같은 봉인 사진 순서를 복원. 조회/버튼 자체에는 PUT이 없다. |
| 기존/가족 자료 | 기존 images-only 복원 버튼 유지. 과거 HTML을 생성/보간하지 않는다. 가족 HTML 전파, 별도 root HTML 문서, 독립 영속 workspace는 포함하지 않는다. |

저장 전 HTML이 공통 수동값에서 상속됐든 자동값이었든 snapshot은 당시 실제 선택 옵션에 보인 유효 문자열이다. 복원 후에는 **새 명시적 수동 초안**이므로 과거 상속 관계나 자동 provenance가 복원됐다고 주장하지 않는다. 정확한 문자열을 보존한다는 의미와 raw override 원상복구는 다르다. 후자는 기존 `backup.before`가 별도로 표현한다.

## 독립 데이터·가드 검토 권고

이 절은 채택한 경계를 검토하기 위한 요구이며 이번 문서에서 테스트로 확인한 결과가 아니다.

1. **새 snapshot의 무결성은 서버가 결합한다.** 닫힌 opt-in 값, 정확한 editor schema/version, source option/context/company 및 literal HTML을 검증한다. digest는 클라이언트가 주장한 임의 HTML의 권위를 만들지 않는다. snapshot은 저장 전 서버 view의 exact primary/effective 값과 같아야 하고 sources/출력/receipt와 같은 guarded commit 및 잃어버린 ACK 복구 단위에 속해야 한다. 기존 `saved-detail-inputs-v1`의 exact-key 의미를 소급 확대하지 않는다.
2. **빈 문자열과 부재를 구분한다.** `''`는 유효한 저장 HTML이다. `value || generated`, trim, newline normalization, HTML pretty-print, 누락을 공란으로 치환하는 처리를 하지 않는다. old snapshot 부재/손상은 새 복원 조회의 사용 불가 상태이지 새 문자열 생성의 허가가 아니다. 기존 상품 조회와 images-only 경로는 읽기 호환성을 유지한다.
3. **현재 대상은 별도로 증명한다.** 승인 사용자/회사, 상품, category/profile, 현재 output key와 실제 target linked fields, 선택 옵션의 정확한 빈 HTML, 현재 revision/fingerprint를 검증한다. 원래 source option은 provenance이며 다른 대상의 현재 권한 증명이 아니다. 현재 출력이 달라졌거나 회사/context가 바뀌면 과거 snapshot을 채택하지 않는다. 같은 URL·수집 fork·가족을 자동 연결하지 않는다.
4. **과거 receipt revision과 현재 revision을 혼동하지 않는다.** unrelated 이후 수정은 허용될 수 있지만 현재 state/view·active scope·실제 PNG·HTML 연결은 정확히 맞아야 한다. fresh proof는 현재 fingerprint/context/target에 결합하고 과거 receipt 자체를 현재 요청 proof로 재사용하지 않는다. 사진 파일 SHA/치수와 PNG SHA/bytes 검증은 순수 metadata 검증과 별도로 수행한다.
5. **복원은 한 번의 원자적 초안 채택이다.** 요청 시작과 완료에 동일한 상품/옵션/profile/stage/version/active/disabled 세대인지 검사한다. 도중에 생긴 사진/HTML 초안·다른 저장이 있으면 모두 유지하며 응답을 폐기한다. 사진만 먼저 넣고 HTML 검증에 실패하거나 반대 순서로 일부만 채택하지 않는다. read-only 성공이 PUT/통합 저장을 자동 시작하지 않는다.
6. **HTML은 텍스트로 보관한다.** literal snapshot에는 기존 수동 HTML도 포함될 수 있다. 이를 scriptsafe라고 가정하거나 `innerHTML`로 실행하지 않는다. 현재 text 편집 정책과 내보내기 URL 변환은 유지한다. vendor가 `innerHTML`을 썼다는 사실은 이를 그대로 실행해야 한다는 요구가 아니다.
7. **사진 순서는 원문대로 보존한다.** 같은 key 중복 위치를 합치지 않는다. 역할 snapshot이 없으므로 첫·마지막 위치/파일명에서 banner 역할을 추정하지 않는다. 삭제는 위치 제거이지 파일 삭제가 아니다. actual quote slot이 아닌 복원 전 로컬 배열을 quotationTarget으로 꾸며 편집 API에 보내지 않는다.

입력 개수·실제 byte 합계·개별 치수·통합 높이·HTML 길이 한도는 현재 validator/route 정책과 일치시킨다. 현재 입력은 최대 상품 image pool 150개와 통합 높이 16,000px, 각 파일 10MiB, 읽기 합계 30MiB로 제한된다. 같은 파일 여러 위치도 합계에서 각 위치로 계산된다. metadata 복원을 성공시켜도 기존 옵션 이미지 저장의 중복/최대개수 오류를 자동으로 없애면 안 된다. 사용자가 검토한 뒤 명시적으로 정리·저장하는 정책을 유지한다.

## 완료 경계와 권고 검증

다음이 충족되면 **저장 전 견적 HTML 보관 및 개별 사진 복원** 범위는 완결됐다고 말할 수 있다.

- 새 opt-in 일반 저장에서 입력 순서·중복 위치·출력 증거·선택 옵션의 literal HTML snapshot이 결합되고 재조회 시 정확히 검증된다. 저장 후 견적은 통합 PNG/빈 HTML이며 snapshot은 별도 backup 자료다.
- snapshot 부재·손상과 intentional `''`를 구분한다. legacy 상품 조회/images-only 복원은 유지되고 새 HTML을 과거 원문처럼 생성하지 않는다.
- 복원 클릭은 GET만 하고 실제 현재 PNG·견적 HTML/ALT·다른 scope를 보존한다. 새 사진/HTML 초안을 함께 채택하되 이미 있는 초안을 덮지 않는다. 실제 견적 변경은 명시적 기존 저장을 거친다.
- 파일 또는 메타데이터 변조, 같은 URL의 다른 상품, 다른 회사/category/profile, 늦은 응답/ABA 전환, 중간 초안 생성, 중복 클릭, 취소, 저장 ACK 유실에서 과거 결과를 채택하지 않는다.
- 같은 파일 중복 위치와 현재 허용치를 넘는 저장 입력은 원래 순서대로 보여주되 이후 저장 검증을 우회하지 않는다. 사진 제거가 실제 파일 삭제를 만들지 않는다.

이는 권고 검증 기준이며 이번 문서에서 실행한 제품 테스트 결과가 아니다. **vendor root generatedHTML 자체의 별도 생성/영속 보존은 여전히 잔여**다. 입력 목록에서 새로 HTML을 만들 수는 있지만 그것을 저장 전 견적 HTML snapshot이나 과거 root 원문으로 부를 수 없다. vendor editor의 760px/20px padding과 자체 최종 800px canvas가 픽셀 단위로 같다는 주장도 할 수 없다.

독립 workspace photoId·역할·원본/결과/편집 문서의 영속 결합, 조합 자체를 현재 견적 변경 없이 저장하는 기능, 조합 전용 사진 편집 target, 수동 root HTML 정책 역시 추가 범위다. 기존 실제 견적 slot API에 가짜 입력 목록을 넣어 이 간격을 숨기면 안 된다.

vendor 서버 영속 schema, 임의 root HTML의 실제 입력 경로, 외부 editor session 및 최종 rasterization은 여전히 미확인이다. 이번 조사에서 새 프로세스·브라우저·MCP 세션을 열지 않았으며 정리할 소유 자원은 없다.
