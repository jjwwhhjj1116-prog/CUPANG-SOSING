# Step622 — single-SKU drafts, stage downloads and final list values

The authorized workflow remains category → 1688 URL → editable stages 1–7 → user review → explicit Supplier Hub transmission. This change adds missing stage actions and fixes valid sourced products and final quotation edits that were not reflected in the registration list. It does not establish every category or a new real Supplier Hub receipt.

## User-visible changes

- A mobile product with no variant axes (`skuProps=[]`) previously failed even when exactly one explicit SKU, empty combination, valid SKU ID and price were present. Both mobile product sources now accept that specific contract. Missing axes never collapse several SKUs or fabricate a default SKU/price. Source title, unit price, MOQ, stock and explicit attributes remain available to the editable draft.
- Stage five now downloads the currently selected common or option detail images as a ZIP. The current order and removals are reflected immediately without saving the draft. Original and reviewed translation/edit bytes come from authenticated existing file routes; absent, foreign, invalid, oversized or failed files do not produce a partial ZIP. Existing shared top/body references are retained at both ordered positions with distinct indexed filenames. Downloading does not write product data or rerun translation.
- Stage six now lets the user download an existing selected label image, including a label already connected to the quotation. Previously only a freshly generated preview offered a download.
- Clicking an unused size-chart status opens SEO, as observed in Couplus. A connected size image still opens the option editor.
- The top registration list now reads the final included quotation title/main/additional/detail/label references. It uses the first included option for the representative title/photo and the same option→common→automatic precedence and exact primary Hub field aliases as the quotation. Manual blanks, excluded options, read-only fields and legacy common content remain meaningful. This is a read-only projection; listing does not overwrite content, prices or other options.
- The main pricing inputs use the observed rounding-unit label and layout. The retained legacy rounding-mode selector is inside the existing detail preview. Saved rounding mode, arithmetic and account facts are not changed by opening this layout.

## Shared Chrome collector update

The initial server/Chrome-input API fixtures proved that the server accepted a raw capture, but did not prove that the installed extension could produce it. The production preflight identified the generated collector mismatch. Inspection and fail-before execution confirmed that `capture1688Product` calls the generated public collector, which validates the SKU before returning raw evidence. The old generated parser rejected both full-mobile and SKU-only single-SKU sources. A valid desktop JSON-LD fallback remains a separate existing path.

The collector was regenerated from the same server parser and packaged as **0.2.60**. The extension reports the new `publicSingleSkuCapture` capability; the settings check distinguishes single-SKU support from its existing result-recovery capabilities. Download links point to 0.2.60. Existing older result/transmission capability requirements remain unchanged. No host permission, authentication or transmission operation was widened.

The archive contains 39 files, 508,734 bytes, SHA-256 `cb745ff2f3a4bea8849750a2e00ddb8b3da1bb942866deccb4f1e437c91865e1`. Original 0.2.57/0.2.58/0.2.59 archives remain byte-identical. Rebuilding/checking the shared collector and canonical ZIP is part of the successful production build.

## Verification

All **277 nonduplicate tests passed**, with zero failures, cancellations or skips:

| Group | Files | Cases |
| --- | --- | ---: |
| settings | workspace-settings-editor; workspace-settings-dialog; integrated-rate-settings; integrated-rate-pricing | 31 |
| mobile-collector | alibaba-mobile-collector | 19 |
| single-sku-intake | single-sku-intake | 4 |
| image-download | image-selection-download; option-image-editor; detail-image-toolbar | 46 |
| label-download | product-label-download; product-label-reference-editor | 7 |
| option-board | product-option-board; workspace-product-navigation | 53 |
| registration-summary | registration-board; registration-content-summary; registration-quotation-label-summary; registration-final-content-summary | 41 |
| extension-mobile | extension-mobile | 14 |
| extension-bridge | supplier-hub-handoff; supplier-hub-extension-check; supplier-hub-extension | 62 |

Local two-company API/SQLite/R2 fixtures verify source → editable SEO/options/pricing/images/notices → manual edits retained → CSV output, and generated-extension capture → raw evidence → server validation → product/quotation. At CNY 12.5, the retained pricing example resolves to supply 8,750, sale 14,580, MSRP 18,950. These are synthetic provider/Chrome fixtures, not fresh live 1688 collection or Hub submission evidence.

Image tests verify bytes and order before saving, and exact quotation/XLSX/ZIP references after an explicit save. Listing tests verify canonical and observed Hub aliases, common blanks, first included options, read-only fields, legacy behavior and unchanged original workbook/image bytes. Existing navigation test support was corrected to model layout effects after a previous production change; product navigation logic was not rewritten for the harness.

Fail-before records include the valid single-SKU parser/API failure (0/5), old generated collector rejection (0/2), missing download controls (0/6), preserved shared-role ZIP failure (0/2), unused-size navigation (0/2) and final-list titles (0/4). Corrected cases are included above. Independent reviews found no further concrete issue in download ordering/file access or final summary/size navigation.

Final TypeScript: zero errors. Global ESLint: zero errors and eight pre-existing warnings. Bounded production build: passed. The original 17 migrations and Gmarket fonts remain byte-identical. The failed preflight is retained as evidence; an unrebuilt collector artifact was not deployed.

## Read-only source and live verification

The same existing Chrome (browser 3) was reused. Current Couplus basic settings, its empty new-product queue, sixteen root categories and the two product-management tabs were recorded as private DOM evidence. Product management showed its observed column/filter controls and registration-status query form; no database-update, query, save, collection, translation, deletion or transmission action was executed. All source popups were closed and AI registration/today selection restored. A viewport screenshot attempt timed out; DOM records are the source evidence, not new screenshots of every source stage.

The Couplus queue includes automatic work/transmission modes. The user's requested manual review before explicit transmission remains the controlling workflow. The observed product-management tabs/query controls are recorded for further parity work; this release does not add a simulated remote database/status tab.

Worker **936b98dc-8ae9-4c27-8342-d9d66d177e33** was deployed. The existing Chrome loaded `dashboard-client-CrFHEpLU.js`, `dashboard-client.CZTl9XOU.css` and `index.pTKAgJ_y.css`. After the user refreshed the installed extension, the actual browser reported **0.2.60** and displayed `옵션 속성이 없는 단일 SKU 지원`.

Read-only comparison preserved all 29 main controls, all 35 named and sorted settings values, and the URL draft's 10 controls and one row. The main registration row changed only its representative-image count from **1 to 3**, reflecting the final included-option projection. The complete row text was therefore not unchanged. Its live option count was not independently verified: the existing company-mismatch guard still prevented opening the historical Waih product under the Unand account.

Existing product **YP-22E079FC** remained untouched, and the Unand/Waih company-mismatch guard remained in force. No previously denied offer was accessed again and no existing work product was modified, collected again or transmitted. Private post-deployment evidence is kept in `outputs/step622-*.json`; the deployed-app screenshot reference is `outputs/step622-deployed-app.png`.

Fresh live 1688 sourcing through an actual Hub quotation/SKU receipt and exhaustive all-category parity remain unverified. The 277 passing tests, installed-extension capability and local files do not establish 100% completion or replace those final acceptance checks.
