# Step750 — 이미지 번역·상세 작성과 로컬 AI 필요성

2026-10-19. 사용자가 요청한 RS식 수집 이후 Couplus 단계별 편집을 대상으로, 기존 보관 shipped JavaScript와 REA Evidence만 재사용했다. Couplus·RS·1688·Hub·외부 번역/이미지 제공자에 새 요청을 보내지 않았다. 기존 작업 상품·설정·운영 DB를 읽거나 변경하지 않았다. 아래의 관찰은 정적 클라이언트 계약이며 실제 제공자 실행/이미지 품질/접수의 증거가 아니다.

## 결론

**Couplus와 같은 화면을 만들기 위해 별도 로컬 생성 AI를 반드시 설치해야 한다는 근거는 없다.** 확인된 Couplus는 이미지 번역/OCR을 자체 서버 API로 요청하고, 이미지 편집은 외부 `xiangjifanyi` iframe 세션으로 연다. 상세페이지의 순서·배너·HTML·통합 이미지 작성은 브라우저 코드다. CLI는 서버 recipe와 열린 페이지 사이의 실행기이며, 로컬 대형 이미지 모델 탑재를 뜻하지 않는다.

YOOFAM 스튜디오는 설치된 `tesseract.js` 브라우저 OCR, Google 무료 텍스트 번역, 자체 Canvas 편집/합성 및 저장 문서를 사용한다. 이 구성은 영역 검출→번역문 검토→글자/색/박스/잘라내기/브러시 편집→저장→견적 연결을 구현할 수 있다. **단색 브러시로 덮는 기능을 원본 배경을 복원하는 AI 지우기와 동등하다고 표시하면 안 된다.** 배경 복원·자동 디자인·고품질 이미지 재생성은 별도 모델/제공자 품질 검증이 필요한 기능이다. 기존 편집기와 수집·가격·견적 연결을 먼저 완성하는 것과 이러한 모델을 추가하는 것은 별도 범위다.

## 현재 원본에서 직접 확인한 흐름

| 기능 | 정적 계약 | 재구현에 필요한 경계 |
| --- | --- | --- |
| 상세 사진 번역 | `POST /api/aiPage/getImageTranslateV2`에 `[{imgUrl}]`, 결과의 RequestId를 받아 `/api/aiPage/getImageTranslateBatchQuery`에서 OCR 목록을 조회. OCR 원문/배치 정보를 AI 번역으로 보완하고 `/api/aiPage/getImageOCR`에서 렌더 URL을 받음. 영어 입력은 ENG→KOR 명시. | OCR·텍스트 번역·픽셀 재합성을 분리하고, 번역 실패를 원본 URL의 성공 상태로 승격하지 않음. |
| AI 카피와 서식 | `requestExtensionTranslate`가 `workType:'AI_TRANSLATE'`와 이미지 URL, 원문 배열, prompt를 전달. prompt는 자연스러운 한국어 카피, 일관된 폰트 계층, 박스 크기 조정 정보를 요청. | 단순 무료 번역은 같은 모델의 창작 카피 결과가 아님. 사용자 수정값과 실제 번역 출처를 보존. |
| 대표/추가 글자 제거 | 같은 이미지 번역 API의 `Data.SslRmUrl || Data.RmUrl`를 결과로 사용. RequestId도 보관. 원본만 반환하는 실패 분기가 있음. | 실제 결과 파일이 생성되고 현재 이미지/옵션에 적용됐는지 검증. 단색 페인트와 배경 복원 모델을 구분. |
| 편집 세션 | `https://www.xiangjifanyi.com/image-editor/` iframe에 `XJ_IMAGE_EDITOR_REQUESTIDS`로 ID를 보내고 `XJ_SAVE_IMAGE`로 저장을 요청. | 제공자 내부 모델·세션 저장 형식·요금·보관 기간은 이 bridge에서 확인되지 않음. 자체 편집 문서를 유지하면 로컬 AI 없이도 재편집 가능. |
| 상세페이지 작성 | 사진 그룹·순서·배너로 별도 800px HTML을 구성. `html2canvas`로 800px/흰 배경/scale1을 렌더하고 JPEG .95를 업로드. 견적에는 결과 URL을 연결. 실패 시 개별 URL 쉼표 연결 fallback이 있음. | 사진별 원본/편집값·명시적 순서를 보존하고 통합 결과와 재편집 입력을 구분. 실패 fallback을 통합 이미지 성공으로 표시하지 않음. |
| 견적 AI | 기존 REA는 공통/차별 속성 분류, 공통값, 최대10옵션 단위 요청을 확인. 서버 기본 Gemini 경로와 확장 fallback이 존재. | 현재 YOOFAM의 Workers AI 제안/검토와 결합하되 상품 사실·인증·실측·동의를 모델로 채우지 않음. |

## Evidence와 source digest

기존 portable bundle `outputs/step653-rea-image-and-quote-evidence-bundle.json`의 10개 record를 실제 REA MCP `import_evidence_bundle`로 가져왔다. 부모 `ev_02780e2b058e642fc180a67b70caa803cccdc81f6dae0421b92e62c6c911e3a4`와 summary `ev_e7dcb81dc76a5313cee9110ac092a5fe3f56b5a78d3500fa2685bc97bfbd2c60`를 재조회했다. 이 부모는 선택15파일/25,408bytes/파싱실패0/semantic unknown978이며 전체 Couplus 서버 분석이 아니다. 새 producer를 반복 실행하지 않았다.

- 이미지 편집 bridge 기존 부모: `ev_6373190d88287217f0a505c6e86baff55ba4c1447b792b744463771033bf7809`. 정확한 범위/제한은 [Step684](step684-edit-session-parity-audit.md).
- 견적 AI 기존 부모: `ev_077d7423d18398f2639ac6cd730e4647bccc52ac3229cf3ad14e1082f97af8ad`. 정확한 task와 제공자 실행 범위는 [Step653](step653-rea-quotation-ai-single-preparation-2026-10-14.md).
- CLI 기존 부모: `ev_52b98239bfe56a801d9d058e990d32437210dd220a36bdde5f9870620dd50530`. 현재1.3.37의 역할과 한계는 [Step746](step746-cli-acquisition-audit.md).
- 현재 보관 main `outputs/step725-current-ui/main.a878a60f.js`: SHA256 `36a8e3252cba8096da3e9b06eaf3c338699dce35280a0080484a5c7181d20fb7`, 582,447bytes.
- 현재 보관 route `outputs/step725-current-ui/chunk-36123f1a.155d5b9e.js`: SHA256 `2fb15d370c331f65d982a886f2888b813ccae67277e87f806182c70032821664`, 553,821bytes.

현재 파일의 좁은 선택은 REA 새 producer가 아니라 SHA를 먼저 검증한 inert AST 직접 인용이다. `outputs/step750-ai-static-proof.json`에 exact source·UTF-16 half-open 범위·slice SHA를 보관했고 `step750-ai-static-inspect.mjs`로 재현한다.

| current method | UTF-16 범위 | slice SHA256 |
| --- | --- | --- |
| main translateSingleImage | [468747,474847) | `204faf276a782e6df46af4ae9330225f82103d729b6cb68b8222d60c161cbcad` |
| main getImageTranslateBatchQuery | [481535,481835) | `d47fa7e926d5d1e9a721584bbc28169b1e78eda7ca813b54618dd832e652b391` |
| main requestExtensionTranslate | [489275,489598) | `b293a6b6f0ee8b16ac31661b0b7965fa3168950010b4de85e5da81bfc43df0dc` |
| main convertHtmlToImage | [504031,506534) | `d787199929c9c602ba071fb3bc6e87c1dfc78c7f0156485c2158ab0fe9120606` |
| route saveDetailPage | [131288,136358) | `757d3e6097a2084225181b9e0cbf205687e1cb93061ea886e7b66b3f53dc28f2` |

제공자 실제 품질·계정 권한·API 비용·현재 vendor 서버 모델·전체 카테고리 동등성은 미확인이다. 새 1688 수집·실제 Hub 전송·동의·접수번호 검증으로 확대하지 않는다. 이 조사에서는 runtime/native/browser 세션을 열지 않아 종료할 소유 자원이 없다.
