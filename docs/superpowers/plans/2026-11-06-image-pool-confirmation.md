# Image pool confirmation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let confirmed detail-image pool appends progress to quotation and transmission review without stale validation evidence or duplicate writes.

**Architecture:** Share the exact pool-only quotation verifier across workspace attachment, its parent editor and selected-option composite. Keep existing APIs, locks, source checks and GET recovery.

**Tech Stack:** TypeScript, React, SQLite/R2 fixtures, existing Node test harness and Aside.

**Spec:** docs/step981-image-pool-confirmation.md

## Global constraints

- Never resend existing products or completed documents; no real Hub or product mutations.
- Preserve the pre-existing app/chatgpt-auth.ts change; use raw HEAD auth in the frozen release.
- Continue the authorized current checkout/release workflow; no dependency or schema changes.

## Review focus

- A disappearing derived badge must not discard a committed image append.
- A stale, replacement or malformed badge must not become fresh validation.
- A late unrelated quote/source change must still block recovery.
- Pool ACK loss must never repeat upload, attachment or quotation save.
- Parent dirty/stage/disabled retirement and other options must remain intact.

### Task 1: Shared pool confirmation and connected acceptance

**Files:** app/quotation-image-targets.ts; app/detail-image-composite.ts; app/detail-workspace-attachment.ts; app/components/option-image-editor.tsx; tests/quotation-image-pool-workflow.test.mjs; this plan/spec and handoff.

**Interfaces:** Add verifyQuotationImagePoolChange(before, after, productId, expectedKeys): void; reuse from the existing three pool-confirmation consumers.

- [x] Write both-company actual-SQLite badge-bearing composite success/lost-ACK tests and parent-callback positive/negative tests. Run them unchanged and retain expected failures.
- [x] Implement the shared verifier and replace the three local comparisons without weakening caller guards.
- [x] Run the new tests and connected composite/attachment/option/native-receipt tests; run TypeScript, scoped lint and diff checks.
- [x] Verify actual React/Canvas save and read recovery in an isolated browser, then reach native quotation/transmission review without real Hub writes. Preserve original screenshots and proofs.
- [x] Obtain independent code review, fix any material finding with RED/GREEN evidence, build a whitelisted frozen release, deploy and verify the served asset. Commit/push only the reviewed files and record remaining limits.
