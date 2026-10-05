import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import ts from 'typescript';
import { SITES_PROJECT_ID, LOCAL_DATABASE_ID, productionConfig, assertProductionArtifactConfig } from '../deployment/cloudflare-config.mjs';
import { checkCloudflareArtifact } from '../scripts/check-cloudflare-artifact.mjs';

const hosting = { project_id: SITES_PROJECT_ID, d1: 'DB', r2: 'FILES' };
// Synthetic identifiers for offline validation only; no Cloudflare resources exist.
const input = { SOURCEFLOW_WORKER_NAME: 'synthetic-sourceflow', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), SOURCEFLOW_D1_DATABASE_NAME: 'synthetic-database',
  SOURCEFLOW_D1_DATABASE_ID: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', SOURCEFLOW_R2_BUCKET_NAME: 'synthetic-bucket',
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'https://synthetic-team.cloudflareaccess.com', CLOUDFLARE_ACCESS_AUD: 'b'.repeat(64) };
const compiled = provider => ({ ...productionConfig({ ...input, ...(provider ? { SOURCEFLOW_TEXT_PROVIDER: provider } : {}) }, hosting), main: 'index.js', no_bundle: true, assets: { directory: '../client' } });

test('production config preserves project/bindings and only packages approved nonsecret variables', () => {
  const config = productionConfig({ ...input, CLOUDFLARE_API_TOKEN: 'must-never-be-in-artifact', OPENAI_API_KEY: 'also-not-packaged' }, hosting);
  assert.equal(config.d1_databases[0].binding, 'DB'); assert.equal(config.r2_buckets[0].binding, 'FILES');
  assert.equal(config.d1_databases[0].migrations_dir, 'db/migrations'); assert.equal(config.preview_urls, false); assert.equal(config.workers_dev, true);
  assert.equal(config.vars.SOURCEFLOW_SITES_PROJECT_ID, SITES_PROJECT_ID); assert.ok(!JSON.stringify(config).includes('must-never')); assert.ok(!JSON.stringify(config).includes('also-not'));
  assert.doesNotThrow(() => assertProductionArtifactConfig(compiled(), hosting));
  const custom = productionConfig({ ...input, SOURCEFLOW_CUSTOM_DOMAIN: 'sourceflow.example.com' }, hosting);
  assert.equal(custom.workers_dev, false); assert.deepEqual(custom.routes, [{ pattern: 'sourceflow.example.com', custom_domain: true }]);
});

test('missing settings, local placeholders, identity changes and invalid Access origins fail closed', () => {
  assert.throws(() => productionConfig({}, hosting), /설정 누락/);
  for (const change of [
    { CLOUDFLARE_ACCOUNT_ID: '0'.repeat(32) }, { SOURCEFLOW_D1_DATABASE_ID: LOCAL_DATABASE_ID },
    { SOURCEFLOW_D1_DATABASE_ID: 'not-a-uuid' }, { CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'https://example.com' },
    { CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'https://synthetic-team.cloudflareaccess.com/bypass' }, { CLOUDFLARE_ACCESS_AUD: '' },
    { SOURCEFLOW_CUSTOM_DOMAIN: 'https://sourceflow.example.com' }, { SOURCEFLOW_CUSTOM_DOMAIN: 'name.account.workers.dev' },
  ]) assert.throws(() => productionConfig({ ...input, ...change }, hosting));
  assert.throws(() => productionConfig(input, { ...hosting, project_id: 'new-project' }), /기존 Sites/);
  assert.throws(() => productionConfig(input, { ...hosting, d1: 'OTHER' }), /DB\/FILES/);
  for (const change of [{ vars: { ...compiled().vars, SOURCEFLOW_DEPLOYMENT_MODE: 'local-preview' } }, { preview_urls: true }, { workers_dev: false }, { routes: [{ pattern: '*/*' }] }, { no_bundle: false }]) assert.throws(() => assertProductionArtifactConfig({ ...compiled(), ...change }, hosting));
});

test('artifact check verifies compiled files, Sites ID and the exact packaged SQL, without network', () => {
  const prefix = path.resolve(os.tmpdir(), 'sourceflow-artifact-test-'); const fixture = fs.mkdtempSync(prefix);
  try {
    for (const directory of ['.openai', 'db/migrations', 'dist/.openai/migrations', 'dist/server', 'dist/client']) fs.mkdirSync(path.join(fixture, directory), { recursive: true });
    for (const file of ['.openai/hosting.json', 'dist/.openai/hosting.json']) fs.writeFileSync(path.join(fixture, file), JSON.stringify(hosting));
    const config = compiled(); config.d1_databases[0].migrations_dir = '../.openai/migrations';
    fs.writeFileSync(path.join(fixture, 'dist/server/wrangler.json'), JSON.stringify(config)); fs.writeFileSync(path.join(fixture, 'dist/server/index.js'), 'export default {};');
    for (const file of ['db/migrations/0001.sql', 'dist/.openai/migrations/0001.sql']) fs.writeFileSync(path.join(fixture, file), 'CREATE TABLE IF NOT EXISTS synthetic(id TEXT);');
    assert.equal(checkCloudflareArtifact(fixture).migrationCount, 1);
    fs.writeFileSync(path.join(fixture, 'dist/.openai/migrations/0001.sql'), 'different'); assert.throws(() => checkCloudflareArtifact(fixture), /migration differs/);
    fs.writeFileSync(path.join(fixture, 'dist/.openai/migrations/0001.sql'), fs.readFileSync(path.join(fixture, 'db/migrations/0001.sql')));
    fs.writeFileSync(path.join(fixture, 'dist/server/.dev.vars'), 'synthetic local setting'); assert.throws(() => checkCloudflareArtifact(fixture), /\.dev.vars/);
  } finally {
    assert.ok(path.resolve(fixture).startsWith(prefix) && path.dirname(path.resolve(fixture)) === path.resolve(os.tmpdir()));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('Workers AI deployment is opt-in and binds only the validated model', () => {
  assert.equal(productionConfig(input, hosting).ai, undefined);
  const config = { ...productionConfig({ ...input, SOURCEFLOW_TEXT_PROVIDER: 'workers-ai' }, hosting), no_bundle: true };
  assert.deepEqual(config.ai, { binding: 'AI' });
  assert.equal(config.vars.SOURCEFLOW_TEXT_PROVIDER, 'workers-ai');
  assert.equal(config.vars.SOURCEFLOW_TEXT_MODEL, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  assert.equal(config.vars.SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS, '4096');
  assert.doesNotThrow(() => assertProductionArtifactConfig(config, hosting));
  assert.throws(() => assertProductionArtifactConfig({ ...config, ai: { binding: 'OTHER' } }, hosting));
  assert.throws(() => assertProductionArtifactConfig({ ...config, vars: { ...config.vars, SOURCEFLOW_TEXT_MODEL: 'different' } }, hosting));
  assert.throws(() => assertProductionArtifactConfig({ ...config, vars: { ...config.vars, SOURCEFLOW_TEXT_MODEL: '@cf/meta/llama-3.1-8b-instruct' } }, hosting));
});

test('Google deployment packages the keyless fixed model and zero tokens without retaining AI binding or secrets', () => {
  const config = productionConfig({ ...input, SOURCEFLOW_TEXT_PROVIDER: 'google-free',
    SOURCEFLOW_TEXT_MODEL: '@cf/meta/llama-3.1-8b-instruct', SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS: '4096',
    OPENAI_API_KEY: 'synthetic-secret-must-not-package', GOOGLE_API_KEY: 'synthetic-google-key-not-needed' }, hosting);
  assert.equal(config.vars.SOURCEFLOW_TEXT_PROVIDER, 'google-free');
  assert.equal(config.vars.SOURCEFLOW_TEXT_MODEL, 'google-translate-gtx');
  assert.equal(config.vars.SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS, '0');
  assert.equal(Object.hasOwn(config, 'ai'), false);
  assert.ok(!JSON.stringify(config).includes('synthetic-secret')); assert.ok(!JSON.stringify(config).includes('synthetic-google'));
  assert.doesNotThrow(() => assertProductionArtifactConfig({ ...config, no_bundle: true }, hosting));
});

test('packaged Google artifact rejects leftover Workers binding, model or token configuration before deployment', () => {
  const prefix = path.resolve(os.tmpdir(), 'sourceflow-google-artifact-test-'), fixture = fs.mkdtempSync(prefix);
  try {
    for (const directory of ['.openai', 'db/migrations', 'dist/.openai/migrations', 'dist/server', 'dist/client']) fs.mkdirSync(path.join(fixture, directory), { recursive: true });
    for (const file of ['.openai/hosting.json', 'dist/.openai/hosting.json']) fs.writeFileSync(path.join(fixture, file), JSON.stringify(hosting));
    for (const file of ['db/migrations/0001.sql', 'dist/.openai/migrations/0001.sql']) fs.writeFileSync(path.join(fixture, file), 'CREATE TABLE IF NOT EXISTS synthetic(id TEXT);');
    fs.writeFileSync(path.join(fixture, 'dist/server/index.js'), 'export default {};');
    const config = compiled('google-free'); config.d1_databases[0].migrations_dir = '../.openai/migrations';
    const write = value => fs.writeFileSync(path.join(fixture, 'dist/server/wrangler.json'), JSON.stringify(value));
    write(config); assert.equal(checkCloudflareArtifact(fixture).migrationCount, 1);
    for (const changed of [
      { ...config, ai: { binding: 'AI' } },
      ...[{ SOURCEFLOW_TEXT_MODEL: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }, { SOURCEFLOW_TEXT_MODEL: '@cf/meta/llama-3.1-8b-instruct' },
        { SOURCEFLOW_TEXT_MODEL: undefined }, { SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS: '4096' }, { SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS: undefined },
        { SOURCEFLOW_TEXT_PROVIDER: 'workers-ai' }].map(patch => ({ ...config, vars: { ...config.vars, ...patch } })),
    ]) { write(changed); assert.throws(() => checkCloudflareArtifact(fixture), /(?:Google 번역|Workers AI).*운영 구성/); }
    write(config); assert.equal(checkCloudflareArtifact(fixture).migrationCount, 1);
  } finally {
    assert.ok(path.resolve(fixture).startsWith(prefix) && path.dirname(path.resolve(fixture)) === path.resolve(os.tmpdir()));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('authenticated runtime GET distinguishes unconfigured translation from explicitly selected keyless Google without invoking providers or changing historical results', async () => {
  const env = {}, modules = new Map(), history = [{ id: 'historical', status: 'completed', result: { model: 'old-model', draft: { title: '기존 저장 초안' } } }];
  const before = JSON.stringify(history); let reads = 0;
  const forbidden = () => { throw Error('Status read must not write or contact a provider'); };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, Response, process: { env: { NODE_ENV: 'production' } }, fetch: forbidden, require(name) {
      if (name === 'cloudflare:workers') return { env };
      if (name === 'next/server') return { NextResponse: Response };
      if (name === '@/app/chatgpt-auth') return { getChatGPTUser: async () => ({ verifiedAccess: true }), getWorkspaceOwnerId: async () => 'owner' };
      if (name === '@/db/queries') return { findProduct: async (owner, id) => { assert.equal(owner, 'owner'); assert.equal(id, 'product'); return { id }; } };
      if (name === '@/db/translation-jobs') return new Proxy({ listTranslationJobs: async (owner, id) => { assert.equal(owner, 'owner'); assert.equal(id, 'product'); reads++; return history; } }, { get: (target, key) => target[key] ?? forbidden });
      if (name === '@/db/product-content') return { readProductContent: forbidden };
      if (name === '@/app/automation/model') return { fingerprint: forbidden };
      if (name === '@/app/request-body') return { readBoundedJson: forbidden, RequestBodyError: Error };
      if (name.startsWith('@/app/')) return load(name.slice(2) + '.ts');
      throw Error(name);
    } }); return exports;
  }
  const route = load('app/api/products/[id]/translation/route.ts'), model = load('app/automation/translation.ts');
  const get = async () => { const response = await route.GET(new Request('https://app.test/api/products/product/translation'), { params: Promise.resolve({ id: 'product' }) }); assert.equal(response.status, 200); return response.json(); };
  const missing = await get(); assert.equal(missing.configuration.configured, false); assert.equal(missing.configuration.issues.length, 3);
  env.SOURCEFLOW_TEXT_PROVIDER = 'google-free';
  const google = await get(); assert.deepEqual(google.configuration, { configured: true, model: 'google-translate-gtx', maxOutputTokens: 0, issues: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(model.requireTranslationConfig(env))), { apiKey: '', model: 'google-translate-gtx', maxOutputTokens: 0, provider: 'google-free' });
  assert.deepEqual(google.jobs, missing.jobs); assert.equal(JSON.stringify(history), before); assert.equal(reads, 2);
  assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.AI, undefined);
});
