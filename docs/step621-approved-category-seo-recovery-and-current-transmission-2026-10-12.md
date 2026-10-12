# Step621 — approved category selection, SEO recovery and current transmission

The workflow remains Supplier Hub category → 1688 URL → editable stages 1–7 → user review → explicit quotation transmission. These changes fix account, form and saved-edit discrepancies inside that workflow. They do not establish exhaustive category parity or a new real Supplier Hub receipt.

## Confirmed problems and resulting behavior

- Category confirmation previously accepted a saved code/path even when its detailed form could not be validated. A missing live schema could also become a generic code-only profile. Confirmation now validates company, exact code/full path, schema compilation and official workbook evidence. An unchanged revision cannot silently change initialization rules, template or manual mappings. Observation time and object key order alone do not invalidate the form. Generic manually saved profiles remain usable without being presented as verified Hub forms.
- The picker uses the current account's settings scope and approved company, checks it again before publishing selection, and invalidates retained requests/callbacks when the account changes. A delayed profile lookup followed by an authentication change reproduced creation of a generic profile in the wrong workspace. Picker POST, PUT and definition-fork requests now carry the selecting owner; the server rejects a different owner with 409 or malformed proof with 400 before writes. The current server owner is captured once and reused for persistence. Existing manual clients without this optional precondition remain supported; authentication and template ownership checks remain enforced.
- Option SEO save could commit successfully while its response was lost, leaving the editor on an old product version and unable to restore or retry. The editor now retains the draft and confirms the exact committed override change from the authoritative quotation read before clearing it. It does not repeat a write after a proven commit. Unrelated overrides, other options, schema and automatic source values must remain unchanged. Unconfirmed or concurrent changes retain the user's input. Explicit cancellation can discard only the local draft after reading the latest saved state.
- Retained quotation transmit/handoff callbacks could use old consent or preview state after an awaited source check. Dispatch now confirms the current preview, active mounted operation and current consent snapshot at the dispatch boundary. Inspection, resume validation and fingerprint checks use current state. A new history read invalidates old history immediately; a failed whole-product history lookup cannot reuse a previous verified history to enable another transmission. Result/receipt recovery remains available without sending again.
- Submission review could publish old inspection results or open an issue editor from a different category/product context. Each request context now has its own identity and cleanup; final results and edit callbacks require that current identity. Changing categories or rechecking invalidates the old context immediately. A rapidly batched A→B→A selection creates a fresh run and cannot revive the first A inspection. Current results still allow normal issue editing.

## Verification

All **269 nonduplicate tests passed**, with zero failures, cancellations or skips:

| Log group | Test files | Cases |
| --- | --- | ---: |
| review-panel | submission-review-panel | 14 |
| option-seo | option-seo-editor | 15 |
| seo-workflow | seo-workspace-generator; seo-workspace-draft; seo-workspace-adoption; seo-option-names; seo-option-names-ui | 39 |
| package | official-workbook-handoff; submission-package-transmit; supplier-hub-handoff; supplier-hub-receipt-recovery | 107 |
| category | category-definition-refresh-client; category-picker-company-intake; category-picker-requests; category-profile-choice-evidence | 68 |
| category-owner-api | category-profiles | 8 |
| category-definition-flow | category-definition-refresh-flow | 18 |

Tests use local handlers, synthetic two-company data, SQLite, R2 and workbook/ZIP fixtures. They verify exact account/company/category identity, source and override preservation, common inheritance, explicit blanks, SEO ACK loss, active consent, duplicate prevention, history failure, and retained callbacks. They do not submit a user product to an external service. Category definition regressions verify preservation of originals and manual mappings, including legacy requests without the owner header.

Fail-before evidence includes invalid category fallback (0/3), delayed wrong-workspace category creation (0/2), ignored POST/PUT/fork owner preconditions (0/6), SEO committed-save recovery (0/2), stale transmission actions (0/8), post-await consent/source invalidation (0/4), failed history recovery (0/2), stale review callbacks and rapidly batched category selection. Corrected cases are included in the passing groups above.

Final TypeScript: zero errors. Global ESLint: zero errors and eight pre-existing warnings. Bounded production build: passed. A Windows sandbox realpath/EPERM build failure was preserved separately; the same bounded build succeeded with the required filesystem access, without dependency or configuration changes. The original 17 migrations, extension 0.2.57/0.2.58/0.2.59 archives and Gmarket fonts remain byte-identical. No extension update is required by this change.

Independent review found the owner error's initial unsupported 409 type, which was fixed with a dedicated error class. Final review found no further concrete issue in the changed owner, transmission or review-context contracts.

## Read-only source comparison and deployment

The user's existing Chrome (browser 3) was reused. Couplus's existing curtain product 261011001001 was read without saving, regenerating, translating, deleting or transmitting it. The additional-image stage showed upload, ten source images, selected preview, edit/AI/save and a five-image sortable/deletable additional strip. The detail stage showed upload/download, English→Korean translation, batch AI/save and eighteen editable/deletable image blocks. The generated Korean-label stage showed download/rewrite; rewrite was not clicked, so this is not a fresh read of its input form. Private DOM captures retain these observations. A source screenshot attempt timed out; it is not evidence that new screenshots of every source stage were obtained. The original today filter was restored and source popups were closed.

Supplier Hub's dashboard showed the current 유앤채 company. The dashboard remained unchanged. No new access was attempted to the previously denied 1688 offer, and existing account-mismatched drafts were not reassigned or transmitted.

Worker version `3b342c3d-125b-4b19-ab2e-6d74d50caa47` is deployed at `https://sourceflow.jjwwhhjj1116.workers.dev/`. The first upload-session request failed with 504; a retry failed while parsing the deployment-history response. A subsequent identical-artifact deployment completed and the new `dashboard-client-BeJFsM70.js`, dashboard CSS and global CSS were observed in the same Chrome. These failures and the final success are recorded separately in private release logs.

The original one product and 29 main-list controls, 35 account-setting controls, and one URL draft with ten controls matched exactly before/after via read-only DOM. The existing draft was not submitted, replaced or edited. Private `outputs/step621-live-verification.json` records every preservation and loaded-asset check as true while keeping fresh collection/real receipt/all-category acceptance false. The screenshot `outputs/step621-deployed-app.png` was saved and visually inspected, and the deployed app tab remains open.

## Remaining acceptance

Fresh real 1688 collection through an actual Supplier Hub quotation/SKU receipt and exhaustive parity across every category remain unverified. Successful local API/XLSX/ZIP tests and deployed UI preservation are not replacements for that acceptance. Existing company, original-workbook, required-field, image-proof and receipt checks remain enforced.
