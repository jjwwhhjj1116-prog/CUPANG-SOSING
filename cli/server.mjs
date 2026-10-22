import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const PROTOCOL_VERSION = '1.0';
export const APP_ORIGIN = 'https://sourceflow.jjwwhhjj1116.workers.dev';
export const DEFAULT_PORT = 49831;
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
export const MAX_DIAGNOSTIC_EVENTS = 64;
const COMPANIES = new Map([['A01526306', '유앤채'], ['A01464742', '와이홉']]);
const CLIENT_ERRORS = new Set(['code', 'message']);
const DIAGNOSTIC_ROUTES = new Set(['/pair', '/next', '/result', '/abort', '/disconnect']);
const DIAGNOSTIC_METHODS = new Set(['GET', 'POST', 'OPTIONS', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'CONNECT', 'TRACE']);
const DIAGNOSTIC_ERRORS = new Set(['HOST_INVALID', 'ORIGIN_INVALID', 'SESSION_REVOKED', 'SESSION_EXPIRED', 'PREFLIGHT_INVALID', 'TOKEN_INVALID', 'REQUEST_INVALID', 'SESSION_INVALID', 'PAIR_REQUIRED', 'POLL_IN_FLIGHT', 'JOB_IN_FLIGHT', 'ROUTE_NOT_ALLOWED', 'CONTENT_TYPE_INVALID', 'BODY_TOO_LARGE', 'JSON_INVALID', 'SCOPE_INVALID', 'SCOPE_CHANGED', 'JOB_INVALID', 'JOB_ALREADY_SETTLED', 'JOB_ORDER_INVALID', 'RESULT_INVALID', 'REQUEST_FAILED', 'SESSION_DISCONNECTED', 'SERVER_CLOSED', 'CONNECTION_CLOSED']);

export class CliError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'CliError'; this.code = code; this.status = status; }
}
const failure = (code, message, status) => new CliError(code, message, status);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const ownKeys = (value, allowed) => record(value) && Object.keys(value).every((key) => allowed.includes(key));
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const bounded = (value, min, max, fallback) => Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
const copy = (value) => JSON.parse(JSON.stringify(value));
const digest = (value) => createHash('sha256').update(value).digest();

export function normalizeScope(value) {
  if (!ownKeys(value, ['ownerId', 'company']) || typeof value.ownerId !== 'string' || value.ownerId.trim().length < 1 || value.ownerId.length > 256 || /[\u0000-\u001f]/.test(value.ownerId)
      || !ownKeys(value.company, ['code', 'name']) || typeof value.company.code !== 'string' || typeof value.company.name !== 'string' || !COMPANIES.has(value.company.code) || COMPANIES.get(value.company.code) !== value.company.name) {
    throw failure('SCOPE_INVALID', '허용된 회사와 로그인 계정을 확인해주세요.', 403);
  }
  return { ownerId: value.ownerId, company: { code: value.company.code, name: value.company.name } };
}
const scopeKey = (value) => JSON.stringify(normalizeScope(value));

export function validateCommand(command, payload = {}) {
  if (command === 'status' || command === 'category-profiles/list') {
    if (!ownKeys(payload, [])) throw failure('COMMAND_INVALID', '이 명령에는 추가 입력을 사용할 수 없습니다.');
    return {};
  }
  if (command === 'product-query') {
    if (!ownKeys(payload, ['sourceUrl']) || typeof payload.sourceUrl !== 'string' || payload.sourceUrl.length > 2048) throw failure('COMMAND_INVALID', '1688 상품 URL을 확인해주세요.');
    let parsed;
    try { parsed = new URL(payload.sourceUrl); } catch { throw failure('COMMAND_INVALID', '1688 상품 URL을 확인해주세요.'); }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'detail.1688.com' || parsed.port || parsed.username || parsed.password || !/^\/offer\/[0-9]{8,20}\.html$/.test(parsed.pathname)) {
      throw failure('COMMAND_INVALID', 'detail.1688.com의 상품 URL만 사용할 수 있습니다.');
    }
    return { sourceUrl: `https://detail.1688.com${parsed.pathname}` };
  }
  if (command === 'collection-job/status') {
    if (!ownKeys(payload, ['jobId']) || !uuid(payload.jobId)) throw failure('COMMAND_INVALID', '작업 번호를 확인해주세요.');
    return { jobId: payload.jobId };
  }
  throw failure('COMMAND_NOT_ALLOWED', '허용된 읽기 명령만 사용할 수 있습니다.', 403);
}

/** Independent localhost transport. It does not fetch source sites or execute shell/code. */
export function createCliServer(options = {}) {
  if (options.host && options.host !== '127.0.0.1') throw failure('HOST_INVALID', '127.0.0.1에서만 실행할 수 있습니다.');
  const port = options.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw failure('PORT_INVALID', '포트를 확인해주세요.');
  const allowedOrigins = new Set([APP_ORIGIN]);
  for (const origin of options.allowedOrigins ?? []) {
    if (!['http://localhost:3000', 'http://127.0.0.1:3000'].includes(origin)) throw failure('ORIGIN_INVALID', '로컬 개발 주소를 확인해주세요.');
    allowedOrigins.add(origin);
  }
  const sessionId = randomUUID();
  const token = randomBytes(32).toString('hex');
  const tokenDigest = digest(`Bearer ${token}`);
  const ttlMs = bounded(options.ttlMs, 100, 15 * 60_000, 15 * 60_000);
  const timeoutMs = bounded(options.jobTimeoutMs, 50, 120_000, 60_000);
  const expiresAt = Date.now() + ttlMs;
  const jobs = new Map();
  const completed = new Set();
  let ownerScope = null;
  let activeJobId = null;
  let waiter = null;
  let listeningPort = null;
  let closed = false;
  let expired = false;
  let revoked = false;
  const diagnosticEvents = [];
  const responseDiagnostics = new WeakMap();
  const diagnosticCounts = { requestCount: 0, optionsCount: 0, pairPostCount: 0, rejectedCount: 0, inFlightCount: 0 };
  const increment = (key) => { diagnosticCounts[key] = Math.min(Number.MAX_SAFE_INTEGER, diagnosticCounts[key] + 1); };
  const emitDiagnostic = (event) => {
    // Only this allowlisted shape leaves the transport. Never pass req/res or errors.
    if (typeof options.onDiagnostic === 'function') {
      try { options.onDiagnostic({ ...event }); } catch { /* Diagnostics cannot alter authorization or request handling. */ }
    }
  };
  const beginDiagnostic = (req, res) => {
    const path = String(req.url ?? '').split('?', 1)[0];
    const event = {
      method: DIAGNOSTIC_METHODS.has(req.method) ? req.method : 'OTHER',
      route: DIAGNOSTIC_ROUTES.has(path) ? path : 'other',
      originAllowed: typeof req.headers.origin === 'string' && allowedOrigins.has(req.headers.origin),
      status: 0, errorCode: null, timestamp: Date.now(),
    };
    diagnosticEvents.push(event);
    if (diagnosticEvents.length > MAX_DIAGNOSTIC_EVENTS) diagnosticEvents.shift();
    increment('requestCount'); increment('inFlightCount');
    if (event.method === 'OPTIONS') increment('optionsCount');
    if (event.method === 'POST' && event.route === '/pair') increment('pairPostCount');
    responseDiagnostics.set(res, event);
    let finalized = false;
    const finish = (completed) => {
      if (finalized) return;
      finalized = true;
      diagnosticCounts.inFlightCount = Math.max(0, diagnosticCounts.inFlightCount - 1);
      event.status = completed && Number.isInteger(res.statusCode) && res.statusCode >= 100 && res.statusCode <= 599 ? res.statusCode : 0;
      if (!completed) event.errorCode = 'CONNECTION_CLOSED';
      if (event.status >= 400) increment('rejectedCount');
      emitDiagnostic(event);
    };
    res.once('finish', () => finish(true));
    res.once('close', () => finish(res.writableFinished));
    emitDiagnostic(event);
  };

  const respond = (res, status, body) => {
    if (res.destroyed || res.writableEnded) return;
    const event = responseDiagnostics.get(res);
    if (event) event.errorCode = DIAGNOSTIC_ERRORS.has(body?.error?.code) ? body.error.code : null;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(body));
  };
  const takeWaiter = () => {
    const current = waiter;
    if (current) { waiter = null; clearTimeout(current.timer); }
    return current;
  };
  const noteCompleted = (id) => { completed.add(id); if (completed.size > 128) completed.delete(completed.values().next().value); };
  const finishJob = (id, error, result) => {
    const job = jobs.get(id);
    if (!job) return;
    jobs.delete(id); clearTimeout(job.timer); noteCompleted(id);
    if (activeJobId === id) activeJobId = null;
    if (error) job.reject(error); else job.resolve(result);
  };
  const clearSession = (code, message) => {
    ownerScope = null;
    const current = takeWaiter();
    if (current) respond(current.res, 409, { ok: false, error: { code, message } });
    for (const id of [...jobs.keys()]) finishJob(id, failure(code, message, 409));
    activeJobId = null;
  };
  const expiryTimer = setTimeout(() => { expired = true; clearSession('SESSION_EXPIRED', '로컬 연결 시간이 만료됐습니다. 다시 실행해주세요.'); }, ttlMs);
  expiryTimer.unref();
  const ensureActive = () => {
    if (revoked) throw failure('SESSION_REVOKED', '종료된 로컬 연결입니다. CLI를 다시 실행해주세요.', 410);
    if (closed || expired || Date.now() >= expiresAt) throw failure('SESSION_EXPIRED', '로컬 연결 시간이 만료됐습니다. 다시 실행해주세요.', 410);
  };
  const checkSession = (value) => { if (value !== sessionId) throw failure('SESSION_INVALID', '연결 세션이 일치하지 않습니다.', 403); };
  const checkScope = (value) => {
    if (!ownerScope || scopeKey(value) !== JSON.stringify(ownerScope)) throw failure('SCOPE_CHANGED', '로그인 계정 또는 회사가 변경됐습니다. 연결을 종료하고 다시 연결해주세요.', 409);
  };
  const nextJob = (res) => {
    if (activeJobId) throw failure('JOB_IN_FLIGHT', '이전 작업 결과를 기다리고 있습니다.', 409);
    const job = jobs.values().next().value;
    if (!job) return false;
    activeJobId = job.jobId;
    job.delivered = true;
    respond(res, 200, { ok: true, job: copy({ jobId: job.jobId, command: job.command, payload: job.payload, scope: job.scope, createdAt: job.createdAt, deadline: job.deadline }) });
    return true;
  };
  const wake = () => {
    if (!waiter || activeJobId || !jobs.size) return;
    const current = takeWaiter();
    try { nextJob(current.res); } catch (error) { respond(current.res, error.status ?? 500, { ok: false, error: { code: error.code ?? 'REQUEST_FAILED', message: error.message } }); }
  };
  const readJson = async (req) => {
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw failure('CONTENT_TYPE_INVALID', 'JSON 요청만 사용할 수 있습니다.', 415);
    const length = req.headers['content-length'];
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw failure('BODY_TOO_LARGE', '요청 크기가 제한을 초과했습니다.', 413);
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY_BYTES) throw failure('BODY_TOO_LARGE', '요청 크기가 제한을 초과했습니다.', 413); chunks.push(chunk); }
    try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!record(body)) throw new Error('record'); return body; }
    catch { throw failure('JSON_INVALID', 'JSON 요청을 확인해주세요.'); }
  };

  const server = createServer(async (req, res) => {
    beginDiagnostic(req, res);
    try {
      // Both names identify this exact loopback listener. This does not change
      // the bind address or admit arbitrary .localhost/.local/public domains.
      if (req.headers.host !== `127.0.0.1:${listeningPort}` && req.headers.host !== `localhost:${listeningPort}`) throw failure('HOST_INVALID', '로컬 호스트가 일치하지 않습니다.', 403);
      const origin = req.headers.origin;
      if (typeof origin !== 'string' || !allowedOrigins.has(origin)) throw failure('ORIGIN_INVALID', '허용된 앱에서만 연결할 수 있습니다.', 403);
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
      ensureActive();
      if (req.method === 'OPTIONS') {
        const method = req.headers['access-control-request-method'];
        const headers = String(req.headers['access-control-request-headers'] ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
        if (!['GET', 'POST'].includes(method) || headers.some((value) => !['authorization', 'content-type'].includes(value))) throw failure('PREFLIGHT_INVALID', '허용되지 않은 연결 요청입니다.', 403);
        res.setHeader('access-control-allow-methods', 'GET, POST');
        res.setHeader('access-control-allow-headers', 'authorization, content-type');
        res.setHeader('access-control-max-age', '60');
        if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('access-control-allow-private-network', 'true');
        res.writeHead(204); res.end(); return;
      }
      const authorization = req.headers.authorization;
      if (typeof authorization !== 'string' || authorization.length > 128 || !timingSafeEqual(digest(authorization), tokenDigest)) throw failure('TOKEN_INVALID', '로컬 연결 토큰이 일치하지 않습니다.', 401);
      const parsed = new URL(req.url, `http://127.0.0.1:${listeningPort}`);
      if (req.method === 'GET' && parsed.pathname === '/next') {
        if ([...parsed.searchParams.keys()].some((key) => !['sessionId', 'waitMs'].includes(key)) || parsed.searchParams.getAll('sessionId').length !== 1 || parsed.searchParams.getAll('waitMs').length > 1) throw failure('REQUEST_INVALID', '조회 요청을 확인해주세요.');
        checkSession(parsed.searchParams.get('sessionId'));
        const rawWait = parsed.searchParams.get('waitMs');
        if (rawWait !== null && !/^\d+$/.test(rawWait)) throw failure('REQUEST_INVALID', '대기 시간을 확인해주세요.');
        if (!ownerScope) throw failure('PAIR_REQUIRED', '앱에서 계정과 회사를 확인하고 연결해주세요.', 409);
        if (waiter) throw failure('POLL_IN_FLIGHT', '이미 작업을 조회하고 있습니다.', 409);
        if (nextJob(res)) return;
        const waitMs = bounded(rawWait === null ? 25_000 : Number(rawWait), 0, 25_000, 25_000);
        if (!waitMs) { respond(res, 200, { ok: true, job: null }); return; }
        const pending = { res, timer: null };
        pending.timer = setTimeout(() => { if (waiter === pending) { takeWaiter(); respond(res, 200, { ok: true, job: null }); } }, waitMs);
        waiter = pending;
        res.on('close', () => { if (waiter === pending) takeWaiter(); });
        return;
      }
      if (req.method !== 'POST' || !['/pair', '/result', '/disconnect', '/abort'].includes(parsed.pathname) || parsed.search) throw failure('ROUTE_NOT_ALLOWED', '허용되지 않은 로컬 경로입니다.', 404);
      const body = await readJson(req);
      ensureActive(); // A body can arrive after expiry/disconnect; never trust the initial check alone.
      checkSession(body.sessionId);
      if (parsed.pathname === '/pair') {
        if (!ownKeys(body, ['sessionId', 'scope'])) throw failure('REQUEST_INVALID', '연결 요청을 확인해주세요.');
        const proposed = normalizeScope(body.scope);
        if (ownerScope && JSON.stringify(ownerScope) !== JSON.stringify(proposed)) throw failure('SCOPE_CHANGED', '다른 회사로 연결하려면 먼저 기존 연결을 종료해주세요.', 409);
        ownerScope = proposed;
        respond(res, 200, { ok: true, protocolVersion: PROTOCOL_VERSION, sessionId, scope: copy(ownerScope), expiresAt }); return;
      }
      checkScope(body.scope);
      if (parsed.pathname === '/disconnect') {
        if (!ownKeys(body, ['sessionId', 'scope'])) throw failure('REQUEST_INVALID', '연결 종료 요청을 확인해주세요.');
        // A paired capability is bound to its original owner for its entire life.
        // Reconnecting another owner requires a new process/token/session.
        revoked = true;
        clearSession('SESSION_DISCONNECTED', '앱에서 로컬 연결을 종료했습니다.');
        respond(res, 200, { ok: true }); return;
      }
      if (!uuid(body.jobId)) throw failure('JOB_INVALID', '작업 번호를 확인해주세요.');
      const job = jobs.get(body.jobId);
      if (!job || activeJobId !== body.jobId || !job.delivered) throw failure(completed.has(body.jobId) ? 'JOB_ALREADY_SETTLED' : 'JOB_ORDER_INVALID', '완료됐거나 현재 처리 중인 작업이 아닙니다.', 409);
      if (JSON.stringify(job.scope) !== JSON.stringify(ownerScope)) throw failure('SCOPE_CHANGED', '작업의 회사가 일치하지 않습니다.', 409);
      if (parsed.pathname === '/abort') {
        if (!ownKeys(body, ['sessionId', 'scope', 'jobId'])) throw failure('REQUEST_INVALID', '작업 취소 요청을 확인해주세요.');
        finishJob(body.jobId, failure('JOB_ABORTED', '앱에서 작업을 취소했습니다.', 409));
      } else {
        if (!ownKeys(body, ['sessionId', 'scope', 'jobId', 'ok', 'result', 'error']) || typeof body.ok !== 'boolean' || (body.ok ? (!Object.hasOwn(body, 'result') || Object.hasOwn(body, 'error')) : (Object.hasOwn(body, 'result') || !ownKeys(body.error, [...CLIENT_ERRORS]) || typeof body.error.code !== 'string' || typeof body.error.message !== 'string' || body.error.code.length > 80 || body.error.message.length > 500))) throw failure('RESULT_INVALID', '작업 결과 형식을 확인해주세요.');
        if (body.ok) finishJob(body.jobId, null, copy(body.result));
        else finishJob(body.jobId, failure(body.error.code, body.error.message, 422));
      }
      respond(res, 200, { ok: true });
    } catch (error) {
      respond(res, error instanceof CliError ? error.status : 500, { ok: false, error: { code: error instanceof CliError ? error.code : 'REQUEST_FAILED', message: error instanceof CliError ? error.message : '로컬 연결 요청을 처리하지 못했습니다.' } });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1_000;
  return {
    async listen() {
      if (listeningPort !== null) return this.connection();
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); listeningPort = server.address().port; resolve(); }); });
      return this.connection();
    },
    connection() {
      if (listeningPort === null) throw failure('NOT_LISTENING', '로컬 연결 서버를 먼저 시작해주세요.');
      const fragment = new URLSearchParams({ port: String(listeningPort), token, session: sessionId });
      return { sessionId, token, port: listeningPort, expiresAt, connectUrl: `${APP_ORIGIN}/cli#${fragment}` };
    },
    getState() { return { protocolVersion: PROTOCOL_VERSION, connected: Boolean(ownerScope), scope: ownerScope ? copy(ownerScope) : null, expiresAt, pendingCount: jobs.size, activeJobId, expired: expired || Date.now() >= expiresAt, revoked, closed }; },
    getDiagnostics() { return { format: 'yoofam-cli-transport-diagnostics-v1', ...diagnosticCounts, eventCapacity: MAX_DIAGNOSTIC_EVENTS, events: diagnosticEvents.map((event) => ({ ...event })) }; },
    enqueue(command, payload = {}) {
      ensureActive();
      if (!ownerScope) throw failure('PAIR_REQUIRED', '앱에서 계정과 회사를 확인하고 연결해주세요.', 409);
      const validated = validateCommand(command, payload);
      if (jobs.size >= 16) throw failure('QUEUE_FULL', '대기 중인 작업이 많습니다. 기존 작업 완료 후 다시 시도해주세요.', 429);
      const jobId = randomUUID(); const createdAt = Date.now();
      let cancel;
      const promise = new Promise((resolve, reject) => {
        const job = { jobId, command, payload: validated, scope: copy(ownerScope), createdAt, deadline: Math.min(expiresAt, createdAt + timeoutMs), resolve, reject, delivered: false, timer: null };
        job.timer = setTimeout(() => {
          if (job.deadline === expiresAt) { expired = true; clearSession('SESSION_EXPIRED', '로컬 연결 시간이 만료됐습니다. 다시 실행해주세요.'); }
          else finishJob(jobId, failure('JOB_TIMEOUT', '앱 작업 응답 시간이 초과됐습니다.', 504));
        }, Math.max(0, job.deadline - createdAt));
        jobs.set(jobId, job);
        cancel = () => finishJob(jobId, failure('JOB_ABORTED', '로컬 요청에서 작업을 취소했습니다.', 409));
      });
      // Consumers can cancel without a hidden /enqueue HTTP endpoint.
      Object.assign(promise, { jobId, cancel });
      wake(); return promise;
    },
    async close() {
      if (closed) return;
      closed = true; clearTimeout(expiryTimer); clearSession('SERVER_CLOSED', '로컬 연결 서버를 종료했습니다.');
      if (listeningPort === null) return;
      await new Promise((resolve) => { server.close(resolve); server.closeIdleConnections(); server.closeAllConnections(); });
    },
  };
}
