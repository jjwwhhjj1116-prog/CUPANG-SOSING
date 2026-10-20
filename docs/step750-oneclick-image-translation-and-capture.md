# Step750 — image translation, captured titles and live category verification

Implementation started 2026-10-19; final verification 2026-10-20 KST. Vendor facts and independent implementation are separated in `step750-couplus-ai-evidence.md`.

## Changes

- An explicit Chinese/English translation action on a product image card now runs authenticated source read → browser Tesseract OCR → the configured free Google translation → local PNG preview. Opening an editor previously only selected the source. Applying the result remains an explicit user action.
- Manual editing still restores the original or saved edit document without OCR or provider calls. A consumed target sequence is not replayed by a rerender, reopening the retained editor, reactivation or clearing a draft. Existing dirty drafts, pending saves, uncertain results, exact quotation/workspace slots and stale owner/product/version contexts retain their guards.
- English batch translation now passes its actual language to the renderer. Previously the default Chinese source-language value was saved even after English OCR/translation. Both approved companies are tested through saving and reopening an edit document.
- Current-page capture now takes the title from the current SKU's literal JSON container before page metadata. A product-specific DOM heading may be a fallback; a generic first h1 is no longer used as if it were a product title. Conflicting current-product titles, SKU models or offer identities stop capture. Existing captured receipts and working products are not rewritten.
- Unified extension 2.1.2 packages the title fix; app image translation is a web update and does not depend on this new extension release. The 2.1.1 recommendation capability remains compatible. No new extension permissions, paid provider configuration, local model installation or database migration was added.

## Actual runtime checks

1. In the existing Chrome, a synthetic image card action ran real browser Tesseract OCR and read `黑色 运动 护膝` at 87% reported confidence. The real Google endpoint returned HTTP 200 and `블랙 스포츠 무릎 패드`. Canvas prepared a preview, and a separate UI apply action saved it through the actual local image-text API with isolated auth, SQLite and private-file fixtures.
2. A read-only local proof verified the resulting 780×180 PNG (8,916 bytes), original-file preservation and unchanged upper/lower banner references. Original SHA-256 `5237b35b0d75718628f4d4e41e9a186f6d6cb13f8345977f02acb597b159d1c5`; saved PNG `71c2c040c0301884c2c4e24ee2de9d7aa992334412843627b0dcbb3db96f6f04`. This image is synthetic test text, not a sourced product photo. Proof: `outputs/step750-browser-save-proof.json`; requests: `outputs/step750-browser-qa/requests.json`.
3. In the deployed app, after the member confirmed extension 2.1.1 reload, the user-provided Korean name `유앤채 남성 방한 귀달이 니트모자` produced three actual official Hub recommendations: men's, unisex and women's earflap hats. Selecting the men's path connected display code **69617**, version 1 and its individual quotation definition. The test used no source URL or source fetch. The new empty intake row was removed without changing the two existing intake rows. The new reusable category definition remains available.
4. The checked radio unmounted on successful navigation before Playwright's post-click checked-state assertion; that action reported no remaining match. The subsequent authoritative UI showed the new code69617 row and linked form. The action was not repeated.

Category screenshots: `outputs/step750-live-category-recommendations.png`, `outputs/step750-live-category-69617.png`. Existing products were not edited or submitted. An image download helper became unresponsive and reset its controller; no success was inferred from that download. The saved PNG was instead verified as a backend development-test artifact from the isolated local server.

## Validation and release

- Main related run: 243/243 passed (`outputs/step750-final-tests.log`). Extension/source run: 155/155 passed (`outputs/step750-extension-tests.log`). These runs contain **384 distinct named checks** after removing 14 overlapping checks.
- New one-click tests cover both languages, manual/no-target behavior, failed/partial OCR or translation, cancellation at every boundary, stale contexts, fresh-action replacement, existing edits and uncertain-save recovery. English batch tests verify the saved/reopened source language for both companies.
- Independent review found no high-confidence issue in parent lifetimes or literal-container title binding. Dashboard product keys reset the parent action on a true product remount; detail-workspace closes discard their editor target.
- TypeScript and scoped ESLint passed; production build passed. The extension package has 82 files, 933,593 bytes, SHA-256 `17ecb90c2dee4559be48604637e46c72db2eb3ec9cf6d101792e5759db62b21c`.
- Existing Worker deployment succeeded as `679c2b01-a752-4985-888d-5b6f6207ba68`. The existing Chrome app was reloaded after deployment and showed the normal Studio registration page. No provider or paid-plan settings changed.
- The known loaded sales-extension source was backed up as `outputs/step750-sales-2.1.1-backup` before copying the canonical 2.1.2 source. The member confirmed runtime 2.1.1, not 2.1.2. New title-extraction behavior requires a later reload; runtime application must not be inferred from disk files.

## Remaining limits

Local LLM installation is not required for OCR, translation, conventional image editing or detailed-page composition. Tesseract WASM and Canvas are already served with the app. The separate paid generative image adapter has no configured model/key in the inspected deployment settings; it was neither enabled nor called.

The free editor paints selected text areas with reviewed solid colors; it does not reconstruct textured/photo backgrounds like neural inpainting. Google SEO provides translation and factual keyword extraction, not equivalent generative marketing copy. Vendor neural restoration, AI copy quality, all-category parity and successful real Supplier Hub submission remain unverified. `SINGLE_DOCUMENT_LIVE_VERIFIED` and `PRODUCT_DOCUMENT_LIVE_VERIFIED` remain false. No denied 1688 page was read directly or indirectly.
