function requestName(url: string, method: string) {
  // Diagnostics identify only known route templates, never product/option IDs,
  // upload hashes, profile queries, foreign URLs or response body fragments.
  const path = url.split(/[?#]/, 1)[0];
  const route = path === '/api/files' ? '/api/files'
    : /^\/api\/products\/[A-Za-z0-9_-]{1,100}\/(product-labels|quotation-fields|attachments)$/.test(path)
      ? path.replace(/\/products\/[^/]+\//, '/products/:id/') : 'label-api';
  return `${['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method) ? method : 'REQUEST'} ${route}`;
}

/** Shared by receipt reads and upload/attachment writes. HTML can be an
 * upstream error or login response even for a mounted API route. Never parse it
 * as JSON or expose its body; retain stage, HTTP status and response format. */
export async function productLabelResponseJson<T>(response: Response, url: string, method = 'GET'): Promise<T> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  const format = contentType === 'application/json' ? 'JSON 응답' : contentType === 'text/html' ? 'HTML 응답' : '비 JSON 응답';
  const detail = `[${requestName(url, method)} · HTTP ${response.status} · ${format}]`;
  if (response.redirected || response.status >= 300 && response.status < 400 || response.type === 'opaqueredirect')
    throw Error(`라벨 요청이 다른 화면으로 이동했습니다. 로그인 상태를 확인해주세요. ${detail}`);
  if (response.status === 401 || response.status === 403)
    throw Error(`라벨 저장본의 접근 권한을 확인하지 못했습니다. 로그인 상태를 확인해주세요. ${detail}`);
  if (response.status === 409)
    throw Error(`라벨 저장 원천 또는 연결 상태가 변경됐습니다. 최신 저장본을 확인해주세요. ${detail}`);
  if (!response.ok) throw Error(`라벨 요청을 처리하지 못했습니다. 저장 결과와 서버 연결을 확인해주세요. ${detail}`);
  if (contentType !== 'application/json') throw Error(`라벨 응답이 올바른 데이터 형식이 아닙니다. ${detail}`);
  try { return await response.json() as T; }
  catch { throw Error(`라벨 JSON 응답을 읽지 못했습니다. 저장 결과를 다시 조회해주세요. ${detail}`); }
}

/** Read-only lookups keep transport errors and upstream bodies private. */
export async function readProductLabelJson<T>(url: string, request: typeof fetch = fetch): Promise<T> {
  let response: Response;
  try {
    response = await request(url, { cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
  } catch {
    throw Error('라벨 저장본에 연결하지 못했습니다. 로그인 상태와 연결을 확인한 뒤 다시 조회해주세요.');
  }
  return productLabelResponseJson<T>(response, url);
}
