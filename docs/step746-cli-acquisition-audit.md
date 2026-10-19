# Step746 — 현재 Couplus CLI와 1688 수집 경계

결론: 현재 배포 CLI **1.3.37**은 서버가 내려주는 도구·요청 recipe와 열린 웹페이지 사이의 실행기입니다. 이 패키지를 설치하는 것만으로 YOOFAM PLUS에 1688 상품정보 제공자가 생긴다는 근거는 없습니다. URL 상품 초안의 핵심 미확정 경계는 **정당하게 사용할 수 있는 구조화된 상품 상세 응답의 제공자/계약**입니다. CLI 부재 자체를 수집 버그라고 판정하지 않습니다.

## 대상과 재사용 근거

- 이번 부모가 현재 UI에 표시된 공식 공개 다운로드에서 보관한 `outputs/step746-couplus-cli-latest.tgz`: 9,170,840바이트, package version `1.3.37`, SHA-256 `9089561e73521ffea12e4be1a3abc6ffa70e2716ecdf121ee2464a4b4979b4f3`.
- Step725 보관 아카이브와 **전체 바이트 SHA가 동일**합니다. 현재 아카이브의 JS 51개 모두 기존 텍스트 추출본과 개별 SHA를 비교했습니다. 새 REA producer는 실행하지 않았습니다.
- 실제 REA MCP `import_evidence_bundle`로 기존 2개 Evidence를 가져오고 summary/modules와 정확한 asset node 3개를 열었습니다. 부모 Evidence `ev_52b98239bfe56a801d9d058e990d32437210dd220a36bdde5f9870620dd50530`, summary `ev_624545dd6422e3465c8f003e646857db31cd6939a4f99b5b834d330d76d629d3`.
- 이 REA 부모의 범위는 remote/catalog/runner/registry/server.tools **선택 5파일**입니다. 선택 디렉터리 digest `f8de028a82013ec566604aa502be6a4159aa4647fd03ad5f5815e0b2f9fed9e0`, semantic unknowns 2,895. 아래 page-channel/local-ops/queue와 구버전은 별도의 inert AST/원문 검사이며 이 부모 Evidence 범위로 확대하지 않았습니다.
- 구버전 비교는 로컬 보관 package `../analysis/couplus-cli/package`의 `1.3.2`입니다. 처음 지정된 1.3.24 아카이브(SHA `98106402185e46c925a34a9c655e0331f54d0b5ab78abb173a9d5599ff0387bd`)는 비교용일 뿐, 현재 동작의 결정 근거로 쓰지 않았습니다.

## 현재 1.3.37에서 확인되는 정확한 계약

아래 범위는 UTF-16 시작 포함/끝 제외입니다. 전체 source SHA, UTF-8 byte 범위, 정확한 slice SHA와 원문은 `outputs/step746-cli-proof.json`에 있습니다.

| 파일·범위 | 정적으로 확인한 내용 |
|---|---|
| `core/remote.js` f `[596,909)`, h `[909,1135)`, g `[1135,1325)` | `/api/cli/rpc`에 bootstrap 본문 `{}`를 보내 응답 `ops`를 얻음. 이후 논리 op를 `x-couplus-op`으로, tool 인자를 `x-couplus-op-arg`로 전달. `stale:true`이면 op map 갱신 후 한 번 재시도. |
| `core/tool-catalog.js` g `[720,1285)`, y `[1285,1782)` | `{op:'catalog'}`에 `{companyid,suppliercode,sessionOnly:1}`와 세션 cookie를 사용. `success===true`, `tools` 배열, `version` 문자열을 요구. 현재 동적 도구의 실제 목록은 패키지에 고정되어 있지 않음. |
| `tools/server.tools.js` 전체 18바이트 | 정확히 `module.exports=[];`. 이 사실만으로 서버 도구가 전혀 없다고 말하지 않음: 동적 catalog에서 제공됨. |
| `core/tool-runner.js` Pe `[19755,19893)`, Oe `[18308,18454)`, _e `[16403,18308)` | catalog 도구명으로 `{op:'tool',arg:toolName}` 호출. 첫 본문 `{n:1,params,identity,runner,phase:'start'}`. 서버가 `done:true`이면 `result`를 반환; 미완료면 `request` 또는 `requests`를 실행하고 다음 단계 본문을 서버에 보냄. |
| 같은 파일 be `[14509,14942)`, ve `[15644,15952)` | 지원 kind는 `coupang/http/local/page/tool`. 후속 본문은 `{n,state,identity,runner,response}` 또는 `responses`. 실행할 요청의 상세는 서버 응답이 제공하므로 현재 비공개 recipe는 미관측. |
| 같은 파일 ye `[13113,13944)` | 서버 recipe의 `{screen,tool,params}`를 page-channel로 전달. `wait:'sync'`는 `dispatchAndWait`, 그 외 `dispatch`의 job을 반환. 실제 상품 수집 구현 자체가 이 함수에 들어 있지 않음. |
| `core/page-channel.js` T `[2499,2981)`, N `[5173,5616)`, k `[5616,5843)`, U `[6166,7118)` | 열린 화면이 도구를 선언하고, screen/tool/params job을 전달하며 화면이 `running/done/error`, `result/error`를 보고. 이 `done`은 페이지 job 완료로, 상품 원문 수집이나 Supplier Hub 접수 자체의 독립 증거가 아님. |
| `core/local-ops.js` w `[731,4639)`, `core/registration-queue.js` d `[1666,1919)` | `queue.append`는 제공된 items를 로컬 대기열에 추가하고 중복 정책/개수 결과를 반환. 그 자체로 상세 상품 정보 조회를 수행하지 않음. 실제 파일/계정 데이터는 읽지 않았음. |

현재 자산 Evidence와 source SHA:

- remote: `ev_3a4dad06d89917a9cde39668c3c3d5e14eceda12c34e1d6fe788aa73139f0fea`, SHA `dfa1be9a7ffaad813ac3b805ef8dab905f8caf903ff2f72a776ba40fc226ad2d`.
- runner: `ev_f392131cf70fb0092c71af34383a1f16b350da141e07249cadfabfc8e008907c`, SHA `fd11bdf68ff8ae87f976e142699ea9b685283d357a75ce7f4d9a948dc62a3ce4`.
- catalog: `ev_ce0edd355a95c7d10f5f684fbfee6f5a597925d5978bf96f7c70aa4825315684`, SHA `528ad26faf4d2ad28b63aebaea9fdbb82b414ab3bd89905a429b06c75690ff25`.

현재 51개 JS 텍스트 안에서 `1688`, `alibaba`, `getProductInfo`, `productSkuInfos`, `rocket.addRegistration`, `rocket.startQueue`, `growth.getOfferDetail` literal은 각각 0개입니다. **범위가 정해진 부재**이며 동적 서버 recipe나 미분석 native 코드까지 없다고 증명하지 않습니다.

## 구버전 1.3.2의 URL → add/start → 상세 조회

이 부분은 현재 catalog 목록을 증명하지 않습니다. 다만 과거 문서의 이름과 현재 generic 실행기를 혼동하지 않도록 별도로 확인했습니다.

1. `tools/offer-id.js` r `[0,329)`는 숫자 또는 `/offer/<id>`/`?offerId=<id>`에서 offerId를 추출합니다.
2. `tools/rocket.tools.js` `rocket.addRegistration` `[9827,11545)`, slice SHA `658ace62a82f78fd683e70a70fbad2fb9dbbb58c021e95539c2604a235ed19fa`: `{link,offerId,categoryCode,categoryPath,categoryPathString,keyword,productFeature,stepLevel,_queueId,addedAt}`를 대기열에 넣습니다. 설명과 실행 코드 모두 **추가만으로 상품은 생성되지 않음**을 명시합니다.
3. `rocket.startQueue` `[12263,13828)`, slice SHA `9ac4077664187119ad70a8292eebae5a78e21d95201e3e7cec6002b786d1f170`: `screen:'rocketReg',tool:'rocket.startQueue',params:{stepLevel}` page job을 전달합니다. 이 코드에도 상품 상세 제공자가 들어 있지 않습니다.
4. `tools/sourcing/alibaba.js` `growth.getOfferDetail` `[12402,14472)`, slice SHA `57628c37218f72c39ef50a80f78ba4de17999a1317cee85d3703009da0fdd753`: `alibaba-offer-detail`로 `[{productId:offerId}]`를 보냅니다. `core/remote.js` route i `[217,379)`는 **Couplus 서버의 `/api/aiPage/getProductInfo`**를 가리킵니다. URL 서버를 직접 1688으로 설정하거나 호출하는 코드가 아닙니다.
5. 성공 결과는 `{products:[{offerId,detail,strippedFields}],requested,failed,source:'1688-openapi'}`. 배열 응답 수가 요청 수와 일치해야 하고 전부 실패면 throw. 안내에 `detail.result.result.productSkuInfos/productShippingInfo/productAttribute`가 명시됩니다. `u` `[2651,2957)`는 4,000자를 넘는 문자열을 생략하므로 이 CLI 표시 응답을 완전한 원문 receipt로 사용할 수도 없습니다.

`source:'1688-openapi'` 문구만으로 실제 provider 소유자, API 권한, 가격, 공개 지원 여부를 확정하지 않습니다. 위 상세 조회 경로는 **비공개 Couplus upstream 의존성의 과거 직접 근거**입니다.

## 구현에 주는 좁은 판단과 미확인 경계

- URL/offerId 정규화, 선택한 Hub 카테고리 보존, 원본 SKU/위안 가격/갤러리 역할을 Stage1–7로 전달하는 자체 계약과, 그 사실을 공급하는 upstream을 분리해야 합니다. 로컬 CLI를 새로 설치하거나 같은 이름의 job을 추가해 upstream 응답이 생긴 것처럼 처리하면 안 됩니다.
- 현재 1.3.37 서버의 op alias, 실제 catalog 도구명/권한, 수집 recipe, 최종 원본 응답은 요청하지 않았습니다. 구버전 endpoint만 복제해 Couplus의 사설 서비스를 무단 호출하자는 권고도 하지 않습니다.
- 부모가 이번 현재 route에서 확인한 직접 상품조회 요청/응답 메서드와 함께 보면, 남은 경계는 **자체 서비스가 사용할 수 있는 진짜 상세 데이터 제공자와 검증된 response fixture**입니다. 이 문서는 자체 worker의 실제 HTTP 성공/실패를 판정하지 않습니다.
- 특히 새 상품 `963861920029`는 도구가 본문 접근을 거절한 상태입니다. 앱 fallback이 실제 실패했다고 주장할 관측은 없고, CLI·Couplus·프록시로 우회해 재취득하지 않았습니다.
- 동일 UI/단계 완료, 전체 카테고리 동등성, 실제 원문 수집·Hub 최종 접수는 이 정적 검사로 증명되지 않습니다.

검증: own inert proof 실행 exit 0, 아카이브 57멤버/JS51개 일치, 선택 11파일·30범위 SHA 기록. 신규 REA producer 0, vendor 실행/설치 0, 브라우저/네트워크/실상품/운영 데이터 접근·변경 0. 열린 native/session 자원은 없습니다.
