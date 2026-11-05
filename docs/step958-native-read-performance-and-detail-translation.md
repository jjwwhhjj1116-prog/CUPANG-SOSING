# Native source reads and detail translation — 2026-11-05

## Implemented and verified

- Plan-only native asset GETs reuse server-created immutable upload facts (digest, dimensions, type and length). Cache identity includes bucket object, owner, key, upload version, size and complete HEAD metadata. No image bytes, credentials, user DTOs or source plans are cached. Final HEAD, source, settings, membership and sidecar checks remain fresh. File and bundle responses still read actual bytes.
- The native adapter consumes a one-use, call-local source preflight proof instead of repeating the complete plan read before the same boundary. A boundary still independently checks current source, actor and operation history.
- Explicit full/selected detail work can translate current BODY workspace photos despite a previous manual composition. It preserves manual final publication and requires review before replacing it. Unknown operations are recovered rather than repeated.
- Extension package: 2.1.87. Worker deployment: `e27a03d9-3d76-42a6-88de-2dcc7f6d06c3`.

Root checks: native API/sidecar tests **35/35**; detail/coordinator tests **220/220**; native preparation tests **15/15**; TypeScript, focused ESLint, production build and diff checks pass. Independent reviews found no material issue. The final cold hashing regression verifies sequential hashing and exact nonzero-offset views.

The warm API fixture returns the same plan with zero image-body GETs (previously seven). This is an opportunistic Worker-isolate cache, not a guaranteed cross-isolate latency or cache-hit claim.

## Actual owned socks verification

Product `865ff938-1f6e-42cd-bcfe-863cba84eb09`, offer `965495834905`, registration `261103002001`, company `A01526306`.

One prepare request `f69bda85-7f5c-4e8b-90f1-9550f70d81ba` created Supplier Hub draft **2362997**. Independent draft-list and document GETs confirm exactly one matching draft, eight options, supply 3710 KRW, retail 6750 KRW, and state `UNFINISHED`. The durable extension checkpoint records validation steps 2–5 and no receipt. An expired web acknowledgement is not grounds to recreate the document.

Visual review of the selected composed detail images found Chinese text remaining. Saved composition status does not establish translation quality. Final submission is withheld while BODY translation and a legitimate same-document revision path are prepared. Do not clear the original pending/checkpoint or misuse retry/repair flags to attach changed content.

Historical offer `886034098637`, accepted document **2347603**, remains untouched and must never be resent for verification. Other products remain untouched.
