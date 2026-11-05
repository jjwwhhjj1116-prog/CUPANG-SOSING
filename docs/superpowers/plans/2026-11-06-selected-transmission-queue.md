# Selected Transmission Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans for inline work and dispatching-parallel-agents for the independent isolated consent task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Connect reviewed selected products to one sequential native registration queue without replaying protected or uncertain requests.

**Architecture:** New queue client/model and React panel reuse owned snapshot/native review/preview and existing ProductTransport. The independent extension task adds a bounded trusted batch binding and per-request configured-consent lifetime. No alternate Hub transport or receipt store.

**Tech Stack:** Existing TypeScript/React/Node/SQLite fixtures and Chrome extension; no dependencies or migrations.

**Spec:** `docs/step978-selected-transmission-queue.md`.

## Global Constraints

- Do not resend existing products or completed documents; real product/Hub operations are outside this QA run.
- Preserve source/members/body/owner/company/request identity and all consent checks.
- At most one active new request; no advancement from pending or failed receipt storage.
- Exclude existing auth working bytes and immutable CLI0.1.3 archive from changes.

## Review Focus

- Source or owner/profile ABA changes must retire captured callbacks synchronously.
- Existing history/reservation cannot become a new batch candidate.
- Duplicate callbacks, remounts, response loss and stopping must not replay preparation or submit.
- A terminal ACK must belong to the exact reviewed request and source before advancing.
- One product's cancel/terminal-consent consumption must preserve other batch consent scopes.

## Task 1: Candidate and queue contract (root)

**Files:** new `app/supplier-hub-transmission-queue.ts`, focused client/queue tests and synthetic fixture updates.

- [x] Observe RED for missing binding/terminal-receipt contract and late-history/category drift. Verify new-candidate selection and existing-history/reservation exclusion against actual isolated SQLite APIs.
- [x] Reuse existing read/compile/preview/history helpers; both-company model/integration6/6 and current-source/expected-category guards pass.

## Task 2: Isolated trusted batch consent (independent worker)

**Files:** `extensions/supplier-hub/single-content.js`, scoped cancellation in `app/supplier-hub-product-client.ts`, relevant consent/client tests, extension manifest and generated release artifacts.

- [x] Observe RED then GREEN for trusted two-request batches, scoped cancellation, terminal consumption, invalid/mixed/duplicate bindings, synthetic-click denial and account ABA. New batch/account32 and client3 pass.
- [x] Implement exact8-key bindings: ownerId, productId, companyCode, packetDigest, requestId, identityDigest, bodySha256, preparedBodySha256. Button attributes are `data-supplier-hub-registration-batch="v1"` and `data-supplier-hub-registration-items` (JSON array,1–100 entries, same owner/company, distinct products/UUIDs).
- [x] Extend `cancelConfiguredProductConsent(requestId?:string)` with per-request cancellation; keep old no-argument cancellation fail-closed.
- [x] Package2.1.92 (133files/2273274bytes/SHA6e3182f39d98aac0f8b84625bd1928045c6804b2f924606e6e13c9f0a79c0544). All181 older ZIPs and CLI0.1.3 TGZ unchanged; extension artifact/lint checks pass. Wider250 run retains1 failure/5 cancellations reproduced from3 pre-existing root fixtures.

## Task 3: Existing transport and parent queue UI (root)

**Files:** `app/components/supplier-hub-product-transport.tsx`, new `app/components/supplier-hub-transmission-queue.tsx`, `app/components/submission-review-panel.tsx`, related UI tests.

- [x] Add reviewed session/start-token support and typed saved-receipt notification using current prepare/recovery code; queued Transport3/3 pass after RED, including a new review's delayed history fence.
- [x] Add explicit batch review/start/stop and progress; only one active candidate advances on exact saved terminal receipt. Preserve individual transmission and parent locks.
- [x] Verify manual consent fallback, changed/uncertain/pending/unmounted contexts and original UUIDs. Two review findings reproduced and fixed: retired start/stop callbacks and stopping before current handoff adoption. Independent actual Queue+Transport coupling confirms current completion and stopped successor.

## Task 4: Integrate and release (root)

- [x] Independent77 checks plus one actual Queue+Transport coupling pass; no remaining reviewed P1/P2. Final18-file regression503:497pass/6fail; the same6 option-return fixture failures reproduce with all app sources from HEAD7481bfe2. TypeScript, scoped ESLint and extension packaging pass. Previous step975 baseline10 remains outside this run.
- [x] Browser: actual React queue/transport plus isolated SQLite APIs sequentially complete2 synthetic products, each prepare1/consents3/observe2/receipt row1. Source/images unchanged, errors0 and no real Hub writes. The first attempt exposed an invalid synthetic challenge TTL (two clock reads differed1ms); only the fixture was corrected. Final JSON proof and original screenshot retained; owned QA tab/server closed.
- [x] Freeze the27 reviewed files with raw HEAD auth, build/deploy Worker29853ab3-3bcc-435e-aaa9-018387ec05c1 and compare both served dashboard/2.1.92 ZIP bytes and hashes (HTTP200). Prepare the exact27-file Git whitelist; final commit/push evidence is recorded in chat outputs only after Git confirms success. No environment file copy, dependency link, applied migration or real Hub operation.
