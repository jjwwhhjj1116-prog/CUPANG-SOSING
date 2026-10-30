import { inspectPreservedProductRequest, type PreservedProductInspection } from '@/app/preserved-product-request-client';
import { productDocumentReviewCanonical, type SupplierHubProductDocumentReview } from '@/app/supplier-hub-product-document';
import { previewProductDocument, runProductDocumentDraft, type ProductDocumentSession, type ProductDocumentState } from '@/app/supplier-hub-product-client';
import { readProductDocumentPending, assertProductDocumentNotRejected, claimProductDocumentPending, assertProductDocumentPending, type ProductDocumentPending } from '@/app/supplier-hub-product-pending';
import type { SupplierHubCompany } from '@/app/supplier-hub-company';
import { createProductDocumentPacket } from '../extensions/supplier-hub/product-document.mjs';
import { validatePreservedProductInspectionTarget, validatePreservedProductInspectionResult } from '../extensions/supplier-hub/preserved-product-checkpoint.mjs';

export type PreservedProductReconnectTarget = { requestId: string; productId: string; docId: string | number; company: SupplierHubCompany };
export type PreservedProductReconnectInput = {
  review: SupplierHubProductDocumentReview; target: PreservedProductReconnectTarget; signal: AbortSignal;
  refresh: (signal: AbortSignal) => Promise<SupplierHubProductDocumentReview>; isCurrent: () => boolean;
  recoverSavedTarget?: boolean;
};
export type PreservedProductReconnectResult = Readonly<{ session: ProductDocumentSession; observation: ProductDocumentState; pending: ProductDocumentPending }>;

const canonical = productDocumentReviewCanonical;
const equal = (left: unknown, right: unknown) => canonical(left) === canonical(right);
const reject = (message: string): never => { throw Error(message); };
const checkpointError = (): never => reject('원래 문서의 저장 완료·미제출 기록을 확인하지 못했습니다. 문서 생성·파일 저장·본문 전송은 실행하지 않았습니다.');

/** Reconnect an original saved draft or positively read-back saved update.
 * Inspection metadata alone never creates a session or grants a capability.
 * This helper claims only the Web Locks-protected web reservation. Native
 * readback may promote an already verified local extension checkpoint; Hub
 * create/update/upload/validation/consent/submit actions are never called here. */
export async function reconnectPreservedProductDraft(input: PreservedProductReconnectInput): Promise<PreservedProductReconnectResult> {
  const expected = canonical(input.review), review = JSON.parse(expected) as SupplierHubProductDocumentReview;
  const target = validatePreservedProductInspectionTarget(input.target);
  if (review.format !== 'yoofam-supplier-hub-product-document-v1' || review.type !== 'YOOFAM_PRODUCT_DOCUMENT_REVIEW'
    || review.registered !== false || review.remoteWrites !== false || review.submissionReady !== false
    || review.identity.productId !== target.productId || !equal(review.identity.company, target.company)) checkpointError();
  const active = () => { if (input.signal.aborted || !input.isCurrent()) reject('원래 요청 연결 확인을 취소했거나 상품·회원 범위가 바뀌었습니다. 보관 기록은 유지했습니다.'); };
  const fresh = async () => {
    active(); const latest = await input.refresh(input.signal); active();
    if (canonical(input.review) !== expected || canonical(latest) !== expected) reject('저장한 상품·옵션·회사 또는 견적서가 바뀌었습니다. 원래 요청의 기록을 변경하지 않았습니다.');
  };
  const absent = () => {
    active();
    if (readProductDocumentPending(review) !== null) reject('이 상품의 웹 전송 요청이 이미 보관되어 있습니다. 기록을 덮어쓰지 말고 기존 요청의 저장 결과 조회를 이용해주세요.');
    assertProductDocumentNotRejected(review);
  };
  const checked = (report: PreservedProductInspection) => {
    const raw = Object.fromEntries(Object.entries(report).filter(([key]) => key !== 'pendingDiagnostic'));
    const parsed = validatePreservedProductInspectionResult(raw, target), c = parsed.checkpoint;
    if (!c) return checkpointError();
    if (parsed.status !== 'found' || parsed.found !== true || parsed.complete !== true || parsed.canResume !== false
      || c.draftOnly !== true || c.preparedLifecycle !== false || !['update-requested', 'updated', 'validated'].includes(c.state)
      || c.submitRequestedAt !== null || c.requestId !== target.requestId || String(c.docId) !== String(target.docId)) checkpointError();
    if (c.state === 'update-requested' && (c.operationId !== target.requestId + ':update' || c.requestedStep !== null || c.validatedSteps.length !== 0)) checkpointError();
    return JSON.parse(canonical(c)) as NonNullable<PreservedProductInspection['checkpoint']>;
  };
  const previewMatches = (checkpoint: NonNullable<PreservedProductInspection['checkpoint']>, session: ProductDocumentSession) => {
    const preview = session.preview, identity = preview.identity;
    if (session.packet.requestId !== target.requestId || canonical(session.packet.review) !== expected
      || preview.requestId !== target.requestId || preview.productId !== target.productId || preview.draftPreparationAvailable !== true
      || preview.remoteWrites !== false || preview.registered !== false || preview.reviewDigest !== review.reviewDigest
      || checkpoint.identityDigest !== preview.identityDigest || checkpoint.packetDigest !== preview.packetDigest || session.packetDigest !== preview.packetDigest
      || checkpoint.originalBodySha256 !== review.originalBodySha256 || checkpoint.originalBodySha256 !== preview.originalBodySha256
      || checkpoint.preparedBodySha256 !== review.preparedBodySha256 || checkpoint.preparedBodySha256 !== preview.preparedBodySha256
      || checkpoint.sourcePlanSha256 !== review.identity.fingerprint || checkpoint.sourcePlanSha256 !== preview.fingerprint
      || checkpoint.profileId !== review.identity.profileId || checkpoint.categoryId !== review.identity.categoryId
      || checkpoint.membersCount !== review.members.length || !equal(preview.members, review.members)
      || identity.ownerId !== review.identity.ownerId || identity.productId !== target.productId || !equal(identity.company, target.company)
      || checkpoint.savedAppTabId !== identity.appTabId || checkpoint.savedWindowId !== identity.windowId
      || !equal(checkpoint.source, identity.source) || !equal(checkpoint.source, Object.fromEntries(Object.entries(review.identity.source).filter(([key]) => key !== 'profileId')))) checkpointError();
  };

  await fresh(); absent();
  const first = checked(await inspectPreservedProductRequest(target, review.identity.ownerId, input.signal));
  await fresh(); absent();
  const now = Date.now(), packet = await createProductDocumentPacket(review, { requestId: target.requestId, createdAt: now, now });
  await fresh(); absent();
  const session = await previewProductDocument(packet, input.signal);
  await fresh(); absent(); previewMatches(first, session);
  let second = checked(await inspectPreservedProductRequest(target, review.identity.ownerId, input.signal));
  await fresh(); absent(); previewMatches(second, session);
  if (!equal(first, second)) reject('확인 중 원래 문서의 단계나 저장 기록이 변경됐습니다. 다시 연결하거나 전송하지 않았습니다.');
  if (input.recoverSavedTarget === true) {
    if (session.preview.savedDraftTargetRecoveryAvailable !== true || !['update-requested', 'updated'].includes(second.state)
      || second.operationId !== target.requestId + ':update' || second.requestedStep !== null || second.validatedSteps.length !== 0
      || second.savedHubTabId === null) checkpointError();
    // This explicit native action may create one browser read tab, never a
    // Hub document or another upload/update. Only its fully qualified native
    // result and a matching post-checkpoint can rebase the ordinary read.
    const recoveredTarget = await runProductDocumentDraft(session, 'recoverSavedDraftTarget', input.signal);
    await fresh(); absent();
    const post = checked(await inspectPreservedProductRequest(target, review.identity.ownerId, input.signal));
    await fresh(); absent(); previewMatches(post, session);
    const stable = (checkpoint: typeof second) => Object.fromEntries(Object.entries(checkpoint).filter(([key]) => !['state', 'sequence', 'updatedAt', 'savedHubTabId'].includes(key)));
    const delta = post.sequence - second.sequence, targetProof = recoveredTarget.draftProof;
    if (!equal(stable(second), stable(post)) || post.state !== 'updated' || post.operationId !== target.requestId + ':update'
      || post.requestedStep !== null || post.validatedSteps.length !== 0 || post.savedHubTabId === null || post.updatedAt < second.updatedAt
      || !(delta === 0 ? second.state === 'updated' && equal(post, second) : [1, 3].includes(delta) && post.savedHubTabId !== second.savedHubTabId)
      || recoveredTarget.requestId !== target.requestId || String(recoveredTarget.docId) !== String(target.docId)
      || recoveredTarget.state !== 'updated' || recoveredTarget.recovered !== true || recoveredTarget.needsRecovery !== false
      || recoveredTarget.error !== undefined || recoveredTarget.receipt !== undefined || recoveredTarget.challenge !== undefined
      || recoveredTarget.draftOnly !== true || recoveredTarget.preparedLifecycle !== undefined || recoveredTarget.registered !== false || recoveredTarget.success !== false
      || recoveredTarget.identityDigest !== session.preview.identityDigest || recoveredTarget.packetDigest !== session.packetDigest
      || !equal(recoveredTarget.identity, session.preview.identity) || recoveredTarget.originalBodySha256 !== review.originalBodySha256
      || recoveredTarget.preparedBodySha256 !== review.preparedBodySha256 || !targetProof || targetProof.evidence !== 'document-draft-preparation'
      || targetProof.submitted !== false || targetProof.consented !== false || targetProof.validatedSteps.length !== 0
      || targetProof.checkpointSequence !== post.sequence || targetProof.observedAt !== post.updatedAt) checkpointError();
    second = post;
  }
  const observation = await runProductDocumentDraft(session, 'recoverDraft', input.signal);
  await fresh(); absent();
  const proof = observation.draftProof, promoted = second.state === 'updated' && second.validatedSteps.length === 4;
  // The existing native receiver can positively verify an uncertain update's
  // complete saved body/file references and advance its local checkpoint
  // without sending it. This does not claim every remote file byte was read.
  // An unsent update becomes `created`, which deliberately remains ineligible.
  const recoveredUpdate = second.state === 'update-requested', advanced = promoted || recoveredUpdate;
  if (observation.requestId !== target.requestId || String(observation.docId) !== String(target.docId)
    || observation.draftOnly !== true || observation.preparedLifecycle !== undefined || observation.recovered !== true
    || observation.needsRecovery !== false || observation.error !== undefined || observation.receipt !== undefined || observation.challenge !== undefined
    || observation.registered !== false || observation.success !== false || !['updated', 'validated'].includes(observation.state)
    || observation.state !== (recoveredUpdate ? 'updated' : promoted ? 'validated' : second.state)
    || observation.identityDigest !== session.preview.identityDigest || observation.packetDigest !== session.packetDigest
    || !equal(observation.identity, session.preview.identity) || observation.originalBodySha256 !== review.originalBodySha256
    || observation.preparedBodySha256 !== review.preparedBodySha256 || !proof || proof.evidence !== 'document-draft-preparation'
    || proof.submitted !== false || proof.consented !== false || !equal(proof.validatedSteps, second.validatedSteps)
    || proof.checkpointSequence !== second.sequence + (advanced ? 1 : 0)
    || !Number.isSafeInteger(proof.observedAt) || proof.observedAt < second.updatedAt || proof.observedAt > Date.now() + 5000
    || !advanced && proof.observedAt !== second.updatedAt) checkpointError();
  const pending = await claimProductDocumentPending(review, session, input.signal, async () => { await fresh(); absent(); });
  // Cancellation after the confirmed claim retains this exact reservation.
  // Never delete or replace it to make another operation appear available.
  await fresh(); assertProductDocumentPending(review, pending, session); active();
  return Object.freeze({ session, observation, pending });
}
