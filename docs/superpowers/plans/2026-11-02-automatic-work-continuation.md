# Automatic registration workflow continuation

> **For agentic workers:** Use subagent-driven-development for the independent intake, Stage 5 and registration handoff checks.

**Goal:** Keep one explicit Work Start action progressing across selected captures and completed stages, then preserve the existing single-document registration and receipt workflow.

**Spec:** RS capture/category intake followed by editable COUPLUS-style stages 1–7 and reviewed Supplier Hub registration. Preserve unrelated products and the completed historical 886034098637 / document 2347603.

## Confirmed failures and implementation

- [x] Reproduce actual Dashboard → useIntakeDraft → IntakeQueuePanel → submitIntakeQueue with a held autosave. Retain the source work plan while the draft save is pending, paused or reconciling; advance the next category or launch the batch only after verified readiness. Identity/settings/capture changes still cancel. Never retry a collection or write because an acknowledgement is missing.
- [x] Add a server-authored versioned current-publication proof for automatic Stage 5. Re-read the exact final detail fields, source workspace, peer after-state and bytes plus relevant source/settings basis. Permit unrelated label/quotation clocks to advance. Only a fully current proof may skip reprocessing; legacy/missing/manual/stale/uncertain evidence stays review-required. Pending original requests take priority over discovery.
- [x] Audit and reproduce the complete top registration action through current saved quotation, native assets, member policy, one prepared document and receipt persistence. Fix a demonstrated defect only; do not weaken native company, current-source, duplicate-document or consent checks.
- [x] Review independently, run focused regressions/type/lint, build an isolated exact-scope release, deploy the existing Worker and verify the live UI without starting work or transmitting existing products.

## Protected state and evidence limits

The historical Supplier Hub document is already submitted. No live create, save, upload or resubmission is permitted for QA. Existing 1688 site-safety denial remains in force; do not use an alternate tool or indirect route to observe that source. Synthetic providers and local SQLite/R2 fixtures establish code behavior, not a fresh real-world collection or receipt. The unrelated `app/chatgpt-auth.ts` working copy stays excluded from release and commit.
