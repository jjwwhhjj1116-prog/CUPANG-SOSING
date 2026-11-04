# SEO reference scroll implementation plan

**Goal:** Match the observed COUPLUS Stage 1 option-card scrolling and display-only example fallbacks.

**Architecture:** Reuse the SEO editor and generator. Scope overflow to the registration option list; keep the main form and save control outside that scroll region. Example text never populates inputs or starts requests.

**Evidence:** Ask Aside session `0rCqytqyNASGEj5I`, captures E09/E10/E15 and SEO01/SEO02; preserved renderer `outputs/step899-couplus-seo-ui-selected/01-seo-renderer.js`. Its example falls back to the configured brand, `인조가죽`, and `크로스백`. `seo-scroll-metrics.json` confirms the original inner list has max-height 400px, overflow auto and right padding 10px, inside a separately padded 20px card body.

**Constraints:** Preserve branding, manual values, blank-target execution guard, provider requests, and stored products. Never resend accepted document 2347603. Exclude unrelated dirty `app/chatgpt-auth.ts` from commits and deployment. Compare equal CSS viewports: the current YOOFAM browser zoom is 80%, COUPLUS 100%.

- [ ] Update the display-only example in `app/components/seo-workspace-generator.tsx`.
- [ ] Add an inner list in `app/components/seo-workspace-editor.tsx` and bound `.registration-workspace .seo-option-name-list` in `app/components/seo-workspace.css` to 400px with internal overflow and right padding 10px. Preserve the outer card padding.
- [ ] Run existing SEO lifecycle tests, type check, lint, and project tests; no new tests for these reversible presentation changes.
- [ ] Build and deploy a frozen release without unrelated auth changes. Verify the eight-option editor at a 1600×1000 CSS viewport: last option reachable internally, save outside the list, blank target stays blank and generation disabled, close/reopen restores stored values.

The existing first-stage Previous button is already hidden in the actual browser; do not alter navigation based on JSX alone. The conditional size-chart stage remains unchanged pending a matching reference category.
