# Step625 — automatic category workbook connection and detail-image batch

The workflow remains Supplier Hub category → 1688 URL → editable stages 1–7 → user review → explicit quotation transmission. This release removes two observed gaps inside that workflow; it is not evidence of exhaustive category parity or a new live quotation/SKU receipt.

## New live category selection

Previously a new live leaf downloaded its editable Single schema but deliberately created a profile with `template:null` and no column mappings. The official workbook had to be prepared separately in stage 7. New live categories now also use the existing official-template loader before returning to URL entry. That loader retains the verified company, exact category code/path, Single/Excel schema identities, original workbook bytes/hash and derived column mappings. The save response must acknowledge the exact prepared template and mappings. A download or schema validation failure retains the input and does not create a blank fallback profile.

Existing saved or custom profiles return through their existing selection paths. Their template, mappings and revision are not automatically replaced. Older profiles without a workbook still have the existing explicit stage-7 preparation path. Existing products and saved URL drafts are preserved.

## All detail images translation

Stage 5 now provides **모든 상세 이미지 번역** for the selected option's saved detail list. The browser reads each owned original, recognizes the chosen language, uses the existing user-requested Google translation endpoint and renders a PNG preview in source order. Preparation saves no image or quotation data. It keeps other-language text intact and reports unreadable text or translation failure per image; those originals remain in place. Preview memory is bounded to 30 MB.

The user compares original/translated previews and explicitly checks each result to apply. Each save changes the exact current detail slot and its linked quotation fields. After an acknowledged commit, the complete quotation view is checked before the next identical original's proof is refreshed. Other options, manual HTML, deliberate blanks, order and original files remain intact. A mid-run failure stops the sequence and reports the confirmed count; a lost acknowledgement retains the exact PNG and proof and offers read-only recovery for that image. Recovery does not automatically save the remaining previews. The user can discard unselected previews while keeping originals and proceed to stage 7.

The existing single-image editor remains available. Active image work locks the other editors, and unsaved detail order/HTML must be saved before preparation or application. This release implements the detail-stage batch; Couplus's separate additional-image batch button is an observed remaining parity item.

## Source evidence

The user's existing Chrome was reused. A separate temporary tab in the same profile read the current Couplus account `yooandchae`. Basic settings were compared read-only, including 290 integrated rate, 350 general rate, 50% supply/40% Coupang margins, ten-won rounding, MSRP 1.3 and minimum margin 3000. Saved YOOFAM settings already matched those observed values; no settings save was performed.

Existing curtain product `261011001001` was opened for read-only stage inspection. Actual screenshots for stages 1–7 and DOM text were retained privately under `outputs/step625-couplus-stage*`. Stage 6 shows its existing generated label result; **재작성** was not pressed, so this is not a new inspection of its input form. Stage 7 initially displayed automatic preparation progress and later exposed its five groups and 51 inputs, 13 selects and two textareas; no Save, AI-generation, retransmission or deletion control was pressed. The source tab's initial Today filter was restored and popups were closed. Source screenshots are evidence of this example's visible UI, not every category's completeness or Couplus's internal processing algorithm.

The actual YOOFAM category browser returned its 16 Supplier Hub top-level categories for the current Unand company. No leaf selection was committed to the existing URL draft. Installed extension PING still reports **0.2.60**; the packaged archive remains 0.2.61. The new code does not change extension permissions or require a new extension artifact.

## Validation

**213 nonduplicate checks passed**: category connection/intake/official draft 59; new detail batch API/UI 19; existing free-image client/panel/quotation linkage 87; source/product/intake navigation and bundle 48. These use local two-company SQLite/R2/API and synthetic OCR/translation/render fixtures. Positive flows verify category → synthetic URL → editable SEO/options → corrected official XLSX, and ordered image preview → selected slots → exact XLSX/ZIP bytes. They are not fresh external 1688 collection or actual browser OCR accuracy measurements.

Before the category fix, its first five targeted cases had one pass and four failures. Applying multiple old single-image proofs without refreshing after the first confirmed commit failed for both companies; the new explicit sequence handles this. Independent source review found no further concrete issue in the final connection, scope, order or recovery contracts. TypeScript has zero errors; global ESLint has zero errors and eight existing warnings. The final production build passed. No migration, user-product modification or external submission was performed by this step.

Deployment, loaded assets, screenshots, preservation checks and Git push identities are recorded in private `outputs/step625-*` verification files. Fresh real 1688 collection through a reviewed draft to an actual Supplier Hub receipt/SKU and exhaustive all-category parity remain unverified.

Final live verification loaded Worker `eebe0127-4e27-4b71-98c7-79368197829d` and its current dashboard/CSS assets in the same Chrome. The main screen's 29 controls and one original row, all 35 account-setting controls and the entire restored URL-draft dialog matched their before-release captures. The existing product's option query correctly refused its Waih captured source under the current Unand login, so no product was reassigned and no batch execution or transmission was attempted. The live new-category save and real detail-batch execution are explicitly **not** claimed verified from this read-only inspection. The actual deployed main screenshot was saved and visually inspected as `outputs/step625-deployed-main.png`; the deployed app tab remains open.
