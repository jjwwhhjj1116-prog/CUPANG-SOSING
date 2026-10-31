# Recovering an unequivocally unsent batch start

The selected-product automatic workflow reserved its SEO and initial quotation
generation before the final account preflight. A transient preflight failure
could send zero generation requests yet permanently block later explicit starts.

SEO has a second state layer: the actual Google/Qwen preparation and legacy SEO
generation engines publish `prepareSubmitted` before invoking the protected
transport. They can also return a readback outcome after that preflight fails.
Clearing only the outer pending marker would therefore leave the original
request unusable.

The batch wrapper now snapshots the exact original state and UUID. It restores
that snapshot and releases only its newly reserved SEO marker when the original
state was pristine, no previous uncertain SEO apply write exists, and no mutation
was handed to the transport. Both returned recovery outcomes and thrown failures
go through the same cleanup. Initial quotation generation similarly releases
only its new marker after a proven pre-dispatch failure and retains its UUID.

There is no automatic retry. A later explicit start still performs account,
company, source and revision checks. Existing submitted/unknown requests, lost or
malformed acknowledgements, manual blanks and later save uncertainty retain
their existing fences. No global SEO engine or native Hub action was changed.

## Verification and release

- Source commit `692c93a4` changes one runtime file and its focused tests.
- Six disjoint test files: 145 passed. The worker's separate 86-test batch run
  and independent 9-case review are included in that group, not extra totals.
- TypeScript, targeted ESLint, diff checks and isolated production build passed.
  Independent review found no remaining P1/P2 issue.
- Worker `232416c8-f3d0-4c8f-813a-7ff5a232d0d1` deployed successfully from the
  committed archive. The unrelated working-copy auth metadata was excluded.
- No extension bump, schema migration, model, billing or permission changes.
  The prepared extension remains 2.1.75.
- Fixed original D1 SELECT comparison: 35 tables / 47 rows, SHA256
  `39f1f5b9ff48173e6d68b0e8d9689aac8eb587f2fb469a0ed6b2984913a3455d`,
  unchanged and no changed tables. A first transient query failure was followed
  by a successful constant SELECT connection check and successful full comparison.

## Actual receipt boundary

The protected 886 product, original request and Hub document 2347603 were not
run through batch generation. No new Hub document, file/body retransmission,
certificate deletion or final submission occurred. The D1 comparison is not
proof of remote Hub contents or receipt.

Chrome still last reported extension 2.1.74 while 2.1.75 is prepared. The existing
manual refresh request remains pending. A fresh successful full document audit
and same-document stage validation are still required before any receipt claim.
The original full detail-image harvest is also not established by these tests.
