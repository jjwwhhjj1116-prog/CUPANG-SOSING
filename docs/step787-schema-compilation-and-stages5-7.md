# Step787 · 전송 양식 반복 계산과 5~7단계 검수

## 현재 연결과 실상품 경계

재부팅 후 사용자가 Chrome 연결 완료를 알린 뒤, 기존 Chrome 3의 Supplier Hub 유앤채 `A01526306` 로그인과 운영 앱 `jwhj1116@kakao.com` 로그인을 확인했다. 기존 업무 상품을 수정·삭제·전송하지 않았다. 운영 앱이 응답받은 통합 확장은 2.1.18이며 배포된 다운로드는 2.1.20이다. 파일 버전과 실제 실행 버전을 구분한다.

사용자의 재시도 요청에 따라 지정 새 상품 `https://detail.1688.com/offer/1022260303756.html`을 현재 연결된 Chrome에서 직접 여는 요청을 한 번 수행했다. 브라우저 도구가 **site-safety policy**로 관찰 권한을 거절했다. 로그인 실패·사용자 permission prompt·Auto-review 거절은 아니었다. 다른 브라우저, 확장, 서버, 캐시, CLI로 같은 내용을 우회해 읽지 않았다. 따라서 이번 실상품 수집과 실제 Supplier Hub 접수는 미검증이다.

## 상세 편집 원본 대조

REA 보관 원본의 processed 사진 삭제는 native confirm 후 사진 맵과 HTML을 로컬 갱신하고, original 사진 삭제는 상품 저장 액션을 호출한다. 후자는 `/api/rocketReg/saveItems` 상품 저장이며 이미지 파일 전용 삭제가 아니다. 현재 선택 옵션의 사진 참조 제거는 로컬 초안→명시 저장의 흐름으로 processed 삭제와 부합한다. 신뢰 가능한 원본/처리본 분류 입력이 없는 현재 화면에 자동 저장이나 파일 삭제를 추가하지 않았다.

원본의 저장하지 않고 닫기 확인 메서드는 존재하지만 렌더링된 모달의 닫기 이벤트 연결은 확인되지 않았다. 메서드 존재를 X·Esc 동작의 실행 증거로 취급하지 않았다.

근거는 기존 parent `ev_69740e390a2cc1e539a4a65a84e5c7065e2e6db9dcbc8a6311d0b4bfce5a3166`, summary `ev_26cdc76017d63fa2bb683d4165db034bae99266f6a3ad48bb3b45253f2ce9634`, 보관 chunk SHA256 `5b92873c674c4b76c0e6ce4961caedbf8728ca86f6a15b6d9dc8cdfce80ad1d9`와 main SHA256 `027a17c12b60164e856058cbe449b827d38bf1ec0f7d98bb23acbff2c6c25b67`이다. 기존 Evidence 무결성 조회 문제를 반복하지 않고 일치하는 로컬 발췌와 범위를 검증했다. 정확한 범위·해시는 `outputs/rea-step787-detail-removal/manifest.json`에 있다. 원본 사이트에서 저장 성공을 관찰한 것은 아니다.

## Chrome의 실제 편집 검수

새 격리 합성 상품과 실제 Dashboard·API·SQLite·브라우저 Canvas를 사용했다. 실제 1688·Supplier Hub·이미지 공급자는 호출하지 않았다.

- 5단계: 상세사진 두 장의 순서 변경, 상세 HTML 직접 편집, 명시 저장 PUT200. 7단계에서 같은 사진 순서와 HTML을 읽었다.
- 6단계: 선택 옵션의 내용량·재질·유형 수정, 정보 저장 PUT200, Canvas PNG 업로드201, 첨부 연결200, 견적 필드 연결 PUT200. 저장 PNG 미리보기를 확인했다.
- 7단계: 모델명·합성 포장 무게·치수 세 항목을 수정해 PUT200, 재조회 revision3과 저장값을 대조했다. 필수값이 미입력인 상태를 전송 가능으로 처리하지 않았다.
- 저장된 상세사진에서 수동 이미지 편집기를 열어 한국어 문구·글자 크기·영역 크기를 바꾸고 Canvas 미리보기를 만들었다. 이 검수에서는 해당 편집 결과의 적용 POST를 실행하지 않았다. 수동 편집에는 생성형 이미지 모델 설정이나 로컬 AI 설치가 필요하지 않다.

사진 순서를 바꾼 미저장 상태에서는 카드의 편집·번역 버튼이 비활성화되고, 저장이 끝나면 수동 편집이 다시 열린다. 이는 정확한 저장 슬롯을 편집하기 위한 현재 dirty 보호이며 AI 설정 부재가 원인은 아니었다.

보호 합성 상품, 공통 견적값·다른 옵션의 견적 수정값과 원본 이미지 파일은 보존됐다. `outputs/step787-ui-verification.json`, `step787-browser-checkpoint.json`, `step787-browser-quote.json`, 단계5·6·7 PNG와 `step787-image-editor.png`를 보관했다. 이를 실상품 수집·원격 업로드·실접수 또는 전체 UI 완전 동등성의 증거로 사용하지 않는다.

## 전송 준비의 반복 계산 수정

이전 native 통합 검사 지연을 샘플링한 결과, 반복적인 현재 소스 확인이 같은 양식을 다시 해석하고 견적 지문을 계산했다. 무한 루프나 드라이버만의 문제로 확정하지 않았다. 처음 시도한 전역 순수 스키마 캐시는 입력 확인·결과 복사 비용 때문에 실측 이득이 없었다(동일 양식 1,000회 원본669/599ms, 후보664/613ms). 해당 생산 변경과 캐시 전용 테스트는 철회하고 측정 증거만 보관했다.

최종 수정은 `app/exports/single-package.ts` 한 파일의 요청 단위 재사용이다. 최초 전체 saved DTO의 고정된 값 키를 보관한다. guard가 매번 **최신 readQuotationExportSource를 성공적으로 읽은 뒤**, 그 전체 값이 같을 때만 이미 계산한 sourceFingerprint를 재사용한다. 변경되거나 키를 안전하게 만들 수 없는 입력은 기존 전체 지문 계산·비교로 돌아간다. 회사·상품·본문 일부 또는 revision만으로 같다고 판단하지 않는다.

현재 auth/회사·DB·생성 라벨 검사, active 호출, quotationSourcesCurrent, 견적 revision, publicDetailVersion, 파일 get/head·메타데이터·bytes·SHA 확인을 모두 유지했다. 요청 사이에 공유하는 전역 캐시는 없다. `undefined`/null/수치 경계/마커처럼 보이는 원문을 구별하고, 사용자 정의 프로토타입·접근자 입력은 재사용하지 않는다. 표시 등록번호만 바뀐 경우에도 기존 지문이 같으면 허용하는 계약을 유지한다.

같은 isolated native-assets GET을 원본과 수정으로 번갈아 3회 측정했다. 전체 소스 읽기는 양쪽 모두22회이며 지문 계산만22→1회였다. 원본211/207/205ms, 수정137/131/127ms, 반환 plan은 완전히 같고 SQL·파일은 불변이었다. 로컬 합성 측정이며 운영 전체 소요시간·수집 속도·실제 업로드 속도로 확대하지 않는다. 증거는 `outputs/step787-native-request-local-benchmark.json`이다.

독립 검토에서 최종 수정의 P1/P2 문제를 찾지 못했다. 관련 8개 테스트 파일306/306에 추가 API2파일22건과 기존 native 통합2파일10건이 통과해 최종 고유12파일338/338이다. worker의 관련28건에는 root의6건이 포함되므로 중복 합산하지 않았다. 두 회사의 원래 native 통합 assertion과 Date만 모의하는 계약을 그대로 유지했으며, real timer·앱 timeout을 바꾸지 않았다. 외부 검사 감시 시간만 측정된 긴 사례가 완료될 수 있게 잡았다. 최초 부분 실행·샘플링 중단 로그는 최종 성공 로그와 구분한다.

타입·변경 파일 lint·운영 빌드도 통과했다. 최종 배포·commit·push 결과는 `outputs/step787-final-validation.json`에 별도 기록한다. 일반 single/product live-verified=false와 동의 확인 경계는 유지한다. 합성 검수 탭·서버는 종료하고 운영 앱 탭을 남겼다.
