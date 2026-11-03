# Many-option AI quotation save

The existing generator completes 143–200-option quotation drafts, while the client parser and save validator rejected more than 1,000 changes. A 200-option draft with seven generated fields produced 1,400 valid changes within the existing byte limits. This blocked normal AI review/application and the selected-work quotation stage after generation had already completed.

The shared save validator now derives its cardinality bound from the current unique editable schema fields and actual unique option IDs plus the common scope. Exact field/option identity, duplicate rejection, values, owned images and barcode validation remain in place. The AI parser uses the current eligible fields and included job scopes, retains the generator's 300 distinct-field bound, and checks the persisted result's existing 256 KiB UTF-8 limit. Sensitive fields, manual values, model policy and current source/version checks remain protected.

The save still makes one atomic CAS commit and verifies the complete acknowledgement. There is no chunk ledger, partial adoption, new endpoint, schema migration, dependency or extension update. The ordinary AI path already resets manual propagation to false, so its editor requires no change. Separate manual bulk-copy/restore limits are unchanged.

Stage 5 no longer partitions the same 1,206-cell detail/HTML/ALT plan into 201 validation groups. It uses the shared validator once, preserving exact targets and value checks.

## Verification

- The exact previous HEAD fails the two company integration cases at the old client 1,000-change guard.
- Actual local API and SQLite integration: 6/6 pass. Both companies generate, parse, plan, atomically save and confirm all 1,400 changes. Request size 110,928 bytes; resulting overrides 49,679 bytes; one CAS and revision increment of one.
- Lost JSON acknowledgement is confirmed through GET without another save or inference. Concurrent manual edits and same-revision settings drift reject with 409. Oversized request/final overrides reject with 413 and no partial state.
- AI boundary regressions cover unique fields/options, duplicate/foreign/read-only/manual/excluded targets, sensitive fields, model/source identity, 300/301 distinct fields and exact/multibyte 256 KiB result boundaries.
- Existing 1,206-cell detail regression also checks duplicate/foreign target rejection.
- Type check, changed-file lint and isolated Cloudflare build pass. The isolated release excludes the unrelated authentication working copy.

Root's wider focused run passes 381 of 383 cases. Two quotation-schema assertions about pre-existing SEO-to-detail fallback behavior fail identically against the previous HEAD, as recorded in `outputs/step919-quotation-schema-head-baseline-two-cases.log`. Their expected values are not weakened by this change.

## Live boundary

All integration products/providers are synthetic and local. No existing product, Supplier Hub document, file or body was written by these checks. Accepted document 2347603 remains protected and must not be resubmitted. A fresh live product choice is pending; these tests do not establish a new seller capture → seven automatic stages → real receipt.

Evidence: `outputs/step919-large-quotation-{red,green}.log`, `outputs/step919-large-quotation-proof.json`, `outputs/step919-focused-tests.txt`, `outputs/step919-detail-pass.txt`, and the release/build verification artifacts.
