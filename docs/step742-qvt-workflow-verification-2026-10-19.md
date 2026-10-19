# Step742 — 실제 QVT 조회 구조와 등록 결과 연결

2026-10-19 KST. 기준 commit `c0037ddfbe9df8f71e9bd792957b2cc52255394f`. 기존 작업 상품을 열어 수정하거나 재수집·전송하지 않았다. 이번 변경은 등록 결과를 읽는 두 확장 함수와 확장 배포 버전이다. 신규1688 원문 획득이나 신규 견적 접수 완료를 증명하는 변경은 아니다.

## 실제 화면에서 찾은 두 결함

기존 Chrome4에 새로 만든 연구 탭에서 Couplus 기본설정을 읽고 현재 설정을 저장하지 않은 채 비교했다. 통합환율290·공급마진50·쿠팡마진45·최소공급가3000·10원 반올림·MSRP1.3 등 기존 대조값을 확인했다. 기존 상품은 클릭하지 않았다. 단계별 저장 계약의 retained 비교는 [단계 감사](step742-stage-audit.md)에 있다. 이번 감사에서 추가 단계 편집 결함이 없었다는 결과를 모든 기능의 완성으로 확대하지 않는다.

같은 Chrome의 별도 Supplier Hub 연구 탭에서 `유앤채/A01526306`와 `/qvt/wims` 조회 표를 확인했다. 검색 기본 범위는2026-06-19~2026-10-19, 결과286행·6페이지였고, 연구 탭의 숫자 페이지 링크만 이동했다. 기존 사용자 탭·상품·견적서·약관·전송 버튼은 조작하지 않았다. 두 연구 탭은 자료 보관 후 닫았다.

1. 현재 QVT 페이지에는 일반적인 `aria-current`나 `.active`가 없고 CSS module class와 `a[data-page]`가 있다. 이전 자체 reader는 이 페이지 번호를 읽지 못했다. 실제 보관 pager를 기준 commit의 두 자체 함수에 넣어 단일 조회의 `current:null/hasNext:null`과 회사 조회 오류를 재현했다.
2. 일부 견적서 셀에는 primary UUID와 괄호 안의 별도 `estimationId`가 함께 있다. 이전 함수는 복사 버튼2개를 중복으로 거절했다. 숨은 복사 버튼 때문이라는 최초 fixture 추정은 실제 AX·DOM과 맞지 않아 폐기했다. 두 값은 실제로 모두 표시된다.

현재 공개 QVT JS·CSS의 정확한 화면 링크만 읽어 별도로 보관했다. JS7,220,051bytes SHA256=`9e9ba20c41ffb5a5e2ecafe5833fa8144e1eb371ec633350d79b6b52f4e0e4a6`, CSS51,660bytes SHA256=`fa06d614a42285a174ce40af827de5b3b5875bda7c7bafec35fcc47cb4ef4ab4`. cookies·token을 내보내지 않았고 vendor JS는 실행하지 않았다. 이전 SR artifact를 현재 QVT 마크업의 증거로 사용하지 않았다.

## 수정한 읽기 계약

두 serialized reader 안에서 native pager의 root·유일한 현재 번호·연속 숫자·표시 문자와 data-page·first/last 범위를 확인한다. enabled 숫자 `current+1`을 우선 사용하고 그룹 경계에서도 정확히 다음 번호인 enabled control 하나만 사용한다. `>`는 다음 한 페이지가 아닌 다음 그룹 이동이다. 원문 CSS가 막은 버튼은 강제로 누르지 않는다. 원문에서 총11/current10처럼 다음 한 페이지로 갈 enabled control이 없는 경계는 오류로 멈춘다. 기존 표 갱신·회사·검색조건·동일 origin/path·결과 서명 보호는 유지했다. [원문 및 독립 검수](step742-hub-pager-audit.md).

견적서 셀의 dual-copy 예외는 원문의 직접 부모/자식 구조·각 버튼 표시문자·UUID·괄호 안 숫자·전체 셀 문자가 모두 맞을 때만 인정한다. primary UUID만 quotationId로 반환한다. 숫자 estimationId를 UUID의 별칭으로 매칭하거나 첫 복사 버튼을 무조건 선택하지 않는다. SKU 셀의 다중 복사 버튼 거절은 유지한다. UUID 및 숫자20자리 한도는 관측한 형식에 대한 보수적 허용범위이며 모든 과거/미래 native 형식의 지원 선언이 아니다. [원문 및 독립 검수](step742-quotation-cell-audit.md).

## 검증과 실패 이력

실제 화면에서 보관한6개 table/pager DOM을 자체 serialized 회사 조회 함수의 로컬 격리 환경에서 재생해 **50·50·50·50·50·36행=286행**,6페이지 및 순서2→3→4→5→6을 확인했다. 브라우저에서 새 확장의 query 함수를 실행한 결과가 아니며 재생 중 원격 요청·상품 쓰기는0이다. 기록은 `outputs/step742-observed-replay-proof.json`이다. 원본 업무 행 HTML은 ignored outputs에만 있고 Git에는 합성 식별값으로 바꾼 pager/cell fixture만 포함한다.

새 pager/cell 시험14개는 두 회사·6페이지 이동·그룹 경계·stale 결과·회사/필터 변경·잘못된 링크·중복/모순 ID·legacy alias 제외·SKU 중복 거절을 검사한다. 독립 REA 전문 검수의 추가820상태·회사query10개와 원문 대조는 release 수에 더하지 않았다.

첫 확대 실행은287개 중281통과·6실패, 실행 전후 source SHA 불변이었다. 실패6개는 기존 UI 테스트 도구가 새로 분리된 `.tsx` 컴포넌트를 `.ts`로만 찾는 오류였다. 도구의 로컬 모듈 해석과 순수 함수 컴포넌트의 출력 탐색을 보정했다. 기존 약관·반려 상세·저장 이력 단언을 제거하거나 production 코드를 이 실패에 맞춰 변경하지 않았다. 관련 UI54개가 별도로 통과했다.

최종 동결 실행은 **29개 파일335/335**, 실패·취소·skip·todo0이다. source/fixture1,382개 SHA가 전후 같고 배포 후에도 같았다. TypeScript 전체 검사, 변경11파일 ESLint, mobile collector 자산 검사, 확장 package 검증 및 Cloudflare artifact 검사·빌드가 통과했다. 최초384MiB typecheck는 heap 부족으로 종료했고768MiB 재실행은 통과했다. 최초 fixture lint 오류도 수정 후 통과했다. 실패와 최종 로그를 함께 보관했다. 이335개를 실제 source/Hub 접수 건수로 집계하지 않는다.

## 배포 및 남은 검증

기존 Worker에 `--keep-vars`로 배포했다. 버전은 **`bfa9c96b-d393-43ab-a0cc-97b7f1cb1f23`**이며 DB migration·새 resource·권한·유료 provider 변경은 없다. 확장 **0.2.87**,60files·765,920bytes, ZIP SHA256=`881d936c2a2916b9bfd09ef9e2874c4655bf2ef236fea989d93265652b83ca8e`. 운영 artifact에 포함된 ZIP도 동일하다.

배포 후 기존 Chrome4의 앱을 새로고침해 목록의 `YP-22E079FC`, 옵션6개, 공급4,260원/판매7,100원, 등록대기, 대기열1건 표시 보존을 확인했다. 상품 편집창은 열지 않았다. 이것은 목록 비교이며 전체 DB 시계 검증은 아니다. 화면은 `outputs/step742-deployed-dashboard.png`에 있다.

앱의 읽기 전용 확장 확인은 실제 실행 버전 **0.2.72**와 새 다운로드0.2.87을 보여주었다. Chrome 확장 관리 UI를 도구가 직접 조작할 수 없어 사용자에게 최신 폴더로 업데이트를 요청했다. 사용자 응답과 재확인 이전에 최신 설치가 완료됐다고 간주하지 않는다.

`SINGLE_DOCUMENT_LIVE_VERIFIED=false`, `PRODUCT_DOCUMENT_LIVE_VERIFIED=false`를 유지한다. 신규1688 수집→1~7단계→수정→실제 신규 Hub 접수번호/SKU까지의 전체 live 검증과 전 카테고리 동일성은 **미검증**이다. 이전 사이트 접근 거절 주소를 새 경로·프로그램·확장으로 재시도/우회하지 않았다. 전체 완성률이나 접수 성공을 이번 조회 수정으로 주장하지 않는다.
