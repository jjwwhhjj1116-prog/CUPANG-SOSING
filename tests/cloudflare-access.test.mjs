import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const output = ts.transpileModule(fs.readFileSync(new URL('../app/cloudflare-access.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(overrides = {}) {
  const exports = {};
  vm.runInNewContext(output, { exports, crypto, TextEncoder, TextDecoder, URL, atob, btoa, AbortController, setTimeout, clearTimeout, fetch: () => { throw Error('Tests must never use the network'); }, ...overrides });
  return exports;
}
const auth = load();
const config = { teamDomain: 'synthetic-team.cloudflareaccess.com', audience: 'synthetic-audience' };
const issuer = 'https://synthetic-team.cloudflareaccess.com';
const now = 2_000_000_000_000;
const base = { iss: issuer, aud: [config.audience], type: 'app', sub: 'synthetic-user-id', email: 'test@example.invalid', iat: now / 1000 - 60, nbf: now / 1000 - 60, exp: now / 1000 + 600 };
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'synthetic-key', alg: 'RS256', use: 'sig' };
const encoded = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
async function token(claims = base, header = {}, privateKey = pair.privateKey) {
  const data = `${encoded({ alg: 'RS256', typ: 'JWT', kid: jwk.kid, ...header })}.${encoded(claims)}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(data));
  return `${data}.${Buffer.from(signature).toString('base64url')}`;
}
const headers = value => new Headers(value ? { 'cf-access-jwt-assertion': value } : {});
const validJwks = () => Response.json({ keys: [jwk] });
const verifier = (fetcher = validJwks, clock = () => now) => auth.createCloudflareAccessVerifier({ fetcher, now: clock });
async function expectCode(promise, code, status) { await assert.rejects(promise, error => error.code === code && error.status === status && !error.message.includes('eyJ')); }

test('Access accepts a genuine RSA signature and derives a stable owner from verified issuer/sub, not mutable email or spoofed headers', async () => {
  let calls = 0;
  const verify = verifier(async (url, init) => { calls++; assert.equal(url, `${issuer}/cdn-cgi/access/certs`); assert.equal(init.redirect, 'error'); assert.equal(init.method, 'GET'); assert.ok(init.signal); return validJwks(); });
  const requestHeaders = headers(await token()); requestHeaders.set('oai-authenticated-user-id', 'forged-owner'); requestHeaders.set('cf-access-authenticated-user-email', 'forged@example.invalid');
  const identity = await verify.authenticate(requestHeaders, config);
  assert.match(identity.userId, /^cf:[a-f0-9]{64}$/); assert.equal(identity.subject, base.sub); assert.equal(identity.email, base.email); assert.equal(identity.displayName, base.email); assert.equal(identity.fullName, null);
  const next = await verify.authenticate(headers(await token({ ...base, email: 'new@example.invalid', aud: config.audience })), config);
  assert.equal(next.userId, identity.userId); assert.equal(calls, 1);
  const other = await verify.authenticate(headers(await token({ ...base, sub: 'another-user' })), config); assert.notEqual(other.userId, identity.userId);
});

test('Access configuration and missing assertions fail closed before any key request', async () => {
  let calls = 0; const verify = verifier(async () => { calls++; return validJwks(); });
  assert.equal(auth.hasProductionAccessConfig(config), true);
  for (const change of [{}, { ...config, audience: '' }, { ...config, audience: 'two values' }, { ...config, teamDomain: 'https://attacker.example' }, { ...config, teamDomain: 'http://synthetic-team.cloudflareaccess.com' }, { ...config, teamDomain: 'https://a.cloudflareaccess.com/keys' }, { ...config, teamDomain: 'https://a.cloudflareaccess.com@attacker.example' }, { ...config, teamDomain: 'https://a.cloudflareaccess.com?key=test' }]) {
    assert.equal(auth.hasProductionAccessConfig(change), false); await expectCode(verify.authenticate(headers(), change), 'not_configured', 503);
  }
  await expectCode(verify.authenticate(headers(), config), 'missing_token', 401);
  await expectCode(verify.authenticate(new Headers({ cookie: 'CF_Authorization=ignored', 'oai-authenticated-user-id': 'spoof' }), config), 'missing_token', 401);
  assert.equal(calls, 0);
});

test('Access rejects issuer, audience, token type, expiry, not-before and identity mismatches', async () => {
  let calls = 0; const verify = verifier(async () => { calls++; return validJwks(); });
  const changes = [{ iss: 'https://evil.cloudflareaccess.com' }, { aud: 'other-app' }, { aud: [config.audience, 12] }, { type: 'org' }, { exp: now / 1000 }, { exp: 'future' }, { nbf: now / 1000 + 1 }, { nbf: 'today' }, { iat: now / 1000 + 1 }, { iat: null }, { sub: '' }, { sub: 'bad\nsubject' }, { email: '' }, { email: 'not email' }];
  for (const change of changes) await expectCode(verify.authenticate(headers(await token({ ...base, ...change })), config), 'invalid_token', 401);
  assert.equal(calls, 0);
});

test('Access rejects algorithm substitution, remote key headers, malformed JWTs and signature/payload tampering', async () => {
  const verify = verifier();
  for (const header of [{ alg: 'none' }, { alg: 'HS256' }, { typ: 'Other' }, { kid: '' }, { jku: 'https://evil.invalid/jwks' }, { jwk }, { crit: ['custom'] }, { b64: false }]) await expectCode(verify.authenticate(headers(await token(base, header)), config), 'invalid_token', 401);
  for (const value of ['not-jwt', 'a.b.c', 'a..c', `${'x'.repeat(16385)}`, `${encoded('{}')}.${encoded('{}')}.abc`]) await expectCode(verify.authenticate(headers(value), config), 'invalid_token', 401);
  const signed = await token(); const pieces = signed.split('.'); pieces[1] = encoded({ ...base, email: 'tampered@example.invalid' });
  await expectCode(verify.authenticate(headers(pieces.join('.')), config), 'invalid_token', 401);
  const signature = Buffer.from(signed.split('.')[2], 'base64url'); signature[12] ^= 1;
  await expectCode(verify.authenticate(headers(`${signed.split('.').slice(0, 2).join('.')}.${signature.toString('base64url')}`), config), 'invalid_token', 401);
});

test('Access coalesces concurrent key requests and refreshes bounded cache for key rotation', async () => {
  let clock = now; let calls = 0; let latest = [jwk];
  const verify = verifier(async () => { calls++; await Promise.resolve(); return Response.json({ keys: latest }); }, () => clock);
  const signed = await token();
  await Promise.all(Array.from({ length: 12 }, () => verify.authenticate(headers(signed), config))); assert.equal(calls, 1);
  const rotated = { ...jwk, kid: 'rotated-key' }; latest = [jwk, rotated]; const rotatedToken = await token(base, { kid: rotated.kid });
  await expectCode(verify.authenticate(headers(rotatedToken), config), 'invalid_token', 401); assert.equal(calls, 1);
  clock += 31_000; await verify.authenticate(headers(rotatedToken), config); assert.equal(calls, 2);
  clock += 301_000; await verify.authenticate(headers(rotatedToken), config); assert.equal(calls, 3);
});

test('Access does not use expired cached keys on outage and bounds failure retries', async () => {
  let clock = now; let calls = 0; let fail = false;
  const verify = verifier(async () => { calls++; if (fail) throw Error('internal secret network detail'); return validJwks(); }, () => clock);
  const signed = await token(); await verify.authenticate(headers(signed), config); fail = true; clock += 301_000;
  await expectCode(verify.authenticate(headers(signed), config), 'jwks_unavailable', 503);
  await expectCode(verify.authenticate(headers(signed), config), 'jwks_unavailable', 503); assert.equal(calls, 2);
  clock += 31_000; fail = false; await verify.authenticate(headers(signed), config); assert.equal(calls, 3);
});

test('Access rejects oversized or malformed JWKS, ambiguous keys and inappropriate key algorithms', async () => {
  const signed = await token();
  for (const fetcher of [
    async () => new Response('redirect', { status: 302 }),
    async () => new Response('not-json'),
    async () => new Response('x'.repeat(128 * 1024 + 1)),
    async () => Response.json({ keys: [] }),
    async () => Response.json({ keys: [jwk, jwk] }),
    async () => Response.json({ keys: [{ ...jwk, alg: 'HS256' }] }),
    async () => Response.json({ keys: [{ ...jwk, use: 'enc' }] }),
    async () => Response.json({ keys: [{ ...jwk, key_ops: ['verify', 'sign'] }] }),
    async () => Response.json({ keys: [{ ...jwk, d: 'private-components-are-not-accepted' }] }),
    async () => Response.json({ keys: [{ ...jwk, n: 'AQAB' }] }),
  ]) await expectCode(verifier(fetcher).authenticate(headers(signed), config), 'jwks_unavailable', 503);
});

test('Access rechecks expiration after an awaited JWKS request and isolates owner identities across issuers', async () => {
  let clock = now;
  const slow = verifier(async () => { clock += 601_000; return validJwks(); }, () => clock);
  await expectCode(slow.authenticate(headers(await token()), config), 'invalid_token', 401);
  const verify = verifier(); const identity = await verify.authenticate(headers(await token()), config);
  const other = await verify.authenticate(headers(await token({ ...base, iss: 'https://other-team.cloudflareaccess.com' })), { ...config, teamDomain: 'other-team.cloudflareaccess.com' });
  assert.notEqual(identity.userId, other.userId);
});

test('Access limits cache to eight issuers and unknown key IDs do not trigger unbounded refreshes', async () => {
  let calls = 0; const verify = verifier(async () => { calls++; return validJwks(); });
  for (let index = 0; index < 9; index++) {
    const teamDomain = `synthetic-${index}.cloudflareaccess.com`;
    await verify.authenticate(headers(await token({ ...base, iss: `https://${teamDomain}` })), { ...config, teamDomain });
  }
  assert.equal(calls, 9);
  const teamDomain = 'synthetic-0.cloudflareaccess.com'; const claims = { ...base, iss: `https://${teamDomain}` };
  await verify.authenticate(headers(await token(claims)), { ...config, teamDomain }); assert.equal(calls, 10);
  for (let index = 0; index < 12; index++) await expectCode(verify.authenticate(headers(await token(claims, { kid: `missing-${index}` })), { ...config, teamDomain }), 'invalid_token', 401);
  assert.equal(calls, 10);
});

test('Access aborts a stalled key request at its configured deadline without exposing its error', async () => {
  let aborted = false; let deadline;
  const authentication = load({ setTimeout: (callback, duration) => { deadline = duration; return setTimeout(callback, 5); } });
  const verify = authentication.createCloudflareAccessVerifier({ now: () => now, fetcher: async (_url, init) => new Promise((_resolve, reject) => { init.signal.addEventListener('abort', () => { aborted = true; reject(Error('private transport error')); }); }) });
  await expectCode(verify.authenticate(headers(await token()), config), 'jwks_unavailable', 503);
  assert.equal(deadline, 5000); assert.equal(aborted, true);
});
