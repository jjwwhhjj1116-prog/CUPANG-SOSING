# Step887 — validate the stored document without resending it

The original offer 886034098637 / request
f29491bd-1882-456a-8a63-eec8586db6c6 / document 2347603 remains protected.
No duplicate document, body update, file upload, file deletion, Preview, native
Next or final submission was executed in this step. Actual receipt is unconfirmed.

## Official behavior and the previous diagnostic error

REA inspection of the retained official main bundle establishes a separate
`POST /sr/qvt/api/validate-step/{2..5}` operation with only `{docId,version}`.
The function does not save a draft, upload, navigate or submit. This is a server
validation operation and may change validation state; it is not described as
read-only. Official Next/Preview/Submit can save the complete document, so those
operations remain blocked on the protected original under the user's existing
no-retransmission instruction.

The server's `certificate` classification and the diagnostic's `unlinked` are
different facts. The latter only says the filename does not match the `certN-`
schema convention. Retained Step877 evidence shows three LABEL filename
references but a different image storage descriptor. Neither file contents nor
legal necessity are proved. The UI now shows server classification, filename
association, descriptor correspondence and label-reference count independently.
No certificate download endpoint was evidenced, and no endpoint was guessed.

REA validation evidence: ev_96936025b26ce0cebf6021c34efc5c48a480e8d631e4beb7e10dd47ad3fc596a.
Certificate-rendering evidence: ev_129b5c0e7d32e07430d8ef5ba652751b8efc206adbb9ba9a33c288e7f4bd0483.
Bundle SHA256: 6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11.

## Separate validation capability

Extension 2.1.72 exposes `validateSavedDocumentSteps` only for a whole-product
native adapter with the original audit and durable local storage. It runs
product information, images, legal documents and logistics in that order.
It inspects every returned server row; response row indices are not option IDs
or proof of an option count. Rejection or uncertainty stops subsequent steps.
Only sanitized column labels and fixed error categories leave the page runner.

Before and after validation the original member/company, request, document,
schema/version, source binding, checkpoint/target and raw body/image/legal
descriptor hashes are checked. The existing full audit also rechecks image
bytes. The new operation never adopts a draft, qualifies a normal continuation,
records a receipt or writes the original transport checkpoint. Existing
`currentReadRecovery` guards remain intact. A report's `registered`, `canResume`,
`submitted`, `created`, `bodyWrites` and `fileWrites` must all be false.

A separate durable attempt ledger records `requested` before each validation
POST. A missing/unknown acknowledgement remains blocked across another action,
service-worker restart or target recovery. A known result can be reused only
with the same request, packet, document and body/file/legal hashes. Active
receiver locks prevent concurrent operations for the same protected request.
An operation already executing its current validation POST may finish while
the app session changes; fresh checks suppress its result and all later stages.
Cancellation is not claimed to roll back server validation state.

The web action is explicit and needs a previously displayed full audit. That
audit is bounded to ten minutes as a correlation baseline, not authorization;
the extension independently re-audits immediately before validation. Delivered
reports still have a strict 60-second freshness boundary. The existing global
packet TTL and ordinary transport contracts were not relaxed. A missing web
acknowledgement has a separate five-minute deadline and never triggers a retry.

## Verification and release

- Final shared runner/page + actual adapter + core/dispatcher: 101 tests passed.
  Includes exact serialized payload, ordered stages, later-row errors, unknown
  ACK suppression, unchanged original state and an actual adapter session race.
- App client and UI: 148 tests passed. Includes separate capability, original
  audit/target/hash correlation, bounded historical baseline, response freshness,
  duplicate clicks, fixed private-error handling and no draft/receipt adoption.
- Additional existing extension regression: 141 passed before the added adapter
  race. These runs overlap; do not sum their counts.
- TypeScript, targeted ESLint, extension package/check, production build and
  independent extension/app review passed. No new schema migration or AI model,
  quota, billing, host permission or credential change.
- Source commit 32c3a3d2 pushed to the existing main branch.
- Worker b4804dd6-d01b-4ffb-b522-b64ff2dfcc4c deployed successfully.
- Extension 2.1.72: 116 files, 1,707,812 bytes,
  SHA256 25a0c6aba08c640b207af072f1662479265560351eadb89d328a5b6d66f33dc7.
  The actual unpacked folder was backed up, updated and all 116 hashes verified;
  permission arrays are identical to 2.1.71.
- Protected D1 scope remains 35 tables / 47 rows, unchanged SHA256
  39f1f5b9ff48173e6d68b0e8d9689aac8eb587f2fb469a0ed6b2984913a3455d.
  This does not prove remote Hub contents or receipt state.

The deployed authenticated web opened the original saved quotation and its
three-option attachment summary. Screenshot:
`outputs/step887-deployed-quotation.png`. Extension refresh to 2.1.72 was requested
after deployment and installation; actual saved-stage execution is still pending
that browser application at this writing. Do not call this a successful receipt.

## Remaining work

Use the existing qa883 / loginHub885 / reservedHub885 tabs. Do not reload Hub.
After confirmed 2.1.72 refresh, reload only YOOFAM, reconstruct the original
request/document read-only, run its full audit once, then explicitly invoke the
new saved-document stage check. Preserve all failures and uncertain attempts.
Any future body-save or consent changes require a concrete scope consistent
with the user's no-retransmission instruction; do not bypass it through native
Next/Preview or direct final registration.

The original raw body still differs in 34 known official serialization patterns.
Original detail captures still have zero source detail images; the saved two
detail images are a banner and an older short image, not a completed harvest.
This release does not claim full Couplus parity, restored source images or
actual Supplier Hub receipt.
