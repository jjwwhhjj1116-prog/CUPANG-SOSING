import { verifyProductLabelsView, type ProductLabelsView } from '@/app/product-label';
import { defaultSettings, savedRegistrationSettings, type WorkspaceSettings } from '@/app/workspace-settings';
import { parseWorkspaceSettingsScope, type WorkspaceSettingsScope } from '@/app/workspace-settings-scope';

export type BatchLabelDraftTask = {
  productId: string; productTitle: string; optionId: string; optionLabel: string; profileId: string | null;
  categoryContext: ProductLabelsView['categoryContext']; productVersion: string;
};
export type BatchLabelDraftPlan = {
  tasks: BatchLabelDraftTask[]; messages: { productId: string; message: string }[];
  scope: WorkspaceSettingsScope; settings: WorkspaceSettings;
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
const changed = () => Error('로그인 계정 또는 기본설정이 변경됐습니다. 최신 설정으로 표시사항 초안을 다시 준비해주세요.');
const invalid = () => Error('저장한 상품·카테고리·옵션의 표시사항 연결을 확인하지 못했습니다. 최신 저장본을 확인해주세요.');
const message = (cause: unknown) => cause instanceof Error ? cause.message : '이 상품의 표시사항 검토 목록을 준비하지 못했습니다.';
const selectedProfile = (context: ProductLabelsView['categoryContext']) => context.source === 'profile' ? context.profileId : null;
const endpoint = (productId: string, profileId: string | null = null) => `/api/products/${encodeURIComponent(productId)}/product-labels${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`;

async function readJson(url: string, signal: AbortSignal, fetcher: typeof fetch): Promise<unknown> {
  signal.throwIfAborted();
  const response = await fetcher(url, { signal, cache: 'no-store' }), body: unknown = await response.json();
  signal.throwIfAborted();
  if (!response.ok) throw Error(object(body) && typeof body.error === 'string' ? body.error : '저장한 표시사항 작업 정보를 읽지 못했습니다.');
  return body;
}
async function readSettings(signal: AbortSignal, fetcher: typeof fetch) {
  const body = await readJson('/api/settings', signal, fetcher);
  if (!object(body) || !object(body.settings) || Object.keys(defaultSettings).some(key => !Object.hasOwn(body.settings as object, key)))
    throw Error('계정의 기본설정을 먼저 저장한 뒤 표시사항 작업을 시작해주세요.');
  const scope = parseWorkspaceSettingsScope(body.scope);
  if (!scope) throw Error('기본설정의 로그인 계정을 확인하지 못했습니다. 다시 조회해주세요.');
  return { scope, settings: savedRegistrationSettings(body.settings) };
}
async function assertSettings(plan: Pick<BatchLabelDraftPlan, 'scope' | 'settings'>, signal: AbortSignal, fetcher: typeof fetch) {
  const current = await readSettings(signal, fetcher);
  if (!same(current.scope, plan.scope) || !same(current.settings, plan.settings)) throw changed();
}
function checkedView(value: unknown, productId: string, optionId: string | null = null, profileId: string | null = null): ProductLabelsView {
  const view = value as ProductLabelsView;
  verifyProductLabelsView(view, optionId, profileId ?? undefined);
  if (view.productId !== productId || !['profile', 'collection'].includes(view.categoryContext.source)
    || view.categoryContext.source === 'profile' && view.categoryContext.profileId === null
    || view.updatedAt !== null && Date.parse(view.updatedAt) > Date.parse(view.productVersion)) throw invalid();
  return view;
}

/** A stage-six review inventory only. It is independent of translateImages:
 * listing included options never calls AI, writes a label or generates a PNG. */
export async function planBatchLabelDraft(products: { id: string; title: string }[], signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<BatchLabelDraftPlan> {
  signal.throwIfAborted();
  if (!Array.isArray(products) || products.some(product => !product || !identifier(product.id) || typeof product.title !== 'string')) throw invalid();
  const unique = [...new Map(products.map(product => [product.id, product])).values()];
  if (unique.length > 100) throw Error('표시사항 작업은 한 번에 상품 100개까지 준비할 수 있습니다.');
  const initial = await readSettings(signal, fetcher), plan: BatchLabelDraftPlan = { ...initial, tasks: [], messages: [] };
  for (const product of unique) {
    signal.throwIfAborted();
    try {
      const view = checkedView(await readJson(endpoint(product.id), signal, fetcher), product.id);
      const rows = view.rows.filter(row => row.included && row.optionId !== null);
      if (!rows.length) { plan.messages.push({ productId: product.id, message: '표시사항 작업에 포함된 옵션이 없습니다.' }); continue; }
      for (const row of rows) plan.tasks.push({ productId: product.id, productTitle: product.title, optionId: row.optionId!, optionLabel: row.optionLabel,
        profileId: selectedProfile(view.categoryContext), categoryContext: structuredClone(view.categoryContext), productVersion: view.productVersion });
    } catch (cause) { signal.throwIfAborted(); plan.messages.push({ productId: product.id, message: message(cause) }); }
  }
  await assertSettings(plan, signal, fetcher);
  return plan;
}

/** A new option review may follow an acknowledged label/image save. Read its
 * current data without rebinding a captured category to a live profile. */
export async function refreshBatchLabelDraftTask(task: BatchLabelDraftTask, plan: BatchLabelDraftPlan, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<ProductLabelsView> {
  signal.throwIfAborted();
  if (!plan.tasks.some(value => same(value, task)) || !identifier(task.productId) || !/^[A-Za-z0-9_-]{1,80}$/.test(task.optionId)
    || !task.categoryContext || task.profileId !== selectedProfile(task.categoryContext) || !Number.isFinite(Date.parse(task.productVersion))) throw invalid();
  await assertSettings(plan, signal, fetcher);
  let view: ProductLabelsView;
  try {
    view = checkedView(await readJson(endpoint(task.productId, task.profileId), signal, fetcher), task.productId, task.optionId, task.profileId);
    if (!same(view.categoryContext, task.categoryContext) || Date.parse(view.productVersion) < Date.parse(task.productVersion)
      || view.rows.find(row => row.optionId === task.optionId)?.included !== true) throw invalid();
  } finally { await assertSettings(plan, signal, fetcher); }
  return view;
}
