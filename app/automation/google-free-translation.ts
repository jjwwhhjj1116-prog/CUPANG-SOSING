import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';

export type GoogleFreeTranslation = { translatedText: string; detectedSourceLanguage: string | null };
export type GoogleFreeTranslationFailure = { reason: 'http' | 'timeout' | 'network' | 'invalid-response' | 'input-limit'; status?: number; detail?: 'request-init' | 'invocation' | 'redirect' | 'subrequest-limit' | 'connection' | 'type-error' };
export type GoogleFreeTranslationOptions = {
  sourceLanguage?: string | null;
  targetLanguage?: string;
  maxCharacters?: number;
  timeoutSeconds?: number;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  onFailure?: (failure: GoogleFreeTranslationFailure) => void;
};
const MAX_RESPONSE_BYTES = 512 * 1024;

// Classify known transport failures without exposing exception text, URLs or
// product data. Unknown failures keep the original generic null contract.
function transportDetail(error: unknown): GoogleFreeTranslationFailure['detail'] {
  if (!error || typeof error !== 'object') return undefined;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (typeof message === 'string') {
    if (/^Unsupported cache mode:/i.test(message)) return 'request-init';
    if (/^Illegal invocation/i.test(message)) return 'invocation';
    if (/redirect/i.test(message)) return 'redirect';
    if (/too many subrequests/i.test(message)) return 'subrequest-limit';
    if (/network connection|connection (?:lost|reset|refused)|dns|tls|ssl|certificate/i.test(message)) return 'connection';
  }
  return name === 'TypeError' ? 'type-error' : undefined;
}

/** Decode entities once, preserving literal tags as plain text. Callers must
 * render the returned string as text, never as trusted HTML. */
function decodeHtmlText(value: string): string {
  const fragment = parseFragment(value.replace(/</g, '&lt;'));
  return fragment.childNodes.map(node => node.nodeName === '#text' ? (node as DefaultTreeAdapterMap['textNode']).value : '').join('');
}

/** Product text is untrusted data, never instructions. This single request
 * translates only that text; it does not infer facts, merge fields or retry. */
export async function translateGoogleFree(text: string, options: GoogleFreeTranslationOptions = {}): Promise<GoogleFreeTranslation | null> {
  let reported = false;
  const fail = (reason: GoogleFreeTranslationFailure['reason'], status?: number, detail?: GoogleFreeTranslationFailure['detail']): null => {
    if (!reported) {
      reported = true;
      // Diagnostics contain no request text, URL, response body or exception.
      try { options.onFailure?.({ reason, ...(typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}), ...(detail ? { detail } : {}) }); } catch { /* Keep the existing null-return contract. */ }
    }
    return null;
  };
  const sourceLanguage = options.sourceLanguage?.trim() || 'auto';
  const targetLanguage = options.targetLanguage?.trim() || 'ko';
  const languageCode = /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2}$/i;
  if ((sourceLanguage !== 'auto' && !languageCode.test(sourceLanguage)) || !languageCode.test(targetLanguage)) return null;
  const maxCharacters = typeof options.maxCharacters === 'number' && Number.isFinite(options.maxCharacters)
    ? Math.min(5000, Math.max(1, Math.floor(options.maxCharacters))) : 5000;
  if (options.signal?.aborted) return null;
  if (typeof text !== 'string' || !text.trim() || text.length > maxCharacters) return fail('input-limit');
  const timeoutSeconds = typeof options.timeoutSeconds === 'number' && Number.isFinite(options.timeoutSeconds)
    ? Math.min(30, Math.max(3, options.timeoutSeconds)) : 10;
  const controller = new AbortController();
  let timedOut = false, failureReason: 'network' | 'invalid-response' = 'network';
  const aborted = () => timedOut ? fail('timeout') : null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let finishAbort: () => void = () => {};
  const stopped = new Promise<null>(resolve => { finishAbort = () => resolve(null); });
  const cancelReader = () => { if (reader) void reader.cancel().catch(() => {}); };
  const onAbort = () => { cancelReader(); finishAbort(); };
  const onExternalAbort = () => controller.abort();
  controller.signal.addEventListener('abort', onAbort, { once: true });
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => { if (!controller.signal.aborted) { timedOut = true; controller.abort(); } }, timeoutSeconds * 1000);
  try {
    const url = new URL('https://translate.googleapis.com/translate_a/single');
    url.search = new URLSearchParams({ client: 'gtx', sl: sourceLanguage, tl: targetLanguage, dt: 't', q: text }).toString();
    const fetcher = options.fetcher ?? fetch;
    // Workers supports manual/follow, not redirect:error. Manual returns 3xx
    // for the status check below, without forwarding source text elsewhere.
    const response = await Promise.race([fetcher(url.href, { method: 'GET', signal: controller.signal, redirect: 'manual',
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' } }), stopped]);
    if (!response) return aborted();
    if (controller.signal.aborted || !response.ok || response.redirected || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
      if (response.body) void response.body.cancel().catch(() => {});
      if (controller.signal.aborted) return aborted();
      return !response.ok ? fail('http', response.status) : fail('invalid-response');
    }
    failureReason = 'invalid-response';
    reader = response.body?.getReader();
    if (!reader) return fail('invalid-response');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, body = '';
    while (true) {
      failureReason = 'network';
      const item = await Promise.race([reader.read(), stopped]);
      if (!item || controller.signal.aborted) return aborted();
      if (item.done) break;
      failureReason = 'invalid-response';
      bytes += item.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) { cancelReader(); return fail('invalid-response'); }
      body += decoder.decode(item.value, { stream: true });
    }
    failureReason = 'invalid-response';
    body += decoder.decode();
    const root: unknown = JSON.parse(body);
    if (!Array.isArray(root) || !Array.isArray(root[0]) || !root[0].length) return fail('invalid-response');
    const segments: string[] = [];
    for (const segment of root[0]) {
      if (!Array.isArray(segment) || typeof segment[0] !== 'string') return fail('invalid-response');
      segments.push(segment[0]);
    }
    const translatedText = decodeHtmlText(segments.join(''));
    if (controller.signal.aborted) return aborted();
    if (!translatedText.trim()) return fail('invalid-response');
    const detectedSourceLanguage = typeof root[2] === 'string' && /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2}$/i.test(root[2]) ? root[2] : null;
    return { translatedText, detectedSourceLanguage };
  } catch (error) { return controller.signal.aborted ? aborted() : fail(failureReason, undefined, failureReason === 'network' ? transportDetail(error) : undefined); }
  finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
    controller.signal.removeEventListener('abort', onAbort);
    cancelReader();
    try { reader?.releaseLock(); } catch { /* A cancelled read may still be settling. */ }
  }
}
