import { parseCollectionRequest } from '@/app/sourcing';
import { AlibabaMobileInitialDataUnavailableError, parseAlibabaMobilePage, parseAlibabaMobileDescription, parseAlibabaMobileProduct, parseAlibabaPublicSkuProduct } from '@/app/alibaba-mobile-product';
import { publicMtopMd5 } from '@/app/public-mtop-md5';
import { alibabaMobileResponseSucceeded } from '@/app/alibaba-mobile-response';

const SKU_ENDPOINT = 'https://h5api.m.1688.com/h5/mtop.mbox.fc.common.gateway/1.0/';
const PUBLIC_APP_KEY = '12574478'; // Alibaba's public lib-mtop 2.7.4 client ID, not an owned OpenAPI key.
// Optional description bytes must not consume the whole public-source budget
// after the offer and every SKU price have already been verified.
export const OPTIONAL_DETAIL_TIMEOUT_MS = 5000;

class OptionalDetailTransportError extends Error {
  constructor(public reason: 'network' | 'read' | 'timeout') {
    super('1688 상세 원문을 일시적으로 받지 못했습니다. 확인된 상품·옵션 원문은 유지합니다.');
  }
}
class VerifiedMobileDetailUnavailable extends OptionalDetailTransportError {
  constructor(reason: 'network' | 'read' | 'timeout', public result: ReturnType<typeof parseAlibabaMobileProduct>) { super(reason); }
}

async function readBody(response: Response, limit: number) {
  if (!response.ok) throw Error('1688 공개 상품 요청이 정상 응답하지 않았습니다.');
  const reader = response.body?.getReader();
  if (!reader) throw Error('1688 상품 응답이 없습니다.');
  const charset = response.headers.get('content-type')?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] ?? 'utf-8';
  const decoder = new TextDecoder(charset, {fatal: true});
  let size = 0, body = '';
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw Error('1688 상품 응답 크기가 수집 한도를 초과했습니다.'); }
      body += decoder.decode(value, {stream: true});
    }
    return body + decoder.decode();
  } finally { reader.releaseLock(); }
}

async function readOptionalDetail(url: string, options: {fetcher?: typeof fetch; signal: AbortSignal; optionalDetailTimeoutMs?: number}) {
  const timeoutMs = options.optionalDetailTimeoutMs ?? OPTIONAL_DETAIL_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw Error('상세 원문 확인 제한 시간을 확인해주세요.');
  const controller = new AbortController();
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, consumed = false;
  let interrupted: Error | undefined, rejectInterruption: (error: Error) => void = () => {};
  const interruption = new Promise<never>((_resolve, reject) => { rejectInterruption = reject; });
  const stop = (error: Error) => {
    if (interrupted) return;
    interrupted = error; controller.abort();
    if (reader) void reader.cancel().catch(() => {});
    else if (response) void response.body?.cancel().catch(() => {});
    rejectInterruption(error);
  };
  const cancel = () => stop(Error('상품 수집을 취소했거나 응답 시간이 초과되었습니다.'));
  const timer = setTimeout(() => options.signal.aborted ? cancel() : stop(new OptionalDetailTransportError('timeout')), timeoutMs);
  options.signal.addEventListener('abort', cancel, {once: true});
  const read = async () => {
    try {
      try { response = await (options.fetcher ?? fetch)(url, {redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: controller.signal, headers: {accept: 'text/plain'}}); }
      catch { throw interrupted ?? new OptionalDetailTransportError('network'); }
      if (interrupted || options.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw interrupted ?? Error('상품 수집을 취소했습니다.');
      }
      if ([502,503,504].includes(response.status)) {
        void response.body?.cancel().catch(() => {});
        return {detailSource: '', detailUnavailable: {status: response.status as 502|503|504}};
      }
      // Authority failures and redirects are never a transient transport gap.
      if (!response.ok) { void response.body?.cancel().catch(() => {}); throw Error('1688 공개 상품 요청이 정상 응답하지 않았습니다.'); }
      reader = response.body?.getReader();
      if (!reader) throw Error('1688 상품 응답이 없습니다.');
      const charset = response.headers.get('content-type')?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] ?? 'utf-8';
      const decoder = new TextDecoder(charset, {fatal: true});
      let text = '', size = 0;
      while (true) {
        let part: ReadableStreamReadResult<Uint8Array>;
        try { part = await reader.read(); }
        catch { throw interrupted ?? new OptionalDetailTransportError('read'); }
        if (interrupted || options.signal.aborted) throw interrupted ?? Error('상품 수집을 취소했습니다.');
        if (part.done) { consumed = true; break; }
        size += part.value.byteLength;
        if (size > 2 * 1024 * 1024) { void reader.cancel().catch(() => {}); throw Error('1688 상품 응답 크기가 수집 한도를 초과했습니다.'); }
        // Invalid encodings and malformed detail payloads remain hard failures.
        text += decoder.decode(part.value, {stream: true});
      }
      return {detailSource: text + decoder.decode(), detailUnavailable: undefined};
    } finally { if (reader) { if (!consumed) void reader.cancel().catch(() => {}); reader.releaseLock(); } }
  };
  try {
    if (options.signal.aborted) cancel();
    const value = await Promise.race([interruption, options.signal.aborted ? interruption : read()]);
    if (options.signal.aborted) throw Error('상품 수집을 취소했습니다.');
    return value;
  } finally {
    clearTimeout(timer); options.signal.removeEventListener('abort', cancel); controller.abort();
  }
}

function anonymousTransport(headers: Headers) {
  // Only cookies issued to this new anonymous request may be used. Never read
  // browser/session cookies, and never retain these in a receipt or a log.
  const cookies = new Map<string, string>();
  const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie') ?? ''];
  for (const value of values) {
    for (const match of value.matchAll(/(?:^|,\s*)(_m_h5_tk(?:_enc)?)=([A-Za-z0-9_-]{1,512})(?:;|$)/g)) {
      if (cookies.has(match[1]) && cookies.get(match[1]) !== match[2]) throw Error('익명 상품 조회 응답을 확인하지 못했습니다.');
      cookies.set(match[1], match[2]);
    }
  }
  const token = cookies.get('_m_h5_tk')?.match(/^([A-Za-z0-9]+)_\d{10,16}$/)?.[1];
  if (!token) throw Error('1688 공개 옵션 조회를 준비하지 못했습니다.');
  return {token, cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')};
}

/** Normal public lib-mtop handshake, limited to one anonymous token refresh.
 * Login, verification and access errors terminate; no challenge is solved. */
export async function queryAlibabaMobileSkus(offerId: string, options: {fetcher?: typeof fetch; signal: AbortSignal}) {
  if (!/^[1-9]\d{0,29}$/.test(offerId)) throw Error('1688 상품번호를 확인해주세요.');
  const data = JSON.stringify({params: JSON.stringify({offerId}), fcName: 'mini-od-cse', fcGroup: 'cbu-offer', serviceName: 'wirelessCoreOdService'});
  let token = 'undefined', cookie: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (options.signal.aborted) throw Error('상품 수집을 취소했습니다.');
    const timestamp = String(Date.now()), sign = publicMtopMd5(`${token}&${timestamp}&${PUBLIC_APP_KEY}&${data}`);
    const params = new URLSearchParams({jsv: '2.7.4', appKey: PUBLIC_APP_KEY, t: timestamp, sign, api: 'mtop.mbox.fc.common.gateway', v: '1.0', type: 'originaljson', dataType: 'json', data});
    let response: Response;
    try {
      response = await (options.fetcher ?? fetch)(SKU_ENDPOINT + '?' + params, {redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: options.signal,
        headers: {accept: 'application/json', ...(cookie ? {cookie} : {})}});
    } catch { throw Error(options.signal.aborted ? '상품 수집을 취소했거나 응답 시간이 초과되었습니다.' : '1688 옵션 조회 서버에 연결하지 못했습니다.'); }
    const body = await readBody(response, 2 * 1024 * 1024);
    let payload: {ret?: unknown};
    try { payload = JSON.parse(body); } catch { throw Error('1688 옵션 조회가 JSON을 반환하지 않았습니다.'); }
    if (!payload || !Array.isArray(payload.ret) || payload.ret.some(value => typeof value !== 'string')) throw Error('1688 옵션 조회 결과를 확인하지 못했습니다.');
    if (alibabaMobileResponseSucceeded(payload.ret)) return payload;
    if (attempt === 0 && payload.ret.length === 1 && /^FAIL_SYS_TOKEN_EMPTY(?:::|$)/.test(payload.ret[0])) {
      ({token, cookie} = anonymousTransport(response.headers)); continue;
    }
    throw Error('1688 옵션 조회가 상품 데이터를 반환하지 않았습니다. 로그인·확인 요구 또는 일시적 오류를 확인해주세요.');
  }
  throw Error('1688 옵션 조회를 완료하지 못했습니다.');
}

/** Return bounded, inert public sources, so a Chrome transport can send them
 * to the server for the same identity/SKU/price checks rather than a trusted receipt. */
export async function collectAlibabaMobileCapture(sourceUrl: string, options: {fetcher?: typeof fetch; signal: AbortSignal; optionalDetailTimeoutMs?: number}) {
  const source = parseCollectionRequest({urls: [sourceUrl]})[0];
  const request = async (url: string, accept: string) => {
    if (options.signal.aborted) throw Error('상품 수집을 취소했습니다.');
    let response: Response;
    try { response = await (options.fetcher ?? fetch)(url, {redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: options.signal, headers: {accept}}); }
    catch { throw Error(options.signal.aborted ? '상품 수집을 취소했거나 응답 시간이 초과되었습니다.' : '1688 공개 상품 페이지에 연결하지 못했습니다.'); }
    return response;
  };
  const response = await request(`https://m.1688.com/offer/${source.offerId}.html`, 'text/html');
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/html')) throw Error('1688 모바일 상품 페이지가 HTML이 아닙니다.');
  const mobileHtml = await readBody(response, 2 * 1024 * 1024);
  let page: ReturnType<typeof parseAlibabaMobilePage>;
  try { page = parseAlibabaMobilePage(mobileHtml, source.sourceUrl); }
  catch (error) {
    // Missing page initial data alone can use independently returned public SKU
    // facts. Mismatched/private/malformed page evidence remains a hard failure.
    if (!(error instanceof AlibabaMobileInitialDataUnavailableError)) throw error;
    const skuPayload = await queryAlibabaMobileSkus(source.offerId, options);
    if (options.signal.aborted) throw Error('상품 수집을 취소했습니다.');
    parseAlibabaPublicSkuProduct(skuPayload, source.sourceUrl);
    return {format: '1688-public-sku-capture-v1' as const, sourceUrl: source.sourceUrl, skuPayload};
  }
  const payload = await queryAlibabaMobileSkus(source.offerId, options);
  // Validate identity/SKUs/prices before following the page's bounded detail
  // reference. A response for another offer cannot authorize a detail read.
  const verified = parseAlibabaMobileProduct(page, payload);
  let detailSource='',detailUnavailable:{status:502|503|504}|undefined;
  if(page.detailUrl){
    try { ({detailSource, detailUnavailable} = await readOptionalDetail(page.detailUrl, options)); }
    catch (error) {
      if (options.signal.aborted) throw Error('상품 수집을 취소했습니다.');
      if (error instanceof OptionalDetailTransportError && !options.signal.aborted) throw new VerifiedMobileDetailUnavailable(error.reason, verified);
      throw error;
    }
  }
  if (options.signal.aborted) throw Error('상품 수집을 취소했습니다.');
  parseAlibabaMobileProduct(page, payload, detailSource ? parseAlibabaMobileDescription(detailSource) : '');
  if(detailUnavailable)return{format:'1688-public-mobile-partial-capture-v1' as const,sourceUrl:source.sourceUrl,mobileHtml,skuPayload:payload,detailSource,detailUnavailable};
  return {format:'1688-public-mobile-capture-v1' as const, sourceUrl:source.sourceUrl, mobileHtml, skuPayload:payload, detailSource};
}

export async function collectAlibabaMobileProduct(sourceUrl: string, options: {fetcher?: typeof fetch; signal: AbortSignal; optionalDetailTimeoutMs?: number}) {
  let capture: Awaited<ReturnType<typeof collectAlibabaMobileCapture>>;
  try { capture = await collectAlibabaMobileCapture(sourceUrl, options); }
  catch (error) {
    // A server-owned transport failure is not an invented HTTP status or a raw
    // Chrome capture. Only already verified offer/SKU facts can be recovered.
    if (options.signal.aborted) throw Error('상품 수집을 취소했습니다.');
    if (error instanceof VerifiedMobileDetailUnavailable) return {...error.result, provider: '1688-public-mobile-partial-v1'};
    throw error;
  }
  if (capture.format === '1688-public-sku-capture-v1') return parseAlibabaPublicSkuProduct(capture.skuPayload, capture.sourceUrl);
  const result=parseAlibabaMobileProduct(parseAlibabaMobilePage(capture.mobileHtml,capture.sourceUrl), capture.skuPayload,
    capture.detailSource ? parseAlibabaMobileDescription(capture.detailSource) : '');
  return capture.format==='1688-public-mobile-partial-capture-v1'?{...result,provider:'1688-public-mobile-partial-v1'}:result;
}
