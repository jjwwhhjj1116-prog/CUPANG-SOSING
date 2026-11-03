# Stage 7 shared option scope

The COUPLUS quotation page uses one `applyToAllOptions` setting for manual save and AI processing. Current YOOFAM has a visible unchecked save switch and a separately initialized AI scope set to all options. The header AI action can therefore request all options while the visible switch is off.

1. Retain the actual parent/child RED fixture and live read-only scope evidence before changing code.
2. Share the existing editor scope with its AI panel, preserving standalone defaults. Both scope controls must reflect the same setting.
3. Bind header actions and proposal application to the current option and scope. A stale callback may not generate/apply another scope's proposal during updates.
4. Preserve in-flight/uncertain request identity and recovery. Changing scope must not hide an unresolved request or permit a duplicate model call.
5. Verify selected-option OFF, included-options ON, both control directions, null selection, dirty/busy/uncertain guards, save behavior and standalone compatibility with the real components.
6. Review independently, build an isolated release excluding unrelated authentication edits, deploy, and verify the live scope controls without AI or product writes.

Protected: all existing products and accepted document 2347603. No collection, model call, save, upload, body update or submission will run against them. The read-only reference inspection does not authorize vendor Save/AI/Start/Submit.

Separate confirmed issue: generation can produce more than the client/save 1,000-change limit for many-option quotations. Reproduction is retained under `outputs/step918-large-quotation-reproduction.*`; bounded save/recovery work is outside this focused scope and remains unresolved.

## User steering: settings and responsiveness

Read the actual COUPLUS and YOOFAM basic settings without saving them. Trace price, brand/legal and image settings to their existing stages. Fix the independently confirmed eager quotation mount: initial SEO/other-stage entry must not start the hidden QuotationPanel's category-profile and full-quotation context reads. Mount it immediately on the first quotation visit, retain it through later tabs and refresh tokens, and separate owner/product visits. Keep existing registration-layout authority and category/source validation. Verify with the real panel/API fixture and live DOM; do not claim a measured latency improvement from request counts alone.
