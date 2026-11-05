# Validated native draft: detail amendment

## Outcome and scope

Translate and explicitly republish the current BODY workspace, then amend the **same still-unsubmitted, validated native Supplier Hub draft**. Keep its original request, document, packet, file inventory and checkpoint as immutable parent evidence. A separate versioned child operation owns the new detail and subsequent validation/submission.

Live acceptance target: owned socks `865ff938-1f6e-42cd-bcfe-863cba84eb09`, 1688 `965495834905`, original request `f69bda85-7f5c-4e8b-90f1-9550f70d81ba`, document `2362997`. These identifiers are acceptance evidence, never hardcoded runtime allowances. Accepted document `2347603`, unrelated products, account/auth code and credentials are outside all writes.

No new document creation, parent pending deletion, lane release, checkpoint reset, repair-flag reuse, remote deletion, silent source rebinding or automatic retry of an uncertain write. Existing user authorization covers correcting this owned draft and completing submission; this design adds an ordinary editing action, not another approval workflow.

## Existing seams

- `db/detail-workspaces.ts:181,351`: BODY application changes workspace records only; raw photo roles/order, origin keys and editable documents survive.
- `app/components/detail-workspace-composite-panel.tsx:99,178`: reviewed composite save explicitly replaces final detail/HTML/alt and backs up manual values. `db/quotation-fields.ts:198` advances quotation/product clocks.
- `app/supplier-hub-product-pending.ts:87` and `extensions/supplier-hub/single-document.mjs:186`: current requests bind immutable source/body hashes. `single-document.mjs:1009` reserves the product lane through validated/pending/accepted states.
- `native-asset-upload-page.mjs:28,99` pins the old plan/file set; `single-document-adapter.mjs:236` permits one original update. Neither is an amendment API.
- Editing changes remount `SupplierHubNativeSourceReview` and its transport. Therefore begin must persist the original packet in the extension; the app persists only a small descriptor and must not depend on an old React session surviving.

## One workflow

1. **Begin before edits.** `저장된 문서 수정` allocates an amendment UUID before dispatch. Freshly verify the original source, actor, company, exact durable validated checkpoint, same native owned document, remote old body/files and unsubmitted status. Atomically reserve one child under the existing product lane and retain the old packet/review. Begin performs no Hub mutation.
2. Persist the returned descriptor separately from the original app pending. Expose existing Stage5 BODY translation/editor/compositor. Keep normal create/submit hidden while an amendment exists. No new dashboard-wide editor-lock system: the extension's exact delta validation enforces scope.
3. Translate raw BODY photos using existing source-bound tools; preserve manual edits. Review the output and explicitly use `보관 구성으로 상세 저장` to create the new saved review. Other changed fields make the amendment invalid; they are not silently restored.
4. **Preview.** Independently read the current new review/plan and compare against the immutable parent. Permit only final DETAIL filenames, detail HTML and the exact existing alt-text wire targets changed by `detailSaveChanges`; permit their resulting clocks/fingerprints/pool additions. Owner, origin, company, product, requested/effective profile, category/schema, ordered option identities/labels/inclusion, prices, SEO, settings, MAIN/ADDITIONAL/SIZECHART/LABEL and legal data must match. Derive paths from existing exact wire descriptors; no regex/path-name guessing.
5. Re-read remote old body, full file inventory and unsubmitted status immediately before the first mutation. Any outside change stops without a write. Compute a preview digest over parent anchor, new exact review/plan, allowed delta and old inventory.
6. **Apply.** Check the same preview/new source again. Upload only genuinely new DETAIL transport names/bytes. Reuse unchanged verified descriptors, retain old files, and prove the post-upload inventory is the old inventory plus exactly the new descriptors. Never call create or deletion. Update the same `docId` once using the new prepared body and read it back exactly.
7. Validate steps `2,3,4,5` in order in the child ledger. Parent validation history remains unchanged. Every paid/provider operation remains in the existing BODY workflow; amendment itself adds none.
8. **Recovery.** Unknown upload/update/validation outcomes retain their operation IDs. `inspect` and `recover` issue no Hub mutations. Positive readback may advance the local child ledger. Only a subsequent explicit apply can continue a positively proven not-requested phase; unknown writes never replay.
9. **Submit latest.** Delegate existing prepared-document review/consent/confirm/observe using the latest successful child's source/body/identity and the original request/document. Standard parent-context submission must reject while a child is active. Parent app pending stays unchanged; amendment-aware checks and the actual receipt save bind the latest child. A failed or unknown child cannot fall back to submitting the old Chinese detail.

## Shared bridge contract (945 owns validators/declarations)

New type on existing handoff channel: `PRODUCT_DOCUMENT_DETAIL_AMENDMENT`; runtime command `YOOFAM_PRODUCT_DOCUMENT_DETAIL_AMENDMENT_REQUEST`. Capability is `nativeDraftDetailAmendment:true` with installed extension version at least `2.1.88`; a version label without the actual capability is insufficient. Do not widen ordinary `PRODUCT_DOCUMENT` packet validation. Use the existing result envelope, request correlation, bounded JSON and origin/top-frame checks.

```ts
type Anchor = {
  origin: string; ownerId: string; company: SupplierHubCompany; productId: string;
  requestId: string; docId: string | number;
  parentIdentityDigest: string; parentPacketDigest: string; parentReviewDigest: string;
  parentSourcePlanSha256: string; parentOriginalBodySha256: string;
  parentPreparedBodySha256: string; parentCheckpointSequence: number;
  parentCheckpointSha256: string;
};
type Descriptor = {
  format: 'yoofam-native-draft-detail-amendment-descriptor-v1';
  amendmentId: string; anchor: Anchor;
};
type BeginLookup = Omit<Anchor, 'parentCheckpointSequence' | 'parentCheckpointSha256'>;
type ReservedBegin = {
  format: 'yoofam-native-draft-detail-amendment-begin-v1';
  amendmentId: string; lookup: BeginLookup;
};
type Request =
  | { action: 'begin'; amendmentId: string; packet: ProductDocumentPacket; docId: string | number }
  | { action: 'inspect'; amendmentId: string; lookup: BeginLookup }
  | { action: 'preview'; amendmentId: string; anchor: Anchor; nextReview: SupplierHubProductDocumentReview }
  | { action: 'apply'; amendmentId: string; anchor: Anchor; nextReview: SupplierHubProductDocumentReview; previewDigest: string }
  | { action: 'inspect' | 'recover' | 'review' | 'observe'; amendmentId: string; anchor: Anchor }
  | { action: 'confirm'; amendmentId: string; anchor: Anchor; confirmation: SingleConfirmation };
```

UUIDs/hashes/IDs use existing validators and limits. Exact keys only. Persist `ReservedBegin` before begin dispatch (all twelve lookup keys are available from the existing session/old pending/doc); replace it with Descriptor only after a verified response. Either app storage record is at most4096 UTF8 bytes and contains no packet/body. A lost begin ACK uses `inspect` with lookup; a found child returns the normal Observation/full anchor. Not-found keeps the same UUID without editor unlock or automatic retry. The descriptor/lookup are never authority by themselves. Every action independently checks the authenticated caller, immutable stored parent, active child and current relevant source.

```ts
type Observation = {
  format: 'yoofam-native-draft-detail-amendment-v1';
  amendmentId: string; anchor: Anchor;
  state: 'editing' | 'previewed' | 'upload-requested' | 'files-saved'
    | 'update-requested' | 'updated' | 'validation-requested' | 'validated'
    | 'submission' | 'pending' | 'accepted' | 'rejected' | 'registered' | 'blocked';
  sequence: number; observedAt: number; previewDigest: string | null;
  latest: null | { reviewDigest: string; sourcePlanSha256: string;
    originalBodySha256: string; preparedBodySha256: string;
    identityDigest: string; packetDigest: string };
  validatedSteps: number[]; needsRecovery: boolean;
  capabilities: { appendDetail: boolean };
  execution: { create: 0; upload: number; update: number; validate: number; submit: number };
  readOnly: boolean; registered: false;
  lifecycle?: ProductDocumentState;
  error?: { code: string; message: string };
};
type BeginNotFound = {
  format: 'yoofam-native-draft-detail-amendment-v1'; amendmentId: string;
  anchor: null; state: 'not-found'; sequence: 0; observedAt: number;
  previewDigest: null; latest: null; validatedSteps: []; needsRecovery: false;
  capabilities: { appendDetail: false };
  execution: { create: 0; upload: 0; update: 0; validate: 0; submit: 0 };
  readOnly: true; registered: false;
};
```

Counts describe dispatches in this call, not remote success. `inspect/recover/preview/begin` always report zero Hub mutations. `registered:false` makes no SKU claim; actual lifecycle/receipt evidence retains existing typed semantics. Final `review/confirm/observe` may include the ordinary lifecycle reply, independently matched to `latest`, original request/doc and child sequence. Keep existing configured-consent/manual fallback rules; do not pre-approve new terms.

`BeginNotFound` is permitted only for lookup-based inspect after the caller/parent scope is verified and no child exists. Other commands require a full anchor. No null-anchor result grants any write or editor capability.

Exports in `extensions/supplier-hub/native-draft-detail-amendment.mjs` (+ `.d.mts`):

- `validateNativeDraftDetailAmendmentRequest(value): NativeDraftDetailAmendmentRequest`
- `validateNativeDraftDetailAmendmentObservation(value, expectedRequest?): NativeDraftDetailAmendmentObservation`
- `validateNativeDraftDetailAmendmentAnchor(value): NativeDraftDetailAmendmentAnchor`

Public type aliases are `NativeDraftDetailAmendmentRequest`, `NativeDraftDetailAmendmentAnchor`, `NativeDraftDetailAmendmentDescriptor`, `NativeDraftDetailAmendmentReservedBegin` for the corresponding shapes above, and `NativeDraftDetailAmendmentObservation = Observation | BeginNotFound`. App entry is `runNativeDraftDetailAmendment(request: NativeDraftDetailAmendmentRequest, signal: AbortSignal): Promise<NativeDraftDetailAmendmentObservation>`.

Child key binds origin/owner/company/product/request/doc/amendmentId. Store full bounded parent packet and accepted new review in extension storage, never image bytes, tokens or passwords. Atomic begin/CAS also checks the existing lane and immutable parent; at most one active child. Repeated begin with the same UUID is readback, not a second operation. Active-child pointer blocks ordinary parent writes/submit at their final trusted pre-dispatch guard, without replacing/releasing its lane. Preserve completed child revisions; no generic reset endpoint.

Long BODY translation must not expire a successfully begun amendment merely because the original packet preview TTL elapsed. Preserve original packet timestamps and verified begin evidence; subsequent commands use fresh envelopes/caller checks/current source and remote unsubmitted proofs. Do not manufacture a new original timestamp or relax ordinary new-start TTL rules.

## Remote contract evidence

Preserved official client `outputs/rea-current-file-read-20261029-static-slices/01-files-store.js`, SR bundle SHA prefix `6fc9c0fa`, UTF16 `[2878532,2879286)`: `uploadImageFiles` sends only new `additionalImageFiles` to `/draft/api/upload-images/{doc}?imageType=DETAIL`, merges returned descriptors with existing images, and uses separate deletion functions. Existing YOOFAM code uses `/sr` prefix and exact upload/list/update/validate endpoints.

This proves the shipped client's append expectation, **not an observed server append execution**. Root selected implementation against this preserved official contract with exact before/after old+new inventory fences. The evidenced static contract qualifies the conservative candidate adapter; missing historical server execution alone does not disable apply. Keep the runtime verification label unconfirmed until an actual observed result exists. Missing/mismatched artifact-backed contract or the actual extension capability blocks apply before dispatch. Do not invent a deletion/replace operation or treat the new-draft uploader's empty-list rule as an existing-draft contract. After any allowed upload, old-inventory retention is independently mandatory; a mismatch stops body update and preserves uncertain recovery state.

## Owners and acceptance

Before begin, a closed owned target may be rebound using the existing read-only saved-target action when the immutable parent is exactly `validated` with steps `[2,3,4,5]` and its original `:validate:5` operation. Preserve those historical validations and all request/body/source identities; retain the previous target/sequence in the existing recovery audit. A newly reserved dedicated tab must independently prove the same `UNFINISHED` document, full body, image/legal inventory and image bytes. This action sends no create/upload/update/validate/submit. Its page record remains an explicit current-read record with `historicalAckRecovered:false`; amendment begin accepts it only when its proof/hash exactly match the bound parent recovery audit. The pre-validation partial-update scope and its validation behavior remain unchanged.

- **945:** pure extension contract/declarations, durable child store, receiver, native amendment adapter/page boundary, extension handoff dispatch and extension tests.
- **949:** app client, small descriptor storage, transport/native-source-review integration and amendment UI; preserve descriptor across the Stage5 save/remount; app/bridge/UI tests. Do not edit extension runtime owned by945.
- **Root:** independent integration review, frozen build/deploy, real image-quality QA and same-doc acceptance. No live mutation until all source/body/file checks and append evidence qualify.
- **957:** these two documents only.

Prove no duplicate create, no unchanged-file upload/delete, one update per amendment, ordered fresh validation, read-only uncertain recovery, original lane/pending/parent immutability, active latest-child-only final submit, cross-account/option/schema/settings/body/file/concurrent-tab rejection, and remount recovery. Visually inspect all final composites for Korean translation before actual submission; a Hub validation badge does not establish translation quality.
