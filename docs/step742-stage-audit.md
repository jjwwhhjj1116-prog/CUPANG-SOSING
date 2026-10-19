# Step742 — 직접 설명 수정·이미지 편집 후 다음 단계 보존

2026-10-19 KST. 읽기 기준 HEAD `c0037ddfbe9df8f71e9bd792957b2cc52255394f`. 범위를 **URL 초안의 1단계 직접 설명/옵션명 저장 → 5단계 이미지 편집 → 명시적인 상세 설명 분리 → 7단계 재조회** 한 경계로 제한했다. Step667/683/734의 제목 정책·상세 재편집 입력·번들명 수정을 새로 발견한 차이로 반복하지 않았다. **이 한정 경계에서 남은 구체적 결함은 확인하지 못했다.** 앱·테스트·확장·기존 상품·대기열을 변경하지 않았다.

## 원본 관찰과 자체 부가 기능의 구분

원본 `saveSeoData`는 SEO 상품명·검색태그·optionNumber에 연결한 korName을 partial writer에 넘긴다. 이 payload에 일반 설명 텍스트는 없다. 원본 상세 저장은 root `detailHtml`·처리 이미지 편집 입력을 별도로 남기고 최종 견적서에는 통합 이미지와 빈 HTML을 기록한다. 따라서 자체의 **1단계 일반 설명 textarea → 상세 HTML 연결**을 원본에서 관찰한 동일 필드라고 표현하지 않는다. 자체의 추가 편집 기능이며 원래 이미지 편집 문서의 저장 계약과 구분해야 한다.

원본 source는 `outputs/step725-current-ui/chunk-36123f1a.155d5b9e.js`, SHA256 `2fb15d370c331f65d982a886f2888b813ccae67277e87f806182c70032821664`다. 현재 exact UTF-16 start-inclusive/end-exclusive 범위를 보관 manifest와 다시 대조했다.

| 메서드 | 현재 범위 | slice SHA256 |
| --- | --- | --- |
| saveSeoData | `[199514,201506)` | `1c98c75b1737c5e08d5760512962b9f11ff05378fbc456ccaf06537882390831` |
| saveDetailPage | `[131288,136358)` | `757d3e6097a2084225181b9e0cbf205687e1cb93061ea886e7b66b3f53dc28f2` |

SEO writer 기존 Evidence `ev_6f9827b0f3963841858f7f1e736342f9b28b722b8092af77ffe7f723e83f40c9`와 일반 상세 저장/입력의 기존 parent `ev_782e7a89a96a33a05f38b2d977a5ee4001676f0891cc87373d600c7252192396`를 해당 과거 범위로만 재사용했다. 현재 route의 재대조는 위 exact slice hash 확인이며 새 producer 실행/원본 함수 실행이 아니다. processOptions나 전송 Evidence를 설명 편집 증거로 확대하지 않았다.

## 현재 자체 보존 계약

`SeoWorkspaceEditor`는 현재 product/source key·active·disabled·request 상태를 확인하고, 변경분으로만 SEO와 옵션명을 함께 저장한다. 단계 숨김과 parent clock 변경만으로 편집 초안을 지우지 않으며 명시 최신 조회에서 충돌을 비교한다. 저장 응답이 누락되면 이전 요청 입력과 최신 저장본을 비교한다. 이것은 자체의 더 강한 보호이며 원본 서버에도 같은 CAS/ACK 계약이 있다는 주장이 아니다.

새 수집 초안은 `detailDescriptionLinked=true`로 현재 SEO 설명을 읽는다. image-only PATCH는 description을 포함하지 않아 이 link를 해제하지 않는다. 5단계에서 설명을 명시 저장하면 공란도 manual로 보존하고 link를 false로 만든다. 이후 SEO 설명 변경은 이 독립 상세 설명을 덮지 않는다. 7단계에서 직접 저장한 HTML·공란은 두 설명 writer보다 우선한다. UI의 상세 이미지 저장도 실제로 바뀐 description/ALT만 PATCH하는 경계가 있고 관련 API/XLSX 검사가 이미 존재한다.

## 작은 순수 확인

`outputs/step742-stage-review.mjs`는 자체 `seoWorkspaceInput`·`applySeoWorkspaceChanges`·저장 응답 비교·content patch·quotation resolver를 합성 메모리 객체에만 실행한다.4개 그룹이 통과했다.

1. 직접 제목·태그·설명·옵션명을 함께 저장한 뒤7단계 기본 상품명·옵션 label·검색태그·상세 HTML과 정확한 ACK 상태를 확인했다.
2. 상세 이미지 순서만 바꾼 후 manual SEO 설명과 metadata/link가 그대로 남았다.
3. 5단계 설명을 직접 빈 값으로 저장하면 link가 해제되고 이후 SEO 설명을 바꿔도 상세 공란이 복원되지 않았다.
4. 직접 견적 HTML과 공란이 계속 우선하며 다른 저장자가 바꾼 응답은 이전 저장 성공으로 인정하지 않았다.

앱8파일 SHA가 검사 전후 같았고 job/원문 객체도 그대로였다. 주요 SHA는 `seo-workspace.ts`=`ac0b1e4ca358610e631565e221d397bae1958432cb9b2ec64e8f4f068c40f767`, `product-content.ts`=`70571d25d3a194e86d687b197bfa41bd2c751d588d950b46f84bc03f1f85e512`다. 나머지는 `outputs/step742-stage-review.json`에 있다. 기존 React/API/SQLite/XLSX 검사는 읽었지만 이 담당이 재실행했다고 집계하지 않는다. 순수4개도 release 합계에 추가0이다.

실제 UI 픽셀·이미지 편집/번역 provider 결과·private 저장 서버·실제 source URL·전 카테고리·Hub 접수는 이 검사로 확인되지 않았다. 원본의 falsy HTML 재생성이나 저장 실패를 삼키는 동작을 동일구현이라는 이유로 직접 공란/실패 보호 대신 적용하지 않는다. 브라우저·네트워크·수집기·vendor·운영 쓰기0, native gate 변경0이며 종료할 owned 세션은 없다.
