# Step 878 — retry only proven unsent work; keep source tools out of the main list

## Result

The web release fixes two causes of a selected automatic job stopping unnecessarily before its next stage. It also removes the historical-source panel from the normal AI registration list, while preserving the panel's inputs inside the source-tools dialog.

### Stage 6: Korean label work

The earlier helper set its pending-save flag before preparing or rendering the label. A local PNG failure, or a rejected protected-account GET before a mutation was dispatched, could therefore be reported as an unknown remote save. That blocked quotation work although no save had been sent.

The helper now observes actual mutation dispatch. A proven unsent failure remains a failed stage and permits later quotation work or an explicit retry. Confirmed text is retained; a dispatched request with a lost or invalid receipt remains fenced. The production helper fallback conservatively marks a request immediately before delegating when no dispatch observer is supplied.

### Stage 7: quotation fields

The quotation-field PUT used the same once-only wrapper as other mutations but omitted its dispatch-tracking option. A final account-context GET returning 503 could leave a quotation write fence before any PUT was sent.

That PUT now uses the existing dispatch-aware wrapper. An explicit retry after a proven unsent failure reuses the already confirmed AI result, rather than generating it again. Lost or invalid receipts after an actual PUT still block retransmission.

### Source-tools UI

The historical-source component now lives in the existing hidden source-tools dialog. It is keyed by workspace owner, remains mounted during same-owner close/reopen, and preserves input. Each opening gets a separate token. Closing the dialog, changing owner, or unmounting invalidates the token synchronously. The child captures the original token guard before its GET and checks it again before opening product intake; a late response cannot reopen a dismissed dialog, including close/reopen sequences.

## Verification

- Label helper: 13 tests passed, including the actual save helper's PNG-render failure, unsent preflight rejection, and dispatched uncertain writes.
- Automatic orchestration: final 67 tests passed, including confirmed AI reuse after unsent quotation failure and no resend after dispatched lost/invalid receipts.
- Dashboard/history integration: 80 tests passed. Historical component: final 13 tests passed, including held-GET close and close/reopen. One earlier combined run hit an initialization-timing assertion; the test now waits for its actual enabled control, and its full 13-test file passed afterward.
- TypeScript, changed-file ESLint, diff checks, and production build passed.
- Release sources match the checkout after CRLF-to-LF normalization only. The archive uses Git's LF representation.
- Live DOM: upper source-tools icon opens the dialog; closing hides it and its lower collection panel; product management and AI registration navigation both work. Evidence: `outputs/step878-live-dashboard-dom.txt`. No current screenshot was captured; the previously recorded browser screenshot timeout was not bypassed through native automation.

## Deployment and preserved data

- Code commits: `57692d2` and `17b1971`.
- Deployed Worker version: `fb17391d-6c65-4f21-99e9-21c8d526612b`.
- No extension source/version, permissions, model, billing, or schema changes in this release.
- The original offer 886034098637 / product e2f8037c-294e-45a8-b06d-58cc5909683c / request f29491bd-1882-456a-8a63-eec8586db6c6 / Hub document 2347603 was not modified.
- Fixed-scope D1 SELECT comparison: 35 tables, 47 rows, unchanged SHA-256 `39f1f5b9ff48173e6d68b0e8d9689aac8eb587f2fb469a0ed6b2984913a3455d`.
- No Hub document creation, file upload, body update, deletion, validation, or final submission was executed in this step.

## Remaining runtime gate

The current Chrome integration screen still reports extension **2.1.64**. Prepared **2.1.65** contains the read-only full-document/body/attachment audit from Step 877 and is already in the actual installed folder. A user refresh is pending. Do not repeat the audit capability failure until the installed runtime changes.

Preserve YOOFAM tab 727939940 and Supplier Hub tabs 727940016 and 727940002. Once 2.1.65 is confirmed, run only the original document's read-only audit. The known certificate attachment and legal-body mismatch must be resolved from full evidence; the read-only audit never qualifies, deletes, or retransmits. Actual Supplier Hub receipt and complete Couplus parity remain unverified.
