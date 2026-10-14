# Step655 — 카테고리 열과 새 견적서 불러오기 연결

2026-10-14. 사용자 Chrome의 쿠플러스와 Supplier Hub를 대조했다. 기존 작업 상품을 불러오거나 저장·수정·삭제·전송하지 않았다. 전체 동일 구현 또는 실제 1688→견적서 접수 완료를 뜻하지 않는다.

## 카테고리 선택 화면

현재 쿠플러스의 카테고리 팝업에서 단계별 열 너비 약251px, 목록 행 높이 약54px를 확인했다. 스포츠/레져 1단계와 2단계가 나란히 표시되며, 최종 카테고리를 선택하기 전에는 대기열에 상품을 추가하지 않는다. 화면 및 측정은 로컬 `outputs/step655-couplus-category.png`, `step655-couplus-category-geometry.json`에 보관했다.

YOOFAM의 실제 Supplier Hub 조회 컴포넌트를 고정 범위220–260px의 나란한 열과54px 행으로 조정했다. 각 열은 별도로 세로 스크롤되며, 하위 열을 열면 가로 영역에서 보이도록 이동한다. 선택 강조, 방향키·Home·End, 회사 변경·오래된 이벤트·동시 조회·언마운트 방어를 검사했다. 최종 분류와 공식 Single 양식을 확인하고 URL 입력으로 이동하는 Step654의 연결 방식은 유지한다.

## 문서번호가 DOM에 없는 실제 불러오기 방식

Step654의 현재 Hub 파일 SHA-256 `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`과 기존 REA Evidence를 재사용했다. 쿠플러스 확장 helper H는 서버 목록의 docId 위치를 찾고 helper J가 해당 행을 불러온 뒤 다음 단계로 이동한다. 원문 실행 코드를 앱에 복사하거나 쿠플러스의 전송을 실행하지 않았다.

실제 Supplier Hub의 중간저장 팝업에서232개 행과 각 행의5개 셀을 읽기로 확인했다. 상품명 span, 카테고리 경로, 로컬 분 단위 저장 시각, 불러오기 버튼, 삭제 버튼 구조이며 `data-doc-id`는 없다. 기존 행의 불러오기·삭제 버튼은 누르지 않았다. 기존 DOM ID 요구는 이 실제 화면에서 사용할 수 없었다.

새 adapter는 자기 요청에서 생성한 새 문서만 다음 순서로 연결한다.

1. 전체 서버 목록의 표시 정보와 공개 DOM의 전체 행 순서를 대조한다. 동일 상품명·경로·분 단위 시각·반려 표시가 중복되면 행을 고르지 않는다. 표시 시각은 로컬 `YYYY.MM.DD HH:mm`, 반려 표시는 `Boolean(remark)`이다.
2. 팝업을 연 뒤 목록을 재조회한다. 목록 변경 시 불러오지 않는다.
3. 불러오기 버튼만 읽기 동작으로 누르는 동안 Chrome의 실제 GET 요청을 관찰한다. 새 docId, 탭, 최상위 프레임, 브라우저 document UUID, 요청 ID, Hub initiator, 정확한 URL·GET·XHR, HTTP200·직접 JSON·캐시 아님을 확인한다. 요청 본문·인증 헤더·쿠키는 요청하거나 보관하지 않는다. 응답 헤더는 Content-Type 검사 후 버린다.
4. 관찰 구간에 adapter 자체 GET을 섞지 않는다. 관찰이 끝난 뒤 자기 새 문서의 get-by-id 본문을 다시 읽고 준비된 본문의 SHA-256과 대조한다. 문서 UUID를 고정한 injection으로 화면 결과를 확인한 다음에만 다음 단계 이동을 허용한다.
5. 중복 요청, 다른 문서·프레임, 리디렉션, 오류·HTML·캐시 응답, 타임아웃, 문서 본문·버전·화면 변경은 진행하지 않는다. 실패·부분 listener 등록 실패·대기 중 callback에서도 관찰을 정리한다.

공식 API 참고: [Chrome webRequest](https://developer.chrome.com/docs/extensions/reference/api/webRequest), [Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting). 네트워크 메타데이터는 응답 본문이나 React 내부 적용을 증명하지 않는다. 별도의 새 문서 원문 조회와 공개 화면 대조가 필요하며, 이번의 실제 새 문서 불러오기 성공은 아직 관찰하지 않았다.

실제 UI에서 회사 메뉴를 열면 회사코드가 보이지만, 중간저장 팝업을 열면 메뉴가 닫혀 코드가 사라지는 것도 확인했다. 각 injection은 먼저 실제 코드를 확인한다. 같은 문서에서 클릭 후 메뉴가 닫히면 현재 승인 회사의 정확한 헤더 버튼을 대조한다. 처음부터 코드가 없거나 코드·회사명이 바뀌면 진행하지 않는다. 두 회사의 메뉴 닫힘 회귀와 회사 변경 차단을 검사했다.

## 동의와 접수의 확인 범위

한국어 MSRP·라벨 동의 문구와 KR/TW 설정은 Hub의 로컬 번역 resource Nc에 들어 있다. REA Evidence `ev_ad6079002eb8e54c2ffb2aec03b1f4cc27263deb155f0890f033a046182418a8`:5개 파일 parse5/5, AST200, semantic unknown56. Nc 원문 구간[2632737,2734525), resource31개 키는 로컬 `outputs/step655-hub-korean-resources.json`과 manifest에 보관했다. 이 결과는 정적 분석이며 현재 사용자의 약관 확인·동의나 접수 관찰을 의미하지 않는다.

`agreeMSRPTerm`은 상품정보 단계, `agreeLabelContact`는 이미지 단계의 별도 확인이다. HTML required가 없어도 미동의 항목에서 멈추며 자동 체크하지 않는다. 중간 약관의 현재 확인과 최종 문서별 접수·SKU 연결은 남아 있다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false`를 유지한다. 완료 문자열만으로 성공·등록완료를 표시하지 않는다.

## 검사 및 배포

관련 검사: 최종 코어·카테고리·관찰173/173, 확장·미리보기·Single 투영117/117 모두 통과(fail/skip0). 두 그룹에 겹치는10개 카테고리 검사는 별도 실행으로 기록했다(고유280개, 총290회). global TypeScript 통과, 변경 lint 오류0(기존 intake `onBusy` 의존성 경고1), 운영 빌드 및 ZIP·산출물 검사 통과. 초기 ZIP 불일치·Windows realpath 차단과 새 회귀 기대값 실패는 수정 후 재검증했고 성공 집계에 넣지 않았다. 모의 테스트는 실제 사이트 접수 검증을 대신하지 않는다.

확장0.2.68:47파일,633,352bytes, SHA-256 `fac4924b818f8eafa33a7cacbf5147524088cc45f03c499f52d02a5b21cc668b`. 이전 ZIP과 기존 DB·계정별 설정·D1/R2/Access·무료 번역·무료 AI 정책을 유지한다. 사용자 Chrome의0.2.68 reload를 확인했다고 주장하지 않는다. 카테고리 화면은 서버 변경으로 검수한다.

최종 운영 배포 **`18e3d6d4-da04-4328-8717-7f5384bf33c4`** 완료. 같은 Chrome의 앱에서 실제 Supplier Hub 1단계16개, 스포츠/레져 하위19개, 헬스/요가 하위3개를 조회했다. 세 열 너비260px·행 높이54px·독립 스크롤과 방향키 하위 이동/focus를 확인했다. 최종 leaf 선택·새 profile 저장·URL 수집 시작·견적 전송은 누르지 않았다. 기존 `YP-22E079FC` 미선택과 기존 옵션·금액·이미지 상태, 대기열의 두 URL 보존을 확인하고 팝업을 닫았다. 운영 스크린샷 `outputs/step655-production-category.png`, proof·queue·preservation JSON에 보관한다. 소유 분석 탭은 종료하고 운영 앱 탭을 유지했다.

실제 새1688 원문 수집, 모든 카테고리 기본값, 중간 동의, 최종 접수는 미완료다. 기존 작업 상품으로 이 검증을 대체하지 않는다.
