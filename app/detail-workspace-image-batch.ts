import { readDetailWorkspace, validateDetailWorkspaceReply, type DetailWorkspaceSelection } from '@/app/detail-workspace-client';
import type { DetailWorkspaceView } from '@/app/detail-workspace';
import { applyDetailWorkspaceImage, readDetailWorkspaceImage, recoverDetailWorkspaceImage, translateDetailWorkspaceImage,
  type DetailWorkspaceEditorContext, type DetailWorkspaceImageReply } from '@/app/detail-workspace-image-client';
import { FreeImageApplyError, FreeImageVisionError, readFreeImageVisionStatus, recognizeFreeImage, renderFreeImageTranslation, sameFreeImageSource,
  type FreeImageVisionAttempt,
  type FreeImageLoaded, type FreeImageRegion, type FreeImageRendered } from '@/app/free-image-translation-client';
import type { FreeImageEditDocument } from '@/app/free-image-edit-document';
import type { FreeImageSource } from '@/app/free-image-translation';
import {isVerifiedOriginalPreservation,parseImageTextVisionConfiguration,parseImageTextVisionResult} from '@/app/image-text-vision';
import {parseImageOriginalPreservationProof} from '@/app/image-no-text-proof';
import {initializeVisionRegions} from '@/app/free-image-vision-style';

export const WORKSPACE_BATCH_BYTES = 30 * 1024 * 1024;
export type DetailWorkspaceBatchItem = {
  photoId: string; position: number; sourceKey: string; originKey: string;
  status: 'pending' | 'ready' | 'failed' | 'applied' | 'uncertain' | 'unchanged'; message: string;
  texts: { original: string; translated: string }[]; rendered?: FreeImageRendered; originalEditDocument?: FreeImageEditDocument;
  attempt?: { image: FreeImageRendered; context: DetailWorkspaceEditorContext; reply?: DetailWorkspaceImageReply };
  visionAttempt?: { image: FreeImageLoaded; request: FreeImageVisionAttempt };
  appliedKey?: string;
};
export type DetailWorkspaceImageBatch = { selection: DetailWorkspaceSelection; saved: DetailWorkspaceView; language: 'zh' | 'en'; items: DetailWorkspaceBatchItem[]; lastReply?: DetailWorkspaceImageReply };
type Dependencies = { fetcher?: typeof fetch; recognize?: typeof recognizeFreeImage; translate?: typeof translateDetailWorkspaceImage; render?: typeof renderFreeImageTranslation };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const changed = () => Error('작업 사진의 상품·옵션·원본·순서 또는 저장 구성이 변경됐습니다. 준비한 결과는 유지됩니다. 최신 구성을 확인해주세요.');
const note = (cause: unknown) => cause instanceof Error ? cause.message : '작업 사진의 번역 결과를 확인하지 못했습니다.';
const replace = (batch: DetailWorkspaceImageBatch, item: DetailWorkspaceBatchItem): DetailWorkspaceImageBatch => ({ ...batch, items: batch.items.map(row => row.photoId === item.photoId ? item : row) });
const viewOf = (reply: DetailWorkspaceImageReply): DetailWorkspaceView => ({ view: reply.view, workspace: reply.workspace, roles: reply.roles });
function editor(batch: Pick<DetailWorkspaceImageBatch, 'selection' | 'saved'>, photoId: string): DetailWorkspaceEditorContext {
  const record = batch.saved.workspace, photo = record?.document.photos.filter(row => row.id === photoId);
  if (!record || photo?.length !== 1 || photo[0].role !== 'body') throw changed();
  return { selection: batch.selection, saved: batch.saved, target: { kind: 'detail-workspace', profileId: batch.selection.profileId ?? null,
    optionId: batch.selection.optionId, photoId, revision: record.revision, digest: record.digest } };
}
async function exact(batch: Pick<DetailWorkspaceImageBatch, 'selection' | 'saved'>, signal: AbortSignal, deps: Dependencies) {
  const current = await readDetailWorkspace(batch.selection, signal, deps.fetcher); signal.throwIfAborted();
  if (!same(current, batch.saved)) throw changed(); return current;
}
function originalSource(source: FreeImageSource): FreeImageSource {
  if (!source.workspaceTarget || source.quotationTarget || source.optionImages) throw changed();
  return { ...source, workspaceTarget: { ...source.workspaceTarget, revision: 1, digest: '0'.repeat(64), bindingSha256: '0'.repeat(64) } };
}
function matchesPhoto(image: FreeImageLoaded, batch: DetailWorkspaceImageBatch, entry: DetailWorkspaceBatchItem) {
  const photo = batch.saved.workspace?.document.photos[entry.position], proof = batch.saved.workspace?.files.find(file => file.key === entry.sourceKey);
  if (!photo || photo.role !== 'body' || photo.id !== entry.photoId || photo.originKey !== entry.originKey || photo.key !== entry.sourceKey || !proof
    || (image.source.editorSource?.resultKey ?? image.source.sourceKey) !== entry.sourceKey
    || (image.source.editorSource?.resultSha256 ?? image.source.sourceSha256) !== proof.sha256) throw changed();
}
function visionResult(image:FreeImageLoaded){
  const result=parseImageTextVisionResult(image.visionResult,image.width,image.height),configuration=parseImageTextVisionConfiguration(image.visionConfiguration);
  if(!configuration?.configured||!result||result.model!==configuration.model)throw Error('설정된 Vision의 원본·번역 검증을 확인하지 못했습니다. 다른 번역 제공자를 요청하지 않았습니다.');
  return result;
}
const unchanged=(entry:DetailWorkspaceBatchItem):DetailWorkspaceBatchItem=>({...entry,status:'unchanged',visionAttempt:undefined,message:'서버가 원본 보존 검사 결과를 확인했습니다. 실물 인쇄를 포함한 원본 사진은 변경하지 않았습니다.'});
async function preview(batch:DetailWorkspaceImageBatch,entry:DetailWorkspaceBatchItem,image:FreeImageLoaded,regions:FreeImageRegion[],signal:AbortSignal,deps:Dependencies):Promise<DetailWorkspaceBatchItem>{
  let prepared:FreeImageRegion[],texts:DetailWorkspaceBatchItem['texts'],message='';
  if(image.visionConfiguration!==undefined){
    const result=visionResult(image),chosen=regions.filter(region=>region.selected),editable=result.blocks.filter(block=>block.kind===undefined||block.kind==='overlay');
    if(result.inspection?.decision==='unreadable'||!editable.length||image.visionStyleIssues?.length||chosen.length!==editable.length
      ||chosen.some(region=>region.translationProvenance!=='generated'||!region.translated.trim()||region.issue)
      ||editable.some(block=>!chosen.some(region=>region.id===block.id&&region.text===block.text&&region.translated===block.translated&&same(region.box,block.box))))throw Error('Vision의 문구·한국어·영역을 끝까지 검증하지 못했습니다. 원본을 유지하며 개별 이미지 편집에서 확인해주세요.');
    prepared=regions.map(region=>region.selected?{...region,backgroundMode:'inpaint-telea-v1'}:region);
    texts=chosen.map(region=>({original:region.text,translated:region.translated}));
  }else{
    const chosen=regions.filter(region=>region.selected&&(batch.language==='zh'?/\p{Script=Han}/u.test(region.text):!/\p{Script=Han}/u.test(region.text)&&/[a-z]{2}/iu.test(region.text)));
    if(!chosen.length)throw Error('확실하게 읽은 문구가 없습니다. 개별 이미지 편집에서 원문과 영역을 확인해주세요.');
    const translated=await(deps.translate??translateDetailWorkspaceImage)(image.source,batch.language,chosen.map(({id,text})=>({id,text})),signal,deps.fetcher);signal.throwIfAborted();
    const results=new Map(translated.regions.map(region=>[region.id,region]));
    if(chosen.some(region=>!results.get(region.id)?.translated||results.get(region.id)?.issue))throw Error(['일부 문구를 번역하지 못했습니다. 원본을 유지합니다.',...translated.warnings].join(' '));
    prepared=regions.map(region=>results.has(region.id)?{...region,translated:results.get(region.id)!.translated!,issue:null,translationProvenance:'generated'}:{...region,selected:false});
    texts=chosen.map(region=>({original:region.text,translated:results.get(region.id)!.translated!}));message=translated.warnings.join(' ');
  }
  const rendered=await(deps.render??renderFreeImageTranslation)(image,prepared,signal,[],undefined,batch.language);signal.throwIfAborted();
  if(!sameFreeImageSource(rendered.source,image.source)||!rendered.editDocument)throw changed();
  if(batch.items.reduce((bytes,item)=>bytes+(item.photoId===entry.photoId?0:item.rendered?.output.size??0),0)+rendered.output.size>WORKSPACE_BATCH_BYTES)throw Error('일괄 미리보기 30MB 한도입니다. 준비한 결과를 먼저 검토해주세요.');
  await exact(batch,signal,deps);
  return {...entry,status:'ready',rendered,visionAttempt:undefined,originalEditDocument:image.editDocument,texts,message};
}

/** Stored BODY rows only. Preparation never saves an image or quotation. */
export async function prepareDetailWorkspaceImageBatch(input: Omit<DetailWorkspaceImageBatch, 'items'>, signal: AbortSignal,
  onProgress: (batch: DetailWorkspaceImageBatch, message: string) => void = () => {}, deps: Dependencies = {}): Promise<DetailWorkspaceImageBatch> {
  if((input as Partial<DetailWorkspaceImageBatch>).items?.some(item=>item.status==='uncertain'))throw changed();
  const saved = await validateDetailWorkspaceReply(input.selection, input.saved); signal.throwIfAborted();
  if (!saved.workspace || !['zh', 'en'].includes(input.language)) throw changed();
  let batch: DetailWorkspaceImageBatch = { ...structuredClone({ ...input, saved }), items: saved.workspace.document.photos.flatMap((photo, position) => photo.role === 'body'
    ? [{ photoId: photo.id, position, sourceKey: photo.key, originKey: photo.originKey, status: 'pending' as const, message: '', texts: [] }] : []) };
  if (!batch.items.length) throw Error('보관한 구성에 번역할 본문 사진이 없습니다.');
  await exact(batch, signal, deps); let position = 0;
  for (const entry of batch.items) {
    signal.throwIfAborted(); position++; onProgress(batch, `${position}/${batch.items.length} 본문 사진 번역 준비 중…`);
    let image:FreeImageLoaded|undefined;
    try {
      image = await readDetailWorkspaceImage(editor(batch, entry.photoId), signal, deps.fetcher); signal.throwIfAborted(); matchesPhoto(image, batch, entry);
      if (image.editDocument) throw Error('보관한 편집 문서가 있는 사진은 일괄 번역하지 않습니다. 자르기·수동 문구·브러시·스타일을 유지하며 개별 이미지 편집에서 확인해주세요.');
      if(image.visionConfiguration!==undefined&&!parseImageTextVisionConfiguration(image.visionConfiguration)?.configured)throw Error('이미지 Vision이 설정되지 않았습니다. 다른 문구 인식·번역 서비스로 자동 전환하지 않았습니다.');
      let verifiedNoText=false;
      if(image.noTextProof){const proof=parseImageOriginalPreservationProof(image.noTextProof);if(!proof||proof.productId!==image.source.productId||proof.sourceKey!==image.source.sourceKey||proof.sourceSha256!==image.source.sourceSha256||proof.width!==image.width||proof.height!==image.height||!same(proof.configuration,image.visionConfiguration))throw changed();verifiedNoText=proof.sourceLanguage===batch.language;}
      if(verifiedNoText)batch=replace(batch,unchanged(entry));
      else{
        let regions:FreeImageRegion[]=[];
        try{regions=await(deps.recognize??recognizeFreeImage)(image,batch.language,signal,message=>onProgress(batch,`${position}/${batch.items.length} · ${message}`));}
        catch(cause){if(!isVerifiedOriginalPreservation(image.visionResult))throw cause;}
        signal.throwIfAborted();
        batch=replace(batch,image.visionConfiguration!==undefined&&isVerifiedOriginalPreservation(visionResult(image))?unchanged(entry):await preview(batch,entry,image,regions,signal,deps));
      }
    } catch (cause) {
      if(image&&cause instanceof FreeImageVisionError&&cause.uncertain){batch=replace(batch,{...entry,status:'uncertain',message:note(cause),visionAttempt:{image,request:cause.attempt}});onProgress(batch,'원래 Vision 요청의 상태를 먼저 확인해주세요. 다음 사진은 실행하지 않았습니다.');return batch;}
      signal.throwIfAborted(); batch = replace(batch, { ...entry, status: 'failed', message: note(cause) });
    }
    onProgress(batch, `${position}/${batch.items.length} 본문 사진 준비 완료`);
  }
  return batch;
}

/** Only our own exactly confirmed prior save can advance the source binding of an untouched row. */
export async function applyDetailWorkspaceBatchResult(batch: DetailWorkspaceImageBatch, photoId: string, signal: AbortSignal,
  onProgress: (batch: DetailWorkspaceImageBatch) => void = () => {}, deps: Dependencies = {}): Promise<DetailWorkspaceImageBatch> {
  const entry = batch.items.find(row => row.photoId === photoId);
  if (!entry?.rendered || entry.status !== 'ready' || batch.items.some(row => row.status === 'uncertain')) throw changed();
  await exact(batch, signal, deps); const context = editor(batch, photoId), fresh = await readDetailWorkspaceImage(context, signal, deps.fetcher); signal.throwIfAborted(); matchesPhoto(fresh, batch, entry);
  const old = entry.rendered.source, advanced = batch.items.some(row => row.status === 'applied');
  if (!sameFreeImageSource(originalSource(old), originalSource(fresh.source)) || !same(entry.originalEditDocument, fresh.editDocument)
    || !advanced && !sameFreeImageSource(old, fresh.source)) throw changed();
  const image = { ...entry.rendered, source: fresh.source }, attempt: NonNullable<DetailWorkspaceBatchItem['attempt']> = { image, context };
  let next = replace(batch, { ...entry, attempt, status: 'uncertain', message: '이 작업 사진의 보관 결과를 확인하고 있습니다.' }); onProgress(next);
  try {
    attempt.reply = await applyDetailWorkspaceImage(image, context, signal, deps.fetcher); signal.throwIfAborted();
    const saved = viewOf(attempt.reply); await exact({ selection: batch.selection, saved }, signal, deps);
    next = replace({ ...next, saved, lastReply: attempt.reply }, { ...entry, status: 'applied', appliedKey: attempt.reply.key, message: '작업 사진에 적용했습니다.' }); onProgress(next); return next;
  } catch (cause) {
    next = replace(next, { ...entry, attempt, status: attempt.reply || !(cause instanceof FreeImageApplyError) || cause.uncertain ? 'uncertain' : 'ready', message: note(cause) }); onProgress(next); throw cause;
  }
}

/** Recovery classifies this exact retained attempt and never replays an image write or starts the next row. */
export async function recoverDetailWorkspaceBatchResult(batch: DetailWorkspaceImageBatch, signal: AbortSignal,
  onProgress: (batch: DetailWorkspaceImageBatch) => void = () => {}, deps: Dependencies = {}): Promise<DetailWorkspaceImageBatch> {
  const entry = batch.items.find(row => row.status === 'uncertain'); if(!entry)throw changed();
  if(entry.visionAttempt){
    const pending=entry.visionAttempt,observed=await readFreeImageVisionStatus(pending.request,signal,deps.fetcher);signal.throwIfAborted();
    if(observed.status!=='completed'){
      const failed=observed.status==='failed',next=replace(batch,{...entry,status:failed?'failed':'uncertain',visionAttempt:failed?undefined:pending,message:failed?'원래 Vision 요청이 실패했습니다. 원본을 유지했습니다.':'원래 Vision 요청의 완료를 확인하지 못했습니다. 새 추론과 다음 사진은 요청하지 않았습니다.'});onProgress(next);return next;
    }
    await exact(batch,signal,deps);const image=await readDetailWorkspaceImage(editor(batch,entry.photoId),signal,deps.fetcher);matchesPhoto(image,batch,entry);
    if(image.editDocument||!sameFreeImageSource(image.source,pending.request.source)||!same(image.visionConfiguration,pending.request.configuration))throw changed();
    image.visionResult=observed.result!;image.visionRequestId=pending.request.requestId;image.visionExecution={requests:0,cached:true};
    let item:DetailWorkspaceBatchItem;
    try{
      const result=visionResult(image);
      if(isVerifiedOriginalPreservation(result))item=unchanged(entry);
      else{const styled=initializeVisionRegions(result.blocks,image.canvas,image.width,image.height);image.visionStyleIssues=styled.issues;item=await preview(batch,entry,image,styled.regions,signal,deps);}
    }catch(cause){signal.throwIfAborted();item={...entry,status:'failed',visionAttempt:undefined,message:note(cause)};}
    const next=replace(batch,item);onProgress(next);return next;
  }
  if (!entry.attempt) throw changed();
  const attempt = entry.attempt, reply = await recoverDetailWorkspaceImage(attempt.image, attempt.context, signal, deps.fetcher); signal.throwIfAborted();
  if (!reply.applied) {
    await exact({ selection: batch.selection, saved: attempt.context.saved }, signal, deps);
    const next = replace(batch, { ...entry, status: 'ready', attempt: undefined, message: '아직 적용되지 않았습니다. 다시 검토한 뒤 적용해주세요.' }); onProgress(next); return next;
  }
  const saved = viewOf(reply); await exact({ selection: batch.selection, saved }, signal, deps);
  const next = replace({ ...batch, saved, lastReply: reply }, { ...entry, status: 'applied', attempt: undefined, appliedKey: reply.key, message: '보관한 번역 결과를 확인했습니다.' }); onProgress(next); return next;
}
