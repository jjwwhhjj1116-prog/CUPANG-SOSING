# Step942 — live reference and SEO interaction correction

2026-11-04 KST. The user resumed development after connecting Ask Aside to their ChatGPT subscription and cancelled bookmark changes. No bookmark or credential settings were changed.

## Reference observations

Ask Aside session `0rCqytqyNASGEj5I` reused the logged-in COUPLUS tab and inspected settings plus stages1–7 on existing product261026002001. Fifty-eight original PNGs and control/measurement JSON files are preserved in `outputs/step942-couplus-live`. They are observations of this member and product, not factory defaults or proof of every runtime branch.

- Settings: brand유앤채, normal exchange310, rounding10, MSRP1.3, supply/Coupang margin50/45, minimum marginON3000, bundleOFF. The integrated-customs rate shown is300; do not overwrite an independently stored YOOFAM policy from this observation.
- Stages1/2: input types and values, option list, previous/next/header navigation and closing were inspected. No AI or save execution.
- Stage3: work/main/option/detail candidate tabs, current image, upload/AI/edit placement; candidate counts2/5/4/1 for the observed reference product. Current image URL stayed unchanged. Editor internals not verified.
- Stage4: ten candidates, five current images in their existing order, batch/AI/edit/save controls. Opening edit did not expose a toolbar; its tool names remain unknown.
- Stage5: one top banner and ten body images, toolbar and first body-image hover controls. No image processing or reorder/delete execution.
- Stage6: saved label preview. Regeneration/input-panel behavior remains unknown because it could execute a write.
- Stage7: start/product/image/legal/logistics groups and current controls. The all-options switch wasOFF. No saving, terms, upload or submission.
- Size-chart observation covers the reference product's unused state only. It does not establish the required-size-chart category behavior; do not remove YOOFAM's conditional step on this evidence.

`aside.settings.get('defaultModel')` reports `openai-codex/gpt-6.1-sol`. Analysis requests ran successfully after connection; metadata alone does not prove per-request billing or quota routing. An MCP exec response timed out at300seconds; the same live task was recovered using its session ID, not duplicated.

## Stage1 change and verification

The reference's `.options-list` has computed max-height400px, overflow auto and right padding10px, inside a20px-padded card body (`seo-scroll-metrics.json`, SEO01/02). YOOFAM previously allowed every option row to expand the card. A nested, bounded option list now matches that layout without moving the common SEO save button inside the scroll area.

The display example now uses the configured brand and the original feature/keyword fallbacks (`인조가죽`, `크로스백`). It preserves actual empty inputs and the existing blank-target execution guard. Nothing is automatically populated or saved from these examples.

REA reused the Step899 portable recorded bundle: parent `ev_6b982961f8b223cd2ba12e327bac866dec53f6f29036f598fa6947c028559a2e`, module view `ev_f7ab25e2e28a6e8f74bc283f3bb5761a6168ef13ad78f348bad2f57c1984a2c7`. The original raw truthiness fallback was corroborated with the fresh live screen. The first-stage Previous button already remains hidden in the actual YOOFAM browser and was not changed.

Production browser evidence is in `outputs/step942-own-live`: CSS viewport1600×1000, list400/body440, eight inputs, final input reachable at scrollTop500, save outside the list. At390×900 CSS, content and list scrollWidth equal clientWidth. YOOFAM's saved site zoom80% was accounted for separately from COUPLUS100%; bitmap dimensions were not treated as CSS dimensions.

Owned socks product865ff938-1f6e-42cd-bcfe-863cba84eb09 remained content revision55/options4/quotation11. All three complete GET responses compare equal before and after the browser checks. Temporary blank input checks were restored, the workspace was closed/reopened, and no product save or provider execution was performed.

## Validation and release limits

- Existing SEO suites125/125, changed-component lint and TypeScript pass.
- Frozen production build/artifact check pass; deployed Worker version `3ef842e9-ae84-4eea-ae0a-e3b30fa855d0`. Unrelated dirty `app/chatgpt-auth.ts` was excluded and frozen auth equalsHEAD.
- A broad project run exposed parse5 wiring errors in custom test VMs. Representative failures reproduced against the frozen baseline before the repair. Ten existing loaders now use the real installed parser; affected suites266/266 and changed-file lint pass with assertions unchanged.
- The broad run also reported picker/category-guided/CLI/dashboard/detail-related failures outside that repair and was stopped. It is not an all-tests-green claim; preserve `outputs/step942-tests.log` for follow-up rather than attributing every failure to the same cause.

Accepted historical offer886034098637/document2347603 was not created, uploaded, resaved or submitted. No new Supplier Hub receipt was produced in this UI pass. Full automatic image completion and the new socks product's required factual size evidence remain separate open work.
