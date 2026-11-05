# New-draft document defaults and selected image work

2026-11-05. User requested that new sourcing drafts default to no certificate/test-report attachments. The separate socks verification product was explicitly confirmed as having no attachments. Historical offer 886034098637 / accepted Supplier Hub document 2347603 remains outside all writes.

## Implemented

- Creation-only `newProductContent` persists `legalDocuments: { applicability: 'not-applicable', files: [] }` for collection drafts, retained-source new drafts, and direct URL product creation. Existing `emptyProductContent`, legacy reads, and saved existing choices are unchanged. A member can change a product to required and attach its documents through the existing editor.
- Direct URL creation initializes content in the original atomic creation batch. The existing label companion guard also rejects a skipped content insert. IGNORE and ABORT fault-injection cases roll back product, content, labels, policy, and registration together. No migration or existing-product backfill is applied.
- Selected-image resume keeps a collected category in its original collection context. A saved profile ID carried by that context no longer converts the subsequent read into a different profile context after a sibling label save.
- New automatic detail BODY requests include the saved copywriting switch and translation guidance as server-verified, immutable user data. Completed-cache reuse additionally matches the style. The original source/policy keys and active/uncertain request fences are unchanged; edited BODY photos remain protected. Legacy synchronous vision input is unchanged. No new model, dependency, or provider fallback is introduced.
- Stage 5 uses the observed COUPLUS header weight and active English/AI button colors. Existing disabled and pending-save behavior is preserved. The retained-panel fixture now visits each lazy stage before checking its retained children.

## Verification

- Root combined eight-suite run: 284/284 passed, including actual intake API profile/collection resume, new-draft defaults, historical-state preservation, IGNORE/ABORT rollback, pending request identity, and style validation/cache separation. `outputs/step953-root-final-tests.log`.
- Root final synchronous/batch provider suites: 49/49 passed after the last batch-only prompt restriction. `outputs/step953-root-final-worker-tests.log`.
- Root new-default/initial-label/legal-document/native attachment and binding suites: 62/62 passed. `outputs/step953-root-legal-checks.log`.
- TypeScript, scoped ESLint, whitespace checks, and frozen Cloudflare production build passed. Two independent workers cross-reviewed the new-default and vision changes.
- Frozen release excludes the unrelated local `app/chatgpt-auth.ts` change and contains the exact HEAD bytes for that file. All 22 overlaid source/test hashes matched the frozen build inputs.
- Worker version: `c36c6290-6458-4f56-bd7f-d32363716017`. Served dashboard bundle: `dashboard-client-Ds-0PBKj.js`, 2,221,197 bytes, SHA-256 `e8841e074dcc4e3b97a9d536e89e97c8a1f8384094b88f2b45442f06726c2034`; identical to the built asset.

## Live product observations

- Only owned verification product `865ff938-1f6e-42cd-bcfe-863cba84eb09`, registration `261103002001`, offer `965495834905`, company A01526306 was edited. Its document applicability was saved through the UI as N/A with zero attached files (content revision 60). The native source check then had no hard errors and compiled eight options into one review document. Review notices still require product review; this is not receipt confirmation.
- The light-grey main photo was visually inspected and explicitly saved as the same original file through the candidate selector (quotation revision 15, option revision 4, no new image upload). It contains physical sole markings rather than a separate Chinese overlay.
- A fresh partial main/additional automatic run finished for this one product with review required. Four main preservation receipts were reused without new inference or image writes. The light-grey source still required manual review because the reader could not confidently transcribe its faint markings. Additional image 1 preserved its saved editor; image 2 retained an original running/uncertain request fence, without automatically resubmitting it. No automatic completion was inferred. The exact outcome is in `outputs/step953-live/step953-partial-image-run.txt`.
- Production Stage 5 browser computed styles confirmed heading weight 600, enabled English tool `rgb(255, 151, 112)`, and enabled AI tool `rgb(120, 192, 145)`. The observed viewport was 1800×1125 CSS pixels at DPR 0.8, so this is control-style verification, not a comparable-viewport pixel-parity claim.
- No new socks Supplier Hub document or receipt is claimed here. Accepted document 2347603 was not created, uploaded, saved, or submitted again.

## Reference evidence limits

REA analyzed the retained shipped detail and quotation fragments, not the complete service: detail view evidence `ev_5a83a0708b881b18ca72d8d9dd99a5e076f333e98136ae8e3c1f9b6b94a5d07e` (artifact SHA-256 `6b960066df01ab5dc346311b403422e244e93f57431a79cc5f3d05610f5036c3`), quotation view evidence `ev_bfd1493300ae56d6903b46231dd9b4b5cfc7a66906f6362aa50bd5e6d5f2afa3` (SHA-256 `5067a52c402d8faf772d41129dee433637913cdbf84cf57be1c636fd15612f47`). Static reference certificate text defaults do not establish actual attachment applicability; the creation default above follows the user's explicit choice.

Full seven-stage visual/functional equivalence and a new product's actual Supplier Hub receipt remain separate verification work. Existing pricing fixture's bare `parse5` loader failure was reproduced against HEAD and is not represented as fixed by this change.
