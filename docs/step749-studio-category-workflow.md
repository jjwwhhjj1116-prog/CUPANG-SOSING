# Studio category workflow — 2026-10-19

## Implemented behavior

The product-facing app, login, account page, unified extension, popup and collection button now use **YOOFAM 스튜디오**. Existing database keys, member/company ownership, protocol identifiers, deployment hostname and archive formats retain their existing identities.

After an existing current-page capture appears in AI registration, opening its new category selection passes its reviewed title (or immutable source title) to the recommendation card. The card requests up to three official Supplier Hub recommendations after a 600 ms name debounce, or immediately with **추천 새로고침**. Full category paths are radio choices. No candidate is automatically selected.

The independent predictor follows the RS shipped contract documented in `step749-rs-category-evidence.md`: `GET /sr/category/api/predict?productName=...`, a direct response array, and `internalCategoryId`, `internalCategoryCode`, `fullPathName`. The app sends a read-only recommendation command to the existing unified extension. No RS private account storage or private recommendation service is used.

The adapter binds the app member, approved company, Chrome window and exact Hub document before and after the request. It does not set a Hub product-name input. Chinese titles use the already configured free translation endpoint for the recommendation query only; this does not overwrite collected source text, SEO edits or product data.

A radio selection resolves every ancestor and the final leaf against the current company's live catalogue. The exact code/path is then passed to the existing category confirmation, Single form schema and intake path. Existing SEO, price, image, size-table, Korean label and quotation editors remain available. Recommendation alone does not create an intake product, submit a quotation, or change any existing product or settings.

## Validation

- 423 existing and new regression checks passed in `studio749-final-tests.log`.
- Five additional real CategoryPicker/API/SQLite integration checks passed in `studio749-recommended-intake.log`: both approved companies, single creation on double click, resolver failure without writes, and cancellation ignoring a late response. Existing products, options, content, quotations, source receipts, jobs, images and settings are preserved by these checks.
- Four additional browser-message integration checks passed in `studio749-bridge-tests.log` using the actual app exchange, content listener and worker route. They verify successful routing, returned errors, foreign-event rejection and installed-manifest capability gating. Together with the preceding runs, **432 distinct checks passed**. Review caught and fixed the missing recommendation content allowlist entry before final verification.
- TypeScript and ESLint passed. Production build completed successfully.
- Existing Worker deployed as `c5dcd87d-7f27-4022-9173-6d58f3ec38c5` (final package build; initial app deployment `d6c82e9a-abce-4653-a5c1-fb253f347e57`).
- Unified extension release: **2.1.1**, 82 packaged files, 928,046 bytes. SHA-256: `adb35a5d0d900b35dbe1badfb51c4a0b2063848e1bcf5cddc78f4bb9f31535d9`.
- Both the canonical extension source and the previously loaded sales-extension source were updated, with a local backup of the prior 2.1.0 source. Permissions and host access were not expanded.

## Runtime evidence and limits

The deployed Chrome app visibly shows the new title and the recommendation card. Its initial runtime still advertised the previous extension capability, so the member was asked once to reload the already updated unified extension. The app correctly did not fabricate candidates or fall back to a guessed code.

Live prediction results, exact leaf/schema selection and successful Supplier Hub receipt must each be recorded separately. A packaged implementation, passing tests or a deployed title is not evidence of actual submission. Existing live-verification gates are unchanged. No existing work product was edited or transmitted for this change. No denied 1688 source was fetched directly or indirectly.
