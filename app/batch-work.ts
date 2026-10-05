import type { AutomationWorkflow } from '@/app/automation/model';

type WorkDraftPreparation = { productId: string; productVersion: string; prepared: boolean; changedRoles: number; changedOptions: number; availableImages: number; message: string };

/** Keep uncertain requests retryable; confirmed results must not pin future runs
 * to old settings/options when the product's updated_at has not changed. */
export async function runBatchProduct(id: string, options: {
  fetcher: typeof fetch; signal: AbortSignal; keys: Map<string, string>; newKey: () => string;
  prepareDrafts?: boolean; onPreparation?: (result: WorkDraftPreparation) => void;
}): Promise<AutomationWorkflow | null> {
  if (options.signal.aborted) return null;
  const path = `/api/products/${encodeURIComponent(id)}`;
  const currentResponse = await options.fetcher(path, { cache: 'no-store', signal: options.signal });
  if (options.signal.aborted) return null;
  if (!currentResponse.ok) throw Error('상품 최신 상태를 읽지 못했습니다.');
  const current = await currentResponse.json() as { product?: { id?: string; updated_at?: string } };
  if (options.signal.aborted) return null;
  let version = current.product?.updated_at;
  if (current.product?.id !== id || typeof version !== 'string' || !Number.isFinite(Date.parse(version))) throw Error('상품 최신 상태를 확인하지 못했습니다.');
  if (options.prepareDrafts) {
    const preparedResponse = await options.fetcher(`${path}/work-draft`, {
      method: 'POST', signal: options.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: version }),
    });
    const prepared = await preparedResponse.json() as WorkDraftPreparation & { error?: string };
    if (options.signal.aborted) return null;
    if (!preparedResponse.ok) throw Error(prepared.error || '이미지 초안을 준비하지 못했습니다.');
    if (prepared.productId !== id || typeof prepared.productVersion !== 'string' || !Number.isFinite(Date.parse(prepared.productVersion)) || Date.parse(prepared.productVersion) < Date.parse(version)
      || typeof prepared.prepared !== 'boolean' || typeof prepared.message !== 'string'
      || [prepared.changedRoles, prepared.changedOptions, prepared.availableImages].some(value => !Number.isSafeInteger(value) || value < 0)) throw Error('이미지 초안 준비 결과를 확인하지 못했습니다. 다시 시도해주세요.');
    version = prepared.productVersion;
    options.onPreparation?.(prepared);
  }
  if (options.signal.aborted) return null;
  const identity = id + '@' + version;
  if (!options.keys.has(identity)) options.keys.set(identity, options.newKey());
  const response = await options.fetcher(`${path}/automation`, {
    method: 'POST', signal: options.signal, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'run', expectedVersion: version, idempotencyKey: options.keys.get(identity) }),
  });
  const body = await response.json() as { workflow?: AutomationWorkflow; error?: string };
  if (options.signal.aborted) return null;
  if (!response.ok) throw Error(body.error || '작업을 저장하지 못했습니다.');
  if (body.workflow?.productId !== id || body.workflow.productVersion !== version || !Array.isArray(body.workflow.stages)) throw Error('작업 결과를 확인하지 못했습니다. 다시 시도해주세요.');
  options.keys.delete(identity);
  return body.workflow;
}
