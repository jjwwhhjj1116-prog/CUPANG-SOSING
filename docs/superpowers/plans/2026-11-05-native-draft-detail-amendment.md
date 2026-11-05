# Native Draft Detail Amendment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the detail of an owned validated, unsubmitted native draft and finish the same document without recreating it or rewriting its original evidence.

**Architecture:** A separate versioned child amendment is reserved before editing. Existing BODY translation and explicit composite save produce a new exact review; the extension permits only detail deltas, appends new DETAIL files, updates the same document once, validates and hands the latest child to the existing prepared lifecycle. Original pending/checkpoint/lane remain intact.

**Tech Stack:** Existing TypeScript/React, extension ES modules, IndexedDB CAS, browser handoff, R2/D1 APIs, Node test harness. No new dependencies or authentication changes.

**Spec:** `docs/superpowers/specs/2026-11-05-native-draft-detail-amendment.md`

## Global Constraints

- No new document creation, parent pending deletion, lane release, checkpoint reset, repair-flag reuse, remote deletion, silent source rebinding or automatic retry of an uncertain write.
- Accepted document `2347603`, unrelated products, account/auth code and credentials are outside all writes.
- Preserve original packet/request/doc/body/files/checkpoint; only latest successful child can submit.
- 945 owns extension runtime/contract; 949 owns app client/storage/UI; root owns integration/live verification; 957 owns documents only. Do not revert others' changes.
- Existing user authorization covers correcting this owned draft and completing submission; this design adds an ordinary editing action, not another approval workflow.

## Review Focus

- Stage5 save remounts the transport: retain the small descriptor and recover the original packet from extension storage (Tasks1,4).
- Same-name source replacement or an outside Hub edit: fresh bytes/inventory/body checks must stop mutation (Tasks2,3).
- Lost ACK at each upload/update/validation boundary: recovery reads only and preserves operation IDs (Task3).
- An ordinary parent submit or a second tab races an active child: the durable lane/head fence wins (Tasks1,5).
- Official append expectation is not server execution proof; the artifact-qualified candidate must preserve the exact old+new inventory and label execution unconfirmed until observed (Task2).

## Files and interfaces

945 creates `extensions/supplier-hub/native-draft-detail-amendment.mjs` and `.d.mts` (exact Request/Anchor/Descriptor/Observation from spec), `native-draft-detail-amendment-store.mjs`, `native-draft-detail-amendment-receiver.mjs`, `native-draft-detail-amendment-adapter.mjs`; modifies `single-document.mjs` only for narrow atomic store/lane integration, `handoff-worker.mjs`/`handoff-content.js` for the separate command, and necessary adapter/dispatch prepared-lifecycle seams. No rewrite of the existing receiver.

949 creates `app/native-draft-detail-amendment-client.ts`, `app/native-draft-detail-amendment-pending.ts`, `app/components/native-draft-detail-amendment-panel.tsx`; modifies `supplier-hub-product-transport.tsx` and `supplier-hub-native-source-review.tsx` to retain amendment ownership across review changes. Reuse existing Stage5 tools and existing handoff/result envelope; do not add another general-purpose editor or reset control.

Public app function: `runNativeDraftDetailAmendment(request: NativeDraftDetailAmendmentRequest, signal: AbortSignal): Promise<NativeDraftDetailAmendmentObservation>`. Separate handoff type `PRODUCT_DOCUMENT_DETAIL_AMENDMENT`, command `YOOFAM_PRODUCT_DOCUMENT_DETAIL_AMENDMENT_REQUEST`. Pure shared validators are `validateNativeDraftDetailAmendmentRequest`, `validateNativeDraftDetailAmendmentObservation(value,expectedRequest?)` and `validateNativeDraftDetailAmendmentAnchor`. Public type aliases match the spec. Require actual `nativeDraftDetailAmendment:true` capability and installed version at least `2.1.88`.

### Task1 —945: immutable parent and durable amendment ownership

**Tests:** `tests/native-draft-detail-amendment.test.mjs`, `tests/native-draft-detail-amendment-store.test.mjs`.

**Interfaces:** `createNativeDraftDetailAmendmentStore(indexedDBApi)` exposes `begin(parent, amendmentId, packet)`, `read(anchor, amendmentId)`, `compareAndSet(expected, next)`; each checks parent/lane/head atomically. `createNativeDraftDetailAmendmentReceiver({adapter,store,now})` exposes `execute(request,sender)`. Begin validates the original packet and fresh validated native draft before persisting its bounded parent copy.

- [ ] Add failing tests: exact begin produces `editing`; repeated same UUID is idempotent; different owner/company/doc/parent digest, non-validated/submitted state, conflicting active child or simultaneous tab cannot claim. Original checkpoint/pending/lane are byte-identical. Lookup-based inspect returns the verified existing child or strict read-only `BeginNotFound`; no write is authorized by absence.
- [ ] Run `node --test tests/native-draft-detail-amendment.test.mjs tests/native-draft-detail-amendment-store.test.mjs`; confirm failures exercise missing behavior.
- [ ] Implement strict DTO validators/declarations, child-only CAS and lane/head reservation. Parent store claim rules remain strict and their final pre-dispatch guards reject an active child. Store no blobs/credentials and never accept UI booleans as proof. A valid begin survives original preview TTL without rewriting its timestamps.
- [ ] Re-run these tests plus `tests/supplier-hub-single-document.test.mjs`; all pass. Commit only945-owned files.

### Task2 —945: evidenced native append and exact detail delta preview

**Tests:** `tests/native-draft-detail-amendment-adapter.test.mjs` and contract tests fromTask1.

**Interfaces:** adapter supplies `inspectParent(context)`, `readCurrentReview(nextReview)`, `previewDetailAmendment(parent,newSource)` and an evidence-qualified `appendDetailFiles(context,parts)`. Receiver `preview` returns the spec Observation and preview digest; no Hub mutations.

- [ ] Add failing tests: only DETAIL/HTML/exact alt wires and resulting clock/pool changes qualify; category/profile/schema/company/ordered options/SEO/prices/settings/non-DETAIL/legal changes reject. Include malformed paths and replaced bytes under the same private key.
- [ ] Record official file-store artifact hash/range, append/list/update/validate contract and whether preserved runtime proves append. Root selected the official static append contract plus fresh exact before/after inventory checks; missing runtime history alone is not a global apply gate. Add a test that missing actual extension/artifact-backed append capability yields a specific unavailable result with `execution` allzero. Do not generate runtime evidence or remote success flags.
- [ ] Implement exact canonical comparisons using old retained packet/plan plus fresh new plan. Remote old body/full file inventory/status are read independently; preview hashes all inputs. No domain-URL or file-name fallback.
- [ ] Run focused contract/adapter tests and `tests/native-product-assets-adapter.test.mjs`; all pass. Commit945-owned files.

### Task3 —945: same-document apply and read-only uncertain recovery

**Tests:** `tests/native-draft-detail-amendment-recovery.test.mjs`, adapter tests.

**Interfaces:** `execute` handles `apply`, `inspect`, `recover`; write IDs are `${requestId}:amend:${amendmentId}:assets:DETAIL`, `:update`, and `:validate:2` through `:validate:5`. `inspect/recover` perform zero Hub mutations and may only advance proved local child state.

- [ ] Add failing tests: zero create/delete; unchanged file descriptors reused; new DETAIL bytes uploaded once; old+new inventory preserved; exact same-doc update once; ordered validation2–5. Assert old parent records and markers survive.
- [ ] Add ACK-loss tests at upload/update/every validation; source/company/session changes, old-file disappearance, duplicate file rows and outside body changes stop immediately. Unknown operation followed by another apply dispatches nothing until readback resolves it; no automatic retry.
- [ ] Implement child states and verified actual request boundaries. Use existing bounded native file transports and strict body normalization. Do not repurpose original repair/update/validation flags. Compare exact remote body/files before and after each mutating phase.
- [ ] Run all amendment tests plus `tests/native-product-draft-preparation.test.mjs`, `tests/normal-native-observation.test.mjs`; all pass. Commit945-owned files.

### Task4 —949: app bridge, descriptor and edit/remount flow

**Tests:** `tests/native-draft-detail-amendment-client.test.mjs`, `tests/native-draft-detail-amendment-ui.test.mjs`.

**Interfaces:** shared Request/Observation validators from945; app exports `runNativeDraftDetailAmendment`, `readNativeDraftDetailAmendmentPending(scope)`, `claimNativeDraftDetailAmendmentPending(descriptor)` and `assertNativeDraftDetailAmendmentCurrent(descriptor,observation,review?)`. Storage exact Descriptor shape is in spec; use existing owner/company/product scope and Web Locks patterns.

- [ ] Add failing tests: allocate UUID and persist the strict small ReservedBegin before begin; only verified begin enables editing; preserve descriptor across component unmount and new-review remount; original pending remains unchanged; corrupt/foreign descriptor fails closed; ordinary create/submit remain unavailable.
- [ ] Implement separate bridge action allowlist/correlation/timeouts/error classification through the existing handoff/result envelope. Begin sends old packet+docId; later actions send anchor+UUID, and preview/apply send new review. Lost begin ACK uses `inspect` with the twelve-key BeginLookup from ReservedBegin, adopting Descriptor only after a verified full-anchor reply. The extension retains the old packet, so app storage contains no body/images/passwords; both app record variants are at most4096 UTF8 bytes.
- [ ] Implement `저장된 문서 수정` → existing Stage5 editing → `수정 자료 확인` → `같은 문서에 수정 반영`. Fresh inspect admits the new review as amendment-only instead of clearing/replacing old pending. New UI is compact and uses current COUPLUS-style controls.
- [ ] Test stale reply/order, changed review during begin/preview, cancelled calls, missing extension capability and lost begin ACK/remount. Strict not-found never unlocks an editor or automatically replays begin. Long editing after original packet TTL keeps its original UUID/timestamps and obtains fresh current proofs. Run focused tests plus `tests/native-product-review-ui.test.mjs` and `tests/batch-selected-detail-work.test.mjs`; all pass. Commit949-owned files.

### Task5 —945 +949: latest-child prepared lifecycle and receipt

**Tests:** `tests/native-draft-detail-amendment-submission.test.mjs` plus client/UI tests.

**Interfaces:** bridge actions `review`, `confirm`, `observe` take anchor+amendmentId; only `confirm` carries existing `SingleConfirmation`. Receiver derives the latest exact packet/context from the validated child, retains original request/doc and delegates existing prepared lifecycle. Observation includes independently matched `lifecycle` and `latest` identities.

- [ ] Add failing integration tests: parent/earlier child cannot submit; unknown/failed child cannot fall back; only latest fully validated child reaches normal consent/submit once. Same request/doc are retained and current receipt API accepts the new saved source/child body identity.
- [ ] 945 adds a narrow amendment-aware context delegation; preserve ordinary source/actor/receipt guards and configured-consent rules. Never feed a new packet to ordinary create or spoof parent identity/source.
- [ ] 949 uses amendment-aware descriptor/latest/sequence verification for lifecycle and receipt saving; never call unchanged parent-pending assertions against a new child review. Existing pending remains a durable parent reservation.
- [ ] Run amendment submission tests and existing prepared-document/receipt/configured-consent regressions selected by actual callers. Commit each owner's own files; root reviews the joined diff before production.

### Task6 —root: integration, deploy and owned-document verification

- [ ] Independently review all shared DTOs/actions, append evidence, atomic parent/head ownership, no-write recovery and old-lane invariants. Reject an apply implementation whose append semantics remain unevidenced.
- [ ] Run amendment suites, affected existing tests, typecheck/lint and the repository's frozen production build. Deploy only reviewed changes; exclude unrelated auth edits.
- [ ] Freshly inspect document2362997 and original request; begin its amendment before any final-detail edits. Translate current BODY, inspect every Korean output and preserve manual photos/documents; explicitly republish reviewed composite.
- [ ] Preview the exact permitted delta, same-company original remote body/files and unsubmitted status. Apply new DETAIL files/same-document body once, verify old files remain, then fresh validation2–5. No create/delete or other product writes.
- [ ] Complete existing consent/submission with the latest successful child; independently read actual receipt. Verify same doc2362997 and original request, no duplicate, and parent+child history preserved. Do not confuse validation or ACK with actual acceptance.

Implementation may proceed within the parent's existing authorized execution. No additional plan-approval pause is inferred from this document.
