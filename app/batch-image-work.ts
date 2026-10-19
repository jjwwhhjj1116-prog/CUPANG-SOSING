import { detailBatchTranslationSlots } from '@/app/detail-image-batch';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { defaultSettings, savedRegistrationSettings, type WorkspaceSettings } from '@/app/workspace-settings';
import { parseWorkspaceSettingsScope, type WorkspaceSettingsScope } from '@/app/workspace-settings-scope';

export type BatchImageTask = {
  productId: string; productTitle: string; optionId: string; optionLabel: string;
  stage: 'main' | 'additional' | 'detail'; profileId: string | null;
  categoryContext: QuotationFieldsView['categoryContext']; productVersion: string; imageCount: number;
};
export type BatchImagePlan = {
  tasks: BatchImageTask[]; messages: { productId: string; message: string }[];
  scope: WorkspaceSettingsScope; settings: WorkspaceSettings; enabled: boolean;
};

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
const changed = () => Error('로그인 계정 또는 기본설정이 변경됐습니다. 최신 설정으로 이미지 작업을 다시 준비해주세요.');
const invalid = () => Error('저장한 카테고리·옵션·이미지 연결을 확인하지 못했습니다. 상품의 이미지 설정을 확인해주세요.');
const message = (cause: unknown) => cause instanceof Error ? cause.message : '이 상품의 이미지 작업을 준비하지 못했습니다.';

async function readJson(url: string, signal: AbortSignal, fetcher: typeof fetch): Promise<unknown> {
  signal.throwIfAborted();
  const response = await fetcher(url, { signal, cache: 'no-store' });
  const body: unknown = await response.json();
  signal.throwIfAborted();
  if (!response.ok) throw Error(object(body) && typeof body.error === 'string' ? body.error : '저장한 이미지 작업 정보를 읽지 못했습니다.');
  return body;
}

async function readSettings(signal: AbortSignal, fetcher: typeof fetch) {
  const body = await readJson('/api/settings', signal, fetcher);
  if (!object(body) || !object(body.settings) || Object.keys(defaultSettings).some(key => !Object.hasOwn(body.settings as object, key)))
    throw Error('계정의 기본설정을 먼저 저장한 뒤 이미지 작업을 시작해주세요.');
  const scope = parseWorkspaceSettingsScope(body.scope);
  if (!scope) throw Error('기본설정의 로그인 계정을 확인하지 못했습니다. 다시 조회해주세요.');
  return { scope, settings: savedRegistrationSettings(body.settings) };
}

async function assertSettings(plan: Pick<BatchImagePlan, 'scope' | 'settings'>, signal: AbortSignal, fetcher: typeof fetch) {
  const current = await readSettings(signal, fetcher);
  if (!same(current.scope, plan.scope) || !same(current.settings, plan.settings)) throw changed();
}

function viewContext(value: unknown): QuotationFieldsView {
  const view = value as QuotationFieldsView, context = view?.categoryContext;
  if (!object(value) || !context || !['profile', 'collection'].includes(context.source)
    || !(context.profileId === null || identifier(context.profileId)) || context.source === 'profile' && context.profileId === null || !identifier(context.categoryId)
    || !Array.isArray(context.categoryPath) || !context.categoryPath.length
    || context.categoryPath.some(part => typeof part !== 'string' || !part.trim() || part.length > 500)
    || !Array.isArray(view.resolved?.rows) || view.resolved.schema?.categoryId !== context.categoryId
    || !same(view.resolved.schema.categoryPath, context.categoryPath)
    || !Number.isFinite(Date.parse(view.productVersion))
    || view.updatedAt !== null && (!Number.isFinite(Date.parse(view.updatedAt)) || Date.parse(view.updatedAt) > Date.parse(view.productVersion))) throw invalid();
  const ids = view.resolved.rows.flatMap(row => row.optionId === null ? [] : [row.optionId]);
  if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(id))
    || view.resolved.rows.some(row => typeof row.included !== 'boolean' || typeof row.optionLabel !== 'string')) throw invalid();
  return view;
}

// Captured collection context may retain a profile id without selecting that
// live profile. Adding ?profileId later would switch its category source.
const selectedProfile = (context: QuotationFieldsView['categoryContext']) => context.source === 'profile' ? context.profileId : null;

function fieldsUrl(productId: string, profileId: string | null = null) {
  return `/api/products/${encodeURIComponent(productId)}/quotation-fields${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`;
}

/** Build a read-only review queue after pricing. Merely planning never starts
 * OCR, changes image references, uploads a file, or transmits a quotation. */
export async function planBatchImageWork(products: { id: string; title: string }[], signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<BatchImagePlan> {
  signal.throwIfAborted();
  if (!Array.isArray(products) || products.some(product => !product || !identifier(product.id) || typeof product.title !== 'string')) throw invalid();
  const unique = [...new Map(products.map(product => [product.id, product])).values()];
  if (unique.length > 100) throw Error('이미지 작업은 한 번에 상품 100개까지 준비할 수 있습니다.');
  const initial = await readSettings(signal, fetcher);
  const plan: BatchImagePlan = { ...initial, tasks: [], messages: [], enabled: initial.settings.translateImages };
  if (plan.enabled) for (const product of unique) {
    signal.throwIfAborted();
    try {
      const view = viewContext(await readJson(fieldsUrl(product.id), signal, fetcher));
      const rows = view.resolved.rows.filter(row => row.included && row.optionId !== null);
      if (!rows.length) { plan.messages.push({ productId: product.id, message: '이미지 작업에 포함된 옵션이 없습니다.' }); continue; }
      // Collect atomically per product: malformed later slots cannot leave a
      // misleading partial queue for that same quotation.
      const tasks: BatchImageTask[] = [], messages: BatchImagePlan['messages'] = [];
      for (const row of rows) for (const stage of ['main', 'additional', 'detail'] as const) {
        const profileId = selectedProfile(view.categoryContext);
        const selected = detailBatchTranslationSlots(view, row.optionId!, profileId, stage);
        if (!selected.slots.length) {
          messages.push({ productId: product.id, message: `${row.optionLabel} · ${stage === 'main' ? '대표' : stage === 'additional' ? '추가' : '상세'} 이미지: ${selected.keys.length ? '상단·하단 설정 이미지만 있어 번역하지 않고 유지합니다.' : '저장한 이미지가 없어 원래 빈 값을 유지합니다.'}` });
          continue;
        }
        tasks.push({ productId: product.id, productTitle: product.title, optionId: row.optionId!, optionLabel: row.optionLabel,
          stage, profileId, categoryContext: structuredClone(view.categoryContext),
          productVersion: view.productVersion, imageCount: selected.slots.length });
      }
      plan.tasks.push(...tasks); plan.messages.push(...messages);
    } catch (cause) { signal.throwIfAborted(); plan.messages.push({ productId: product.id, message: message(cause) }); }
  }
  await assertSettings(plan, signal, fetcher);
  return plan;
}

/** Each new review group reads its latest quotation. Earlier, explicitly
 * acknowledged image commits may advance its clock; account/category changes
 * or backwards clocks cannot move a queued task to another document. */
export async function refreshBatchImageTask(task: BatchImageTask, plan: BatchImagePlan, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<QuotationFieldsView> {
  signal.throwIfAborted();
  if (!plan.enabled || plan.settings.translateImages !== true || !plan.tasks.some(value => same(value, task))
    || !identifier(task.productId) || !/^[A-Za-z0-9_-]{1,80}$/.test(task.optionId)
    || !['main', 'additional', 'detail'].includes(task.stage) || task.profileId !== selectedProfile(task.categoryContext)
    || !Number.isFinite(Date.parse(task.productVersion)) || !Number.isSafeInteger(task.imageCount) || task.imageCount < 1) throw invalid();
  await assertSettings(plan, signal, fetcher);
  let view: QuotationFieldsView;
  try {
    view = viewContext(await readJson(fieldsUrl(task.productId, task.profileId), signal, fetcher));
    if (!same(view.categoryContext, task.categoryContext) || Date.parse(view.productVersion) < Date.parse(task.productVersion)) throw invalid();
    const selected = detailBatchTranslationSlots(view, task.optionId, task.profileId, task.stage);
    if (selected.slots.length !== task.imageCount) throw Error('검토할 이미지 목록이 변경됐습니다. 최신 이미지 작업 목록으로 다시 준비해주세요.');
  } finally { await assertSettings(plan, signal, fetcher); }
  return view;
}
