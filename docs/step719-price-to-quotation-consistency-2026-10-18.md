# Step719 — 직접 가격 저장과 검토한 전송 자료의 일치

기준 커밋 `4d1484286b08d2f09421b42e62abb2bed3e829de`. 2026-10-18 KST. 기존 작업 상품·저장 설정·실제 견적서는 수정하지 않았다. 이번 변경은 편집한 가격이 견적서에 반영되는 경계와, 사용자가 검토한 견적 입력을 Single 전송 후보에 연결하는 경계다. 카테고리 전체 동일성이나 실제 Supplier Hub 접수 완료를 의미하지 않는다.

## 직접 가격 입력 후 견적서 진입

실제 Dashboard/DetailPanel은 `data-quotation-source-step` 영역의 dirty/saving 상태로 7단계 진입을 검사한다. 직접 공급가·판매가·MSRP를 편집하는 `OptionQuotationPrices`는 작업 공간 dirty/saving 속성은 갖고 있었으나 해당 source marker가 없었다. 부모 옵션 편집기의 marker는 옵션 행·가격 정책 변경을 검사하므로 직접 가격 입력을 대신하지 못했다.

격리된 두 회사 문맥에서 판매가를 22,222원으로 입력한 뒤 대표이미지→견적서로 이동하면, PUT 0회·가격 초안 보존 상태에서도 7단계가 열렸다. 실제 견적 미리보기는 저장된 11,670원을 사용했다. 전송 준비의 전역 dirty 검사는 이미 차단하고 있었으므로 실제 잘못된 접수나 초안 유실을 발견했다고 확대하지 않는다.

변경은 기존 section에 `data-quotation-source-step="가격"` 한 개를 추가하는 것이다. 미저장 가격이 있으면 기존 이동 검사가 가격 단계로 돌아가며 입력을 유지한다. 자동 저장을 추가하지 않았다. 명시 저장 후 정확한 revision/inputFingerprint로 quotation-fields PUT 1회, 미리보기와 실제 생성 XLSX 모두 22,222원인 것을 검증했다.

신규 6개는 실제 Dashboard 콜백·DetailPanel·옵션 편집기·가격 표·직접 가격 편집기·QuotationPanel과 실제 로컬 API/격리 SQLite를 연결한다. 양사 저장→XLSX, 공란과 취소, 닫기 거절, 저장 응답 대기 중 진입/닫기 차단, 선택 행과 다른 단계 왕복, 폐기 후 새 상품 및 unmount 뒤 예전 handler를 검사한다. 원문·회사 설정·카테고리·제외 옵션을 보존한다. unrelated stage leaves/board 외형과 일부 편집 말단은 fixture이며 custom hook/tree/DOM adapter를 사용하므로 실제 브라우저 클릭·픽셀 검증은 아니다.

최종 6개를 기준 HEAD app/db 원문으로 메모리 주입하면 2통과·4실패, 변경 후 6/6 통과다. HEAD 190파일·1,362회 읽기를 기록했고 소스/시험 파일은 교체하지 않았다. 당시 working test/helpers/runtime을 사용하므로 clean checkout이라고 부르지 않는다. `outputs/step719-navigation-audit.json`과 `step719-price-navigation-head-source-proof.json`에 범위와 원인을 남겼다.

## 검토 화면과 Single 후보의 입력 일치

수동/미연결 상품에서 견적 화면을 연 뒤 다른 창의 기본설정을 바꾸면 product/content/options/quotation clock은 같지만 견적 입력 지문이 달라진다. 이전에는 `singlePackageCurrent`가 clock·회사·옵션·카테고리만 비교해서, 새 브랜드가 들어간 후보를 예전 화면과 일치한다고 판단했다. 실제 격리 API/SQLite와 UI 콜백에서 두 회사 모두 재현했다. 오래된 전송 패킷 자체의 prepare는 기존 fingerprint 검사로 이미 409였으므로 패킷 변조/서버 CAS 우회로 설명하지 않는다. 수집 상품은 captured 설정을 보존하므로 이 설정 덮어쓰기 재현을 모든 URL 상품에 일반화하지 않는다.

공통 Single loader에서 기존 `stableQuotationFieldsView`를 읽어 전체 source guard와 견적 revision을 export snapshot과 비교한다. 기존 최종 source·회사·파일 bytes 검사도 유지한다. 그 화면의 정확한 64자리 `inputFingerprint`를 응답 metadata로 제공하고 클라이언트가 현재 편집 화면의 지문과 일치할 때만 후보를 받아들인다. 값이 없거나 잘못됐거나 이전 지문이면 거절하고 재검토한다. 기존 ‘기본값 다시 반영’ 경로로 최신 화면을 불러와 비교할 수 있다.

operation/package fingerprint 산식·`singlePackagePacket`·전송 본문·receipt identity·확장 프로토콜은 바꾸지 않았다. 응답 지문은 기존 package fingerprint 계산 뒤에 부착한다. loader당 로컬 DB/해석/HMAC snapshot 한 번이 추가되며 이 변경 자체의 R2·네트워크 요청은 없다. 기존 selected-file guard를 파일마다 추가 반복시키지 않는다.

신규 11개는 양사 stale settings→거절/prepare POST 0→최신 화면으로 정상 prepare, 같은 ID의 schema 해석 변경, 잘못된/누락 metadata, snapshot 사이 settings/profile/options 변경, pairing 뒤 옵션 변경과 최종 guard, 응답 metadata와 operation/packet/receipt 분리, 양사 captured URL의 queryless·명시 profile GET→정상 prepare 및 교차 scope 거절을 검사한다. 원문·수동 제목·포함 옵션·회사·captured 브랜드를 보존하며 외부 요청은 0이다.

기존 관련 7파일 최초 실행은 145개 중 99통과·46실패였다. 46개 모두 기존 stage UI fixture의 가짜 응답에 새 필수 `inputFingerprint`가 없어서 중단됐다. 해당 응답에 기존 화면 지문 한 속성만 추가했으며 assertion을 제거하거나 앱 검증을 완화하지 않았다. 신규 11개+기존 UI 48개 최종 59/59, 기존 URL 흐름 6/6의 반복 실행은 최종 종합 수에 중복 가산하지 않는다. 초기 실패 로그를 보존했다.

## 원본 대조와 공식 양식

REA로 보관한 원본 chunk의 wizard 이동·닫기·견적 lifecycle을 좁게 대조했다. 중앙 next/prev/goToStep/close는 저장을 수행하지 않으며 견적 `autoSaveEnabled` 기본값은 false다. 원본의 미저장 유실 가능성이나 filtered step 경계 문제를 자체에 복제하지 않는다. 개별 편집→명시 저장→선택 옵션에 맞는 견적 연동을 유지한다. 정적 관찰과 lifecycle 추론을 구분한 상세 근거는 `step719-stage-navigation-parity-audit.md`에 있다.

새 REA 선택 8,468bytes·AST 1,718·parse failure 0, application 범위 complete·semantic unknown 350이다. parent `ev_0280bf9c53889bc0ce2ab8827fe67af309ce06de1cd50b68deda147b8de7647c`. 기존 Step714/718 증거를 먼저 재사용했다. 원본 실행·신규 source 요청·운영 상품 읽기/쓰기는 0이다.

기존 Chrome4의 별도 검수 탭에서 로그인된 유앤채 `A01526306`로 Kan category **2624**(패션잡화→안경/선글라스/소품→안경/선글라스→선글라스)의 공식 ZIP을 내려받았다. 보호된 원래 Hub/Couplus 탭과 기존 상품을 열거나 수정하지 않았다. 약관·업로드·검증·제출은 0이며 검수 탭은 닫았다. AX를 보존했으나 screenshot은 CDP timeout으로 성공하지 않았다.

- 다운로드 ZIP SHA `264dec01a0ff391a817003b0f5d5c98a959e5b7ef2e25b94153e07fe9bdff174`.
- 내부 XLSX 202,863bytes, SHA `58335f443503cc386521b6d2a78fa46c63b0735e68ec21cf7c9a156c0aa9bee6`.
- QF metadata `Retail_Categorized_Excel:Kan:2624:Notice4:Version191`.
- 이전 공식 ZIP과 decoded XML/binary **12개 part 모두 동일**, 추가/삭제 0, 검사한 metadata/행도 동일하다. ZIP 컨테이너 SHA가 달라도 schema identity를 합치지 않는다.
- QF 예시 행의 display category는 **69901**이다. Kan 2624·display 69900/69901은 서로 다른 namespace이며 예시를 상품 기본값으로 사용하지 않는다. 이 다운로드만으로 69900 leaf의 현재 Single schema·전 카테고리·와이홉의 새 양식·실제 상품 접수를 검증했다고 주장하지 않는다.

## 배포 검증과 남은 경계

최종 **22고유파일 286/286 통과**, 신규 17개 포함, fail/cancel/skip/todo 0, 131.67초다. 소스/설정/시험 1,304파일의 실행 전후 SHA가 같고 추가/삭제도 0이다. 집중·HEAD·실패·반복 수는 가산하지 않는다. 타입 검사·app/db와 변경 시험 lint·schema(44 tables/17 indexes/29 runtime modules)·운영 빌드·diff check·pre/post verifier가 통과했다. 전체 저장소 suite를 실행했다고 주장하지 않는다. 독립 검토는 가격 navigation 2파일, Single binding/fixture 4파일, 기존 fixture 2파일에 대해 수정 필요 사항 0건이다.

기존 무료 Worker 배포 ID는 `a0a8d940-0725-4d63-baf9-3b676afc776c`, URL은 https://sourceflow.jjwwhhjj1116.workers.dev/ 이다. 같은 Chrome4의 별도 앱 탭에서 YOOFAM PLUS 제목·관리자 계정·AI상품등록의 로딩 완료를 읽고 기존 상품을 열지 않은 채 탭을 닫았다. 이 검수는 새 가격 경로의 실제 브라우저 편집 증거는 아니다. 최종 동결 SHA·검사 로그·원본 범위·공식 파일·배포 ID는 `outputs/step719-release-inputs.json`, `step719-final-validation.json`과 `HANDOFF.md`에 기록했다. 수집/전송 테스트는 합성 원문·인증·파일·네트워크와 격리 DB를 사용하며 실제 두 회원 로그인과 실접수의 증거가 아니다.

첫 종합은 22고유파일 286개 중 284통과·2실패였고 로그/proof를 보존했다. 실패한 기존 fixture 둘은 각각 수정 전 HEAD 원문에서도 같은 실패를 재현했다. `workspace-source-navigation`은 잘못된 `useMemo: fn=>fn()` 때문에 scope token이 매번 바뀌어 정상 입력 handler를 stale로 만들었다. memo/callback의 dependency identity를 보존하고 기존 검증에 환율 200→275·다른 단계에서도 275 유지·자동 저장/쓰기 0을 추가했다. HEAD 62소스/124reads에서 2개 중 1실패, 보완 후 2/2 통과다.

`workspace-product-navigation`은 VM의 실제 `File` global이 빠졌고, 배너 파일 선택만으로 업로드가 시작된다고 가정했다. 현재/HEAD 앱은 선택을 로컬 preview로 보관하고 명시 저장 안에서만 업로드한다. 테스트에 실제 File global을 제공하고 선택 시 쓰기 0→명시 저장→보류된 파일 POST 중 닫기·중복 submit 차단→보류된 설정 PUT 중 preview 유지→ACK 후 닫기/재열기·정확한 owned key·POST 1/PUT 1을 검사한다. HEAD 74소스/74reads에서 원래 case 1/1 실패를 보존했고, 보완 후 해당 파일의 기존 18개가 모두 통과했다. 새 case를 늘리거나 앱·공유 helper·기존 assertion을 완화하지 않았다.

확장 0.2.78/ZIP은 그대로이며 이번에 설치 버전을 갱신하거나 재조회하지 않았다. 새 resource·migration·유료 provider·OAuth·R2 권한 변경은 없다. **`SINGLE_DOCUMENT_LIVE_VERIFIED=false`와 운영 게이트 false를 유지한다.** 기존 거절 1688 도메인/상품을 다른 도구·확장·CLI·프록시로 재접근하지 않았다.

잔여 핵심은 허용된 정상 신규 1688의 전체 SKU/CNY/MOQ/사진·상세 실제 수집, 전 카테고리 공식 양식/default와 각 단계 실동작 대조, 사용자가 검토한 실제 상품의 Hub docId/qvtRequestId/SKU 접수 대조다. 전체 동일 구현·100%·임의 완료율·실접수 완료로 보고하지 않는다.
