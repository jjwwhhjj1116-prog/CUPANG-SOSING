import assert from 'node:assert/strict';
import { request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { APP_ORIGIN, MAX_BODY_BYTES, MAX_DIAGNOSTIC_EVENTS, createCliServer, validateCommand } from '../cli/server.mjs';
import { CLI_TOOLS, CLI_VERSION, parseArguments, startCli } from '../cli/yoofam-studio.mjs';

const A = { ownerId: 'synthetic-owner-a', company: { code: 'A01526306', name: '유앤채' } };
const B = { ownerId: 'synthetic-owner-b', company: { code: 'A01464742', name: '와이홉' } };
const send = (connection, path, body, options = {}) => new Promise((resolve, reject) => {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const req = request({ hostname: '127.0.0.1', port: connection.port, path, method: options.method ?? (body === undefined ? 'GET' : 'POST'), headers: {
    host: `127.0.0.1:${connection.port}`, origin: APP_ORIGIN, authorization: `Bearer ${connection.token}`,
    ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }), ...options.headers,
  } }, (res) => {
    let text = ''; res.setEncoding('utf8'); res.on('data', (value) => text += value);
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null }));
  });
  req.on('error', reject); req.end(payload);
});
async function setup(t, options = {}) {
  const server = createCliServer({ port: 0, ...options });
  const connection = await server.listen();
  t.after(() => server.close());
  const pair = (scope = A) => send(connection, '/pair', { sessionId: connection.sessionId, scope });
  const next = (waitMs = 0) => send(connection, `/next?sessionId=${connection.sessionId}&waitMs=${waitMs}`);
  const result = (jobId, scope = A, extra = { ok: true, result: { synthetic: true } }) => send(connection, '/result', { sessionId: connection.sessionId, jobId, scope, ...extra });
  return { server, connection, pair, next, result };
}
const observe = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, code: error.code }));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('launch URL contains only a random ephemeral secret, port and session in the fragment', async (t) => {
  const { connection, server } = await setup(t);
  const url = new URL(connection.connectUrl);
  assert.equal(url.origin, APP_ORIGIN); assert.equal(url.pathname, '/cli'); assert.equal(url.search, '');
  assert.match(connection.token, /^[0-9a-f]{64}$/); assert.equal(new URLSearchParams(url.hash.slice(1)).get('session'), connection.sessionId);
  assert.equal(server.getState().connected, false); assert.equal(server.getState().pendingCount, 0);
  assert.throws(() => createCliServer({ host: '0.0.0.0' }), { code: 'HOST_INVALID' });
  assert.throws(() => createCliServer({ allowedOrigins: ['https://example.com'] }), { code: 'ORIGIN_INVALID' });
});

test('DNS rebinding, untrusted Origin, missing Origin and token guesses are rejected before pairing', async (t) => {
  const { connection, server } = await setup(t);
  for (const headers of [{ host: `attacker.example:${connection.port}` }, { origin: 'https://sourceflow.jjwwhhjj1116.workers.dev.attacker.example' }, { origin: 'null' }, { origin: '' }]) {
    assert.equal((await send(connection, '/pair', { sessionId: connection.sessionId, scope: A }, { headers })).status, 403);
  }
  for (const authorization of ['', 'Bearer guess', `Bearer ${'0'.repeat(64)}`, `Bearer ${'x'.repeat(200)}`]) {
    const response = await send(connection, '/pair', { sessionId: connection.sessionId, scope: A }, { headers: { authorization } });
    assert.equal(response.status, 401); assert.equal(response.body.error.code, 'TOKEN_INVALID'); assert.equal(JSON.stringify(response.body).includes(connection.token), false);
  }
  assert.equal(server.getState().connected, false);
});

test('exact localhost Host alias pairs only on the existing IPv4 loopback listener', async (t) => {
  const { connection, server } = await setup(t);
  const alias = { host: `localhost:${connection.port}` };
  const preflight = await send(connection, '/pair', undefined, { method: 'OPTIONS', headers: { ...alias, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers['access-control-allow-origin'], APP_ORIGIN);
  const response = await send(connection, '/pair', { sessionId: connection.sessionId, scope: A }, { headers: alias });
  assert.equal(response.status, 200); assert.deepEqual(response.body.scope, A); assert.equal(server.getState().connected, true);
  const address = await new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: connection.port, path: `/next?sessionId=${connection.sessionId}&waitMs=0`, headers: { ...alias, origin: APP_ORIGIN, authorization: `Bearer ${connection.token}` } }, res => { const remoteAddress = res.socket.remoteAddress; res.resume(); res.on('end', () => resolve(remoteAddress)); });
    req.on('error', reject); req.end();
  });
  assert.equal(address, '127.0.0.1');
  for (const host of ['localhost', '0.0.0.0', '::', '[::1]']) assert.throws(() => createCliServer({ host }), { code: 'HOST_INVALID' });
  assert.equal(new URL(connection.connectUrl).search, ''); assert.equal(new URLSearchParams(new URL(connection.connectUrl).hash.slice(1)).has('host'), false, 'default connection URL is unchanged');
});

test('localhost alias rejects wrong ports, lookalikes, local domains, IPv6 and public Host values', async (t) => {
  const { connection, server } = await setup(t);
  const hosts = [`localhost:${connection.port + 1}`, `localhost.attacker.example:${connection.port}`, `localhost.:${connection.port}`, `LOCALHOST:${connection.port}`, `other.localhost:${connection.port}`, `device.local:${connection.port}`, `127.0.0.1.attacker.example:${connection.port}`, `[::1]:${connection.port}`, `0.0.0.0:${connection.port}`, `192.168.1.1:${connection.port}`, `example.com:${connection.port}`, 'localhost', '127.0.0.1'];
  for (const host of hosts) {
    const response = await send(connection, '/pair', { sessionId: connection.sessionId, scope: A }, { headers: { host } });
    assert.equal(response.status, 403); assert.equal(response.body.error.code, 'HOST_INVALID');
  }
  assert.equal(server.getState().connected, false); assert.equal(server.getState().pendingCount, 0);
});

test('localhost alias retains Origin, Bearer, session and company checks with redacted diagnostics', async (t) => {
  const { connection, server } = await setup(t);
  const host = `localhost:${connection.port}`, body = { sessionId: connection.sessionId, scope: A };
  assert.equal((await send(connection, '/pair', body, { headers: { host, origin: 'https://synthetic-private-host.example' } })).body.error.code, 'ORIGIN_INVALID');
  assert.equal((await send(connection, '/pair', body, { headers: { host, authorization: 'Bearer synthetic-private-host-token' } })).body.error.code, 'TOKEN_INVALID');
  assert.equal((await send(connection, '/pair', { ...body, sessionId: randomUUID() }, { headers: { host } })).body.error.code, 'SESSION_INVALID');
  assert.equal((await send(connection, '/pair', body, { headers: { host } })).status, 200);
  assert.equal((await send(connection, '/pair', { ...body, scope: B }, { headers: { host } })).body.error.code, 'SCOPE_CHANGED');
  const serialized = JSON.stringify(server.getDiagnostics());
  for (const value of [host, 'synthetic-private-host.example', 'synthetic-private-host-token', connection.token, connection.sessionId, A.ownerId, A.company.code, B.ownerId]) assert.equal(serialized.includes(value), false);
  for (const event of server.getDiagnostics().events) assert.deepEqual(Object.keys(event).sort(), ['errorCode', 'method', 'originAllowed', 'route', 'status', 'timestamp']);
});

test('strict preflight supports browser loopback permission without granting arbitrary headers', async (t) => {
  const { connection } = await setup(t);
  const response = await send(connection, '/pair', undefined, { method: 'OPTIONS', headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type', 'access-control-request-private-network': 'true' } });
  assert.equal(response.status, 204); assert.equal(response.headers['access-control-allow-origin'], APP_ORIGIN); assert.equal(response.headers['access-control-allow-private-network'], 'true');
  assert.equal(response.headers['access-control-allow-credentials'], undefined);
  assert.equal((await send(connection, '/pair', undefined, { method: 'OPTIONS', headers: { 'access-control-request-method': 'DELETE' } })).status, 403);
  assert.equal((await send(connection, '/pair', undefined, { method: 'OPTIONS', headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'cookie' } })).status, 403);
});

test('local development Origins require an explicit startup option', async (t) => {
  const defaultServer = await setup(t);
  const body = { sessionId: defaultServer.connection.sessionId, scope: A };
  assert.equal((await send(defaultServer.connection, '/pair', body, { headers: { origin: 'http://localhost:3000' } })).status, 403);
  const dev = await setup(t, { allowedOrigins: ['http://localhost:3000'] });
  assert.equal((await send(dev.connection, '/pair', { ...body, sessionId: dev.connection.sessionId }, { headers: { origin: 'http://localhost:3000' } })).status, 200);
  assert.equal((await send(dev.connection, '/pair', { ...body, sessionId: dev.connection.sessionId }, { headers: { origin: 'http://127.0.0.1:3000' } })).status, 403);
});

test('pairing requires an allowed exact company and preserves account ownership', async (t) => {
  const { connection, pair, server } = await setup(t);
  assert.throws(() => server.enqueue('status'), { code: 'PAIR_REQUIRED' });
  for (const scope of [{ ...A, company: { code: 'A01526306', name: '와이홉' } }, { ...A, company: { code: 'OTHER', name: '유앤채' } }, { ...A, company: {} }, { ...A, company: { code: 'OTHER' } }, { ...A, company: { code: 'A01526306' } }, { ...A, ownerId: '' }, { ...A, ownerId: ' ' }, { ...A, injected: true }]) assert.equal((await pair(scope)).status, 403);
  assert.equal((await send(connection, '/pair', { sessionId: randomUUID(), scope: A })).status, 403);
  assert.equal((await pair()).status, 200); assert.equal((await pair()).status, 200);
  assert.equal((await pair(B)).status, 409); assert.equal((await pair({ ...A, ownerId: 'other-user' })).status, 409);
  assert.deepEqual(server.getState().scope, A);
});

test('a typed query travels to the app and returns the app result without a source-site request', async (t) => {
  const { server, pair, next, result } = await setup(t); await pair();
  const pending = server.enqueue('product-query', { sourceUrl: 'https://detail.1688.com/offer/700000000789.html?tracking=discarded' });
  const answer = observe(pending);
  const response = await next();
  assert.equal(response.status, 200); assert.equal(response.body.job.command, 'product-query');
  assert.equal(response.body.job.payload.sourceUrl, 'https://detail.1688.com/offer/700000000789.html'); assert.deepEqual(response.body.job.scope, A);
  assert.equal((await result(pending.jobId, A, { ok: true, result: { title: '합성 검수 상품', offerId: '700000000789' } })).status, 200);
  assert.deepEqual(await answer, { ok: true, value: { title: '합성 검수 상품', offerId: '700000000789' } }); assert.equal(server.getState().pendingCount, 0);
});

test('arbitrary shell, JavaScript, app routes and source URLs are not command inputs', async (t) => {
  const { server, pair, connection } = await setup(t); await pair();
  for (const command of ['submit', 'eval', 'shell', '/api/products', 'fetch']) assert.throws(() => server.enqueue(command, {}), { code: 'COMMAND_NOT_ALLOWED' });
  for (const sourceUrl of ['http://detail.1688.com/offer/700000000789.html', 'https://detail.1688.com.attacker.example/offer/700000000789.html', 'https://user:password@detail.1688.com/offer/700000000789.html', 'https://detail.1688.com:444/offer/700000000789.html', 'file:///secret', 'http://127.0.0.1/admin', 'https://detail.1688.com/shop']) assert.throws(() => server.enqueue('product-query', { sourceUrl }), { code: 'COMMAND_INVALID' });
  assert.throws(() => server.enqueue('status', { route: '/api/products' }), { code: 'COMMAND_INVALID' });
  assert.throws(() => server.enqueue('collection-job/status', { jobId: '../other-user' }), { code: 'COMMAND_INVALID' });
  assert.equal((await send(connection, '/enqueue', { command: 'status' })).status, 404); assert.equal(server.getState().pendingCount, 0);
});

test('only the currently delivered job can settle; duplicates and reordered results cannot overwrite it', async (t) => {
  const { server, pair, next, result } = await setup(t); await pair();
  const first = server.enqueue('status'); const second = server.enqueue('category-profiles/list');
  const firstAnswer = observe(first); const secondAnswer = observe(second);
  assert.equal((await result(second.jobId)).status, 409);
  assert.equal((await next()).body.job.jobId, first.jobId);
  assert.equal((await next()).status, 409); assert.equal((await result(second.jobId)).status, 409);
  assert.equal((await result(first.jobId)).status, 200); assert.equal((await firstAnswer).ok, true);
  assert.equal((await result(first.jobId)).body.error.code, 'JOB_ALREADY_SETTLED');
  assert.equal((await next()).body.job.jobId, second.jobId); assert.equal((await result(second.jobId)).status, 200); assert.equal((await secondAnswer).ok, true);
});

test('results from another company or another same-company account are rejected without losing the task', async (t) => {
  const { server, pair, next, result } = await setup(t); await pair();
  const pending = server.enqueue('status'); const answer = observe(pending); await next();
  assert.equal((await result(pending.jobId, B)).status, 409);
  assert.equal((await result(pending.jobId, { ...A, ownerId: 'other-owner' })).status, 409);
  assert.equal(server.getState().activeJobId, pending.jobId);
  assert.equal((await result(pending.jobId)).status, 200); assert.equal((await answer).ok, true);
});

test('disconnect cancels all jobs and permanently revokes the token for both original and different owners', async (t) => {
  const { server, connection, pair, next, result } = await setup(t); await pair();
  const first = server.enqueue('status'); const second = server.enqueue('category-profiles/list');
  const answers = [observe(first), observe(second)]; await next();
  assert.equal((await send(connection, '/disconnect', { sessionId: connection.sessionId, scope: A })).status, 200);
  assert.deepEqual(await Promise.all(answers), [{ ok: false, code: 'SESSION_DISCONNECTED' }, { ok: false, code: 'SESSION_DISCONNECTED' }]);
  assert.equal((await pair(B)).status, 410); assert.equal((await pair(A)).status, 410); assert.equal((await result(first.jobId, A)).status, 410); assert.equal((await result(first.jobId, B)).status, 410);
  assert.equal(server.getState().revoked, true); assert.throws(() => server.enqueue('status'), { code: 'SESSION_REVOKED' });
  assert.equal(server.getState().pendingCount, 0);
});

test('queue capacity is bounded and browser cancellation rejects late completion', async (t) => {
  const { server, connection, pair, next, result } = await setup(t); await pair();
  const jobs = Array.from({ length: 16 }, () => server.enqueue('status'));
  const answers = jobs.map(observe); assert.throws(() => server.enqueue('status'), { code: 'QUEUE_FULL' });
  await next(); assert.equal((await send(connection, '/abort', { sessionId: connection.sessionId, scope: A, jobId: jobs[0].jobId })).status, 200);
  assert.equal((await answers[0]).code, 'JOB_ABORTED'); assert.equal((await result(jobs[0].jobId)).status, 409);
  jobs.slice(1).forEach((job) => job.cancel()); await Promise.all(answers); assert.equal(server.getState().pendingCount, 0);
});

test('job timeout and TTL expiry cancel work and never accept a late result', async (t) => {
  const timed = await setup(t, { jobTimeoutMs: 60 }); await timed.pair();
  const pending = timed.server.enqueue('status'); const answer = observe(pending); await timed.next();
  assert.equal((await answer).code, 'JOB_TIMEOUT'); assert.equal((await timed.result(pending.jobId)).status, 409);
  const expiry = await setup(t, { ttlMs: 150 }); await expiry.pair();
  const expires = expiry.server.enqueue('status'); const expiresAnswer = observe(expires);
  assert.equal((await expiresAnswer).code, 'SESSION_EXPIRED'); assert.equal((await expiry.pair()).status, 410); assert.equal(expiry.server.getState().pendingCount, 0);
});

test('only one bounded browser long poll exists and it wakes when a command is queued', async (t) => {
  const { server, pair, next, result } = await setup(t); await pair();
  const waiting = next(1000); await delay(20);
  assert.equal((await next(10)).body.error.code, 'POLL_IN_FLIGHT');
  const pending = server.enqueue('status'); const answer = observe(pending);
  assert.equal((await waiting).body.job.jobId, pending.jobId); await result(pending.jobId); await answer;
  assert.deepEqual((await next(10)).body, { ok: true, job: null });
});

test('oversized or non-JSON results and malformed completion shapes do not settle a job', async (t) => {
  const { connection, server, pair, next, result } = await setup(t); await pair();
  const pending = server.enqueue('status'); const answer = observe(pending); await next();
  assert.equal((await send(connection, '/result', {}, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await send(connection, '/result', {}, { headers: { 'content-length': String(MAX_BODY_BYTES + 1) } })).status, 413);
  assert.equal((await result(pending.jobId, A, { ok: true, error: { code: 'OOPS', message: 'error' } })).status, 400);
  assert.equal((await result(pending.jobId, A, { ok: false, result: {}, error: { code: 'OOPS', message: 'error' } })).status, 400);
  assert.equal(server.getState().activeJobId, pending.jobId);
  assert.equal((await result(pending.jobId, A, { ok: false, error: { code: 'QUERY_NOT_APPROVED', message: '상품 조회를 허용하지 않았습니다.' } })).status, 200);
  assert.equal((await answer).code, 'QUERY_NOT_APPROVED');
});

test('a result body started before disconnect is checked again after the session is revoked', async (t) => {
  const { connection, server, pair, next } = await setup(t); await pair();
  const pending = server.enqueue('status'); const answer = observe(pending); await next();
  const body = JSON.stringify({ sessionId: connection.sessionId, scope: A, jobId: pending.jobId, ok: true, result: { synthetic: true } });
  let req;
  const lateResponse = new Promise((resolve, reject) => {
    req = request({ hostname: '127.0.0.1', port: connection.port, path: '/result', method: 'POST', headers: { host: `127.0.0.1:${connection.port}`, origin: APP_ORIGIN, authorization: `Bearer ${connection.token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.write(body.slice(0, -1));
  });
  await delay(15);
  await send(connection, '/disconnect', { sessionId: connection.sessionId, scope: A });
  assert.equal((await answer).code, 'SESSION_DISCONNECTED'); assert.equal((await pair(B)).status, 410);
  req.end(body.slice(-1)); assert.equal(await lateResponse, 410); assert.equal(server.getState().scope, null); assert.equal(server.getState().pendingCount, 0);
});

test('chunked request cannot bypass the eight MiB body limit or settle the active job', async (t) => {
  const { connection, server, pair, next, result } = await setup(t); await pair();
  const pending = server.enqueue('status'); const answer = observe(pending); await next();
  const attack = await new Promise((resolve) => {
    const req = request({ hostname: '127.0.0.1', port: connection.port, path: '/result', method: 'POST', headers: { host: `127.0.0.1:${connection.port}`, origin: APP_ORIGIN, authorization: `Bearer ${connection.token}`, 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', (error) => resolve(error.code));
    req.end('x'.repeat(MAX_BODY_BYTES + 1024));
  });
  assert.ok(attack === 413 || attack === 'ECONNRESET', `expected rejection, received ${attack}`);
  assert.equal(server.getState().activeJobId, pending.jobId); assert.equal((await result(pending.jobId)).status, 200); assert.equal((await answer).ok, true);
});

test('CLI publishes separate tools for explicit main and detail image edits', () => {
  assert.deepEqual(CLI_TOOLS.map((tool) => tool.name), ['status', 'product-query', 'category-profiles/list', 'collection-job/status','main-image/next','main-image/complete', 'detail_image_next', 'detail_image_complete']);
  assert.equal(parseArguments(['serve', '--stdio', '--port', '49832', '--allow-local-dev']).port, 49832);
  assert.equal(parseArguments([]).diagnostics, false); assert.equal(parseArguments(['serve', '--diagnostics']).diagnostics, true);
  assert.equal(parseArguments([]).autoDetail, false); assert.equal(parseArguments(['serve', '--auto-detail']).autoDetail, true);
  for (const args of [['--port', '0'], ['--host', '0.0.0.0'], ['--token', 'secret'], ['exec', 'anything']]) assert.throws(() => parseArguments(args), { code: 'ARGUMENT_INVALID' });
  assert.deepEqual(validateCommand('category-profiles/list'), {});
});

test('local diagnostics distinguish no traffic, preflight only, pair arrival and an HTTP rejection', async (t) => {
  const observed = [];
  const { server, connection, pair } = await setup(t, { onDiagnostic: (event) => observed.push(event) });
  assert.deepEqual(server.getDiagnostics(), { format: 'yoofam-cli-transport-diagnostics-v1', requestCount: 0, optionsCount: 0, pairPostCount: 0, rejectedCount: 0, inFlightCount: 0, eventCapacity: MAX_DIAGNOSTIC_EVENTS, events: [] });
  await send(connection, '/pair', undefined, { method: 'OPTIONS', headers: { 'access-control-request-method': 'POST' } });
  let diagnostics = server.getDiagnostics();
  assert.equal(diagnostics.optionsCount, 1); assert.equal(diagnostics.pairPostCount, 0); assert.equal(diagnostics.events[0].status, 204);
  assert.deepEqual(observed.map((event) => event.status), [0, 204]);
  await pair();
  await send(connection, '/pair', { sessionId: connection.sessionId, scope: A }, { headers: { authorization: 'Bearer synthetic-wrong-token' } });
  diagnostics = server.getDiagnostics();
  assert.equal(diagnostics.requestCount, 3); assert.equal(diagnostics.pairPostCount, 2); assert.equal(diagnostics.rejectedCount, 1); assert.equal(diagnostics.inFlightCount, 0);
  assert.deepEqual(diagnostics.events.map(({ method, route, originAllowed, status, errorCode }) => ({ method, route, originAllowed, status, errorCode })), [
    { method: 'OPTIONS', route: '/pair', originAllowed: true, status: 204, errorCode: null },
    { method: 'POST', route: '/pair', originAllowed: true, status: 200, errorCode: null },
    { method: 'POST', route: '/pair', originAllowed: true, status: 401, errorCode: 'TOKEN_INVALID' },
  ]);
  for (const event of [...diagnostics.events, ...observed]) {
    assert.deepEqual(Object.keys(event).sort(), ['errorCode', 'method', 'originAllowed', 'route', 'status', 'timestamp']);
    assert.ok(Number.isSafeInteger(event.timestamp)); assert.ok(Number.isInteger(event.status) && event.status >= 0 && event.status <= 599);
  }
});

test('diagnostics never retain raw path, query, Origin, authorization, cookies, scopes, body or client error text', async (t) => {
  const observed = [];
  const { server, connection, pair, next, result } = await setup(t, { onDiagnostic: (event) => { observed.push({ ...event }); event.method = 'mutated-copy'; event.route = 'private-callback-value'; } });
  const forbidden = ['synthetic-private-path', 'synthetic-private-query', 'https://synthetic-private-origin.example', 'synthetic-private-authorization', 'synthetic-private-cookie', 'synthetic-private-body', 'synthetic-private-client-code', 'synthetic-private-client-message', connection.sessionId, connection.token, A.ownerId, A.company.code, A.company.name];
  await send(connection, '/synthetic-private-path?secret=synthetic-private-query', { password: 'synthetic-private-body' }, { headers: { origin: forbidden[2], authorization: forbidden[3], cookie: forbidden[4] } });
  await send(connection, '/pair', { password: 'synthetic-private-body' }, { headers: { authorization: forbidden[3], cookie: forbidden[4] } });
  await pair();
  const pending = server.enqueue('status'); const answer = observe(pending); await next();
  await result(pending.jobId, A, { ok: false, error: { code: 'synthetic-private-client-code', message: 'synthetic-private-client-message' } });
  assert.equal((await answer).code, 'synthetic-private-client-code');
  const diagnostics = server.getDiagnostics();
  const text = JSON.stringify({ diagnostics, observed });
  for (const value of [...forbidden, pending.jobId, 'mutated-copy', 'private-callback-value']) assert.equal(text.includes(value), false, `diagnostics leaked ${value}`);
  assert.equal(diagnostics.events[0].route, 'other'); assert.equal(diagnostics.events[0].originAllowed, false); assert.equal(diagnostics.events[0].errorCode, 'ORIGIN_INVALID');
  assert.equal(diagnostics.events.at(-1).errorCode, null);
  diagnostics.events[0].route = 'mutated-snapshot'; diagnostics.requestCount = -1;
  assert.equal(server.getDiagnostics().events[0].route, 'other'); assert.ok(server.getDiagnostics().requestCount > 0);
});

test('diagnostic memory and callbacks stay bounded per request while retaining exact traffic counters', async (t) => {
  let callbackCount = 0;
  const { server, connection } = await setup(t, { onDiagnostic: () => { callbackCount += 1; } });
  const count = MAX_DIAGNOSTIC_EVENTS + 7;
  for (let index = 0; index < count; index += 1) await send(connection, '/pair', undefined, { method: 'OPTIONS', headers: { 'access-control-request-method': 'POST' } });
  const diagnostics = server.getDiagnostics();
  assert.equal(diagnostics.requestCount, count); assert.equal(diagnostics.optionsCount, count); assert.equal(diagnostics.inFlightCount, 0);
  assert.equal(diagnostics.events.length, MAX_DIAGNOSTIC_EVENTS); assert.equal(callbackCount, count * 2);
  assert.ok(diagnostics.events.every((event) => event.status === 204 && event.errorCode === null));
  assert.equal(server.getState().connected, false); assert.equal(server.getState().pendingCount, 0);
});

test('a pair request with an unfinished body is visible as arrived and its closed socket is recorded once', async (t) => {
  const { connection, server } = await setup(t);
  const req = request({ hostname: '127.0.0.1', port: connection.port, path: '/pair', method: 'POST', headers: { origin: APP_ORIGIN, authorization: `Bearer ${connection.token}`, 'content-type': 'application/json', 'content-length': 20 } });
  req.on('error', () => {}); req.write('{');
  await delay(20);
  assert.equal(server.getDiagnostics().pairPostCount, 1); assert.equal(server.getDiagnostics().inFlightCount, 1); assert.equal(server.getDiagnostics().events[0].status, 0);
  req.destroy(); await delay(20);
  assert.equal(server.getDiagnostics().inFlightCount, 0); assert.equal(server.getDiagnostics().events[0].status, 0); assert.equal(server.getDiagnostics().events[0].errorCode, 'CONNECTION_CLOSED');
  assert.equal(server.getState().connected, false);
});

test('throwing diagnostic observers cannot grant access or break a valid pair', async (t) => {
  const { connection, server, pair } = await setup(t, { onDiagnostic: () => { throw new Error('synthetic diagnostic observer'); } });
  assert.equal((await send(connection, '/pair', { sessionId: connection.sessionId, scope: A }, { headers: { host: `attacker.example:${connection.port}` } })).status, 403);
  assert.equal((await send(connection, '/pair', { sessionId: connection.sessionId, scope: A }, { headers: { origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await send(connection, '/pair', { sessionId: connection.sessionId, scope: A }, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await pair()).status, 200); assert.equal(server.getState().connected, true);
  assert.equal((await send(connection, '/diagnostics')).status, 404);
  assert.equal(server.getDiagnostics().rejectedCount, 4);
});

test('actual stdio tool discovery and a paired status round trip use JSON Lines without shell execution', async (t) => {
  const input = new PassThrough(); const output = new PassThrough(); let text = '';
  const diagnostic = new PassThrough(); let diagnosticText = '';
  diagnostic.setEncoding('utf8'); diagnostic.on('data', (chunk) => { diagnosticText += chunk; });
  output.setEncoding('utf8'); output.on('data', (chunk) => { text += chunk; });
  // Reserve an ephemeral port using the same loopback server, then release it.
  const reservation = createCliServer({ port: 0 }); const reserved = await reservation.listen(); await reservation.close();
  const cli = await startCli(['serve', '--stdio', '--port', String(reserved.port)], { input, output, diagnostic }); t.after(() => cli.close());
  const lines = () => text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(lines()[0].method, 'notifications/connectionReady');
  input.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n'); await delay(10);
  assert.equal(lines().find((line) => line.id === 1).result.tools.length, 8);
  input.write('{"jsonrpc":"2.0","id":"package-version","method":"initialize"}\n'); await delay(10);
  assert.equal(lines().find((line) => line.id === 'package-version').result.serverInfo.version, CLI_VERSION);
  await send(cli.connection, '/pair', { sessionId: cli.connection.sessionId, scope: A });
  input.write('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"status","arguments":{}}}\n');
  const next = await send(cli.connection, `/next?sessionId=${cli.connection.sessionId}&waitMs=1000`);
  assert.equal(next.body.job.command, 'status');
  await send(cli.connection, '/result', { sessionId: cli.connection.sessionId, scope: A, jobId: next.body.job.jobId, ok: true, result: { connected: true, synthetic: true } });
  await delay(10); assert.equal(lines().find((line) => line.id === 2).result.structuredContent.connected, true);
  input.write('x'.repeat(33_000)); input.write('\n'); await delay(10);
  assert.ok(lines().some((line) => line.error?.code === 'INPUT_TOO_LARGE'));
  assert.equal(diagnosticText, '');
});

const detailImage = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nZkAAAAASUVORK5CYII=' };

test('detail MCP sends only the explicit job metadata and relays result files to the detail command', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'yoofam-detail-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const resultFile = join(folder, 'result.png');
  await writeFile(resultFile, Buffer.from(detailImage.data, 'base64'));
  const input = new PassThrough(); const output = new PassThrough(); let text = '';
  output.setEncoding('utf8'); output.on('data', (chunk) => { text += chunk; });
  const reservation = createCliServer({ port: 0 }); const reserved = await reservation.listen(); await reservation.close();
  const cli = await startCli(['serve', '--stdio', '--port', String(reserved.port)], { input, output }); t.after(() => cli.close());
  const { connection } = cli;
  const requestId = randomUUID();
  const job = { productId: 'product', optionId: 'red', profileId: null, sourceKey: `${A.ownerId}/source.png`, prompt: '상세 사진의 중국어를 번역하세요.', requestId };
  const call = (id, name, args) => input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`);
  const next = () => send(connection, `/next?sessionId=${connection.sessionId}&waitMs=150`);
  const reply = (jobId, result) => send(connection, '/result', { sessionId: connection.sessionId, scope: A, jobId, ok: true, result });
  const read = (id) => text.trim().split('\n').map((line) => JSON.parse(line)).find((line) => line.id === id);
  await send(connection, '/pair', { sessionId: connection.sessionId, scope: A });
  call('claim', 'detail_image_next', {});
  const claim = (await next()).body.job;
  assert.equal(claim?.command, 'detail-image/next');
  await reply(claim.jobId, { job: { ...job, authorization: connection.token }, image: detailImage, ...A, sessionToken: connection.token });
  assert.deepEqual(read('claim').result, { content: [{ type: 'text', text: JSON.stringify({ job }) }, { type: 'image', ...detailImage }], structuredContent: { job } });
  call('save', 'detail_image_complete', { requestId, filePath: resultFile });
  const save = (await next()).body.job;
  assert.equal(save?.command, 'detail-image/complete');
  assert.deepEqual(save.payload, { requestId, image: detailImage });
  const receipt = { key: `${A.ownerId}/edited.png`, productVersion: '2026-11-07T00:00:00Z' };
  await reply(save.jobId, { ...receipt, ...A, sessionToken: connection.token });
  assert.deepEqual(read('save').result.structuredContent, receipt);
  call('empty', 'detail_image_next', {});
  const empty = (await next()).body.job;
  await reply(empty.jobId, { job: null, ...A });
  assert.deepEqual(read('empty').result.structuredContent, { job: null });
});

test('detail upload rejects unsupported and oversized files before queuing their bytes', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'yoofam-detail-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const wrong = join(folder, 'wrong.png'); const oversized = join(folder, 'large.png');
  await writeFile(wrong, Buffer.from('not an image'));
  await writeFile(oversized, Buffer.alloc(4 * 1024 * 1024 + 1));
  const input = new PassThrough(); const output = new PassThrough(); const lines = [];
  output.setEncoding('utf8'); output.on('data', (chunk) => lines.push(JSON.parse(chunk)));
  const reservation = createCliServer({ port: 0 }); const reserved = await reservation.listen(); await reservation.close();
  const cli = await startCli(['serve', '--stdio', '--port', String(reserved.port)], { input, output }); t.after(() => cli.close());
  const { connection } = cli;
  await send(connection, '/pair', { sessionId: connection.sessionId, scope: A });
  for (const [id, filePath, code] of [['wrong', wrong, 'IMAGE_INVALID'], ['large', oversized, 'IMAGE_INVALID'], ['relative', 'out.png', 'IMAGE_PATH_INVALID']]) {
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'detail_image_complete', arguments: { requestId: randomUUID(), filePath } } })}\n`);
    await new Promise(setImmediate);
    assert.equal(lines.find((line) => line.id === id)?.error.data.code, code);
  }
  assert.equal(cli.server.getState().pendingCount, 0);
});

test('opt-in detail worker launches a bounded local process only after an explicit paired job', async (t) => {
  const input = new PassThrough(); const output = new PassThrough(); const diagnostic = new PassThrough();
  const launches = [];
  const resultImage = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' };
  const reservation = createCliServer({ port: 0 }); const reserved = await reservation.listen(); await reservation.close();
  const cli = await startCli(['serve', '--stdio', '--auto-detail', '--port', String(reserved.port)], {
    input, output, diagnostic,
    detailWorker: {
      pollMs: 20,
      spawnProcess(command, args, options) {
        launches.push({ command, args, options });
        const stub = 'const fs=require("node:fs");const assert=require("node:assert/strict");let prompt="";process.stdin.setEncoding("utf8");process.stdin.on("data",x=>prompt+=x);process.stdin.on("end",()=>{assert.match(prompt,/translate only this image/);assert.equal(fs.readFileSync("source.png").toString("base64"),process.argv[1]);fs.writeFileSync("result.png",Buffer.from(process.argv[2],"base64"));});';
        return spawn(process.execPath, ['-e', stub, detailImage.data, resultImage.data], options);
      },
    },
  });
  t.after(() => cli.close());
  const { connection, server } = cli;
  const next = () => send(connection, `/next?sessionId=${connection.sessionId}&waitMs=1000`);
  const reply = (jobId, result) => send(connection, '/result', { sessionId: connection.sessionId, scope: A, jobId, ok: true, result });
  await delay(40);
  assert.equal(server.getState().pendingCount, 0);
  assert.equal(launches.length, 0);
  await send(connection, '/pair', { sessionId: connection.sessionId, scope: A });
  const empty = (await next()).body.job;
  assert.equal(empty?.command, 'detail-image/next');
  await reply(empty.jobId, { job: null, ...A });
  assert.equal(launches.length, 0);
  const claim = (await next()).body.job;
  const requestId = randomUUID();
  await reply(claim.jobId, { job: { productId: 'product', optionId: 'red', profileId: null, sourceKey: `${A.ownerId}/source.png`, prompt: 'translate only this image', requestId }, image: detailImage, ...A });
  const upload = (await next()).body.job;
  assert.equal(upload?.command, 'detail-image/complete');
  assert.deepEqual(upload.payload, { requestId, image: resultImage });
  await reply(upload.jobId, { key: `${A.ownerId}/edited.png`, productVersion: '2026-11-07T00:00:00Z', ...A });
  assert.equal(launches.length, 1);
  assert.equal(launches[0].command, 'codex');
  assert.deepEqual(launches[0].args.slice(-3), ['--image', 'source.png', '-']);
  assert.equal(launches[0].options.shell, false);
  assert.ok(launches[0].options.cwd.includes('yoofam-detail-'));
  assert.equal(JSON.stringify(launches[0].args).includes(connection.token), false);
});

test('a timed-out detail edit terminates its process and reports the claimed request once', async (t) => {
  const input = new PassThrough(); const output = new PassThrough(); const diagnostic = new PassThrough();
  const launches = [];
  const reservation = createCliServer({ port: 0 }); const reserved = await reservation.listen(); await reservation.close();
  const cli = await startCli(['serve', '--stdio', '--auto-detail', '--port', String(reserved.port)], {
    input, output, diagnostic,
    detailWorker: { pollMs: 20, timeoutMs: 100, spawnProcess(_command, _args, options) {
      const child = spawn(process.execPath, ['-e', 'process.stdin.resume();setInterval(()=>{},1000)'], options);
      launches.push(child);
      return child;
    } },
  });
  t.after(() => cli.close());
  const { connection } = cli;
  const next = () => send(connection, `/next?sessionId=${connection.sessionId}&waitMs=1000`);
  const reply = (jobId, result) => send(connection, '/result', { sessionId: connection.sessionId, scope: A, jobId, ok: true, result });
  await send(connection, '/pair', { sessionId: connection.sessionId, scope: A });
  const claim = (await next()).body.job;
  assert.equal(claim?.command, 'detail-image/next');
  const requestId = randomUUID();
  await reply(claim.jobId, { job: { productId: 'product', optionId: 'red', profileId: null, sourceKey: `${A.ownerId}/source.png`, prompt: 'translate', requestId }, image: detailImage, ...A });
  const failure = (await next()).body.job;
  assert.equal(failure?.command, 'detail-image/fail');
  assert.deepEqual(failure.payload, { requestId, reason: 'timed-out' });
  await reply(failure.jobId, { failed: true, ...A });
  assert.equal(launches.length, 1);
  assert.equal(launches[0].killed, true);
  const waiting = (await next()).body.job;
  assert.equal(waiting?.command, 'detail-image/next');
  await reply(waiting.jobId, { job: null, ...A });
  assert.equal(launches.length, 1);
});

test('--diagnostics emits only sanitized transport events to stderr without adding a remote MCP method', async (t) => {
  const input = new PassThrough(); const output = new PassThrough(); const diagnostic = new PassThrough(); let text = ''; let diagnosticText = '';
  output.setEncoding('utf8'); output.on('data', (chunk) => { text += chunk; });
  diagnostic.setEncoding('utf8'); diagnostic.on('data', (chunk) => { diagnosticText += chunk; });
  const reservation = createCliServer({ port: 0 }); const reserved = await reservation.listen(); await reservation.close();
  const cli = await startCli(['serve', '--stdio', '--diagnostics', '--port', String(reserved.port)], { input, output, diagnostic }); t.after(() => cli.close());
  assert.equal(diagnosticText, '');
  await send(cli.connection, '/pair', undefined, { method: 'OPTIONS', headers: { 'access-control-request-method': 'POST' } });
  await send(cli.connection, '/pair', { sessionId: cli.connection.sessionId, scope: A });
  const events = diagnosticText.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.length, 4); assert.deepEqual(events.map((event) => event.status), [0, 204, 0, 200]);
  assert.ok(events.every((event) => event.type === 'transport-diagnostic'));
  for (const value of [cli.connection.token, cli.connection.sessionId, A.ownerId, A.company.code]) assert.equal(diagnosticText.includes(value), false);
  assert.equal(text.trim().split('\n').length, 1);
  input.write('{"jsonrpc":"2.0","id":"diag-not-remote","method":"diagnostics"}\n'); await delay(10);
  const result = text.trim().split('\n').map((line) => JSON.parse(line)).find((line) => line.id === 'diag-not-remote');
  assert.equal(result.error.data.code, 'METHOD_NOT_ALLOWED'); assert.equal(CLI_TOOLS.length, 8);
});

test('terminal diagnostics is local only, works before pairing and causes no HTTP requests', async (t) => {
  const input = new PassThrough(); const output = new PassThrough(); const diagnostic = new PassThrough(); let text = ''; let diagnosticText = '';
  output.setEncoding('utf8'); output.on('data', (chunk) => { text += chunk; });
  diagnostic.setEncoding('utf8'); diagnostic.on('data', (chunk) => { diagnosticText += chunk; });
  const reservation = createCliServer({ port: 0 }); const reserved = await reservation.listen(); await reservation.close();
  const cli = await startCli(['serve', '--port', String(reserved.port)], { input, output, diagnostic }); t.after(() => cli.close());
  text = ''; input.write('diagnostics\n'); await delay(10);
  const summary = JSON.parse(text.trim());
  assert.equal(summary.format, 'yoofam-cli-transport-diagnostics-v1'); assert.equal(summary.requestCount, 0); assert.deepEqual(summary.events, []);
  assert.equal(cli.server.getState().connected, false); assert.equal(cli.server.getState().pendingCount, 0); assert.equal(diagnosticText, '');
  for (const value of [cli.connection.token, cli.connection.sessionId]) assert.equal(text.includes(value), false);
});
