# Step 630 — detail image composition and packaging review

Couplus's previously recorded `saveDetailPage()` builds an 800px page in top-image, ordered body-image and bottom-image order, then converts that page into one physical detail image. YOOFAM PLUS previously exported each selected image separately and lacked the corresponding composition action. A 32-image local fixture also exceeded the final quotation's 30-image limit.

## Detail image composition

The detail editor now offers a preview followed by explicit adoption into the selected option's quotation. It reads the saved selection in its current order, renders an 800px-wide white-background PNG with native browser Image and Canvas, and verifies the source bytes before and after rendering. Source files, common roles, other options and manually entered HTML or blanks remain unchanged. In the captured Couplus code, a successful composition clears its generated HTML field; this implementation preserves explicitly authored HTML and shows that it will still be exported. Full Couplus parity is not claimed for that difference.

The preview performs no upload or product write. Adoption verifies a durable physical PNG receipt, appends the file to the owned pool, and saves only the selected option's exact linked detail-image fields with current source and revision checks. Lost responses are reconciled with reads; resuming requires a further explicit click. The editor remains locked while a write result is uncertain. Closing the preview does not remove original or already stored files.

The local rendering limits are 10MB per file/output, 30MB of source data, 16,000px per dimension and 40 million pixels. These are application processing limits, not assertions about official Supplier Hub limits. Existing PNG/JPEG/WebP/GIF header dimensions are checked before decoding; formats without a known header dimension retain the browser-decode check. Existing legacy references to the same image in two positions remain visible, and deleting one position now removes only that position.

## Manual packaging after a quantity change

A directly entered package weight or dimensions could remain usable after the option's units-per-pack changed. The literal value now remains intact while that affected row requires explicit review for its current quantity. The editor can stage the same value through “현재 구성 포장값 확인·저장”. Only an explicit physical-field save creates the category-scoped quantity proof, atomically with the existing overrides. Other fields, image saves, reset handling and source-option packaging metadata keep their prior meaning.

The proof binds the exact field definition, manual literal and covered option quantities. A newly added option is not covered by an older common proof. Ambiguous/nonphysical fields are not stamped. Legacy documents without this optional proof retain their former behavior and identity; opening them does not invent a confirmation or migrate their values. Refreshing an unsaved same-value review keeps that draft; a physically saved result can acknowledge an uncertain response only when its proof matches.

## Verification and boundaries

Final checks cover both approved companies with local API handlers, SQLite-backed state, physical PNG bytes, generated XLSX/ZIP, explicit consent choices, one local transmission dispatch and receipt/SKU readback. Native Chrome Canvas is also exercised in the existing approved browser profile against a separate localhost fixture. Its 800×360 output preserves the exact top/body/bottom pixel order with no API write and unchanged source database/files.

203 tests pass across 13 distinct files without failed, skipped or cancelled cases: composition 16, image regressions 26, packaging/editor/API 131, single-SKU transmission 2, and export/legacy identity regressions 28. Superseded diagnostics and before-fix runs are excluded. TypeScript has zero errors; global lint has zero errors and eight existing warnings. The bounded production build checks the existing Worker/database bindings and 18 unchanged migrations.

Regression fixtures simulating pre-deployment documents remove new confirmation metadata before comparing old identities. Four old tests also failed against the unchanged Step630 predecessor: their reconstructed identities predated the template-aware schema inputs. Their baseline now uses that actual predecessor and the real template inputs. Later explicit saves include their real quantity proof in reconstructed edit identities. The original stale-fingerprint rejection, raw-value validation and historical receipt-byte preservation assertions remain.

The actual Supplier Hub bulk form was read without changing existing user tabs or submitting files. Its file roles, legal-document choice and two agreement controls match the existing transmission contract. Existing production products, drafts, settings, quotations and account/company assignments are not edited. The existing extension and immutable 0.2.61–0.2.63 packages are unchanged. No schema migration or new dependency is added.

Fresh real 1688 collection through a reviewed real Supplier Hub receipt/SKU, every category's defaults and full product-management parity remain open acceptance work. Local fixture receipts and deployed UI checks do not establish those outcomes.
