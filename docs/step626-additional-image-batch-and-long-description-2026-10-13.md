# Step 626 — additional-image batch and complete description translation

The URL intake now translates descriptions longer than 5,000 characters instead of silently skipping them. Stage four also exposes the saved option's ordered additional-image batch translation. The owned image library has room for originals, reviewed translations and label images without hitting the previous 50-file boundary during an otherwise valid batch.

## Behavior

- Stage four uses the existing OCR → Google text translation → local PNG preview path. “모든 이미지 일괄 처리” prepares previews; it does not save or submit. Users review and select results before applying them to the exact saved additional-image slots. Stage five retains its detail-image behavior.
- Batch scopes include product, option, category profile and stage. Each confirmed save obtains fresh source evidence for the next selected slot. Main/detail images, other options, manual HTML, explicit blanks and original bytes are preserved. Additional-image processing also preserves automatically derived HTML. An uncertain response stops the queue and retains the exact PNG and proof for read-only recovery.
- Additional and detail batch locks are independent. Releasing an inactive stage cannot unlock another stage's operation. Unsaved image/HTML edits and other image processing block preparation/application.
- Long descriptions are split into requests of at most 5,000 UTF-16 characters, favoring paragraph boundaries and preserving CRLF and surrogate pairs. Only a complete successful translation is combined into the description. A failed chunk, quota response, exhausted request budget or combined result over 20,000 characters keeps the description incomplete and preserves the original. Successful title/option drafts remain reviewable. No text is truncated to fabricate completion.
- The stored image library is bounded at 150 files. Source selection remains at most 50 originals per collection; existing role and category field limits remain authoritative. The former 50-file library could accept the first translation at 49 originals and reject the second. The new limit is shared by writers, database guards, editor readers, label attachment and exports. Per-image and cumulative export/ZIP byte limits are unchanged. No database migration is added.
- Database readiness now includes the three existing migration tables omitted by its previous table inventory: collection_offer_claims, product_labels and managed_import_prices.

## Verification

609 passing tests across 44 distinct test files; no failed, cancelled or skipped tests in the release groups. TypeScript: zero errors. Global ESLint: zero errors and eight existing warnings. Production build and artifact binding/migration checks passed.

Release groups are additional/detail batch 30, long-description translation 78, image-library collection/workflow 100, image-library editors 165, image-library final API/export 4, dashboard batch locks 3, category/workbook connection 59, existing free-image translation 87, workspace navigation 27, quotation bundle 21 and extension 35. Files are counted once across groups.

The new positive local API fixtures cover both authorized companies, 5,600/20,000-character descriptions → editable SEO → quotation HTML, explicit SEO retry without automatic application, and 49 original images → two selected translated images → product label → official workbook/ZIP. Original source rows, other option values, manual HTML and exact selected attachment bytes are checked. Full-library and current category-field limits are also checked. OCR, translation responses and rendering in these fixtures are synthetic; these tests are not evidence of live 1688 collection, translation accuracy or a real Supplier Hub receipt.

The previous policy failures are retained only as private diagnostic evidence: the initial long-description tests failed before the fix, and the old 50-file policy fails the same image application fixture. Failed proof runs are excluded from the passing release count.

## Extension package

The shared workflow import changes generated identifier names in the bundled public source parser. The parser was rebuilt and released as 0.2.62 so the packaged module matches its source. The earlier published 0.2.61 ZIP is preserved byte for byte. The new 41-file ZIP is 525,788 bytes, SHA-256 `7ea897295589465471abc9ec0466f9e138e09a4a0490211f4834549e23e7318e`. Download labels now match the offered version. Host permissions and protocol requirements are unchanged; producing this package does not update the installed browser extension.

## Live scope and remaining acceptance

The existing Chrome profile is used for deployed UI inspection. Existing work products and the saved URL/category intake draft are inspected read-only; no recollection, content save, label rewrite, company reassignment, AI execution or Hub submission is performed on them. Actual loaded release assets, account settings, existing product row and saved draft inputs are compared before and after deployment.

Couplus stage observations and screenshots from step 625 remain the source reference. This step completes additional-image text-translation batching and the identified description/library blockers; it does not claim that every Couplus AI image operation, every category/default combination or all product-management functions have passed final parity acceptance. A fresh real 1688 intake, final manual review and a new Supplier Hub quotation receipt/SKU still require end-to-end production acceptance. Existing protected offers are not accessed externally.

Private check logs, browser snapshots and screenshots are under outputs and are not committed. The deployment version and Git receipt are recorded there after publication.
