# Bounded packaging batches

> **For agentic workers:** Use subagent-driven-development for the shared server contract and client orchestration; review the connected flow before release.

**Goal:** A single explicit Work Start completes missing packaging across up to 200 included options, using at most 20 target IDs per provider request.

**Architecture:** Add optional `batchOptionIds` to the existing all-options request/result scope. The client freezes a finite ordered eligible-ID list, visits disjoint chunks, verifies fresh source and each CAS acknowledgement, and aggregates truthful progress/results. No new database ledger, provider, quota or background job.

**Tech stack:** Existing TypeScript, Worker/D1/R2 routes, Qwen packaging draft and selected-work coordinator.

**Spec:** Existing user request for automatic editable stages and Supplier Hub registration; prior boundary documented in `docs/step911-normal-registration-fields.md`.

## Constraints and review focus

- Preserve other products and accepted offer 886034098637 / document 2347603. No live save/upload/resubmission for QA.
- Do not bypass the existing 1688 site-safety denial. Provider/Hub fixtures remain synthetic.
- Optional batch scope: 1–20 unique valid current included option IDs; only with `optionId:null` and `applyToAllOptions:true`. Result echoes the exact requested ID order; proposals cannot escape it.
- Existing all/single request/result contracts remain compatible. Preserve maximum 200 source options, 20 provider targets and 40 proposals per request, existing shared quota and manual/excluded values.
- Abstained IDs are visited once and cannot starve later chunks. Unknown generation/save results, cancellation or account/source drift stop further requests; no blind retry.
- Show per-chunk progress through the existing Stage 7 running state, with no new global banner.
- Complex-background capabilities are assessed separately; no speculative relaxation of existing image checks.
- Exclude unrelated `app/chatgpt-auth.ts` working copy. Keep extension 2.1.79 unless its code actually changes.

## Tasks

- [x] Server/shared contract and actual API tests: `app/quotation-packaging-draft.ts`, its route and focused tests. Owner: workflow_contract907.
- [x] Finite client batching, fresh read/CAS, aggregate results and failure tests: `app/batch-selected-packaging-work.ts` and focused tests. Owner: quotation_bridge907.
- [x] Root: connect optional progress to existing Stage 7 feedback and verify the public coordinator path.
- [x] Independent review: 21 missing → 20+1, more than two chunks, abstention, manual/excluded values, unexpected scope/duplicates, quota, cancellation, account/source drift and lost acknowledgements.
- [x] Focused tests, types, lint, isolated build, exact runtime/source comparison, deployment and GitHub main push. Commit `0d8053ec`; four committed runtime files matched the isolated build.
- [x] Live read-only state/screenshot verification and honest statement of remaining real-world/UI coverage.
