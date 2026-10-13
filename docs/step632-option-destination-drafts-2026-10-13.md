# Step 632 — retain usable URL drafts when one option cannot be applied

A normally collected supplier SKU may have a multiline name. Google can return the same multiline structure, or a translated option can exceed the option editor's 500-character name or 200-character color/size limit. Previously, the translation could complete successfully but fail later during integrated option adoption. That single option failure blocked the otherwise usable Korean product title, description and attributes.

## Correction

The exact option binding now shares its existing destination limits with Google draft creation, v6 result validation, coverage reporting and integrated adoption. An unusable option translation is omitted from the applicable candidates, with its source and saved value retained. Normal title, description, supplier attributes and other valid options remain applicable. The omitted option remains missing coverage and requires review; it is not counted as translated or repaired by truncating, joining lines or inventing a replacement.

An older completed v6 result is filtered only in the read-only adoption plan. Its stored provider result, reviewed source and execution history remain intact. Coverage also recognizes an unusable returned option, so the initial intake finishes with review required rather than automatically requesting that same option again. Existing manual titles, descriptions, option values and deliberate blanks retain their prior precedence.

The change is restricted to valid, unique source-index bindings with a valid attribute name and a string value within the existing 2,000-character response envelope. Invalid indexes, duplicates, types or names, excessive envelopes and general-attribute control characters keep their previous hard rejection. Versions v1–v5 retain their previous validation. General supplier attributes and descriptions may still be multiline. Number evidence, copied-Chinese checks, category/owner binding and all option IDs, prices, quantities and image fields retain their prior rules.

## Verification

Before the fix, the real local collect/product/Google/preview path failed to adopt the normal SEO in all six cases: two approved companies times multiline option, 502-character option name and 201-character color. The final actual API fixtures verify normal SEO, material and another valid SKU adoption, missing option coverage, review-required intake, zero additional Google requests on replay, unchanged raw v6 history and preserved manual values/blanks. Original collection bytes, company/category, prices, MOQ and receipt state remain unchanged.

135 final tests pass in 12 distinct files without failed, skipped or cancelled cases: domain/provider/batch/partial/integrated/option regressions 79, intake/options/replay/description regressions 50, and actual two-company flows 6. Superseded before-fix and intermediate runs are excluded. An existing batch fixture previously expected a multiline bound option to be usable; its expectation now omits that option while retaining the exact request count, marker identity, normal values, description and original-input preservation checks. The original assertion was confirmed to pass against the unchanged Step631 predecessor.

The actual production `translateGoogleFree` function was also called from the local PC with two public synthetic Chinese strings. Both translated successfully with one request each. The multiline string returned `흰색\n큰 사이즈`, independently confirming that this format is a normal endpoint result. This is a real Google transport check, not a fresh real 1688 collection or a Cloudflare-hosted Google availability guarantee.

Final TypeScript has zero errors and global lint has zero errors with eight existing warnings. The bounded production build retains the existing Worker/database/assets bindings and 18 unchanged migration files. Extension code, installed extension state, dependencies and immutable 0.2.61–0.2.63 archives are unchanged. Deployment verification compares the existing product, 35 settings controls and complete saved URL draft without editing any of them.

Fresh real sourcing through a reviewed real Supplier Hub quotation receipt/SKU and exhaustive category/function parity remain unfinished acceptance work. The new purchase editor was released separately in Step631. Existing-URL fresh-context behavior, management synchronization, barcode printing and the remaining management filters are outside this narrowly reproduced draft fix.
