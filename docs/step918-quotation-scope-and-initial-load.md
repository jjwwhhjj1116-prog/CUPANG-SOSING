# Stage 7 scope and eager quotation loading

## Shared option scope

Read-only COUPLUS runtime inspection confirmed one scope flag for save and AI processing. YOOFAM's visible save switch was OFF while its separately initialized AI panel requested all options. The new actual parent/child fixture reproduced an all-option POST from that state; eight of nine initial new cases failed, with standalone default behavior remaining green.

The editor now supplies its existing scope to its AI panel. Either control changes the same value; the header action and proposal application are bound to the current option, boolean and callback epoch. Stale OFF→ON→OFF callbacks cannot acquire fresh authority. Running/uncertain requests keep their original UUID and recovery proof and prevent scope changes without disabling their own read/recovery controls. Common values with OFF require choosing an option through the existing selector. Standalone AI-panel callers retain their old default.

## Responsiveness fix

The hidden QuotationPanel used to mount even for the first SEO visit. Its parent context load started category profiles and full quotation-fields reads. DetailPanel now activates that panel only on its first quotation visit and then keeps the same instance mounted through tab changes and existing version/refresh updates. The visit/key is separated by owner and product. Existing profile callbacks and the independent registration-layout hook remain unchanged.

The real panel/API fixture proves those two eager parent-context GETs drop from two to zero before a quotation visit. It also proves immediate first-visit mounting and retention of editor draft/pending state. This is not a claim that all Dashboard requests are removed or that first quotation entry makes only two requests. Its subsequent editor read and other stage queries still exist. No wall-clock speedup percentage was established.

## Actual settings comparison

Both logged-in basic-settings screens were read without saving on 2026-11-03. COUPLUS reference values are observations of that account, not universal defaults or current exchange-rate advice.

| Setting | COUPLUS observed | YOOFAM observed | Existing use |
| --- | --- | --- | --- |
| Brand | 유앤채 | 유앤채 | SEO title/brand, label, quotation |
| Manufacturer | 义乌市羿志家居用品厂 | 유앤채 협력업체 | Label and quotation company facts |
| General exchange rate | 310 | 310 | Pricing; bundle calculation with integrated pricing enabled |
| Integrated exchange rate | 300 | 290 | CNY cost with inspection/barcode/tax calculation |
| Supply / Coupang margins | 50% / 45% | 50% / 45% | Price stage and final quotation prices |
| Minimum supply margin | enabled / 3,000 | enabled / 3,000 | Minimum margin price branch |
| Rounding / MSRP multiple | 10 / 1.3 | 10 / 1.3 | Price and MSRP projection |
| Box SKU quantity | 50 | 50 | Quotation logistics |
| Top / bottom image | ON / OFF | ON / OFF | Detail composition |
| Image translation / copywriting / background removal | ON / ON / ON | ON / ON / ON | Existing image work policy and configured processing path |
| Hidden-attribute generation | OFF | OFF | Existing quotation/attribute generation field selection |

Text/profile facts, prices and images have distinct existing application paths. Matching switches does not establish pixel quality or successful provider execution. The differing manufacturer/rate values were not overwritten. Evidence: `outputs/step918-couplus-basic-settings-ax.txt`, `outputs/step918-own-basic-settings.json`; reference quotation DOM: `outputs/step918-couplus-quotation-dom.json`. The new reference screenshot timed out and is not claimed.

## Verification and release

- Root final focused run: **109/109 passed**, 10 files, no skipped/cancelled cases (`outputs/step918-focused-tests.txt`). Types, changed-file lint, diff check and isolated production build passed.
- Worker scope suites passed 157/157 and lazy suites 56/56; independent review reran 43 cases. These overlap the root run and are not summed into its count.
- Three old presentation fixture literals were corrected from hardcoded all=true to the parent's unchanged OFF default, preserving their assertions. The original HEAD positive cases passed before that adaptation.
- A separate image Dashboard-lock fixture still has six failures; the same six reproduce with the HEAD Dashboard source. It was not changed or counted as passing (`outputs/step918-lazy-quotation-image-baseline.log`).
- The exact three frozen runtime files matched the isolated build. Unrelated `app/chatgpt-auth.ts` was excluded. No extension source or permissions changed.
- Worker version: `6d93da3c-3915-4089-bdbf-206b291e40bd`.
- Live after deployment: initial SEO had no quotation heading/panel; first Stage 7 mounted it; returning to SEO retained it. OFF and ON both matched the header AI action and nested scope; OFF was restored without invoking AI or saving. Evidence is retained under `outputs/step918-live-*.json`, with `outputs/step918-live-quotation.png`.
- The user's refresh was verified as running extension **2.1.80** (`outputs/step918-live-extension.txt`). No collection or transmission was requested from it.

Existing products and accepted document 2347603 were not saved, uploaded or resubmitted. A fresh real-product collection→seven-stage processing→new Supplier Hub receipt remains unverified. A separate confirmed many-option result/save limit mismatch remains documented in `outputs/step918-large-quotation-reproduction.*`; it was not silently truncated or declared fixed in this release.
