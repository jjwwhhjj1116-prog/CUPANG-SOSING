# 수집 결과 수신 계약 (v1)

인증된 동일 작업공간의 공급원 연결용 API입니다. 현재 실제 1688 공급원은 연결되지 않았습니다. 수신은 데이터 구조 검증이며 공급원 신뢰성·실상품 일치의 독립 검증이 아닙니다. provider 값은 송신자가 제공한 이름입니다.

- POST /api/collection-jobs/{id}/result: JSON, 최대 512KiB. 운영은 검증된 Access 인증 필수. 수집 요청 소유자와 일치해야 합니다.
- GET 같은 경로: receipt 또는 null, productCreated:false. 취소된 요청의 기존 원문도 소유자는 읽을 수 있습니다.
- 동일한 정규화 결과 재전송은 한 건으로 유지합니다. 다른 결과 재전송·취소된 요청은409, 타 소유자/없는 요청404, 내용 오류400, 크기 초과413입니다.
- 원문에는 schemaVersion:1, sourceUrl, provider, collectedAt(UTC), title, description, options, images가 필요합니다. 임의 필드/로그인 토큰/쿠키를 보내지 마세요.
- options: 1~200개, 고유 sku, 원문 name, 양수 unitPriceCny, 정수 minimumOrder≥1, stock은 정수≥0 또는 미확인 null.
- images: 최대200개, {url,role}. HTTPS alicdn.com 하위 호스트만 허용하며 인증정보·포트·fragment·중복 주소는 거절합니다. role은 main/additional/detail이고 main은 최대1장입니다.
- 가격은 CNY 단가이며 구간 가격 선택이나 SKU 매핑은 공급원 어댑터에서 검증해야 합니다. 자동 번역·SEO·인증값을 원문과 혼합하지 않습니다.

현재 저장 위치는 collection_results이며 요청 당시 category/settings 문맥은 기존 collection_context에 보존됩니다. 수신만으로 상품 생성, 수집완료 표시, 결제, 등록전송을 수행하지 않습니다. 외부 사이트에 접근하지 않는 합성 API/SQLite 테스트를 실수집 성공으로 해석하면 안 됩니다.

## 상품 반영

- POST /api/collection-jobs/{id}/product: 본문 없이 수신 원문을 상품·가격 정책·옵션·콘텐츠로 원자적으로 저장합니다. 동일 작업공간 소유권과 운영 Access 인증이 필요합니다.
- collection_products가 요청과 상품을 일대일 연결합니다. 재시도는 기존 productId를 반환하며 수동 수정값을 덮어쓰지 않습니다. 중간 실패는 전체 롤백됩니다.
- 요청 당시 기본설정으로 가격을 계산하고 원문 제목·설명·SKU·옵션명·단가·최소 주문량을 보존합니다. 원문 재고는 수신 자료에서 조회합니다. 최소 주문량을 번들 수량으로 간주하지 않습니다.
- 상품 반영 후 요청 취소는 차단하여 카테고리 문맥을 보존합니다. 요청의 내부 상태는 awaiting_connector를 유지하며 product_id로 반영 여부를 구분합니다.
- 번역 완료, 이미지 다운로드, 인증값, Supplier Hub 등록 완료를 생성하지 않습니다. 목표가 transmit이어도 이 API는 등록 전송이나 유료 작업을 시작하지 않습니다.
- 이미지 다운로드/R2, 실제 공급원 인증/실행은 남은 작업입니다. result GET의 productCreated:false는 해당 조회/수신 API 자체가 상품을 생성하지 않는다는 의미이며 반영 상태는 대기열의 product_id에서 확인합니다.
