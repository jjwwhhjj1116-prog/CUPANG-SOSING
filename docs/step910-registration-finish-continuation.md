# Registration finish continuation

This change corrects three reproduced breaks in the existing Work Start → editable stages → Registration Send flow. It introduces no new provider, extension protocol, or submission retry.

## Saved Korean labels

A fresh Stage 6 run previously rendered every included option again, even when its exact current generated PNG was already linked. The actual API/SQLite/R2 fixture reproduced a failed rerun when Canvas was unavailable after six successful prior saves. The runner now uses the existing authenticated current-label reader before generating another label. It checks the complete returned current view against its own source. One changed option regenerates only its label; excluded rows and manual blanks remain unchanged. The result still says draft and asks for factual review; reusing a PNG is not legal/factual approval.

## Explicit quotation retry

The Stage 7 coordinator always selected the latest current failed AI job but only entered generation when no job existed. The public Retry action therefore could not recover a confirmed failure. The same public action now passes an explicit quotation retry intent. Only the freshly read exact whole-product terminal failure with `uncertain:false`, current source/model/execution policy and valid identity can receive one new request UUID. Ordinary starts do not rotate failed requests. Running or unknown executions retain their original recovery request. A rejected pre-dispatch account check keeps the already prepared retry UUID; a lost acknowledgement reads that new original request instead of issuing another inference.

## Pending receipt follow-up

Configured Registration Send previously stopped after positively storing the first SUBMITTED receipt. Native receipt observation is a single read, not a long poll. The original configured action now performs at most three read-only observations, spaced two seconds apart, within its 120-second request-envelope bound. Both-company actual component fixtures advance SUBMITTED at two seconds to FINISHED at four seconds without a manual query or repeated create/upload/submit. Unknown results, authentication failures, identity drift, cancellation and lost receipt-save acknowledgements stop follow-up. Healthy budget exhaustion permits closing only after the exact pending receipt is positively stored; its source/request reservation remains.

## Verification

- Root focused integration: 18 files, 416/416 tests, no failures/skips/cancellations (`outputs/step910-focused-tests.txt`).
- Final Transport suite after pacing: 127/127 (`outputs/step910-transport-final.txt`).
- TypeScript and changed-file ESLint passed; isolated Cloudflare production build and artifact validation passed.
- Four runtime files only; unrelated `app/chatgpt-auth.ts` working copy excluded from the release.
- Independent reviews covered label current-result authority, quotation retry and unknown request behavior, and exact pending receipt persistence/close guards.
- Existing live popup stages SEO, pricing, main, additional, detail, Korean label and quotation were opened and navigated without saving, running AI, uploading or transmitting. This is read-only interaction coverage, not proof of all controls or pixel parity.

## Preserved data and remaining limit

Offer 886034098637 / original request f29491bd-1882-456a-8a63-eec8586db6c6 / document 2347603 was already accepted before this release. It is not recreated, resaved, uploaded or submitted for QA. Other existing products are not modified. Extension remains 2.1.79.

Fixtures use synthetic provider/Hub responses and local storage ports. No new real source-to-final-receipt submission is claimed. The prior 1688 browser site-safety denial remains in force and was not bypassed. Complete seven-stage UI/function equivalence still requires the uncovered real interaction states and a fresh authorized real product run.
