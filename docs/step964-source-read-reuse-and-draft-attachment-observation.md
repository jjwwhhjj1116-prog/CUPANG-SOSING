# Source reads and saved-draft attachment observation

2026-11-05. Verification remains scoped to socks 965495834905 / product
865ff938-1f6e-42cd-bcfe-863cba84eb09 / original request
f69bda85-7f5c-4e8b-90f1-9550f70d81ba / existing document 2362997.
Historical accepted document 2347603 was not modified or sent again.

## Changes

- Reuse a quotation snapshot only within one source-reading phase and profile.
  The final source fence creates a separate fresh provider. Generated-label
  state and its full database currentness check remain fresh in each phase.
- Share the existing label snapshot derivation between its public route and
  native export; public authentication, ownership and mutation contracts remain.
- Expose bounded known attachment metadata in a failed current-document read:
  file name, S3 resource key, and the same-name expected image key. Unknown
  properties, credential-bearing URLs and oversized/control-containing values
  are omitted. The diagnostic does not accept or delete the unexpected file.
- Extension 2.1.90 was built and reloaded in the connected Aside profile.

## Verification

- New generated-label API fixtures: exact native-plan equality; SQL statements
  59 -> 41 for an explicit profile, 76 -> 62 with collection context.
- Settings/content/label/profile/company/membership races reject with 409.
- Root affected suites: 86/86 passed with repository concurrency 4.
- Existing label/native regressions: 38/38; independent review found no
  material issue and independently passed 24 API cases.
- TypeScript, targeted lint, extension build, frozen production build passed.
- Frozen source manifest: 18 files matched working/release SHA-256 values.
  The unrelated dirty authentication file was excluded; release bytes equal HEAD.
- Worker deployed as 2aa9d35c-46c2-4060-a8e9-8813344f970d.

## Live result and limits

Document 2362997 still has the original 8 members and 18 image descriptors.
The read-only target recovery finds one certificate-type row whose file name
matches a LABEL image but whose S3 value does not match that image descriptor.
The original legal body still matches the saved source. This is not yet proof
that the two objects or their roles are identical; recovery remains blocked.
No file upload, body update, new document or submission was issued in this step.

Production native-source GET observations after deployment were about 5-9 s;
the SQL reduction is verified, but a consistent latency improvement is not yet
established. The six-photo edited workspace remains saved separately from the
unchanged quotation revision 18, pending a qualified same-document amendment.
