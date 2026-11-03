# Collected role-copy Vision reuse implementation plan

> **For agentic workers:** Use subagent-driven-development to implement and independently review this narrow correction.

**Goal:** Reuse the verified Vision result when the same collected bytes are stored as representative, additional or detail copies; prevent duplicate inference beside an unresolved alias request.

**Architecture:** Preserve exact request fingerprints, persisted source scopes and status/recovery identities. Recognize only canonical collection filenames matching the SHA and MIME of the currently server-read bytes. Broaden the existing atomic claim's exclusion to four deterministic aliases across the three existing policies (maximum 12 scopes); completed cache lookup uses only the current policy's alias scopes. No schema migration or image/output-target reuse.

**Tech stack:** Existing TypeScript route, D1 request ledger and Node fixture tests.

**Spec/evidence:** `app/collection-image.ts` creates four deterministic SHA-named variants. `outputs/role-copy-cache-red.test.mjs` reproduces three provider calls for three same-byte role copies, expected one. Existing exact scope includes owner/product/company/model/language/policy; preserve all of them.

## Constraints and review focus

- Preserve unrelated live products and accepted document 2347603; no live provider/product/Hub writes for verification.
- Leave `app/chatgpt-auth.ts` untouched and excluded from deployment.
- Canonical filename SHA AND extension/MIME must match actual current bytes. Arbitrary equal-byte keys retain singleton behavior.
- Include absent historical canonical aliases in atomic fences; never replace the stored source scope or its original status/late-result predicates.
- A completed alias never bypasses another running/uncertain alias. Keep the atomic claim before cache lookup.
- Preserve current-policy isolation, current membership, owner/product/company/model/language, exact target bindings, no-text/markings-only receipts and output identities.
- Maximum claim scopes 12 and completed lookup scopes 4; no unbounded scans or new dependencies.
- Old handler requests during rollout are not proven covered by the new handler's atomic exclusion. Do not claim a live load test or general SHA-only deduplication.

## Task 1: Bounded alias reuse and atomic request exclusion

**Own files:** `app/api/products/[id]/image-text/route.ts`, `db/image-vision-requests.ts`, `tests/workers-image-vision.test.mjs`, `tests/image-vision-requests.test.mjs`. A small pure helper in an existing appropriate image module is allowed only if needed for independently testing alias eligibility; do not create a new cache subsystem.

- [ ] Add failing real-route/ledger fixtures for sequential copies, simultaneous alias claims, legacy/v1/v2 running/uncertain rows, completed-plus-active aliases, missing historical aliases and current-policy-only completed reuse.
- [ ] Add rejection/isolation cases for SHA mismatch, MIME/extension mismatch, arbitrary/foreign keys and membership/company/product/language/config changes. Keep original request status/late-finish tests.
- [ ] Run tests RED before implementation and save the output.
- [ ] Derive at most four canonical aliases from validated bytes, keep current exact sourceScope/fingerprint, hash all policy fences for atomic claim and only requested-policy aliases for completed lookup.
- [ ] Extend validated DB list bounds and completed lookup using bounded SQL placeholders; keep membership and product predicates intact.
- [ ] Prove current-key no-text/markings receipts and no changes to image files, pixel saves or target identities.
- [ ] Run affected ledger/Vision/client/preservation and selected-runner suites, TypeScript, scoped ESLint and diff checks. Obtain independent review.

## Task 2: Release and evidence

- [ ] Record changed behavior, test results and live browser limits in a short step933 note.
- [ ] Freeze reviewed runtime sources into the existing isolated release; keep exact HEAD auth bytes. Build, deploy under prior authorization and verify read-only HTTP/storage health.
- [ ] Commit exact reviewed files and push to the already-authorized main branch. No extension update is needed.

## Execution ruling

The user has directed continuous implementation without more planning questions. This is a demonstrated duplicate-call defect within the existing automatic workflow, so proceed with the narrow compatible correction. Separate browser-connector permission remains pending; do not retry the denied connector or use it to bypass that restriction. New socks receipt still depends on verified size/material/legal facts.
