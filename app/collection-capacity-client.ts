import { collectionRequestWithRetry } from '@/app/collection-retry';

export const COLLECTION_CAPACITY_TIMEOUT_MS = 5000;
export class CollectionCapacityTimeout extends Error {
  constructor() { super('이미지 저장 상태 확인 시간이 초과됐습니다.'); }
}
export class CollectionCapacityCancelled extends Error {
  constructor() { super('이미지 저장 상태 확인을 취소했습니다.'); }
}

/** Bound the entire optional read, including retries and the final JSON body. */
export async function fetchCollectionCapacity(url: string, options: {
  fetcher: typeof fetch; signal?: AbortSignal; shouldStop?: () => boolean;
  timeoutMs?: number; attempts?: number; retryWait?: (milliseconds: number) => Promise<void>;
  onRetry?: (attempt: number) => void;
}): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? COLLECTION_CAPACITY_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw Error('이미지 조회 제한 시간을 확인해주세요.');
  const controller = new AbortController();
  let response: Response | undefined;
  let interrupted: CollectionCapacityTimeout | CollectionCapacityCancelled | undefined;
  let rejectInterruption: (error: Error) => void = () => {};
  const interruption = new Promise<never>((_resolve, reject) => { rejectInterruption = reject; });
  const stopped = () => options.signal?.aborted || options.shouldStop?.() || false;
  const interrupt = (error: CollectionCapacityTimeout | CollectionCapacityCancelled) => {
    if (interrupted) return;
    interrupted = error;
    controller.abort();
    rejectInterruption(error);
  };
  const cancel = () => interrupt(new CollectionCapacityCancelled());
  const timer = setTimeout(() => interrupt(stopped() ? new CollectionCapacityCancelled() : new CollectionCapacityTimeout()), timeoutMs);
  options.signal?.addEventListener('abort', cancel, { once: true });
  // A cached JSON result preserves HTTP authority failures even if their body
  // stalls. Callers must still validate capacity before authorizing images.
  const cached = (value: Response, body: unknown, error?: unknown): Response => new Proxy(Object.create(value) as Response, {
    get(_target, key) {
      if (key === 'json') return () => error === undefined ? Promise.resolve(body) : Promise.reject(error);
      const property = Reflect.get(value, key, value);
      return typeof property === 'function' ? property.bind(value) : property;
    },
  });
  const read = async () => {
    response = await collectionRequestWithRetry(url, { cache: 'no-store', signal: controller.signal }, {
      fetcher: options.fetcher, attempts: options.attempts, wait: options.retryWait,
      shouldStop: () => controller.signal.aborted || stopped(), onRetry: options.onRetry,
    });
    if (controller.signal.aborted || stopped()) {
      void response.body?.cancel().catch(() => {});
      throw interrupted ?? new CollectionCapacityCancelled();
    }
    try { return cached(response, await response.json()); }
    catch (error) { return cached(response, undefined, error); }
  };
  try {
    if (stopped()) cancel();
    const value = await Promise.race([interruption, read()]);
    if (interrupted || stopped()) throw interrupted ?? new CollectionCapacityCancelled();
    return value;
  } catch (error) {
    if (interrupted instanceof CollectionCapacityTimeout && response) return cached(response, undefined, interrupted);
    throw interrupted ?? error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    if (controller.signal.aborted && response) {
      // A body may be locked by json(); cancellation is best effort, while the
      // race already handles every late resolution or rejection.
      void response.body?.cancel().catch(() => {});
    }
  }
}
