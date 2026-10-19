import { readSeoWorkspace } from '@/app/seo-workspace-client';
import type { SeoWorkspaceView } from '@/app/seo-workspace';
import { supplierHubCompany, type SupplierHubCompany } from '@/app/supplier-hub-company';

export type BatchSeoProduct = { id: string; title: string; updated_at?: string };
export type BatchSeoTask = { productId: string; productTitle: string; productVersion: string; contentRevision: number; optionRevision: number;
  brand: string; sourceIdentity: string; missingFields: string[] };
export type BatchSeoPlan = { ownerId: string; company: SupplierHubCompany; tasks: BatchSeoTask[]; products: BatchSeoProduct[]; messages: { productId: string; message: string }[] };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const changed = () => Error('현재 계정·회사 또는 상품 원문이 변경됐습니다. SEO 검토 목록을 다시 준비해주세요.');
async function read(path: string, signal: AbortSignal, fetcher: typeof fetch) {
  signal.throwIfAborted(); const response = await fetcher(path, { cache: 'no-store', signal }), body: unknown = await response.json(); signal.throwIfAborted();
  if (!response.ok) throw Error(object(body) && typeof body.error === 'string' ? body.error : '저장한 SEO 자료를 읽지 못했습니다.'); return body;
}
async function account(signal: AbortSignal, fetcher: typeof fetch) {
  const value = await read('/api/supplier-hub/catalog-context', signal, fetcher);
  if (!object(value) || !id(value.ownerId) || !object(value.company) || !supplierHubCompany(value.company.code, value.company.name)) throw changed();
  return { ownerId: value.ownerId, company: supplierHubCompany(value.company.code, value.company.name)! };
}
async function assertAccount(plan: Pick<BatchSeoPlan, 'ownerId' | 'company'>, signal: AbortSignal, fetcher: typeof fetch) { if (!same(await account(signal, fetcher), { ownerId: plan.ownerId, company: plan.company })) throw changed(); }
async function snapshot(productId: string, signal: AbortSignal, fetcher: typeof fetch) {
  const base = `/api/products/${encodeURIComponent(productId)}`, view = await readSeoWorkspace(productId, fetcher, signal);
  const source = await read(base + '/translation-source', signal, fetcher), registration = await read(base + '/registration-settings', signal, fetcher);
  if (!object(source) || source.productId !== productId || source.productVersion !== view.productVersion || typeof source.title !== 'string' || typeof source.description !== 'string'
    || !Array.isArray(source.attributes) || !object(source.requestContext) || !id(source.requestContext.categoryId) || !Array.isArray(source.requestContext.categoryPath)
    || !object(registration) || registration.productId !== productId || !object(registration.settings) || typeof registration.settings.brand !== 'string') throw changed();
  const fresh = await readSeoWorkspace(productId, fetcher, signal); if (!same(view, fresh)) throw changed();
  const sourceIdentity = canonical({ title: source.title, description: source.description, attributes: source.attributes, jobId: source.jobId, sourceUrl: source.sourceUrl, requestContext: source.requestContext, brand: registration.settings.brand });
  return { view, brand: registration.settings.brand, sourceIdentity, source };
}
function missing(view: SeoWorkspaceView, source: { title?: unknown; description?: unknown }) {
  const result: string[] = [];
  for (const key of ['title', 'keywords', 'description'] as const) {
    const field = view.content.seo[key];
    // Explicit manual blanks are reviewed decisions, never regeneration targets.
    if (field.provenance === 'manual') continue;
    if (key === 'description' && typeof source.description === 'string' && !source.description.trim() && !String(field.value).trim()) continue;
    const present = Array.isArray(field.value) ? field.value.some(value => value.trim()) : field.value.trim();
    if (!present || !['translated', 'generated'].includes(field.provenance)) result.push(({ title: '상품명', keywords: '검색태그', description: '상품 설명' })[key]);
  }
  return result;
}
/** GET-only inventory. It never starts a provider, adopts a draft or repairs a
 * protected manual blank. Completion here means saved SEO review, not listing. */
export async function planBatchSeoWork(products: BatchSeoProduct[], signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<BatchSeoPlan> {
  if (!Array.isArray(products) || products.length > 100 || products.some(product => !product || !id(product.id) || typeof product.title !== 'string')) throw changed();
  const plan: BatchSeoPlan = { ...await account(signal, fetcher), products: [], tasks: [], messages: [] };
  for (const product of [...new Map(products.map(value => [value.id, value])).values()]) {
    const value = await snapshot(product.id, signal, fetcher); await assertAccount(plan, signal, fetcher);
    const missingFields = missing(value.view, value.source); plan.products.push({ ...product, updated_at: value.view.productVersion });
    if (!missingFields.length) plan.messages.push({ productId: product.id, message: '저장된 SEO·수동값과 공란을 보존했습니다. 새 생성 요청은 하지 않습니다.' });
    else plan.tasks.push({ productId: product.id, productTitle: product.title, productVersion: value.view.productVersion, contentRevision: value.view.content.revision,
      optionRevision: value.view.options.revision, brand: value.brand, sourceIdentity: value.sourceIdentity, missingFields });
  }
  await assertAccount(plan, signal, fetcher); return plan;
}
export async function refreshBatchSeoWorkTask(task: BatchSeoTask, plan: BatchSeoPlan, signal: AbortSignal, fetcher: typeof fetch = fetch, saved = false) {
  if (!plan.tasks.some(value => same(value, task))) throw changed(); await assertAccount(plan, signal, fetcher);
  const value = await snapshot(task.productId, signal, fetcher); await assertAccount(plan, signal, fetcher);
  if (value.sourceIdentity !== task.sourceIdentity || (saved
    ? Date.parse(value.view.productVersion) <= Date.parse(task.productVersion) || value.view.content.revision !== task.contentRevision + 1 || value.view.options.revision !== task.optionRevision + 1
    : value.view.productVersion !== task.productVersion || value.view.content.revision !== task.contentRevision || value.view.options.revision !== task.optionRevision)) throw changed();
  return value.view;
}
/** An explicit uncertain-result review may observe changed clocks. It is not a
 * save receipt; the caller must show the saved values before a manual skip. */
export async function readBatchSeoSavedState(task: BatchSeoTask, plan: BatchSeoPlan, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  if (!plan.tasks.some(value => same(value, task))) throw changed(); await assertAccount(plan, signal, fetcher);
  const value = await snapshot(task.productId, signal, fetcher); await assertAccount(plan, signal, fetcher);
  if (value.sourceIdentity !== task.sourceIdentity || Date.parse(value.view.productVersion) < Date.parse(task.productVersion)) throw changed(); return value.view;
}
