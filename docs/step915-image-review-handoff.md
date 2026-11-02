# Completed recognition handoff for Stage 3/4 review

Automatic main/additional image cleanup discarded completed Vision metadata when background or region review blocked rendering. The review action then opened a generic editor without its original option/slot or recognized text. This release retains one bounded, parsed in-memory review payload and opens that exact manual editor.

The payload contains owner/company, source key/SHA/dimensions, original request UUID, configuration/inspection policy, parsed result, complete target value, category/schema/options/provenance and review reason. It contains no canvas, blob, object URL or inferred save authority. Retention happens only at the pre-render cleanup review gate; remaining images stop there. Render/apply failures and unknown inference/save outcomes are not converted into completed-review payloads.

Opening review rereads settings and the saved quotation view, validates the full logical target including sibling image order, and obtains the current source/binding through the existing source GET. Unrelated label/quotation clocks may advance; changed company, source pixels/key, category/schema, inclusion/option revision or slot value is rejected. All restored regions are unselected. Opening performs no inference POST, rendering, upload or save. Explicit user preview/apply uses the existing renderer and source-bound API/CAS.

The batch button is bound to the current attempt and checks product-wide inference/save pending keys. This prevents an old callback after a retry, or a prior completed image alongside a later unknown request, from opening the retained result. The Dashboard preserves dirty/busy editors and supports an explicit handoff to a pristine already-mounted product editor.

## Verification

- Root focused run: 12 files, **337/337** passed, no skipped/cancelled cases (`outputs/step915-focused-tests.txt`).
- A legacy saved-image review suite exposed an existing VM fixture missing `providedOptionModule`. Import/injection was repaired without changing production behavior; its **6/6** cases passed separately (`outputs/step915-registration-review-tests.txt`).
- Actual local renderer and image-text API fixtures for main/additional recognition advance unrelated quotation clocks, reopen with a new server binding, explicitly render/apply, and prove only one original model call, unchanged Vision ledger/raw sources, and only the selected slot saved.
- UI/runner/coordinator tests cover real complex-background rejection, second option/nonzero slot, no implicit POST/render/write, stale company/SHA/sibling value, late canvas cleanup, dirty/same-mounted editors, stale retry handlers and global pending coexistence. Independent review found and verified repairs for both stale-handler and pending coexistence cases.
- TypeScript, changed-file ESLint, diff check, isolated production build and exact hashes of six runtime files passed. Unrelated `app/chatgpt-auth.ts` working copy was excluded.
- Worker version: `cc87bc6b-e9bc-4c22-818f-17e0cc0f1843`. Extension stays 2.1.79; no extension refresh is required.
- Live read-only reload retained offer 886034098637/document 2347603 `접수확인` and the other existing product's waiting state. No live AI, file/body save, upload or retransmission was used. Screenshot: `outputs/step915-live-list.png`.

## Remaining boundaries

This assists manual review for Stages 3/4; it does not make complex-photo restoration automatically correct or change Stage 5 translation. The renderer's OCR rectangles can contain real product detail, so no background safety checks were relaxed. The preserved COUPLUS client evidence establishes erase/edit behavior, not its opaque server restoration algorithm.

Provider/API fixtures are local synthetic tests, not a fresh real seller collection or new Supplier Hub receipt. The prior 1688 site-safety denial was not bypassed. A fresh real collection through all stages and new receipt, missing detail-photo collection and full seven-stage visual/function equivalence remain outside this release's verified completion. Accepted document 2347603 is preserved.
