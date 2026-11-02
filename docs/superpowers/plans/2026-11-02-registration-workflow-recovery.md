# Registration workflow connection repairs

> **For agentic workers:** Use subagent-driven-development for the two independent repairs, then review the integrated change. Steps use checkbox syntax.

**Goal:** Connect collected BODY photos to Stage 5 translation and recover an original quotation AI generation without issuing a duplicate generation.

**Architecture:** Reuse the existing detail-workspace image APIs and exact-key quotation GET. Keep the Couplus presentation already deployed. Persist an editable composition before its translation/composite preparation; preserve the existing explicit review and final-save gates.

**Tech Stack:** Existing React/TypeScript, Node test harness, Cloudflare Worker/D1/R2. No new dependencies, provider, permissions, model or extension version.

**Spec:** The user's established RS collection → category → Couplus 1–7 editing → reviewed Supplier Hub submission specification; `C:/Users/7500F/.codex/skills/yoofam-couplus-ui/SKILL.md` and retained `outputs/step899-couplus-detail-ui-findings.json`.

## Global constraints

- Preserve all unrelated products and historical offer 886034098637 / request f29491bd-1882-456a-8a63-eec8586db6c6 / submitted document 2347603. No saves, uploads, creation or resubmission on that product.
- Keep company/profile/option/source checks, CAS, banners, manual values and unknown-ACK fences.
- No automatic legal consent, unreviewed image overwrite or paid model change.
- A lost generation response permits exact-key GET only; no POST replay.
- BODY translation must read the stored composition, not saved quotation slots; final composite still requires reviewed save.

## Review focus

- Lost/malformed/non-2xx generation response, missing/duplicate/wrong-key receipt: preserve fence and original UUID.
- Source/company/settings/revision or option change (including ABA): retire callbacks/results without silently applying.
- Sequential BODY writes: source key/SHA/id/origin/order and all other photos/banners must remain exact.
- Unknown image/store outcome: preserve original preview/request and stop later writes.
- Parent busy echoes and rerenders: do not cancel one's own operation or drop pending recovery state.

### Task 1: Exact-key recovery for quotation automatic work

**Files:** `app/batch-selected-work.ts`, `tests/batch-selected-work.test.mjs`.

**Interfaces:** Consumes the already supported `/quotation-ai?idempotencyKey=UUID` echoed key and exact job array; produces the existing quotation review/save path only after exact source/scope/model/policy validation.

- [ ] Add failing tests: POST ACK lost then exact completed GET recovers, generation POST count remains 1; missing/duplicate/wrong key/non-2xx/prepared/source mismatch remain fenced.
- [ ] Run the named tests and observe the missing recovery failure.
- [ ] Retain original request proof before dispatch, retain v1 acknowledged-job compatibility and predispatch UUID reuse; use exact-key GET for missing job ID.
- [ ] Run the full selected-work test file, TypeScript and changed-file lint.

### Task 2: Raw BODY translation and composition toolbar connection

**Files:** New `app/detail-workspace-image-batch.ts`, `app/components/detail-workspace-image-batch-panel.tsx`; integrate `app/components/detail-workspace-panel.tsx`, `app/components/option-image-editor.tsx`, `app/components/dashboard-client.tsx`; focused tests.

**Interfaces:** Existing `DetailWorkspaceSelection`, `DetailWorkspaceView`, `DetailWorkspaceEditorContext`, read/translate/apply/recover workspace image helpers. Publish guarded `{prepare():void, disabled:boolean}` actions from a stable mounted batch panel; `onSaved(reply)` supplies only confirmed current workspace changes. Existing composite toolbar remains `{prepareSave,saveDisabled,download,downloadDisabled}`.

- [ ] Add failing tests for BODY-only preparation, no quotation writes, sequential rebinding after exact confirmed save, stop on unknown ACK, and no banner/order/manual edit loss.
- [ ] Implement a bounded sequential local OCR → existing text translation → render pipeline using current workspace source identity. Reuse the 30MB preview bound and existing image apply/recovery helpers.
- [ ] Add the stable panel with preview/review/explicit apply/recovery, expose only current guarded preparation callbacks, preserve state during stage/busy changes.
- [ ] Add failing toolbar tests: new seed/dirty composition → store confirmed → exact new composite prepare once; lost store ACK → prepare zero.
- [ ] Integrate the BODY panel inside `DetailWorkspaceForm`; route Stage 5 batch toolbar there and retain Stage 4/legacy quotation batch paths.
- [ ] Run focused behavioral tests, existing workspace/editor/composite regressions, TypeScript and changed-file lint.

### Task 3: Review, release and actual UI verification

- [ ] Independent review of connected guards and diff; fix confirmed findings with regression tests.
- [ ] Build an exact-commit isolated release excluding unrelated `app/chatgpt-auth.ts` working copy.
- [ ] Deploy to the existing Worker and verify Stage 5 controls in the real browser without mutating protected data.
- [ ] Preserve proof of actual verification and state unverified fresh-collection/new-submission gaps accurately. Push only the authorized implementation commits.

## Execution rulings

- Continue the user's existing, repeatedly authorized implementation; no new design/approval round or alternative product architecture is needed.
- Work in the existing checkout with explicit file ownership; the unrelated authentication working copy remains excluded. Deployment uses a separate exact-commit archive.
- The explicit original-image review/save gates are retained even where the reference has less protection. No known missing BODY data is fabricated.

## Execution evidence

- Implementation: `99a48bc9`. All six runtime files in the isolated release match the commit; unrelated authentication working copy excluded.
- Final focused run: 137/137 passed (`outputs/step906-final-focused.txt`). TypeScript, changed-file ESLint and production build passed. Independent review cleared the quotation recovery and BODY pipeline; its crop/manual-edit finding was fixed before release.
- Worker: `8713bec6-63a1-4caa-9953-f3d28e6fe754`. Browser proof: `outputs/step906-detail-final.png` and `outputs/step906-detail-browser.json`.
- The broad repository run was stopped after 60 encountered failures. Five caused by new fixture/legacy presentation assumptions were fixed and rerun. All remaining 55 failure names independently reproduce in the previous `dd8b1909` release (185 tests: 130 pass, 55 fail). This is not a green whole-repository run. Exact classification: `outputs/step906-test-audit.json`.
- No protected product saves, provider calls, Hub writes or resubmission were performed. Saved final quotation detail images remain two; editable raw seed remains top-banner-only and is not promoted to completed translation.
- A direct read of the previously authorized 886 source URL was rejected by the browser's site-safety gate without an approval prompt. No alternate browser, raw request, CDP or indirect read was attempted. Fresh collection and a new actual end-to-end submission are not verified by this repair.
