# Step788 · 수집 전송 완료 판정과 CLI 경로 확인

2026-10-22, 기준 commit `46c5efae70a893fa9f67179a76008b232fc37670`. 기존 Chrome 3과 운영 앱을 사용했다. 실제 기존 상품 두 건의 편집·삭제·전송은 하지 않았다.

## 실제 수정

- 수집 버튼은 확장 보관만 된 `delivered:false`도 수집 완료로 표시했다. 이제 앱 저장 확인이 있는 `delivered:true`만 완료이며, 실패 이유와 **앱 전송 다시 시도**를 표시한다. 재시도는 최초 클릭의 원문을 유지한다. 상품 URL이 바뀌면 이전 보관본으로 현재 상품을 완료 처리하지 않는다. 잘못된 완료 응답도 거절한다.
- 같은 탭·같은 상품의 요청이 진행 중일 때 회사가 바뀌면, 새 요청이 이전 회사의 완료 결과를 공유할 수 있었다. 진행 중 요청의 최초 수신 회사 문맥을 공유 전과 응답 뒤에 다시 확인한다. 다른 회사로 다시 저장하거나 기존 보관본의 소유자를 바꾸지 않는다.
- 수집기 생성 원본과 생성물을 함께 갱신했다. 통합 확장·다운로드·최소 버전 안내는 **2.1.21**이다. 권한과 허용 호스트는 그대로다.

## 운영 적용과 Chrome 검수

실제 로드 폴더의 95개 파일을 별도 백업하고 새 90개를 복사했다. 삭제0, Chrome 프로필·저장소 접근0. 처음 앱이 응답받은 버전은2.1.20이었다. 사용자의 새로고침 완료 답변 뒤 앱 문서를 새로 읽고 연동 설정에서 **2.1.21**을 확인했다. 파일 버전과 실행 버전을 구분한다.

ZIP은90개 파일/1,122,174bytes, SHA-256 `613bc3ee2cb08b4fe53c3712ce7fc79d921b92f0abb60cd77ccf4a51f76876ce`다. 이전2.1.20 ZIP은 보존했다. 기존 Worker 배포 버전은 `39b7c6b3-4c90-495d-849f-4c790641d45c`다. 새 DB·migration·권한·Access 정책·AI 공급자 설정은 만들지 않았다.

별도 localhost의 명시적인 합성 상품과 실제 생성된 수집기·savePageSource·source-inbox API·SQLite를 사용했다. 실제1688/Hub/운영 상품 자료는 사용하지 않았다. 첫 trusted 클릭은 실제 로컬 수집함 저장 뒤 ACK 지문만 불일치시켜 확장 보관1개와 재시도 버튼을 확인했다. 화면 제목·가격을 바꾼 뒤 다시 클릭해 최초 원문5.30이 그대로 전송되고 중복 ACK를 받은 것을 확인했다. 마지막 수집함은1개, 확장 보관0개, 보호 합성 원본·복제본의 해시는 불변, 외부 요청0개다. closed shadow 버튼은 화면을 확인하고 좌표로 클릭했으며 브라우저 실행 코드 주입은 하지 않았다. 검수 탭과 소유 서버는 종료했다.

증거: `outputs/step788-runtime-2.1.21.png`, `step788-collector-retained.png`, `step788-collector-retry-complete.png`, `step788-button-root-qa/phase-first.json`, `phase-final.json`.

## Couplus와 탈환의깃발의 실제 차이

사용자 질문에 따라 REA 보관 Evidence2개를 실제 재열람하고 source11개·범위30개의 SHA를 확인했다. 새 producer를 반복하지 않았다. 지정 로컬 archive는1.3.24이며, 별도로 보관된1.3.37 분석과 버전을 혼합하지 않았다. 상세 근거는 `outputs/step788-cli-findings.md`, `step788-cli-proof.json`, `step788-cli-rea-reuse.json`에 있다.

보관된 Couplus 웹은 URL의 상품번호를 자체 `/api/aiPage/getProductInfo`에 전달하고, 구조화 원문을 받은 다음 확장 `GET_PRODUCT_INFO`에 넘긴다. CLI는 원격 catalog/recipe와 로컬·HTTP·페이지 작업을 연결한다. 패키지가 서버의 상품정보 공급자 전체를 포함하는 것은 아니다. 원본 서버 내부의 공급자·캐시·현재 recipe는 이 정적 분석으로 알 수 없다.

다른 대화 **「탈환의깃발 실행하기」**의 최근 명령 요약도 읽기 전용으로 확인했다. 실제 설치 CLI의 `sourcing-image-search-by-1688`, `sourcing-offer-detail-by-1688` 실행·결과 저장과 등록 상태 조회 기록이 있다. 이 대화에서는 그 명령을 실행하지 않았고 다른 대화에 메시지를 보내거나 상품 자료를 이전하지 않았다. 제품 사실 없이 명령명·종료코드만 보관한 근거는 `outputs/step788-talhwan-readonly-observation.json`이다.

따라서 CUA의 직접 본문 읽기 제한과 다른 대화의 Couplus CLI 실행은 서로 다른 경로다. YOOFAM에는 RS형 현재 페이지 수집·수집함과 공식 API connector 소스가 있지만 **Couplus CLI 전체 복제나 동등한 운영 상품 공급 연결이 완료된 상태는 아니다**. 비어 있는 중계 CLI를 더해 이 공백을 해결했다고 보고하지 않는다.

## 검증 결과와 남은 실제 경계

관련15개 고유 테스트 파일 **201/201**, fail/skip/cancel0. worker의 중복 검사는 합산하지 않았다. 타입 검사·변경 파일 lint·생성물/ZIP 검사·운영 빌드·diff 검사를 통과했다. 원본 pending 소유자 버그가 재현되고 수정 뒤 통과하는 negative control도 별도로 확인했다(도구 출력 chunk `11b6ab`; 독립 로그 파일 없음). 테스트 목록과 최종 commit/push 정보는 `outputs/step788-final-validation.json`에 있다.

사용자가 새 검수 URL **886034098637**을 지정했다. 앞서 detail.1688.com 관측을 거절한 브라우저 site-safety 경계는 다른 CLI·확장·서버·캐시로 우회하지 않았다. 이번에는 그 새 URL의 원문을 확보하거나 신규 실상품 초안·실제 Hub 접수를 완료하지 못했다. 이 제한은 앱 수집기의 실제 HTTP 실패를 관측했다는 뜻이 아니다. 일반 single/product live-verified=false와 동의 확인 경계도 유지한다. 합성 버튼 검수·빌드 통과를 실상품 전체 과정 또는 모든 UI의 완전 동등성으로 보고하지 않는다.
