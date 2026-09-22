import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SITES_PROJECT_ID, LOCAL_DATABASE_ID, productionConfig, assertProductionArtifactConfig } from '../deployment/cloudflare-config.mjs';
import { checkCloudflareArtifact } from '../scripts/check-cloudflare-artifact.mjs';

const hosting = { project_id: SITES_PROJECT_ID, d1: 'DB', r2: 'FILES' };
// Synthetic identifiers for offline validation only; no Cloudflare resources exist.
const input = { SOURCEFLOW_WORKER_NAME: 'synthetic-sourceflow', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), SOURCEFLOW_D1_DATABASE_NAME: 'synthetic-database',
  SOURCEFLOW_D1_DATABASE_ID: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', SOURCEFLOW_R2_BUCKET_NAME: 'synthetic-bucket',
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'https://synthetic-team.cloudflareaccess.com', CLOUDFLARE_ACCESS_AUD: 'b'.repeat(64) };
const compiled = () => ({ ...productionConfig(input, hosting), main: 'index.js', no_bundle: true, assets: { directory: '../client' } });

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
