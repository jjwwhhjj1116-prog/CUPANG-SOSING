# Supplier Hub 81221 individual-registration observation

Observed 2026-09-27 in the user's existing right Chrome, new verification draft
`YOOFAM sample gloves`. Existing user products were not changed.

## Product input

The bulk option entry dialog appends options; it does not replace existing empty
rows. Only the two empty rows of this verification draft were removed. Its sole
option was entered as 검정 / 1개 / M, supply 6500 and sale 9900. Model was
YOOFAM-TEST-001; brand/manufacturer YOOFAM TEST. These are test values, not source
product data or approved commercial information.

Input values must be committed with keyboard input. Visible text from a fill
operation alone previously failed to persist in the site's form state. The
option price cells accepted Enter → type → Enter. The preview rendered 9,900원
and 검정 x 1개 x M. A required-option warning was also present after preview;
do not regard this as complete validation of all row data.

## Official preview notice fields, in order

1. 품명 및 모델명
2. KC 인증정보
3. 크기, 중량
4. 색상
5. 재질
6. 제품 구성
7. 출시년월
8. 제조자(수입자)
9. 제조국
10. 상품별 세부 사양
11. 품질보증기준
12. A/S 책임자와 전화번호

These labels match `couplus81221Fields` exactly. Empty preview cells do not
establish Couplus initial defaults, requiredness, or acceptable legal values.
The preview confirmed category 스포츠/레져 > 스포츠 잡화 > 스포츠 장갑 (81221).

## Remaining boundary

Next requires MSRP/OSRP data-use agreement. The dialog includes a declaration
of authority to establish manufacturer suggested or official-site prices.
No agreement was accepted for this fictional verification product. Preview
was available without acceptance; clicking the image-stage indicator did not
navigate forward. Image, legal and logistics entry screens remain unverified.

No final submission, barcode generation, or image upload was performed. The
draft existed from step406; last saved time stayed 21:39 during this inspection.
Do not confuse the site's illustrative preview rating/delivery text with real
reviews, live listing or acceptance. POST /api/supplier-hub still returns501;
this browser investigation is not an implemented transport adapter.
