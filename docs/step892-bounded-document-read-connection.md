# Bounded document read connection — 2026-10-31

## Actual verification

Chrome 2.1.74 was confirmed after the user's extension refresh and YOOFAM-only
reload. The original offer 886034098637, product e2f8037c-294e-45a8-b06d-58cc5909683c,
request f29491bd-1882-456a-8a63-eec8586db6c6 and document 2347603 were retained.
No new document, file/body retransmission, certificate deletion, native Next,
Preview, Save, consent or final submission was performed.

Original recovery returned the expected `update-requested` state and one legal
attachment classified as certificate. The independent whole-document audit then
failed at the audit exchange with generic `PRODUCT_DOCUMENT_BRIDGE`. It did not
produce a fresh complete audit or dispatch a saved-stage validation/retry.
Earlier console channel-closed errors are not attributed proof of this failure.

## Confirmed source gaps and changes

The actual content-script VM reproduced Chrome connection errors being collapsed
into one refresh message: invalidated context, closed response channel, missing
receiver and unknown failure. Product document calls now return fixed categories
and fixed Korean guidance. Unknown raw browser/provider text is never forwarded;
uncoded failed worker envelopes also become a fixed dispatch failure. Existing
coded business errors, uncertain mutation fences, deadlines and no-retry behavior
remain unchanged. Audit failures remain non-mutating observations.

The worker's asynchronous document handler had no operation-local lifetime guard.
Following [Chrome's official long-operation guidance](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers),
only preview, saved-target recovery, audit and saved-stage validation/retry now
use a local `getPlatformInfo` pulse every 25 seconds. It stops on completion,
failure or the existing 95/180/300-second action budget. Calls do not overlap and
API errors do not alter the underlying operation. No new permission, network
recipient, timeout, automatic retry or document write was introduced. This is
defensive connection protection, not proof Chrome termination caused the live
failure.

A local count also found 16 native-plan reads before initial reserved read-tab
creation across source refresh, preview and recovery. Independent reads already
overlap; no freshness/hash fence was removed merely to shorten this path.

## Release preparation

Extension 2.1.75: 117 files, 1,719,747 bytes, SHA256
`7f0a0b616ae1d4249d21ea423842e384c247942075bc9f1125445bd93f8d00c9`.
All installed source files match the package after a separate 2.1.74 backup;
permissions and host permissions are identical. Disk installation does not prove
Chrome execution. Manual 2.1.75 refresh is pending; YOOFAM web reload is done by
the root agent. Supplier Hub tabs are preserved. No recollection is required.

The old wire fixture omitted the already-approved search-listing host and script
from release 2.1.62. Its strict expected scope now includes that exact existing
host/script. The real manifest's permissions were not expanded.

## Final verification

- Source commit `fffcee56`; isolated production build passed with 13 runtime
  source hashes matched after text-only CRLF/LF normalization. Unrelated
  `app/chatgpt-auth.ts` working-copy metadata was excluded and preserved.
- Disjoint relevant suites: bridge/client 62 passed, worker/lifetime/wire 34
  passed, recovery UI/stage validation 121 passed. The first UI run had two old
  expectations for uncoded raw errors; updated expectations now assert fixed
  guidance and non-disclosure while retaining the original lock/recovery checks.
  TypeScript, targeted ESLint, diff and extension package checks passed.
- Worker `e28d8f24-59bb-4da2-b4ca-47f6828a0260` deployed. No schema, model,
  billing, host permission or application access changes.
- Original D1 scope: 35 tables / 47 rows, SHA256
  `39f1f5b9ff48173e6d68b0e8d9689aac8eb587f2fb469a0ed6b2984913a3455d`,
  unchanged, changedTables empty (`outputs/step892-original-scoped-final.json`).
  This is not a remote Hub body or receipt proof.
- A fresh production tab confirms download 2.1.75 and actual Chrome execution
  2.1.74. The requested 2.1.75 manual refresh is still pending. No retry of the
  failed audit or any stored-stage POST was made on this partial application.

After actual 2.1.75 is confirmed, reload only the original YOOFAM tab, reconnect
the same request/document, run the independent full audit, and then the normal
stored-stage check followed by the explicit single validation retry if eligible.
Saved-target native recovery is not required merely to run the independent audit;
do not repeatedly invoke it when its known legal-array guard remains blocked.
No passed audit or validation result can clear the no-file/body-retransmit guard
or stand in for actual Hub receipt evidence.
