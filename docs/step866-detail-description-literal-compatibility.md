# Step866 — RS 수집 근거 재검토와 상세 원문 호환 수정

2026-10-30. Worker `84271095-94a3-4907-9a11-7e242afdd877`, 통합 확장·수집기 `2.1.61`.

REA로 보관된 RS1.0.88 증거를 재사용했다. RS는 detailUrl 응답에서 상세사진을 읽지만 속성·포장 필드 자체는 전송하지 않는다. 이를 그대로 복제하는 것으로 옵션별 무게 누락까지 해결되지는 않는다. 현 수집기의 최상위 문서·한정된 스크롤 획득 문제도 별도 남아 있다.

확정한 정적 비호환: 앱 `alibaba-mobile-product.ts`와 보관1688 관찰은 `var offer_details={"content":"<img ...>"};` 응답 형식을 지원한다. 반면 확장 `parsePageDescriptionImages`는 첫 비공백이 `<`가 아니면 거절했고 기존 테스트도 같은 형식을 의도적으로 거절했다.

수정한 확장은 정확한 `var offer_details` 1회 할당의 strict JSON content만 기존 HTML tokenizer로 전달한다. JavaScript를 실행하지 않는다. 중복 decoded key·prototype key·실행 tail·JSONP·불완전 구조·깊이40 초과·필드10,000개 초과·1MB 초과를 거절한다. 원래 detailUrl의 상품/문서 연결, 허용 호스트, MIME, 이미지 검증, 요청 전후 재확인과 한 번 GET은 유지했다. 호스트·권한·요청 횟수를 늘리지 않았다.

검사: 분리 릴리스 고유10파일78/78 통과, fail/skip/cancel0. 최초73/78의 실패5건은 새 버전을 만들며 남은 예전 버전 기대값이었고 최종본에서 수정했다. TypeScript·변경 ESLint·확장 생성물/ZIP 검사·운영 build 통과. 릴리스15파일 소스 hash 일치. 실제 설치 폴더를 별도 백업하고108파일 모두 hash 일치로 갱신했다. ZIP1,500,707bytes/SHA256 `9961c1bd24b64b3c5ce839f805f91e46d53b29e000ca8629a4d108d9e0d7a052`.

886034098637의 실제 응답은 이번 작업에서 관측하지 않았다. 이전 reference-missing은 문서 요청 이전의 문제이므로 이번 파서 수정으로 해결됐다고 주장할 수 없다. 실제 Chrome 적용·재수집·속성/포장/상세 누락 해소·이미지 번역 품질·최종 접수는 아직 미검증이다. 원래 업무 상품/요청/문서에는 이번 수정의 쓰기 동작이 없다. 자동 승인 검토의 Supplier Hub origin 접근 거절을 다른 도구로 우회하지 않았다.

REA 근거: parent `ev_5e23b694a30378c27c01eec2c169297c72138e2320926ab507812e2c56ebd298`, summary `ev_97b31888e05cec12bd7808e18732cd47d610284498406958bbc1ced6cbcc52db`, RS 원본SHA `199540b324c9a15ee323504c9216a411131bc3ce52cb51f1177ccfc9749b0242`. 새 외부 수집·브라우저 접근 없이 보관 증거와 소스만 대조했다.

증거: `outputs/step866-release-tests-final.log`, `step866-release-extension-check.log`, `step866-release-types.log`, `step866-release-lint.log`, `step866-build-final.log`, `step866-deploy.log`, `step866-extension-installed-files.json`. 잘못된 작업 디렉터리의 로컬 복사 실패와 지원하지 않는 build 인수는 수정했고 운영 호출·데이터 변경 없이 최종 생성물을 다시 확인했다.
