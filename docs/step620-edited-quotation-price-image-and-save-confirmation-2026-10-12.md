# Step620 — edited quotation, exact prices and image targets

The manual workflow remains category selection → 1688 URL → editable steps 1–7 → user review → explicit Supplier Hub transmission. This change fixes discrepancies and edit loss inside that workflow. It does not claim all categories or a new real submission have passed final acceptance.

## Confirmed problems and changes

- The option board read canonical `supplyPrice`/`salePrice` even when an observed Hub schema used a different primary price field. It now uses the same exact `quotationPriceTargets` as stages two/seven and XLSX. Directly edited values and explicit blanks are displayed without overwriting canonical summaries. Divergent aliases still block submission review.
- The quotation editor accepted any HTTP 200 containing resolved/automatic objects, discarded staged edits, and reported success. It now confirms the next revision, a new SHA-256 fingerprint, monotonic committed product timestamp, source category/schema/automatic values, exact requested overrides and every resolved cell's value/source. Common inheritance, explicit blanks, resets, read-only cells and the exact packaged-weight peer are checked. The normalized validated changes are both sent and confirmed.
- Automatically generated detail HTML can depend on manual detail images/alt text. Only a changed dependency or manual HTML reset requires a same-endpoint readback with matching saved revision/fingerprint/version/source/overrides; stale or failed confirmation retains the user's draft. Ordinary edits do not add a readback request.
- The global main-image editor could retain an option A callback after the user selected B and save A while showing B. Selection/edit/save/reload actions now verify the current option, current view and draft option before changing anything.
- Additional/detail image callbacks could bypass a processing lock using an earlier render. Selection, deletion, order, HTML, save, reload and translation now consistently check the current stage and live disabled state. Image files, other options and common content are preserved.
- Preview/download/export/profile refresh use synchronous dirty guards. Saving or editing immediately invalidates retained preview/download/inspection callbacks; a new product version requires a new preview. The native bundle link also prevents navigation while changes are unsaved. A fresh reviewed fingerprint still permits a normal ZIP download.

## Verification

All **251 nonduplicate tests passed**, with zero failures, cancellations or skips:

| Log group | Test files | Cases |
| --- | --- | ---: |
| quotation-panel | quotation-panel | 31 |
| option-price | product-option-board; quotation-price-wire-ui; quotation-stage-seven-price-linkage | 57 |
| main-image | option-main-image-editor; quotation-main-image | 12 |
| image-editor | option-image-editor | 20 |
| fields | quotation-fields-editor; quotation-fields; quotation-packaged-weight-linkage | 131 |

Fail-before evidence covers lost edits, wrong-SKU main-image writes, processing-lock bypasses, canonical/primary price discrepancy, and dirty/stale downloads. The relevant tests exercise both A01526306 and A01464742 with separate SQLite/API/R2 fixtures; image references and bytes are checked against resulting XLSX/ZIP. Exact Hub numeric-string price tests use a synthetic workbook. Existing 69900 official-workbook/weight regression fixtures remain covered; this is not fresh all-category or live receipt evidence.

TypeScript: zero errors. Global ESLint: zero errors and eight pre-existing warnings. Bounded production build: passed. Original 17 migrations, extension 0.2.57/0.2.58/0.2.59 archives and Gmarket fonts remain byte-identical. There is no extension update in this change.

Independent review found no remaining concrete issue in the price display, panel guards or final quotation confirmation changes.

## Read-only live comparison and preservation

The user's existing Chrome (browser 3) was reused. Couplus settings and the existing curtain product 261011001001 were read without saving, regenerating, translating, deleting or transmitting. Its option board, SEO form and 66-field quotation form (category 78260) were recorded as private DOM evidence. The original today filter was restored after the monthly read. A Couplus screenshot attempt timed out; DOM captures are the evidence for this comparison, not a claim of new screenshots for every stage.

Couplus's observed integrated-rate formula and option-stage pattern remain consistent with the implemented policy and stage structure. Existing product values were not copied into the YOOFAM database. No fresh access was attempted to the previously denied 1688 offer.

The deployed app's original one product, 29 main-list controls, 35 account settings and one URL draft matched exactly before/after via read-only DOM. Worker version `2e66f39b-7f5f-427d-8a1d-fa24192cc72d` is deployed at `https://sourceflow.jjwwhhjj1116.workers.dev/`. Its new `dashboard-client-WXpLrQL5.js`, existing dashboard/global CSS and screenshot were confirmed in the same Chrome. Release details and preservation results are recorded in private `outputs/step620-*.json` evidence. The deployed UI screenshot is `outputs/step620-deployed-app.png`, saved and visually inspected.

## Remaining acceptance work

A newly sourced real product reaching an actual Supplier Hub quotation/SKU receipt, and exhaustive parity across every category, remain unverified. Current read-only UI preservation and local API/XLSX/ZIP success are not substitutes for that final acceptance. Existing company mismatch, original workbook, required fields, image proof and receipt guards remain enforced.
