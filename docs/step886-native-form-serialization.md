# Step886 — Supplier Hub form serialization

The original document's read-only audit identified 34 leaf differences across
three options, grouped as 11 coarse differences. This change fixes the causal
serializer mismatch for newly captured category definitions. It does not adopt
or overwrite the original document, and it does not relax exact readback checks.

## Source and observed evidence

- Official retained main SHA256:
  `6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11`.
- REA parent `ev_896f9c6962c3525ff1ab586edb52dc9b3fe34aaf0cb19a0248329f205c029443`.
  Selected schema/default code `[2852469,2855343)`, model
  `[2857628,2863804)`, faker requiredOnly `[1084892,1087560)`.
- Original captured schema, read by fixed SELECT only: 72,274 UTF-8 bytes,
  SHA256 `f675549f02d67d903a82e28ba4ba116ee1a96f7740558431b3a0ce4cbfd47e10`.
  Evidence contains structural types/counts/booleans only, not schema example
  values, business values, credentials or file names.
- `outputs/step886-original-schema-array-proof.json`: object examples/defaults
  absent; osrp and productNoticeName optional; one 15-row unexposed example with
  exact unique names/order and string-valued rows. The six affected attributes
  have no enum, dropdown or default. These facts establish the template fallback
  for this exact schema; they are not a general null/empty equivalence.

## Implementation

- `supplier-hub-native-form-projection.ts` implements the deterministic subset
  of requiredOnly, template clearing and native model serialization. Ambiguous
  examples/defaults, unsupported schema keywords, shared-value divergence and
  meaningful false/zero loss fail closed. Required fields are retained. Images
  are subsequently substituted by the existing exact private-byte pipeline.
- New live category captures receive
  `nativeSerializationPolicy: supplier-hub-native-required-form-v1`.
  Existing snapshots without this marker retain the legacy projector and its
  bytes. A policy change forks the reusable category definition; no product
  snapshot or existing transport request is migrated.
- Newly marked projections bind the policy to the exact schema SHA. The source
  fingerprint already includes the captured snapshot; body and source-plan
  digests bind the resulting wire payload. Local quotation values remain saved,
  including optional fields omitted by the native form, and review reports those
  omissions.
- The original read-only audit UI can explain the 34 known patterns for the
  exact captured schema. The raw mismatch, counts, hashes, unlinked certificate,
  registration block and no-delete/no-resume flags remain unchanged. No extension
  update or permission change is needed for this web diagnostic.

## Verification

- Policy capture/category refresh/schema regression: 63 passed.
- Native projector and related legacy/null/optional/consent/plan/review suites:
  74 passed, including private-byte substitution through source plan, compiled
  review and transport-packet validation.
- Audit diagnostic/UI/client regression: 145 passed.
- Exact captured schema + synthetic local three-option sample passes all model
  checks; no real product values or remote writes were used. This is a model
  test, not proof of actual Supplier Hub receipt.
- Additional source/transport regression: 93 passed (overlaps exist between
  runs; counts are not summed). TypeScript, targeted ESLint, production build
  and independent REA review passed.
- Deployed code 58f9b427, Worker d7e15341-95a7-4256-879e-f20a1d43a64b.
  Original-scope D1 integrity: 35 tables / 47 rows unchanged,
  SHA256 39f1f5b9ff48173e6d68b0e8d9689aac8eb587f2fb469a0ed6b2984913a3455d.
  This integrity check does not observe remote Hub state.
- Deployed authenticated UI was reloaded and the same original request/document
  was reconnected read-only. The completed full audit displayed nine images,
  one unlinked certificate, 34 known serialization patterns, zero unclassified
  displayed leaves and the unchanged 11 coarse mismatches. No new extension
  version was required. The registration block remains visible.

## Original document remains unresolved

Offer 886034098637, request f29491bd-1882-456a-8a63-eec8586db6c6,
document 2347603 remain the protected original. Nine images were compared; one
unlinked certificate remains. The exact body still differs in 34 leaves. No
new document, file upload, body update, certificate deletion, native Next,
Preview or Submit was performed in Step886. Official Next and Submit invoke
saveDraft, so the user's body-retransmission prohibition still prevents using
those buttons on the original. Receipt must not be claimed.
