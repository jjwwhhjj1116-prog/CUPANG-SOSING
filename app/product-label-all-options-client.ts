import { planAllProductLabels, verifyAllProductLabelTextSave, allProductLabelImageChanges, verifyAllProductLabelImageSave, type AllProductLabelPlan } from '@/app/product-label-all-options';
import { verifyProductLabelsView, type ProductLabelDraft, type ProductLabelsView, type ProductLabelStructure } from '@/app/product-label';
import { completeProductLabelSave } from '@/app/product-label-save';
import { findProductLabelUpload, type ProductLabelUploadCache } from '@/app/product-label-upload';
import { productLabelReferenceSelection, type ProductLabelAttachment } from '@/app/product-label-attachment';
import { applyQuotationChanges, type QuotationChange, type QuotationFieldsView } from '@/app/quotation-schema';
import { exactPrimaryQuotationTarget } from '@/app/quotation-seo-targets';
import type { DocumentImagePlan } from '@/app/document-image';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const conflict = () => Error('전체 옵션 라벨 저장 중 내용·옵션·견적 기준이 변경되었습니다. 저장 결과를 확인하고 현재 입력을 유지해주세요.');
export type AllProductLabelAttempt = {
  productId: string; endpoint: string; quotationEndpoint: string; sourceOptionId: string | null; before: ProductLabelsView; plan: AllProductLabelPlan;
  textRequested: boolean; textView?: ProductLabelsView; commonBefore?: QuotationFieldsView; attachment?: ProductLabelAttachment;
  imageBefore?: QuotationFieldsView; imageChanges?: QuotationChange[]; imageRequested: boolean;
};
export function prepareAllProductLabelSave(input: { productId: string; endpoint: string; quotationEndpoint: string; sourceOptionId: string | null; view: ProductLabelsView; draft?: ProductLabelDraft; structure?: ProductLabelStructure }): AllProductLabelAttempt {
  verifyProductLabelsView(input.view, input.sourceOptionId);
  if (input.view.productId !== input.productId) throw conflict();
  const base = `/api/products/${encodeURIComponent(input.productId)}`, label = new URL(input.endpoint, 'https://local.invalid'), quote = new URL(input.quotationEndpoint, 'https://local.invalid');
  if (label.origin !== 'https://local.invalid' || quote.origin !== label.origin || label.pathname !== base + '/product-labels' || quote.pathname !== base + '/quotation-fields'
    || label.search !== quote.search || label.hash || quote.hash || [...label.searchParams.keys()].some(key => key !== 'profileId') || label.searchParams.getAll('profileId').length > 1) throw conflict();
  return { productId: input.productId, endpoint: input.endpoint, quotationEndpoint: input.quotationEndpoint, sourceOptionId: input.sourceOptionId,
    before: structuredClone(input.view), plan: planAllProductLabels(input.view, input.sourceOptionId, input.draft, input.structure), textRequested: false, imageRequested: false };
}

function verifyPair(labels: ProductLabelsView, quote: QuotationFieldsView, attempt: AllProductLabelAttempt) {
  verifyProductLabelsView(labels, null);
  if (labels.productId !== attempt.productId || !quote || quote.productVersion !== labels.productVersion || quote.revision !== labels.quotationRevision
    || quote.inputFingerprint !== labels.quotationInputFingerprint || quote.contentRevision !== labels.contentRevision || quote.optionRevision !== labels.optionRevision
    || !same(quote.imageKeys, labels.imageKeys) || !same(quote.categoryContext, labels.categoryContext)
    || !same(quote.resolved?.rows?.map(row => [row.optionId, row.optionLabel, row.included]), labels.rows.map(row => [row.optionId, row.optionLabel, row.included]))) throw conflict();
}
function verifyTextContinuation(attempt: AllProductLabelAttempt, current: ProductLabelsView) {
  const saved = attempt.textView!;
  if (current.updatedAt !== saved.updatedAt || Date.parse(current.productVersion) < Date.parse(saved.productVersion)) throw conflict();
  // Only the confirmed image phases may advance product/pool/quotation clocks.
  // The label revision, exact values, sources, automatic values and structure
  // still have to be the original atomic all-text acknowledgement.
  verifyAllProductLabelTextSave(attempt.before, { ...current, productVersion: saved.productVersion, updatedAt: saved.updatedAt,
    imageKeys: attempt.before.imageKeys, quotationRevision: attempt.before.quotationRevision }, attempt.plan);
}
function verifyUnrelatedQuotation(before: QuotationFieldsView, after: QuotationFieldsView) {
  const target = exactPrimaryQuotationTarget(before.resolved.schema.fields, 'labelImages'), omitted = new Set(target.linked);
  if (!same(before.automatic, after.automatic) || !same(before.resolved.schema, after.resolved.schema)
    || !same(before.resolved.rows.map(row => ({ ...row, fields: Object.fromEntries(Object.entries(row.fields).filter(([id]) => !omitted.has(id))) })),
      after.resolved.rows.map(row => ({ ...row, fields: Object.fromEntries(Object.entries(row.fields).filter(([id]) => !omitted.has(id))) })))) throw conflict();
}
async function verifyCommonProgress(attempt: AllProductLabelAttempt, quote: QuotationFieldsView, key: string | null, request: typeof fetch) {
  const before = attempt.commonBefore!;
  verifyUnrelatedQuotation(before, quote);
  if (!same(before.categoryContext, quote.categoryContext) || before.contentRevision !== quote.contentRevision || before.optionRevision !== quote.optionRevision
    || !same(before.packagingBasis, quote.packagingBasis) || !same(before.stageTwoMsrp, quote.stageTwoMsrp)
    || !same(before.overrides.options, quote.overrides.options) || Date.parse(quote.productVersion) < Date.parse(before.productVersion)) throw conflict();
  const pools = [before.imageKeys, ...(key && !before.imageKeys.includes(key) ? [[...before.imageKeys, key]] : [])];
  if (!pools.some(pool => same(pool, quote.imageKeys))) throw conflict();
  if (quote.revision === before.revision && same(quote.overrides, before.overrides)) return;
  if (!key || quote.revision !== before.revision + 1) throw conflict();
  const selection = await productLabelReferenceSelection({ productId: attempt.productId, view: before, optionId: null, renderEpoch: attempt.textView?.renderEpoch }, key, request);
  const changes = selection.target.linked.map(fieldKey => ({ optionId: null, fieldKey, value: selection.next.join('\n') }));
  if (!same(quote.overrides, applyQuotationChanges(before.overrides, changes))) throw conflict();
  for (const row of quote.resolved.rows) for (const id of selection.target.linked) {
    const own = row.optionId === null ? undefined : before.overrides.options[row.optionId];
    const value = own && Object.hasOwn(own, id) ? own[id] : selection.next.join('\n');
    if (row.fields[id]?.value !== value) throw conflict();
  }
}

/** One explicit reviewed operation, resumable through its exact retained phase.
 * Every retry reads first. A lost acknowledgement never causes a second text
 * save, a new PNG recipe or a repeated committed final quotation write. */
export async function completeAllProductLabelSave(attempt: AllProductLabelAttempt, input: {
  cache: Map<string, ProductLabelUploadCache>; assertCurrent: () => void;
  render: (plan: DocumentImagePlan) => Promise<{ blob: Blob; width: number; height: number }>;
}, fetcher: typeof fetch = fetch): Promise<ProductLabelAttachment> {
  const request: typeof fetch = async (url, init) => { input.assertCurrent(); const response = await fetcher(url, init); input.assertCurrent(); return response; };
  async function read<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await request(url, { cache: 'no-store', ...init }), body = await response.json() as T & { error?: string }; input.assertCurrent();
    if (!response.ok) throw Error(body?.error || '전체 옵션 라벨 저장 상태를 확인하지 못했습니다.'); return body;
  }
  const labels = () => read<ProductLabelsView>(attempt.endpoint);
  async function pair() {
    const view = await labels(), quotation = await read<QuotationFieldsView>(attempt.quotationEndpoint), confirmed = await labels();
    if (!same(view, confirmed)) throw conflict(); verifyPair(confirmed, quotation, attempt); return { view: confirmed, quotation };
  }
  if (!attempt.textView) {
    const current = await labels(); verifyProductLabelsView(current, attempt.sourceOptionId);
    if (attempt.textRequested && !same(current, attempt.before)) {
      verifyAllProductLabelTextSave(attempt.before, current, attempt.plan); attempt.textView = current;
    } else {
      if (!same(current, attempt.before)) throw conflict();
      attempt.textRequested = true;
      const saved = await read<ProductLabelsView>(attempt.endpoint, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        action: 'apply-all-text', sourceOptionId: attempt.sourceOptionId, expectedRevision: attempt.before.revision, expectedInputFingerprint: attempt.before.inputFingerprint,
        values: attempt.plan.values, structure: attempt.plan.structure }) });
      verifyAllProductLabelTextSave(attempt.before, saved, attempt.plan); attempt.textView = saved;
    }
  }
  if (!attempt.attachment) {
    const current = await pair(); verifyTextContinuation(attempt, current.view);
    if (!attempt.commonBefore) {
      if (!same(current.view, attempt.textView)) throw conflict();
      attempt.commonBefore = current.quotation;
    } else {
      const receipt = await findProductLabelUpload({ productId: attempt.productId, endpoint: attempt.endpoint, optionId: null, view: attempt.textView }, request);
      await verifyCommonProgress(attempt, current.quotation, receipt.key, request);
    }
    attempt.attachment = await completeProductLabelSave({ productId: attempt.productId, endpoint: attempt.endpoint, quotationEndpoint: attempt.quotationEndpoint,
      optionId: null, view: current.view, cache: input.cache, render: input.render, assertCurrent: input.assertCurrent }, request);
    verifyTextContinuation(attempt, attempt.attachment.view);
  }
  const current = await pair(); verifyTextContinuation(attempt, current.view);
  if (attempt.imageBefore) {
    if (!same(current.quotation, attempt.imageBefore)) {
      verifyAllProductLabelImageSave(attempt.imageBefore, current.quotation, attempt.imageChanges!); verifyUnrelatedQuotation(attempt.imageBefore, current.quotation);
      return { ...current, key: attempt.attachment.key };
    }
  } else {
    if (!same(current.view, attempt.attachment.view) || !same(current.quotation, attempt.attachment.quotation)) throw conflict();
    attempt.imageBefore = current.quotation; attempt.imageChanges = allProductLabelImageChanges(current.quotation, attempt.attachment.key);
  }
  const changes = attempt.imageChanges!;
  if (!changes.length) { verifyAllProductLabelImageSave(current.quotation, current.quotation, changes); return { ...current, key: attempt.attachment.key }; }
  attempt.imageRequested = true;
  const saved = await read<QuotationFieldsView>(attempt.quotationEndpoint, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    expectedRevision: attempt.imageBefore.revision, expectedInputFingerprint: attempt.imageBefore.inputFingerprint, changes }) });
  verifyAllProductLabelImageSave(attempt.imageBefore, saved, changes); verifyUnrelatedQuotation(attempt.imageBefore, saved);
  const confirmed = await pair(); verifyTextContinuation(attempt, confirmed.view);
  verifyAllProductLabelImageSave(attempt.imageBefore, confirmed.quotation, changes); verifyUnrelatedQuotation(attempt.imageBefore, confirmed.quotation);
  if (!same(saved, confirmed.quotation)) throw conflict();
  return { ...confirmed, key: attempt.attachment.key };
}
