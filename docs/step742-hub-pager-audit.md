# Step742 — 현재 Supplier Hub QVT 페이지 표시 계약 정적 검수

확인 결과, 현재 `/qvt/wims`의 opaque class는 추측한 스타일 이름이 아니다. 보관된 현재 JS의 CSS-module 매핑, 페이지 상태 계산, 렌더 코드와 CSS가 직접 연결된다. `_2pdnZ_VjGkLzJF5y1X3O-4`는 현재 페이지 표시이며 `_1H2KZYPdwpNDFms8Cnn5Jq`는 클릭을 막는 disabled 표시다. 표준 `.active`/`aria-current`만 찾는 구현은 이 DOM에서 현재 페이지를 인식하지 못한다.

이 문서는 앞선 `step742-stage-audit.md`의 SEO/상세 수정 보존 검수와 별개 범위다. 앱·테스트·확장 소스, 운영 데이터 및 기존 작업 상품을 변경하지 않았다. 브라우저·네트워크·DB·원본 JS 실행은 모두 0회다. parent가 저장한 읽기 전용 DOM과 정적 파일을 읽었다.

## 입력과 범위

현재 정적 파일은 parent가 DOM의 script/style URL과 연결해 저장한 QVT `20261019120452` 리소스다. `outputs/step742-hub-asset-proof.json`에 URL, bytes, SHA가 있다.

| 파일 | 전체 SHA-256 |
| --- | --- |
| `outputs/step742-hub-main.js` — 7,220,051 bytes | `9e9ba20c41ffb5a5e2ecafe5833fa8144e1eb371ec633350d79b6b52f4e0e4a6` |
| `outputs/step742-hub-main.css` — 51,660 bytes | `fa06d614a42285a174ce40af827de5b3b5875bda7c7bafec35fcc47cb4ef4ab4` |
| `outputs/step742-hub-assets-dom.json` | `ca1501a3a2ef51e9ee19b1d1f306dba8e99f85c1d68722e24136a4fca10e82b2` |
| `outputs/step742-hub-asset-proof.json` | `f1244fe74f6844a968144678611db7dd29d9d762dfe9e3092a7b97f84394dcf6` |

기존 `outputs/step548-hub-main.js` SHA `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`는 SR의 Vue `rsc-pagination`이며 현재 opaque class 3개와 `data-page`가 없다. 해당 old-SR Evidence `ev_7bccb57e05307a52efc7ae3b1f8a61f5f96ef3cd32e29faeaf569b4b78483157` 및 summary `ev_786c61028e9543ec0f0a5ae873667c78adf08a28629811cca462f14164110e87`를 현재 QVT pager의 증명으로 확대하지 않았다. 현재 JS/CSS에 대한 새 REA producer/Evidence ID는 만들지 않았으며, 직접 정적 AST 추출과 source SHA를 근거로 쓴다.

모든 다음 범위는 **UTF-16 code unit, end-exclusive**이고 SHA는 해당 slice를 UTF-8로 인코딩한 값이다. 전체 slice는 `outputs/step742-hub-pager-review.json`에 보존했다.

| 원문 | 범위 | slice SHA-256 |
| --- | --- | --- |
| JS module524 — SimplePagination | `[846351,849193)` | `32f51b7456039658a249c8b3f9cf3e6d61ccf4996117a7fb4d4217604f470da3` |
| JS getPage | `[846818,847319)` | `ac6efc0dfb83ed56e2e5df14c48029882614c3eeaa8f68c8af91093dc26822ca` |
| JS onClick/data-page adapter | `[848238,848438)` | `b6ec2dab3fd61ccaa98952d9e856864820e1e77b9bdd1210e477172bf419846b` |
| JS module1547 — CpPagination | `[2772552,2775370)` | `a50a0a1e6e9451839e6a7813508a9a0b7b31b291c26995b2bc4a7de08912085d` |
| JS module2528 — CSS semantic map | `[5377876,5378278)` | `6c1a83be274de365aeb4bbb42d24bc283ebc3d6bea633491f0c9db113ba6d55a` |
| CSS selected styling | `[10146,10596)` | `b80cb4b31b1efdc66596bb62a92ec738d4f38fae23ccaec2c20bab54f1cc06f8` |
| CSS disabled pointer-events | `[10871,11105)` | `d7b44d09025e7ecc71a3817c0e06f6914671c90ada1b451f180686577bf6ba81` |

## 원문에서 직접 확인한 연결

module1547은 `g=...bind(n(2528))`로 CSS-module2528을 쓴다. 숫자 `<li>`의 class는 `g("page-item",t.current&&"active")`, `<a data-page>`와 text는 모두 `t.number`다. module524의 `getPage`는 `number:t+1,current:t+1===u`로 현재 페이지를 지정한다. 따라서 selected class는 hover 등에서 유추한 값이 아니라 현재 상태에 직접 결합돼 있다.

| 의미 | 현재 class |
| --- | --- |
| pager UL | `_2rJmZwpWK6AkvdeVOL1bZs` (`pagination`도 유지됨) |
| numeric LI | `_3oMgfdzXLjxSxO_d0iK9z5` |
| selected numeric LI | `_2pdnZ_VjGkLzJF5y1X3O-4` |
| disabled LI | `_1H2KZYPdwpNDFms8Cnn5Jq` |
| first `<<` | `_1GYxV0xthnO8RlMLUrpvLd` |
| previous group `<` | `_3UdPicq8SQhncPE0mT6xld` |
| next group `>` | `tOfUlMHROQa_ehrySEQmm` |
| last `>>` | `V0kzo79OFKevPhLFGB8kc` |

CSS는 disabled LI 및 그 안의 anchor와 hover에 `pointer-events:none; cursor:not-allowed; opacity:.5`를 준다. 반면 JS의 LI onClick은 disabled 여부를 검사하지 않고 공통 handler에 연결한다. 따라서 자동 제어에서 `.click()`하기 전에 이 disabled class도 명시적으로 검사해야 한다. 시각적으로 disabled인 0 목적지를 프로그램으로 클릭하는 것은 원래 UI 계약과 다르다.

## data-page와 다음 페이지

표시상 현재 페이지 `u`는 기본적으로 application currentPage다. `isPageStartFromZero`가 true이면 `u+=1`을 한다. 총 페이지 `c=ceil(totalLength/countPerPage)`, 표시 그룹 크기 `d=countDisplayPageItem>0 ? countDisplayPageItem : 10`, 그룹 `p=ceil(u/d)`, 그룹 시작 offset `h=p*d-d`다.

| 컨트롤 | data-page | disabled 원문 조건 |
| --- | --- | --- |
| 숫자 n | n | 별도 disabled 없음, `current`로 selected만 표시 |
| `<<` | 1 | `props.currentPage===1` |
| `<` | `p>1 ? h : 0` | `previousPage<=0` |
| `>` | `p*d+1>=c ? 0 : p*d+1` | `nextPage<=countDisplayPageItem` |
| `>>` | 총 페이지 c | `state.currentPage===state.endPage` |

공통 클릭 adapter는 LI의 첫 `<a>`에서 data-page를 숫자로 읽어 `onClick(isPageStartFromZero ? value-1 : value)`를 호출한다. 즉 `<`/`>`는 바로 이전/다음 페이지가 아니라 이전/다음 **그룹**이다. data-page는 요청 목적지이며, selected state 자체는 numeric LI의 current 매핑으로 결정된다.

보관 DOM에는 selected numeric1, numeric1~6, disabled `<<:1`, disabled `<:0`, disabled `>:0`, enabled `>>:6`이 있다. parent의 별도 관측인 286건/50행이면 ceil(286/50)=6으로 정적 계산과 일치한다. 첫 페이지의 순차 후속은 numeric2이며 `>`를 누르면 안 된다. DOM만으로 총286을 독립 확인한 것은 아니다.

원문에는 별도 경계도 있다. 총11페이지이고 현재10이면 `>`는 `11>=11` 때문에0/disabled이며, `>>`도 current10===현재그룹end10 때문에 disabled다. 실제 실행으로 확인한 현상은 아니지만 원문 계산과 독립 모델상 유효한 순차 successor가 없다. 이 상태에서 disabled를 무시해 이동하거나 11페이지를 읽었다고 간주하면 안 된다. 총31페이지/current10에서는 `>` 목적지11이 enabled여서 그룹 이동이 가능하다.

## 자체 파서에 권고하는 최소 계약

1. 현재 QVT pager를 인식한 범위 안에서 위 selected class를 numeric LI와 함께 지원한다. 선택 anchor의 숫자 text와 양의 정수 data-page가 같아야 하며 유일해야 한다. 기존 표준 active/aria-current도 함께 있으면 서로 다른 현재값을 허용하지 않는다.
2. 순차 수집은 현재+1 숫자 컨트롤을 우선 선택한다. 표시 그룹 경계에서는 enabled 컨트롤의 data-page가 정확히 현재+1인 경우만 이동한다. 그룹 화살표의 이름을 무조건 다음 페이지로 해석하지 않는다.
3. disabled LI/ancestor를 별도 검사한다. 0·음수·비정수·중복 및 목적지가 일치하지 않는 컨트롤은 클릭하지 않는다. 행 서명/현재페이지 재확인, 회사 일치, 상세문서 미열기 등 기존 보호는 유지한다.
4. 원문 버전의 UI class가 달라지거나 모호하면 fail closed 한다. 현재 class를 다른 사이트나 무관한 `.pagination`에 포괄적으로 적용하지 않는다.

이것은 현재 retained QVT UI를 읽기 위한 권고다. 실제 페이지 이동 성공, 전체286건 수집, 상품 수정이나 실제 견적 접수 증명은 아니다.

## 검사

`outputs/step742-hub-pager-review.mjs`는 TypeScript AST를 이용해 모듈과 함수 slice를 읽고, class binding 및 보관 DOM을 검사한다. vendor 코드를 import/eval하지 않는다. 별도 작성한 산술 모델의 6개 fixture(6페이지 첫/중간/끝, 그룹경계10→11, 총11페이지의 마지막 한 페이지 그룹, zero-based current)를 통과했다. JS/CSS/DOM/metadata 4파일의 실행 전후 SHA는 동일하다.

원문 class 매핑과 data-page 계약에 대한 질문은 정적 근거로 답했다. 파서 수정 및 앱 회귀검사는 root 소유이며 이 보고서에서 수행한 것으로 집계하지 않았다. 기존 작업 상품과 운영 대기열은 접근하지 않았다.

## 후속 — 자체 reader 구현 독립 검수

root가 추가한 `nativePager`를 두 reader에서 읽기 전용으로 검수했다. 이 후속 검수에서는 기존 신규 suite를 격리 실행했고, 별도 작성한 `outputs/step742-implementation-review.mjs`로 자체 reader 함수를 합성 DOM에서 직렬화 실행했다. vendor JS를 실행한 것은 아니다. 중요한 새 결함은 발견하지 못했다.

검수한 두 `nativePager` 본문은 동일하다. 둘 다 serialized 최상위 함수 안에서 정의되며 그 함수의 `normalize`/`visible`와 표준 DOM만 사용한다. 외부 import나 extension service-worker의 숨은 closure가 필요하지 않다. 실제 `fn.toString()`을 독립 VM에서 호출하는 fixture가 이 경계도 검사한다. 재귀적인 페이지 갱신 호출은 named function-expression의 자체 이름 `readSupplierHubRegistration`에 결합돼 있다.

숫자 current/text/data-page의 일치, 숫자 목록 연속성, selected 유일성, first/last의 목적지와 원문 disabled 조건, native/standard current 충돌 거절, disabled 숫자 거절이 구현돼 있다. 순차 numeric current+1을 우선 사용하고 표시 그룹 경계에서는 enabled forward/last 중 exact current+1인 하나만 선택한다. 현재 마지막 페이지에서 forward0/disabled를 확인한다. 마지막 한 페이지 그룹의 원문 경계에서는 오류로 정지한다. href의 origin/path, 회사·검색조건 및 현재 table 변화/서명 보호도 유지됐다. 회사 조회는 결과 수·페이지 순서·견적서/SKU 중복을 계속 검사하며, 단일 견적 조회는 `registered:false`를 유지한다.

`nativePager`는 사용하지 않는 역방향 `<` 컨트롤의 상태까지 완전 검증하지는 않는다. 이번 목적은 forward-only 순차 조회이고 그 컨트롤을 클릭 후보로 삼지 않으므로 이를 새 실제 결함이나 전체 원문 UI 동등성 증명으로 부풀리지 않았다. class가 다른 미래 버전과 모든 가능한 변조 DOM을 포괄 검증한 것도 아니다.

검사 결과:

- `node --test tests/hub-qvt-native-pagination.test.mjs`: 9/9 통과. 두 회사, 6페이지 순차 이동, 10→11 그룹 이동, 원문11페이지 경계 거절, 선택/번호/disabled 충돌, 회사·검색조건·교차 origin 및 stale-table 보호를 검사했다.
- 추가 독립 검사: 총페이지1~40의 모든 current 조합 820개. 정상 상태는 exact+1 또는 terminal이며, 원문상 막힌 10/11·20/21·30/31은 클릭하지 않고 정지했다. 경계로 진입하는 직전의 정상 한 번 이동 후 새 DOM 읽기가 거절되는 것도 허용 결과로 구분했다.
- 추가 회사 query 10개: 두 회사 × 총페이지1/6/11/12/21. 정상 전체 합성 페이지 집계 또는 원문 경계의 보수적 정지를 확인했다. 실행 후 observer timer가 남지 않았다.
- 최종 독립 실행 전후 자체 소스 6파일 SHA 동일. 보관 fixture의 IDs 및 상품은 합성값이며 운영 상품/대기열을 사용하지 않았다.

최종 독립 검사에 고정된 파일:

| 자체 파일 | SHA-256 |
| --- | --- |
| `extensions/supplier-hub/company-registration-page.mjs` | `d745aab6fab214b51151f481c538a3c5c8154714e421172823e6ffe4b0b404b2` |
| `extensions/supplier-hub/registration-result.mjs` | `0215436aac919e071abe751fd8fa63b1ac37350360e075a85229b252af9ca531` |
| `extensions/supplier-hub/registration-pages.mjs` | `ad07808cd8dbf31d401b8fbd5b31e1e684869c23467b0617348176554bd59782` |
| `tests/hub-qvt-native-pagination.test.mjs` | `95fab5071f5e8112522b7a40d2ca9623fd97a2b472f8f1a07e5f822fbe97368b` |
| `tests/helpers/qvt-native-pagination.mjs` | `0888714b1817ccf7cf9138ae50f35ef00d3e98d5ae6e626b617210bb4b7801e7` |
| `tests/fixtures/hub-qvt-pagination-20261019.html` | `72292e52ed530dad1982e7a4ee6845a46246046cf0fa7a108e2594fe905a4300` |

helper는 최초 읽기 시 SHA `8593fd48faa9059c0853c355e451ff795e24e8570b06195f4101222fe328b2b3`였고 다른 작업자가 최종 실행 전에 갱신했다. 이를 되돌리지 않았으며 최종820+10 검사는 위 `0888714b...` 소스를 고정해 실행했다. reader 두 파일의 SHA는 최초 읽기와 최종 검사에서 같았다.

root가 별도로 보관한 `outputs/step742-hub-observed-page1.json`~`page6.json`의 50×5+36행 실제 query 관측은 root의 작업이다. 본 검수의 820+10 합성 검사를 그 실제 조회나 실제 견적 접수 건수로 집계하지 않는다. 실제 등록전송·접수 및 모든 카테고리 동등성은 이 후속 검수로 증명하지 않았다.
