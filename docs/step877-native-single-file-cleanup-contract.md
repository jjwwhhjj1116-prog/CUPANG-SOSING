# 공식 SR의 단일 파일 정리·읽기 계약

문서 2347603의 예상 밖 certificate 파일을 향후 정확히 한 건 정리할 수 있는지, 기존 보관 공식 SR 클라이언트만 정적으로 분석했다. 이번 조사에서 브라우저·네트워크·실제 저장 문서·파일은 읽거나 변경하지 않았다. 삭제·업로드·본문 update·문서 생성·단계 검증·접수 실행은 모두 0건이다. 아래는 구현 준비 근거이며 삭제 승인이나 현재 파일 상태의 증명이 아니다.

## 정확한 삭제 요청

대상 원본 `outputs/step755-current-sr-main.js`의 SHA-256은 `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`이다. 범위는 0부터 시작하는 반개방 UTF-16 범위이며 선택된 ASCII 구간은 바이트 범위와 같다.

| 원본 구간 | 관찰된 코드 계약 |
| --- | --- |
| `addFilesToDel` `[2876405,2876635)` | descriptor의 `s3Link`, `fileName`, `fileType`이 모두 truthy여야 로컬 삭제 대기에 넣는다. 해당 타입 map에서 fileName을 제외하고 세 필드를 `filesToDel`에 보관한다. 네트워크 요청은 하지 않는다. |
| `deleteFilesByKey` `[2879763,2879939)` | docId가 -1이거나 삭제 대기가 비어 있으면 호출하지 않는다. 그 외에는 `Wu('/draft/api/delete-uploads-by-keys/' + docId, {keys: filesToDel.map(file => file.s3Link)})`를 반환한다. |
| HTTP helper `[2835175,2835365)` | `Wu(url, params)`는 **`jr.delete(url, {params})`**이고, 응답의 `data`를 읽는다. `{keys: ...}`는 DELETE 본문이 아니라 URL query다. |
| HTTP client `[2472096,2472218)` | params serializer는 `qs.stringify(params, {arrayFormat:'repeat'})`이다. 따라서 여러 키는 `keys=...&keys=...`; 단일 키는 `?keys=<인코딩한 정확한 S3 키>`다. `keys[]`나 JSON 본문으로 바꾸면 원본과 다르다. |
| `upAndDelFilesById` `[2880253,2881993)` | 현재 draft의 docId를 사용해 삭제와 `import_type/certificate/additional/categoryCert/adCert/msds`의 모든 대기 업로드를 함께 조합한다. 성공 응답 뒤 삭제 대기의 fileType/fileName으로 로컬 map을 정리한다. **한 인증서 정리에 이 통합 함수를 호출하면 다른 대기 작업까지 실행할 수 있다.** |

향후 단일 정리 요청의 모양은 다음과 같다. 실제 S3 키를 문서·채팅·로그에 공개하지 않는다.

```text
DELETE /draft/api/delete-uploads-by-keys/2347603?keys=<encoded exact retained s3Link>
request body: 없음
```

서버 요청에는 fileType/fileName/descriptor ID/요청 revision/조건부 버전이 보이지 않는다. 선택 기준은 **문서번호와 S3 키**다. 이 endpoint는 `deleteUnusedImages`에서도 사용되므로 인증서 전용 삭제 API가 아니다. 파일명이나 certificate 타입만으로 안전 범위가 서버에 고정된다고 가정할 수 없다.

응답 `data`의 정확한 타입·삭제 건수·이미 없음에 대한 동작·반복 요청의 멱등성은 이 원문에서 확인되지 않는다. `upAndDelFilesById`는 delete 결과의 truthiness를 로컬 정리에 사용하고 마지막 성공 이벤트를 내므로 성공 이벤트만으로 정확한 파일 한 건 삭제를 증명할 수 없다. 요청 응답 유실 후 자동 반복하면 안 된다.

## 읽기·바이트 확인 경계

공식 metadata 경로는 `getFiles` `[2876636,2876999)`의 **POST `/draft/api/get-files-by-type/{docId}?fileType=certificate`**, 본문 `{}`다. 일반 draft loader는 fileType을 생략해 전체 법적 파일 목록을 읽으며, 응답의 `fileType`으로 그룹을 만든다. 현재 목록은 같은 문서에 묶인 응답으로 확인해야 하고, `fileName`·`fileType`·`s3Link`를 원형대로 보존한다.

메타데이터의 `s3Link`는 이 코드에서 삭제 키로 쓰일 뿐, URL이나 바이트 다운로드 endpoint라는 증거가 없다. Main 전체에 `get-by-key`, `get-file-by`, `download-file` 리터럴은 0개다. `fileUrl`·`downloadUrl`도 0개다. 이 부재는 이 Main 범위의 결과이며 서버나 다른 번들 전체의 부재 주장이 아니다.

범용 파일 uploader renderer `[416877,418448)`는 **입력 file 객체에 `path`가 있는 경우에만** 그 값을 anchor href로 사용한다. 그러나 인증서 셀 `[4044636,4045245)`은 uploader에 `{name:fileName}`만 넘기고 path나 s3Link를 넘기지 않는다. 따라서 이 인증서 셀의 파일명 클릭만으로 다운로드하는 경로는 이 원문에서 성립하지 않는다.

확인되지 않은 `/get-by-key` 주소를 만들거나 s3Link를 임의 URL로 바꾸면 안 된다. 현재 descriptor 자체가 제공한 검증 가능한 resource URL 또는 공식 화면의 실제 link가 별도로 관찰된 경우에만 그 정확한 주소로 바이트를 읽는다. 법적 파일과 이미지 descriptor가 같은 S3 키를 가리키는 것이 먼저 확인된다면, 이미 검증한 해당 이미지 descriptor의 정확한 resource URL을 사용할 가능성은 있으나, **이 역시 두 descriptor의 실제 키 일치와 서버 응답의 해시가 있어야 한다**. 이름 일치만으로는 대체할 수 없다.

## 향후 한 건 정리 전에 고정할 조건

1. 로그인 회원·회사, 원래 offer/product/request/doc2347603이 모두 유지되는지 전후 재확인한다. 다른 문서·기존 상품에는 요청하지 않는다.
2. 같은 문서의 최신 전체 legal 목록·이미지 descriptor·본문을 두 번 읽어 대상 descriptor가 정확히 한 개임을 확인한다. 별칭, 배열 강제변환, 파일명 추정으로 키를 고르지 않는다.
3. 모든 인증행의 번호/해당없음 값과 `cert{0-based row}-` 연결, LABEL 및 다른 이미지 역할, 기타 파일 참조를 대조한다. 인증서/이미지 역할에 필요한 키와 충돌하거나 공유되면 삭제하지 않는다.
4. 대상의 실제 바이트·해시를 읽을 수 없다면 그 불확실성을 명확히 표시하고, 확인된 메타데이터와 예상 밖 역할을 기준으로 사용자가 삭제 대상을 검토하게 한다. 미확인 바이트를 확인했다고 보고하지 않는다.
5. 별도의 실행 시점 승인을 받으면 고정된 한 키만 보내는 경로를 사용한다. 통합 업로드/삭제 함수, Next, Save, deleteAllFiles, 본문 update, 신규 문서 생성은 호출하지 않는다.
6. 요청 후 목록을 다시 읽어 해당 키 한 개만 사라졌는지, 다른 legal/image 키와 본문 SHA가 그대로인지 확인한다. 응답이 불명확하면 자동 재삭제하지 않고 읽기로 결과를 확인한다.

## 보관 근거와 한계

새 REA parent `ev_129b5c0e7d32e07430d8ef5ba652751b8efc206adbb9ba9a33c288e7f4bd0483`, summary `ev_448d450175113705105db628d9c629853bc000a062355a360dba531dacf0e85d`. 정확한 8개 구간·5,168바이트를 모두 파싱했고 실패는 0건이다. 구간 디렉터리 SHA `2bc5b478408cdf928d34ba680636303553373f989acb4ef608cfa7f3ca85694c`; 동적·외부 의미 unknown은 391개다. 원본/구간/래퍼 hash는 `outputs/step877-reautils-delete-manifest.json`, 전체 REA bundle은 `outputs/step877-reautils-delete-evidence.json`에 보관했다.

이전 [인증서 행 연결 분석](step876-retained-certificate-association.md)의 LABEL 분리·cert prefix·Next 저장 부작용 결론을 유지한다. 실제 현재 서버의 삭제 결과나 문서 내용, 파일 복구 가능성은 이번 정적 조사에서 미확인이다. 소유한 라이브/provider 프로세스나 브라우저 탭을 열지 않았다.
