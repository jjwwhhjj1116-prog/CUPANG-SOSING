# Preserve completed image recognition for manual review

**Goal:** When explicit automatic main/additional image work (Stages 3/4) completes recognition but cannot safely restore a complex background, its review action opens the exact option/image with the completed recognition retained. Opening review does not create an inference, render, upload or save. Stage 5 translation handoff is outside this change.

**Evidence:** `outputs/step913-blocked-review-retention.json` reproduces the discarded completed Vision result. Background tests show a uniform surrounding ring cannot prove preservation of hidden product detail; do not loosen background checks.

**Implementation:** Bounded in-memory review payload in the existing selected-image result/state, carried through the existing batch review action to the exact editor target. Validate company/owner/product, parsed result/configuration, source key/SHA/dimensions, logical slot and full current target value before reuse. Rebind current clocks after intervening non-image stage work. Changed image/slot/company invalidates the handoff. Do not retain canvas/blob/object URLs. Initialize regions unselected; explicit preview/apply remains required. Unknown inference recovery takes precedence.

**Owned paths:** `app/batch-selected-image-work.ts`, `app/batch-selected-work.ts`, `app/components/batch-work-panel.tsx`, `app/components/dashboard-client.tsx`, `app/components/free-image-translation-panel.tsx` and their five existing focused test suites. Shared pure type/parser/current-target matching belongs to `app/selected-image-review.ts`, with its focused helper test. This sixth runtime file avoids circular imports and duplicated validation.

**Constraints:** Preserve accepted offer 886034098637/document 2347603 and other existing products. No live AI, save, file/body retransmission, new document or seller-page access. Do not touch unrelated `app/chatgpt-auth.ts`. Extension stays 2.1.79. No change to automatic background safety, Stage 5 translation requirements, models, provider policy, authentication or receipt state.

- [x] RED→GREEN completed-result preservation and exact editor handoff tests.
- [x] Implement runner/coordinator/UI/editor handoff; no implicit inference/render/write.
- [x] Test cancellation, stale account/source/slot, pending inference priority, cleared selections, explicit preview/apply only.
- [x] Independent review, focused regressions, types/lint/build, exact-source isolated release.
- [x] Deploy, read-only live proof, commit/push; retain honest real-world coverage limits. Deployed Worker `cc87bc6b-e9bc-4c22-818f-17e0cc0f1843`; final commit is recorded in Git history and `outputs/step915-verification.json`.
