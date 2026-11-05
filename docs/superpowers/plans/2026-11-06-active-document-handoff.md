# Active Document Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep one active document workflow stable across retained product/list callbacks and failed quotation handoffs.

**Architecture:** Reuse Dashboard's current session refs and synchronous lock guards. Return a boolean from the existing submission entry; close the source workspace only after a successful entry.

**Tech Stack:** TypeScript/React, existing Dashboard and isolated SQLite/API fixtures, Aside browser QA.

**Spec:** `docs/step974-active-document-handoff.md`.

## Global Constraints

- Do not resend existing products or completed documents.
- Preserve explicit pending close/recovery behavior and the original request.
- No new dependency, schema migration, extension or CLI release.
- Exclude unrelated `app/chatgpt-auth.ts` working-copy bytes.

## Review Focus

- A source-only lock must prevent replacing the live session through an old list callback.
- Old product-board callbacks must not open another editable workspace during transmission.
- Explicit close must permit a fresh session without reviving old locks/callbacks.
- A rejected submission entry must retain the current editor and option return context.
- Existing company/owner, dirty-input, saving and category-layout guards must still apply.

## Task 1: Guard the current handoff

**Files:** `app/components/dashboard-client.tsx`, `tests/submission-owner-scope.test.mjs` and focused navigation tests as required.

**Interfaces:** `openSubmission(target): boolean`; other existing props and callback signatures remain compatible.

- [x] Add failing real-Dashboard regressions for active source/close locks, retained list/product actions and explicit close/reopen for both company fixtures.
- [x] Add a focused actual-function regression for failed handoff preserving editor/option context and successful exact product/profile transfer.
- [x] Observe the intended failures before changing runtime code.
- [x] Implement the guards and boolean handoff, then run affected owner/navigation/transmission checks, TypeScript and scoped lint. Broader293pass/5unchanged-baseline failures are recorded in the spec, not counted as an all-pass run.
- [x] Verify the actual Dashboard functions in an isolated browser; no real extension or Hub commands.
- [x] Obtain independent read-only review and fix reproducible findings.
- [x] Freeze/build/deploy, verify the served asset, commit/push exact files and preserve evidence and live verification limits.
