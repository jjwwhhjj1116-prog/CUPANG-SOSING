# Step657 — 다른 견적서로 이동했을 때 기존 요청 중단

2026-10-14. Step656 `a247e77` 배포 이후 같은 SPA 탭에서 중간저장 문서를 바꾸는 경계 조건을 검수했다. 기존 실상품을 변경하거나 1688·Hub에 요청을 보내지 않았다. 전체 동일 구현·실제 접수 완료를 뜻하지 않는다.

## 재현과 수정

양사 모의 브라우저에서 새 문서 A의 약관 화면을 연 뒤, 같은 브라우저 document UUID를 유지하면서 기존 문서 B를 불러오고 원래 단계로 돌아오는 문제를 재현했다. A의 `loadedDocId`가 DOM에 남아 있어 B 화면에서 A 요청의 동의·다음 클릭을 허용했다. 단순 상품명 일치나 A의 서버 원문 재조회는 현재 화면이 B라는 사실을 확인하지 못했다. 모의 저장 함수는 A를 고정 대상으로 쓰므로 이 재현에서 B의 원격 저장 변경까지 주장하지 않는다. 실제 전송 gate는 계속 false다.

새 passive 관찰은 최초 불러오기 이전에 같은 탭·창·최상위 프레임·브라우저 document UUID·새 docId·packet/identity digest·회사를 고정한다. 첫 불러오기용 일시 관찰과 이후의 연속 관찰을 구분했다. 정확한 소유 문서 GET은 허용하지만 다른 get-by-id, 새 create, 새로고침, 탭 이동·교체·삭제, 다른 등록 경로, 브라우저 문서 변경, 10분 만료에서는 연결을 무효화한다. 요청·응답 본문, 헤더, 쿠키, 토큰은 읽거나 보관하지 않는다. Listener 부분 설치 실패·정리 실패·시간 역행·요청 폭주도 진행하지 않는다.

소유 상태의 후속 injection은 `frameIds:[0]` 대신 같은 `documentIds:[uuid]`에 고정하고, 동작 전후에 현재 관찰 토큰을 확인한다. 별도의 isolated page 관찰은 Hub에서 신뢰된 실제 pointer/input/keydown/change가 발생하면 이전 자동화 요청을 중단한다. 사람의 명시 동의는 앱의 별도 확인 화면에서 받으므로 이 Hub 입력 중단과 구분한다. dispose·네트워크 무효화는 같은 토큰의 DOM 상태도 무효화한 뒤 page listener를 정리한다. 새 worker에 DOM 기록만 남아 있어도 메모리의 현재 관찰이 없으면 재개하지 않는다.

Native NEXT가 사용하는 `/sr/draft/api/update`는 URL에 문서번호가 없어 본문 없이 다른 문서 여부를 구분할 수 없다. 이 경로를 소유 증거로 삼거나 시간만으로 추측한 면제를 만들지 않았다. 정상 NEXT를 깨뜨리지 않도록 opaque update 자체는 무시하며, 다른 문서 GET·명시 입력 중단·정확한 서버 본문 대조를 함께 사용한다. 이 제한을 해소하는 실제 새 문서 화면·저장값 관찰 전에는 live gate를 켜지 않는다.

## 검사

Single·동의·앱 연결·연속 관찰 검사270/270과 확장·공개 수집 모의·카테고리·불러오기 회귀163/163이 통과했다. 고유 관련433개이며 fail/skip/cancel은0이다. 새 연속 관찰100개와 adapter 경계10개가 포함되어 있으며 별도로 중복 합산하지 않는다. 양사에서 약관 표시 후·사람 확인 대기 중·최종 제출 직전 B를 불러오는 상황, 같은 상품명, 같은 UUID, native 입력, worker 교체를 검수했다. 모두 잘못된 동의·다음·제출을 중단했고 정상 단계 이동·명시 동의·ACK 유실의 읽기 복구는 유지했다. 첫 불러오기용 listener 정리와 전체 adapter dispose 정리를 별도 검사한다.

변경 lint 오류·경고0, 운영 빌드·확장 패키지·산출물 검사 통과. TypeScript 전체 검사는 이전 합성 검수 helper의 unknown JSON 응답 타입 때문에 최초 실패했으며, ignored helper의 응답 타입만 바로잡아 재검증했다. 운영 코드에 해당 helper를 추가하지 않았다. 합성 UI proof의 당시 bundle/source hash를 후속 실행으로 덮어쓰지 않았다.

## 접수 확인 분석

현재 Hub bundle SHA-256 `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`과 기존 REA Evidence 3개를 재사용했다. 원문 구간의 수동 정적 확인을 추가했으며 실제 실행 또는 기존 Evidence 전체 범위의 확대를 주장하지 않는다. 세부 범위·hash는 로컬 `outputs/step657-receipt-static-audit.md`에 있다.

최종 POST `/sr/qvt/api/validate-single-product`는 `{docId,version}`을 보내고 화면은 code/data.success를 소비한다. 이 화면의 성공 문구는 등록 파일 ID나 SKU 관계를 증명하지 않는다. fresh GET `/sr/draft/api/drafts/register-requested`의 raw array에서 자기 새 docId의 유일한 행과 `qvtRequestId/status/productName/categoryPath`를 함께 확인하는 경로가 있다. 빈 응답에서 기존 화면 목록을 지우지 않는 동작과 복사 API 미지원 시 실제 파일 ID 대신 fallback 문구가 표시되는 동작도 있어, 현재 표의 텍스트만으로 접수 성공을 판정하면 안 된다.

정적 확인 범위: getRequests `[2868035,2868195)` SHA `1d207d3e500173812fa6b9eb0c07c0390256e02e74d08967c7f3892515ca0756`; validateDraft `[2870643,2871458)` SHA `a3bd933948a780d71a717cd119f72996d5f1363c46f8d90bf88bf51ef9f278ea`; q4 `[4153320,4153982)` SHA `d0dd3ec998d93e36e60171ffb3db08c2d26e4c52a90f4cc372f40c492e6eb7f2`; retail SKU 검색 h3 `[4184075,4187033)` SHA `0edabe9da4a1b77efce821e7a03e698978b9debb59817e854f611994b92bc40c`. 별도 SKU 검색 결과와 docId/qvtRequestId의 join은 아직 확인되지 않았다.

`SINGLE_DOCUMENT_LIVE_VERIFIED=false`, `RECEIPT_UNCONFIRMED` 유지. 실제 새 원문 수집, 모든 카테고리 기본값, 새 Hub 문서 동의·저장·접수번호·SKU 연결 검증은 남아 있다. 모의 응답이나 기존 작업 상품으로 이 검증을 대체하지 않는다.

확장 **0.2.70**:51파일,688,819bytes, ZIP SHA-256 `b8066cc4670b55a45b1d3177c055b9d784056055981490096717547074e32a11`. 이전 ZIP과 DB·회사별 설정·무료 번역/AI 정책·기존 권한은 유지했다. 배포 및 운영 보존 결과는 완료 후 아래에 기록한다.

TypeScript 전체 재검증도 통과했다. 운영 배포 **`6fb4fc66-c7f2-47e9-86a3-fa6a2318f92d`** 완료. 같은 사용자 Chrome의 실제 앱에서 0.2.70 다운로드, 기존 두 대기열 입력 URL·카테고리69900/81452와 양식 연결의 보존을 확인했다. 기존 `YP-22E079FC` 미선택, 옵션6개, 공급4,260원·판매7,100원, 대표3·추가7·상세11·표시사항0장의 표시도 유지됐다. 목록 조회와 대기열 열기·닫기만 했고 상품 편집·수집·저장·삭제·전송은 하지 않았다. `outputs/step657-production-preservation.json`, `step657-production-intake.png`에 보관했다. 설치된 사용자 확장의 0.2.70 reload 확인이나 실제 Hub 입력 감시 실행은 주장하지 않는다.
