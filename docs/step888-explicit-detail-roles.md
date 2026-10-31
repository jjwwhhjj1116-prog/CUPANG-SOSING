# Step888 — preserve explicit detail images during collection

The trusted page-collector description merge discarded a real detail placement
when its URL also appeared as a main, additional or option image. Its deduplication
set incorrectly started with every non-detail URL. An actual bundled VM fixture
with an explicitly linked description containing only the main URL reproduced
`description: captured` with zero detail images, including when the same URL was
also observed under the DOM's product-detail section.

The merge now deduplicates only detail placements. It keeps existing non-detail
order and first-URL option indices, then appends the bound description's detail
order and remaining explicitly observed DOM details. A gallery URL is never
promoted without that independent detail observation. The existing role+URL
contract, current-offer/CDN checks, 80-image description response and 200-placement
snapshot limits remain intact. Over-limit captures fail before saving instead
of silently losing roles. Unknown delivery acknowledgements and retry snapshots
were not changed.

The injected script version is now imported from the manifest at build time.
Esbuild embeds that literal in the bundle. A previously open script keeps its
old version; it does not use the newly loaded runtime manifest as its own proof.
Lifecycle fixtures previously replaced a hard-coded `2.1.63` string while the
source had moved to `2.1.70`. They now read the manifest version, verify that the
compiled literal exists, and preserve all replacement/cancellation assertions.
An added regression verifies replacement of the old 2.1.70 host without allowing
its detached handler to read or send another capture.

## Verification and deployment

- Related nine-file regression: 121 passed, including 13 real bundled collector
  VM cases, exact placement limits, main-only explicit details, option indices,
  failed enrichment, wrong-offer/CDN rejection, old handlers and late replies.
- Independent role and build-time-version review found no additional P1/P2.
- TypeScript, targeted ESLint, extension build/check and production build passed.
- Source commit 8392cd8a pushed to the existing main branch.
- Worker 95cfb0ae-0bd8-47aa-bdac-4a6b068b10b0 deployed successfully.
- Extension 2.1.73: 116 files / 1,707,801 bytes / SHA256
  7e3bcc9c76f2d95549743af1dfd8fbe409dd69db135fa041edcf75a08ab6c118.
  The actual unpacked folder was backed up and all 116 installed hashes checked;
  permission arrays are unchanged. Backup:
  `outputs/extension-2.1.72-before-2.1.73-2026-10-31T06-15-58-432Z`.
- Protected D1 scope remains 35 tables / 47 rows, unchanged SHA256
  39f1f5b9ff48173e6d68b0e8d9689aac8eb587f2fb469a0ed6b2984913a3455d.
  Evidence: `outputs/step888-original-scoped-final.json`.

The deployed connection UI still reported running extension **2.1.71**, distinct
from the new 2.1.73 download label. See `outputs/step888-extension-running.txt`
and `outputs/step888-extension-running.png`. The manual application request now
explicitly supersedes the previous 2.1.72 request. No recollection or save was
requested on the protected original.

## Preserved original and remaining actual verification

Offer 886034098637, product e2f8037c-294e-45a8-b06d-58cc5909683c,
request f29491bd-1882-456a-8a63-eec8586db6c6, document 2347603 are unchanged by
this step. No Hub reload, duplicate creation, body/file retransmission,
certificate deletion, native Next/Preview or final registration occurred.

This defect is not proved to explain all original 886 collection omissions.
Existing detail captures remain zero and the final saved two-image detail is
not a complete source harvest. Existing documents were not retroactively edited.
Actual receipt is still unconfirmed. After extension application, follow Step887:
reload YOOFAM only, recover the same original request/document, run the full
comparison, then the separate stored-document stage validation. Keep the original
no-retransmission guard and do not infer receipt from successful validation.
