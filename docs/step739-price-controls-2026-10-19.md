# Step739 — 2단계 가격 입력 변경과 견적서 재계산 연결

2026-10-19 KST. 기준 commit `28649d4784a517049cc6999685c09ae10c2a1699`.

## 해결한 차이

기존 화면에서는 환율·마진·최소액을 바꾸고 저장해도 최초 수집 때의 마진 하한 방식이 남았으며, 별도 ‘일괄 재계산’ 버튼을 눌러야 쿠플러스 2단계 방식으로 바뀌었다. 원가20 CNY, 환율400, 공급마진50%, 쿠팡마진40%, 최소마진3,000 ON, 10원 반올림에서 이 차이는 공급가/판매가 **16,000/26,670원 대 11,000/18,330원**이었다.

쿠플러스 보관 source의 `updatePricing`은 정책 control change 후 일반 옵션들을 다시 계산한다. 최소마진 ON이면 원가에 최소액을 직접 더하며 ON·0도 같은 분기다. 일반 경로에는 직접 입력한 공급/판매가를 별도로 보호하는 flag가 없다. 정확한 범위·SHA·기존 REA Evidence와 수정 전 재현은 [독립 원본 감사](step739-price-audit.md)에 있다. 고정 소싱 판매가 경로는 별도이며 이번에 그 기능까지 새로 복제했다고 주장하지 않는다.

환율·공급/쿠팡 마진·최소액·MSRP 배수·처리 단위/방식·통합통관 환율·최소마진 토글의 변경을 같은 로컬 재계산 intent로 연결했다. 별도 버튼 없이 미리보기와 옵션별 재계산 범위를 보여주고, **명시 저장할 때만** 기존 가격 API의 `recalculate:true`로 현재 카테고리의 가격 alias와 MSRP sidecar를 원자적으로 갱신한다. 저장 시 직접 입력한 공급가·판매가·권장소비자가도 바뀐다는 안내를 표시한다.

최초 로딩과 단순 조회에서는 정책에 mode를 추가하거나 가격을 저장하지 않는다. 사용자가 선택한 기존 올림 방식은 유지하고 nearest 선택에는 기존 Couplus Number 계산을 적용한다. 옵션 원문·원가·재고·묶음 수량·포장 측정치·이미지·가격 외 견적 입력·다른 카테고리·제외/이전 옵션의 독립 기록은 바꾸지 않는다. 초기 수집 계산 엔진과 legacy API의 명시 재계산 없는 저장 계약도 유지했다.

독립 검수에서 발견한 이전 disabled callback 문제도 수정했다. 화면이 잠긴 뒤 과거 callback을 호출해도 최신 ref로 change/submit/버튼을 차단하고, 최소마진 토글의 부수효과 전에 검사한다. scope 변경, 저장 중 동기 잠금, 중복 submit, 실패 시 draft·intent 보존과 취소/최신 정책 불러오기 경계를 검수했다.

## 검증과 배포 기록

최종34개 파일의 **400/400 테스트 통과**, 실패·취소·skip·todo는0이다. TypeScript, 변경 파일 ESLint와 운영 빌드도 통과했다. 마지막 회귀 실행에서 앱/DB/확장/스크립트/테스트1,370개 source SHA는 바뀌지 않았고, 배포 대상 client/SSR에는 새 가격 교체 안내가 포함됐다. 독립 검토와 현재 runtime source SHA도 일치했다.

최종 결과는 `outputs/step739-related-release-proof.json`, source 동결은 `outputs/step739-related-release-freeze.json`에 보관한다. 실제 React callback과 로컬 API/SQLite/R2를 사용해 두 회사·일반/통합통관 환율·묶음 수량의 변경을 7단계와 보관 공식 XLSX의 가격 열29/30/31까지 대조했다. 와이홉의 workbook 검수는 유앤채 보관 양식의 공개 계약을 격리 fixture에서 재사용한 것으로, 와이홉 최신 양식을 새로 취득한 증거는 아니다.

최초 넓은 회귀에서 기존 두 테스트 loader가 공통 `.mjs` 진단 모듈을 `.mjs.ts`로 읽는 오류10건과, 새 control trigger 이전 기대값2건을 발견했다. loader는 실제 모듈에 연결하고 ON·0 기대를 새 명시적 입력 의도에 맞췄다. 이전 실패 로그를 보존하고 해당21개 검사를 통과한 뒤 전체 검사를 다시 실행했다. legacy API 무재계산 계약 검사는 실제 API를 직접 호출하고 부모의 저장 정책을 갱신하도록 fixture를 고쳤으며, 새 UI 동작은 별도 통합검사로 확인한다.

최종 독립 component 검수10개는 release 테스트 수에 합산하지 않는다. 기준 source5개의 SHA와 검수 결과는 `outputs/step739-price-final-review.json`에 있다. 앱 runtime 변경은 `price-editor.tsx`뿐이며 가격 엔진·저장 API·견적 transaction·확장 권한은 변경하지 않았다. 확장은0.2.86을 유지하며 새로고침을 요구하지 않는다.

## 실제 사이트 확인 범위

기존 Chrome4에서 별도로 연 검수 탭 `727933990`으로 Supplier Hub dashboard에 실제 접속했다. 회사 메뉴의 **유앤채 / Company Code: A01526306**를 확인했으며 앱의 관리자 회사와 일치했다. 새 탭은 읽기만 하고 닫았다. 회사 확인의 AX 기록은 `outputs/step739-hub-company.txt`다. 그 탭의 screenshot은 CDP timeout으로 저장하지 못했으므로 screenshot 증거로 표시하지 않는다. 기존 Supplier Hub·Couplus 사용자 탭은 가져오거나 조작하지 않았다.

앱 상품추가 modal에서는 기존 카테고리/URL 입력 구조만 읽고 닫았다. 입력·행·설정·작업 상품을 수정하지 않았고 수집/전체 시작/견적 전송을 누르지 않았다. 배포 후의 기존 상품 목록 확인은 별도 screenshot과 `outputs/step739-final-validation.json`에 기록한다.

기존 Worker의 변수·데이터 구조를 유지해 버전 `ce37f0d9-6b92-4073-a989-378c677f70d1`을 배포했다. 기존 앱 탭 `727933758`을 새로고침한 뒤 `YP-22E079FC` 1건, 대기열1건과 기존 상태가 표시되는 것을 확인했다. `outputs/step739-deployed-dashboard.png`는 이 목록 보존의 증거이며 새 수집·견적서 접수의 증거가 아니다.

**실제 Supplier Hub 접속 확인과 견적서 접수 확인은 다르다.** 새 1688 원문의 실수집과 최종 신규 견적서 접수·qvt/SKU 연결은 미검증이다. 지정 1688/Open1688 주소의 이전 site-safety 거절을 재시도·우회하지 않았다. 두 native live gate는 false를 유지하며, 이 가격 수정으로 전체 워크프로세스가 완료됐거나 실제 전송이 성공했다고 보고하지 않는다. 운영 상품·기존 견적 문서의 create/update/전송은0건이다.
