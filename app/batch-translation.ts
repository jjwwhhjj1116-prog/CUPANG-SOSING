export type BatchTranslationTarget = { productId: string; version: string; jobId: string | null };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Discover an existing result only. Never approve or execute a paid request. */
export async function readBatchTranslationTarget(productId: string, fetcher: typeof fetch, signal: AbortSignal): Promise<BatchTranslationTarget | null> {
  const path = `/api/products/${encodeURIComponent(productId)}`;
  const read = async (url: string) => {
    const response = await fetcher(url, { cache: 'no-store', signal });
    const body = record(await response.json());
    if (!response.ok) throw Error(typeof body?.error === 'string' ? body.error : '번역 자료를 불러오지 못했습니다.');
    return body;
  };
  if (signal.aborted) return null;
  const current = await read(path);
  if (signal.aborted) return null;
  const product = record(current.product), version = product.updated_at;
  if (product.id !== productId || typeof version !== 'string' || !Number.isFinite(Date.parse(version))) throw Error('상품 최신 버전을 확인하지 못했습니다.');
  const translations = await read(`${path}/translation`);
  if (signal.aborted) return null;
  if (!Array.isArray(translations?.jobs)) throw Error('저장된 번역 목록을 확인하지 못했습니다.');
  const jobs = translations.jobs.map(record).filter((job): job is Record<string, unknown> & {id:string;createdAt:string} => job.productId === productId && job.productVersion === version
    && job.status === 'completed' && !!job.result && typeof job.id === 'string' && /^[a-f0-9-]{36}$/.test(job.id)
    && typeof job.createdAt === 'string' && Number.isFinite(Date.parse(job.createdAt)));
  jobs.sort((a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
  return { productId, version, jobId: jobs[0]?.id ?? null };
}
