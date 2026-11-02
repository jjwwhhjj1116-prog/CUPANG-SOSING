# Registration finish continuation

> **For agentic workers:** Use subagent-driven-development to implement the three independently reproduced corrections below.

**Goal:** Keep COUPLUS-style explicit Work Start, review and Registration Send usable through saved labels, failed quotation retry and pending receipt confirmation.

**Architecture:** Reuse existing current-label proof and original transmission observation. The existing public retry action alone can request a fresh quotation inference after its exact previous execution is confirmed failed. No new provider, extension protocol or background submission worker.

**Tech stack:** React, TypeScript, existing Worker/D1/R2 routes and Node test fixtures.

**Spec:** Existing user requirements and `docs/step909-automatic-work-continuation.md`.

## Global constraints

- Offer 886034098637 / document 2347603 is already submitted. No creation, upload, body save or resubmission for QA.
- Preserve other existing products and unrelated `app/chatgpt-auth.ts` working copy.
- Do not bypass the existing 1688 site-safety denial.
- Confirmed pending receipt follow-up is read-only and bounded under the same configured action.
- Missing/stale/manual/unknown evidence cannot be relabeled complete.
- Keep extension 2.1.79 unless an actual extension change becomes necessary.

## Review focus

- Fresh Stage 6 must reuse exact current option labels without requiring another Canvas render.
- Changed one-option label inputs cannot reuse that option's previous result.
- Ordinary Work Start cannot silently retry failed or uncertain paid inference.
- Lost new quotation acknowledgement must retain its new original UUID.
- Receipt observation must never retry create/upload/submit or change document identity.

## Tasks

- [x] Stage 6: reproduce current-label rerender failure, reuse existing exact current result, verify selective changed-option and excluded/manual behavior. Ownership: `app/batch-selected-label-work.ts` and focused tests.
- [x] Stage 7: reproduce explicit retry dead end; allow exact confirmed terminal failed quotation job through the existing explicit retry; verify unknown/running/lost-ACK behavior. Ownership: `app/batch-selected-work.ts`, `app/components/batch-work-panel.tsx` and focused tests.
- [x] Registration Send: reproduce acknowledged SUBMITTED stop; bounded same-request/document read follow-up; verify pending budget, identity drift, auth failure and cancellation. Ownership: `app/components/supplier-hub-product-transport.tsx` and focused tests.
- [x] Independent review and focused integration tests; type check and changed-file lint.
- [ ] Production build and deploy exact committed runtime files; preserve live existing data; inspect live UI and report actual verification limits.

## Evidence scope

Actual component/coordinator/API fixtures are isolated and synthetic. Production read-only views confirm layout and preserved receipt, not a new real collection-to-final-receipt submission. Seven-stage visual equivalence is not established by passing fixtures.
