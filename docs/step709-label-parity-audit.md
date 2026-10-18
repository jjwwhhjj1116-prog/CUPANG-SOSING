# Step709 — 한글표시사항 편집·번역 증거 범위 보완

2026-10-18 KST. 설치된 REA 두 스킬과 JavaScript 안내를 읽고 기존 Step702–704 조사·보관 원문을 재사용했다. 소유 범위는 이 문서와 `outputs/step709-label-analysis*`다. 앱·테스트·DB를 수정하지 않았고 기존 작업 상품을 읽거나 쓰지 않았다. 브라우저·네트워크·원본 코드 실행은 0이다.

## 확인한 결과

Stage6 기본 `KoreanLabelEdit`의 항목 구조 편집·빈 행/전체 삭제·`KOREAN_LABELS` 3필드 초안은 Step702–704에 이미 다뤄졌다. 이번 조사에서 그 항목들을 신규 기능 차이로 다시 제안하지 않는다. 자체 Stage6에는 별도 `TranslationPanel`과 완료된 수집 속성 번역의 명시적 연결·변경값 검토·저장 UI가 이미 있다. 기본 `ProductLabelEditor` 안에 그 UI가 없다는 사실만으로 전체 기능이 없다고 보고하면 안 된다.

원본 기본 컴포넌트 전체와 그 render에는 수집 속성의 `sourceIndex`별 선택·번역·custom 행 적용 계약이 관찰되지 않았다. `attributes`, `sourceIndex`, `translateAttributes`, `applyTranslation` literal은 이 두 정확한 선택 범위에서 모두 0개다. 이는 **해당 컴포넌트의 제한된 부재 관찰**이며 앱 전체의 기능 부재를 뜻하지 않는다. 새 자체 완료 번역의 재사용·검토 경계를 수정한다면 그 문제는 별도 자체 소스/API 재현으로 입증해야 한다. 이번 vendor 정적 검사를 그 동작의 runtime 증거로 사용하지 않는다.

## 수정한 증거 연결

Step702–704는 `ev_cd5b12712ef6b71c2acfc13858957b76b067e15d1319aac6ac68b3c3a642258a`와 `ev_80058b8130c110cfd1ec44a0c48cf2441311a5ce02c3a66e52f40c0fbf65b42f`를 인용한다. 보관 `outputs/step670-price-number-audit/rea-evidence-bundle.json`을 REA로 import하고 실제 module page를 읽은 결과, 이 부모들은 각각 가격표 선택 코드와 일반 가격표 선택 코드 분석이다. 첫 부모의 module page Evidence는 `ev_cdb38513937e8ace8cbd9b2810e87367db7d18c31f2143008f3157aa0d38f274`이며 가격 저장·옵션 번호·묶음 적용 등의 선택 파일이 반환된다.

원문 UI/main 파일의 SHA와 직접 읽은 slice는 여전히 독립된 정적 근거다. 다만 같은 원문에서 추출했다는 이유로 **가격 선택 분석의 REA ID가 라벨 메서드도 분석했다고 확대하면 안 된다**. 과거 문서나 실험 결과를 일괄 고치지 않고 여기서 범위를 바로잡는다.

이 빈틈을 해소하기 위해 라벨 render·전체 컴포넌트와 그 버튼에 연결된 store action/mutation/prompt/wrapper만 inert wrapper로 새로 선택했다. 기존 가격 분석을 재실행한 것이 아니라 이전 REA 입력에 없던 정확한 라벨 구문을 분석한 것이다. wrapper는 parse만 했고 import·호출·vendor bootstrap 실행은 하지 않았다.

| 새 REA 기록 | Evidence ID |
| --- | --- |
| 라벨 선택 입력의 부모 분석 | `ev_e75a73c89a0fb3139ccd6768d2e5ee09872a42df9617e5bd8772a2528dc53e20` |
| summary | `ev_300c1402706f80b6917d09557144a1614ad56761093a189a0ae388f09711b723` |
| 전체 18개 module/asset identity page | `ev_39644e0ba46c06cfa402f9dd8b8ec20c2b023e0504199d5557db77a5ed657c3a` |
| `label-component.js`의 정확한 node item | `ev_b28873cbf7dc751135cfbf8c85477b8ca50ca65b9535b0330ab649f8f8e85e73` |

선택 입력 디렉터리 `outputs/step709-label-analysis-selected`의 REA root SHA-256은 `b4a9f99bd4d2dba636a4a4b52b9bf3f23429d25f31569fbed01a94f579c2b218`다. 이것은 아래 원본 파일 SHA와 다르며 원본 전체 앱을 분석한 ID도 아니다. 6개 JavaScript 파일, 19,451 bytes, parse 실패 0, application coverage complete이나 semantic coverage unknown이고 semantic unknown 683개다. 이 정적 그래프는 실제 실행·정책 집행·동적 call resolution·현재 서버 성공을 증명하지 않는다.

## 원문 identity와 정확한 위치

| 보관 원문 | SHA-256 |
| --- | --- |
| `outputs/step652-current-couplus/chunk-27c89b44.6953b027.js` | `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc` |
| `outputs/step652-current-couplus/main.a20c7114.js` | `29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad` |

범위는 원문 UTF-16 code unit의 시작 포함·끝 제외다. slice SHA는 해당 원문 slice를 UTF-8로 인코딩한 SHA이며 wrapper SHA와 구분한다.

| 정확한 선택 구문 | 원문·범위 | slice SHA-256 |
| --- | --- | --- |
| 라벨 render 함수 | UI `[139691,144444)` | `8bd6083af63f427cca2ef2be4aec1a38cfc6fcdf72e4b62fec27feb79c91b3a4` |
| `KoreanLabelEdit` 전체 object | UI `[144464,154083)` | `164f0f437ce44434cbe62ec36ab9685dcc1bd3662c271ad8a3219f11a9356b5e` |
| `requestKoreanLabelData` | main `[273131,273562)` | `f8fef68d539075a007c6e3d4f09c9caea00ad84284d084539fd43e4bfac3ede7` |
| `SET_KOREAN_LABEL_DATA` | main `[252599,252789)` | `a4e3978b514bbc55823d622ef7b0f9345d6613c5ce80a32e4b8590fe7de09db6` |
| `promptForKoreanLabels` | main `[376366,377587)` | `cf5040d7cc3445e4dcc66e4cd35ef87ef4b1b37dcbd0ff46ce8e659531d04f59` |
| `requestExtension` | main `[381133,381474)` | `181d323f90c1f6da45b92ee9760ed0d6b7ee23f89806c459082de044bc9fccee` |

`outputs/step709-label-analysis-extract.mjs`와 `-manifest.json`에 source identity, 원문 전체 slice, 개별 wrapper identity, 자체 읽은 파일 SHA와 bounded literal count가 있다. `-rea-views.json`에는 summary/page/item 원본 결과를 저장했다. `-evidence-bundle.json`은 이번 연결에 import한 기존 기록과 새 라벨 기록을 함께 보관한 portable bundle이다. 과거 가격 부모도 범위를 검증할 수 있도록 보존되어 있다.

## 관찰과 해석의 경계

원본 초기화는 UI id `manufacturer`(수입 및 판매원)에 `defaultSettings.manufacturer`, id `origin`(제조원)에 상품 `brand`, `madein`에 중국을 넣고 저장 `koreanLabels`를 덮어 합친다. 이는 Step702가 이미 설명한 UI/PNG alias 불일치의 일부다. 자체의 의미가 분명한 `manufacturer`/`importer`를 vendor의 뒤섞인 id에 맞춰 바꾸라는 새 요구가 아니다. 기존 사용자 설정·수동값·공란 보존 정책을 해제할 근거도 아니다.

원본 `saveManualLabels`는 값·구조를 모아 이미지 생성/업로드 후 모든 옵션의 값·이미지·상태와 견적 라벨을 갱신한다. 자체는 명시적 저장·PNG 검토·견적 연결과 옵션 직접값 보존으로 재구성한다는 차이가 이미 문서화되어 있다. 원본 `resetLabels`는 root/옵션 이미지·상태를 null로 만들고 다시 초기화하지만 저장 라벨 값·구조와 견적 파일까지 함께 지우는 코드가 아니다. 원본 재작성의 모순을 자체에 복제하거나 실제 상품을 초기화하지 않는다.

버튼 action은 `labels`를 commit하지만 mutation은 `aiLabels`와 `koreanLabelImage`를 읽는다. 따라서 해당 정적 버튼 경로만으로 현재 vendor가 3필드·PNG를 성공 저장한다고 단정하지 않는 기존 Step704 한계도 유지된다. 실제 원본 확장 실행, 현재 비공개 backend, 모델 출력, Supplier Hub 접수·SKU 발급과 전체 기능 동등성은 여전히 미확인이다.

이번 감사의 새 확정 결과는 **라벨 코드의 직접 REA 증거 연결 보완**이다. 중복한 기능 차이를 만들지 않았으며 자체 완료 번역 재사용 문제와 배너 카드 보호의 구현·테스트는 각 담당자의 독립 증거를 따른다. 회귀 테스트나 release 테스트 개수 기여는 0이다. native/browser/runtime 세션을 열지 않아 종료할 소유 실행 세션도 없다.

## 추가 확인 — Step687 설정 배너 카드 보호

담당자의 요청으로 Step687에 서술한 설정 배너 카드의 실제 render 분기만 새로 선택했다. 기존 Step676 부모 `ev_782e7a89a96a33a05f38b2d977a5ee4001676f0891cc87373d600c7252192396`의 선택 manifest에는 `processedGroups`·키보드 삭제 보호·생성/저장 메서드가 있지만, 모든 setting-card 버튼 render가 포함된 것은 아니다. 그 ID가 render 전체를 분석했다고 확대하지 않는다. 과거 `outputs/step683-detail-editor-audit-inventory.json`(SHA `a502a0a0691b7e4f248ceaf268698f073b325e188eb498494bec4672b27c0cc8`)과 `outputs/step685-detail-composition-audit.json`(SHA `9c91c92a7a52fcdcee47c1545a17292f3d80e6afe579fd276d2c127e600ccb75`)의 정확한 원문 방법 범위는 재사용한다.

새 입력은 동일한 UI 원문의 정확한 render `[85862,95604)`다. slice SHA-256은 `69c1c2f5abc2cb3b06fed995fb3ef8e1f5d89f43c2a632624cb3e4c0aa62236d`이고 inert wrapper 파일 `outputs/step709-label-analysis-banner-selected/detail-render.js`의 SHA는 `67bb8afc05772c21239e66cce4af12cc94c5c8fb5a7965099fc0528e9c3b2b6d`다. 선택 입력 root SHA는 `8fafafaed87ea1101e9e77a7d4f1de0521ca63bc5427e8c04bca512105ad37ac`다.

| 정확한 UI 분기 | UTF-16 원문 범위 | 관찰 |
| --- | --- | --- |
| setting action 분기 | `[89879,89962)` | 번역·편집 버튼 대신 설정에서 업로드한 상단/하단 이미지라는 안내를 출력 |
| 위 이동 | `[90861,90916)` | 첫 카드 또는 `processType === 'setting'`이면 disabled |
| 아래 이동 | `[91132,91213)` | 마지막 카드 또는 setting이면 disabled |
| 삭제 버튼 | `[91336,91427)` | setting이 아닐 때만 버튼 생성 |
| 원본 카드 helper 분기 | `[92193,92229)` | `isTopOrBottomImage(s)`이면 번역 버튼 대신 정적 안내 |

개별 guard literal과 slice SHA는 `outputs/step709-label-analysis-banner-manifest.json`에 있다. 새 REA 부모는 `ev_19609ad576d974f2154687ef4f6156b4c3269966ac824f639f4694a812db670e`, summary는 `ev_1d5e16f8d560f939a5ff4bfa86b3b723387fbe661365ad3cd65c5d0a28a23ee7`, module page는 `ev_edd97a9dd6b054f003d7de77a60b288927a5be1dbaa58302edcb868a106fac40`다. 1개 JavaScript 파일, 10,652 bytes, parse 실패 0이고 semantic unknown은354개다. `-banner-rea-views.json`과 공통 portable bundle에 보존했다.

여기서 확정한 것은 **설정 카드 자체의 버튼 차단과 안내**다. 인접 본문 카드가 setting 경계를 넘지 못한다는 규칙은 위 render만으로 성립하지 않으며, Step687은 이동 메서드의 그 결함을 이미 설명한다. 자체의 고정 역할·고정 ID·상단→본문→하단 보호는 그 의도를 일관되게 재구성하는 정책이다. vendor의 URL·파일명 추정 helper를 자체 역할 권위로 사용하거나, 이 정적 구문으로 현재 서버/실행 보호를 증명하지 않는다.
