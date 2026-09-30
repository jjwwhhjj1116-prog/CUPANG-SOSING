import { parseCollectionRequest } from '@/app/sourcing';
import { parseAlibabaMobilePage, parseAlibabaMobileDescription, parseAlibabaMobileProduct } from '@/app/alibaba-mobile-product';

const SKU_ENDPOINT = 'https://h5api.m.1688.com/h5/mtop.mbox.fc.common.gateway/1.0/';
const PUBLIC_APP_KEY = '12574478'; // Alibaba's public lib-mtop 2.7.4 client ID, not an owned OpenAPI key.

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
  const {createHash} = await import('node:crypto');
  const data = JSON.stringify({params: JSON.stringify({offerId}), fcName: 'mini-od-cse', fcGroup: 'cbu-offer', serviceName: 'wirelessCoreOdService'});
  let token = 'undefined', cookie: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (options.signal.aborted) throw Error('상품 수집을 취소했습니다.');
    const timestamp = String(Date.now()), sign = createHash('md5').update(`${token}&${timestamp}&${PUBLIC_APP_KEY}&${data}`).digest('hex');
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
    if (payload.ret.some(value => /^SUCCESS(?:::|$)/.test(value))) return payload;
    if (attempt === 0 && payload.ret.length === 1 && /^FAIL_SYS_TOKEN_EMPTY(?:::|$)/.test(payload.ret[0])) {
      ({token, cookie} = anonymousTransport(response.headers)); continue;
    }
    throw Error('1688 옵션 조회가 상품 데이터를 반환하지 않았습니다. 로그인·확인 요구 또는 일시적 오류를 확인해주세요.');
  }
  throw Error('1688 옵션 조회를 완료하지 못했습니다.');
}

export async function collectAlibabaMobileProduct(sourceUrl: string, options: {fetcher?: typeof fetch; signal: AbortSignal}) {
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
  const page = parseAlibabaMobilePage(await readBody(response, 2 * 1024 * 1024), source.sourceUrl);
  const payload = await queryAlibabaMobileSkus(source.offerId, options);
  // Validate identity/SKUs/prices before following the page's bounded detail
  // reference. A response for another offer cannot authorize a detail read.
  parseAlibabaMobileProduct(page, payload);
  const description = page.detailUrl ? parseAlibabaMobileDescription(await readBody(await request(page.detailUrl, 'text/plain'), 2 * 1024 * 1024)) : '';
  if (options.signal.aborted) throw Error('상품 수집을 취소했습니다.');
  return parseAlibabaMobileProduct(page, payload, description);
}
