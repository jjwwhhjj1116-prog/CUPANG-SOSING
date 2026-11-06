# Ten-category COUPLUS sourcing and quotation parity

User spec: read the last month of COUPLUS sourcing, select one 1688 product in each of ten distinct categories, and reproduce its generation rules across SEO, price, images, size chart, Korean label and, first of all, the full quotation. Preserve intentional N/A/reference defaults. Do not equate manually edited values or mocks with automatic parity.

## Global Constraints

- All browser control uses Aside. Existing products and completed Supplier Hub documents are never resent. Historical reference records are read only.
- New collection and isolated verification drafts are authorized. Never start existing queue items as a side effect.
- Keep exact product, option, category, company and owner bindings. Preserve original source facts and manual edits; do not erase genuine conflicting facts to make tests pass.
- Reference defaults such as 해당사항없음, 상세설명 참조, 상세정보참조 and 상세페이지 참조 have distinct scopes. Preserve exact official wire choices and distinguish defaults from verified facts.
- The reference's generated quotation projection and persisted coupangDoc can differ. Compare both. Do not reproduce a broken persistence binding merely to obtain visual equality.
- Existing uncommitted step983 stage-read performance fixes and unrelated app/chatgpt-auth.ts line endings must not be reverted or included accidentally.

## Task 1: Repair a reproduced live collection failure

Ownership: extensions/supplier-hub/page-source.mjs and narrowly related source parser/tests. No app/SEO changes, browser actions, Git changes or deployment by the implementer.

The first selected product, offer920067392251 (COUPLUS261026004001/category78255), fails the real YFS2.1.91 manual collector with 현재 상품의 속성 원문이 올바르지 않거나 서로 다릅니다. Its page has a 125570-character primary window.context carrier. Preserve its identity and source material. Find the exact parser mismatch, prove it with a failing regression derived from the real relevant structural fields, and make the smallest compatible fix. Do not strip offer identity, duplicate key, private flag, SKU or conflict checks. Private raw data stays in chat/work; commit only a minimal public source fixture if needed. All captures/browser operations belong to the parent and use Aside.

## Task 2: Match generated SEO keyword processing

Use the observed active service rules: generated SEO keeps the full candidate array, independent of the Hub150-character document prefix. Clean independent Jamo, punctuation, whitespace, exact duplicates, empty strings and terms over20characters in the same order. Hub document retains the longest whole-tag prefix joined by comma and space up to150characters; zero valid candidates retains the prior saved document. No artificial10-item generation cap. Preserve existing approved historical job contracts and manual blanks/overrides. Test actual ten-category tag arrays against the recorded native documents.

## Task 3: Match quotation generation and fallback rules

Trace and implement schema initializer defaults, common versus option-specific merge, field-level ambiguous/untranslated fallback, settings priorities and final storage bindings. Use exact official current category fields, not one category's hardcoded names. Cert defaults are template defaults; size/reference and unknown text are distinct from measured numeric logistics. Validate generated projection and persisted/export/native body together.

## Task 4: Recollect and compare ten real products

Captured references:261026004001/78255,261026003001/78261,261026001001/63016,261025003001/68182,261025002001/80746,261025001001/80034,261024003001/64546,261023011001/80715,261023010001/64446,261023009001/79716. Raw records are in the chat work/step984-reference. Recollect each URL through Aside, create separate new drafts with the correct official category and the same relevant settings/selection, run automatic generation, and compare every field/source/default and edit linkage. These copied historical examples are not authorization to resend an existing accepted product.

## Task 5: Verify and integrate

Retain focused RED/GREEN evidence, review exact changes, run affected tests/type/lint/build. Use the already authorized original branch/release workflow. Verify new runtime and compare the same live navigation/save benchmark. Only the authorized separate new target may enter actual Supplier Hub transmission; acceptance needs a saved final receipt. No mock or document number substitutes for receipt.

## Task 6: Continue the same URL row after large-source review

The active primary URL collector preserves all 324 source options but drops its acknowledged capture reference when `/source-inbox/ready` returns `PAGE_SOURCE_REVIEW_REQUIRED`. Retain only that exact fresh capture as a separate pending review state; do not mark it ready or select a past capture by URL. An explicit review ACK may promote it to the same row's ready capture only while the owner, company, row intent, category, capture fingerprint and revision still match. Continue the original collection job without another context capture or duplicate product creation.

Use the existing authenticated inbox/job reads and review contract. Confine runtime changes to the browser bridge, intake queue/panel, source-review intake helper and dashboard review handlers. Preserve old ready/query flows, official API priority, raw snapshot and per-SKU price basis. An uncertain ACK permits only original-identity reads. Test raw324 → reviewed5 → same-row creation, capture count1, selection201 rejection, foreign/stale/ABA scopes and assigned-product guards. No provider, quota, extension, database or legacy parser changes are planned.

## Task 7: Generate legal notices once for the common form

The current COUPLUS client explicitly puts all legalInfo into commonSchema and excludes legalInfo from differentiatedSchema. It generates one common notice set, chooses one source-supported representative instead of concatenating variant values, then applies that set to every option. The new curtain's six legal color values differ, causing the existing native common-form guard to reject serialization. Its schema is complete. New socks already pass native-assets200 because their category has no legal color field.

Confine the new behavior to a fresh versioned policy in quotation-ai.ts and quotation-ai-client.ts with focused tests. Preserve stored v1/v2/v3 jobs and replay hashes. Generate common legal notices once, distribute identical proposals to writable included targets, retain per-option product attributes and source/material/mandatory/NUMBER validation, and validate the single representative against selected-source color evidence. Preserve manual overrides/blanks. Do not relax the native guard or migrate existing saved entries. Verify the real six-color curtain shape against actual captured native schema; a normal new draft/adoption on the new policy replaces the earlier generated proposals after deployment.

## Task 8: Preserve the edit document from ordinary image editing

Ordinary content-role edits currently omit editDocument and immutable sidecar evidence, although the selected output is checked as a free-image result before transmission. Preserve the full document for fresh main/additional/detail edits using a new strictly typed record branch. Bind its original source, selected option image IDs, server category/company and output bytes. Keep v1 record/key/replay semantics, legacy unmarked files and the native evidence guard unchanged. Support explicit current-target reopening from the original source and recorded document; do not backfill records onto old PNGs. Verify actual API save→sidecar→selected review→reopen, selected-option scope, conflict and lost-ACK behavior.

The separate new-socks label mismatch has a normal UI remedy: preserve its common default and option blanks, explicitly advance the label render epoch without changing text, then use per-option batch PNG generation/attachment. Do not copy common text into option blanks or bypass print-plan validation.

## Task 9: Keep read-only label proof from blocking editing and navigation

The released label-reference loader publishes its three-GET proof as saving. This blocks parent text inputs, 7→8 navigation and close even after the editable label view has loaded. Separate read activity from actual saving at the producer; retain local reference request locking, the original proof reads and all write/unknown-result barriers. Keep the public onBusyChange contract used by BatchLabelDraftPanel, and publish a separate saving state if needed. No quotation seed, cache, server, schema, AI or transport changes belong to this task.

Ownership is app/components/product-label-editor.tsx plus a focused real nested React test and its test helper if required. Other source changes need a new scope decision. The parent's initial empty-view read may show loading but must not claim a write. Reference editing/dirty state, beforeSave, source and stage epochs, manual blanks, names, order, all-option save, preview/attach and fresh receipt validation remain authoritative.

- [ ] Reproduce with the actual parent and child: release the base label view, defer the reference proof, and observe disabled text and saving=true. Assert the desired text-enabled/read-saving=false behavior as the RED failure.
- [ ] Classify initial/read refresh separately from mutations and recovery. Permit ordinary parent text editing during reference reads; abort/discard stale reads using existing lifetimes. Keep actual writes, uncertain ACK recovery and reference dirty handoff locked.
- [ ] Run actual nested React races: deferred proof→manual blank/name edit, stage/source A→B→A, close/navigation during read, write saving=true, lost PUT ACK fresh recovery, and the batch public busy callback. Do not stub the reference child out.
- [ ] Run focused label/result/lifecycle tests, compare any failures with the exact frozen before source, and run full types and scoped lint. Freeze the smallest source delta for independent review; root owns live baseline, integration and deployment.

The chosen approach removes a proven UI wait without reducing proof. Dropping the three reads or sharing old PNG receipts would weaken correctness; a global callback redefinition would also break the batch handoff. Live cold measurements remain necessary before claiming a speed improvement.

## Task 10: Open the selected main-image editor from a general product workspace

When a product opens without an outer focused option, OptionMainImageEditor can select an option locally but dashboard omits translate/edit/process callbacks. The child already supplies the exact selected quotation target (optionId, mainImage slot 0, value, revisions and fingerprint). Use that validated target for this main-image entry and its complete editor/processing/result lifetime. Keep other roles' focused-option guards. Do not replace an explicit target with the outer null focus or silently retarget an open edit.

Ownership is app/components/dashboard-client.tsx and app/components/option-main-image-editor.tsx plus focused tests. These files already contain the independently approved price↔main read-sharing delta: preserve it, capture those exact hashes as before, and freeze this extra delta separately. Block local dropdown changes during editing/processing; keep existing product/company/source/profile/epoch guards, fresh target checks and current-target reopen validation. No additional server, DTO, provider, storage or AI work is required.

- [ ] Reproduce the general-product entry with the actual main component and parent callback/scope validation: select an option locally, then assert visible translate/edit/process actions and correct option/image target. Confirm the released path fails for behavior rather than module loading.
- [ ] Wire the complete captured target through editor, processing and saved-result adoption. Check both general-product entry and existing focused-option entry. Opening manual editing must not start an AI mutation.
- [ ] Verify correct selected slot/source, sibling preservation, dropdown lock, close/cancel, stale product/source/option/revision and A→B→A rejection, save/reopen linkage, and no regression of the price read-sharing/unknown-result tests. Preserve every existing trust-boundary validator.
- [ ] Run focused tests, full types and scoped lint; freeze the two-file delta and tests for independent review. Root owns all browser work through Aside and normal integration/deployment.

## Task 11: Recover late replies for the original document automatically

Actual request 569152de-5d6c-423e-90a7-12e80d5d7ef6 exceeded the app's 120-second prepare ACK wait. Its correlated successful validated reply arrived at 2026-11-06T17:04:42.265Z, after listener cleanup. The exact extension checkpoint is draft-only document 2365826, sequence 15, validated steps [2,3,4,5], with no receipt or error. Preserve this evidence; no-response is not no-send. The source design is in chat work/step984-late-prepare-reply-design.md.

The original recoverPreparedDraft also succeeded after 313.383 seconds (17:11:20.336→17:16:33.719 UTC), exceeding its 180-second ACK wait. Actual Hub GET reports document 2365826 UNFINISHED. A prepare-only hint is therefore insufficient. For a correlated late qualified recovery READ, reuse validatePreparedProductDocumentState (the existing pure parser, no dispatch), then a new current transport task's fresh() source fence and original pending/session/epoch/target/monotonic-proof checks. Extract the existing normal recovery adoption into one shared closure: both early and late reads use it. Late recovery consumes the already completed qualified READ and must never dispatch that expensive READ recursively. Do not advance confirmation/consent/registration intent from a late result.

Ownership is app/supplier-hub-product-client.ts and app/components/supplier-hub-product-transport.tsx plus their existing focused client/React tests. An optional passive observer retains the original outer nonce and full proof checks after ACK timeout, using a separate component-owned abort lifetime. The write-hint allowlist is prepareDraft, reviewPreparedDraft and confirmPreparedDraft; these late successes only reserve one existing recoverPreparedDraft read after the current task is idle. Retain the original pre-dispatch expected proof for write hints, never mint a new mutating envelope, renew a packet/consent deadline or inherit challenge/approved keys. Existing unknown UI uses this same recovery even after review/confirmation: the extension chooses navigation/consent reads or receipt GET from its durable original checkpoint, without clicking Next, confirming or submitting again. Adopt current state only after a normal fresh read validates the original identity, target, hashes and draft proof. Direct late-result adoption is limited to qualified recoverPreparedDraft and observePreparedDraft READ results with a new current fresh source fence; all other actions keep their existing late-discard behavior.

Automatic challenge expiry still stops consent authority and the original operation. If confirm was already dispatched, an explicit private abort reason and actual-dispatch marker may retain only its passive original write-hint observation until the separate observer lifetime ends. Before-dispatch expiry sends nothing. Explicit cancellation, unmount, disabled/scope/pending changes always retire the observer as well. A raw hint cannot clear the expired/error state; only the normal current authoritative READ adoption may resolve it. Test expiry before dispatch, expiry after dispatch and explicit cancellation separately.

- [ ] Write a controlled-clock actual-client/React RED: the original prepare times out unchanged, its valid late reply arrives, but no original read-only recovery is reserved. Preserve ordinary early-success read/action counts.
- [ ] Add only the nonce-bound observer and one coalesced original-read reservation. Keep current unknown/error state until fresh recovery succeeds; consume the automatic attempt before dispatch. Do not replay prepare/upload/validate/consent/submit or inherit the retired registration intent.
- [ ] Test the late qualified recovery response beyond 180 seconds: exact parser and a newly acquired current fresh source fence precede normal recovery adoption, no extra runPreparedProductDocument call occurs, and wrong identity/target/hash/sequence/epoch, current409 or expired proof preserves the blocked state.
- [ ] Test malformed/foreign/partial/error/duplicate late replies, wrong doc/body/nonce/request, active manual recovery, busy/timeout/409 without automatic retries, pending deletion/replacement, full owner/company/product/profile/version/stage/review ABA and unmount. Retire observation on early completion, current recovery success, scope exit or cancellation. Non-opted-in actions continue discarding late replies.
- [ ] Run focused client/UI regressions, full types and scoped lint; freeze for independent review. Do not extend timeouts, change extension protocols, reload workers, clear locks or modify any live record. Root/Aside continue the original live document independently.
