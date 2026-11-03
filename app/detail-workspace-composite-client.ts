import { renderDetailImageParts, type DetailComposite } from '@/app/detail-image-composite';
import { DETAIL_COMPOSITE_PARTS_POLICY, detailCompositePartsUploadId, detailCompositePartUploadId } from '@/app/detail-composite-parts';
import { readDetailWorkspace, validateDetailWorkspaceReply, type DetailWorkspaceSelection } from '@/app/detail-workspace-client';
import type { DetailWorkspaceRecord, DetailWorkspaceView } from '@/app/detail-workspace';
import { applyDetailSave, recoverDetailSave, type DetailSaveAttempt } from '@/app/detail-save-client';
import { DETAIL_SAVE_EDITOR_POLICY, DETAIL_SAVE_PUBLICATION_POLICY, DETAIL_PUBLICATION_CURRENT_POLICY, detailSavePublishedBodyImages, DETAIL_SAVE_PEER_SNAPSHOT_LIMIT, detailSaveOptionIds, validateDetailSavePeers, detailSavePeerDigest, type DetailSavePeers } from '@/app/detail-save-plan';
import { labelUploadDigest } from '@/app/label-upload-key';
import { PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-pool-limit';
import type { QuotationFieldsView } from '@/app/quotation-schema';

export type DetailWorkspaceComposite = DetailComposite & { workspace: DetailWorkspaceRecord; peers?: DetailSavePeers;publicationPolicy?:typeof DETAIL_SAVE_PUBLICATION_POLICY };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const changed = () => Error('보관한 상세 구성이나 견적 저장 기준이 변경되었습니다. 미리보기와 작업 구성을 유지하고 최신 상태를 확인해주세요.');
const endpoint = (input: DetailWorkspaceSelection) => `/api/products/${encodeURIComponent(input.productId)}/quotation-fields${input.profileId ? `?profileId=${encodeURIComponent(input.profileId)}` : ''}`;
const options = (input: DetailWorkspaceComposite) => ({ editorPolicy: DETAIL_SAVE_EDITOR_POLICY, workspace: input.workspace, ...(input.peers ? { peers: input.peers } : {}),...(input.publicationPolicy?{publicationPolicy:input.publicationPolicy}:{}) });
export type DetailPublicationCurrentObservation = { status: 'current' | 'unpublished' | 'review-required' };
/** A new job may reuse authority only after a versioned read bound to its current view. */
export async function readCurrentDetailPublication(selection: Omit<DetailWorkspaceSelection, 'optionId'>, signal: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<DetailPublicationCurrentObservation> {
  const params = new URLSearchParams({ ...(selection.profileId ? { profileId: selection.profileId } : {}), current: DETAIL_PUBLICATION_CURRENT_POLICY });
  signal.throwIfAborted(); const response = await fetcher(`/api/products/${encodeURIComponent(selection.productId)}/detail-save?${params}`, { signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error' }),
    body = await response.json(), view = selection.view, source = { productId: selection.productId, profileId: selection.profileId ?? null, productVersion: view.productVersion,
      contentRevision: view.contentRevision, optionRevision: view.optionRevision, revision: view.revision, inputFingerprint: view.inputFingerprint, categoryContext: view.categoryContext };
  signal.throwIfAborted();
  if (!response.ok || response.redirected || !object(body) || Object.keys(body).some(key => !['policy', 'readOnly', 'status', 'source', 'execution', 'publication'].includes(key))
    || body.policy !== DETAIL_PUBLICATION_CURRENT_POLICY || body.readOnly !== true
    || !['current', 'unpublished', 'review-required'].includes(body.status as string) || !same(body.source, source)
    || !same(body.execution, { requests: 0, writes: 0 })) throw changed();
  if (body.status === 'current') {
    const proof = body.publication, hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
    if (!object(proof) || Object.keys(proof).sort().join(',') !== 'basisSha256,bodyPhotos,fieldsSha256,peerAfterDigest,policy,sourceOptionId,uploadId,workspace'
      || proof.policy !== DETAIL_PUBLICATION_CURRENT_POLICY || !hash(proof.uploadId) || !hash(proof.peerAfterDigest) || !hash(proof.basisSha256) || !hash(proof.fieldsSha256)
      || typeof proof.sourceOptionId !== 'string' || !detailSaveOptionIds(view).includes(proof.sourceOptionId) || !object(proof.workspace)
      || Object.keys(proof.workspace).sort().join(',') !== 'digest,revision' || !Number.isSafeInteger(proof.workspace.revision) || (proof.workspace.revision as number) < 1 || !hash(proof.workspace.digest)
      || !Number.isSafeInteger(proof.bodyPhotos) || (proof.bodyPhotos as number) < 1 || (proof.bodyPhotos as number) > PRODUCT_IMAGE_POOL_LIMIT) throw changed();
  } else if (body.publication !== undefined) throw changed();
  return { status: body.status as DetailPublicationCurrentObservation['status'] };
}
async function verifyPeers(selection: DetailWorkspaceSelection, saved: DetailWorkspaceView, peers: DetailSavePeers, signal: AbortSignal, fetcher: typeof fetch) {
  const proof = validateDetailSavePeers(peers, detailSaveOptionIds(selection.view));
  if (!saved.workspace) throw changed();
  let bytes = 1; // Source is present: brackets plus N-1 commas are N+1 bytes.
  for (const peer of proof) {
    const current = peer.optionId === selection.optionId ? saved : await readDetailWorkspace({ ...selection, optionId: peer.optionId }, signal, fetcher), record = current.workspace;
    if (!same(peer.workspace, record ? { revision: record.revision, digest: record.digest } : null) || record && !same(record.company, saved.workspace.company)) throw changed();
    if (record) {
      bytes += new TextEncoder().encode(JSON.stringify({ option_id: peer.optionId, revision: record.revision, request_id: record.requestId,
        payload: JSON.stringify(record), updated_at: record.updatedAt })).length + 1;
      if (bytes > DETAIL_SAVE_PEER_SNAPSHOT_LIMIT) throw Error('모든 옵션의 상세 구성 확인 자료는2MiB 이내여야 합니다. 기존 자료는 보존했습니다.');
    }
  }
  return proof;
}

/** Real current workspace pixels, read twice and rendered using the final
 * 800px full-bleed convention. Editor-only generated HTML/margins are retained. */
export async function prepareDetailWorkspaceComposite(selection: DetailWorkspaceSelection, saved: DetailWorkspaceView,
  signal: AbortSignal, fetcher: typeof fetch = fetch, peers?: DetailSavePeers,publicationPolicy?:typeof DETAIL_SAVE_PUBLICATION_POLICY): Promise<DetailWorkspaceComposite> {
  if(publicationPolicy!==undefined&&(publicationPolicy!==DETAIL_SAVE_PUBLICATION_POLICY||peers===undefined))throw changed();
  signal.throwIfAborted(); const before = await validateDetailWorkspaceReply(selection, saved), record = before.workspace;
  if (!record || !record.document.photos.length) throw Error('사진이 있는 상세 편집 구성을 먼저 보관해주세요.');
  if (!same(await readDetailWorkspace(selection, signal, fetcher), before)) throw changed();
  const reviewedPeers = peers === undefined ? undefined : await verifyPeers(selection, before, peers, signal, fetcher);
  const keys = record.document.photos.map(photo => photo.key);
  const published = publicationPolicy ? detailSavePublishedBodyImages(record, selection.view.imageKeys[0].split('/')[0]).map(image => image.key) : [];
  const missing = [...new Set([...keys, ...published].filter(key => !selection.view.imageKeys.includes(key)))];
  if (selection.view.imageKeys.length + missing.length + 1 > PRODUCT_IMAGE_POOL_LIMIT)
    throw Error('현재 사진과 최종 이미지를 함께 보존할 상품 이미지 공간이 부족합니다. 기존 파일은 유지됩니다.');
  const rendered = await renderDetailImageParts(selection, keys, signal, fetcher, 'png', true);
  if(selection.view.imageKeys.length+missing.length+rendered.parts.length>PRODUCT_IMAGE_POOL_LIMIT)throw Error('분할 상세 이미지와 원본을 보존할 공간이 부족합니다.');
  for (const source of rendered.sources) {
    const proof = record.files.find(file => file.key === source.key);
    if (!proof || proof.sha256 !== source.sha256 || proof.width !== source.width || proof.height !== source.height) throw changed();
  }
  if (!same(await readDetailWorkspace(selection, signal, fetcher), before)) throw changed();
  if (reviewedPeers) await verifyPeers(selection, before, reviewedPeers, signal, fetcher);
  const first=rendered.parts[0],sha256=first.sha256,workspace = { revision: record.revision, digest: record.digest };
  if(rendered.parts.length>1){
    const metadata=rendered.parts.map(({start,end,width,height,sha256,bytes})=>({start,end,width,height,sha256,bytes}));
    const uploadId=await detailCompositePartsUploadId({productId:selection.productId,optionId:selection.optionId,category:selection.view.categoryContext,fingerprint:selection.view.inputFingerprint,sources:rendered.sources,workspace,
      ...(reviewedPeers?{peerDigest:await detailSavePeerDigest(reviewedPeers)}:{}),...(publicationPolicy?{publicationPolicy,publishedBodyImages:detailSavePublishedBodyImages(record,selection.view.imageKeys[0].split('/')[0])}:{})},metadata);
    const parts=await Promise.all(rendered.parts.map(async(part,index)=>({...metadata[index],output:part.output,uploadId:await detailCompositePartUploadId(uploadId,index,metadata[index])})));
    return{...selection,keys,sources:rendered.sources,output:first.output,width:800,height:first.height,sha256,uploadId,partsPolicy:DETAIL_COMPOSITE_PARTS_POLICY,parts,workspace:structuredClone(record),...(reviewedPeers?{peers:reviewedPeers}:{}),...(publicationPolicy?{publicationPolicy}:{})};
  }
  const uploadId = await labelUploadDigest(new TextEncoder().encode(JSON.stringify({ kind: 'workspace-detail-composite-v1',
    productId: selection.productId, optionId: selection.optionId, category: selection.view.categoryContext,
    fingerprint: selection.view.inputFingerprint, workspace, sources: rendered.sources, width: 800, height:first.height, sha256,
    ...(reviewedPeers ? { peerDigest: await detailSavePeerDigest(reviewedPeers) } : {}),...(publicationPolicy?{publicationPolicy,publishedBodyImages:detailSavePublishedBodyImages(record,selection.view.imageKeys[0].split('/')[0])}:{}) })));
  signal.throwIfAborted();
  return { ...selection, keys, sources: rendered.sources, output:first.output, width:800, height:first.height,
    sha256, uploadId, workspace: structuredClone(record), ...(reviewedPeers ? { peers: reviewedPeers } : {}),...(publicationPolicy?{publicationPolicy}:{}) };
}
async function verifyPrepared(input: DetailWorkspaceComposite, signal: AbortSignal, fetcher: typeof fetch) {
  const saved = await readDetailWorkspace(input, signal, fetcher);
  if (input.peers) await verifyPeers(input, saved, input.peers, signal, fetcher);
  if (!same(saved.workspace, input.workspace) || !same(input.keys, input.workspace.document.photos.map(photo => photo.key))
    || input.sources.length !== input.keys.length || input.sources.some((source, index) => source.key !== input.keys[index])) throw changed();
  for (const source of input.sources) {
    const file = input.workspace.files.find(file => file.key === source.key);
    if (!file || file.sha256 !== source.sha256 || file.width !== source.width || file.height !== source.height) throw changed();
  }
}
export async function applyDetailWorkspaceComposite(input: DetailWorkspaceComposite, attempt: DetailSaveAttempt,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<QuotationFieldsView> {
  if (!attempt.pending && !attempt.completed) await verifyPrepared(input, signal, fetcher);
  return applyDetailSave(input, attempt, signal, fetcher, options(input));
}
/** Reads only. A lost acknowledgement never repeats the upload or save. */
export async function recoverDetailWorkspaceComposite(input: DetailWorkspaceComposite, attempt: DetailSaveAttempt,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<'ready' | 'completed'> {
  return recoverDetailSave(input, attempt, signal, fetcher, options(input));
}
/** Explicit escape from a superseded preview. It does not establish whether
 * the previous attempt committed and never issues a mutation. */
export async function readLatestDetailWorkspaceComposite(selection: DetailWorkspaceSelection, signal: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<DetailWorkspaceView> {
  signal.throwIfAborted(); const response = await fetcher(endpoint(selection), { signal, cache: 'no-store' });
  const body = await response.json() as QuotationFieldsView & { error?: string }; signal.throwIfAborted();
  if (!response.ok) throw Error(body.error || '최신 견적 저장 기준을 읽지 못했습니다.');
  if (!same(body.categoryContext, selection.view.categoryContext)) throw changed();
  return readDetailWorkspace({ ...selection, view: body }, signal, fetcher);
}
