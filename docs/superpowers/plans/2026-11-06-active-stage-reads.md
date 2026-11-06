# Active-stage reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove demonstrated hidden-editor background reads while preserving editable drafts, source freshness and exact save recovery.

**Architecture:** Pass an optional active flag from the existing dashboard stage boundary to content/options/price/main-image consumers. Defer only automatic reads; retain mounted data and original in-flight mutations. Reactivation performs the existing fresh read for clean stale state. No shared response cache or relaxed validator.

**Tech Stack:** React19/TypeScript, existing Node component harnesses and SQLite API fixtures, Aside live browser, existing Cloudflare Worker.

**Spec:** docs/step983-live-workflow.md

## Global Constraints

- Never resend existing products or completed Hub documents.
- Live new target8ac721b8-2a75-4fdc-b33e-bba37b3a46eb only; physical facts remain pending user confirmation.
- Preserve pre-existing app/chatgpt-auth.ts modification; freeze raw HEAD auth for deployment.
- No new dependencies, shared cache, migration or reduced CAS/source checks.

## Review Focus

- Returning to a clean inactive editor after a source version change must refresh exactly once.
- Dirty drafts survive hidden stages and source changes; no automatic discard or write.
- A hidden stage does not cancel an already dispatched mutation or its original-request readback.
- Deferred initialization cannot clear busy for a newer explicit read/recovery request.
- Owner/product/profile changes retain existing retirement and data-binding rules.

### Task1: Active stage lifecycle

Files: app/components/dashboard-client.tsx, product-content-editor.tsx, product-options-editor.tsx, option-quotation-prices.tsx, option-main-image-editor.tsx; tests/content-editor-requests.test.mjs, option-quotation-prices.test.mjs, option-main-image-editor.test.mjs.

Interfaces: optional active:boolean defaults true on public consumers. Dashboard supplies actual stage activity. Options wrapper lazily mounts each editor on its first real visit and keeps it mounted thereafter. Internal price child receives the options stage's active flag.

- [ ] Add inactive-first/clean-stale-return/dirty-retention/pending-ACK tests using actual components and existing API fixtures.
- [ ] Run new tests against raw baseline; retain expected failures.
- [ ] Gate automatic initialization/refresh; add reactivation to existing read effects while keeping mutation lifetime separate.
- [ ] Run new and connected option/price/content/navigation tests; verify relevant TypeScript/lint.

### Task2: Verification harness repair

Files: tests/pricing.test.mjs and tests/stage-two-pricing-api.test.mjs only if investigation confirms the observed failures are fixture defects.

- [ ] Record exact failing tests before edits. The initial seven-file75-case run had62pass/13fail: obsolete VM import whitelist and duplicate product_content insertion are observed causes, not yet all classified.
- [ ] Repair loader/fixture setup without changing monetary, race or CAS assertions; rerun full affected files and linkage cases.

### Task3: Review, production verification and remaining live workflow

- [ ] Fresh independent whole-change review under requesting-code-review.
- [ ] Exact frozen build, normal authorized main push and same Worker deployment; verify served bytes and preserve original auth/distributions.
- [ ] Use the authorized new product to compare active-stage request counts and readiness with a clearly scoped browser measurement; no paint-speed inference from selection markers.
- [ ] Complete remaining factual fields and native document inspection when supplied; submit only the new target and save its exact Hub result. Keep pending if facts or actual result are missing.
- [ ] Record actual outcomes and limitations in handoff and user-facing evidence. Do not claim full workflow, speed parity or acceptance from fixture tests.
