# Manual image cleanup and quotation review

## Corrected boundary

Stages 3–4 can stop automatic cleanup on a complex background and open the existing editor for manual review. Previously, an explicitly selected erase operation could render and save successfully while its initial Vision style warning remained in the immutable edit document. The exact selected output then failed native asset review with `FREE_IMAGE_TRANSLATION_UNRESOLVED`.

Only a successful renderer result for a main/additional quotation image now clears complete, known style diagnostics on selected erase regions. This happens after painting, PNG encoding, cancellation and output-size checks. The caller's regions/history and original files remain unchanged. Unselected regions, provider/unknown diagnostic fragments, text replacement operations and Stage 5 quotation/workspace documents keep their diagnostics. Automatic cleanup's background/overlap checks remain strict.

The API, immutable sidecar reader, source clocks, document/PNG hashes, CAS adoption, recovery protocol and Supplier Hub transmitter were not changed. No historical output is upgraded; the result goes through the existing explicit save and exact recovery checks.

## Verification

- The initial RED fixture reproduced all four company × main/additional cases with native-plan rejection after an otherwise successful image apply (`outputs/step917-manual-erase-red.log`).
- Root frozen-source run: **243/243 passed**, 11 files, no skipped/cancelled cases (`outputs/step917-focused-tests.txt`). This includes the new 10-case suite, image document/read/apply guards, automatic cleanup, native asset integration and normal transport UI fixtures.
- The new suite crosses the actual renderer, image-text GET/POST apply, stored edit document, independent edit-review reader, native asset plan and product packet validator. Original R2 bytes and unrelated required-field errors remain exact. It also covers unknown/provider/unselected issues, Stage 5, rendering/encoding failure, cancellation, stale source/slot/revision, failed dispatch and a committed apply with lost ACK followed by read-only exact recovery.
- Independent review found no blocker and reran eight positive/negative cases. Worker adjacent suites passed 68/68. These overlap the root run and are not added to its count.
- Root TypeScript, changed runtime/new-test ESLint, diff check and isolated production build passed. Both frozen runtime hashes matched the release; unrelated `app/chatgpt-auth.ts` was excluded.

## Deployment and live check

- Worker version: `91ca4376-2847-486d-a04d-879894b3da02`.
- Web-side change only; no new extension version or permissions.
- Live reload preserved registration 261024001001 / document 2347603 as `접수확인`, with the current editor's main-image error/additional waiting state still truthful. No existing product, file, body, receipt or external document was changed. Screenshot: `outputs/step917-live-list.png`.
- The installed extension still reported 2.1.79 at this turn's read. Collector 2.1.80 was prepared previously; its active reload/real capture remains unconfirmed. No repeat reload request was issued.
- An outputs-only browser pixel fixture was prepared, but Chrome timed out connecting to its loopback server. Browser pixel verification of that fixture was not completed; the owned server was stopped. It is not counted as a passing browser test.

## Coverage limits

Local API/renderer/packet fixtures establish the corrected review handoff, not a fresh seven-stage product submission. The existing accepted document was not resubmitted. Fresh permitted seller collection, full automatic processing of a new real product and a new actual receipt remain to be verified. This release does not claim complete seven-stage visual or functional equivalence with COUPLUS.
