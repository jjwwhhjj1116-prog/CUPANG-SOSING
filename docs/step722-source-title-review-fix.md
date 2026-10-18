# Step722 — 초기 SEO 상품명 누락의 검토 상태 보존

2026-10-19 KST. 기준 HEAD `2ad230bd99830563f37968b3fa59aea9d073120c`. 수집 원문으로 새 초안을 만든 뒤 초기 Workers AI 결과가 상품명만 반환하지 않은 경우를 수정했다. 원문 상품명과 정상 설명·옵션 번역을 보존하면서, 미완료 상품명을 SEO 완료로 표시하지 않고 견적서에 검토 안내를 남긴다. 실제 원본 서비스가 이 예외를 어떻게 처리하는지는 확인하지 않았으므로 원본과의 동일 동작으로 주장하지 않는다.

## 확인한 결함과 재현 경계

로컬 Workers 응답이 `title:''`, 한국어 설명, 정상 한국어 옵션명·색상을 반환하면 기존 번역 validator는 사용할 수 있는 부분 결과를 허용한다. 그러나 intake는 설명 누락만 검사했고, 이후 옵션 준비의 `done` 응답을 받아 `completed:true`, `reviewRequired:false`로 끝났다. 저장된 상품명은 `原文收纳商品`·`collected`로 남았지만 견적서 상품명에도 번역 검토 안내가 없었다.

최초 6개 탐색 시나리오는 `outputs/step722-source-missing-title-proof.json`과 `.log`, 실행문 `outputs/step722-source-missing-title-probe.mjs`에 보관했다. 이는 SQLite에 합성 receipt를 저장한 뒤 실제 import/intake/translation/apply/quotation-fields를 실행한 조사다. 수집기 실행이나 새 실제 URL 수집 증거가 아니다.

정식 신규 테스트는 실제 collection-jobs POST로 UUID 요청을 만들고, 같은 요청의 result POST에 합성 receipt를 저장한 뒤 실제 import 흐름을 실행한다. 두 회사의 승인 membership을 각각 격리 SQLite로 모방한다. 카테고리 `80719`는 기존 관찰 schema를 사용하지만 XLSX는 합성 양식이며 해당 회사의 실제 공식 파일 검증을 뜻하지 않는다. 원문 사진은 없고 Workers AI 결과는 로컬 stub이다. 외부 요청·브라우저 조작·기존 상품/설정 변경·Hub 쓰기는 모두 0이다.

Google 경로와 구분한다. 현재 Google producer는 원문 상품명이 있는데 제목 번역이 비면 이미 terminal 실패로 처리한다. 이번 실제 누락 재현은 Workers 결과다. 양쪽 producer의 canonical 결과에 사용하는 coverage 검사는 같은 구조로 유지한다. 제목과 설명이 모두 공란이면 기존 `EMPTY_MODEL_OUTPUT` 오류가 유지되며 성공 결과로 강제 통과시키지 않았다.

## 수정한 경계

- `app/api/products/[id]/translation-apply/route.ts`: 기존 최초 intake job·provider/model·v6·전체 scope·retry 제외 조건을 유지하고, 실제 누락된 필드에만 `intakeSeoCoverage.missingTitle` 또는 기존 `missingDescription` boolean을 제공한다. job ID와 현재 content revision에 결합하며 현재 수동 title은 명시적 공란도 누락 해결로 인정한다. 기존 설명만 누락된 응답의 shape는 유지한다.
- `app/intake-seo.ts`: 해당 결과에서 제목 누락이 있으면 동일 job/current revision의 typed proof를 요구한다. 누락이 남은 경우 `reviewRequired`와 상품명 안내로 끝내며 자동 재실행하지 않는다. proof 부재·외부 job·다른 revision·누락 flag 부재는 완료로 처리하지 않는다. 정상 설명·옵션은 기존 통합 적용 경로로 저장한다. abort 이후 완료 callback도 발생하지 않는다.
- `app/quotation-schema.ts`: 최종 상품명이 content에서 왔고 `collected` 제목에 한자가 남아 있으면 기존 상세 설명과 같은 종류의 비차단 검토 안내를 제공한다. 언어 품질을 판정하거나 새 필수 오류를 만들지 않는다. 수동 content title, 공통 견적 override, 옵션 override는 우선하며, override를 `null`로 해제하면 원래 수집 제목과 안내가 다시 보인다.

수동 상품명 공란의 필수값 오류, 제출 검사의 error/review 구분, `submissionReady:false`, 미연결 transport 및 기존 운영 전송 gate를 바꾸지 않았다. 수동 공통 제목과 옵션 공란은 실제 XLSX에도 그대로 기록되고, 일반 수동 SEO 제목은 기존 문서 정책에 따라 `직접 검토한 상품명, 회색형`/`검정형`으로 구성된다. 정상 초기 SEO 적용에서 저장한 공통 문서 제목 정책은 그대로 유지한다. collector, raw receipt, SKU별 위안 원가·최소주문·재고, 가격 계산, 설정, DB schema, 확장 protocol은 수정하지 않았다.

## 검증과 보존 증거

| 실행 | 결과 | 증거 |
| --- | --- | --- |
| 수정 전 정식 신규 6건 | 2 통과 / 4 실패, 전부 상품명 누락을 검토 필요로 표시하지 못함 | `outputs/step722-source-title-before-confirmed.log`, `-before-proof.json` |
| 최초 관련 4파일 실행 | 33건 중 31 통과 / 신규 fixture 오류 2 실패. 기존 Google 설명 12·Workers 설명 6·intake-seo 9건은 모두 통과 | `outputs/step722-source-title-focused-first.log` |
| 최종 신규 파일 | 6/6 통과, 실패·취소·skip 0, 9508.361ms | `outputs/step722-source-title-focused.log` |
| scoped ESLint | 앱 3파일+신규 test, exit 0 | `outputs/step722-source-title-lint.log` |

Node `24.19.0`, 테스트 heap 256 MiB·semi-space 1 MiB, lint heap 384 MiB를 사용했다. 신규 6건은 양사 각각 누락·완전 응답·수동 제목/공란의 3개 case다. 각 case 안의 replay·공란/비공란·proof 변형은 별도 신규 case로 합산하지 않는다. 마지막 6건 재실행과 앞선 33건을 더한 값을 고유 통과 수로 사용하지 않는다. 관련 33건 전체를 최종 신규 fixture로 다시 실행했다는 주장도 하지 않는다. root는 별도 type768/lint app+db+newtest384/schema/build384 검사의 exit0을 보고했다. 최종 aggregate·운영 배포는 이 문서 동결 시점에 별도 진행 중이며 수치나 완료를 추정하지 않는다.

신규 테스트는 literal 한국어 제목·옵션명, 명시 공란, XLSX의 literal 공급가/판매가/MSRP (`4750/7920/10300`, `5800/9670/12570`), SKU/CNY/MOQ/재고 보존, source receipt/context/settings/profile의 exact SQLite bytes, 템플릿 exact bytes, 모델 실행 1회·추가 외부 요청 0을 검사한다. 실제 quotation preview와 fingerprint가 맞는 download를 읽어 title review가 error로 변하지 않는지, 공란의 기존 required 오류가 유지되는지 확인했다. Single prepare/실제 접수·이미지 다운로드·제외 옵션의 별도 신규 시나리오는 실행 범위에 없다.

root의 별도 Chrome4 검수는 실제 React `QuotationFieldsEditor`와 로컬 API/격리 SQLite를 연결했다. 초기 검토 필요 문구와 중국어 제목·7단계 알림을 확인한 뒤, 수동 한국어 입력으로 source 안내가 사라지고 수동 공란에서는 required 누락이 늘며, discard 후 원문이 복원되는 것을 확인했다. console은 비어 있었다. 근거는 `outputs/step722-browser-final-proof.json`과 root가 보관한 PNG/AX다. 이 UI 검수는 편집 draft와 discard 검수이며 POST 저장·Google 요청·실제 수집·Hub 전송은 하지 않았다. 위 API 테스트의 실제 저장 검증과 구분하고 신규 unit case 수에 합산하지 않는다.

실패 로그는 삭제하거나 덮어쓰지 않았다. 최초 `-before.log`에는 새 fixture의 숫자/문자열 기대 오류 2건이 포함됐고, 숫자 export 계약을 바로잡은 뒤 `-before-confirmed.log`를 남겼다. `-focused-first.log`의 두 실패는 수동 문서 제목의 기존 옵션 suffix 기대 누락이었다. 뒤의 `-focused-before-cross-realm-fix.log`는 abort 결과 객체의 VM realm 비교 오류 2건이며 `plain` 직렬화 후 동일 값 검증으로 수정했다. 앱 소스는 이 과정에서 변경하지 않았다.

수정 전 test SHA를 기록한 proof와 동일한 `366a13b2…` 본문은 후속 test 변경을 역으로 되돌려 `outputs/step722-source-title-baseline-test.mjs`에 복원하고 exact SHA 일치를 검사했다. 당시 별도 복사한 원본으로 표현하지 않는다. 복원은 테스트 재실행이 아니며 실행문·결과는 `-preserve-baseline.mjs`와 `.log`에 남겼다.

## 동결 파일

| 파일 | SHA-256 |
| --- | --- |
| `app/intake-seo.ts` | `616f0f1cb86aaa75b69254cd4c627545d289456f0a1345d74c2ad614a36ec355` |
| `app/api/products/[id]/translation-apply/route.ts` | `d87f23a0dc60e7c1a79049f182f5312f582c76ca74ba569e14fe86e0c0101c0c` |
| `app/quotation-schema.ts` | `e30f38e5ac94b186cabe01b8e013162c4b8ac72c57737d7b31a944a15602b303` |
| `tests/intake-workers-title-coverage.test.mjs` | `60c535451528994ab6ea18146471c0c0a0d000793d2053f5b70fad31aa121783` |

최종 파일·로그 hash와 조사/구현 시점을 구분한 범위는 `outputs/step722-source-title-final-proof.json`에 보관한다. 독립 source 검토는 `outputs/step722-title-source-review.json`, 신규 test/baseline 검토는 `outputs/step722-title-tests-review.json`이다. 모두 독립 실행·수정 없이 SHA와 소스·보관 로그를 읽었고 actionable issue 0개였다. 이 수정은 확인한 초기 누락의 완료 표시와 후속 검토 안내에 한정되며 전체 원본 동등성이나 모든 상품의 SEO·공식 접수 완료를 뜻하지 않는다.
