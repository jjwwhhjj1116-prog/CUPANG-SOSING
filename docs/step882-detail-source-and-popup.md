# Step 882 — 상세 원본 누락과 편집 화면 분리, 담기 대비 수정

2026-10-31 KST. 기존 886 상품·요청·문서는 쓰기 검증에 사용하지 않았다.

## 실제 확인

- 원래 상품 `e2f8037c-294e-45a8-b06d-58cc5909683c`의 bound capture 10은 대표 1·추가 7·상세 0장이다. 같은 회사·886 상품의 저장된 수집본 11개 모두 상세 0장이다.
- capture 10·11의 진단은 `reference-missing`, 알려진 상품 패널·본문 제목 0개이다. 번역 전 원본 취득이 누락됐다.
- 저장 견적의 상세 2장은 설정 배너와 기존 800×530 편집 사진이다. 쿠플러스의 상단 배너+번역 본문 6장과 동일한 전체 상세가 아니다.
- `outputs/step882-original-detail-source-read.json`, `step882-original-detail-source-diagnostics.json`은 SELECT 전용, rowsWritten 0이다. 원문 URL·키·자격증명은 출력하지 않는다.
- 원래 범위 35테이블·47행 해시는 `39f1f5b9ff48173e6d68b0e8d9689aac8eb587f2fb469a0ed6b2984913a3455d`로 이전과 동일하다. 이는 원격 Supplier Hub 본문의 무변경을 증명하지 않는다.

## 변경

- 첫 상세 작업 구성은 자동 상세 역할 원본 목록으로 시작하고, 저장된 수동 작업 구성이 있으면 이를 우선한다. 최종 합성 파일·갤러리로 원본을 대체하지 않는다.
- 5단계의 기본 영역은 개별 사진을 760px 세로로 표시한다. 읽기 자동 열기는 저장이나 미저장 경고를 만들지 않는다. 최종 이미지와 그 일괄 번역 도구는 별도 접기 영역으로 보존한다.
- 일부 DOM 사진이 있더라도 현재 상품에 연결된 검증된 상세문서가 있으면 조회하여 문서 순서로 병합한다. 잘못된 상품 연결은 거절하고, 실패 시 원래 사진을 보존한다.
- 보관된 fixture의 정확한 mobile `air.1688.com` wrapper만 정적으로 해석한다. 외부 wrapper를 요청하거나 상세 주소를 추측하지 않는다.
- 로컬 OCR의 새 영역도 주변색·문구 맞춤·겹침 검사를 사용한다. 복잡하거나 읽을 수 없는 배경은 자동 선택하지 않는다. 기존 편집값은 유지한다. **인페인팅은 구현·설정된 것으로 보고하지 않는다.**
- 다중 담기 패널은 남색 `#14213b`, 밝은 글자, YFS 배지, 테두리 보조 버튼, 명시적인 비활성 색상으로 변경했다. CSS 외 담기 동작은 동일하다.

## 원본과 비교한 근거

- 쿠플러스 retained route SHA `5b92873c674c4b76c0e6ce4961caedbf8728ca86f6a15b6d9dc8cdfce80ad1d9`: `handleAddProduct [412097,412954)`는 `/api/aiPage/getProductInfo` 응답을 소비한다. `extractDetailImages [467738,468022)`는 description HTML의 모든 img.src를 취한다. 서버 내부 공급 경로는 이 프런트만으로 미확인이다.
- RS retained content SHA `199540b324c9a15ee323504c9216a411131bc3ce52cb51f1177ccfc9749b0242`: `buildImagePool [27779,29441)`은 DOM과 description을 함께 취한다.
- 기존 REA 부모 증거 `ev_69740e390a2cc1e539a4a65a84e5c7065e2e6db9dcbc8a6311d0b4bfce5a3166`, `ev_5e23b694a30378c27c01eec2c169297c72138e2320926ab507812e2c56ebd298` 재사용. 업체 코드를 복사 배포하지 않았다.

## 복제 템플릿 검토

- 사용자 링크: https://github.com/JCodesMore/ai-website-cloner-template
- README·실제 clone-website 스킬·package·MIT LICENSE를 확인했다. 기존 YOOFAM을 교체하거나 설치하지 않았다.
- 사용자 영상 https://www.youtube.com/watch?v=gNv7MXP6KVs 의 한국어 자막을 브라우저의 공식 transcript export로 읽었다. 2:21–3:17의 map→observe→code→동일 화면 크기 비교 절차는 UI 검수에 유용하다. 영상 전체를 시청했다고 보고하지 않는다.
- UI 재구성 템플릿이며 1688 상품 서버·번역/인페인팅·Supplier Hub 업무 연결 구현체는 아니다. 영상의 별도 프록시 설치는 실행하지 않았다.

## 검증과 남은 범위

- workspace/editor/API 159개, collector 95개, listing 32개, OCR·번역·cleanup 54개 관련 검사 통과. 일부 파일은 다른 묶음에도 포함되므로 합산 총수로 보고하지 않는다.
- TypeScript·ESLint·diff 검사·Cloudflare 운영 빌드·확장 패키지 검사 통과.
- 확장 2.1.68: 113파일, ZIP 1,652,944 bytes, SHA `f1c84c79596176b5754c17f019e6d600d841e1f4f4b8e9b86d75cef0f3d003ca`. 권한·호스트·모델·요금제 변경 없음.
- 886 페이지 읽기는 이번에도 브라우저 사이트 정책이 거절했다. 다른 도구로 해당 페이지를 우회 취득하지 않았다. **이번 수집 수정이 886 재수집을 성공시켰다고 보고하지 않는다.**
- doc2347603의 전체 읽기 대조도 응답 확정에 실패했다. Step881 Preview의 본문 저장 가능성은 여전히 미확정이다. 원래 문서에 추가 파일·본문 전송, 새 생성, 삭제, Next/Preview/Save/Submit을 하지 않았다. 실제 접수 미확인.

배포 확인: Worker `f31abf61-2b2e-4a67-acc3-29f85d92892e`로 운영 배포 완료. 모델·요금제·DB 마이그레이션 변경 없음. 실제 설치 폴더 113파일 해시 일치, 실행 중 Chrome의 2.1.68 적용은 사용자 새로고침 확인 대기.
