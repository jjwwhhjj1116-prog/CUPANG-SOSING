# Durable image translation and actual provider compatibility

Scope: owned verification product865ff938-1f6e-42cd-bcfe-863cba84eb09 / registration261103002001 / offer965495834905, companyA01526306. Historical accepted document2347603 is excluded from all writes.

## Implemented

- New Vision work uses the existing Workers AI asynchronous Batch binding. One admission stores the immutable original source/configuration/language/policy and then its acknowledged provider job ID. No additional infrastructure or dependency was added.
- Pure GET lookup survives a browser reload and product revision advancement. Explicit POST polling sends only the saved provider request ID; it may settle the original request ledger but cannot create inference or modify product/image/quotation data.
- Lost submission acknowledgements remain uncertain. Matching concurrent admission is not reported as a false non-admission. Existing legacy unknown requests remain fenced; their rows are not reset.
- Retained client attempts are checked against the current product/source bytes/dimensions/language/provider policy before lookup; safe same-byte evidence may cross a revision without changing the current save target.
- The client uses an explicitly advertised transport, discovers pending work before submitting, and retains its exact attempt on interruption. Fresh source/configuration checks run before submission and rendering; existing CAS/image-apply readback remains authoritative.
- Automatic stage3/4/5 recovery distinguishes pure status reads from provider-result observations that only update the ledger. The whole-image client budget accommodates foreground batch polling without the former90-second early abort.
- Actual Qwen binding output uses `results/index`, whereas the documented example uses `responses/id`. Both are accepted only with one correctly identified member and strict inner completion validation. Mixed wrappers/indices remain rejected.
- New batch requests declare normalized0–1000 XYXY coordinates. Valid endpoints convert with floor/ceil into original-image pixels, followed by existing text, decision, bounds and overlap validation. Old pixel-coordinate results are read without guessing or repair. Synchronous legacy request behavior remains unchanged. New batch prompts explicitly request full visible glyph bounds, including antialiased edges, while excluding nearby icons, borders and physical markings. This guidance does not guarantee automatic box quality.

## Evidence and limits

The first live job52928636-f9bb-4349-931e-e51a47c99319 acknowledged provider jobb848205b-48d3-4b46-9dab-c285a6eb232c. Repeated observations retrieved this same job without resubmission. Structural diagnostics established the `results/index` wrapper; after its parser correction the job settled to a confirmed COORDINATES failure. Its original800×800 image and product data were preserved. This terminal failure was not overwritten.

A subsequent explicit inspection after that confirmed failure completed under the normalized coordinate contract: request `d530ec82-2b6e-4cee-84e2-db62a995a16e`, provider job `8703c0cb-4d0a-41a3-acb7-8ffc60e904c8`. It returned nine blocks: seven promotional overlays and two physical `SPORT` markings. The physical markings were preserved. The earlier failed request remains terminal and unchanged.

The initial Qwen overlay boxes undercovered visible glyph strokes. The first rendered PNG retained Chinese fragments and inpaint artifacts. All seven overlay bounds were manually reviewed and corrected; the existing inpaint-telea-v1 mode was retained with the corrected full-glyph bounds, preserving the product, physical markings, icons and decorative outlines. The corrected preview was visually clean. This verification required explicit manual quality correction; automatic layout and mask coverage remain unproven.

Saved-result readback showed content revision 58 and options revision 4 unchanged, quotation revision 13→14, and the owned image pool 61→62. The quotation change was limited to `overrides.options.collected-3.additionalImages` and its resolved field. Reopening the saved editor restored all seven corrected text/coordinate records and both unselected physical markings without a new inference. A page reload followed by the original job GET returned completed, nine blocks, execution.requests=0 and readOnly=true. Result and browser evidence are tracked in outputs/step944-state.json and the browser verification artifacts.

Confirmed non-admission now clears only the rejected client UUID so the next explicit source discovery can recover the winning job. Lost acknowledgments remain fenced. An automatic stage whose source revision advances while an older job stays uncertain may stop at the existing exact-source recovery guard; later explicit discovery can retrieve its completion without new inference.

The provider may queue work under load; the documented Batch API does not guarantee interactive latency. Legacy requests without provider job IDs cannot be reattached through this new API.

Before the coordinate-contract change, the affected regression run passed513/513. An earlier coordinate/provider/API checkpoint passed66/66 plus TypeScript, scoped ESLint and production build. The final affected suite passed227/227, with TypeScript, scoped ESLint, diff checks and the production build passing. Worker version0c5bd5b1-4356-43f1-b1db-e092e294027b was deployed. This is scoped verification, not a full-project green or complete seven-stage visual/receipt-parity claim.

The new socks product still requires truthful sizing and its own legal applicability confirmation. The native schema's shared missing size-chart attachment appears in eight option documents; it does not establish eight separate sizes. No FREE size, dimensions or legal exemption may be inferred from the image result or prior886 approvals. Actual Supplier Hub receipt remains incomplete.

## Primary references

- [Workers binding Batch API](https://developers.cloudflare.com/workers-ai/features/batch-api/workers-binding/)
- [Qwen3.8 model capabilities](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/)
- [Cloudflare async scheduling notes](https://developers.cloudflare.com/changelog/post/2026-03-19-kimi-k2-5-workers-ai/)
- [Qwen-Agent's normalized XYXY convention](https://github.com/QwenLM/Qwen-Agent/blob/main/qwen_agent/tools/image_zoom_in_qwen3vl.py) supports the family convention, not a guarantee about this Cloudflare model's output quality.

REA reference evidence: ev_e5bcfb319e09845d9582c6defd68ddf630af8036f12e95619cca39f7ecb2ad16 and ev_3fc8249a40ae76ed7952dd06b962e3f23198d763baf258555dead1511267fdce establish COUPLUS's awaited Gemini request, OCR request-ID lookup and completed artifact reuse in its shipped client. Server-side cancellation/rejoin behavior was not observed.
