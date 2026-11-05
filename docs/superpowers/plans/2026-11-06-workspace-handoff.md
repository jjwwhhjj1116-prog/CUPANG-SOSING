# Workspace handoff implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep manual image reloads locked through their actual response and preserve exact option identity through editing and quotation review.

**Architecture:** Existing request controllers own loading state; deferred initialization yields to an active request. Update obsolete test entry assumptions without changing runtime routing or CAS.

**Tech Stack:** React/TypeScript, existing SQLite/R2 fixtures, Node test runner and Aside.

**Spec:** docs/step982-workspace-handoff.md

## Constraints and review focus

- Never resend existing products or completed documents; no operational Hub/product writes.
- Preserve the pre-existing auth modification and immutable CLI/extension; no new dependency/schema.
- Pending manual GET must retain busy and its exact draft; completion must publish once.
- Disabled/identity retirement must still abort or reject stale callbacks.
- Different editors must retain the selected option and searched/selected return table.
- New fixture products must satisfy original creation CAS; do not weaken it.

### Task 1: Reload ownership and complete workflow verification

**Files:** app/components/option-image-editor.tsx; tests/option-image-editor.test.mjs; tests/option-workspace-return-flow.test.mjs; tests/helpers/workspace-product-refresh.mjs; this spec/plan and handoff.

**Interfaces:** Keep existing APIs and callbacks; add only active-request exclusion in the deferred image initializer. Test helper stage identity follows the actual typed stage consumer.

- [x] Add a deterministic held-reload regression and retain RED output on unchanged runtime.
- [x] Yield deferred initialization to a current request; verify held-read controls and saved recovery.
- [x] Correct stage-specific assertions and new-product fixture clocks; retain strict source/selection/late callback invariants.
- [x] Run connected tests, type/lint/build checks, actual React browser held-read/recovery and quotation entry.
- [x] Obtain independent review; freeze/deploy/verify the exact patch, commit/push and record uncovered states.
