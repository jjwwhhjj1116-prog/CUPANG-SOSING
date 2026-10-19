import type { CollectionJob } from '@/app/sourcing';
import { validateCollectionReceiptResponse } from '@/app/collection-receipt-response';
import type { BrowserProductCapture } from '@/app/browser-product-bridge';

type Received = { kind: 'received'; source: NonNullable<ReturnType<typeof validateCollectionReceiptResponse>>; receivedAt: string };
type SourceUnavailable = { kind: 'source-unavailable'; error: string };
type RequestOptions = { signal: AbortSignal; fetcher: typeof fetch; capture?: BrowserProductCapture };
const uncertain = '수집 저장 응답을 확인하지 못했습니다.';
const recoveryFailed = '저장된 원문도 확인하지 못했습니다. 입력은 유지됩니다. 다시 조회해주세요.';

function responseError(body: unknown, fallback: string) {
 const error = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).error : undefined;
 return typeof error === 'string' && error.trim() && error.length <= 500 && !/[<>\u0000-\u001f]/u.test(error) ? error : fallback;
}
function receipt(body: unknown, job: CollectionJob): Received {
 const source = validateCollectionReceiptResponse(body, job.id, job.offer_id);
 const saved = (body as {receipt?: {receivedAt?: unknown; result?: {sourceUrl?: unknown}}}).receipt;
 if (!source || source.sourceUrl !== job.source_url || saved?.result?.sourceUrl !== job.source_url) throw Error('저장된 수집 원문이 현재 요청과 일치하지 않습니다.');
 const receivedAt = saved?.receivedAt;
 if (typeof receivedAt !== 'string' || !Number.isFinite(Date.parse(receivedAt))) throw Error('원문 저장 시각을 확인하지 못했습니다.');
 return {kind: 'received', source, receivedAt};
}

/** Only an uncertain write acknowledgement permits this one read. Never
 * retry the write or open Chrome to guess whether the receipt was committed. */
async function recover(job: CollectionJob, options: RequestOptions, reason: string): Promise<Received | undefined> {
 if (options.signal.aborted) return;
 const fetcher = options.fetcher;
 try {
  const response = await fetcher(`/api/collection-jobs/${encodeURIComponent(job.id)}/result`, {method: 'GET', cache: 'no-store', signal: options.signal});
  if (options.signal.aborted) return;
  if (!response.ok) throw Error(recoveryFailed);
  const body: unknown = await response.json();
  if (options.signal.aborted) return;
  return receipt(body, job);
 } catch {
  if (options.signal.aborted) return;
  throw Error(`${reason} ${recoveryFailed}`);
 }
}

/** A parsed successful response is authoritative: its identity/content errors
 * stay terminal. Only transport/body failures and ambiguous 5xx use recovery. */
export async function requestIntakeCollectionReceipt(job: CollectionJob, action: 'collect' | 'browser-capture', options: RequestOptions): Promise<Received | SourceUnavailable | undefined> {
 if (options.signal.aborted) return;
 const fetcher = options.fetcher;
 const init: RequestInit = {method: 'POST', signal: options.signal,
  ...(action === 'browser-capture' || options.capture !== undefined ? {headers: {'content-type': 'application/json'},
   body: JSON.stringify(action === 'collect' ? {browserCapture: options.capture} : options.capture)} : {})};
 let response: Response;
 try {
  response = await fetcher(`/api/collection-jobs/${encodeURIComponent(job.id)}/${action}`, init);
 } catch {
  return recover(job, options, uncertain);
 }
 if (options.signal.aborted) return;
 let body: unknown;
 try { body = await response.json(); }
 catch {
  if (options.signal.aborted) return;
  if (!response.ok && response.status < 500) throw Error('상품 정보를 가져오지 못했습니다.');
  return recover(job, options, uncertain);
 }
 if (options.signal.aborted) return;
 if (!response.ok) {
  const code = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).code : undefined;
  const message = responseError(body, '상품 정보를 가져오지 못했습니다.');
  if (response.status === 422 && code === 'SOURCE_NOT_COLLECTED' && action === 'collect') return {kind: 'source-unavailable', error: message};
  if (code === 'SOURCE_CONFIGURATION_REQUIRED' || response.status < 500) throw Error(message);
  return recover(job, options, responseError(body, uncertain));
 }
 return receipt(body, job);
}
