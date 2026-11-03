# Translation and native attachment verification — 2026-11-03

Scope: the owned socks draft 965495834905, registration 261103002001. Historical accepted document 2347603 was neither recreated nor transmitted. Unrelated products and the separate working-tree authentication edit were excluded.

## Fixed behavior

- Current v2 Vision results may offer a versioned backgrounds-first rendering candidate only when every block is explicitly an overlay, the only diagnostic is overlap, and every vertical intersection is at most 3 px and 10% of the smaller box height. Source boxes and text remain intact. The browser checks the alpha of the actual rendered Korean layers and rejects colliding glyphs. Existing manual documents keep sequential rendering unless they explicitly carry `paintOrder: backgrounds-first-v1`.
- The policy survives document validation, source refresh, saved editing and recovered batch results. A refresh of the same SHA/key/role/dimensions retains the current Vision interpretation. Actual text layers are reused after their pixel checks.
- Neighboring restoration crops are grouped. All requested text masks in a group are inpainted together, preventing adjacent Chinese strokes from being sampled as a replacement background. Alpha and pixels outside the mask union remain original. The new immutable worker URL is `inpaint-worker-masks-v1.js`; the archived worker is retained.
- Native read-only attachment preparation accepts up to 64 MiB of verified unique originals, with HEAD preflight and a 10 MiB per-file bound. Legacy public exports retain 20 MiB. Large native role groups are staged through bounded frame calls, then sent in one original role POST. Document/frame identity, SHA, nonce, TTL, operation ledger and unknown-ACK no-replay behavior remain checked. Request-local buffers are viewed without retaining a second 64 MiB copy.

## Actual browser evidence

The extension manager showed 2.1.86 from the repository source folder after one reload. Its packaged ZIP is 2,178,515 bytes, SHA-256 `4c320deb58da8989588ef322d5581a7c43c61ec93c9b3c622b81f97ac3b84e08`. Final Worker deployment is `6a3a0a92-8615-43f1-abb9-022e4faaa060`.

The deployed native plan GET returned HTTP 200 and inspected 22,705,547 unique image bytes, where the previous 20 MiB gate stopped the operation. This is source preparation evidence, not an upload or receipt. The source plan still reports required reviews and legal applicability; those were not marked complete automatically.

The problematic additional image produced a Korean preview from its cached Vision result with **zero additional AI requests**. Initial boxes clipped a few source strokes. Visual inspection also exposed neighboring-mask restoration artifacts, which led to the grouped-mask correction. The inspected draft used explicit manual text/rectangle corrections; this is not proof that every image has correct automatic geometry.

After visual review, saving changed quotation revision 8 to 9. The only resolved value changed was `collected-2.additionalImages`; every previous image key remained present. Reopening restored all six manual Korean strings, rectangle coordinates and `backgrounds-first-v1`. The stored PNG was HTTP 200 with SHA-256 `06db29bf7c2c1d18cb72a053de98183ad215fb9503b07f02cb5c0d5c54a64706`. A re-render differed at three grayscale text-edge pixels (maximum channel delta 5); byte-identical re-rendering is not claimed. The new draft's native receipt history remains empty.

Private runtime receipts and image files are retained in ignored `outputs/` and Aside session artifacts. Two earlier unsaved editing tabs were preserved after automatic review rejected reloading a dirty tab. Fresh verification tabs were used instead.

## Verification

- Image integration before grouped masks: 215/215.
- Final inpaint/renderer/panel/crop/reanchor regression: 148/148.
- Native attachment/source/integration/adapter/legacy asset regression: 52/52.
- Focused inpaint tests: 13/13, including the actual bundled OpenCV worker and archived single-mask compatibility.
- TypeScript, scoped ESLint, diff checks, extension source/package checks, Cloudflare build and deployment succeeded. A separately started full-repository test run was interrupted; no full-suite success is claimed.

## Remaining acceptance work

The socks category requires a size-chart image. The 38 original detail placements and product attributes inspected contain no foot measurement or recommended shoe-size range. The attributes claim polyester 80–90%, while detail images claim cotton 85%, spandex 10%, nylon 5%. Supplier/physical-label confirmation was requested for the size and material before preparing final claims. Remaining images still require translation/visual verification; original multipart detail composition alone is not completion of image translation. No new Supplier Hub document was generated or submitted for this draft.
