# Stage aggregation and owned draft verification

## Deployed fixes

- A typed, positively non-admitted main/additional image request keeps its original and failed slot, then permits a different verified source to continue. Pending inference, uncertain saves, held PNGs and changed source/account/settings still stop the run. Repeated identical sources are suppressed for that invocation.
- Explicit SEO saves can initialise the native model pair for categories whose notices do not contain `품명 및 모델명`. Existing manual values and unrelated notices remain authoritative.
- Overall image-stage completion now combines independently verified manual rows with strict original-preservation receipts. It does not promote another option's manual intent or bypass saved-image review.

Worker deployment: `48670afb-453d-4ad5-b7f0-d0963ae7ee6e`.

## Actual owned socks check

- Product `865ff938-1f6e-42cd-bcfe-863cba84eb09`, offer `965495834905`, registration `261103002001`, company `A01526306`.
- Quotation revision 15 → 18: exactly 26 override leaves changed: model pair for eight options, five reviewed additional images for each option, explicit unchanged-original main selection for options 7/8. Content revision 60 and option revision 4 remained unchanged.
- Production GET confirmed SEO, pricing, main, additional, detail composition, reference size chart and Korean label save/selection stages complete. Composition completion does **not** establish image translation quality.
- Original transmission request: `f69bda85-7f5c-4e8b-90f1-9550f70d81ba`; packet digest `47814a5333bf1b8bf8b1e1fc9af7551eac80e7c2e30b41081c38c3560119e96e`.
- Read-only extension checkpoint: `validated`, sequence 15, document `2362997`, operation suffix `:validate:5`.
- Independent Supplier Hub GET returned HTTP 200, the correct title, eight options, and `UNFINISHED`. Draft listing contained one matching document. Submitted listing contained no match. This is a saved and validated **draft**, not receipt completion.
- Main/extra-image curation excluded a generated photo with visible ghosting. Direct inspection of the first detail composite still showed Chinese source text, so final submission was not continued.
- Existing accepted document `2347603` was not recreated, uploaded, updated or resubmitted.

## Remaining work and measured limitations

The original preparation completed after the web's 120-second acknowledgement listener expired. Recovering it must keep the same request/document and must not repeat creation or file writes. A local two-option adapter fixture exposed 487 source GETs, including 113 native-plan reads. Nested-read reduction is being reviewed separately; it is not part of the deployed fixes above and does not by itself guarantee a two-minute preparation.

Current BODY translation needs an explicit source-bound operation that can process the saved composition while preserving reviewed manual output, HTML, alt text and ordering. Existing manual-publish guards must not be removed merely to turn a badge green.

## Verification

Fresh root runs: image runner 114/114, explicit SEO/model suites 23/23, stage status 16/16; TypeScript, focused ESLint, production build and `git diff --check` passed. Independent reviews found no material issue in the three deployed fixes. These are focused checks, not a claim that every repository test or every COUPLUS feature has passed.

Local evidence is under `outputs/step956-live`; it is intentionally not a public product artifact. The unrelated dirty `app/chatgpt-auth.ts` was excluded from the frozen deployment.
