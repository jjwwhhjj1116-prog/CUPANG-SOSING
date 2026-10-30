# 인증행 전체 범위와 해당없음 값의 정적 근거

보관 공식 SR Main SHA `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`에서 현재 문서의 인증행 스키마·순서·해당없음 처리를 추가로 추적했다. 라이브 브라우저·네트워크·운영 데이터·생산 코드 변경은 0건이다. 기존 삭제 endpoint 조사는 반복하지 않았다.

## 스키마 출처와 이름

`getSchemaForDraft` `[2855037,2855341)`는 문서의 displayCategoryCode/categoryId/scope/productNoticeNumber/version으로 GET `/schema/api/get-specified-schemaform-with-all-options`를 요청한다. query 필드는 internalDisplayCode, kanCategoryId, scopeType, noticeNumber, version, useCustomizedJsonSchema=true다.

`fetchSchema` `[2853839,2854593)`는 응답의 schemaString을 JSON.parse하고, 나머지 응답 필드를 schemaInfo로 보관한다. `resetPageSchema`/`convertAllOfToItems` `[2855516,2856637)`는 원본 `properties.legalPage.properties.certificates.allOf` 각 contains.properties를 같은 순서의 items로 바꾼다. 각 행의 **첫 두 property 이름**이 nameKey와 valueKey이며 첫 property의 enum이 인증 이름이다. 이름을 certificateName/certificateValue 등으로 하드코딩할 근거는 없다. 실제 값은 동일 문서·버전의 원본 schema에서 얻어야 한다.

인증 UI `[4124852,4127637)`는 첫 items의 property 두 이름과 각 행 첫 enum[0]을 사용한다. UI의 row index는 schema allOf/items 순서이며 파일 prefix `cert{index}-`의 index도 이 순서다.

## 해당없음의 정확한 값

지역 설정 `[2422163,2422190)`은 KR→ko, TW→zh_TW다. locale map `[2828172,2828209)`은 ko→Nc의 평탄화 결과이며, 한국어 locale JSON의 Nc 범위는 `[2632737,2734526)`다. 한국어 `certificates_na` literal `[2685414,2685470)`을 디코드한 값은 **`해당사항없음`**이다. 공백을 넣거나 일반적인 N/A로 바꾸면 원본의 strict equality와 다르다. 영문 및 대만 locale 값은 N/A다.

`gb` `[3026761,3026944)`가 region에 맞는 locale의 해당 키를 읽는다. 인증 UI에서 체크한 해당없음 값은 이 문자열이다. 실제 적용 지역은 별도로 확인해야 하며, 모르는 값을 자동 해당없음으로 바꾸지 않는다.

## 본문 배열 인덱스의 한계

`convertProductToForm` `[2860402,2863049)`은 우선 **jsonDocument[0]**을 복제한 뒤 그 legalPage.certificates를 현재 dataSchema의 인증행 순서로 정렬한다. `getSortAttributes` `[2863049,2863289)`는 각 schema 이름과 일치하는 본문 행을 찾아 새 순서로 만든다. 따라서 원격 raw body의 행번호만으로 공식 UI의 cert0-/cert1- 역할을 판정하면 안 된다. 인증 이름·동적 valueKey와 현재 스키마 순서를 함께 사용해야 한다. YOOFAM은 여러 옵션을 보존하므로 audit에서는 첫 옵션만 보지 않고 포함된 모든 문서의 값 일치를 확인해야 한다.

## 기존 YOOFAM packet으로 확인할 수 있는 범위

별도 소스 코드 확인에서 현재 `buildNativeLegalContext`는 원본 schema의 certificates.allOf를 전부 순회하며 모호한 필드 연결을 거절한다. 각 target binding에는 schemaSha256, categoryId, certificate.schemaIndex/fieldId/path/nameKey/valueKey/name/value가 있다. `buildNativeLegalAttachmentPlan`의 정상 metadataValid 계획은 이 target들을 그대로 담으며, PDF가 0개여도 target 목록은 남을 수 있다. 반대로 files가 비었다는 사실만으로 인증행 자체가 없음을 증명하지 않는다.

동일 서버 snapshot·회사·현재 package/source 지문에 묶인 **검증된** packet의 target을 audit에 전달하면 현재 기대 인증행의 동적 이름/값/순서를 제공할 수 있다. 다만 다음을 모두 확인해야 전체 범위라고 말할 수 있다.

- 대상의 schemaSha256/categoryId가 원래 요청의 현재 양식과 같다.
- 실제 인증 schema 행 수 또는 검증한 기대 본문의 전체 행 수와 certificate target 수가 일치하며 schemaIndex가 0..N-1이고 중복·누락·미확인 항목이 없다.
- 각 target의 동적 nameKey/valueKey/name/value가 포함된 모든 기대 문서 및 현재 원격 본문과 정확하게 일치한다. raw array 위치 대신 schema 인증 이름으로 모호하지 않게 연결한다.
- 실제 descriptor 전체에 native의 includes(`cert{index}-`) 규칙을 적용하되 복수 행/복수 파일 매칭을 자동 선택하지 않는다. 범위 밖 prefix나 이름 형식은 미확인으로 남긴다.

이 계약이 있어도 예상 밖 certificate가 **필요 없는 파일이라고 법적으로 판단**하거나 자동 삭제할 수 있는 것은 아니다. 증명 범위는 현재 schema 인증행/본문/이미지 역할에서 연결되는지 여부다. 특히 파일명과 이미지명 같음, 빈 PDF 계획, 포장 정보 등의 사실로 법적 해당 여부나 바이트 동등성을 추론하지 않는다.

새 REA parent `ev_e9500df35da38e9b65f561e3dbd3e4208b11abcc1f924dab4c99234391ce164f`, summary `ev_4292e04fdce195f3ddd6aeff2678743ac44b00fd8dd753c03417f804bd138cd2`. 10개 구간·8,404바이트 모두 파싱, 실패 0건, 동적/외부 의미 unknown 676개다. 디렉터리 SHA `bef214f43d822621188351b5355ee9aa84aa88b387ab1940f77a3a5a8a1a0469`; manifest `outputs/step877-reautils-schema-manifest.json`. 정적 분석은 현재 실제 서버 schema 응답이나 특정 상품의 서류 필요성을 관찰한 것이 아니다.
