# Automatic stage-to-quotation consistency — 2026-10-31

The protected offer 886034098637, original request
f29491bd-1882-456a-8a63-eec8586db6c6 and Hub document 2347603 remain unchanged.
No replacement document, body/file retransmission, certificate deletion or final
submission is authorized by this source work.

## Confirmed defects and fixes

- Image preparation reserved `pending:mainImage` before its account preflight.
  If preflight failed, no POST or image operation occurred, but a later explicit
  action was blocked forever. Preparation now tracks the actual dispatch boundary
  and releases only an unequivocally unsent reservation. Dispatched requests,
  lost/invalid acknowledgements and post-dispatch company changes remain fenced.
- Saved stage-two recalculation could report completion even after a manual
  quotation edit set supply to 6000 and sale to 5000 in a schema requiring sale
  to cover supply. Completion now checks the exact effective primary amounts,
  using the quotation scalar decoder, before accepting the recalculation intent.
  Equal/higher sale values and schemas without that relationship retain their
  existing behavior. Status reads never repair or rewrite the prices.
- A saved stage-six material override could differ from the earlier collected
  material while stage seven kept the earlier automatic value. Deterministic
  source proposals now recognize an explicit active saved label override only
  when the prior automatic content value still matches exactly. Quotation manual
  values, including blanks, and excluded options remain protected. This does not
  widen the AI model's field permissions.
- The connection dialog now separates browser-local image text removal/background
  restoration from optional external image generation configuration.

## Verification boundaries

Regression fixtures use local SQLite, mocked network/model responses and actual
handlers. They do not establish a real Hub receipt or complete 886 detail-image
collection. The 2.1.74 extension files are already prepared; the latest observed
Chrome execution remains 2.1.73, so the new same-document validation retry has
not been executed. The original legacy uncertainty and raw-body mismatch remain
blocked. Native Next/Preview/Save/Submit are not used under the no-retransmit scope.

## Release verification

- Source commit: `5c0c2130`.
- Workflow/image/dashboard suites: 219 passed. Registration status suites: 21
  passed. Quotation known-source/client/API suites: 53 passed. These are disjoint
  test-file groups; the earlier 81-test image review is included in the 219.
- TypeScript, targeted ESLint, diff check and isolated production build passed.
  Independent reviews of each behavioral change found no remaining P1/P2 issue.
- Worker `5a7aa965-6481-4a73-8d2b-f527d8b9b8eb` deployed successfully. The first
  sandbox DNS failure was resolved by the same authorized deployment with network
  access. No schema, billing, AI model or extension-permission changes.
- The isolated release came from the exact source commit and excludes the
  unrelated working-copy auth metadata change. All six runtime source files match
  after CRLF/LF normalization limited to those TypeScript files. The archive's
  2.1.74 extension ZIP retains SHA256
  `b5ff00d6bf2d897680edfed72948b052a7a9a2ff13067771e4642f7cba847cc3`.
- Fixed original D1 SELECT: 35 tables / 47 rows, SHA256
  `39f1f5b9ff48173e6d68b0e8d9689aac8eb587f2fb469a0ed6b2984913a3455d`,
  unchanged, changedTables empty (`outputs/step891-original-scoped-final.json`).
  This is not evidence of unchanged remote Hub contents.
- A fresh production tab confirms the corrected image-processing descriptions
  and actual running extension 2.1.73 versus prepared download 2.1.74. No new
  document validation POST, file/body write, native action or receipt claim.

The original three workflow tabs remain available. The 2.1.74 manual refresh
question remains pending; no additional extension version or recollection is
required for the next same-document validation check.
