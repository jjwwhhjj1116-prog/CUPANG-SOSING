# Step 933: reuse Vision for canonical collected role copies

## Reproduction and correction

The collector intentionally stores identical bytes under separate bare/main/additional/detail SHA-named keys to preserve image-role ownership. Vision previously treated each key as a different inference source: four canonical copies caused four provider calls. The same-key control already reused its completed result.

The route now derives at most four canonical aliases only when the requested key matches both the server-read byte SHA and actual PNG/JPEG/WebP MIME extension. The existing exact source scope and request fingerprint are unchanged. Atomic claim exclusion covers the aliases across legacy/v1/v2 policies, with a bounded maximum of 12 hashes. Completed lookup covers only the current policy's aliases, at most four hashes, and validates that every lookup hash is inside the claimed fence.

An old running or uncertain alias blocks the new request before cache lookup, even if the old file key is no longer selected. A completed result cannot bypass that request. Current owner/product/company/model/language/membership checks, original status and late-result predicates remain intact. No ledger schema migration is needed.

Each reuse finishes its own exact request with zero newly dispatched provider calls while retaining the original generation proof's `result.requests=1`. No-text and product-marking receipts are saved against the current exact key. Image bytes, edit records, per-option quotation/workspace targets and saved PNG identities are not reused or modified by this change.

## Verification

- Tracked RED: 35 passed / 10 expected failures; separate sequential case proved four actual fixture provider calls versus one expected.
- Focused regression suites: **353/353 passed** (`outputs/step933-focused.log`).
- Independent changed-suite checks: **47/47 passed**; independent reviewer found no concrete defect.
- Root separately reran the real SQL ledger suite: **14/14 passed** (`outputs/step933-root-ledger.log`).
- TypeScript, scoped ESLint and diff checks passed.
- Final combined review also found no defect. Cloudflare build and artifact validation passed; Worker `84e969c2-cc03-4a59-82b8-7cb800223f1d` deployed successfully. The frozen release's auth module matches HEAD exactly and excludes the unrelated local auth edit. No extension update is required.
- Only fixture providers/databases were used. No live AI request, product edit, file upload or Supplier Hub submission was made for this correction.

## Scope limits and browser observations

This is canonical collected-copy reuse, not general SHA-only reuse for arbitrary upload names. Different policies, languages, companies or source bytes remain separate. Atomic concurrency behavior is verified for the updated handler; old handler requests during rollout are not a live load test and may retain their old narrower behavior.

The existing Aside profile remains connected. Its YOOFAM snapshot timed out via MCP (`Runtime.callFunctionOn`) and the existing local CLI (`Page.enable`). Windows Computer Use confirmed that the clean dedicated YOOFAM tab is white after controlled refresh/re-navigation attempts. The existing Supplier Hub dashboard rendered normally on read-only tab selection. Temporary Console/Network inspection yielded no confirmed application error or usable request trace; this does not identify the white-screen cause. Other saved/dirty editors and the separate Flow window were not changed. Extension startup/message fixtures found no proven extension loop (confirmation tests 53/53 passed).

After deployment, the authenticated read-only health attempt reported that the previous Aside REPL session had ended and the replacement timed out enabling the page. Thus no fresh post-deploy product/receipt GET or UI/receipt completion is claimed. No product/Hub write or live inference was dispatched in this step.

A previously denied in-app-browser origin grant remains pending explicit permission. That connector was not retried. The socks draft still lacks verified size/material/legal facts needed for a truthful final receipt; accepted document 2347603 is preserved.
