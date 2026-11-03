# Manual image cleanup → quotation review

Scope: complete the explicit image review handoff for stages 3–4 without changing the automatic cleanup safety checks or Supplier Hub submission protocol.

## Reproduction

A manually selected erase operation can render and save successfully while the original Vision style warning remains in the immutable edit document. The quotation asset reader correctly treats the retained warning as unresolved, so the newly saved image still blocks transmission.

## Implementation

1. Record a failing fixture through the real renderer, image-text apply route, and native asset reader.
2. After successful rendering, resolve only exact known style diagnostics for selected erase regions of main/additional quotation images. Keep original inputs, unselected regions, unknown/provider errors and detail translation diagnostics unchanged.
3. Persist the returned document through the existing source-bound, hash-verified apply and recovery flow. Do not normalize documents in the server after the client has computed their identity.
4. Verify cancellation, rendering failure, source mismatch, incomplete other regions and existing native registration behavior.
5. Review the change independently, build an isolated release excluding the unrelated authentication working copy, deploy and push the explicit change.

## Protected state and verification limits

Do not modify existing products, accepted document 2347603, its original request, files or body. Current Chrome runtime is still 2.1.79; collector 2.1.80 is prepared but not yet confirmed loaded. This change is web-side and does not require another extension version. Local integration coverage does not establish a fresh seller capture or a new Supplier Hub receipt.
