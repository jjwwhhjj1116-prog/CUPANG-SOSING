# Step890 — quotation recovery and the preserved document stage check

## Released automatic quotation repair

The selected batch runner previously blocked every retry once quotation AI
returned a pending result, even when the original acknowledged job later
completed. It now retains that exact job identity and reads only `GET ?jobId=`.
It does not generate a replacement request. Completed results use the existing
reviewed proposal merge and CAS save, preserving manual blanks. Missing ACK/job
identity, unknown field saves, changed account/company/source/revisions/model
or execution policy remain blocked. Related batch/panel/packaging/client tests:
116 passed; TypeScript, ESLint and production build passed. Independent review
found no P1/P2.

Source commit: `45ba2085`. The isolated web release excluded the unrelated
`app/chatgpt-auth.ts` metadata and pending extension changes. Worker deployed:
`e7a03f40-17cb-4d01-aec9-f982c81e4e32`. Its extension download remains 2.1.73.

## Actual preserved-document observation

The user applied 2.1.73 and the live connection UI confirmed that running
version. Original offer 886034098637 / product
e2f8037c-294e-45a8-b06d-58cc5909683c / registration 261024001001 /
request f29491bd-1882-456a-8a63-eec8586db6c6 / document 2347603 stayed bound.

Full audits again observed nine image files, one server-classified certificate
attachment and 34 leaf differences (11 coarse differences). All 34 match known
native serialization patterns; this does not prove value preservation or clear
the original mismatch/registration guard. The certificate descriptor fingerprint
remains 1224a36695e50c5858c7b08b5fb92851e6727151db7378d5c6b6f01eeb8f56ce.

The separate stored-document validation action returned stage 2 uncertain,
`requested:false`, `failureCode:source-changed`. Thus this actual invocation
stopped before its validation POST. It did not create a document, upload files,
save a body, change consent or submit. Evidence is retained in
`outputs/step890-stage73-result.txt` and `.png`; this is not an actual receipt.

A protected D1 SELECT-only comparison after the web deployment showed unchanged
35 tables / 47 rows, SHA256
39f1f5b9ff48173e6d68b0e8d9689aac8eb587f2fb469a0ed6b2984913a3455d,
changedTables=[] (`outputs/step890-original-scoped-final.json`). It does not
represent a remote Supplier Hub body hash.

## Reproduced extension defects and coverage

The stage page rejected an exact numeric display-category code where the audit
already accepted its lossless decimal-string representation. This was reproduced
with the actual serialized page fixture and fixed only for that header field.
Original raw body, image-list and legal-list hashes remain exact. The actual
886 wire type is not exposed in the UI, so this is a reproduced compatible cause,
not a proved attribution for its specific preflight failure.

The stage ledger also discarded a complete `requested:false` result. New proven
not-sent results now retain their evidence and permit a later explicit run to
recheck. Timeouts, cancellation, malformed replies, throws and requested/legacy
uncertain entries keep their reservations. No automatic retry or legacy clearing
was introduced by that change.

The gallery/SKU reader now supports the same element's `data-original`,
`data-original-src`, `data-lazy-src` and `data-lazyload` as fallbacks after every
existing valid candidate. Current-offer scope, CDN checks, option facts and
image roles remain unchanged. Related tests: 75 passed, including actual bundled
collector VM fixtures. This does not establish that all original 886 collection
omissions are fixed; no recollection or original draft modification occurred.

REA rechecked retained RS 1.0.88 collector artifacts rather than inventing a
remote product API. Observed scripts/description-fetch behavior and its lack of
structured packaging fields are recorded locally in
`outputs/step890-rea-rs-detail-findings.json`. This is static historical evidence;
the selected 1.0.89 directory does not establish equality of its missing collector.

## Work still required

The original transport checkpoint, body mismatch and current-read no-retransmit
guard remain intact. Actual Supplier Hub receipt and complete collection/stage
parity remain unconfirmed. Do not press native Next/Preview/Save/Submit, create a
replacement document, delete the certificate, or retransmit files/body under the
existing scope. The pending 2.1.74 release combines the collection fixes and the
separate explicitly requested, single-use validation recheck; record its final
tests, deployment and running-version observation below after release.
