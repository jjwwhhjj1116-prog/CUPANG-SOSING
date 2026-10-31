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

Release, test and production UI results are appended after final verification.
