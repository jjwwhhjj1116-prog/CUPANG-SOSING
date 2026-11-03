# Required size chart status correction

> For agentic workers: use subagent-driven-development for the focused implementation and review.

Goal: make the saved product and option boards agree with the existing category layout and batch runner when a required size chart is missing.

Architecture: reuse `sizeChartRequiredFromSchemaString` for the saved-content summary; retain existing saved-content completion evidence and transmission validation. Do not add another category or status store.

Scope: `app/registration-stage-status.ts`, `app/registration-content-summary.ts`, and the redundant size override in `app/components/product-option-board.tsx`.

- [x] Reproduce an actual API/SQLite fixture with required layout and blocked batch stage but an unused saved board badge; preserve the optional-category case.
- [x] Reproduce the option board overriding a server pending result.
- [x] Pass the category requirement into the existing shared summary and preserve it in the option board.
- [x] Verify required/optional cases, explicit saved chart completion, and the fallback when final quotation scope is unconfirmed: six suites 69/69 pass, typecheck and scoped lint pass (step924 logs).
- [ ] Independent review of the final saved-summary fallback and option-board status precedence.
- [ ] Build and deploy only the three runtime files from a clean snapshot, excluding the unrelated working-copy authentication change.
- [ ] Verify the real new sock draft in the browser; keep existing products and submitted document 2347603 untouched.

No collection extension update is needed for this correction. A nullable provider field is not reinterpreted here, and this status correction does not prove Supplier Hub receipt or complete visual parity.

Step924 verification: the old step923 63/64 board failure does not reproduce in the current working copy; test208 still requires the optional legacy board to show unused after removing its chart. A separate regression exposed a known required category falling back to unused when final quotation scope validation fails. The base saved-content summary now retains the same raw schema requirement before that fallback. The required case was observed red before the one-line correction; both required and optional cases now pass. Logs: `outputs/step924-required-size-{baseline,fallback-red,final,types,lint}.log`.
