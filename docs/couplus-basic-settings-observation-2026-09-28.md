# Couplus basic settings observation — 2026-09-28

Read-only UI observation in the existing user-designated Chrome connection at https://couplus.co.kr/AIRocketReg. Opened Basic Settings; did not save settings or edit existing products.

The signed-in page has a `비노출속성 자동 생성` checkbox, currently unchecked. Its help text says disabling it is faster and recommends disabling it if hidden attributes are unnecessary. This verifies an independent hidden-attribute setting; it does not reveal the server-side collection implementation.

The same screen shows the supply-price formula as purchase price divided by (1 - supply margin / 100), and sale price as supply price divided by (1 - Coupang margin / 100). Current account values are exchange rate 350, supply margin 50%, Coupang margin 40%, 10-won rounding, MSRP multiplier 1.3 and minimum supply margin 3000 enabled. No values were changed.

Implementation in step 455: carry the captured hidden-attribute switch with translated category suggestions. Disable hidden suggestion matching and saved-rule application when false, while preserving exposed attributes, source translations, direct label/option facts and manual quotation overrides. Existing snapshots without this metadata retain their behavior. This does not claim that model inference behavior or latency matches Couplus; source attribute translation still runs to support SEO and labels.

Remaining unverified: all-category defaults and schemas, actual 1688 collection, official workbook and complete Supplier Hub registration.
