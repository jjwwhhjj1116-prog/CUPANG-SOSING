# Step 932: selected image rework and pre-save source loading

## Reproduced behavior

The coordinator tells users to select a stage to work on it again. It previously did not pass that intent to the image runner. A fresh runner with one completed saved edit and five raw photos marked all six skipped when the quotation image field was manually selected. No provider/render/save calls ran for those raw photos.

## Selected-stage correction

`reworkCurrentSelection` is enabled only for coordinator `mode === 'selected'`. It allows the shared image runner to process the current nonempty quotation slots despite manual quotation, role or option-main selection. It does not choose different photos or rebuild image arrays.

Default/full mode retains manual-selection preservation. Completed saved edit documents still open for validation and skip another inference/save. Partial edits, no-text evidence, pending inference, uncertain saves, source identities, target bindings, quotation clocks and server CAS retain their existing behavior. Empty manual fields, excluded options, protected banners and unselected roles stay unchanged.

Fresh detail work continues to use the existing BODY runner. This correction changes representative/additional processing and the retained legacy detail path; it does not establish new BODY editor UI behavior.

## Pre-save performance finding

The batch apply path loaded an authenticated source photo, hashed it, decoded its visible orientation and created a canvas, but consumed only the returned source identity. The initial render had already loaded/verified those exact pixels. The no-store server proof GET also recomputes actual source byte SHA and dimensions; the apply endpoint independently rechecks source bytes, target and clock before a guarded save.

The correction extracts that existing proof validation for pre-save use. Initial editing/rendering retains its pixel digest and orientation checks. No cached metadata replaces the current server proof. Legacy injected readers remain supported; the production automatic runner no longer injects the default pixel reader at save time.

## Verification record

- Selected-stage RED: 8 expected failures and 2 passes before production edits.
- Selected-stage focused regression: 10/10 passed.
- Independent runner/coordinator verification: 195/195 passed; no code-review findings.
- Initial broader affected set: 319/320. The failing legacy-detail integration fixture omitted the edit document returned by the real renderer. An isolated HEAD module override reproduced the same failure without changing worktree files. This is tracked separately from the selected-mode fix.
- Corrected that integration fixture to return the real renderer's edit document and to seed the same member identity/role as its existing authentication harness. No production validation was relaxed.
- Pre-save RED: 5 expected focused failures. Final focused checks: 6/6 passed.
- Combined affected client/batch/runner/coordinator/BODY/recovery/Vision/preservation/editor/workspace checks: **374/374 passed** (`outputs/step932-source-proof-green.log`).
- Root's independent selected-rework/source-proof/pre-save checks: **13/13 passed** (`outputs/step932-root-verification.log`).
- TypeScript, scoped ESLint and diff checks passed. Both independent task reviews and the final combined review found no concrete regressions. The entire repository test suite was not run.
- Cloudflare build and production-artifact checks passed. The release's auth module was explicitly verified byte-for-byte against HEAD; the unrelated working-tree edit is excluded.
- Deployed Worker version: `d47910f3-6f30-44fd-b45d-7fafc543d26d`. Authenticated post-deploy root/product/receipt GETs returned HTTP 200. The live entry changed to `/_next/static/chunks/index-DrqSxwub.js`; the owned product version stayed unchanged and its receipt count stayed zero. These are HTTP/storage observations, not a completed browser interaction or live receipt test.

## Live verification limits

Authenticated read-only GETs of the owned socks draft and its receipt endpoint both returned HTTP 200. Product version remains `2026-11-03T12:21:35.559Z`; receipt count is zero. No live product or Supplier Hub write was performed for this correction.

The existing Aside profile is connected, but the clean YOOFAM verification tab's DOM snapshot times out (`Runtime.callFunctionOn` / `Runtime.evaluate`). An attempted separate in-app-browser origin grant was rejected by automatic approval review; explicit connector authorization is pending. No alternative connector retry was used to bypass that rejection.

The socks draft still requires a verified size chart and product-specific legal-document applicability. Its conflicting material sources and remaining raw Chinese photos are not certified as complete. Historical accepted document 2347603 is untouched and must not be recreated, uploaded, resaved or resubmitted.
