# Step739 — 2단계 가격 정책 입력의 재계산 trigger

2026-10-19 KST, 조사 시작 commit `28649d4784a517049cc6999685c09ae10c2a1699`. 기존 Step695·697·698·716·719·727·733의 분석을 먼저 재사용했다. 이 담당은 보관 source와 자체 코드·격리 React callback만 읽거나 실행했으며 앱/DB/테스트/확장 수정은 하지 않았다. 새 REA producer, vendor 실행, 네트워크, 브라우저, collector/CLI, 운영 자료·기존 상품 접근은0이다. 가격의 사전 재현은 root의 후속 수정 전 파일 SHA에 묶인 기록이다.

## 확인한 남은 차이

**원본은 2단계의 가격 정책 control을 바꿔도 일반 행을 Stage2 산식으로 재계산한다. 자체는 별도 ‘일괄 재계산’ 버튼을 눌러야 그 mode·저장 intent를 켰다.** 원본의 초기 worker와 명시 Stage2 산식 차이는 Step698·733에서 이미 확인·구현했으므로 새 산식을 발견한 것으로 세지 않는다. 이번 발견은 아직 연결되지 않았던 **정책 입력 변경 → 재계산 intent → 명시 저장** 경계다.

신규 수집 정책은 원래대로 초기 worker 산식을 사용하고 `recalculationMode`를 갖지 않는다. 수정 전 `PriceEditor`의 환율·공급/쿠팡 마진·최소액·단위·최소마진 토글 callback은 `setPolicy`만 호출했다. Stage2 marker와 pending replacement intent는 ‘일괄 재계산’ 버튼에서만 만들었다. 따라서 원문이 정상이어도 사용자가 환율만 바꾸고 저장하면 초기 floor 산식이 계속 적용됐다. 저장 API는 전달된 정책으로 `calculatePrice`를 실행하므로 자체 callback의 차이가 최종 견적 자동 가격에도 이어질 수 있다. 이 재현에는 수동 가격 override를 넣지 않았다.

실제 자체 `PriceEditor` callback과 `pricing.ts`를 격리된 hook renderer에서 실행했다. 원가는20 CNY, 일반환율350→400, 공급마진50%, 쿠팡마진40%, 최소 공급마진3,000 ON, nearest10, 원본 Number mode다.

| 같은 최종 입력에서 수행한 동작 | 공급가 | 판매가 | 판정 |
| --- | ---: | ---: | --- |
| 수정 전 자체: 환율400 입력 → 저장 | 16,000 | 26,670 | mode·recalculate intent 없음, 초기 floor 분기 |
| 보관 원본 정책 change의 일반 산식 | 11,000 | 18,330 | 원가8,000+최소액3,000 직접식 |
| 수정 전 자체: 같은 입력 → 일괄 재계산 → 저장 | 11,000 | 18,330 | 기존 Stage2 marker·intent가 있어 일치 |

원본 행을 실행한 결과가 아니라, source에 직접 보이는 일반 산식을 독립 계산한 값이다. 자체 실행의 onSave는 메모리 배열에 입력을 기록하는 callback이며 HTTP/DB 쓰기는0이다. 첫 재현기에서는 첫 저장 이후 부모 initial prop을 갱신하지 않아 다음 explicit button의 환율이350으로 돌아가는 fixture 오류가 있었다. 실제 성공 응답을 받은 부모처럼 initial prop을 갱신하도록 고친 뒤 위 비교를 확인했다. 앱 동작을 그 fixture 오류에 맞춰 바꾸지 않았다.

## 원본이 직접 가격도 덮는지

원본 `updatePricing`은 `calculatedOptions` 전체를 순회하며 `recalculateOption(index)`을 호출한다. selectedOptions 필터는 없다. 그 함수는 `sourcingSellingPrice`가 있는 고정 소싱가 경로만 별도로 처리하며, **일반 상품 경로에는 manual/reviewed/override flag를 검사하는 분기가 없다.** 최소마진 토글이 true이면 금액>0을 재검사하지 않고 `purchaseCost + minSupplyMarginAmount`를 계산한다. 그러므로 **ON·0도 직접 원가+0**이다. 그 뒤 `purchasePrice/supplyPrice/sellingPrice/supplyMargin/sellingMargin`을 해당 행에 매번 쓴다.

공급가·판매가를 직접 입력하는 별도 callback은 자기 가격과 행 마진만 갱신하지만, 그 이후 정책 control change가 발생하면 일반 재계산은 그 값을 다시 쓴다. 이것은 보관 함수의 정적 분기 사실이며 기존 사용자 행을 변경해 시험하지 않았다. `savePricing`이 이 로컬 배열을 옵션·문서의 대응 `purchasePrice`/`coupangSalePrice`에 명시 저장한다. 초기 render나 단순 읽기에서 운영 가격을 다시 쓰는 근거가 아니다.

확인한 trigger는 환율·공급마진·쿠팡마진·최소액의 `change:t.updatePricing`, 반올림 단위 및 최소마진 토글의 model change 뒤 `t.updatePricing`이다. 번들 활성화·마진 기준/기준액에도 인접 trigger가 있으나 이번 우선 결함을 해결한다는 이유로 번들/고정 목표가 범위를 임의 확장하지 않는다. 특히 원본의 수동값 overwrite 근거는 있지만, 자체의 독립 OSRP·다른 카테고리·제외 행·raw 원문까지 지울 근거는 없다.

## 최소 재구성 권고

정책 control의 명시적 변경이 기존 버튼과 같은 Stage2 재계산 초안을 만들고, 저장 전에는 로컬 계산·가격 교체 범위를 보여주는 방향이 적절하다. 최초 로딩/배경 refresh/단순 조회에서 mode를 추가하지 않는다. 유효한 가격 control 변경과 단순 입력 중의 NaN/빈 값도 구별해야 한다. 저장 전에는 DB와 기존 직접값을 유지하고, **명시 저장할 때만** 기존 버튼과 같은 현재 카테고리·포함 옵션 exact 가격 alias의 교체 transaction/CAS를 사용한다. 실패·불명확 ACK·stale callback에는 입력과 intent를 보존하고 중복 저장을 자동으로 반복하지 않는다.

원본은 change 때 local 직접값을 덮지만 자체가 사용자에게 보여주지도 않고 그 값을 즉시 서버에서 지울 이유는 없다. Step698의 pending intent와 replacement preview, Step719의 dirty barrier를 함께 재사용하면 같은 정책변경→검토→저장 패턴을 유지할 수 있다. 원래 initial floor 계산, `minimumEnabled` ON·0 marker, Number 연산, 독립 MSRP/OSRP 소유권·다른 카테고리/옵션 보호와 receipt identity는 바꾸지 않는다.

## 정확한 원본·Evidence·해시

현재 보관 route는 `outputs/step725-current-ui/chunk-36123f1a.155d5b9e.js`, SHA-256 `2fb15d370c331f65d982a886f2888b813ccae67277e87f806182c70032821664`다. 모든 범위는 UTF-16이며 끝 제외다. byte 범위와 control 원문도 proof JSON에 있다.

| 경계 | 범위 | slice SHA-256 |
| --- | --- | --- |
| updatePricing | `[177031,177145)` | `64c93c23b077181bb25bd3a390af4db1245c30bbbcc9c34782281d7fbe69fe97` |
| recalculateOption | `[177626,179414)` | `26015eb6c5cde9542738b38d8b29fbf62e4a672d8bac977996a4ab5fb7431632` |
| savePricing | `[180480,184602)` | `da54aa8a394c3860bb6707595658baa49d613ec5386c831830ecf0f6a5ab5ab6` |
| 환율 control | `[155687,156102)` | `9170955772fa498523ad28465c06d06a42664dc94af4e67d15c8d8dfa7b2a55c` |
| 공급마진 control | `[156147,156562)` | `e00c633abba1d5d743764daf712319cdada86065057bf6aa85890c9bbd1d9e0d` |
| 쿠팡마진 control | `[156626,157041)` | `c8bfde774ddd68a1d95e7a786a6ad8206bd2ef80414b55389e022b241643bb02` |
| 최소액 control | `[158801,159216)` | `bfb9e8a5618cd0b95d7f9843c598a6ae4e4528e31b48338c4a0ee62ab5c00537` |
| 반올림 단위 control | `[157055,157815)` | `146da750b5553f34a5d80c6f80e746b47c11a77f15f386ef4664703dd8642aa4` |
| 최소마진 ON/OFF | `[157766,158526)` | `4f7b9947c0e099af762b45fc42667cc26dc6d403603c77e5b91f8f0954526c82` |

가격 관련 기존 parent `ev_80058b8130c110cfd1ec44a0c48cf2441311a5ce02c3a66e52f40c0fbf65b42f`와 `ev_cd5b12712ef6b71c2acfc13858957b76b067e15d1319aac6ac68b3c3a642258a`, Step698의 원래 method/control manifest 및 Step727의 current method manifest를 재사용한다. processOptions 하나를 분석했던 `ev_5869...`/`ev_40f...`를 다른 PricingEdit 함수의 직접 Evidence로 쓰지 않았다. 선택 정적 source이며 private backend·동적 `this`/Vuex와 실제 runtime 성공으로 확대하지 않는다. 새 producer는0이다.

사전 재현의 자체 SHA는 `price-editor.tsx=de34ee8c1b104225cc4fdfcdb57ba2227b23419e98193f416d79c4974b86fd62`, `pricing.ts=3966104655460d3739cc2d6aa5a509652831f51ec26f3f7949cab54ab62d1001`이다. `outputs/step739-price-control-change-proof.json`은 그 source5개 실행 전후 동일성, 두 저장 callback 입력과 계산값, 원본 exact slice를 기록한다. 후속 root 수정 이후 같은 old-gap 단언은 ordinary save가 Stage2 marker를 보내는 지점에서 실패했으며, 과거 proof를 새 소스로 성공한 기록처럼 덮지 않았다. 수정 후 검수는 별도 source SHA로 남겨야 한다.

## 등록전송 경계

Step724·727의 현재 `verifyProducts [484044,487207)` SHA `86ac55ce97c54186de9ea8797be927df2afbcc1c1c17539c7fefd2fd6ca0da82`와 `processNextVerification [488342,492647)` SHA `e9a6114a4e9f82db46ff8b700d9fed5e915a310effe6fd8864729d5e5edcd706`를 다시 hash 대조했다. 선택 상품/분할 그룹 하나에 저장된 전체 jsonDocument를 한 VERIFY body로 전달하는 계약이며, 가격 단계의 purchasePrice는 원가가 아닌 공급가다. 관련 receiver parent `ev_17ed0cebd00b285e0bc489221547e437d2b3f69d9b636a813eb942a0a2a3a49a`, summary `ev_05abd95724353b22c4ca14685b3e8dbe88bc4f0cee756eea76a4dd6873b7f42c`는 그 기존 범위를 넘겨 해석하지 않는다.

실제 Hub create/update/동의/접수·qvt/SKU join, 실제 새 1688 수집과 전 카테고리 동등성은 미확인이다. 이 가격 trigger 재현이나 정적 VERIFY body로 실제 접수 완료·live gate 해제를 주장하지 않는다. 기존 작업 상품은 읽거나 변경하지 않았고 종료할 owned native/runtime/browser 자원도 없다.

## 수정 후 독립 검토

root는 정책 입력 변경을 `changePolicy`에 모아 현재 scope의 재계산 intent·Stage2 mode·최소마진 ON·0을 로컬에 보존했다. nearest 선택에만 Number mode를 넣으며 기존 올림 선택은 바꾸지 않는다. 최초 mount/clean refresh는 원래 정책을 유지한다. 화면에는 저장 시 직접 공급가·판매가·권장소비자가도 새 값으로 바뀐다는 안내가 표시되고, 명시 저장만 기존 scoped atomic 가격 API의 `recalculate:true`를 사용한다. latest reload는 원래 `setPolicy`로 입력과 교체 intent를 폐기하며, 초기 데이터·다른 카테고리·가격 외의 필드·원문을 자동 수정하는 경로는 추가하지 않았다.

첫 수정 검토에서 enabled일 때 보관한 같은-scope control callback을 latest `disabled=true` 뒤 호출하면 closure의 옛 false를 읽어 FX400과 가격 교체 intent를 만드는 결함을 재현했다. `outputs/step739-price-stale-disabled-before-fix.json`에 source SHA·전후 값과 무저장 재현을 보존했다. 이 재현은 정책 값·intent에 한정하며 원격 저장이나 실제 데이터 변경으로 확대하지 않는다. root는 latest disabled ref로 change/submit/기존 버튼을 검사하고 최소마진 토글의 부수효과 전에도 같은 guard를 적용했다. 이후 해당 조건이 차단되는 것을 다시 확인했다.

최종 자체 격리 component callback 단언10개가 통과했다. 최초 policy 미표식·읽기 전용, control 변경만으로 원본11000/18330 및 교체 안내·명시 저장, 같은 render의 두 control 병합, ON·0와 OFF/ON 복구, 올림/nearest 선택, 보관된 enabled callback의 latest disabled 차단, A→B→A scope의 옛 callback 차단, 렌더 전 pending save의 동기 edit/중복 submit 차단, 실패 시 입력·intent 유지, 취소/latest reload 무저장, 빈 숫자 저장 차단을 확인했다. 검토 source5개의 실행 전후 SHA가 같고 actionable 지적은 없다. `outputs/step739-price-final-review.{mjs,json}`에 조건·해시·한계를 기록했다.

| 최종 독립 검토 source | SHA-256 |
| --- | --- |
| `app/components/price-editor.tsx` | `20e3f03bb8d448068d15e434c2c89a0842c9cd4d66ac32417ffafbab578c253b` |
| `app/pricing.ts` | `3966104655460d3739cc2d6aa5a509652831f51ec26f3f7949cab54ab62d1001` |
| `app/api/products/[id]/pricing/route.ts` | `f0bbb42636fa0c01e33f39f5f9a1daef7385d937f77db646492d2ef2e260a43b` |
| `app/policy-quotation-prices.ts` | `c1cda844f7797a148ccc98b361d2785b901470d93a788d11ba1a72edcb5c71db` |
| `tests/price-control-recalculation-flow.test.mjs` | `24126fb3f46e2c9ef039c7b0eeed4a617c79b2b848c632fe549af4dade186d29` |

독립 단언10개는 root의 양사 API/SQLite·공식 XLSX 가격 칸 통합검사나 릴리스 총계에 중복 합산하지 않는다. 이 담당의 실행은 자체 hook harness와 메모리 callback까지이며 브라우저·원문/Hub·운영 DB·실접수는 실행하지 않았다. 초기 gap과 중간 guard 결함의 수정 전 기록을 최종 성공으로 덮어쓰지 않았다.
