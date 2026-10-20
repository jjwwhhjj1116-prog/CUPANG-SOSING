# Step757 — stage editor layout and original-image provenance

## Scope and evidence

Continue the existing RS-style capture/category entry and Couplus-style stage editors. Preserve all existing work products. This change does not create a new collection provider or a native Supplier Hub upload adapter.

The observed reference is the Couplus AIRocketReg route, SHA-256 `5b92873c674c4b76c0e6ce4961caedbf8728ca86f6a15b6d9dc8cdfce80ad1d9`, and main bundle `027a17c12b60164e856058cbe449b827d38bf1ec0f7d98bb23acbff2c6c25b67`. Reused REA parents: `ev_69740e390a2cc1e539a4a65a84e5c7065e2e6db9dcbc8a6311d0b4bfce5a3166` and `ev_3fc8249a40ae76ed7952dd06b962e3f23198d763baf258555dead1511267fdce`. No identical analysis producer was rerun. Current Chrome2 Couplus board was read and captured only; its active CLI work and existing rows were not opened, saved or changed.

Reference screenshots are `outputs/step625-couplus-stage1.png` through `stage7.png`, `outputs/step627-couplus-seo-readonly.png`, and the unobstructed `outputs/couplus-options-reference-2026-10-06/price.jpg` / `outputs/step610-couplus-price.jpg`. They establish proportions and controls, not original CSS pixel values or every category/state.

## Changes

- SEO: centered AI card with brand/features/target keyword, example and generation button; matching two-column name/tags and option-name cards; centered save. Provider details, source history and legacy option tools are closed below. Explicit replacement/blank, request and save boundaries are preserved.
- Price: policy at left and option price grid at right. Legacy bulk tools and long input guidance are closed. Errors, current calculation policy, results, grid and explicit save remain visible. No calculation formula changed.
- Main image: four original-style candidate groups at left, large selected image and edit/save at right. `work` contains only proven processed results; `main/detail` come from the stored immutable receipt and exact image indices; options include source and current final images. Manual uploads remain available in a separate closed whole-pool list. Selecting a thumbnail retains the existing explicit-save behavior; Couplus's immediate thumbnail write was not newly copied.
- The readonly options GET adds `imageLibrary`. Owner/company/product/options/source/context/private-image links are checked again after the read. A race or unprovable classification yields null instead of relabeling the entire pool as original or processed. No DB/R2 writes or source requests are involved.
- Main/additional/detail cards open the same retained image editor modal. Current dirty/busy/uncertain state and the registered close guard block close; background controls are inert. Merely opening or reopening does not authorize another translation request.
- Detail images remain primary; work-composition and raw HTML tools stay mounted inside closed details. Quotation fields and save remain primary, with provenance, split/AI/Excel/native preparation tools closed below. No native dispatch gate changed.

## Validation boundary

The full actual DashboardClient, app API and SQLite are exercised in the local synthetic harness `outputs/step757-browser-qa.mjs`. Synthetic source receipts, company, PNGs and AI responses are explicitly fixtures. Real 1688, existing work products, production records, Supplier Hub agreements/uploads and receipt registration are outside this browser run. The harness protects the old fixture product and records its connected rows and file hashes.

The initial browser pass exposed invalid fixture image responses; a later pass exposed the fixture's missing R2 range semantics during label attachment. Both are QA-boundary repairs, with prior proof files retained. They are not production provider/receipt successes. Screenshots in `outputs/step757-ui/yoofam-*` are synthetic application QA, not Couplus or actual source-product evidence.

Final related coverage is 22 unique files / 386 unique cases, all passing after updating the intended closed SEO disclosure assertion (the original run was 385/386). Final changed-dashboard regression: 5 files / 25 cases. TypeScript, changed-file ESLint and the production build pass. Independent review found no reproducible new modal/draft/provenance regression. `outputs/step757-final-validation.json` records the per-source hashes and deduplicated results; repeated test runs are not added to the count.

Actual browser/API observations across separately retained synthetic runs:

- SEO PATCH200 and source option price PATCH200; changing 7 CNY to 8 produced 5,800 KRW supply / 9,670 KRW sale with the saved policy.
- Main/additional/detail manual-card actions loaded the exact final image, preserved its role/option and closed without losing state. Additional selection/add and removal each saved with quotation PUT200.
- Label text PUT200 → rendered PNG upload201 → attachment200 → final quotation image reference PUT200. The saved PNG/result screen is retained.
- A missing fixture profile correctly produced a category mismatch warning; the final harness now persists `cat757` before intake, like the category picker. Final stage7 shows category81452 and saves a manually entered synthetic model with PUT200. No company/category guard was relaxed.
- Every phase preserved the old fixture's rows and original file hashes. Real source requests, native requests and Hub requests are all zero. OCR, real image translation and terminal receipt are not inferred from opening the editor.

Deployed to the existing Worker, version `eb7e7d13-3852-449e-b606-78417e38d782`. No DB migration, new paid resource, extension version or permission change. Extension2.1.7 ZIP remains `0c69b2abf1f7609a88e1619ca095e359c49c8e236d4904e2fa321b56d054a801`. An owned Chrome2 production tab reached Cloudflare Access and then Cloudflare sign-in; internal production views were not revalidated there. No repeated login or refresh request was sent to the user.

Remaining: exact parity for every category/state, conditional required size-chart step, live source-provider equivalence, native multipart upload/packet construction, final consent and per-SKU terminal receipt. `SINGLE_DOCUMENT_LIVE_VERIFIED` and `PRODUCT_DOCUMENT_LIVE_VERIFIED` remain false. Do not report actual receipt success or an arbitrary completion percentage from this UI work.
