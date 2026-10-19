# Step742 — QVT 견적서 UUID와 괄호 안 estimationId 분리

현재 QVT 원문은 견적서 ID 한 셀에 **서로 다른 식별값 두 개**를 렌더할 수 있다. 첫 번째는 `quotationId.substr(4)`로 얻는 QVT 견적서 ID이며, 두 번째 괄호 안 숫자는 별도 `estimationId`다. 따라서 복사 버튼이 두 개라는 이유만으로 정상 행을 거절하던 reader는 실제 page6 일부 행을 읽지 못한다. 두 값을 같은 견적서 ID의 별칭으로 취급해서도 안 된다.

조사 대상은 parent가 저장한 현재 공개 QVT JS와 읽기 전용 page6 DOM이다. 브라우저·네트워크·DB·clipboard·원본 JS 실행 및 운영 상품 수정은 0회다. 이 문서와 `outputs/step742-quotation-cell-review*`만 작성했다.

## 원문 근거

JS 전체: `outputs/step742-hub-main.js`, 7,220,051 bytes, SHA-256 `9e9ba20c41ffb5a5e2ecafe5833fa8144e1eb371ec633350d79b6b52f4e0e4a6`.

다음 위치는 UTF-16 code unit, end-exclusive이며 SHA는 slice UTF-8 기준이다. 원문 slice는 `outputs/step742-quotation-cell-review.json`에 보존했다. 기존 SR/Couplus Evidence ID를 현재 QVT 원문의 근거로 확대하지 않았고 새 REA producer/Evidence ID는 만들지 않았다.

| 원문 | 범위 | SHA-256 |
| --- | --- | --- |
| `quotationIdFormatter` | `[3696519,3697598)` | `4687175b8dd5312a50a46d6681767fb97476476a55d1e52dba5713cd716e745c` |
| `skuIdFormatter` | `[3697616,3697781)` | `fc9bbb3d65eb1370fd571d7b1a889e1f06e110492f778740eb6fbaddd38093db` |
| 검색 `quotationId` 조건 | `[357475,357560)` / `[369620,369705)` | `640611fbe6f22c209a0d16b6c0b15528ce0eb04dd2b96ec9855dd8681d0d7b40` |
| 검색 `estimationId` 조건 | `[357561,357633)` / `[369706,369778)` | `5a747fbae12e882c78e891aacf07011f2ed54ad17a7c4d2d799df6e7028d3b93` |

`quotationIdFormatter`에서 관측한 계약:

1. `t=e.quotationId ? e.quotationId.substr(4) : "-"`.
2. wrapper DIV의 첫 번째 자식은 `DIV.wims-list__clip`이고 그 안 clipboard control의 값은 t다. tooltip 의미는 `qvt-id-tooltip`이다.
3. 표시문자는 t의 길이가8보다 길면 앞8자와 `...`, 그렇지 않으면 t 전체다.
4. `e.estimationId`가 truthy이면 두 번째 자식 DIV를 추가한다. 이 DIV는 `(` + `SPAN.text-success > SPAN.wims-list__clip > clipboard(e.estimationId)` + `)` 구조다. clipboard 표시문자는 estimationId 전체이며 tooltip은 `rot-id-tooltip`이다.

검색 조건도 두 식별값의 도메인이 다름을 뒷받침한다. 입력 `quotationFile`이 nonnumeric이면 조건의 `quotationId`에 `"CID-"+입력`을 넣고 `estimationId`는 비운다. numeric이면 `estimationId`에 입력을 넣고 `quotationId`는 비운다. 이 조건을 실행하거나 해당 URL/API에 접근하지 않았다. source는 quotationId의 앞4자를 무조건 자르므로 이것만으로 모든 upstream prefix 형식까지 검증했다고 할 수는 없다.

## 보관 DOM과 일치

`outputs/step742-hub-observed-page6.json` 전체 SHA는 `f7b18cda6ab86a4473197b0b0066b845201eab1c1bde43630ff6f45f89d4a5af`다. 이 파일의 decoded `table` 문자열 SHA는 `5de2aee8697fa59027337dfbe2f3f58542114ccb3eb46506c343e032ca7916a4`다. 첫 행 cell5는 decoded table 문자열 `[1411,1759)`이며 SHA `d459067bf3cf8ddad34b3562ef1e88edeb391bda8e63b753c98dab3594ba5521`이다.

실제 업무값을 제외한 구조는 다음과 같다.

```html
<td><div>
  <div class="wims-list__clip">
    <button data-clipboard-text="<QVT UUID>"><div><앞8자>...</div></button>
  </div>
  <div>(<span class="text-success"><span class="wims-list__clip">
    <button data-clipboard-text="<estimation 숫자>"><div><estimation 숫자></div></button>
  </span></span>)</div>
</div></td>
```

정적 parse5 추출에서 page6은36행이며13행이 위 두 식별값 구조,23행이 primary 하나다. 36행 모두 primary가 UUID 형식이었고13개 secondary는 숫자였다. 이것은 이 보관 페이지의 관측이지 모든 회사·모든 QVT 기록의 형식 보장은 아니다. 두 버튼의 실제 표시 여부는 parent의 UI 관측이며, HTML 정적 분석만으로 독립적인 computed visibility를 주장하지 않는다.

## 최소 안전 추출 계약

- 처리는 반드시 견적서 ID인 cell5 안으로 제한한다. `wims-list__clip`은 다른 셀에서도 쓰이므로 전역 selector로 식별하면 안 된다.
- 기존 단일 copy/plain-text 행의 exact ID·표시 일치 계약은 유지한다.
- 새 두-copy 예외는 첫 DIV의 primary와 괄호 DIV의 secondary라는 직접 자식 구조, 각 역할의 태그/class 및 전체 셀 표시문자가 모두 맞을 때만 허용한다. UUID처럼 생긴 버튼을 찾아 고르거나 첫 번째 버튼을 무조건 선택하는 방식은 제외한다.
- primary는 표시 앞8자와 clipboard 원문 전체가 연결돼야 한다. secondary 숫자는 자신의 원문 전체와 표시, 괄호까지 맞아야 한다. 추가/중복/위치변경/표시충돌은 거절한다.
- 반환하는 quotationId는 primary 하나다. estimationId는 별도 값이며 요청한 견적서 ID 매칭에서 별칭이나 fallback으로 쓰지 않는다. 요청 ID가 secondary와 같다는 이유로 행을 반환하지 않는다.
- SKU cell6의 중복 copy 거절은 이 예외와 독립적으로 유지한다. 원문의 `skuIdFormatter`는 plain text를 렌더하며 견적서 셀의 두-copy 구조를 SKU에 확대할 근거가 없다.

독립 정적 모델은 원문 native 구조만 대상으로 하며, 36개 보관 cell을 모두 검증했다. 별도로 primary-only와 정상 두-copy 2개 합성 사례를 허용하고, primary 중복·역할 교환·추가 copy·잘못된 축약·secondary 표시 불일치·secondary UUID·괄호 누락·secondary가 primary처럼 배치된8개 사례를 거절했다. 합계10개 통과. vendor 코드 실행은 없었고 정적 입력2파일의 SHA도 불변이다.

## root 구현 후속 검수

root가 두 reader에 넣은 `quotationIdentity`를 독립적으로 읽었다. 두 helper 본문은 완전히 같고 SHA `e6ec7d41a943cdbb0ff6162e994b4cde9177ac4a09c4eff2909223751c96af20`이다.

- company reader 함수 범위: `[2257,4432)`.
- single reader 함수 범위: `[672,2847)`.
- helper는 serialized 최상위 함수 내부에 있어 외부 module closure를 요구하지 않는다.
- 두-copy 분기에만 UUID 형식·양의 숫자 최대20자리·직접 자식 구조·primary/secondary 표시·괄호·전체 셀 문자를 함께 검사한다. 결과는 primary UUID 하나다.
- 단일 견적 조회는 helper가 null이거나 요청 quotationId와 다르면 그 행을 제외한다. 회사 전체 조회는 invalid identity를 오류로 거절한다. SKU 중복 거절은 기존대로 별도 검사한다.

읽기 검수와 격리 시험에서 중대한 결함은 발견하지 못했다. UUID 형식과 legacy 최대20자리는 보관된 실제 형식에 대한 보수적인 자체 허용범위다. 원문 formatter가 모든 미래/과거 식별자를 그 형식으로 보장한다는 뜻은 아니다.

`outputs/step742-quotation-cell-review-implementation.mjs`가 source8파일 SHA를 고정하고 기존 native pagination suite와 새 quotation-cell suite를 격리 실행했다. **14/14 통과, 종료0, 실행 전후8파일 SHA 동일**다. 두 회사, 숫자 secondary로 alias 매칭하지 않음,6페이지 합성 이동,11종 비정상 dual-copy 구조, SKU 중복 거절을 포함한다. helper의 `children`은 element-only이고 `childNodes`에는 text가 남는 DOM 의미로 수정된 상태를 읽었다.

| 최종 검수 파일 | SHA-256 |
| --- | --- |
| `extensions/supplier-hub/company-registration-page.mjs` | `3608872e78936cf5a8654546ecc14ed377c2579af00713e5327c90de05a7015d` |
| `extensions/supplier-hub/registration-result.mjs` | `92c2778647d1aa0d7419a7ef1177e44190d32dbb8d1a829870ddcf2fc410bb33` |
| `tests/hub-qvt-quotation-cell.test.mjs` | `d85032af72b4a465b9721a2d1b566e5ac5fb08e4855c24dc0b4aac5406c3a1e6` |
| `tests/helpers/qvt-native-pagination.mjs` | `273c79fa9ba8e01dd4ee492fea29c4872c18f854446909c42a46e6692298df99` |
| `tests/fixtures/hub-qvt-quotation-cell-20261019.html` | `26b9bdc0b061147f43bf53c0f8c75190bbd4aac3d3252b596a4b877ee94fedb6` |

추가 전체 source hashes와 시험 stdout는 `outputs/step742-quotation-cell-review-implementation.json`에 있다. root의 실제6페이지 조회 및286행 보관 DOM replay는 별도 root 근거이며 이 격리14개 시험의 실제 접수 건수로 집계하지 않는다. 기존 작업 상품·실제 견적서·운영 대기열은 수정하지 않았고 이 조사로 실제 등록전송이나 접수 완료를 증명하지 않았다.
