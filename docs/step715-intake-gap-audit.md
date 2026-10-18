# Step715 — URL 수집 후 검증된 SKU를 잃는 상세 원문 대기 보완

## 확인한 경로

기준 HEAD `81ba0a3`. 사용자가 카테고리와 URL을 입력하면 `IntakeQueuePanel` → `submitIntakeQueue` → `POST /api/collection-jobs`로 회사·카테고리·기본설정 스냅샷을 기록한다. `collectIntakeProduct`는 `/collect`의 검증된 원문 receipt를 받은 뒤 `/product`, SEO·옵션 초안 준비, 원본 이미지 저장과 `/image-draft`를 호출한다. 수집 시작만으로 Supplier Hub 전송을 실행하지 않는다. 저장된 상품 링크와 원문은 재사용하며 기존 상품의 수동 수정값을 새 수집으로 덮지 않는다.

`collectionProvider` 기본값은 공개 페이지 수집이다. PC의 명시적 JSON-LD와 모바일 공개 본문/SKU 조회를 병행한다. 공식 Alibaba API는 서버의 `ALIBABA_PRODUCT_API_ENABLED=true`와 자격 정보 세 가지가 있을 때만 선택한다. 현재 로컬 운영 빌드 산출물의 공개 vars에는 이 스위치와 세 키가 없고 텍스트 provider는 `google-free`다. 원격 Worker secrets 유무는 조사하지 않았으므로 공식 API가 원격에서 사용 불가능하다고 단정하지 않는다. `/api/integrations`의 `collection.configured=false`는 하드코딩이며 이 값만으로 실제 collector가 연결되지 않았다고 판정할 수 없다. Couplus 비공개 서버의 공급처/API 접근 방식은 이 소스만으로 알 수 없다.

## 실제 결함과 변경

`app/alibaba-mobile-collector.ts`는 모바일 offer·SKU·단가·MOQ·속성을 검증하고도 optional `detailUrl` fetch와 전체 본문을 기다렸다. HTTP 502/503/504만 부분 원문으로 보존했고, 상세 전송 거부나 본문 정체는 전체 원문 수집을 실패시켜 검증된 SKU까지 상품 초안으로 저장하지 못했다. 이 동작은 상태 문구 문제가 아니라 `/collect` 성공 여부를 바꾼다.

상세 원문 fetch와 본문 읽기만 독립적인 기본 5초 예산으로 묶었다. 5초는 자체 선택한 optional 단계 예산이며 공급업체가 공개한 제한이라는 주장이 아니다. 서버 내부의 typed network/read/timeout 오류에만 이미 검증된 모바일 결과를 `1688-public-mobile-partial-v1`로 돌려준다. 설명·상세 이미지가 없으면 기존 원문 누락 검토 항목이 남으며 번역·이미지 완료나 실제 접수로 표시하지 않는다. 기존 intake는 이 부분 provider를 재사용하므로 동일한 상세 수집을 즉시 Chrome으로 다시 시도하지 않는다.

실제 HTTP가 없는 시간 초과를 `504`로 만들지 않는다. raw Chrome capture의 `{detailUnavailable:{status:502|503|504}}` 형식과 parser 계약은 그대로다. raw capture 경로에서는 내부 typed 오류를 정상 capture로 바꾸지 않는다. 함수 옵션의 `optionalDetailTimeoutMs`는 자체 서버/테스트 호출에서만 선택하며 요청 본문이나 provider 선택 입력으로 받지 않는다.

사용자·상위 signal 취소, 401/403, redirect, 기타 허용하지 않은 HTTP 실패, 잘못된 offer/SKU, private 데이터, 잘못된 encoding·과대 본문·성공 응답의 상세 parser 오류는 계속 실패한다. 호스트·쿠키 범위·재시도 횟수는 늘리지 않았다. 타이머와 abort listener를 정리하고, 기한을 넘겨 늦게 도착한 응답 본문과 대기 중 reader를 취소한다. timeout 직후 부모가 취소돼도 부분 수집 성공으로 복구하지 않는다.

## 검수와 한계

`tests/alibaba-optional-detail-deadline.test.mjs` 10개는 보관된 불활성 상품 원문과 제어된 fetch/stream만 사용한다. 빠른 정상 상세, 전송 거부, body read 실패, fetch/body 정체, 늦은 응답 취소, reader lock 해제, 사용자·부모 취소 경쟁, HTTP 권한/redirect, encoding/크기/parser 및 상품 식별 검사를 다룬다. 기본 5초 타이머는 fake timer로 검증하며 실제 URL 요청은 없다. 기존 collector 19개와 합쳐 **29/29 통과**, 해당 세 파일 lint 통과다. 상세 요청에 독립 child signal을 쓰므로 기존 collector fixture의 해당 단일 assertion만 이 계약에 맞게 조정했고 PC/SKU signal 검사는 유지했다. 독립 검토의 자원 정리 지적을 반영해 모든 종료 시 상세 child signal을 retire하고, 403·잘못된 charset의 미소비 stream 취소와 lock 해제를 추가 검증했다.

첫 관련 세 파일 실행은 39개 중 36개가 통과했다. 새 timeout 직후 부모 취소의 메시지 문제는 취소 우선 처리로 수정하고 재검사했다. 나머지 기존 `optional-detail-intake` 두 실패는 source repair 후 모든 옵션 견적 제목이 공통 SEO 제목과 같다고 가정하는 assertion이다. 수정 전 HEAD collector를 파일 읽기에서만 주입한 진단에서도 같은 두 assertion이 동일하게 실패했다. 실패 로그와 baseline loader는 `outputs/step715-mobile-*`에 보존했다.

이후 해당 두 fixture를 현재 제목 계약에 맞춰 강화했다. 일반 콘텐츠 PATCH로 공통 수동 제목을 편집하면 기존 SEO-document 증거와 clock이 달라져 저장된 옵션 한국어명을 합성하는 fallback을 사용한다. 포함 옵션에 고정된 수동 한국어명을 지정해 합성제목 literal을 검사하고, 다른 포함 옵션은 실제 견적서 PUT으로 수동 제목을 저장해 그 값의 우선권과 overrides 전체 보존을 검사한다. 제외 옵션을 포함한 모든 자동 제목의 보완 전후 동일성, 공통 수동 제목의 provenance, 기존 가격·수동 공란·사진 제외 검증도 유지했다. 해당 파일 전체 **11/11 통과**, lint 통과이며 로그는 `outputs/step715-mobile-optional-intake-fixed.log`와 `outputs/step715-mobile-optional-intake-lint.log`다. 파일 SHA256은 `a232afb31540fd0f64841e0fa6b52f71170325fbb0b69fc862c9ed397b92ff95`다. 새 수집 경로 전체의 별도 실제 API·SQLite 흐름 검사는 상위 담당자 범위다.

실제 1688 접속, 차단 URL 우회, Chrome/CLI/proxy 재시도, 실제 상품 수정, 공급처 비밀 정보 출력, Supplier Hub 전송은 수행하지 않았다. 검증된 실제 원문의 전체 옵션 수신과 실제 Supplier Hub 접수는 별도이며 완료로 주장하지 않는다. 운영 단일 견적 live 검증 gate는 계속 false다.
