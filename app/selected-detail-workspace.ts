import { detailBatchSelection } from '@/app/detail-image-batch';
import { validateFreeImageSource, type FreeImageSource } from '@/app/free-image-translation';
import { sameFreeImageQuotationRequest } from '@/app/free-image-translation-client';
import { validateFreeImageEditDocument } from '@/app/free-image-edit-document';
import { labelUploadDigest } from '@/app/label-upload-key';
import { initialDetailWorkspaceDocument } from '@/app/detail-workspace-seed';
import { generateDetailWorkspaceHtml } from '@/app/detail-workspace';
import { createDetailWorkspaceSave, readDetailWorkspace, recoverDetailWorkspace, saveDetailWorkspace,
  type DetailWorkspaceAttempt, type DetailWorkspaceSaveInput, type DetailWorkspaceSelection } from '@/app/detail-workspace-client';

export type SelectedDetailWorkspacePending = {
  selection: DetailWorkspaceSelection; slotIndex: number; source: FreeImageSource; resultKey: string;
  save?: { input: DetailWorkspaceSaveInput; attempt: DetailWorkspaceAttempt; phase: 'seed' | 'translation' };
};
const changed = () => Error('저장한 상세 번역과 편집 구성의 원본 연결이 변경됐습니다. 확인된 번역과 현재 사진 구성을 유지하고 저장 상태를 확인해주세요.');

/** The quotation's immutable edit sidecar proves this exact generated result.
 * Read metadata only: reconciling a save never performs another inference or
 * decodes/OCRs a flattened quotation attachment. */
async function generatedSource(input: SelectedDetailWorkspacePending, signal: AbortSignal, fetcher: typeof fetch) {
  const { selection, slotIndex, resultKey } = input, original = validateFreeImageSource(input.source);
  const selected = detailBatchSelection(selection.view, selection.optionId, selection.profileId ?? null, 'detail');
  const target = { kind: 'quotation' as const, profileId: selection.profileId ?? null, optionId: selection.optionId, input: 'detailImages' as const,
    fieldKey: selected.target.primary, slotIndex, revision: selection.view.revision, inputFingerprint: selection.view.inputFingerprint,
    optionRevision: selection.view.optionRevision, value: selected.value };
  if (selected.keys[slotIndex] !== resultKey || original.productId !== selection.productId || original.role !== 'detail'
    || original.quotationTarget?.optionId !== selection.optionId || original.quotationTarget.input !== 'detailImages'
    || original.quotationTarget.profileId !== target.profileId || original.quotationTarget.fieldKey !== target.fieldKey
    || original.quotationTarget.slotIndex !== slotIndex || original.workspaceTarget || original.editorSource) throw changed();
  const query = new URLSearchParams({ sourceKey: resultKey, role: 'detail', target: 'quotation', editor: 'saved', optionId: selection.optionId,
    fieldKey: target.fieldKey, slotIndex: String(slotIndex), ...(selection.profileId ? { profileId: selection.profileId } : {}) });
  const response = await fetcher(`/api/products/${encodeURIComponent(selection.productId)}/image-text?${query}`, { signal, cache: 'no-store' });
  const body = await response.json() as { source?: unknown; editDocument?: unknown; error?: string }; signal.throwIfAborted();
  if (!response.ok) throw Error(body.error || '저장한 상세 번역의 편집 기록을 확인하지 못했습니다.');
  const source = validateFreeImageSource(body.source), document = validateFreeImageEditDocument(body.editDocument, source);
  if (source.productId !== selection.productId || source.productVersion !== selection.view.productVersion || source.contentRevision !== selection.view.contentRevision
    || source.role !== 'detail' || source.workspaceTarget || source.editorSource?.resultKey !== resultKey || source.editorSource.anchorPolicy !== undefined
    || source.sourceKey !== original.sourceKey || source.sourceSha256 !== original.sourceSha256 || source.width !== original.width || source.height !== original.height
    || !sameFreeImageQuotationRequest(source.quotationTarget, target) || document.crop
    || !document.regions.some(region => region.selected && region.translationProvenance === 'generated' && region.translated.trim())
    || document.regions.some(region => region.translationProvenance === 'manual' || region.selected && (region.translationProvenance !== 'generated' || !region.translated.trim() || region.issue))
    || await labelUploadDigest(new TextEncoder().encode(JSON.stringify(document))) !== source.editorSource.documentSha256) throw changed();
  return source.sourceKey;
}

/** Only a confirmed quotation edit may update matching, unchanged body photos.
 * Stored IDs/order/deletions/replacements/banners remain authoritative. The
 * same CAS-backed workspace API is used for new seeds and existing documents. */
export async function reconcileSelectedDetailWorkspace(input: SelectedDetailWorkspacePending, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<'saved' | 'preserved' | 'retry'> {
  signal.throwIfAborted();
  if (input.save) {
    const { input: prepared, attempt } = input.save;
    if (attempt.pending || attempt.completed) {
      await recoverDetailWorkspace(prepared, attempt, signal, fetcher);
      if (!attempt.completed) return 'retry';
      if (input.save.phase === 'translation') return 'saved';
      delete input.save; return 'retry';
    }
    if (!attempt.retryReady) {
      // A definite rejection may race a user's newer workspace. Read that
      // current document before a later explicit resume prepares another CAS;
      // an unknown dispatched request always takes the recovery branch above.
      const latest = await readDetailWorkspace(input.selection, signal, fetcher);
      if (JSON.stringify(latest.workspace) !== JSON.stringify(prepared.before.workspace)) { delete input.save; return 'retry'; }
      await recoverDetailWorkspace(prepared, attempt, signal, fetcher); return 'retry';
    }
    await saveDetailWorkspace(prepared, attempt, signal, fetcher);
    if (input.save.phase === 'translation') return 'saved';
    delete input.save;
  }
  const sourceKey = await generatedSource(input, signal, fetcher);
  let saved = await readDetailWorkspace(input.selection, signal, fetcher);
  const document = initialDetailWorkspaceDocument(saved, input.selection.optionId);
  const photos = document.photos.map(photo => photo.role === 'body' && photo.key === sourceKey && photo.originKey === sourceKey ? { ...photo, key: input.resultKey } : photo);
  if (photos.every((photo, index) => photo === document.photos[index])) return 'preserved';
  if (!saved.workspace) {
    // First-save validation intentionally requires every stable photo ID to
    // begin at its actual original key. Preserve that rule, then adopt the
    // verified result only after this exact baseline is acknowledged.
    const seed = await createDetailWorkspaceSave(input.selection, saved, document);
    input.save = { input: seed, attempt: {}, phase: 'seed' };
    saved = await saveDetailWorkspace(seed, input.save.attempt, signal, fetcher);
    delete input.save;
  }
  const prepared = await createDetailWorkspaceSave(input.selection, saved, { ...document, photos, generatedHtml: generateDetailWorkspaceHtml(photos, document.imageMargin) });
  input.save = { input: prepared, attempt: {}, phase: 'translation' };
  await saveDetailWorkspace(prepared, input.save.attempt, signal, fetcher); return 'saved';
}
