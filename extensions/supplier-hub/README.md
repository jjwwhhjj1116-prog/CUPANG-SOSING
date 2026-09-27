# YOOFAM PLUS Supplier Hub 첨부 연결 — 0.2.2 개발 버전

YOOFAM PLUS가 생성한 **견적서 + 첨부 ZIP**을 읽어 현재 Supplier Hub 대량 등록 탭의 Excel, 상품 이미지, 라벨 입력에 파일을 전달합니다. 공식 API 주소를 추측하거나 로그인 쿠키를 복사하지 않습니다.

## 현재 범위

- 앱의 원본 비압축 ZIP 형식, 파일 CRC, 견적서 SHA-256, 목록과 파일명 일치를 확인합니다.
- XLSX만 견적서로 전달하며 포함 옵션에 라벨이 빠져 있으면 중단합니다.
- 현재 창의 활성 `https://supplier.coupang.com/qvt/registration` 탭에서만 실행합니다.
- 실제 화면에서 관찰한 구역 제목으로 입력을 찾습니다. 기존 첨부, 중복 구역, 비활성 입력이 있으면 변경 전에 중단합니다.
- 파일 선택의 `change` 이벤트를 전달합니다. 이는 Supplier Hub의 서버 업로드 성공을 의미하지 않습니다.
- 부분 실패 또는 결과 불명 시 재시도하지 않습니다. 입력이 변경되었을 수 있으므로 실제 첨부 목록을 먼저 확인해야 합니다.
- 파일 전달 후 같은 화면에서 필수 동의와 파일명 표시를 확인하고, 활성화된 파일 검증 버튼을 명시적으로 실행할 수 있습니다. 검증 요청은 검증 성공이나 등록 완료를 뜻하지 않습니다. 중복 검증 요청은 차단합니다.
- 약관 자동 동의, 법적 서류 해당없음 선택, 최종 등록, 접수번호 저장은 **아직 구현하지 않았습니다**.
- 웹페이지의 `Supplier Hub 확장으로 파일 준비` 버튼으로 검토된 ZIP을 확장에 직접 저장할 수 있습니다. 기존 `/api/supplier-hub` POST와 최종 등록은 여전히 미구현 상태입니다.
- 앱의 지정된 운영 도메인과 localhost:3000/127.0.0.1:3000에서만 준비 메시지를 받습니다. Chrome 프로필 내 확장 전용 IndexedDB에 패키지 하나를 보관하고, 새 준비 시 교체합니다. 15분이 지나면 사용할 수 없으며 다음 확장 실행 시 삭제합니다. 전달 시도 전에 한 번만 소비하므로 종료·응답 유실 후 자동 재전송하지 않습니다.

## 개발 설치·확인

1. 사용자가 지정한 Chrome 프로필에서 `chrome://extensions`의 개발자 모드를 켜고 이 폴더를 압축해제된 확장으로 로드합니다.
2. Supplier Hub에서 **기존 작업 파일이 없는** 대량 상품 등록 화면을 엽니다.
3. 설치 후 앱 페이지를 새로고침하고, 견적서를 검사한 다음 `Supplier Hub 확장으로 파일 준비`를 누릅니다. 같은 Chrome의 Supplier Hub 탭에서 확장을 열면 파일이 자동으로 준비됩니다. ZIP 직접 선택도 가능합니다.
4. 현재 회사 계정과 파일 목록을 확인한 후 `현재 탭에 파일 전달`을 누릅니다.
5. Supplier Hub의 실제 업로드 결과와 필수 동의 내용을 확인합니다. 동의 항목을 직접 체크하고 확장의 `첨부한 파일 검증 요청`을 실행합니다. 최종 등록은 별도입니다.

관찰한 DOM 구조를 재현한 테스트와, 동일한 Chrome의 전용 localhost 테스트 페이지에서 실제 IndexedDB 저장·교체·동시 소비 7개 검사를 통과했습니다. 확장 자체의 실계정 파일 업로드·검증·등록 시험은 수행하지 않았고, 사용자가 0.2.1 설치 완료를 알려주었습니다. 0.2.2 변경분은 확장 새로고침 후 적용됩니다. 작업 중인 기존 상품을 시험에 사용하지 않습니다.

## 근거와 테스트

- 2026-09-27 기존 로그인 Chrome의 Supplier Hub 대량 상품 등록 화면에서 제목을 가진 각 구역에 `input[type=file]` 하나씩 있는 구조를 확인했습니다.
- [Chrome scripting 공식 문서](https://developer.chrome.com/docs/extensions/reference/api/scripting), [activeTab 공식 문서](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).
- `node --test tests/supplier-hub-extension.test.mjs tests/supplier-hub-handoff.test.mjs`
- 테스트 XLSX 바이트는 체크섬 전달을 위한 합성 자료이며 공식 양식 검증의 근거가 아닙니다.
- 저장소 실제 브라우저 검사: `node scripts/test-handoff-store-browser.mjs` 실행 후 기존 Chrome에서 `http://127.0.0.1:4243/` 열기. 이 전용 origin의 시험 데이터만 사용합니다.
