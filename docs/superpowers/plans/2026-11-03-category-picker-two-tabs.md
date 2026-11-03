# Category Picker Two Tabs Implementation Plan

> **For agentic workers:** Use executing-plans for the owned UI tasks. Root coordinates backend work and release.

**Goal:** Open category selection on 추천 선택 and offer directly chosen official categories under one 직접 선택 tab.

**Architecture:** Preserve CategoryPicker's current recommendation, company/leaf/schema confirmation and profile save handlers. Two accessible top tabs only change the visible selection tools; direct selection groups the existing Supplier Hub cascader, explicit backend search and saved-profile disclosure. Recommendation input and direct selection state survive tab changes; active source/account and pending confirmation checks remain authoritative.

**Tech Stack:** Existing React/TypeScript, CSS, Node synthetic component/API tests. No new dependency or client search engine.

**Spec:** Root's approved two-tab category popup request in this task.

## Constraints

- Recommend is the initial tab even without a source title, with the existing editable product-name field and maximum three recommendations.
- Saved profiles are a subordinate direct-selection tool, never a third top tab.
- Preserve account/company, exact leaf/code/path, current schema, official workbook, cancellation and original pending writes.
- Search uses the shared backend contract owned by workflow_contract907. No browser, real vendor/provider/network or product mutations during implementation.
- Keep step920 ALT changes frozen; preserve unrelated authentication and label attachment edits.

## Tasks

- [x] Add failing actual-picker UI cases for exactly two tabs, default/no-title, retained input, keyboard navigation, direct tools and saved profiles.
- [x] Group current tools into those tabs and add minimal responsive/focus CSS. Reuse existing recommendation and confirmation handlers.
- [x] Bind direct search to the agreed shared helper and exact leaf resolution. Reject stale/foreign responses before confirmation.
- [x] Update existing UI harness navigation to explicitly open direct selection; keep all validation assertions.
- [x] Run owned UI and adjacent selection/company/recommendation suites, types/lint/diff checks. Record scope and freeze for independent review.

## Verification

The original four tab cases and two explicit-search cases failed before implementation. Final eleven focused files cover 166 distinct passing cases (119 tool/selection cases plus 67 company/Single/workbook cases, with the 20 shared tab/panel cases counted once). Logs: `outputs/step921-category-ui-final-tools.log`, `outputs/step921-category-ui-boundaries.log`, `outputs/step921-category-ui-final-lint.log`, `outputs/step921-category-ui-final-types.log`.

The search reuses the existing official prediction and live branch resolver. There is no RAG index or new backend/search/provider API. Tests use isolated hook/API/SQLite fixtures; no browser or vendor service was used. Reference visual parity and production deployment are owned by root.
