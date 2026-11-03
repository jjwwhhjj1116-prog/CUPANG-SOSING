# Many-option quotation save

Observed failure: the real local generation route completes 143–200-option drafts (1,001–1,400 changes), but the client and quotation PUT reject more than 1,000 changes. The 1,400-change result is below the existing result and request byte limits.

1. Retain the actual API/SQLite reproduction before fixing the inconsistent limits.
2. Derive the shared validation bound from the current unique editable schema fields and actual unique option IDs, including the common scope. Keep exact target, duplicate, value, image and barcode validation.
3. Align AI result validation with current eligible fields/options and the existing 256 KiB UTF-8 result bound. Preserve model, source clocks, manual values, sensitive-field exclusions and request identity.
4. Keep the current single atomic CAS save and full acknowledgement verification. Do not introduce chunk ledgers or partial adoption.
5. Replace the obsolete Stage 5 per-scope validation workaround with the shared single validation pass; retain its 1,206-cell regression case.
6. Verify both companies' actual local generation → client proposal → PUT → exact confirmation, plus stale, duplicate, manual, foreign, byte-limit and lost-acknowledgement cases. No external provider or Supplier Hub mutation in fixtures.
7. Review, type-check, build an isolated release excluding unrelated authentication edits, deploy and verify live read-only behavior.

Protected: existing products, accepted document 2347603 and its original request. A fresh live product choice is pending; never reuse the accepted document to demonstrate this change. Separate manual bulk copy/restore limits remain outside this normal AI save fix.
