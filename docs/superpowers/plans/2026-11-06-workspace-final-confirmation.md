# Workspace Final Confirmation Implementation Plan

> **For agentic workers:** Use executing-plans for this focused inline change and requesting-code-review for the final independent read-only review.

**Goal:** Reduce repeated quotation assembly in detail editing/save/transmission preparation without reducing source, account, file or CAS checks.

**Architecture:** Keep initial snapshot bracketing. Final confirmation independently rebuilds the stable quotation once and compares the exact latest raw owner snapshot and workspace row. Share the existing member predicate so403 remains unchanged.

**Tech Stack:** Existing TypeScript/D1/R2 and Node actual SQLite fixtures; no dependencies or migration.

**Spec:** docs/step980-workspace-confirmation.md.

- [x] Reproduce four assemblies where three suffice, with byte-identical GET results and both-company fixtures. Nine final confirmation tests pass, including a delayed final-row membership change reproduced as RED in the first parallel implementation and fixed by restoring row→view→raw ordering.
- [x] Update db/detail-workspaces.ts final confirmation/member predicate, preserving every file verification and write CAS. Connected checks exposed seven pre-existing failures: three stale detail-save fixtures now prepare against fresh explicitly seeded views; four symptoms of one real attachment ACK/recovery defect are fixed in the shared app/detail-workspace-attachment.ts verifier. Retained/replacement/null validation badges are rejected. Connected19/19 and final broader121/121 pass.
- [x] Independent corrected-code review, actual composition browser10 checks and both-company attachment browser12 checks pass. Frozen8-file production build and Worker9abf7cd3-5db6-412c-b5be-a3db34775304 deployment match the served dashboard hash. Existing workspace read is byte-identical before/after, but3771.5→4136.9ms in a single pair does not show speed improvement. Auth/CLI/extension remain excluded/unchanged. Prepare exact8-file integration; record commit/push only after Git confirms success.

No protected existing product or completed document may be saved, transmitted or replayed. Live final acceptance requires a new authorized target; do not substitute existing goods. Background-controlled frames/local timings are not a foreground production latency benchmark.
