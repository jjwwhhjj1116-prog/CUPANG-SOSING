# Bounded packaging batches in automatic Work Start

The automatic Stage 7 packaging adapter previously stopped when more than 20 included options genuinely needed packaging. It now freezes up to 200 eligible option IDs and visits disjoint batches of at most 20. A parsed abstention remains unresolved but cannot starve later options or cause an inference loop. The existing Stage 7 activity reports preparation and confirmed-save progress.

The API accepts optional `batchOptionIds` only for an all-options scope, validates all requested IDs against current included options before provider use, and binds the exact request order to the source/result proof. Existing single/all requests without that field retain their contract. The response may not propose changes outside the requested batch.

Each batch rereads and matches the previous confirmed view, then uses the existing revision/fingerprint CAS and provenance verifier. A lost save acknowledgement is recovered by an exact read; the PUT is never automatically repeated. Unknown generation/save outcomes, cancellation, account change or concurrent edits stop further requests. Complete, manually edited and excluded values are preserved. Existing shared quota and per-request provider bounds are unchanged.

## Verification

- Root focused run: 11 files, **246/246** passing, no skipped or cancelled cases (`outputs/step914-focused-tests.txt`).
- Both-company actual Stage 7 fixtures with 21 missing packages use two provider requests and two confirmed saves, reach quotation draft readiness, and project the exact values to native documents. Larger finite chunks, early/later abstention, scope/membership forgery, cancellation, concurrent edits and lost acknowledgements are covered.
- Independent server/client review found no blocker. TypeScript, changed-file ESLint, diff check and isolated production build passed.
- Four runtime files were overlaid into a clean release; unrelated `app/chatgpt-auth.ts` working copy was excluded. All four runtime source hashes matched the frozen build.
- Deployed Worker version: `980db489-7cd6-44ac-b6f5-6b32f3b9decc`. Extension remains 2.1.79; this release requires no extension refresh.
- Live read-only reload retained document 2347603's `접수확인` and the other saved product's waiting state. Current editor-stage failures/waiting values were not overwritten or represented as complete. Screenshot: `outputs/step914-live-list.png`.

## Limits

These are local API/storage/coordinator tests with synthetic provider responses, not a new real seller or Supplier Hub submission. Offer 886034098637 and accepted document 2347603 are not reprocessed, saved, uploaded or retransmitted. Live verification is read-only and checks preservation of the accepted state.

The prior 1688 browser site-safety denial is not bypassed. Fresh real collection through all seven stages and a new actual receipt remains unverified. Complex image backgrounds still require review; this release does not claim full visual/function equivalence or automatic completion of every image.
