# Quotation Display Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match the observed COUPLUS quotation field sequence while preserving all current input and transmission data.

**Architecture:** Change the existing presentation helper only. Its returned array is consumed by the continuous React quotation form; the source schema and serializers retain their existing order and identities.

**Tech Stack:** TypeScript, React, Node test runner, existing synthetic SQLite/API and browser fixtures.

**Spec:** `docs/step973-quotation-display-parity.md`.

## Global Constraints

- Existing products and completed documents must not be resent.
- No new dependencies, schema migration, extension package or CLI release.
- Preserve unknown fields, independent OSRP, explicit blanks, manual overrides and raw Hub wire metadata.
- Use exact HEAD bytes for unrelated `app/chatgpt-auth.ts`; do not stage its line-ending change.

## Review Focus

- A late appended size-chart field must appear once within basic images.
- Arbitrary native field IDs must use exact paths rather than guessed labels.
- Unknown or workbook fields must remain visible and stable.
- Reordering must preserve edit targets, stored schema and final packet semantics.
- Categories without a size chart must retain their existing fields and stage count.

## Task 1: Continuous quotation form ordering

**Files:** Modify `app/quotation-field-groups.ts` and `tests/quotation-form-presentation.test.mjs`.

**Interfaces:** Keep `quotationFieldGroup(field, fields?)` and `quotationSectionDisplayFields(fields, section)` signatures. Return only reordered visible fields; do not mutate `fields`.

- [x] Add RED regressions for the observed basic/price order and an appended exact size-chart wire, plus multiple label rows and unknown/workbook preservation.
- [x] Run `node --test tests/quotation-form-presentation.test.mjs` and verify the intended ordering failures.
- [x] Implement ordering and exact image grouping in the existing helper.
- [x] Run presentation, price linkage, size-chart/export and native transmission regressions; run TypeScript and scoped lint.
- [x] Verify actual React rendering, focused edits, save failure/success and reopening in an isolated localhost fixture. Check zero production/Hub writes and unchanged stored schema/packet values.
- [x] Obtain an independent read-only review and fix reproducible issues before freezing.
- [x] Build/deploy the reviewed frozen source, compare served asset hashes, commit exact files, and record evidence and remaining live verification limits.
