# Step699 — 신규 초안의 첫 브랜드 연결

2026-10-18 KST. 기준 `55e0f8206a74bf02aa28092e49986274dc4c10b3`. 보관한 Couplus 초기 상품/SEO callback과 자체 신규 초안 저장 흐름을 대조했다. 기존 작업 상품·계정 기본설정은 변경하지 않았다.

## 확인한 차이와 수정 범위

기본설정은 쉼표로 여러 브랜드를 보관할 수 있다. Couplus의 신규 상품 생성과 SEO 초기화는 첫 번째 구간을 브랜드로 사용한다. 자체의 견적서 brand와 나중에 여는 SEO 화면은 이미 첫 브랜드를 사용했지만, 최초 번역 적용 API가 보관한 설정 전체 문자열을 자동 제목 구성에 전달했다. 따라서 예를 들어 `와이홉 첫브랜드, 둘째브랜드` 설정에서 견적서 brand는 `와이홉 첫브랜드`, SEO·연결 품명·견적 상품명은 `와이홉 첫브랜드, 둘째브랜드 …`로 달라졌다.

사전 양사 격리 검수에서 실제 신규 초안 핸들러를 각19회 호출해 이 불일치를 재현했다. 합성 공급 원문·결정적인 번역 응답·임시 SQLite/R2를 사용했으며 실제1688·번역 서비스·Hub를 호출한 증거가 아니다. `outputs/step699-settings-brand-probe.json`에 수정 전 소스 SHA와 결과를 보존했다.

수정은 `translation-apply`가 captured default brand를 자동 초기 초안에 전달하는 한 경계에 한정한다. 첫 쉼표 구간을 trim해 일반 통합 번역 적용과 Google 최초 SEO guidance가 같은 값을 쓰게 한다. 첫 구간이 공란이면 뒤 브랜드를 대신 선택하지 않으며, 캡처한 설정 자체가 없으면 기존 undefined 의미를 유지한다. 설정·collection context·공급 원문·번역 결과 원본을 정규화해서 다시 저장하지 않는다.

이후 사용자가 직접 입력한 SEO 브랜드 메모의 쉼표·공란이나 수동 상품명·연결을 끈 품명을 변경하는 수정이 아니다. 현재 설정으로 과거 상품을 소급 보정하거나 다른 회사 이름을 브랜드로 추론하지 않는다. frontend는 raw 설정을 접수 context로 보관하고 첫 브랜드로 SEO를 초기화하는 기존 동작을 유지한다.

## 검수 경계

정적 원본의 관찰·정확 범위/digest와 독립 검토는 별도 REA audit에 기록한다. 이 변경만으로 전체 카테고리·1~7 UI·외부 번역·실제 신규1688 수집·Hub 동의/최종 접수번호·SKU 대조가 완료됐다고 표현하지 않는다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`와 운영 전송 gate를 유지한다.

## 최종 검수

관련 고유9파일133개가 통과했다(기존8파일128·신규 통합5). 별도 backend 기존12개, 독립 initializer10개와 UI8개 probe는 중복 합산하지 않았다. 양사 Workers/Google4개 흐름에서 129자 설정 목록의 첫 브랜드만 최초 SEO·연결 품명·견적 상품명/brand와 다시 연 실제 SEO component에 반영됐다. 기본설정 원문·수집 context·공급 제목·번역 결과 원본·다른 회사·R2는 보존됐다. 빈 첫 구간3경계와 수동 공란/연결 해제 품명, 직접 입력한 쉼표 브랜드 메모도 유지됐다.

Workers 양사 각각6개 포함 옵션은 보관 원본 XLSX의 상품명·brand 열까지 대조했다. 기록된 유앤채2624 양식(SHA `58335f443503cc386521b6d2a78fa46c63b0735e68ec21cf7c9a156c0aa9bee6`)을 와이홉 격리 검수에도 재사용했으며 새 공식 양식 capture가 아니다. Google은 기존 공개 JSON-LD/번역 계약을 따르는 합성 응답을 실제 자체 핸들러에 공급했다. 최초 Google fixture의 본문 누락으로422가 난3건은 앱 결함으로 계산하지 않고 fixture를 고쳤다. unused import lint 경고도 제거 후 신규5개와 lint를 재실행했다. 첫 실패/경고 로그는 보존했다.

TypeScript768MiB·app/db lint384MiB·신규 MJS lint·fresh/repeated memory schema44tables17indexes29modules·bounded production build 모두 exit0다. 최종 verifier는17개 소스 SHA·실제 TAP·증거·배포 버전을 대조하며 `outputs/step699-final-validation.json`에 결과를 기록한다. 전체 repository suite·네이티브 브라우저 렌더링·외부 provider 실행·신규 Hub 접수 검증으로 확대하지 않는다. Chrome은 기존 목록 metadata를1회 확인했으며 탭 선택/제어/생성은0이다.

기존 무료 Worker **`dddacc73-8eda-4152-aa2d-a66d0c171683`** 배포 exit0, `outputs/step699-deploy.log`, https://sourceflow.jjwwhhjj1116.workers.dev/. 신규 리소스·유료 플랜·DB migration·OAuth/R2 권한·확장/ZIP 변경은 없다. 준비 확장0.2.75·마지막 확인 설치0.2.64를 유지하며 기존 작업 상품을 소급 수정하지 않았다. 최종 대조는 배포 후에도 통과했다.
