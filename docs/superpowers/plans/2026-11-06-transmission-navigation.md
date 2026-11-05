# Transmission Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify and repair the saved quotation entry path from packaging and archive review through native transmission preparation, without replaying any existing product.

**Architecture:** Reuse Dashboard, QuotationPanel and SubmissionReviewPanel. First align old navigation fixtures with lazy stage mounting and the primary native path; only change runtime behavior if the actual flow fails a regression. Review the selected multi-product native handoff separately for concrete blockers.

**Tech Stack:** Existing React/TypeScript and Node isolated API/SQLite fixtures; no dependencies or migrations.

**Spec:** User's continuing COUPLUS workflow request and `docs/HANDOFF-2026-11-05.md`, with its no-resend boundary preserved. Live read-only reference quotation still has Save and Complete separately; neither was invoked.

## Global Constraints

- No existing product or accepted document create, upload, save or resubmit.
- Never treat file processing completion as verified SKU registration.
- Preserve unsaved form values, exact selected profile, original request and source identity.
- Exclude the pre-existing auth working change from staging/build/deployment.

## Review Focus

- Packaging navigation must preserve dirty or busy inputs and target the exact current option.
- A retained callback must not navigate another product or option.
- Native preparation must use the reviewed archive product independently of board selection.
- Lazy stage mounting and the optional Excel flow must be exercised explicitly by tests.
- Selected products' source and close locks must reflect their current native requests.

## Task 1: Restore meaningful navigation coverage

**Files:** `tests/workspace-product-navigation.test.mjs`; runtime files only if a real regression demonstrates a defect.

- [x] Run the existing file and record the five failures before changes.
- [x] Exercise actual stage entry, explicit legacy expansion and primary native props instead of unmounted child or old automatic Excel assumptions.
- [x] Re-run navigation cases:19/19 pass with no-write and source retention assertions intact. No runtime defect was demonstrated in this scope.

## Task 2: Verify and integrate the completed scope

**Files:** Focused tests, handoff and release evidence.

- [x] Obtain independent review: no concrete multi-product runtime blocker; navigation/review/submission63/63 pass independently. The navigation fixture does not prove actual child transmission.
- [x] Run the8-file affected regression:82/82 pass, Node syntax and diff checks pass. No TypeScript/runtime source changed, so no new compiler/lint/build claim is made.
- [x] Verify actual browser quotation input save→native source/file review→prepare1→explicit consents3→automatic observations2→one FINISHED receipt using actual isolated SQLite APIs. Hub/extension replies are synthetic; app messaging/storage/Web Locks are isolated, and unused AI/legal tools are stubbed. The completed DOM retains the saved model and receipt after collapsing/reopening the review.
- [x] No runtime changes require a new deployment. Retain step976 production Worker and integrate only reviewed tests/docs. Exact commit/push evidence is recorded in the final chat output after Git verification; live acceptance and full COUPLUS parity remain unverified.
