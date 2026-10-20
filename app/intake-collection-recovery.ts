import type { CollectionJob } from '@/app/sourcing';
import { validateCollectionReceiptResponse } from '@/app/collection-receipt-response';
import type { BrowserProductCapture } from '@/app/browser-product-bridge';

type Received = { kind: 'received'; source: NonNullable<ReturnType<typeof validateCollectionReceiptResponse>>; receivedAt: string };
type SourceUnavailable = { kind: 'source-unavailable'; error: string };
export const COLLECTION_ACK_TIMEOUT_MS = 40_000;
export const COLLECTION_RECEIPT_READ_TIMEOUT_MS = 10_000;
type RequestOptions = { signal: AbortSignal; fetcher: typeof fetch; capture?: BrowserProductCapture; timeoutMs?: number; recoveryTimeoutMs?: number };
const uncertain = '수집 저장 응답을 확인하지 못했습니다.';
const recoveryFailed = '저장된 원문도 확인하지 못했습니다. 입력은 유지됩니다. 다시 조회해주세요.';

type JsonRead = { ok: true; response: Response; body: unknown } | { ok: false; response?: Response };
const cancelBody = (response?: Response) => { try { void response?.body?.cancel().catch(() => {}); } catch { /* A completed or locked body needs no second reader. */ } };

/** One deadline covers response headers and JSON. A late transport cannot
 * publish a receipt, trigger a fallback, or keep a cancelled intake pending. */
async function readJson(url: string, init: RequestInit, options: RequestOptions, timeoutMs: number, readErrorBody: boolean): Promise<JsonRead> {
 const controller = new AbortController();
 let response: Response | undefined, interrupted = false;
 let finishInterruption: (value: JsonRead) => void = () => {};
 const interruption = new Promise<JsonRead>(resolve => { finishInterruption = resolve; });
 const stop = () => {
  if (interrupted) return;
  interrupted = true; controller.abort(); cancelBody(response);
  finishInterruption({ok: false, ...(response ? {response} : {})});
 };
 const timer = setTimeout(stop, timeoutMs);
 options.signal.addEventListener('abort', stop, {once: true});
 const read = async (): Promise<JsonRead> => {
  const fetcher = options.fetcher;
  try {
   response = await fetcher(url, {...init, signal: controller.signal});
   if (interrupted || options.signal.aborted) { cancelBody(response); return {ok: false, response}; }
   if (!readErrorBody && !response.ok) { cancelBody(response); return {ok: false, response}; }
   const body: unknown = await response.json();
   return interrupted || options.signal.aborted ? {ok: false, response} : {ok: true, response, body};
  } catch { return {ok: false, ...(response ? {response} : {})}; }
 };
 try {
  if (options.signal.aborted) { stop(); return await interruption; }
  return await Promise.race([interruption, read()]);
 } finally {
  clearTimeout(timer); options.signal.removeEventListener('abort', stop);
 }
}

function deadline(value: number | undefined, fallback: number, max: number) {
 const milliseconds = value ?? fallback;
 if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > max) throw Error('원문 저장 확인 제한 시간을 확인해주세요.');
 return milliseconds;
}

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
 if(options.capture&&'format' in options.capture&&options.capture.format==='yoofam-saved-page-capture-v1')
  throw Error(`${reason} 선택한 수집본의 저장 결과가 확정되지 않았습니다. 기존 작업과 수집함을 확인한 뒤 다시 진행해주세요.`);
 try {
  const result = await readJson(`/api/collection-jobs/${encodeURIComponent(job.id)}/result`, {method: 'GET', cache: 'no-store'}, options,
   options.recoveryTimeoutMs ?? COLLECTION_RECEIPT_READ_TIMEOUT_MS, false);
  if (options.signal.aborted) return;
  if (!result.ok) throw Error(recoveryFailed);
  return receipt(result.body, job);
 } catch {
  if (options.signal.aborted) return;
  throw Error(`${reason} ${recoveryFailed}`);
 }
}

/** A parsed successful response is authoritative: its identity/content errors
 * stay terminal. Only transport/body failures and ambiguous 5xx use recovery. */
export async function requestIntakeCollectionReceipt(job: CollectionJob, action: 'collect' | 'browser-capture', options: RequestOptions): Promise<Received | SourceUnavailable | undefined> {
 if (options.signal.aborted) return;
 const timeoutMs = deadline(options.timeoutMs, COLLECTION_ACK_TIMEOUT_MS, 120_000);
 const recoveryTimeoutMs = deadline(options.recoveryTimeoutMs, COLLECTION_RECEIPT_READ_TIMEOUT_MS, 30_000);
 const requestOptions = {...options, recoveryTimeoutMs};
 const init: RequestInit = {method: 'POST',
  ...(action === 'browser-capture' || options.capture !== undefined ? {headers: {'content-type': 'application/json'},
   body: JSON.stringify(action === 'collect' ? {browserCapture: options.capture} : options.capture)} : {})};
 const result = await readJson(`/api/collection-jobs/${encodeURIComponent(job.id)}/${action}`, init, requestOptions, timeoutMs, true);
 if (options.signal.aborted) return;
 if (!result.ok) {
  if (result.response && !result.response.ok && result.response.status < 500) throw Error('상품 정보를 가져오지 못했습니다.');
  return recover(job, requestOptions, uncertain);
 }
 const {response, body} = result;
 if (!response.ok) {
  const code = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).code : undefined;
  const message = responseError(body, '상품 정보를 가져오지 못했습니다.');
  if (response.status === 422 && code === 'SOURCE_NOT_COLLECTED' && action === 'collect') return {kind: 'source-unavailable', error: message};
  if (code === 'SOURCE_CONFIGURATION_REQUIRED' || response.status < 500) throw Error(message);
  return recover(job, requestOptions, responseError(body, uncertain));
 }
 return receipt(body, job);
}
