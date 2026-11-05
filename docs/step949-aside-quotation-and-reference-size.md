# Ask Aside same-offer quotation comparison and reference sizing

2026-11-05 KST. The user requested delegated Ask Aside analysis and then explicitly chose COUPLUS writing rules, including Free Size and 상세페이지 참조. The later instruction supersedes the earlier requirement to obtain actual measurements before creating any size-chart draft. It does not authorize touching unrelated products or resubmitting accepted offer886034098637/document2347603.

## Live reference observation

Ask Aside session BK5piOYFzSNiH6S5 created exactly one isolated COUPLUS comparison product261105001001 from offer965495834905 in category103689. Eight options CNY1.18 and39 detail images were visible. Only this new comparison product was modified: initialization1, unchanged numeric price-policy save1, quotation AI2, size-chart AI1. No Supplier Hub document creation/save/upload/submit or terms action occurred. The agent was stopped after reporting; no further AI retry was requested.

The result separates source listing facts, member defaults and generated values:

- Source packaging table states50g per color, modelYJW-957. These are supplier assertions, not independent measurements.
- Brand/manufacturer/importer/transaction/cartonSKU/AS initial values match member settings. Manufacturer setting differs from source seller; a seller name alone does not prove manufacturer.
- Generated quotation showed100g,150*80*20,FREE and a125-character title as model despite a50-character help limit. These are observations, not values imported into YOOFAM.
- Initial option list prices3720/6760 were0/0 in quotation until the isolated draft's price policy was saved. The first AI attempt displayed missing-price errors. Final reference quotation success/persistence was not established; the last list and option badges disagreed.
- Size-chart AI produced an original1200x632 PNG with one Free Size column and rows `사이즈: Free Size (옵션명 또는 상세페이지 참조)` and `상세 규격: 상세페이지 참조`. Its URL was then visible in the quotation size-image field. There are no numeric measurements in that result.

Original screenshots/DOM captures/report are retained under outputs/step949-reference-live, including17-comparison-registration.json,24-quotation-after-price-save.json,27-sizechart-generated-result.png,28-sizechart-generated-original-261105001001.png,29-quotation-after-sizechart.json and ask-aside-report.md. Whole existing-product inventory was excluded from the copied evidence. These are DOM-visible values; raw backend responses were not captured. Reference viewport/zoom limits are in the agent's report.

Official guides were downloaded through Supplier Hub help pages846/963 and preserved byte-identically under outputs/step949-guides. The separate page-level report is outputs/step949-guide-findings.md. Reference placeholder generation, official requirements, draft completion and actual receipt are distinct observations. The user's later chosen Free Size writing rule is implemented as a generated reference chart rather than an assertion of measured dimensions.

## Confirmed YOOFAM quotation source gap

The exact legal notice 종류 was missing from quotationKnownNoticeTarget's known saved-label mapping. Fresh initial placeholders could not receive a saved Stage6 productType even though adjacent material/dimensions fields could. The three-line mapping extension reuses the existing provenance, exact-wire, source-clock and manual-override guards. Manual values and deliberate blanks/N/A remain unchanged; this notice value does not decide certification applicability.

The eight-option103689 regression failed before the mapping and passes afterward. Parent run78/78, worker affected run74/74, TypeScript/lint/frozen build and independent review passed. Six readiness tests fail at an unchanged harness missing the existing detail-save-plan dependency; reviewer confirmed both runtime import and loader match baselinecb6cd019. A later UI-related extraction run also exposed an unchanged canvas test double lacking getContext; no OCR fix or all-tests-green claim is included here.

Intermediate mapping-only Worker3f48947f-cf17-46dc-a7b5-3ee53e9fa8f7 was deployed. The owned socks draft remained content58/options4/quotation14; its existing manual quotation kind cells were deliberately preserved. No old value was cleared to make the new source-copy rule appear to change a historical quotation.

## Free Size implementation and live verification

Implemented under docs/superpowers/plans/2026-11-05-reference-size-chart.md. Automatic required-size stage previously only returned blocked when no chart existed; it never rendered/saved the missing PNG. The approved change uses the existing atomic PNG/chart save and generated reference provenance. Exact canonical reference charts alone receive the narrow completed-size status; other generated image roles keep their existing rules. Saved charts, manual clears, manual grids and option-level quotation-image overrides stay protected.

One immutable PNG/upload attempt is retained before dispatch. A lost acknowledgement recovers by exact GET only before any subsequent selected source write; even committed recovery stops that recovery invocation. Independent review also found the initial size-save GET409 was a source conflict; only that exact GET now throws the typed source-change halt. Ordinary503 handling remains unchanged.

Validation:199 affected cases passed; final409/503/ack/coordinator focus7/7; parent's final new runner+UI22/22, existing size UI32/32, and earlier quotation78/78 passed. TypeScript, scoped lint, diff check, independent review and frozen production build passed. This is not an all-repository-tests-green claim; pre-existing readiness-loader and OCR canvas-fixture failures noted above remain outside this change.

Final Worker4aad8205-bb50-4c21-8657-dfd0861d41a4 is deployed. Served batch-selected-work-BORE04PI.js is109558bytes and byte-equal to the frozen artifact, SHA2560a51bf2a52829e5ca1f523abd96d8e2b540f56d0d53d6b7541290f3ee69672fa. Unrelated auth bytes were excluded; extension2.1.86 is unchanged.

Actual browser: only owned socks865ff938-1f6e-42cd-bcfe-863cba84eb09 / registration261103002001 was selected, size-chart-only work was started once. Content58→59 gained the exact reference table and one generated PNG; option model/revision4, all quotation overrides/revision14 and every other content field compare equal. Image pool62→63 is the single PNG append. All8 included quotation rows resolve that PNG and have no size-field validation errors. Product and option size badges show complete; reopening the editor shows the saved result, download and rewrite controls. The original generated1200x454 PNG was read successfully and visually inspected.

Native read-only review changed from9hard errors (8size+1legal) to1legal-applicability error. No legal applicability selection was changed and no new Supplier Hub transmission/receipt was claimed. Automatic full-image glyph quality remains separate unfinished work. Historical accepted886/document2347603 and unrelated products were not written.

Live evidence: outputs/step950-live/{before.json,after.json,verification.json,reference-chart.png,size-workspace.png,native-after.txt,deployed-coordinator.js}. A first whole-options DTO equality check correctly noticed the advanced product-version metadata; the final verification compares the unchanged stored option model and independently checks source metadata/one appended image.
