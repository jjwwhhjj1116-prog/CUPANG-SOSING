# Step751 — captured attributes and primary quotation review

2026-10-20 KST. Base `007a994`. Existing products and existing Supplier Hub proposals were not edited or submitted.

## Implemented

- Fixed a concrete click-collection loss: `extractPageSource` previously always returned `attributes: []`. Current-offer literal `propsList` facts now survive collection, saved source receipt, translation and stage-six label initialization. Separate attribute-only scripts are retained by the page button.
- Supported the exact recorded `window.__INIT_DATA.data['590893002003'].data.propsList` component, bound by both `globalData.offerBaseInfo.offerId` and `globalData.tempModel.offerId`. The offline recorded component's 24 attributes survive. This is a bounded supported format, not proof for every current 1688 page layout.
- Unbound shop/recommendation attributes are ignored. Conflicting identities or facts, duplicate semantic JSON keys including escaped keys, malformed fields and size/count excesses reject capture. Executable, string, comment, regex and chained-assignment representations are not interpreted as the supported envelope. No vendor script is executed.
- Made the existing legal-original editor accessible from the primary whole-product review. A save or uncertain mutation invalidates the old view and rereads the current quotation. Native pending requests, unknown/transmitted history, actor changes and active preparation prevent editing. The legal edit and native intent claim share the existing Web Lock; the native source is checked again inside the acquired lock before an intent is persisted.
- Unified extension 2.1.3 contains the capture fix. No new permissions, provider, database migration, local model or paid service was introduced. The known loaded sales-extension folder was backed up and updated; disk preparation is not confirmation that Chrome reloaded it.

## Verification

- Final single related run: **270/270** across 18 unique test files, no failed/cancelled/skipped/todo checks (`outputs/step751-final-tests.log`). Earlier focused runs are not added to this count. TypeScript, scoped ESLint, generated collector consistency and the production build passed.
- Both approved companies are tested through synthetic click capture → real source-inbox/SQLite handlers → Google-response fixtures → translated material/model → actual SEO/label edits → complete included-option native projection. Supplier facts and explicit manual blanks survive replay; no external source or Hub request occurs in this test.
- Actual existing-Chrome React/local API test saved legal applicability from unconfirmed to not-applicable (PATCH 200), reloaded the quotation (8 review notices became 7), then reopened the editor showing the saved selection. Proof: `outputs/step751-browser-qa/proof.json`; screenshot: `outputs/step751-primary-legal-review.png`. Account, product, schema, files and empty Chrome-history response are explicit fixtures. The QA bundle alone permits its isolated localhost port; shipped origins are unchanged. This is not live Supplier Hub submission evidence.
- Independent review found and resolved duplicate-key and regex-literal ambiguities, then found no remaining high-confidence issue in the changed paths.

## Remaining actual acceptance boundary

The existing Chrome showed Supplier Hub logged in as 유앤채 A01526306 and a fresh empty individual-registration form. No agreement was accepted, no source product was fetched and no document was created/submitted. The new empty verification tab was owned by this task; existing work tabs were preserved.

`SINGLE_DOCUMENT_LIVE_VERIFIED` and `PRODUCT_DOCUMENT_LIVE_VERIFIED` remain false. Required legal-original transport in the native lane and exact per-option native SKU acceptance remain unverified. The separate Excel lane is not silently substituted. No denied 1688 URL was accessed directly or indirectly. No whole-workflow completion percentage, new receipt ID or actual acceptance success is claimed.

## Release

Existing Worker deployed successfully as 049805a7-82d5-41b0-97b6-acc1cf7ff0dd. Extension ZIP: 82 files, 945934 bytes, SHA-256 ec468e14a0743064695bea68a45b5d6b5a59c425eb0b46ec92f71b0521c55162. Production first screen reloaded in the existing Chrome; no product editor was opened. The known source folder contains 2.1.3, but runtime reload has not been observed.
