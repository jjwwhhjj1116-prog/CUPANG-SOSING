# Qwen quotation JSON contract implementation plan

> **For agentic workers:** Use subagent-driven-development or executing-plans for each checked task.

**Goal:** Deliver the already generated quotation schema to the configured Qwen model and validate its documented response shapes.

**Architecture:** Issue a versioned execution policy for new requests and retain version 1 handling for saved history. Reuse the existing Qwen parser and independent quotation semantic validation.

**Tech Stack:** Existing TypeScript, Workers AI binding, Node API/SQLite fixtures; no new dependency.

**Spec:** The user's approved COUPLUS-style automatic workflow and configured Cloudflare Qwen translation.

The real 965495834905 / 261103001001 run saved eight option prices, but the quotation stage rejected an unexpected response shape. The production request adapter currently discards the strict schema already produced by `quotationAiProviderInput`. This is a confirmed request-contract gap; it does not by itself prove why the particular model response failed.

- [ ] Add a failing regression showing that new quotation execution must preserve the exact generated response schema and accept the documented JSON Mode parsed-object response. Keep the original chat text when it exists so duplicate-key checks remain effective.
- [ ] Introduce a version 2 `qwen-json-schema-v2` execution policy. New requests use version 2; saved version 1 policy/input/response handling remains unchanged. Reuse the existing standard Qwen JSON response parser. Preserve source, company, current schema, choices, manual values, budget and no automatic retry checks.
- [ ] Verify the shared label use, both-company API paths, old policy compatibility, strict malformed-output rejection and the connected runner-to-native preflight regression. Model/provider replies in local tests are synthetic.
- [ ] Review, type-check, lint, build and deploy the exact changed sources while excluding unrelated `app/chatgpt-auth.ts`. On the real new product, review the fresh source before a bounded user-triggered quotation retry. Never modify or resubmit the accepted 886/document2347603.

Review focus: policy version/protocol mismatches; a contradictory dual envelope; duplicate keys in original chat text; a configuration change during execution; an incomplete or malformed provider result. Each must remain rejected before adoption without an automatic provider retry.

Official references checked 2026-11-03: [Qwen model parameters](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/) advertise `response_format`; [JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/) documents `json_schema` and parsed `response` objects. General model-list coverage and runtime guarantees are separate: the final semantic validators remain authoritative.

Other live blockers remain explicit: the source receipt lacks attributes, packaging and BODY images; the yoga category requires a size chart; the first SEO draft added an unsupported waterproof claim and was rejected. None of these are repaired by accepting a different quotation response envelope.
