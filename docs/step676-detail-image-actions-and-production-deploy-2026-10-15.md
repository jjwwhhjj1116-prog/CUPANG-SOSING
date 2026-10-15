# Step676 — 상세 이미지 키보드 삭제·JPG 다운로드와 운영 배포

기준 커밋은 `57de2b6a39cfb712da58e04d05514aeace06d7d6`이다. 기존 쿠플러스 작업 상품은 변경하지 않았다.

## 원본에서 확인한 범위

보관된 `chunk-27c89b44.6953b027.js` SHA-256 `ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc`를 REA로 정적 분석했다. Evidence `ev_782e7a89a96a33a05f38b2d977a5ee4001676f0891cc87373d600c7252192396`, `ev_8ec3fd01351174fefebdc0fccae8f936ebf1c20201f4c59c76aff551e848ec3c`: 정확한 58개 조각, 파싱 실패 0이다. 브라우저 실행 증거와 구분한다. 비공개 원문·분석 기록은 ignored `outputs/step676-image-audit/`에 보관했다.

- 상세 헤더에는 업로드·통합 이미지 다운로드·영어 번역·AI 처리·조건부 나뉜 건 적용·저장이 연결돼 있다.
- 상세 키보드 핸들러 [103652,103895)는 hovered 이미지의 Delete를 처리하고 `setting` 항목을 제외한다. 보관 원문의 추가 직접 대조에서 [88909,88962)와 [91947,92025) 부근 `mouseenter→setHoveredImage`, `mouseleave→clearHoveredImage` 연결을 확인했다. 위치는 UTF-16 기준이다.
- 추가·상세 미리보기 렌더 분기는 있지만 실제 진입 버튼은 확인하지 못했다. [88186,88315)를 처음 미리보기 버튼으로 식별한 것은 오류였으며 실제는 저장 버튼이다. 이번에는 미확인 미리보기 UI나 자동 슬라이드를 추가하지 않았다.
- 추가 단건 AI의 문서 자동 저장과 일괄 처리의 로컬 갱신은 서로 다르다. 원본 이미지도 `textRemoved:true`가 될 수 있으므로 번역 성공을 저장 자격과 동일하게 해석하지 않았다. 이 차이의 전면 재현까지 완료했다는 주장은 하지 않는다.

## 구현

`OptionImageEditor`는 현재 상세 단계에서 가리킨 본문 사진을 Delete로 로컬 선택에서 제거한다. 실제 견적서 반영은 기존 명시 저장을 사용한다. HTML·다른 옵션·상품 공통 파일은 유지한다. 입력칸·contenteditable·조합 입력·수정 키·다른 처리·저장 응답 불명 상태는 삭제하지 않는다.

견적서 조회 응답에만 `protectedDetailImageKeys`를 추가했다. 현재 콘텐츠의 상단·하단 역할 중 소유 파일 풀에 있는 키를 반환하며, 첫 사진·마지막 사진 위치로 배너를 추측하지 않는다. 메타데이터가 없거나 손상된 이전 응답에서는 키보드 단축키가 작동하지 않으며 기존 명시 삭제 버튼은 유지된다. 별도 저장 필드·마이그레이션·견적서 셀 변경은 없다. 화면에 남겨 둔 숨은 편집기는 실제 active 단계와 세대별 기준을 확인해 이전 이벤트로 삭제하지 않는다.

상세의 `통합 이미지 다운로드`는 저장된 현재 옵션의 상세 이미지 순서를 실제 비공개 파일 GET으로 읽고 800px·흰 배경·품질 0.92의 JPG를 생성한다. 파일 풀 150개여도 내려받을 수 있다. 양쪽 파일 읽기의 SHA와 크기, 처리 전후 견적서 기준, 실제 출력 형식·크기·10MB 한도를 확인한다. 업로드·첨부·견적서 저장은 하지 않는다. 미저장 선택/HTML이나 저장 결과 미확정 상태에서는 다운로드를 잠근다.

이 앱은 저장된 소유 이미지 목록을 합친다. 쿠플러스의 기존 `detailedImage` 우선/쉼표일 때 첫 URL 분기를 완전히 동일하게 실행했다고 주장하지 않는다. 직접 입력한 HTML이나 임의 외부 URL을 다운로드 이미지로 실행·수집하지 않는다. 기존 PNG 합치기·검토 후 적용·응답 유실 복구는 유지했다.

독립 검수에서 다운로드를 시작한 뒤 단계를 나갔다 돌아오면 이전 파일이 내려받아지는 결함을 발견했다. 다운로드 전용 abort/세대 검사를 추가했으며 진행 중인 PNG 적용 쓰기를 임의 중단하지 않는다.

## 검사

6개 파일의 **59개 서로 다른 검사**가 통과했다. 새 검사 23개와 기존 회귀 36개다.

| 파일 | 통과 |
| --- | ---: |
| option-detail-keyboard.test.mjs | 10 |
| option-image-editor.test.mjs | 22 |
| detail-image-download.test.mjs | 9 |
| detail-image-download-panel.test.mjs | 4 |
| detail-image-composite.test.mjs | 10 |
| detail-image-composite-panel.test.mjs | 4 |

초기 fixture의 profileId 누락, undefined 정규화, DOM 이벤트 어댑터 부족은 검사 장치만 수정했다. 집중 재실행은 위 최종 개수에 한 번만 포함한다. 타입 검사, 변경 코드/검사 린트, Worker 빌드, 공백 검사가 통과했다. `outputs/step676-save-audit/backend-checks.json`과 `step676-*-tests.log`, types/lint/build 로그에 기록했다.

같은 Chrome3에서 실제 React 편집기·키보드·Canvas와 임시 API/SQLite를 사용해 두 회사 조건을 확인했다. 배너 보호·본문 삭제의 초안 상태·명시 PUT 1회씩·수동 HTML/다른 옵션 보존, JPG 2개(각 800×480/3,818바이트)의 실제 RGB 순서를 대조했다. 초기 두 번째 회사 키 입력은 삭제를 만들지 않아 성공으로 세지 않았으며, 최신 저장본을 읽고 다른 본문 사진으로 다시 검수한 최종 결과를 기록했다. API 36회 중 쓰기는 명시 PUT 2회뿐이며 파일 바이트와 소스 해시는 불변이다. 인증·회사·카테고리·원본은 fixture이므로 실제 두 회원 로그인·1688·Supplier Hub 접수 증거가 아니다. 다운로드 대기 도구는 timeout이었지만 실제 Downloads 파일과 화면 성공 안내로 확인했다.

`outputs/step676-native-verification.json`, `step676-native-dom-proof.json`, `step676-native-proof.json`, `step676-native.png`에 근거를 보관했다. 임시 탭/서버는 검수 후 정리한다.

## 운영

공식 Wrangler 읽기 전용 확인에서 기존 OAuth 연결이 정상임을 확인했다. 신규 로그인이나 R2 권한 확대 없이 기존 무료 DB에 `0024_product_registration.sql`의 추가 테이블 3개를 적용했다. 기존 상품을 갱신하는 SQL은 없다.

최신 Worker 배포가 성공했다. 버전은 **`999afdb8-1ade-44b9-869d-ecd1839b6ec8`**, 주소는 기존 `https://sourceflow.jjwwhhjj1116.workers.dev/`다. Step669–675 미배포 변경과 이번 변경을 포함한다. 기존 DB/R2/AI 바인딩을 사용했고 새 유료 자원을 만들지 않았다.

같은 Chrome의 실제 앱에서 관리자 로그인, 상품 목록 읽기, `유앤채 · A01526306` 기본설정 조회가 오류 없이 완료됐다. 설정은 저장하지 않고 닫았고 기존 작업 상품은 열어 수정하지 않았다. `outputs/step676-production-dom.txt`, `step676-production.png`, `step676-deploy.log`를 보관했다. 과거의 인증 오류/0024 미적용/Step668 배포 대기 상태는 현재 상태가 아니다.

전체 동일 구현 완료로 표시하지 않는다. 새로운 실제 1688 전체 옵션·이미지 수집, 전 카테고리 공식 양식/기본값, 남은 단계 기능과 실제 Hub 동의·등록 접수번호/SKU 확인은 별도 검증이 남아 있다. `SINGLE_DOCUMENT_LIVE_VERIFIED=false` 및 운영 전송 검증 게이트는 유지한다. 거절된 URL을 다른 도구로 우회하지 않는다.
