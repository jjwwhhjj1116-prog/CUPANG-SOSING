# 원래 읽기 복구 문서의 암묵적 저장 차단

공식 SR의 Next/Submit 버튼은 단순한 이동·제출 버튼이 아니다. 먼저 전체 본문을 저장하고, 단계 검증 또는 최종 등록 동작으로 이어진다. 이전 합성 통합 검수는 이 vendor 버튼의 저장 부작용을 모델링하지 않았으므로, 그 통과 결과만으로 본문 재전송 없는 접수를 보장한 것은 잘못이었다. 실제 문서 2347603에는 해당 버튼을 실행하지 않았다.

정확한 출하 코드 범위·SHA·REA Evidence와 최종 요청의 계약은 `step880-native-next-save-side-effects.md`에 기록했다. 최종 `/sr/qvt/api/validate-single-product`는 읽기 전용 사전검사로 취급할 근거가 없는 최종 등록 흐름의 동작이다. 본문을 저장하지 않고 동의 플래그만 서버에 전달하는 별도 계약은 확인되지 않았다.

## 수정

- `currentReadRecovery`가 있는 원래 읽기 복구 문서는 adapter의 navigate/submit 진입에서 `SAVED_DRAFT_NATIVE_BUTTON_WRITE_BLOCKED`로 중단한다. 이 단계는 기존 문서를 새로 불러오거나 이동시키기 전이다.
- 직렬화된 Next 함수는 매 단계에서 최신 소유 문서 기록을 다시 읽고 `nextOperations`와 버튼 클릭 전에 같은 조건을 검사한다.
- 직렬화된 Submit 함수도 `submitProof`, `submitOperationId`, 상태 기록과 버튼 클릭 전에 중단한다. adapter 확인 이후 기록이 바뀌는 경우까지 포함한다.
- `currentReadRecovery`가 없는 정상 신규 문서의 기존 동의·전송 흐름은 유지한다. 일반 문서에 읽기 복구 권한을 새로 부여하거나 제약을 완화하지 않았다.
- 이전 `saved-draft-recovered-lifecycle` 검수는 3개 옵션의 현재 문서 읽기 복구·검증 2~5까지 확인한 후, 공식 버튼에서 명시적으로 차단되는 검사로 교정했다. 합성 버튼은 클릭되면 실제 공식 코드와 같이 본문 update와 최종 endpoint 요청을 발생시키도록 모델링해 금지 동작의 부재를 검사한다.

## 검증과 배포

관련 네 파일의 59개 검사를 통과했다: `supplier-hub-single-document-adapter`, `native-prepared-draft-lifecycle`, `saved-draft-target-adapter`, `saved-draft-recovered-lifecycle`. 정상 신규 문서의 합성 완료 경로, 원래 3개 옵션의 검증 뒤 차단, 모든 전진 단계와 최종 제출의 표식·클릭 부재, 뒤쪽 옵션 검증 실패를 포함한다. 독립 검토에서도 추가 결함은 발견하지 못했다.

TypeScript, 변경 ESLint, diff, 확장 생성물·ZIP 검사, 운영 빌드가 통과했다. 코드 커밋 `fff7f4c`, Worker `57206fef-b320-4f9b-b758-8eed537ea6ff`로 배포했다. 주요 네 소스는 Git archive의 LF와 작업 파일 CRLF만 정규화한 후 동일하다.

확장 2.1.67은 113개 파일, 1,650,699바이트이며 ZIP SHA-256은 `7391ad01ed46d42f5041f13e28f8fb0a128ddec9091db6e7df8b705d080a3067`이다. 기존 실제 폴더의 2.1.66을 백업한 뒤 갱신했고 전체 파일 해시가 소스와 일치한다. 권한·호스트·요금·AI 모델 변경은 없다.

원래 D1 자료의 첫 SELECT 비교는 일반 쿼리 오류로 끝났다. 원문을 노출하지 않는 오류 분류를 보완한 뒤 동일한 고정 범위 SELECT를 한 번 다시 실행해 35개 표·47행이 이전과 같은 SHA-256 `39f1f5b9ff48173e6d68b0e8d9689aac8eb587f2fb469a0ed6b2984913a3455d`임을 확인했다. 운영 상품·견적·회사 설정, Hub 문서·파일·본문·동의·검증·제출은 변경하지 않았다.

## 확장 적용과 다음 실제 검수

현재 Chrome의 새 YOOFAM 탭에서도 실제 확장 응답은 2.1.64다. 배포 ZIP·보관본의 PING, 브리지 명령, popup, worker를 대조해 이 버전에는 self-reload/update 적용 경로가 없음을 확인했다. 웹 F5만으로 디스크 수정본을 실행 버전에 적용할 수 없다.

설치 메타데이터를 읽기 전용으로 확인한 결과 YOOFAM 항목은 Default 프로필의 `jcdjgeibdaicinplfgbkepkhjmbipnno` 한 건이며, 경로는 `C:/Users/7500F/Documents/Codex/2026-10-05/new-chat/outputs/YOOFAM-FLUS-v2-2.0.1/YOOFAM-FLUS-v2`, 디스크 manifest는 2.1.67이다. 활성 상태를 나타내는 메타데이터는 없어 이 읽기만으로 enabled 여부를 확정하지 않는다. 실제 PING은 별도의 응답 근거다. 계정·쿠키·기록은 출력하지 않았고 Chrome 메타데이터는 수정하지 않았다. 현재 근거로 잘못된 폴더가 원인이라는 주장은 지지되지 않는다.

사용자에게 확장 새로고침을 요청했다. 2.1.67 실행을 확인한 뒤 원래 요청/문서의 본문·첨부 전체 읽기 대조부터 진행해야 한다. 알려진 인증서 첨부 1건과 본문 불일치를 임의로 무시하지 않는다. 현재 읽기 복구의 공식 Next/Submit은 차단되어 있으며, 실제 접수로 진행하기 위해 본문 저장이 필요하다면 실제 대조 결과로 변경 범위를 먼저 제시하고 기존 재전송 금지 조건의 변경을 확인해야 한다. 그 승인을 추정하지 않는다. 실제 접수는 미완료다.
