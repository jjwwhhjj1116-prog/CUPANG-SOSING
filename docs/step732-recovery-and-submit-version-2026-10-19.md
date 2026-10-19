# Step732 — 같은 요청 복구와 최종 제출 버전 일치

2026-10-19. 기준 commit `a0a09b7d13b41f5eb68f675e881fa56b6a2a114e`. 기존 작업 상품·회사 기본설정·운영 견적서는 변경하지 않았다. 이번 변경은 새 1688 원문 획득이나 실제 Supplier Hub 접수 완료를 입증하지 않는다.

## 수정한 두 결함

전체 상품 전송 화면을 닫았다가 다시 열면 새 UUID를 만들던 경로를 보완했다. 첫 변경 요청 전에 원래 UUID·검토/본문 hash·회원/회사·앱 탭/창 식별값만 작은 localStorage descriptor로 보관한다. 견적 본문·이미지·인증 자료·동의값은 보관하지 않는다. 같은 origin의 상품별 Web Lock 안에서 claim과 readback을 확인하며, 잠금이나 저장소를 사용할 수 없으면 변경 요청을 보내지 않는다. 잠금을 기다린 뒤에도 현재 회원·회사·저장본을 다시 확인한다.

다시 연 화면은 보관 기록을 읽기만 한다. 사용자가 명시적으로 확인해야 원래 UUID로 preview하고, 같은 앱 탭/창·전체 검토 hash가 일치할 때만 저장 결과 복구를 제공한다. TTL 봉투만 새로 만들며 원래 기록 시각·UUID·본문은 바꾸지 않는다. 손상·다른 회사·변경된 저장본·다른 탭의 기록은 새 등록을 허용하지 않는다. SUBMITTED와 FINISHED도 예약을 유지한다. 정확히 일치하는 REJECTED 접수가 서버에 보관된 경우에만 Web Lock 안에서 compare-delete한다.

독립 검수는 늦게 도착한 반려 이력이 이미 연결된 복구 session의 descriptor만 지워 화면을 정지시키는 경합을 발견했다. 삭제 직전 같은 잠금 안에서 session·진행 요청·미보관 관찰이 없는지 다시 검사하도록 수정했고 회귀 검사를 추가했다. 외부 모달 닫기와 견적 수정 경로는 유지되며, 닫아도 descriptor를 지우거나 새 전송을 시작하지 않는다.

최종 제출 page 함수는 준비/packet 경로가 허용한 문자열 버전과 0을 마지막에 거절했다. 이를 기존 계약인 **0 이상 safe integer 또는 정확한 1–20자리 숫자 문자열**과 일치시켰다. `188`, `"188"`, `0`, `"00188"`의 원래 자료형과 값을 submitProof에 그대로 보존한다. 잘못된 음수·소수·unsafe number·빈 값·공백 문자열 등은 intent 기록과 클릭 전에 거절한다. 회사·소유 문서·본문·challenge·현재 확인란 검사와 중복 클릭 차단은 유지한다. 현재 Hub가 실제 문자열/0 버전을 발급하거나 수용한다는 주장이 아니다.

## 집중 검사와 독립 검수

복구 관련 집중 검사는 **34/34**, native 제출 관련 집중 검사는 **90/90** 통과했다. 검증 흐름과 이후 통합 범위가 겹치는 개별 집중 결과이므로 134건의 고유 최종 검사로 합산하지 않는다. 변경 파일 lint와 diff-check도 통과했다. 초기 복구 검사 두 실패는 VM realm 배열 비교를 기존 `plain()` 방식으로 수정한 것이며 실패 로그를 보존했다. 브라우저/Hub 경계는 합성이고 실제 접수 증거가 아니다.

독립 검수에서 확인한 동결 SHA-256:

| 소스 | SHA-256 |
| --- | --- |
| `app/components/supplier-hub-product-transport.tsx` | `97ad1d6c4e0dd2056b24ac3d61e5fc26df323622114bddc5626d2c8a7e7c35fe` |
| `app/supplier-hub-product-pending.ts` | `31f505bb88350dc78b9cab4eed4cf4a3ff7fc8b056eef80721e828c3c026ee30` |
| `extensions/supplier-hub/single-document-adapter.mjs` | `44ad0b240fd3227b9d08cac4c69d9fbb8e1843572b80afc2f14d58e83bf871b7` |

근거: `outputs/step732-pending-{proof.json,tests.log,lint.log}`, `outputs/step732-submit-version-{proof.json,freeze.json,tests.log,lint.log}`. 코드 검수에서 발견한 위 경합은 수정됐으며 해당 동결 소스에 미해결 중대 발견 사항은 없다.

## 실제 관찰과 남은 경계

Chrome4의 기존 Hub 시작 화면에서 **유앤채**, 경로 `주방용품>주방수납/정리>주방수납바구니/바스켓 (80719)`를 읽기 전용으로 확인했다. 상품명 입력·저장·다음·동의·제출·기존 상품 열기는 하지 않았다. raw schema/version과 접수 응답을 관찰한 것은 아니다. `outputs/step732-hub-category-readonly.json`에 범위를 보존했다. 화면 캡처는 CDP timeout으로 저장하지 못했으며 성공한 screenshot으로 표시하지 않는다.

사용자는 지정 상품 `https://detail.1688.com/offer/1022260303756.html`과 공식 안내 `https://open.1688.com/`의 **읽기 접근을 구체적으로 재승인**했다. Root가 Chrome4에서 각각 한 번 열기를 시도했지만 두 URL 모두 사이트 안전 gate에서 거절됐다. 이번 거절은 이전 Step731의 자동 승인 검토 거절과 다른 경계다. 이번에는 auto-review나 추가 permission prompt를 시도한 것이 아니다. 다른 도구·도메인·확장으로 우회하거나 재시도하지 않았고, 이를 대신할 수동 상품 사실을 사용자에게 요구하지 않았다. 로그인 오류로 단정하지 않는다.

새 URL의 실제 원문 수집, 전체 옵션 native 본문 저장·단계 동의·최종 POST/응답, 같은 `docId → qvtRequestId`의 실제 접수와 SKU 연결은 여전히 미검증이다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`, `PRODUCT_DOCUMENT_LIVE_VERIFIED=false`를 유지한다. 집중 검사나 읽기 전용 경로 확인으로 gate를 해제하거나 전체 목표 완료를 주장하지 않는다.

## 최종 검사와 배포

관련 23개 파일의 최종 통합검사 **321/321** 통과, 실패·취소·skip·todo 0. 검사 전후 소스 1,351개 SHA가 일치했다. 타입·변경 파일 lint·운영 빌드·확장 ZIP 일치 검사도 통과했다. 최종 통합검사는 위 집중 검사를 포함하므로 합산하지 않는다. 근거는 `outputs/step732-related-final-{proof,freeze}.json`, `step732-types.log`, `step732-lint.log`, `step732-build-final.log`다.

기존 Worker `sourceflow`에 배포했으며 version은 `bcf8d684-be80-4b09-b103-6930059ae23a`다. 기존 변수는 유지했고 DB migration과 상품·회사 설정 쓰기를 하지 않았다. 준비 확장은 **0.2.82**, 58개 파일, 748130 bytes, SHA-256 `34f55b406eec6c7c93be36c29ed31d9944acec44f9a4259a2ef0908fd451f768`이다. manifest 변경은 버전뿐이며 권한은 늘리지 않았다. 준비 ZIP이 기존 Chrome에 적용됐다는 의미는 아니다. 근거는 `outputs/step732-deploy.log`와 `public/downloads/yoofam-plus-supplier-hub-extension-0.2.82.zip`이다.

배포 후 Chrome4의 자체 확인 탭에서 기존 Cloudflare 로그인 경로와 승인된 관리자 앱 로그인을 거쳐 목록이 표시되는 화면을 확인했다. 상품·설정·소싱·전송을 열거나 실행하지 않았다. AX snapshot 한 번은 timeout이었고, 이후 성공한 화면 캡처를 직접 검수했다. 자체 앱 origin 콘솔 오류 0. `outputs/step732-production-proof.json`, `step732-production.png`가 목록 표시만 입증한다. 로그인된 자체 앱 탭을 결과물로 남겼고 원래 Couplus/Hub 탭은 그대로 두었다.
