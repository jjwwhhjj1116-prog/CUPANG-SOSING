import { parseCollectionRequest, collectionKeywords, type CollectionJob } from '@/app/sourcing';
import { capturedCollectionCompany } from '@/app/collection-company';
import { confirmCategorySelectionProfile } from '@/app/category-selection-confirmation';
import { validateSettings } from '@/app/workspace-settings';
import { parseWorkspaceSettingsScope, type WorkspaceSettingsScope } from '@/app/workspace-settings-scope';
import { validateCollectionReceiptResponse } from '@/app/collection-receipt-response';
import type { BrowserProductCapture } from '@/app/browser-product-bridge';
import type { IntakeRow } from '@/app/intake-queue';

export type PendingIntakeSourcePreview = { format: 'pending-intake-source-v1'; scope: WorkspaceSettingsScope;
  job: CollectionJob; receiptHash: string | null; executionStarted: false };
const fail = () => Error('기존 대기 요청의 회사·URL·원문 또는 저장 상태가 변경되었습니다. 현재 입력을 유지하고 다시 확인해주세요.');
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value);
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const canonical = (value: unknown): string => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item)))
    : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical((value as Record<string, unknown>)[key]))])) : value ?? null);
const hash = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
const jobDefinition = (job: CollectionJob) => ({ id: job.id, offer_id: job.offer_id, source_url: job.source_url, goal: job.goal,
  status: job.status, created_at: job.created_at, updated_at: job.updated_at, context: job.context });
async function body(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  const value: unknown = await response.json(); signal.throwIfAborted();
  if (!response.ok || !value || typeof value !== 'object' || Array.isArray(value)) throw Error(value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : fail().message);
  return value as Record<string, unknown>;
}
async function scope(ownerId: string | undefined, signal: AbortSignal, fetcher: typeof fetch) {
  const value = await body(await fetcher('/api/settings', { cache: 'no-store', signal }), signal);
  const current = parseWorkspaceSettingsScope(value.scope);
  if (!current?.company || ownerId !== undefined && current.ownerId !== ownerId) throw fail();
  return current;
}
function validateJob(value: unknown, row: Pick<IntakeRow, 'pendingJobId' | 'url'>, current: WorkspaceSettingsScope): CollectionJob {
  const job = value as CollectionJob, [request] = parseCollectionRequest({ urls: [row.url], goal: 'collect' });
  if (!job || !id(row.pendingJobId) || job.id !== row.pendingJobId || job.source_url !== request.sourceUrl || job.offer_id !== request.offerId
    || job.status !== 'awaiting_connector' || !['collect', 'price', 'work'].includes(job.goal) || !timestamp(job.created_at) || !timestamp(job.updated_at)
    || job.received_at != null && !timestamp(job.received_at) || job.product_id != null && !id(job.product_id) || !job.context || !timestamp(job.context.capturedAt)) throw fail();
  const captured = capturedCollectionCompany(job.context);
  if (!captured || !current.company || canonical(captured) !== canonical(current.company)) throw fail();
  const category = job.context.category;
  confirmCategorySelectionProfile({ key: category.id, categoryId: category.categoryId, path: category.categoryPath, isLeaf: true,
    evidence: 'saved', childrenObserved: false, templateLinked: Boolean(category.template), codeEvidence: 'saved', codeObservedAt: null }, category, undefined, current.company);
  validateSettings(job.context.settings);
  if (typeof job.context.features !== 'string' || job.context.features.length > 2000 || typeof job.context.keywords !== 'string' || job.context.keywords.length > 2000) throw fail();
  collectionKeywords(job.context.keywords);
  return job;
}
async function read(row: Pick<IntakeRow, 'pendingJobId' | 'url'>, ownerId: string | undefined, signal: AbortSignal, fetcher: typeof fetch): Promise<PendingIntakeSourcePreview> {
  signal.throwIfAborted(); const current = await scope(ownerId, signal, fetcher);
  if(!id(row.pendingJobId))throw fail();
  const result = await body(await fetcher('/api/collection-jobs?id='+encodeURIComponent(row.pendingJobId), { cache: 'no-store', signal }), signal);
  const job = validateJob(result.job, row, current);
  const receipt = await body(await fetcher(`/api/collection-jobs/${encodeURIComponent(job.id)}/result`, { cache: 'no-store', signal }), signal);
  const source = validateCollectionReceiptResponse(receipt, job.id, job.offer_id);
  if (source ? source.sourceUrl !== job.source_url || (receipt.receipt as { receivedAt?: unknown })?.receivedAt !== job.received_at : job.received_at != null) throw fail();
  if (canonical(current) !== canonical(await scope(ownerId, signal, fetcher))) throw fail();
  return { format: 'pending-intake-source-v1', scope: current, job, receiptHash: source ? await hash(source) : null, executionStarted: false };
}
/** A read-only review does not collect, translate, import, cancel or change input. */
export async function previewPendingIntakeSource(row: IntakeRow, ownerId: string | undefined, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  return read(row, ownerId, signal, fetcher);
}
/** Prepare only an immutable source and its first product. No image download,
 * SEO, settings/context rewrite or cancellation occurs. The caller subsequently
 * uses the existing explicit new-draft preview/create workflow. */
export async function preparePendingIntakeSource(preview: PendingIntakeSourcePreview, row: IntakeRow, ownerId: string | undefined, signal: AbortSignal,
  options: { fetcher?: typeof fetch; captureFromBrowser?: (sourceUrl: string, signal: AbortSignal) => Promise<BrowserProductCapture> } = {}) {
  const fetcher = options.fetcher ?? fetch;
  if (preview.format !== 'pending-intake-source-v1' || preview.executionStarted !== false || preview.job.id !== row.pendingJobId) throw fail();
  let latest = await read(row, ownerId, signal, fetcher);
  const sameDefinition = (value: PendingIntakeSourcePreview) => canonical(value.scope) === canonical(preview.scope) && canonical(jobDefinition(value.job)) === canonical(jobDefinition(preview.job));
  if (!sameDefinition(latest)) throw fail();
  // Another user may already have prepared this source. Read its strict fork
  // preview next; never run collection or product import on that working item.
  if (latest.job.product_id) return { job: latest.job, productId: latest.job.product_id, receiptHash:latest.receiptHash, reused: true };
  if (latest.job.received_at !== preview.job.received_at || latest.receiptHash !== preview.receiptHash) throw fail();
  if (!latest.receiptHash) {
    let response = await fetcher(`/api/collection-jobs/${encodeURIComponent(latest.job.id)}/collect`, { method: 'POST', signal });
    let value = await response.json() as Record<string, unknown>; signal.throwIfAborted();
    if (!response.ok && value.code === 'SOURCE_NOT_COLLECTED' && options.captureFromBrowser) {
      const captured = await options.captureFromBrowser(latest.job.source_url, signal); signal.throwIfAborted();
      latest = await read(row, ownerId, signal, fetcher);
      if (!sameDefinition(latest)) throw fail();
      if (latest.job.product_id) return { job: latest.job, productId: latest.job.product_id, receiptHash:latest.receiptHash, reused: true };
      if (latest.receiptHash || latest.job.received_at != null) throw fail();
      response = await fetcher(`/api/collection-jobs/${encodeURIComponent(latest.job.id)}/browser-capture`, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(captured) });
      value = await response.json() as Record<string, unknown>; signal.throwIfAborted();
    }
    if (!response.ok) throw Error(typeof value.error === 'string' ? value.error : fail().message);
    const received = validateCollectionReceiptResponse(value, latest.job.id, latest.job.offer_id);
    const receivedAt = (value.receipt as { receivedAt?: unknown })?.receivedAt;
    if (!received || received.sourceUrl !== latest.job.source_url || !timestamp(receivedAt)) throw fail();
    latest = await read(row, ownerId, signal, fetcher);
    if (!sameDefinition(latest) || latest.job.received_at !== receivedAt || latest.receiptHash !== await hash(received)) throw fail();
    if (latest.job.product_id) return { job: latest.job, productId: latest.job.product_id, receiptHash:latest.receiptHash, reused: true };
  }
  // Re-read immediately before first promotion. A concurrently linked product
  // is returned without POST; the existing product route is also idempotent.
  const beforeProduct = await read(row, ownerId, signal, fetcher);
  if (!sameDefinition(beforeProduct) || beforeProduct.receiptHash !== latest.receiptHash || beforeProduct.job.received_at !== latest.job.received_at) throw fail();
  if (beforeProduct.job.product_id) return { job: beforeProduct.job, productId: beforeProduct.job.product_id, receiptHash:beforeProduct.receiptHash, reused: true };
  const promoted = await body(await fetcher(`/api/collection-jobs/${encodeURIComponent(beforeProduct.job.id)}/product`, { method: 'POST', signal }), signal);
  if (!id(promoted.productId)) throw fail();
  const confirmed = await read(row, ownerId, signal, fetcher);
  if (!sameDefinition(confirmed) || confirmed.receiptHash !== beforeProduct.receiptHash || confirmed.job.received_at !== beforeProduct.job.received_at || confirmed.job.product_id !== promoted.productId) throw fail();
  return { job: confirmed.job, productId: promoted.productId, receiptHash:confirmed.receiptHash, reused: promoted.reused === true };
}
