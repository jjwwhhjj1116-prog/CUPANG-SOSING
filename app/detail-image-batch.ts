import { applyQuotationChanges, duplicateQuotationImageIssue, quotationImageRoleIssues, type QuotationFieldsView } from '@/app/quotation-schema';
import { exactDetailHtmlTarget, optionImageTargets, quotationImageKeys } from '@/app/quotation-image-targets';
import { exactPrimaryQuotationTarget } from '@/app/quotation-seo-targets';
import { PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-pool-limit';
import {
  applyFreeImageTranslation, FreeImageApplyError, readFreeImageSource, recognizeFreeImage,
  recoverFreeImageTranslation, renderFreeImageTranslation, sameFreeImageSource, translateFreeImageRegions,
  type FreeImageApplyReply, type FreeImageRegion, type FreeImageRendered,
} from '@/app/free-image-translation-client';

export type DetailBatchItem = {
  slotIndex: number; sourceKey: string; status: 'pending' | 'ready' | 'failed' | 'applied' | 'uncertain' | 'skipped';
  message: string; texts: { original: string; translated: string }[]; rendered?: FreeImageRendered;
  attempt?: { image: FreeImageRendered; before: QuotationFieldsView; reply?: FreeImageApplyReply }; appliedKey?: string;
  // A verified image save is distinct from complete translation coverage.
  // Keep this marker through the existing apply/recovery item copies.
  translationReview?: { status: 'partial'; acceptedRegions: number; unresolvedRegions: number; message: string };
};
export type DetailImageBatch = {
  productId: string; optionId: string; profileId: string | null; language: 'zh' | 'en';
  stage?: 'main' | 'detail' | 'additional';
  view: QuotationFieldsView; items: DetailBatchItem[];
};
type Dependencies = {
  fetcher?: typeof fetch;
  readSource?: typeof readFreeImageSource;
  recognize?: typeof recognizeFreeImage;
  translate?: typeof translateFreeImageRegions;
  render?: typeof renderFreeImageTranslation;
};
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
const changed = () => Error('상품·카테고리·옵션 또는 이미지가 변경됐습니다. 검토 결과는 보존했습니다. 저장 상태를 확인한 뒤 최신 이미지 목록으로 다시 준비해주세요.');
const endpoint = (batch: Pick<DetailImageBatch, 'productId' | 'profileId'>) => `/api/products/${encodeURIComponent(batch.productId)}/quotation-fields${batch.profileId ? `?profileId=${encodeURIComponent(batch.profileId)}` : ''}`;
export const DETAIL_BATCH_BYTES = 30 * 1024 * 1024;
export function detailBatchCapacity(view: Pick<QuotationFieldsView, 'imageKeys'>) {
  if (!Array.isArray(view?.imageKeys) || view.imageKeys.length > PRODUCT_IMAGE_POOL_LIMIT || new Set(view.imageKeys).size !== view.imageKeys.length) throw changed();
  return PRODUCT_IMAGE_POOL_LIMIT - view.imageKeys.length;
}

export function detailBatchSelection(view: QuotationFieldsView, optionId: string, profileId: string | null, stage: 'main' | 'detail' | 'additional' = 'detail') {
  if (!view || !Number.isFinite(Date.parse(view.productVersion)) || !/^[a-f0-9]{64}$/.test(view.inputFingerprint)
    || ![view.revision, view.contentRevision, view.optionRevision].every(value => Number.isSafeInteger(value) && value >= 0)
    || !Array.isArray(view.imageKeys) || view.imageKeys.length > PRODUCT_IMAGE_POOL_LIMIT || new Set(view.imageKeys).size !== view.imageKeys.length
    || !view.overrides?.common || !view.overrides.options || !Array.isArray(view.resolved?.schema?.fields)
    || !Array.isArray(view.resolved.rows) || !Array.isArray(view.automatic?.rows)
    || !/^[A-Za-z0-9_-]{1,80}$/.test(optionId) || !view.categoryContext
    || profileId !== null && view.categoryContext.profileId !== profileId || !['main', 'detail', 'additional'].includes(stage)) throw changed();
  const target = stage === 'main' ? exactPrimaryQuotationTarget(view.resolved.schema.fields, 'mainImage')
    : optionImageTargets(view.resolved.schema.fields)[stage === 'additional' ? 'additionalImages' : 'detailImages'];
  const rows = view.resolved.rows.filter(row => row.optionId === optionId), value = rows[0]?.fields[target.primary]?.value;
  if (rows.length !== 1 || rows[0].included !== true || typeof value !== 'string' || target.fields.some(field => field.readOnly)
    || target.linked.some(id => rows[0].fields[id]?.value !== value)) throw changed();
  const keys = quotationImageKeys(value), limit = Math.min(stage === 'main' ? 1 : 30, ...target.fields.map(field => field.maxItems ?? 30));
  if (keys.length > limit || new Set(keys).size !== keys.length || keys.some(key => !view.imageKeys.includes(key))) throw changed();
  return { target, value, keys };
}
/** Keep the saved field and its slot positions intact. Settings banners are
 * display content, not translation inputs, regardless of their list position. */
export function detailBatchTranslationSlots(view: QuotationFieldsView, optionId: string, profileId: string | null, stage: 'main' | 'detail' | 'additional' = 'detail') {
  const { keys } = detailBatchSelection(view, optionId, profileId, stage);
  if (stage === 'main' || stage === 'additional') return { keys, slots: keys.map((_, index) => index), protectedSlots: [] as number[] };
  const protectedKeys = view.protectedDetailImageKeys;
  if (!Array.isArray(protectedKeys) || protectedKeys.length > PRODUCT_IMAGE_POOL_LIMIT || new Set(protectedKeys).size !== protectedKeys.length
    || protectedKeys.some(key => typeof key !== 'string' || !view.imageKeys.includes(key)))
    throw Error('상단·하단 설정 이미지의 연결을 확인하지 못했습니다. 최신 상세 이미지 목록을 다시 조회해주세요.');
  const protectedSet = new Set(protectedKeys), slots: number[] = [], protectedSlots: number[] = [];
  keys.forEach((key, index) => (protectedSet.has(key) ? protectedSlots : slots).push(index));
  return { keys, slots, protectedSlots };
}
function translatableSlot(batch: DetailImageBatch, slotIndex: number, view = batch.view) {
  if (!Number.isSafeInteger(slotIndex) || !detailBatchTranslationSlots(view, batch.optionId, batch.profileId, batch.stage).slots.includes(slotIndex))
    throw Error('상단·하단 설정 이미지는 번역하지 않고 유지합니다. 최신 본문 이미지 목록을 확인해주세요.');
}
export async function readDetailBatchView(batch: Pick<DetailImageBatch, 'productId' | 'optionId' | 'profileId' | 'stage'>, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  signal.throwIfAborted();
  const response = await fetcher(endpoint(batch), { cache: 'no-store', signal }), body = await response.json() as QuotationFieldsView & { error?: string };
  signal.throwIfAborted();
  if (!response.ok) throw Error(body.error || '저장한 이미지 목록을 읽지 못했습니다.');
  detailBatchSelection(body, batch.optionId, batch.profileId, batch.stage); return body;
}
function targetFor(batch: DetailImageBatch, slotIndex: number) {
  const selected = detailBatchSelection(batch.view, batch.optionId, batch.profileId, batch.stage);
  return { kind: 'quotation' as const, profileId: batch.profileId, optionId: batch.optionId, input: batch.stage === 'main' ? 'mainImage' as const : batch.stage === 'additional' ? 'additionalImages' as const : 'detailImages' as const,
    fieldKey: selected.target.primary, slotIndex, revision: batch.view.revision, inputFingerprint: batch.view.inputFingerprint,
    optionRevision: batch.view.optionRevision, value: selected.value };
}
const replace = (batch: DetailImageBatch, item: DetailBatchItem) => ({ ...batch, items: batch.items.map(row => row.slotIndex === item.slotIndex ? item : row) });
const note = (cause: unknown) => cause instanceof Error ? cause.message : '이 이미지의 번역 결과를 준비하지 못했습니다.';

/** Prepare only the saved option's ordered stage slots. OCR canvases are
 * released between images; no uploads or product writes occur here. */
export async function prepareDetailImageBatch(input: Omit<DetailImageBatch, 'items'>, signal: AbortSignal,
  onProgress: (batch: DetailImageBatch, message: string) => void = () => {}, deps: Dependencies = {}): Promise<DetailImageBatch> {
  signal.throwIfAborted();
  const selected = detailBatchTranslationSlots(input.view, input.optionId, input.profileId, input.stage);
  const label = input.stage === 'main' ? '대표 이미지' : input.stage === 'additional' ? '추가 이미지' : '상세 이미지', role = input.stage === 'main' ? 'main' : input.stage === 'additional' ? 'additional' : 'detail';
  if (!selected.keys.length) throw Error(`저장한 선택 옵션의 ${label}를 먼저 선택해주세요.`);
  if (!selected.slots.length) throw Error('번역할 본문 이미지가 없습니다. 상단·하단 설정 이미지는 그대로 유지합니다.');
  if (!detailBatchCapacity(input.view)) throw Error('새 번역 결과를 저장할 이미지 공간이 없습니다. 원본을 유지했으며 일괄 번역을 시작하지 않았습니다.');
  let batch: DetailImageBatch = { ...input, items: selected.keys.map((sourceKey, slotIndex) => ({ slotIndex, sourceKey,
    status: selected.protectedSlots.includes(slotIndex) ? 'skipped' : 'pending',
    message: selected.protectedSlots.includes(slotIndex) ? '상단·하단 설정 이미지는 번역하지 않고 유지합니다.' : '', texts: [] })) };
  let bytes = 0, position = 0;
  for (const entry of batch.items) {
    if (entry.status === 'skipped') continue;
    signal.throwIfAborted(); position++; onProgress(batch, `${position}/${selected.slots.length} ${label} 번역 준비 중…`);
    try {
      signal.throwIfAborted();
      const image = await (deps.readSource ?? readFreeImageSource)(batch.productId, batch.view.productVersion, entry.sourceKey, role, signal, deps.fetcher, targetFor(batch, entry.slotIndex));
      signal.throwIfAborted();
      const regions = await (deps.recognize ?? recognizeFreeImage)(image, batch.language, signal, message => onProgress(batch, `${position}/${selected.slots.length} · ${message}`));
      signal.throwIfAborted();
      if(image.visionStyleIssues?.length)throw Error(`Vision 초기 스타일 검토가 필요합니다: ${image.visionStyleIssues.join(', ')}. 원본을 유지했습니다. 이미지 편집에서 문구와 영역을 확인해주세요.`);
      const chosen = regions.filter(region => region.selected && (batch.language === 'zh'
        ? /\p{Script=Han}/u.test(region.text) : !/\p{Script=Han}/u.test(region.text) && /[a-z]{2}/iu.test(region.text)));
      if (!chosen.length) throw Error('확실하게 읽은 문구가 없습니다. 개별 이미지 편집에서 원문과 영역을 확인해주세요.');
      const translated = image.visionResult?{regions:chosen.map(row=>({id:row.id,original:row.text,translated:row.translated||null,issue:row.issue})),warnings:[image.visionResult.notice]}
        :await (deps.translate ?? translateFreeImageRegions)(image.source, batch.language, chosen.map(({ id, text }) => ({ id, text })), signal, deps.fetcher);
      signal.throwIfAborted();
      const results = new Map(translated.regions.map(region => [region.id, region]));
      if (chosen.some(region => !results.get(region.id)?.translated || results.get(region.id)?.issue))
        throw Error(['일부 문구를 번역하지 못했습니다. 원본을 유지합니다.', ...translated.warnings, ...translated.regions.flatMap(row => row.issue ? [row.issue] : [])].join(' '));
      const prepared: FreeImageRegion[] = regions.map(region => results.has(region.id)
        ? { ...region, translated: results.get(region.id)!.translated!, issue: null, translationProvenance: 'generated' } : { ...region, selected: false });
      const rendered = await (deps.render ?? renderFreeImageTranslation)(image, prepared, signal, [], undefined, batch.language);
      signal.throwIfAborted();
      if (bytes + rendered.output.size > DETAIL_BATCH_BYTES) throw Error('일괄 미리보기 30MB 한도입니다. 이미 준비한 결과를 먼저 검토하고 나머지는 개별 번역해주세요.');
      bytes += rendered.output.size;
      batch = replace(batch, { ...entry, status: 'ready', rendered, texts: chosen.map(region => ({ original: region.text, translated: results.get(region.id)!.translated! })),
        message: translated.warnings.join(' ') });
    } catch (cause) {
      signal.throwIfAborted(); batch = replace(batch, { ...entry, status: 'failed', message: note(cause) });
    }
    onProgress(batch, `${position}/${selected.slots.length} ${label} 준비 완료`);
  }
  return batch;
}

function verifyCommit(batch: DetailImageBatch, before: QuotationFieldsView, after: QuotationFieldsView, slotIndex: number, reply: FreeImageApplyReply) {
  const prior = detailBatchSelection(before, batch.optionId, batch.profileId, batch.stage), next = detailBatchSelection(after, batch.optionId, batch.profileId, batch.stage);
  const value = prior.value.split('\n').map((line, index, lines) => {
    const position = lines.slice(0, index + 1).filter(part => part.trim()).length - 1;
    return line.trim() && position === slotIndex ? reply.key : line;
  }).join('\n');
  const expected = applyQuotationChanges(before.overrides, prior.target.linked.map(fieldKey => ({ fieldKey, optionId: batch.optionId, value })));
  if (after.revision !== before.revision + 1 || after.revision !== reply.quotationRevision || after.productVersion !== reply.productVersion
    || after.updatedAt !== after.productVersion || after.inputFingerprint !== reply.quotationInputFingerprint
    || after.contentRevision !== before.contentRevision || after.optionRevision !== before.optionRevision
    || !same(after.categoryContext, before.categoryContext) || !same(after.resolved.schema, before.resolved.schema)
    || !same(after.automatic, before.automatic) || !same(after.imageKeys, [...before.imageKeys, reply.key])
    || !same(after.overrides, expected) || next.value !== value) throw changed();
  const html = exactDetailHtmlTarget(before.resolved.schema.fields).linked;
  if (after.resolved.rows.length !== before.resolved.rows.length) throw changed();
  for (const row of before.resolved.rows) {
    const stored = after.resolved.rows.find(value => value.optionId === row.optionId);
    if (!stored || stored.optionLabel !== row.optionLabel || stored.included !== row.included || !same(Object.keys(stored.fields).sort(), Object.keys(row.fields).sort())) throw changed();
    for (const [id, field] of Object.entries(row.fields)) {
      if (row.optionId === batch.optionId && prior.target.linked.includes(id)) {
        if (stored.fields[id]?.value !== value || stored.fields[id]?.source !== 'manual-option') throw changed();
      } else if (batch.stage === 'main' && row.optionId === batch.optionId && id === 'detailImages') {
        // Its saved detail value stays exact; replacing main can only change
        // the resolver's main/detail duplicate reminder on this same row.
        const issues = [...field.issues.filter(issue => issue !== duplicateQuotationImageIssue), ...quotationImageRoleIssues(value, field.value)];
        const expected = { ...field, issues, needsReview: Boolean(before.resolved.schema.fields.find(field => field.id === id)?.reviewRequired) || issues.length > 0 };
        if (!same(stored.fields[id], expected)) throw changed();
      } else if (!((batch.stage === undefined || batch.stage === 'detail') && row.optionId === batch.optionId && html.includes(id) && !['manual-common', 'manual-option'].includes(field.source))
        && !same(stored.fields[id], field)) throw changed();
    }
  }
}

/** Every result is an explicit, individually proved commit. A lost ACK stops
 * the sequence; recovery never automatically writes or advances to the next. */
export async function applyDetailBatchResult(batch: DetailImageBatch, slotIndex: number, signal: AbortSignal,
  onProgress: (batch: DetailImageBatch) => void = () => {}, deps: Dependencies = {}): Promise<DetailImageBatch> {
  const entry = batch.items.find(row => row.slotIndex === slotIndex);
  if (!entry?.rendered || entry.status !== 'ready' || batch.items.some(row => row.status === 'uncertain')) throw Error('검토한 미적용 번역 결과를 선택해주세요.');
  translatableSlot(batch, slotIndex);
  const current = await readDetailBatchView(batch, signal, deps.fetcher);
  if (!same(current, batch.view)) throw changed();
  translatableSlot(batch, slotIndex, current);
  if (!detailBatchCapacity(current)) throw Error('새 번역 결과를 저장할 이미지 공간이 없습니다. 원본을 유지했으며 업로드하지 않았습니다.');
  const selected = detailBatchSelection(current, batch.optionId, batch.profileId, batch.stage);
  if (selected.keys[slotIndex] !== entry.sourceKey) throw changed();
  const refreshed = await (deps.readSource ?? readFreeImageSource)(batch.productId, current.productVersion, entry.sourceKey, batch.stage === 'main' ? 'main' : batch.stage === 'additional' ? 'additional' : 'detail', signal, deps.fetcher, targetFor(batch, slotIndex));
  const old = entry.rendered.source, fresh = refreshed.source;
  const oldTarget = old.quotationTarget, freshTarget = fresh.quotationTarget;
  if (old.productId !== fresh.productId || old.role !== fresh.role || old.sourceKey !== fresh.sourceKey || old.sourceSha256 !== fresh.sourceSha256 || old.width !== fresh.width || old.height !== fresh.height
    || old.contentRevision !== fresh.contentRevision || old.quotationTarget?.optionRevision !== fresh.quotationTarget?.optionRevision
    || !oldTarget || !freshTarget || oldTarget.profileId !== freshTarget.profileId || oldTarget.optionId !== freshTarget.optionId
    || oldTarget.input !== freshTarget.input || oldTarget.fieldKey !== freshTarget.fieldKey || oldTarget.slotIndex !== freshTarget.slotIndex
    || !batch.items.some(row => row.status === 'applied') && !sameFreeImageSource(old, fresh)) throw changed();
  const image = { ...entry.rendered, source: fresh }, attempt = { image, before: current } as NonNullable<DetailBatchItem['attempt']>;
  // Publish the exact retry proof before dispatch. Even a user cancellation
  // after the upload starts must retain an uncertain outcome for this PNG.
  let next = replace(batch, { ...entry, attempt, status: 'uncertain', message: '이 이미지의 저장 결과를 확인하고 있습니다.' }); onProgress(next);
  try {
    attempt.reply = await applyFreeImageTranslation(image, signal, deps.fetcher);
    const after = await readDetailBatchView(batch, signal, deps.fetcher); verifyCommit(batch, current, after, slotIndex, attempt.reply);
    next = replace({ ...next, view: after }, { ...entry, status: 'applied', appliedKey: attempt.reply.key, message: '견적서에 적용했습니다.' });
    onProgress(next); return next;
  } catch (cause) {
    // An acknowledged write followed by an unreadable or changed GET is also
    // uncertain: retain the original proof and PNG for read-only recovery.
    next = replace(next, { ...entry, attempt, status: attempt.reply || !(cause instanceof FreeImageApplyError) || cause.uncertain ? 'uncertain' : 'ready', message: note(cause) });
    onProgress(next); throw cause;
  }
}

export async function recoverDetailBatchResult(batch: DetailImageBatch, signal: AbortSignal,
  onProgress: (batch: DetailImageBatch) => void = () => {}, deps: Dependencies = {}): Promise<DetailImageBatch> {
  const entry = batch.items.find(row => row.status === 'uncertain');
  if (!entry?.attempt) throw Error('저장 결과를 확인할 번역 이미지가 없습니다.');
  const attempt = entry.attempt, reply = await recoverFreeImageTranslation(attempt.image, signal, deps.fetcher);
  const current = await readDetailBatchView(batch, signal, deps.fetcher);
  if (!reply.applied) {
    if (!same(current, attempt.before)) throw changed();
    if (!detailBatchTranslationSlots(current, batch.optionId, batch.profileId, batch.stage).slots.includes(entry.slotIndex)) {
      const next = replace(batch, { ...entry, status: 'skipped', attempt: undefined, rendered: undefined, texts: [], message: '아직 적용되지 않았습니다. 상단·하단 설정 이미지는 번역하지 않고 유지합니다.' }); onProgress(next); return next;
    }
    const next = replace(batch, { ...entry, status: 'ready', attempt: undefined, message: '아직 적용되지 않았습니다. 검토 후 다시 적용할 수 있습니다.' }); onProgress(next); return next;
  }
  verifyCommit(batch, attempt.before, current, entry.slotIndex, reply);
  const next = replace({ ...batch, view: current }, { ...entry, status: 'applied', appliedKey: reply.key, attempt: undefined, message: '저장된 번역 결과를 확인했습니다.' });
  onProgress(next); return next;
}
