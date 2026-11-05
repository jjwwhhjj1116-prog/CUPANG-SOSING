# Option image-stage receipt projection

> For agentic workers: implement the parent-approved focused fix with TDD and independent review.

Goal: show an option's verified original-image preservation as complete while unproved originals remain pending.

Architecture: opt into a source-bound server projection on the option board's existing content GET. Reuse the existing receipt reader, quotation source guard and saved-content stage rules. Keep ordinary quotation views unchanged because image coordinators compare them in full.

Constraints: three existing browser GETs; no inference, provider polling, product writes or ledger changes; preserve manual values and unknown requests. Bind the projection to owner/company, product/content/options/quotation clocks and quotation fingerprint. Recheck authenticated scope and source after the receipt read.

- [x] Add a failing real receipt/SQLite → GET → option-board regression with proved and unproved originals.
- [x] Add the opt-in projection and validate its source envelope before merging image stages.
- [x] Cover changed product/content/options/settings/owner/company and malformed/stale projection responses.
- [x] Run focused affected tests, TypeScript, scoped lint and independent review; parent owns build/deploy/browser verification.
