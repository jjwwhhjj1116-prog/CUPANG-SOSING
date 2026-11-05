# Receipt Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the original quotation receipt flow when pending and terminal evidence share one observation timestamp.

**Architecture:** Extend the two existing guarded receipt SQL writers with an explicit state order for equal-time evidence; align the two client save-ACK comparators with that order. Keep all immutable identity/source/member guards, idempotence and transmission boundaries intact.

**Tech Stack:** Existing TypeScript/React, SQLite/D1, native adapter/receiver and Node test fixtures; no dependencies or migrations.

**Spec:** `docs/step976-receipt-progress.md`.

## Global Constraints

- Do not resend existing products or completed documents.
- Never infer registered/SKU completion from file processing completion.
- Keep packet/reservation, all source values and image objects unchanged.
- Exclude pre-existing auth working bytes from staging, frozen build and deploy.

## Review Focus

- Equal-time pending→accepted/rejected and accepted→rejected persist under unchanged immutable source.
- Same-time same-state results do not overwrite bytes or rejection diagnostics.
- Older or regressing evidence cannot downgrade terminal state.
- A same-time ahead ACK may finish the original local save; wrong owner/company/member/doc/QVT/body/source must fail.
- The complete native prepared lifecycle submits once, stores one exact receipt and never repeats writes during observation.

## Task 1: Reproduce and fix stored receipt progress

**Files:** `db/supplier-hub-single-receipts.ts`, `tests/supplier-hub-single-receipt-storage.test.mjs`, `tests/receipt-equal-time-api.test.mjs`.

- [x] Reproduce current/historical API200 returning old pending and shared storage dropping equal-time progress (both companies).
- [x] Add state-order SQL helper, use it in INSERT conflict and historical CAS without relaxing source/member guards; verify GREEN. A lower-state CAS fallback now returns409.
- [x] Check same-state byte retention, older/terminal regressions and unchanged immutable IDs.

## Task 2: Accept only valid ahead save acknowledgements

**Files:** `app/supplier-hub-product-client.ts`, `app/supplier-hub-single-client.ts`, `tests/supplier-hub-product-client.test.mjs`, `tests/supplier-hub-product-transport-ui.test.mjs`.

- [x] Reproduce Product equal-time ahead ACK rejection; independently confirm the same Single comparator.
- [x] Add Single and actual React ACK/retained reservation regressions; observe intended RED.
- [x] Remove only the redundant equal-time exact-state requirement, keeping timestamp/identity/monotonic-state checks; verify GREEN.

## Task 3: Verify the complete saved-form to receipt path and release

**Files:** `tests/helpers/native-source-review.mjs`, `tests/helpers/native-product-receiver-receipt-flow.mjs`, `tests/helpers/quotation-native-flow.mjs`, `tests/quotation-native-receipt-flow.test.mjs`, handoff/docs.

- [x] Add full synthetic exact-path quotation fixture and actual native prepared adapter/receiver/API chain; observe both-company final history remaining pending before the fix.
- [x] Verify both-company terminal receipt history, metadata-only recheck identity, one submit and no replay/source changes.
- [x] Run scoped regression/type/lint, obtain independent final review and verify browser with isolated data.294/294 scoped cases pass; prior baseline failures are outside this run.
- [x] Freeze reviewed sources with raw HEAD auth, build/deploy, compare served asset and record all actual limits. Commit/push of the exact reviewed files is recorded in the final output only after Git verification.
