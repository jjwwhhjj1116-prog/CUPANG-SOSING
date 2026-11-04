# Image stage proof recovery implementation plan

**Goal:** After observing a completed retained image request, continue to the next selected image without inventing a source change or duplicate inference.

**Architecture:** Consume the existing exact request latch only when the current preservation proof matches the same slot, full source, configuration and request ID. Keep the existing coordinator and source/CAS fences.

**Scope:** app/batch-selected-image-work.ts and its regression suite. Historical accepted document2347603, unrelated products and dirty app/chatgpt-auth.ts remain excluded.

- [x] Reproduce two-slot ACK-loss/completed no-text proof case before editing.
- [x] Clear only the matching retained pending state before marking the original verified.
- [x] Verify positive continuation and negative request/source identity cases; mutation-check guards.
- [x] Run affected image/detail/whole-work suites, typecheck, lint and frozen production build.
- [x] Deploy, inspect owned-product editor and verify runtime state without resubmitting accepted documents.

Image geometry remains a separate quality issue. Existing local Tesseract was actually tested on the product photo, both whole-image and seven contextual rectangles. Neither produced a safe accepted exact-text geometric refinement; no automatic padding or unverified OCR edit was shipped.

Verified272/272 affected tests and live workspace no-text inspection; no final socks receipt claimed. Worker2822da73-0fd7-4add-a8d3-dda4759dad46.
