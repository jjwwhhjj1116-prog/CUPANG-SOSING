import { defaultSettings, savedRegistrationSettings, type WorkspaceSettings } from '@/app/workspace-settings';
import { parseWorkspaceSettingsScope, type WorkspaceSettingsScope } from '@/app/workspace-settings-scope';
import type { SupplierHubCompany } from '@/app/supplier-hub-company';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import type { ProductContent } from '@/app/product-content';
import type { DetailWorkspaceDocument, DetailWorkspaceView } from '@/app/detail-workspace';
import { initialDetailWorkspaceDocument } from '@/app/detail-workspace-seed';
import { createDetailWorkspaceSave, readDetailWorkspace, recoverDetailWorkspace, saveDetailWorkspace,
  type DetailWorkspaceSelection, type DetailWorkspaceSaveInput, type DetailWorkspaceAttempt } from '@/app/detail-workspace-client';
import { applyDetailWorkspaceImage, readDetailWorkspaceImage, recoverDetailWorkspaceImage,
  type DetailWorkspaceEditorContext, type DetailWorkspaceImageReply } from '@/app/detail-workspace-image-client';
import { prepareDetailWorkspaceComposite, applyDetailWorkspaceComposite, recoverDetailWorkspaceComposite,
  readCurrentDetailPublication, type DetailWorkspaceComposite } from '@/app/detail-workspace-composite-client';
import type { DetailSaveAttempt } from '@/app/detail-save-client';
import { DETAIL_SAVE_PUBLICATION_POLICY, type DetailSavePeers } from '@/app/detail-save-plan';
import { FreeImageApplyError, recognizeFreeImage, renderFreeImageTranslation, readFreeImageVisionStatus,
  type FreeImageLoaded, type FreeImageRendered, type FreeImageVisionStatus, type FreeImageRegion } from '@/app/free-image-translation-client';
import { FreeImageVisionError, type FreeImageVisionAttempt } from '@/app/free-image-vision-error';
import { initializeVisionRegions } from '@/app/free-image-vision-style';
import { isVerifiedOriginalPreservation, parseImageTextVisionConfiguration, parseImageTextVisionResult } from '@/app/image-text-vision';
import { parseImageOriginalPreservationProof } from '@/app/image-no-text-proof';
import { hasForeignImageText } from '@/app/selected-image-purpose';
import { optionImageTargets } from '@/app/quotation-image-targets';
import { exactPrimaryQuotationTarget } from '@/app/quotation-seo-targets';
import { isOwnedImageKey } from '@/app/image-files';

type PhotoState = { status: 'applied'|'verified'|'preserved'; key: string; partial?: boolean };
type Peer = { selection: DetailWorkspaceSelection; saved: DetailWorkspaceView; document: DetailWorkspaceDocument };
export type SelectedDetailWorkState = {
  ownerId: string; productId: string; scope?: WorkspaceSettingsScope; settings?: WorkspaceSettings; view?: QuotationFieldsView; content?: ProductContent;
  peers?: Peer[]; current?: Peer; shared?: boolean; photos: Record<string, PhotoState>;
  seed?: { input: DetailWorkspaceSaveInput; attempt: DetailWorkspaceAttempt };
  image?: { photoId: string; image: FreeImageRendered; context: DetailWorkspaceEditorContext; partial: boolean; retryReady?: true };
  inference?: { photoId: string; attempt: FreeImageVisionAttempt; observation?: FreeImageVisionStatus };
  composite?: { input: DetailWorkspaceComposite; attempt: DetailSaveAttempt; retryReady?: true };
};
export type SelectedDetailWorkResult = { status: 'completed'|'partial'|'skipped'|'uncertain'; applied: number; failed: number; skipped: number;
  messages: string[]; productVersion?: string; recovered?: boolean; reused?: true; sourceChanged?: true; inferencePending?: true; verifiedUnchanged?: number };
type Options = { ownerId: string; company: SupplierHubCompany; signal: AbortSignal; fetcher: typeof fetch;
  state: SelectedDetailWorkState; assertCurrent: () => Promise<void>; expectedProductVersion?: string; onProgress?: (message: string) => void };
type Dependencies = { readImage?: typeof readDetailWorkspaceImage; recognize?: typeof recognizeFreeImage; render?: typeof renderFreeImageTranslation;
  applyImage?: typeof applyDetailWorkspaceImage; recoverImage?: typeof recoverDetailWorkspaceImage; observe?: typeof readFreeImageVisionStatus;
  prepareComposite?: typeof prepareDetailWorkspaceComposite; applyComposite?: typeof applyDetailWorkspaceComposite; recoverComposite?: typeof recoverDetailWorkspaceComposite };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const note = (cause: unknown) => cause instanceof Error ? cause.message : '상세 본문 사진 작업을 확인하지 못했습니다.';
class DetailSourceChanged extends Error {}
const changed = () => new DetailSourceChanged('계정·설정·상세 원본 또는 저장 구성이 변경됐습니다. 확인된 결과를 유지하고 현재 구성을 검토해주세요.');
const semantic = (document: DetailWorkspaceDocument) => ({ imageMargin: document.imageMargin,
  photos: document.photos.map(({ role, originKey, key }) => ({ role, originKey, key })) });
export function createSelectedDetailWorkState(ownerId: string, productId: string): SelectedDetailWorkState { return { ownerId, productId, photos: {} }; }

/** Automatic stage five reads exact saved BODY photos. The final quote is an
 * output only; unknown writes retain their original source and are read back. */
export async function processSelectedDetailWork(productId: string, options: Options, deps: Dependencies = {}): Promise<SelectedDetailWorkResult> {
  const { state, signal, fetcher, ownerId } = options, result: SelectedDetailWorkResult = { status: 'partial', applied: 0, failed: 0, skipped: 0, messages: [] };
  const finish = (status: SelectedDetailWorkResult['status'], message: string) => {
    result.status = status; result.messages.push(message);
    const photos = Object.values(state.photos); result.applied = photos.filter(photo => photo.status === 'applied').length;
    result.skipped = photos.filter(photo => photo.status !== 'applied').length;
    const verified = photos.filter(photo => photo.status === 'verified').length; if (verified) result.verifiedUnchanged = verified;
    result.productVersion = state.view?.productVersion; return result;
  };
  async function json(path: string) {
    signal.throwIfAborted(); const response = await fetcher(path, { signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
    const body = await response.json(); signal.throwIfAborted();
    if (!response.ok || response.redirected || !object(body)) throw Error(object(body) && typeof body.error === 'string' ? body.error : '현재 상세 작업 자료를 읽지 못했습니다.');
    return body;
  }
  async function guard() {
    signal.throwIfAborted();
    try { await options.assertCurrent(); } catch { throw changed(); }
    const body = await json('/api/settings'), scope = parseWorkspaceSettingsScope(body.scope);
    if (!scope || scope.ownerId !== ownerId || !same(scope.company, options.company) || !object(body.settings)
      || Object.keys(defaultSettings).some(key => !Object.hasOwn(body.settings as object, key))) throw changed();
    const settings = savedRegistrationSettings(body.settings);
    if (state.scope && !same(state.scope, scope) || state.settings && !same(state.settings, settings)) throw changed();
    state.scope ??= structuredClone(scope); state.settings ??= structuredClone(settings);
  }
  const fieldsUrl = () => `/api/products/${encodeURIComponent(productId)}/quotation-fields${state.current?.selection.profileId ? '?profileId=' + encodeURIComponent(state.current.selection.profileId) : ''}`;
  async function currentView() {
    const view = await json(fieldsUrl()) as QuotationFieldsView;
    if (!view.categoryContext || !['profile','collection'].includes(view.categoryContext.source) || !id(view.categoryContext.categoryId)
      || !Array.isArray(view.categoryContext.categoryPath) || !view.categoryContext.categoryPath.length
      || !Number.isFinite(Date.parse(view.productVersion)) || !Array.isArray(view.resolved?.rows) || !Array.isArray(view.imageKeys)
      || view.imageKeys.some(key => !isOwnedImageKey(ownerId, key)) || !/^[a-f0-9]{64}$/.test(view.inputFingerprint)
      || [view.revision,view.contentRevision,view.optionRevision].some(value => !Number.isSafeInteger(value) || value < 0)) throw changed();
    const rows = view.resolved.rows.filter(row => row.optionId !== null);
    if (!rows.length || rows.some(row => !id(row.optionId) || typeof row.included !== 'boolean') || new Set(rows.map(row => row.optionId)).size !== rows.length) throw changed();
    return view;
  }
  async function exact() {
    await guard(); if (!same(await currentView(), state.view)) throw changed();
    if (state.content && !same((await json(`/api/products/${encodeURIComponent(productId)}/content`)).content,state.content)) throw changed();
    if (state.current && !same(await readDetailWorkspace(state.current.selection, signal, fetcher), state.current.saved)) throw changed();
  }
  function context(photoId: string): DetailWorkspaceEditorContext {
    const current = state.current!, record = current.saved.workspace;
    if (!record || record.document.photos.filter(photo => photo.id === photoId && photo.role === 'body').length !== 1) throw changed();
    return { selection: current.selection, saved: current.saved, target: { kind: 'detail-workspace', profileId: current.selection.profileId ?? null,
      optionId: current.selection.optionId, photoId, revision: record.revision, digest: record.digest } };
  }
  function adopt(reply: DetailWorkspaceImageReply) {
    const current = state.current!;
    if (!reply.workspace || !same(reply.view, state.view) || !same(reply.workspace.company, options.company)) throw changed();
    current.saved = { view: reply.view, workspace: reply.workspace, roles: reply.roles }; current.document = reply.workspace.document;
  }
  function manualOutput(view: QuotationFieldsView) {
    const targets = optionImageTargets(view.resolved.schema.fields), alt = exactPrimaryQuotationTarget(view.resolved.schema.fields,'altText');
    const keys = [...targets.detailImages.linked,...targets.detailHtml.linked,...alt.linked];
    return [view.overrides.common,...Object.values(view.overrides.options)].some(layer => keys.some(key => Object.hasOwn(layer, key)))
      || view.resolved.rows.some(row => keys.some(key => row.fields[key]?.source.startsWith('manual-')));
  }
  try {
    if (!id(productId) || state.ownerId !== ownerId || state.productId !== productId) throw changed();
    await guard();
    // These branches run before ordinary source equality: a committed final
    // save may legitimately have advanced the product clock without its ACK.
    if (state.composite) {
      result.recovered = true; const pending = state.composite;
      if (pending.retryReady) {
        delete pending.retryReady;
        state.view = await (deps.applyComposite ?? applyDetailWorkspaceComposite)(pending.input,pending.attempt,signal,fetcher); await guard(); delete state.composite;
        return finish('completed','확인된 기존 상세 미리보기의 통합 저장을 확인했습니다. 새 번역은 실행하지 않았습니다.');
      }
      const outcome = await (deps.recoverComposite ?? recoverDetailWorkspaceComposite)(pending.input, pending.attempt, signal, fetcher); await guard();
      if (outcome === 'completed' && pending.attempt.completed) { state.view = pending.attempt.completed; delete state.composite; return finish('completed','원래 상세 통합 저장본을 조회로 확인했습니다. 새 추론·업로드·저장은 하지 않았습니다.'); }
      pending.retryReady = true; return finish('partial','원래 상세 저장 상태를 확인했습니다. 보관한 미리보기의 명시적인 적용이 필요합니다.');
    }
    const view = await currentView();
    if (state.view && !same(state.view, view) || !state.view && options.expectedProductVersion !== undefined && view.productVersion !== options.expectedProductVersion) throw changed();
    state.view ??= structuredClone(view);
    if (state.seed) {
      result.recovered = true; const pending = state.seed;
      const saved = pending.attempt.retryReady ? await saveDetailWorkspace(pending.input,pending.attempt,signal,fetcher)
        : await recoverDetailWorkspace(pending.input, pending.attempt, signal, fetcher); await guard();
      if (pending.attempt.completed) { state.current!.saved = saved; state.current!.document = saved.workspace!.document; delete state.seed; }
      return finish('partial','원래 상세 구성 보관 결과를 조회로 확인했습니다. 새 이미지 작업은 하지 않았습니다.');
    }
    if (state.image) {
      result.recovered = true; const pending = state.image;
      if (pending.retryReady) {
        await exact(); delete pending.retryReady;
        const reply = await (deps.applyImage ?? applyDetailWorkspaceImage)(pending.image,pending.context,signal,fetcher); await guard(); adopt(reply);
        state.photos[pending.photoId] = { status:'applied',key:reply.key,partial:pending.partial }; delete state.image;
        return finish('partial','미적용으로 확인된 기존 본문 미리보기의 저장을 확인했습니다. 다음 사진은 실행하지 않았습니다.');
      }
      const reply = await (deps.recoverImage ?? recoverDetailWorkspaceImage)(pending.image, pending.context, signal, fetcher); await guard();
      if (reply.applied) { adopt(reply); state.photos[pending.photoId] = { status: 'applied', key: reply.key, partial: pending.partial }; delete state.image; }
      else pending.retryReady = true;
      return finish('partial','원래 본문 사진 저장 결과를 조회로 확인했습니다. 새 추론이나 다음 사진 저장은 하지 않았습니다.');
    }
    if (!state.settings!.translateImages) return finish('skipped','저장한 기본설정에서 이미지 번역이 꺼져 있어 상세 원본을 유지했습니다.');
    const content = (await json(`/api/products/${encodeURIComponent(productId)}/content`)).content as ProductContent;
    if (!content || content.productId !== productId || content.schemaVersion !== 1 || content.revision !== view.contentRevision || !content.assets?.detail
      || !['manual','collected','translated','generated','unverified'].includes(content.assets.detail.provenance)) throw changed();
    if (state.content && !same(content,state.content)) throw changed(); state.content ??= structuredClone(content);
    if (!state.inference && !state.peers && !Object.keys(state.photos).length) {
      const profileId = view.categoryContext.source === 'profile' ? view.categoryContext.profileId : null;
      const publication = await readCurrentDetailPublication({ productId, ...(profileId ? { profileId } : {}), view }, signal, fetcher);
      await guard();
      if (!same(await currentView(), view) || !same((await json(`/api/products/${encodeURIComponent(productId)}/content`)).content, content)) throw changed();
      if (publication.status === 'current') { result.reused = true; return finish('completed','현재 원본·설정·모든 옵션과 일치하는 기존 상세 발행본을 조회로 확인했습니다. 새 추론·업로드·저장은 하지 않았습니다.'); }
      if (publication.status === 'review-required') return finish('partial','기존 상세 발행본의 원본·설정·옵션·직접 편집 내용을 확인해야 합니다. 새 추론·업로드·저장 없이 개별 검토를 유지했습니다.');
    }
    if (content.assets.detail.provenance === 'manual') return finish('skipped','직접 저장한 상세 원본 역할과 공란을 유지했습니다. 자동 구성·추론·저장은 실행하지 않았습니다.');
    if (!state.peers) {
      const profileId = view.categoryContext.source === 'profile' ? view.categoryContext.profileId : null;
      const peers: Peer[] = [];
      for (const row of view.resolved.rows.filter(row => row.optionId !== null)) {
        const selection = { productId, optionId: row.optionId!, ...(profileId ? { profileId } : {}), view };
        const saved = await readDetailWorkspace(selection, signal, fetcher); await guard();
        if (saved.workspace && !same(saved.workspace.company, options.company)) throw changed();
        peers.push({ selection, saved, document: initialDetailWorkspaceDocument(saved, row.optionId!) });
      }
      state.peers = peers; state.current = peers.find(peer => view.resolved.rows.find(row => row.optionId === peer.selection.optionId)?.included);
      if (!state.current) return finish('partial','상세 작업에 포함된 옵션이 없습니다.');
      state.shared = peers.every(peer => same(semantic(peer.document), semantic(state.current!.document)));
    }
    const current = state.current!;
    if (!current.document.photos.some(photo => photo.role === 'body')) return finish('partial','보관한 원본 구성에 번역할 본문 사진이 없습니다. 최종 견적 이미지를 대신 읽지 않았습니다.');
    await exact();
    if (!current.saved.workspace) {
      const input = await createDetailWorkspaceSave(current.selection, current.saved, current.document);
      state.seed = { input, attempt: {} };
      try { current.saved = await saveDetailWorkspace(input, state.seed.attempt, signal, fetcher); current.document = current.saved.workspace!.document; await guard(); delete state.seed; }
      catch (cause) { if (state.seed && !state.seed.attempt.pending && !state.seed.attempt.completed) delete state.seed; throw cause; }
    }
    if (state.inference) {
      const pending = state.inference;
      const observation = await (deps.observe ?? readFreeImageVisionStatus)(pending.attempt, signal, fetcher); await guard();
      if (observation.requestId !== pending.attempt.requestId || !same(observation.source,pending.attempt.source)
        || !same(observation.configuration,pending.attempt.configuration) || observation.readOnly !== true || observation.execution?.requests !== 0) throw changed();
      if (observation.status !== 'completed') {
        if (observation.status === 'failed') { delete state.inference; result.recovered = true; return finish('partial','원래 Vision 요청의 확정 실패를 확인했습니다. 새 추론은 실행하지 않았습니다.'); }
        result.inferencePending = true; return finish('partial','원래 상세 Vision 요청의 결과가 미확정입니다. 같은 요청만 조회하며 새 추론은 실행하지 않았습니다.');
      }
      pending.observation = observation;
    }
    for (const [photoIndex,photo] of current.saved.workspace!.document.photos.filter(row => row.role === 'body').entries()) {
      if (state.photos[photo.id]) {
        if (state.photos[photo.id].key !== photo.key || state.photos[photo.id].partial) return finish('partial','미완료 본문 번역을 원문과 함께 개별 편집에서 검토해주세요. 자동 재번역하지 않았습니다.');
        continue;
      }
      await exact(); const bound = context(photo.id); let image: FreeImageLoaded | undefined;
      const controller = new AbortController(), abort = () => controller.abort(signal.reason); signal.addEventListener('abort',abort,{once:true});
      const timer = setTimeout(() => controller.abort(Error('상세 본문 사진의 처리 시간이 90초를 초과했습니다.')),90000);
      try {
        options.onProgress?.(`상세 본문 사진 ${photoIndex + 1} 원문·번역 확인 중`);
        image = await (deps.readImage ?? readDetailWorkspaceImage)(bound,controller.signal,fetcher); controller.signal.throwIfAborted();
        if (!image.source.workspaceTarget || image.source.quotationTarget || image.source.workspaceTarget.photoId !== photo.id
          || image.source.workspaceTarget.optionId !== bound.target.optionId || image.source.workspaceTarget.revision !== bound.target.revision
          || image.source.workspaceTarget.digest !== bound.target.digest || image.source.productVersion !== view.productVersion || image.source.productId !== productId
          || image.source.contentRevision !== view.contentRevision || image.source.role !== 'detail'
          || (image.source.editorSource?.resultKey ?? image.source.sourceKey) !== photo.key) throw changed();
        const file = current.saved.workspace!.files.find(file => file.key === photo.key);
        if (!file || (image.source.editorSource?.resultSha256 ?? image.source.sourceSha256) !== file.sha256
          || !image.source.editorSource && (image.width !== file.width || image.height !== file.height || image.source.width !== file.width || image.source.height !== file.height)) throw changed();
        if (image.editDocument) {
          if (image.editDocument.regions.some(region => region.issue?.trim() || region.selected && !region.erase && region.text.trim()
            && (!region.translated.trim() || region.translationProvenance === 'empty'))) return finish('partial','보관한 본문 사진에 미완료 번역이 있습니다. 편집 문서를 유지하고 개별 검토가 필요합니다.');
          state.photos[photo.id] = { status: 'preserved', key: photo.key }; continue;
        }
        const configuration = parseImageTextVisionConfiguration(image.visionConfiguration);
        if (!configuration?.configured) throw Error('상세 작업공간의 설정된 Vision 원본 연결이 없어 중단했습니다. 브라우저 OCR이나 다른 제공자로 자동 전환하지 않았습니다.');
        // Loading pixels is asynchronous. Recheck the saved opt-in and exact
        // source immediately before the potentially paid recognition request.
        await exact(); controller.signal.throwIfAborted();
        if (image.noTextProof) {
          const proof = parseImageOriginalPreservationProof(image.noTextProof);
          if (!proof || proof.productId !== productId || proof.sourceKey !== image.source.sourceKey || proof.sourceSha256 !== image.source.sourceSha256
            || proof.width !== image.width || proof.height !== image.height || proof.sourceLanguage !== 'zh' || !same(proof.configuration,configuration)) throw changed();
          if (state.inference && (state.inference.photoId !== photo.id || !same(state.inference.attempt.source,image.source))) throw changed();
          const recovered = !!state.inference; state.photos[photo.id] = { status: 'verified', key: photo.key }; delete state.inference;
          if (recovered) { result.recovered = true; return finish('partial','원래 Vision 요청의 원본 보존 검사 결과를 확인했습니다. 다음 사진은 실행하지 않았습니다.'); }
          continue;
        }
        let regions: FreeImageRegion[];
        if (state.inference) {
          const pending = state.inference;
          if (pending.photoId !== photo.id || !same(pending.attempt.source,image.source) || !same(pending.attempt.configuration,configuration)) throw changed();
          const observed = parseImageTextVisionResult(pending.observation?.result,image.width,image.height); if (!observed) throw changed();
          image.visionResult = observed; image.visionRequestId = pending.attempt.requestId;
          const styled = initializeVisionRegions(observed.blocks,image.canvas,image.width,image.height); regions = styled.regions; image.visionStyleIssues = styled.issues;
        } else {
          await guard(); controller.signal.throwIfAborted();
          try { regions = await (deps.recognize ?? recognizeFreeImage)(image,'zh',controller.signal,options.onProgress); }
          catch (cause) { if (!isVerifiedOriginalPreservation(image.visionResult)) throw cause; regions = []; }
        }
        controller.signal.throwIfAborted();
        if (isVerifiedOriginalPreservation(image.visionResult)) { const recovered = !!state.inference; state.photos[photo.id] = { status: 'verified', key: photo.key }; delete state.inference;
          if (recovered) { result.recovered = true; return finish('partial','원래 Vision 요청의 원본 보존 검사 결과를 확인했습니다. 다음 사진은 실행하지 않았습니다.'); } continue; }
        if (!image.visionResult || image.visionResult.inspection?.decision === 'unreadable' || image.visionStyleIssues?.length) throw Error('상세 본문 문구·영역·스타일을 끝까지 검증하지 못했습니다. 원본을 유지했습니다.');
        const selected = regions.filter(region => region.selected && hasForeignImageText(region.text));
        const accepted = selected.filter(region => region.translationProvenance === 'generated' && region.translated.trim() && !region.issue);
        if (!accepted.length) throw Error('검증된 한국어 본문 번역이 없습니다. 원본을 유지하며 다른 번역 제공자를 요청하지 않았습니다.');
        const chosen = new Set(accepted.map(region => region.id)), partial = accepted.length !== selected.length;
        const prepared = regions.map(region => chosen.has(region.id) ? { ...region, backgroundMode: 'inpaint-telea-v1' as const }
          : { ...region, selected: false, ...(selected.includes(region) ? { translated: '', translationProvenance: 'empty' as const, issue: '자동 번역 미완료: 원문과 번역을 개별 편집에서 확인해주세요.' } : {}) });
        const rendered = await (deps.render ?? renderFreeImageTranslation)(image,prepared,controller.signal,[],undefined,'zh'); controller.signal.throwIfAborted();
        await exact(); const recovered = !!state.inference; state.image = { photoId: photo.id, image: rendered, context: bound, partial };
        try { const reply = await (deps.applyImage ?? applyDetailWorkspaceImage)(rendered,bound,controller.signal,fetcher); await guard(); adopt(reply);
          state.photos[photo.id] = { status: 'applied', key: reply.key, partial }; delete state.image; delete state.inference; }
        catch (cause) { if (cause instanceof FreeImageApplyError && !cause.uncertain) delete state.image; throw cause; }
        if (partial) return finish('partial','검증된 일부 본문 문구만 편집 가능한 초안으로 보관했습니다. 미완료 원문은 개별 검토가 필요해 통합 저장하지 않았습니다.');
        if (recovered) { result.recovered = true; return finish('partial','원래 Vision 요청의 번역과 해당 본문 사진 저장을 확인했습니다. 새 추론이나 다음 사진 작업은 하지 않았습니다.'); }
      } finally { clearTimeout(timer); signal.removeEventListener('abort',abort); if (image?.canvas) { image.canvas.width = 0; image.canvas.height = 0; } }
    }
    await exact();
    if (!state.shared || manualOutput(view) || content.detail?.altText?.provenance === 'manual' || content.detail?.description?.provenance === 'manual')
      return finish('partial','본문 번역은 보관했습니다. 옵션별 구성 또는 직접 저장한 상세 이미지·HTML·대체 설명·공란을 보존하기 위해 전체 옵션 통합 저장은 하지 않았습니다. 상세 편집에서 적용 범위를 검토해주세요.');
    for (const peer of state.peers!) if (peer !== current && !same(await readDetailWorkspace(peer.selection,signal,fetcher),peer.saved)) throw changed();
    await exact();
    const peers: DetailSavePeers = state.peers!.map(peer => ({ optionId: peer.selection.optionId,
      workspace: peer.saved.workspace ? { revision: peer.saved.workspace.revision, digest: peer.saved.workspace.digest } : null }));
    const input = await (deps.prepareComposite ?? prepareDetailWorkspaceComposite)(current.selection,current.saved,signal,fetcher,peers,DETAIL_SAVE_PUBLICATION_POLICY); await exact();
    state.composite = { input, attempt: {} };
    const next = await (deps.applyComposite ?? applyDetailWorkspaceComposite)(input,state.composite.attempt,signal,fetcher); await guard();
    state.view = next; delete state.composite;
    return finish('completed','현재 원본 BODY 사진의 번역과 상단·하단 순서를 보존한 상세 통합 저장을 확인했습니다.');
  } catch (cause) {
    if (cause instanceof FreeImageVisionError && cause.uncertain) {
      const photoId = cause.attempt.source.workspaceTarget?.photoId;
      if (photoId) { state.inference = { photoId, attempt: cause.attempt }; result.inferencePending = true; }
    }
    signal.throwIfAborted(); result.failed++;
    if (cause instanceof DetailSourceChanged) result.sourceChanged = true;
    return finish(state.seed?.attempt.pending || state.image || state.composite?.attempt.pending ? 'uncertain' : 'partial',note(cause));
  }
}
