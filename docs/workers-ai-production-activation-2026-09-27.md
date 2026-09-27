# Workers AI production activation — 2026-09-27

The existing Chrome Cloudflare session was recovered with its prefilled sign-in form. The account's Workers plans screen showed Free with Current plan, and Paid with Upgrade. No plan change was made.

Production build input `.env.production.local` now includes `SOURCEFLOW_TEXT_PROVIDER=workers-ai`. Existing deployment configuration emits AI binding, model `@cf/meta/llama-3.1-8b-instruct`, and output limit 4096. No OpenAI key is required for this provider. Keep this opt-in input when rebuilding; do not put credentials in tracked configuration.

Official pricing checked: https://developers.cloudflare.com/workers-ai/platform/pricing/ — Workers Free includes 10,000 neurons daily and further operations fail after its limit. Paid plans have different overage behavior. Current plan was verified in the account UI; no assertion that future account plan changes are automatically detected.

Validation: 26 translation/configuration tests, TypeScript, production build and artifact checks passed. Deployed version `15b1b361-cf27-4855-896f-72b9b10f0fff`. Existing Chrome Cloudflare OAuth opened the authenticated production YOOFAM PLUS UI successfully; it displayed zero products for the active owner.

A synthetic live-generation smoke attempt via Wrangler remote binding could not start because the application's Cloudflare Access requires a service token in noninteractive mode. No AI response was obtained, and no authentication protection was disabled. This is configuration activation, not a claim of live generated-product verification.

Intake still prepares a translation review rather than automatically generating/adopting it. Existing manual SEO execution can use the configured provider. Actual 1688 retrieval, complete category parity, image translation and Supplier Hub transmission remain incomplete.
