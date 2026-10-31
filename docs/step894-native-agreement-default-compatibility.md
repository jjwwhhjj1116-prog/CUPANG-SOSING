# New native quotation review: saved agreement defaults

The native-required-form-v1 path rejected categories whose schema explicitly
contains `imagePage.msrpAgree` or `imagePage.labelContactAgreed` with their
compiled Couplus draft default `true`. The schema compiler and saved-value
projector accepted those booleans, but the final native serializer required
`false`. Consequently a valid saved quotation could fail before attachment
review with `SINGLE_NATIVE_SERIALIZATION_UNCONFIRMED`.

The serializer now preserves the exact saved boolean in its reviewed original.
It still rejects missing or nonboolean controls and per-option divergence,
including when a property is optional in the JSON schema. The separate existing
prepared-body path continues to set both flags to false. Only the existing
action-time terms challenge can establish human agreement. The fix neither
accepts terms nor widens an existing request's permissions.

## Verification

- Source commit `708ea65a`: one runtime file and its focused tests.
- Seven disjoint native projection/assets/review/consent test files: 39 passed.
  The worker's 26 focused tests and independent seven-case projection review
  are subsets, not additional totals.
- Actual schema-compiled default true and saved manual false both traverse the
  real projector, seven private-byte assets, source plan, compiled review and
  packet validator. Original booleans and inputs remain unchanged; validated
  prepared flags are false. Original/prepared hashes differ for original true.
- Independent review caught optional-property divergence in the first patch;
  required-list-independent equality checks and regressions close that gap.
- TypeScript, scoped ESLint, diff check and isolated production build passed.
  No remaining P1/P2 finding in the final owned diff.
- Worker `a73a44a1-d632-4b3a-b6c8-795306afdf28` deployed from the exact committed
  archive. Unrelated auth working-copy metadata was excluded. No extension,
  schema, model, billing or permission change. Existing 2.1.75 ZIP remains
  SHA256 `7f0a0b616ae1d4249d21ea423842e384c247942075bc9f1125445bd93f8d00c9`.
- Original D1 comparison: 35 tables / 47 rows, SHA256
  `39f1f5b9ff48173e6d68b0e8d9689aac8eb587f2fb469a0ed6b2984913a3455d`,
  unchanged and no changed tables. This does not prove remote Hub receipt.

## Actual protected document

Chrome still reports 2.1.74; the earlier 2.1.75 manual refresh is pending. A
fresh web reload and one read-only original-request recovery followed by one
independent full audit succeeded on 2.1.74 this time. It found the same document
2347603, nine images, one unlinked certificate-classified attachment, 34 leaf
differences and 11 grouped differences. All 34 match the known native serializer
patterns; that is not evidence that omitted original values were retained.

No new document, file/body retransmission, certificate removal, native
Next/Preview/Save/Submit or legal acceptance was performed. The protected
currentReadRecovery guards remain. Same-document stage validation is tracked
separately from receipt and never authorizes adopting the mismatched body.

The normal stage check returned the retained legacy uncertain product-stage
entry without making another validation request. The separate one-use recheck
then completed **all four actual stages**: product information, images, legal
documents and logistics, each reported passed with one validation request.
Evidence: `outputs/step894-retry-stage74-four-passed.txt` and
`outputs/step894-actual-four-stages-passed.png`. This ran on actual 2.1.74; the
pending 2.1.75 refresh is not described as a prerequisite for this observed pass.
Final actual receipt has still not been submitted or established.

A separate official tab 727940219 was opened from the existing dashboard's
`/sr/registration` link. History showed one matching heel-pad product/category;
its Load action displayed the same saved Korean title and category at
`/sr/registration/step/startPage`. No Next/Save/Preview was clicked. Retained
official bundle SHA256 `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`
and REA evidence `ev_96936025b26ce0cebf6021c34efc5c48a480e8d631e4beb7e10dd47ad3fc596a`
confirm the already-recorded contract: UI Next/Submit saves the full body;
the final `POST /sr/qvt/api/validate-single-product` sends only docId/version
but does not establish missing agreement flags. The stepper permits only
backward navigation, so current StartPage cannot reach terms without advancing
and saving. No hidden runtime or direct-final endpoint bypass was used.

The user was asked whether to amend the original no-body-retransmission scope
to allow up to five necessary same-document body saves through official final
submission, preserving document number/files and creating no replacement.
That answer is pending. Actual legal terms require a separate action-time
confirmation when their visible page is reached; none was pre-accepted here.
The approval view is `outputs/step894-official-original-start.png`.
The original three tabs and the new official read tab are retained for this
unfinished approval flow. Final D1 UI comparison remains unchanged with the
same 35-table/47-row hash (`outputs/step894-original-scoped-ui-final.json`).

The independent stage-clock inspection found no additional defect (11 focused
fixtures passed). Reused RS shipped evidence confirms frame0/script-text
collection, not a proven MAIN/frame mismatch; 32 existing collector fixtures
passed. No current 886 DOM artifact establishes its remaining detail-harvest
failure. These checks do not establish complete collection or actual receipt.
