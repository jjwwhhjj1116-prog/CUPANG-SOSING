# Step623 — product management, registration status and draft source repair

The workflow remains **category → 1688 URL → editable stages 1–7 → user review → explicit Supplier Hub transmission**. These changes improve that workflow and the two product-management tabs. They do not establish exhaustive Couplus parity or a new live quotation/SKU receipt.

## Changes

- Sparse source facts are detected from the facts actually missing, rather than treating a JSON-LD/mobile/API provider name as proof of completeness. URL intake can complement sparse desktop metadata before creating its draft. An existing sparse draft offers explicit source supplementation, preserving its immutable SKU/price receipt and saved manual edits. Partial supplementation retains honest gaps; it does not invent attributes or seller descriptions. A saved full source with only an image failure retries media without automatic recapture, duplicate jobs or lost edits.
- A reviewed translation/edit of an image already shared between main/top/detail positions now retains those exact existing positions through owner-proven generated-image lineage. Original bytes, manual labels and option values remain intact. Several reviewed results use one content revision; stale replay and concurrent edits cannot overwrite the current saved draft. The final XLSX/ZIP order is checked against the saved references.
- The registered-products table uses the observed **22 column labels/order**, mapping actual original fields such as `재고` to `쿠팡재고` and `매입정보` to `매입관리`. It supports default 10 and 10/25/50/100 rows, column visibility, sorting, column filters, pinning, height Y/N and selection retained across pages. Sorting and filtering run in owner/company-scoped SQL **before LIMIT**, including results outside the current page.
- Product DB download exports the complete current search/filter/sort result, bounded to 5,000 rows and 5 MB. Original headers, strings, JSON, zero, blanks and leading-zero barcodes are retained. Formula-looking strings remain literal inline strings. Accepted source controls, lone UTF-16 surrogates and literal `_xNNNN_` text roundtrip through SpreadsheetML; NUL remains rejected. Where an original row lacks a company-code key, the export supplies the approved company code, including mixed older rows and the three supported header aliases. Explicitly present blank/wrong company codes remain rejected. Downloading does not change stored source rows.
- **상품 등록 상태** provides explicit start/end date, review-status and product-name queries, with a KST 120-day default and 50-row display pages. It reads the actual Supplier Hub company registration table across all queried pages, up to 2,000 rows. The app/extension verifies the exact owner, company and Chrome window before and after reading; fresh DOM updates, total/page counts and issued quotation/SKU uniqueness must agree. Only an app-created background query tab is eligible for cleanup; a tab made active or moved by the user is left alone. This query writes no product DB or receipt and does not turn company-level observations into YOOFAM transmission receipts.

Source gaps and stage navigation continue to lead to the saved editors. No collection, registration-status query or Hub transmission is started merely by opening a product or management tab.

## Evidence and verification

**317 nonduplicate tests passed**, with zero failures, cancellations or skips:

| Group | Cases | Final log |
| --- | ---: | --- |
| sparse source/intake repair, including extension-mobile 14 | 87 | `outputs/step623-sparse-source-tests.log` |
| shared generated-image adoption | 8 | `outputs/step623-shared-image-adoption-tests.log` |
| existing image-adoption regressions | 71 | `outputs/step623-image-adoption-existing-tests.log` |
| managed products, export and existing ZIP regressions | 58 | `outputs/step623-managed-products-tests.log` |
| company registration status | 12 | `outputs/step623-status-tests.log` |
| extension bridge | 62 | `outputs/step623-bridge-tests.log` |
| navigation | 19 | `outputs/step623-navigation-tests.log` |

The standalone sparse-source bundle check is excluded from this sum: its one case is already included in the managed group's 21 bundle cases. Extension-mobile's 14 cases are included in the 87 source cases, not counted again.

Local two-company API/SQLite/R2 and UI/extension fixtures verify the positive manual flow, retained edits, export contents and owner/company boundaries. They are not fresh live 1688 sourcing or a real Hub receipt. TypeScript reports zero errors. Final global ESLint reports zero errors and eight existing warnings; the two new root warnings were corrected. Production build and artifact checks passed. The first sandbox build failed with EPERM; the same build/artifact succeeded after the approved escalation, without a code workaround.

Fail-before records include:

- Missing-fact handling: `step623-sparse-source-before.log` (7/15 passed, 8 failed); unnecessary saved-source recapture: `step623-intake-recapture-before.log` (1/5 passed, 4 failed).
- Reviewed shared-image lineage: `step623-shared-generated-lineage-failbefore.log` (0/2).
- Managed-table global-query failures: `step623-managed-table-fail-before.log`. Its three API failures represent missing behavior; the separate cross-VM array assertion was a test-harness correction.
- Accepted control/surrogate export failures: `step623-managed-control-export-audit.log` and `step623-managed-surrogate-export-audit.log`.
- Mixed company-code headers: `step623-managed-mixed-company-fail-before.log` (2/6 passed, 4 failed). All three aliases and both companies pass in the final export group without rewriting raw DB payloads.

## Source observation and extension artifact

The same existing Chrome, **browser 3**, was reused for read-only Couplus/Supplier Hub evidence. Couplus's explicit status query showed **181 total / 50 on the current page**. The existing Supplier Hub view showed 182 under a different date range; those totals are not claimed to be equal. Private source DOM/form evidence is retained in `outputs/step623-*.txt` and `outputs/step623-*.json`.

Existing working products were not edited, collected again, deleted or transmitted. Previously denied fresh offer IDs were not retried.

The packaged extension is **0.2.61**, with **41 files**, **525,788 bytes**, SHA-256 `80c0bfef15db58379404bb14f4d731e1635714776b12a2db3807c248032aab6e`. Permissions are unchanged. Packaged capability/source checks do not prove that the installed Chrome extension has been refreshed.

## Live release verification

Worker **3d7d30f3-70dd-45aa-90fd-7dd5cb2519af** is deployed. The same Chrome loaded `dashboard-client-C_GR2fqt.js`, `dashboard-client.BwtWUWEn.css` and `index.pTKAgJ_y.css`. The main registration view preserved all 29 controls and its complete original row exactly. The live registered-products view shows the 22 default columns, 10-row setting and Unand company with no read error. The registration-status tab shows the four observed query controls and the matching June 14–October 12 date range. It does not query automatically.

Actual read-only PING still reports installed extension **0.2.60**, with `등록 상태 조회는 확장 업데이트 필요`. The 0.2.61 source/archive and app deployment are complete, but the requested extension refresh and actual new company-level query remain pending. The deployed UI verification is explicitly separate from successful live query verification; no company-wide result, quotation receipt or SKU issuance is claimed from this release check. Existing Supplier Hub and Couplus working products were left unchanged.

Private evidence: `outputs/step623-live-verification.json`, `outputs/step623-deployed-management.png` and `outputs/step623-deployed-status-form.png`. The extension capability will be rechecked before the actual new query is verified.

Fresh live **1688 URL → reviewed draft → real Supplier Hub quotation/SKU receipt** and exhaustive all-category parity remain unverified. Direct Hub registered-product DB update, purchase/import editing and barcode printing are not claimed complete. This release is not evidence of 100% completion.
