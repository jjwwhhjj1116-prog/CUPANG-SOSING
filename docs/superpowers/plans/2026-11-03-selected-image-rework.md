# Selected image-stage rework implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans. Track the steps below.

**Goal:** Make the existing explicit partial-work action process the currently selected raw photos without reprocessing completed translations or changing the photo selection.

**Architecture:** Forward the coordinator's selected/full mode to the shared image runner. Only explicit selected-mode rework may relax manual-selection skipping; planning still uses the current resolved quotation targets. Full/default mode, source comparisons, partial/unknown request fences and stored-edit validation remain unchanged.

**Tech stack:** TypeScript; existing Node test fixtures; existing Cloudflare build/deployment.

**Spec:** User's current workflow request; existing UI contract in `app/batch-selected-work.ts` (“다시 작업하려면 이 단계만 선택”); `docs/step931-automatic-image-resume.md` for preservation and recovery constraints.

## Global constraints

- Never modify unrelated live products or accepted document 2347603.
- No new dependency, provider fallback, durable inferred permission or automatic full-mode rework.
- Preserve current photo keys, order, intentional blanks, excluded options and unselected roles.
- Completed validated saved edit documents and valid no-text proofs must not trigger another paid inference or upload.
- Partial edits, pending inference and uncertain saves retain their original guards and request evidence.
- Keep unrelated `app/chatgpt-auth.ts` edits out of the release and commit.

## Review focus

1. Mixed completed and raw images: process only raw slots in explicit rework.
2. Empty manual targets: do not fill them from the captured source.
3. Main-image manual selection and role-level manual selection: operate on current selected bytes only.
4. Full/default work: retain previous manual-selection behavior.
5. A retained pending or uncertain request: never bypass it through the new option.

## Task 1: Explicit partial-work image processing

**Files:**
- Modify `app/batch-selected-image-work.ts` (runner option and manual-selection gates).
- Modify `app/batch-selected-work.ts` (forward explicit selected mode).
- Test `tests/batch-selected-image-work.test.mjs` and `tests/batch-selected-work.test.mjs`.

**Interfaces:** Add a narrowly named optional runner option for current-image rework. Only `controls.mode === 'selected'` sets it true. Default false preserves current behavior. Do not change source planning or selected-slot mapping.

- [x] Add failing mixed-image, blank-target, manual-current-selection, default-preservation and coordinator forwarding tests. Use existing real runner fixtures and counters to prove which raw keys, provider calls and save slots were used.
- [x] Run new tests before implementation and preserve the expected assertion failures in `outputs/step932-selected-rework-red.log`.
- [x] Implement the smallest option/gate/caller change. Keep complete saved-edit, partial-edit, source CAS and unknown request branches intact.
- [x] Run both affected suites and focused pending/recovery suites. Require all passes; run TypeScript, scoped ESLint and `git diff --check`.
- [x] Obtain independent code/spec review, fix concrete findings, then commit exact files.

## Task 2: Remove redundant pre-save pixel decoding

**Files:** Modify `app/free-image-translation-client.ts`, `app/detail-image-batch.ts`, and the apply dependency wrapper in `app/batch-selected-image-work.ts`; test `tests/free-image-translation-client.test.mjs` and `tests/detail-image-batch.test.mjs`.

**Evidence:** `applyDetailBatchResult` reads a full image but consumes only `refreshed.source`. The no-store `/image-text` GET already recomputes actual R2 byte SHA and dimensions; apply independently repeats that check before its guarded commit. Initial rendering must continue using authenticated pixel loading, SHA checking and native orientation decoding.

**Interfaces:** Extract `readFreeImageSourceProof` from the existing metadata/editor/proof validation part of `readFreeImageSource`. The original pixel-loading function delegates to it without changing behavior. Only the pre-save source identity check uses the proof-only reader by default; injected legacy pixel readers can remain supported for tests/callers. Keep every existing old/fresh source and target identity comparison.

- [x] Add red tests proving pre-save still revalidates the uncached source but does not request `/api/files` or allocate/decode another canvas; initial rendering still does.
- [x] Prove source byte SHA, role, target or clock changes reject before upload; cancelled requests still reject. Do not use cached source metadata.
- [x] Extract/reuse validation without weakening it; change the production runner's wrapper so it does not reintroduce pixel loading for pre-save.
- [x] Repair the existing legacy-detail integration fixture's renderer to return the same edit document as the real renderer. HEAD fails this fixture identically because it omitted the now-required document; preserve all real route/workspace validation.
- [x] Run affected image client/batch/runner/coordinator/recovery suites, typecheck, scoped lint and diff check; independently review before release.

## Task 3: Release and bounded verification

- [x] Record test results and browser limits in `docs/step932-selected-image-rework.md`.
- [x] Freeze the release using the existing helper, verify excluded auth file, build Cloudflare output and deploy under the existing authorization.
- [x] Check deployment version and authorized read-only application health. Browser UI claims require an actually working browser; do not infer them from unit tests.
- [x] Push the exact reviewed commit to the already-authorized main branch. No extension reload is needed for a web-only change.

## Execution ruling

The user has repeatedly directed continuous implementation without further planning questions. Proceed with the established implementation/review workflow. Browser connector authorization and missing real product facts remain separate pending questions; no dependent action proceeds without them.
