# Saved Quotation Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reflect current saved official-form validation in quotation, option and product stages without confusing it with transmission or receipt.

**Architecture:** Store a server-created validation sidecar in the existing quotation JSON after a positive stable save. Bind it to canonical source metadata; derive read-only projections from the actual resolver and existing batched listing metadata. An explicit saved-input recheck records only this sidecar.

**Tech Stack:** TypeScript/React, existing D1/SQLite and quotation validators, existing hash/CAS utilities; no new dependencies or migration.

**Spec:** `docs/step975-saved-quotation-validation.md`.

## Global Constraints

- Do not resend existing products or completed documents.
- Keep original field values, IDs, schema, provenance, drafts and source bytes.
- Never set submissionReady or registered from form validation.
- Source/company/category drift and unconfirmed saves cannot complete a stage.
- Exclude unrelated auth working-copy bytes from commit/build/deploy.

## Review Focus

- Common/excluded/empty option sets must not fabricate global completion.
- Saved explicit blanks, price aliases and dependent validation must remain exact.
- Source/settings/profile/company changes must retire proof even without another field PUT.
- Metadata CAS/response loss must never repeat the actual field write or Hub request.
- Listing validation must remain batched and use the original requested profile or queryless capture.

## Task 1: Bind and store actual saved validation

**Files:** Create `app/quotation-save-validation.ts`, `db/quotation-save-validation.ts`; modify `db/quotation-fields.ts`, `app/quotation-fields-snapshot.ts`, `app/quotation-schema.ts`, `app/api/products/[id]/quotation-fields/route.ts`.

**Interfaces:** Shared proof/projection creation and validation, canonical source binding, guarded metadata seal; preserve existing PUT semantics and add bounded POST validate-saved with revision/fingerprint.

- [x] Add RED API regressions for positive/negative option validity, included aggregation, source binding, recheck without data writes and metadata races.
- [x] Observe intended failures, implement the smallest shared proof/CAS flow and verify GREEN.

## Task 2: Reflect results in current editors and lists

**Files:** Modify `db/product-content.ts`, `app/components/quotation-fields-editor.tsx`, `app/components/product-option-board.tsx`; shared status presentation in the new validation module.

- [x] Add RED UI/listing tests for saved current completion, partial options, stale/malformed proof and recheck guards.
- [x] Implement batch metadata proof validation, exact option-stage projection, current saved status and explicit read/recheck action.
- [x] Verify save failure/success/reopen, dirty/busy/source-lock and retired callback behavior with actual React/API fixtures.

## Task 3: Verify and release

- [x] Run affected quotation, listing, price/category, source/receipt and editor regressions; typecheck and scoped lint. The548-case run has538passes and10 unchanged HEAD baseline failures; not a full-repository pass.
- [x] Obtain independent review and fix reproduced findings. Result-integrity and export/native identity regressions are fixed; read-only review returned Ship within its stated scope.
- [x] Verify isolated browser flow, freeze exact reviewed sources with raw HEAD auth, build/deploy and compare served assets. Worker823377bd-e124-4eb4-b5e7-3e64b6c62469 and served dashboard SHA match the frozen build.
- [x] Prepare the exact19-file integration and update handoff/evidence with actual limits, including outstanding baseline failures and live acceptance. Final commit/push IDs are recorded in the generated release result only after Git verification.
