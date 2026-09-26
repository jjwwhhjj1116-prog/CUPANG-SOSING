import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, dependencies = {}, mode = 'production') {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(output, { exports, crypto, TextEncoder, TextDecoder, URL, Response, atob, btoa, AbortController, setTimeout, clearTimeout, process: { env: { NODE_ENV: mode } }, require: name => {
    if (name in dependencies) return dependencies[name];
    if (name === 'cloudflare:workers') return {env:{}};
    if (name === '@/db/workspace-banners') return load('db/workspace-banners.ts', dependencies, mode);
    if (name === '@/db/product-content') return {readRegistrationSummaries: async()=>({})};
    if (name === 'next/server') return { NextResponse: Response };
    if (name === 'next/navigation') return { redirect: () => { throw Error('Redirect not expected'); } };
    if (name === '@/app/workspace-settings') return load('app/workspace-settings.ts', {}, mode);
    if (name === '@/app/workflow') return load('app/workflow.ts', {}, mode);
    if (name === '@/app/pricing') return load('app/pricing.ts', {}, mode);
    if (name.startsWith('@/app/')) return load(`${name.slice(2)}.ts`, dependencies, mode);
    throw Error(`Unexpected dependency ${name}`);
  } });
  return exports;
}
const clock = 2_000_000_000_000;
const env = { CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'synthetic-app.cloudflareaccess.com', CLOUDFLARE_ACCESS_AUD: 'synthetic-app-audience' };
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'integration-key', alg: 'RS256', use: 'sig' };
async function signedHeaders(sub = 'synthetic-user', email = 'user@example.invalid') {
  const claims = { sub, email, iss: `https://${env.CLOUDFLARE_ACCESS_TEAM_DOMAIN}`, aud: [env.CLOUDFLARE_ACCESS_AUD], type: 'app', iat: clock / 1000 - 10, nbf: clock / 1000 - 10, exp: clock / 1000 + 600 };
  const data = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(data));
  return new Headers({ 'cf-access-jwt-assertion': `${data}.${Buffer.from(signature).toString('base64url')}`, 'oai-authenticated-user-id': 'forged-owner', 'oai-authenticated-user-email': 'forged@example.invalid' });
}
function runtime(sequence, environment = env, mode = 'production') {
  const access = load('app/cloudflare-access.ts');
  const verifier = access.createCloudflareAccessVerifier({ now: () => clock, fetcher: async () => Response.json({ keys: [jwk] }) });
  let read = 0;
  const auth = load('app/chatgpt-auth.ts', { 'cloudflare:workers': { env: environment }, 'next/headers': { headers: async () => sequence[Math.min(read++, sequence.length - 1)] }, '@/app/cloudflare-access': { ...access, authenticateCloudflareAccess: verifier.authenticate } }, mode);
  return { auth, mode };
}
function route(file, context, queries) { return load(file, { '@/app/chatgpt-auth': context.auth, '@/db/queries': queries }, context.mode); }

test('production identity ignores forged OpenAI/email headers and remains closed with missing Access configuration', async () => {
  const forged = new Headers({ 'oai-authenticated-user-id': 'arbitrary', 'oai-authenticated-user-email': 'attacker@example.invalid', 'cf-access-authenticated-user-email': 'attacker@example.invalid', verifiedAccess: 'true' });
  assert.equal(await runtime([forged]).auth.getChatGPTUser(), null);
  assert.equal(await runtime([await signedHeaders()], {}).auth.getChatGPTUser(), null);
  const identity = await runtime([await signedHeaders()]).auth.getChatGPTUser();
  assert.equal(identity.verifiedAccess, true); assert.match(identity.userId, /^cf:[a-f0-9]{64}$/); assert.equal(identity.email, 'user@example.invalid'); assert.notEqual(identity.userId, 'forged-owner');
});

test('production settings and products reject unverified requests before any database access', async () => {
  const context = runtime([new Headers()]); let touched = false;
  const queries = { getSettings: async () => { touched = true; }, saveSettings: async () => { touched = true; }, listProducts: async () => { touched = true; }, insertProduct: async () => { touched = true; } };
  const settings = route('app/api/settings/route.ts', context, queries);
  const products = route('app/api/products/route.ts', context, queries);
  assert.equal((await settings.GET()).status, 503);
  assert.equal((await settings.PUT(new Request('http://localhost', { method: 'PUT', body: '{}' }))).status, 503);
  assert.equal((await products.GET()).status, 503);
  assert.equal((await products.POST(new Request('http://localhost', { method: 'POST', body: '{}' }))).status, 503);
  assert.equal(touched, false);
});

test('verified production API calls use isolated JWT-derived owners and preserve local-demo as a separate development space', async () => {
  const signed = await signedHeaders(); const context = runtime([signed]); const calls = [];
  const queries = { getSettings: async owner => { calls.push(owner); return { payload: '{}' }; }, listProducts: async owner => { calls.push(owner); return []; } };
  assert.equal((await route('app/api/settings/route.ts', context, queries).GET()).status, 200);
  assert.equal((await route('app/api/products/route.ts', context, queries).GET()).status, 200);
  assert.ok(calls.every(owner => /^cf:[a-f0-9]{64}$/.test(owner))); assert.equal(new Set(calls).size, 1);
  const previous = calls[0]; const other = runtime([await signedHeaders('another-user', 'another@example.invalid')]);
  assert.equal((await route('app/api/settings/route.ts', other, queries).GET()).status, 200); assert.notEqual(calls.at(-1), previous);
  const development = runtime([new Headers()], {}, 'development');
  assert.equal((await route('app/api/settings/route.ts', development, queries).GET()).status, 200); assert.equal(calls.at(-1), 'local-demo');
});

test('an authentication change between gate and owner resolution cannot fall back to local-demo in production', async () => {
  const owners = []; const context = runtime([await signedHeaders(), new Headers()]);
  const settings = route('app/api/settings/route.ts', context, { getSettings: async owner => { owners.push(owner); return null; } });
  const response = await settings.GET();
  assert.ok(response.status === 503 || response.status === 200);
  assert.ok(!owners.includes('local-demo'), 'Production must reuse its verified identity or reject, never fall back to local-demo.');
  assert.ok(owners.every(owner => /^cf:[a-f0-9]{64}$/.test(owner)));
});

test('production page does not render the working dashboard for an unverified identity', async () => {
  const dashboard = () => null;
  const jsx = (type, props) => ({ type, props });
  const context = runtime([new Headers()]);
  const page = load('app/page.tsx', { './chatgpt-auth': context.auth, './components/dashboard-client': { __esModule: true, default: dashboard }, 'react/jsx-runtime': { jsx, jsxs: jsx } });
  const result = await page.default(); assert.notEqual(result.type, dashboard); assert.equal(result.type, 'main');
});

test('production image/file routes and generic product PATCH reject unauthenticated requests before storage', async () => {
  const context = runtime([new Headers()]); let touched = false;
  const dependencies = { '@/app/chatgpt-auth': context.auth, 'cloudflare:workers': { env: { FILES: { get: async () => { touched = true; }, put: async () => { touched = true; } } } }, '@/db/queries': { findProduct: async () => { touched = true; }, updateProduct: async () => { touched = true; } } };
  const upload = load('app/api/files/route.ts', dependencies);
  const file = load('app/api/files/[...key]/route.ts', dependencies);
  const product = load('app/api/products/[id]/route.ts', dependencies);
  assert.equal((await upload.POST(new Request('http://localhost', { method: 'POST' }))).status, 503);
  assert.equal((await file.GET(new Request('http://localhost'), { params: Promise.resolve({ key: ['local-demo', 'test.png'] }) })).status, 503);
  const params = { params: Promise.resolve({ id: 'synthetic' }) };
  assert.equal((await product.GET(new Request('http://localhost'), params)).status, 503);
  assert.equal((await product.PATCH(new Request('http://localhost', { method: 'PATCH', body: '{"title":"test"}' }), params)).status, 503);
  assert.equal(touched, false);
});

test('production login reports a safe authentication reason while keeping access closed', async () => {
  let diagnostic;
  const auth = runtime([new Headers()]).auth;
  assert.equal(await auth.getChatGPTUser(error => {diagnostic = error;}), null);
  assert.equal(diagnostic.code, 'missing_token');
  assert.ok(!diagnostic.message.includes('cf-access-jwt-assertion'));
});
