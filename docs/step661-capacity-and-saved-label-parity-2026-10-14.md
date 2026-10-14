# Step661 — 수집 지연 복구와 저장 표시사항 결과

2026-10-14. Step660의 `5f495e3d07df375521527a7b0b2de6bdd2ea573c`를 기준으로 수집 초안과 6단계 표시사항 화면을 보완했다. 기존 작업 상품은 수정하지 않았다. 이 단위의 완료는 모든 카테고리·실제 1688 전체 SKU·Supplier Hub 최종 접수가 완료됐다는 뜻이 아니다.

## 쿠플러스 저장 라벨 대조

기록된 로그인 화면 `outputs/couplus-options-reference-2026-10-06/label.jpg`, `label.txt`의 469행과 `outputs/step649-couplus-label.txt`의 19행은 저장 표시사항의 읽을 수 있는 결과 화면을 보여준다. 이전 YOOFAM의 저장 참조는 120×120 썸네일만 보여주고 큰 미리보기는 임시 생성 Blob에만 있었다. 저장 후 재진입 때도 결과 이미지를 읽을 수 있도록 보완했다.

설치된 REA에 기존 증거 bundle을 가져와 선택된 배포 JavaScript의 저장 계약을 읽었다. Parent는 `ev_02780e2b058e642fc180a67b70caa803cccdc81f6dae0421b92e62c6c911e3a4`이다. 15개의 선택된 inert 메서드 파싱 실패는 0이며 외부 상태 관계는 unknown으로 남는다. 공급자 코드를 실행하거나 앱 소스로 복사하지 않았다.

원본 UI chunk SHA-256은 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`이다. `updateProductWithCoupangDocPartial`의 UTF-16 [362069,363339) 구간은 반환된 `imageUrl`을 상품의 한글 표시사항 이미지와 해당 라벨 행에 저장한다. 선택 구간 SHA-256은 `22d276a462c3cc68bc491a8e823fb5648714a2b0ef38a4d2cb8941d09071a284`이다. `saveManualLabels` [150334,152482) 구간은 9항목 PNG 생성·업로드 후 반환된 이미지 참조를 저장한다. 화면 진입 때 현재 텍스트를 다시 그린 이미지가 저장 결과라는 근거는 없다. 이 정적 계약을 전체 최신 런타임 실행 또는 모든 저장 범위의 동일 동작으로 일반화하지 않는다.

`ProductLabelReferenceEditor`는 검증된 현재 상품·옵션·프로필·자료 시계의 최종 라벨 참조 중 해당 상품이 소유한 저장 파일만 큰 결과 화면으로 보여준다. 기본은 저장된 첫 파일이며 썸네일로 결과를 전환한다. 미저장 교체·제외 선택과 현재 9항목 텍스트는 저장 PNG를 대신하지 않는다. 회사·옵션·자료 시계가 바뀌면 이전 이미지를 숨기고 검증된 현재 참조를 사용한다. 직접 저장한 공란은 공통 이미지로 자동 복원하지 않는다. 기존 다운로드 링크를 유지하고 중복 링크는 추가하지 않았다. 화면 진입·전환은 조회만 수행한다.

## 선택적 이미지 저장 여유 조회

검증된 원문을 받은 뒤 이미지 capacity의 fetch 또는 JSON 본문이 끝나지 않으면 이전 흐름은 초안 반영까지 기다렸다. 새 `fetchCollectionCapacity`는 재시도·fetch·최종 JSON을 포함한 전체 조회에 5초 제한을 둔다. 요청마다 별도 AbortController를 쓰고 부모 취소·타이머·늦은 응답을 정리한다. 진행 중 Promise를 요청 사이에 공유하지 않는다.

수신 결과 화면은 조회 시간 초과 시 원문을 유지하고 상품·옵션만 먼저 저장하는 기존 수동 선택을 다시 사용할 수 있다. 일반 상품추가와 수신 큐는 검증된 원문이 있고 선택적 이미지 조회가 지연될 때 기존 `imageIndices: []` 경로로 초안을 먼저 저장한다. 초기 SEO 작성은 상품 저장 callback에서 한 번만 실행된다. 이미지는 검증된 여유 조회 없이 쓰지 않는다. 결과는 이미지 재시도가 필요한 `failed`와 저장 상품 ID를 유지하며 전체 수집 완료로 바꾸지 않는다.

HTTP 401/403 등 권한 실패는 본문까지 지연돼도 상태를 보존한다. 유효하지 않은 capacity는 성공·초안 우회로 처리하지 않는다. 이미지 재확인에도 같은 제한을 적용하고 다른 endpoint의 기존 3회 재시도 계약을 유지한다. 일반 수집기의 요청 제한·provider·번역·DB 동작은 변경하지 않았다.

`collectIntakeProduct`는 부모 신호와 capacity의 자식 신호를 `AbortSignal.any`로 합친다. 사용자 취소는 초안 생성을 막고 이미지 조회 시간 초과는 부모 작업 자체를 취소하지 않는다. 운영 D1 조회 한도 오류를 정상 원문 수집이나 상품 저장 성공으로 바꾸는 기능은 아니다.

## 검수

서로 다른 관련 검사 209개 통과: 라벨 UI·참조·표시사항 회귀 99, capacity helper·batch·결과 화면 58, 기존 import·batch import·retry 31, 실제 로컬 intake handler·SQLite 연동 21. 실패·중단·skip은 0이다. 앞선 실패 실행이나 중복 재실행은 합계에 추가하지 않았다. 로컬 intake의 9개 기존 모바일 원문 검사는 이 작업공간의 비공개 기록 fixture를 사용한다. 해당 기록이 없는 CI에서는 그 9개가 skip될 수 있으므로 이 숫자를 다른 환경의 통과 수로 표현하지 않는다.

두 회사의 로컬 handler 검사에서 fetch와 본문 시간 초과 각각 상품·옵션 초안 1개 및 초기 작성 1회를 확인했다. 부모 취소 때는 상품 생성·provider·이미지 쓰기 0회를 확인했다. 원문과 회사·카테고리 문맥을 보존했다. 이 검사는 저장된 원문 fixture만 사용하며 실시간 1688 요청이 아니다. 최종 TypeScript와 변경 앱 파일 lint는 오류·경고 0이다. 별도 읽기 전용 검토에서도 중대한 회귀를 찾지 못했다.

사용자의 같은 Chrome 프로필에서 실제 React 컴포넌트를 합성 로컬 데이터로 검수했다. 회사별 실제 800×660 PNG 두 장은 현재 DTO 텍스트와 의도적으로 다르다. 첫 파일·두 번째 파일·재진입·다른 옵션·직접 공란·자료 시계 갱신을 확인했다. 두 회사 proof 모두 8/8 확인, source·PNG hash 불변, 상품 변경·provider·업로드·Hub 호출 0이다. 기록된 이미지의 자연 크기는 800×660이었다. proof와 screenshots는 새 ignored `outputs/step661-label-native-*`에 보관했다. 운영 데이터 또는 실제 Hub 접수 증거가 아니다.

최종 운영 빌드와 산출물 검사 통과. 기존 Worker에 배포하며 extension은 0.2.72 그대로다. DB migration·요금제·인증·기존 상품·기본설정 값을 변경하지 않는다. 배포 버전은 아래 release 기록을 참조한다.

## 운영 전체 흐름의 남은 검증

Step660에서 확인된 D1 무료 일일 읽기 한도 초과는 아직 초기화 전이다. [공식 D1 요금 문서](https://developers.cloudflare.com/d1/platform/pricing/)의 UTC 00:00 초기화는 다음 한국시간 2026-10-15 09:00이다. 반복 운영 조회·플랜 변경·새 DB·인증 완화·관리 API를 통한 앱 조회 우회는 하지 않았다. 이번 로컬 검수와 Worker 배포가 운영 목록 사후 정상 조회를 대신하지 않는다.

새 실상품 전체 SKU·이미지 수집, 모든 카테고리의 동일 기본값과 1~7단계 출력, Supplier Hub 최종 동의·접수·SKU 대조는 남아 있다. 이전 도구가 거절한 1688 URL을 다른 제어 수단으로 우회하지 않았다. 운영 개별 등록 실행 gate는 `false`를 유지한다. 기존 작업 상품은 그대로 보존했다.

## Release

- Baseline: `5f495e3d07df375521527a7b0b2de6bdd2ea573c`.
- Build: `outputs/step661-build.log`, exit 0.
- Deployment: `outputs/step661-deploy.log`, exit 0. Worker `304b08ab-afb7-4488-828a-dfdd6ae4e2dd`, existing `https://sourceflow.jjwwhhjj1116.workers.dev/`.
- Operating post-deploy app/D1 readback remains unverified while the daily read quota is exhausted. Local proofs and deployment success do not establish a real Supplier Hub receipt.
