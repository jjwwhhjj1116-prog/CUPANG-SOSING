# Durable image Vision implementation plan

> **For agentic workers:** Use subagent-driven-development for the independently owned provider, server, and client changes.

**Goal:** Finish automatic image translation without losing the provider result at the application's 60-second deadline or resubmitting an unknown inference after reload.

**Architecture:** New work uses the existing Qwen3.8 Workers AI binding's documented asynchronous Batch API. Persist the exact original bounded attempt and provider job ID; subsequent polls retrieve that job only. Keep the legacy synchronous path and its uncertain requests fenced. Product/image writes continue through existing current-source CAS and readback.

**Tech stack:** Existing TypeScript, Workers AI, D1, React, node:test. No new service or dependency.

**Evidence:** `step943-registration-automation-recovery.md`; exact model documentation and Workers binding Batch API. COUPLUS shipped client awaits HTTP translation and reuses completed artifacts; its server-side job recovery remains unknown.

## Constraints

- Preserve accepted offer886034098637/document2347603 and unrelated dirty `app/chatgpt-auth.ts`.
- Never resubmit a lost provider acknowledgment or clear an uncertain legacy claim.
- Retrieval may update the request ledger but cannot save images, product content, quotation, or Supplier Hub data.
- Reload discovery and status GET are D1-only reads; POST poll sends only a saved provider request ID.
- Rendering and application retain the fresh image source, company/member, manual-edit, and CAS checks.

## Tasks

- [x] Provider: fail-first tests for one Batch submission, bounded payload/result parsing, pending states, same-ID polling, malformed/transport uncertainty; share the existing input/result validation.
- [x] Server: persist immutable descriptor before submission and job ID before ACK; add source-bound discovery, pure status read, same-job poll, terminal replay; test real SQLite restart, scope rejection, unknown ACK and zero product writes.
- [x] Client: use explicitly advertised Batch transport; discover original work before create, poll with bounded abortable waits, recover after reload, reject changed scope/output; retain legacy transport behavior.
- [x] Verify the implementation at its recorded affected-test/type/lint/build checkpoints and prove live provider-job/result recovery with one owned verification image. Preserve unrelated auth and historical accepted data.
- [x] Complete final regression and production build verification for the current tree, verify saved-editor reopening and zero-inference same-job read after reload, and deploy the frozen authenticated release.
- [ ] Keep factual size-chart and legal applicability requirements separate from image inference; report actual receipt only when genuine native validation and receipt evidence exist.

## Live verification and remaining limits

Request `d530ec82-2b6e-4cee-84e2-db62a995a16e` / provider job `8703c0cb-4d0a-41a3-acb7-8ffc60e904c8` completed with normalized coordinates and nine blocks: seven overlays plus two physical `SPORT` markings, which were preserved. The earlier request `52928636-f9bb-4349-931e-e51a47c99319` remains a confirmed coordinate failure and was not overwritten or retried under its original identity.

The initial overlay boxes missed glyph edges, leaving Chinese fragments and inpaint artifacts. Seven region bounds required manual correction, retaining inpaint-telea-v1 with manually reviewed full-glyph bounds. The clean corrected preview and saved-result readback establish manually reviewed progress. Fully automatic image quality remains unverified.

The save advanced quotation revision 13→14 and the owned image pool 61→62; content revision 58 and options revision 4 stayed unchanged. Only `overrides.options.collected-3.additionalImages` and its resolved quotation field changed. Saved-editor reopening restored all nine records, and the original completed job survived a page reload with execution.requests=0/readOnly=true. Truthful sizing, product-specific legal applicability and actual Supplier Hub receipt remain open.

## Review focus

Lost submission acknowledgment must remain uncertain. Concurrent pollers must not create new inference or overwrite terminal results. Reload discovery must never cross member/company/product/source/model/policy boundaries. A provider result from an older revision is read evidence only until the current-source writer validates it. Legacy jobs without provider IDs cannot be recovered through the new provider polling API.

Final scoped verification:227/227 affected tests, TypeScript, scoped ESLint, diff check and production build pass. Deployed Worker0c5bd5b1-4356-43f1-b1db-e092e294027b. Extension2.1.86 is unchanged. The new socks product has no receipt; true sizing and its own legal applicability are still required.
