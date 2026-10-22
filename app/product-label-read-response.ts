/** Read-only label lookups never treat an authentication page or an error body
 * as saved label evidence. Keep upstream response bodies out of UI errors. */
export async function readProductLabelJson<T>(url: string, request: typeof fetch = fetch): Promise<T> {
  let response: Response;
  try {
    response = await request(url, { cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
  } catch {
    throw Error('라벨 저장본에 연결하지 못했습니다. 로그인 상태와 연결을 확인한 뒤 다시 조회해주세요.');
  }
  if (response.redirected || response.status >= 300 && response.status < 400 || response.type === 'opaqueredirect') {
    throw Error('라벨 조회가 다른 화면으로 이동했습니다. 로그인 상태를 확인한 뒤 다시 조회해주세요.');
  }
  if (response.status === 401 || response.status === 403) {
    throw Error('라벨 저장본을 조회할 권한을 확인하지 못했습니다. 로그인 상태와 접근 권한을 확인한 뒤 다시 조회해주세요.');
  }
  if (!response.ok) {
    throw Error('라벨 저장본을 조회하지 못했습니다. 서버 연결 상태를 확인한 뒤 다시 조회해주세요.');
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw Error('라벨 조회 응답이 올바른 데이터 형식이 아닙니다. 로그인 상태와 연결을 확인한 뒤 다시 조회해주세요.');
  }
  try {
    return await response.json() as T;
  } catch {
    throw Error('라벨 조회 데이터 응답을 읽지 못했습니다. 잠시 후 다시 조회해주세요.');
  }
}
