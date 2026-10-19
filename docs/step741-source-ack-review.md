# Step741 — 수집 저장 ACK 기한 수정 독립 검수

2026-10-19 KST. root가 수정한 `app/intake-collection-recovery.ts`와 실제 호출자·응답 검증·수동 clock 검사·2회사 workflow 검사를 읽었다. **authority 상실·늦은 취소 후 반영·내부 재전송·새 race에 관한 material issue는 발견하지 못했다.** 이 담당은 앱·테스트·확장·운영 자료를 바꾸지 않았다.

이 수정은 자체의 응답 대기 견고성 문제를 고친 것이다. retained Couplus가40초/10초를 사용한다는 근거가 아니며 원문 사이트 수집의 동등성을 증명하지 않는다. 수정 전 증거 `outputs/step741-source-ack-before-fix.json`의 SHA `fbc53dc110ca004818f77dc371e7a2839579b4c54090ca8df510acb13379c806`은 HTTP200 뒤 JSON이 정지한 abort 무시 transport에서 부모 취소 후에도 기다리던 자체 helper를 기록한다.

## 확인한 처리 경계

- 새 `readJson`은 headers와 JSON을 하나의 기한으로 제한한다. timeout 또는 부모 abort는 별도 interruption Promise를 resolve하므로 fetch/JSON이 abort를 무시해도 그 transport를 계속 기다리지 않는다. 늦은 headers는 JSON을 읽지 않고 body 취소를 시도하며, 늦은 JSON도 source를 반영하지 않는다. `Promise.race`에 연결한 read의 catch가 늦은 거절을 받아 처리한다.
- POST와 recovery GET은 다른 child AbortSignal을 쓴다.40초 POST timeout이 부모나10초 GET을 취소하지 않는다. 부모 취소는 현재 child를 취소하고 helper의 공개 결과를 `undefined`로 끝낸다. finally는 timer와 부모 listener를 정리한다. body 취소가 throw해도 interruption 결과를 가리지 않는다.
- 이미 확보한4xx headers는 error JSON이 정지하거나 읽기에 실패해도 terminal이다. 이를 알 수 없는 write로 바꿔 GET/Chrome fallback을 시도하지 않는다. 정상 파싱된 configuration503도 terminal이다.
- 성공한 JSON의 job/offer/source URL/수집시각 검증은 ambiguous read catch 밖에 있다. 오류를 같은 job GET으로 덮어 정상화하지 않는다. transport/JSON 실패나 ambiguous5xx만 **원래 job result GET1회**로 확인하며 POST를 다시 보내지 않는다.
- fallback 권한은 제때 파싱한 `collect`의422 `SOURCE_NOT_COLLECTED`에만 남는다. POST timeout 뒤 도착한 같은 문자열은 그 권한을 만들지 않는다. `browser-capture`가 같은422를 반환해도 재캡처·재시도하지 않는다.
- 호출자 `collectIntakeProduct`는 helper 이후 부모 signal을 다시 확인하고 progress/job/import callback도 취소 후 반영하지 않는다. ACK 기한을 넘긴 경우 Chrome으로 자동 우회하는 새 분기는 없다. 서버가 이미 저장한 receipt는 별개로 남을 수 있으며 클라이언트 abort가 서버 취소 완료라는 뜻은 아니다.

`timeoutMs`/`recoveryTimeoutMs`는 이 자체 함수의 내부 검사 인자이며 HTTP 요청 body/query에 노출되지 않는다. 정상40초/10초와 상한·정수 검증을 확인했다. 서버의 수집 작업·원문 값·상품정보를 임의로 채우는 수정은 없다.

## 독립 검사와 source 동결

`outputs/step741-ack-review.mjs`의 순수6개 그룹이 통과했다. 부모 abort가 fetch 내부에서 즉시 발생하는 경우, timeout 후 늦은 fallback code, 이미 확인한422의 늦은 body, body.cancel 예외, recovery source URL 불일치, 유일하게 허용된 제때의 fallback/configuration terminal 경계를 추가 확인했다. 수동 clock과 자체 helper만 실행했으며 DB·수집기·원격 fetch·브라우저·vendor 실행은0이다.

수정본 SHA256은 `5d2f688450b683511861479716e95cb4f3545f5bd0901da986424761af1ecea9`다. 호출자 `app/intake-collection.ts`는 `eedecfeff21012c81877cb1e9cecc06596ba9bf8d1a22b21c70a7c1adf9486a6`, 응답 검증기는 `918b356adde35f6944b649650593044abbf8377545d9f1f83bba81105e412148`다. 읽은 source/test7개 SHA가 전후 같았으며 상세 해시는 `outputs/step741-ack-review.json`에 기록했다.

root의 `intake-collection-deadline`, `intake-deadline-quotation-flow`, 기존 recovery 검사 source도 읽었지만 이 담당이 그 통합 suite를 재실행했다고 집계하지 않는다. 독립6개는 release test 수에 추가0이다. 이 검수가 모든 대기 지점의 기한, 실제1688 획득, 원격 상품 등록 또는 Supplier Hub 접수를 검증한 것은 아니다. 두 native live gate를 변경하지 않았고 기존 사이트 거절을 재시도하지 않았다.

## 마지막 회귀 기대값 보정 검수

root의 별도2개 test 변경도 읽었다. retained 원본 및 현재 자체 경계와 모순되는 의미 약화는 발견하지 못했다.

`collection-context-company`의 ‘회사 미기록 legacy’는 **회사 identity의 미기록**을 뜻하며, 오늘의 자체 intake로 만든 고시값에 예전 표시사항 linkage가 적용돼야 한다는 뜻은 아니다. `noticeManufacturerImporter`가 설정 importer를 포함해야 한다던 기대는 Step700 이후 독립 초기 고시 정책과 맞지 않는다. 원본 `applyDefaultSettings [460195,465227)` SHA `09bbc96a570f0a975d3a1bef5ae6c41f337ac73758822f004c2b377ecee38584`는 `productPage.manufacturer`를 쓰지만 importer 또는 legal `제조자(수입자)`를 쓰지 않는다. 새 `해당사항없음 / couplus-default` 단언이 그 경계와 일치한다. 회사 null·회사 미기록 export 거절·source409·저장 자료 전체 불변 검사는 그대로다.

첫 수정에서 총 행수6으로 단언한 것은 검수 fixture의 공통행을 빠뜨린 오류였다. `outputs/step741-notice-inspect.json`은 공통1+옵션6=7이며 final source는 **전체7·공통1·옵션6**을 각각 검사한다. 7개 행 모두 N/A/default를 확인한다. 초기의 잘못된 count 단언 실패를 runtime 회귀나 최종 통과로 바꾸어 기록하지 않는다.

`intake-api-integration`의 browser-source 기대를4reads·supplement0·capture1로 바꾼 것은 현재 `reuseCapturedJsonLdSource` guard와 일치한다. 이미 검증·저장한 JSON-LD receipt의 optional gap 때문에 자동 재캡처를 반복하지 않는 기존 계약이다. browser-capture가 product import보다 먼저임을 검사하고, provider `chrome-product-jsonld-v1`, SKU수, 실제 fixture의 SKU/위안 원가/MOQ/재고 tuple, 미전송 상태와 수동 수정 보존 검사는 남아 있다. 이4reads는 자체 합성 브라우저의 안정 읽기 횟수이며 Couplus의 private 수집 방식·실제 사이트 성공률 증거가 아니다.

수정 전 ACK source를 주입한 parent의 `outputs/step741-baseline-stale-tests.log`도 같은 기존2실패를 기록한다. 이 담당은 해당 log를 재사용했으며 원격 source나 full collector를 실행하지 않았다. `outputs/step741-test-expectation-review.mjs`의 static4그룹이 통과했고 검사 중 읽은5source SHA가 같았다. 최종 test SHA는 company=`dfb66727da70d6b19e051211b7989de3f7215c9c77a2828f887cdcab8668da00`, integration=`65465b0edae098e4b43d9339d2b51b63971ad663551b27be9e9212aa66be7719`다. 전체 근거는 `outputs/step741-test-expectation-review.json`에 있으며 release 검사 수 추가0, 운영·브라우저·네트워크·vendor 실행0이다.
