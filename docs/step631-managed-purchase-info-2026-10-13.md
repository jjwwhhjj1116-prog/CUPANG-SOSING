# Step 631 — editable purchase information in product management

The new product-management page previously displayed purchase information as raw JSON. It now opens an editor for the exact current company and SKU, with purchase rows, Chinese option names, quantities, request defaults and Korean label fields. Adding, removing, cancelling and explicitly saving rows follow the observed Couplus purchase-editor pattern. Negotiated unit price and total amount remain independent literal inputs; no unsupported division formula is introduced.

## Observed contract

Read-only inspection of the current Couplus new-management module (`chunk-3a508968.eecb7b35.js`, SHA-256 `35576069a1b5d576b7c45199a3c2ed09ded15e211097bb31957d864282e2c52e`) established its add-row defaults, purchase save acknowledgement, direct price input and status dependencies. This module was obtained from the actual page's current loader; no Couplus data API was called or executed.

New rows use matching/request pending states, integrated customs, Coupang shipment/box delivery and basic inspection enabled, with the other observed request switches disabled. A link or matching-option change requires matching again. Changes to the nested request or Korean label facts restore request pending. Editing a title alone does not invalidate an unchanged completed request. These controls cannot manufacture successful matching or request registration.

## Storage and linked behavior

Explicit edits are stored in a revisioned purchase sidecar keyed by owner, approved company and SKU. The original imported workbook cells, source hash and import provenance remain unchanged, as does the independently maintained import-price ledger. Opening a declared blank or JSON-null legacy purchase cell displays an empty editable list while retaining the original literal. Missing, malformed or incompatible source data is not silently repaired.

Saving compares the current account, company, original source and sidecar version atomically, then reads back the exact result. Completed status can only be inherited once from the current matching/request facts; copying a row or supplying an ID does not create another completion proof. Uncertain responses retain the edited draft and use reads to check the result rather than issuing a repeated write. Changing the owner or company cannot redirect an open editor to a different member's SKU.

The list, sorting and column filters use the explicitly saved purchase values. Couplus's no-purchase predicate is nonempty purchase rows with every row matching-complete and request-complete; merely entering a URL does not remove a product from that filter. Export retains the original purchase column and appends separately named YOOFAM applied-purchase and saved-time columns. These backups cannot be imported as provider source data. Reimporting a real original-source workbook keeps the manual sidecar.

The existing export bounds are enforced before transferring complete records to the Worker: 5,000 filtered rows and 8MB of original JSON plus manual purchase/import data. Over-limit requests return a narrowing error and no materialized product rows. Purchase payloads also remain within the application's editable/exportable limits of 100 rows, 20,000 characters and 128KB. These are processing limits, not official Supplier Hub limits.

## Verification and remaining acceptance work

75 tests pass in seven distinct files: backend and existing product/table/import-price regressions 54, new editor and existing management UI 19, and complete local management flows for both approved companies 2. Failed, skipped and cancelled cases are zero. Before-fix diagnostics are excluded. A TypeScript error in one error-response property access was fixed with a type assertion; its generated JavaScript is unchanged. Final semantic types have zero errors; global lint has zero errors and eight existing warnings.

Actual React and the production API handler were exercised through the existing approved Chrome profile with separate local synthetic products. Editing then cancelling produced zero writes. Explicit save produced one revision and one write; reopening retained the exact link, option, quantity, unit price, total and Korean label input. Original product rows and import prices remained identical. The browser's screenshot endpoint timed out for that temporary tab, so its DOM and API proof are retained without claiming a captured native image. The temporary tab and local server were closed.

The bounded production build retains the existing Worker, database, assets binding and 18 migration files. No dependency, source-collection extension or immutable 0.2.61–0.2.63 package changes. Existing production products, drafts, settings, account assignments and Couplus work records are not edited.

This step completes purchase-editor storage and list/export linkage. Real matching/request registration, full management DB synchronization, barcode printing, the three remaining management filters, every category's defaults, and a fresh real 1688-to-Supplier-Hub receipt/SKU acceptance run remain separate unfinished work. Local test receipts and deployed asset checks are not proof of those outcomes.
