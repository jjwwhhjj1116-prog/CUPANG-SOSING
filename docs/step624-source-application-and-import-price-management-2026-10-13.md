# Step624: source application and import-price management

This release strengthens the editable sourcing draft and implements the observed SKU/barcode bulk import-price workflow. It does not establish complete Couplus parity or a fresh Supplier Hub submission receipt.

## Current-source translation application

A canonical completed intake translation is usable only while its supplier text still matches the current effective collection receipt. Preview and apply read that receipt; saving uses the existing atomic source tuple guard, including supplements appended without a product-version change. Image-only and price-only changes retain the supported replay path. Manual edits, deliberate blanks, option-only jobs and legacy records without a captured company keep their existing behavior.

The shared SEO retry reader now verifies an explicitly captured company. Preparation, approval, claim and application reject a different approved company. Preparation returns the specific company conflict as HTTP 409 instead of a storage error.

## Observed import-price workflow

Read-only Couplus observation on October 12 found two tabs, `일괄 업로드` and `매입정보 관리`, and SKU ID/barcode upload controls. The downloaded blank source templates contain one sheet, `매입가업로드양식`, and exactly three headers:

| Matching | Headers | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| SKU | SKUID / 매입일자(2025-01-01) / 매입가 | 15964 | 80cc291919572a2fc4dd81ee3a262c2f7da3196bc2ac1d24037b99a8eb8e433c |
| Barcode | 바코드 / 매입일자(2025-01-01) / 매입가 | 15968 | 9b1394588cd1eb15ba304d9763455fcb659bf43a9eec594aa09858547243c4a5 |

The authenticated app downloads these exact source bytes. Upload preview shows the matched owned SKU, product, exposure ID, date and price before explicit application. One SKU/date record is replaced; other dates and original supplier DB payloads are preserved. A barcode that is missing or linked to multiple current owned SKUs rejects the entire file, including an ambiguity introduced after preview.

One materialized SQL proof verifies the approved member/company, original row snapshots and existing history before inserting all rows. It protects the file SHA and reviewed snapshot, prevents partial saves, and keeps zero and decimal prices intact. A separate additive migration creates the owned daily price table. It does not modify existing product tables or original prices.

The B-column date reader accepts ISO strings and explicit Excel date-cell evidence, including the 1904 date system. Bare numeric dates, invalid calendar dates and the fictitious 1900 serial day 60 are refused. The existing general worksheet inspector is unchanged. Date-system behavior was checked against [Microsoft's date-system documentation](https://support.microsoft.com/en-us/excel/date-systems-in-excel).

The main product DB export retains the original fields and adds only the latest applied date/price. Complete history is downloaded through the separate five-column ledger. This avoids storing hundreds of daily records in one Excel cell. Downloads return the complete matching result up to 5000 rows and 5MB; exceeding a limit returns an error without a partial file. Files containing reserved YOOFAM applied-price/backup columns are rejected before original-product DB import with an explicit source-file instruction. Original Couplus DB round trips remain supported.

The frontend opens the same two-tab workflow from the toolbar or a specific SKU. Account changes invalidate preview and file state; late responses, repeated clicks and a changed ledger filter cannot adopt an earlier company's result. Original raw purchase/import JSON and margin/ROI values are preserved. Those formulas, manual purchase/import CRUD and barcode printing are not claimed replicated by this release.

## Validation and release evidence

Unique passing groups: current-source/API regressions 54; managed products, UI, export, schema and ZIP regressions 99; unchanged official-template/column-group regressions 17; deployment configuration regressions 8. Total: **178**. Independent source review 34 and import-price review 24 overlap these cases and are not added again. TypeScript has zero errors; ESLint has zero errors and eight existing warnings. The local production build and packaged migration checks passed after rerunning the same build outside the Windows filesystem sandbox following EPERM.

Live template download verification found the existing build had packaged the blank files but omitted the static asset binding used by the authenticated template route. Production and local Vite configuration now bind the same existing static assets as `ASSETS`; the release validator rejects missing or renamed bindings. The route's company authentication, byte/hash validation and account recheck remain unchanged. This matches the [Cloudflare static asset binding contract](https://developers.cloudflare.com/workers/static-assets/binding/), without new resources or public access changes. The runtime-status test VM also supplies the standard URL global used by the existing route, preserving its read-only provider/history assertions.

Private evidence is retained under `outputs/step624-*`: fail-before source/company cases, barcode phantom ambiguity, explicit Excel date cells, backup import collision, long history, final tests, release artifacts and browser checks. Original source templates are blank; actual user product/receipt data and credentials are not included in this commit.

Deployment, migration, live view and Git push identities are recorded in the private release verification files. The packaged Chrome extension remains **0.2.61**. Installed-extension capability and a successful company query must be verified separately from app deployment. Fresh live 1688 sourcing through a reviewed draft to an actual Supplier Hub quotation/SKU receipt and exhaustive category parity remain unverified. Existing working products were not edited, deleted, recollected or transmitted; previously denied offer access was not retried.

Final live verification used Worker `f89f1cc8-98cb-4fae-ba00-9bb711e0eee7` in the same existing Chrome account. Both template buttons produced real downloads named for company A01526306, byte-identical to the source templates above; no download alert remained. The current company history loaded its five-column empty result successfully. All 29 existing main-screen input values and the one original product row's values were preserved against the previous release; comparison ignores row layout whitespace. Current dashboard and CSS assets were observed loaded. The actual deployed upload popup screenshot is retained privately as `outputs/step624-deployed-price-upload.png`. No live price records were created for this inspection, and installed-extension version was not rechecked in this step.
