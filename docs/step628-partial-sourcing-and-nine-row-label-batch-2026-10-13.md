# Step 628 — partial source intake and saved nine-row label batches

Two normal paths lost useful user work: a temporary failure of the optional 1688 detail document rejected already validated product/SKU data, and the list-level label batch rendered the quotation notice table instead of the nine saved stage-six fields. This release preserves the validated source for review and connects the correct saved label form. It also supports the exact decorated Supplier Hub reset label in quotation-to-SKU searches.

## URL intake

- Only detail-document HTTP 502, 503 or 504 can produce the explicit `1688-public-mobile-partial-capture-v1` contract. The product page, exact offer identity, SKU payload, prices, MOQ, gallery and attributes are still parsed and validated normally. The missing detail body and allowed transient status are explicit in the inert capture.
- Full captures retain their previous detail-source validation. Private/authentication responses, identity mismatches, malformed successful bodies, excessive sizes, aborts, unsupported partial flags and partial data without a verified page detail URL remain errors.
- Server and Chrome transport use the same parser. A partial receipt can create an editable draft but does not claim that the detailed description or images were obtained. Missing source warnings and required quotation checks remain. The intake does not automatically repeat that same partial capture during import/retry.
- The existing explicit source supplement action remains available using full source proof. Added detail source is separated from stored manual SEO, option, price, HTML and label edits; it does not automatically regenerate them.

## Stage-six label batch

- The selected-product batch now reads saved product-labels, including each included option's overrides of the nine stage-six fields and explicit blanks. It renders the same nine-row plan as the individual editor, then attaches the exact PNG to the corresponding option's quotation label-image fields.
- The existing stage-seven legal-notice table helper is preserved. This change does not replace source facts with legal defaults or infer certification, origin, materials or package dimensions.
- Category/company, nine-row plan and exact upload receipt are checked with the existing attachment transaction guards. Original image bytes, independent manual references, other option fields, detail HTML and prices are retained. Image-pool and current category field limits are checked before generating/uploading the batch.
- Identical durable upload recipes are reused. Unresolved writes stop at the current option and retain its pending proof; current connection recovery reads only. A confirmed recovery does not automatically write the next option. A changed source/category or explicit stop permits leaving without deleting uploaded bytes or representing an unconfirmed operation as complete.
- Parent mode/back/close and product navigation are blocked while label work or pending recovery is held. The existing Stop action releases navigation after the active save/read boundary. Pricing preparation also reports its active operation to the modal's close guard.

## Quotation result search and extension

The fresh Supplier Hub status screen was inspected read-only in the existing approved Chrome profile. Its accessibility label shows FontAwesome U+F021 before “재설정”; in this particular live DOM, innerText is the plain label, which the old extension already accepts. The new search supports both that plain label and exactly U+F021 plus whitespace and the label. Unknown decorations, ambiguous controls, disabled controls and unrelated text still fail. Icon-text failure and recovery are synthetic tests, not a claim that the currently open live screen necessarily fails.

Extension 0.2.63 contains the rebuilt partial-source collector and reset compatibility change. Its 41-file archive is 526,272 bytes, SHA-256 `3ef91d1c103308c1c513ae695911dd62dbdffe743f0998dd1a949c1a56838f69`. Package and protocol checks compare original source bytes; previous published 0.2.61 and 0.2.62 archives are preserved. Host permissions and existing transmission protocol requirements are unchanged. The Chrome response still reports installed 0.2.60; publishing/downloading the package is not installation proof.

## Verification limits

202 tests pass across 16 distinct test files, without failed, cancelled or skipped cases in the final release groups: partial source/supplement/Chrome module 67, quotation-ID/SKU receipts 44, batch modal/navigation 21, package/installed-version UI 21, and saved-nine-row batch/pipeline/replacement 49. TypeScript has zero errors; global ESLint has zero errors and eight existing warnings. Changed label/source files also pass their focused lint. Private failed proof runs and superseded diagnostic logs are excluded from these passing counts.

Final production build and artifact checks pass with the existing 18 unchanged migrations and expected Worker/database/assets bindings. Actual local API/SQLite/R2 fixtures exercise both approved companies, six-SKU and single-SKU partial sources, manual editing and explicit supplementation, saved nine-row common/option values, source/attachment preservation, pending write recovery, exact quotation ID search and fresh SKU receipt storage. Remote responses and document rendering used by those tests are fixtures.

Existing production work products and the saved intake draft are inspected read-only before and after deployment. No recollection, batch processing, content save, company reassignment or Hub submission is performed on those work products. Protected previous offers are not accessed externally. Private snapshots/logs and screenshots are excluded from the commit.

After deployment, the current dashboard chunk is observed in the existing Chrome. Main controls/product row, all 35 account-setting controls and saved intake inputs/text match before deployment; the text comparison permits only the download version change. The new nine-row batch screen is opened without starting it, then the original selection is restored. Its screenshot is retained as UI evidence only. The actual browser-downloaded 0.2.63 ZIP matches the release size and SHA-256. The installed extension remains unchanged.

Fresh real-product 1688 intake through final reviewed Hub receipt/SKU, every-category parity and final acceptance of all Couplus functions remain open; the synthetic successes and deployed UI check do not certify them.
