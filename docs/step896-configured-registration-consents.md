# 회원·회사·계정별 등록전송 동의

명시적인 `등록전송` 버튼을 실제로 누른 한 요청에서, 회원이 이전에 전문을 확인하고 저장한 동일한 두 약관을 자동 적용한다. 기존 회사 허용 범위인 유앤채(`A01526306`)와 와이홉(`A01464742`)에 한정하며, 임의의 새 회사나 다른 Hub 회사로 범위를 넓히지 않는다.

확장 격리 스크립트는 신뢰할 수 있는 버튼 클릭을 15분 동안 원래 회원·회사·상품·요청 UUID·패킷·본문 해시에 연결한다. 각 단계는 별도의 120초 challenge를 사용한다. 페이지가 보낸 boolean, 합성 클릭, 초안 준비 버튼, 저장된 약관만으로는 전송 의도가 생기지 않는다. Hub 탭이 앞에 있어 앱이 가려진 동안에도 이미 시작한 자동 처리는 계속할 수 있다. 최초 클릭과 기존 수동 동의창에는 화면 표시와 실제 클릭 요건이 유지된다.

자동 적용 전과 후에 현재 앱의 인증된 원본을 확인하고 `/api/supplier-hub/registration-consents`를 독립적으로 다시 읽는다. 회원·회사·현재 actor의 이메일/역할/credential version, 사용 중인 Supplier Hub 계정의 ID/revision, 비밀번호 보관 여부, 사용 중인 정책의 revision, 화면에서 읽은 제목·안내·약관 전문의 SHA-256이 모두 같아야 한다. 현재 유효한 두 정책이 완성된 계정이 하나일 때만 그 계정을 선택한다. 여러 계정이 모두 완성돼 있으면 수동 확인으로 돌아간다. 이전 계정의 중지되거나 오래된 정책은 새 계정의 완성된 정책을 방해하지 않는다.

가격 정보와 연락처 약관은 알려진 두 종류만 인정한다. 새로운 종류 또는 바뀐 문구는 자동 승인하지 않는다. 내용이 없는 물류 단계의 최종 제출은 같은 클릭·문서·계정·정책에 대한 앞선 두 단계의 자동 적용 증거가 모두 있어야 한다. 완료·취소·만료된 의도와 이미 소비한 challenge는 재사용하지 않는다.

설정에 따른 증거는 `consentProof.kind = configured-policy`로 저장하며, 새 `humanConfirmedAt`을 만들지 않는다. 기존 직접 확인 흐름, 현재 읽기로 복구한 문서의 쓰기 차단, 공식 다음/동의/등록 버튼, 미확정 응답의 읽기 복구 및 실제 QVT 접수 확인은 유지한다. `configuredRegistrationConsentAvailable`은 새 네이티브 전체 상품 preview에서만 true이다.

검증 명령:

```powershell
node --test tests/configured-registration-consent.test.mjs
node --test tests/supplier-hub-single-confirmation.test.mjs tests/supplier-hub-single-client.test.mjs
node --test tests/native-prepared-draft-lifecycle.test.mjs tests/supplier-hub-product-source.test.mjs
```

구성된 동의 검사는 격리 스크립트의 클릭 위조·재사용·만료·회원/회사 변경·원본 변경·철회·계정 revision 변경·약관 변경 차단과 영속 단계 증거를 다룬다. 두 회사의 통합 검사는 실제 앱 원본 핸들러, 격리 스크립트, 브라우저 어댑터, 공식 단계 버튼 코드를 로컬 Chrome/Hub 대역 위에서 실행하여 한 번의 문서 접수까지 확인한다. 이 문서와 검사는 실제 브라우저 전송이나 운영 데이터 변경을 실행하지 않는다.
