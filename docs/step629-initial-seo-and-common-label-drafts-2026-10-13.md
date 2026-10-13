# Step 629 — initial SEO input and common label drafts

The initial URL flow stored owner-entered features and target keywords but omitted them from the first Google SEO draft and quotation search tags. It also restricted Couplus's common nine-row label defaults to category 80719. This release connects those initial inputs, retains review state when an optional SEO candidate cannot fit, and preserves existing work when opening its editors.

## Initial URL draft

- The source-checked canonical Google intake uses the collection's captured brand, short features and target keywords. The editable title, tags, explicitly linked label name and resolved quotation follow that composition. Later account settings do not replace captured brand, company, exchange rate or price inputs.
- Provider translation results, supplier attributes, raw receipts and context are unchanged. Features and targets remain owner-written SEO guidance; they are not sent as supplier facts to Google. Normal sample requests still use the existing batched translation path.
- Independent manual translations, options-only processing and dedicated retry scopes retain their existing rules. Saved manual titles, tag lists, blanks, label names and option edits are preserved. Current effective source, company, category and content revisions remain part of the preview and atomic save guards.
- A long feature/title or an invalid target-tag budget retains the usable translation and original input for review. It does not silently shorten the owner input or report complete. Pending proof binds the canonical job and source reference to the actual saved field values and timestamps. Reopening, changing unrelated fields or receiving an uncertain save response does not clear that review state. An explicit save of that SEO field, including the same value, acknowledges it.
- Pending metadata cannot be supplied through a content PATCH. Malformed or stale proof is rejected without saving. The first canonical Google preview requires matching typed review proof; the old Workers AI path does not require Google proof.

## Nine-row label defaults and existing work

The previously recorded public Couplus nine-row component calls `initializeData()` whenever a product is selected, without a category branch, then overlays saved `koreanLabels`, including blanks. Its common reference defaults are 제조국 “중국”, 주의사항 “용도 외에 사용금지. 파손및화기주의”, and 사용기준 “14세이상”. New selected-category intake and an explicit fill action now use that same reference text. These defaults remain generated, reviewable form values; they do not certify the product's origin or age suitability.

Exact whole-product headings 제조국, 原产国 and country of origin retain the source's literal country value before a reference default. City/region headings 产地 and 原产地, shipping origins and component materials are not inferred as manufacturing country or whole-product material. Conflicting headings are not resolved by guessing.

Existing saved content and option overrides remain authoritative. Reading the nine-row and quotation APIs does not initialize old missing values. The older common editor's first-entry automatic fill retains its previous 80719-only reference-default scope; general defaults require a new intake or the explicit fill button. Manual blanks and cleared-field markers prevent refilling. New common values flow through the existing nine-row PNG plan and stage-seven mapping; schema conflicts remain review issues and measured packing values are not fabricated.

## Product management

A price import can shrink a filtered result while the user is on its last page. Previously, 130 rows on page 13 became 110 rows while the UI stayed on page 13/11 and showed no products. The panel now checks the fresh response and reads the last valid page. Import/export actions remain unavailable during this read; stale or aborted responses cannot move the current query or another owner's list. An empty result returns to page one.

The fresh Couplus management screen was read in the existing approved Chrome profile. It still exposes eight filters and 22 table columns. Three filters—노출ID변경, 공급가변경 and 타사매칭—remain unimplemented pending evidence of their nonempty history shape and decision rule. Preserved private import files contain 1,101 source SKUs with empty values for those three histories; neither an empty field nor a zero-count button establishes the rule. Direct product-DB updating, purchase-info editing and barcode output also remain outside this release's completed scope.

## Verification

271 tests pass across 24 distinct files, without failed, cancelled or skipped cases in the final groups: initial SEO/composition 40, Google and legacy intake regressions 55, label/default/source/adoption 73, existing-editor label UI 2, management panel/table 16, management import/price regressions 39, and label pipeline/editor regressions 46. Superseded diagnostic and before-fix runs are excluded from that count. TypeScript has zero errors; global lint has zero errors and eight existing warnings. Production build and artifact checks use the existing Worker/database bindings and 18 unchanged migrations.

Tests exercise real local API handlers and SQLite-backed state for both approved companies. New synthetic offer IDs go through the collect handler with their own mocked JSON-LD source; source requests never use a fixed previous offer. Tests also check exact quotation/category linkage, original prices, single-SKU/MOQ values, manual edits, receipt preservation, pending review recovery, deliberate common/SKU blanks, existing missing-field reads and schema constraint review. Remote source/Google responses are fixtures. The existing AI source-index fixture was corrected after the same three failures were reproduced against the pre-change runtime; its negative and preservation assertions remain.

Deployment is followed by read-only comparison of the existing product row, main controls, 35 account-setting controls and saved URL draft in the same Chrome. No existing product, source receipt, company assignment, draft, price or Hub submission is changed. Extension source and published 0.2.61–0.2.63 archives are unchanged; no extension refresh is required by this release.

Fresh real-product sourcing through a reviewed real Supplier Hub quotation receipt/SKU and full Couplus category/function acceptance remain open. Passing fixtures and the deployed UI preservation check do not certify those remaining outcomes.
