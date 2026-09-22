import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertProductionArtifactConfig } from '../deployment/cloudflare-config.mjs';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function contained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Artifact file escaped its build directory.');
}
export function checkCloudflareArtifact(root = repositoryRoot) {
  const output = path.join(root, 'dist'); const server = path.join(output, 'server');
  const hosting = readJson(path.join(root, '.openai/hosting.json'));
  assert.deepEqual(readJson(path.join(output, '.openai/hosting.json')), hosting, 'Sites project metadata changed during the build.');
  const config = readJson(path.join(server, 'wrangler.json'));
  assertProductionArtifactConfig(config, hosting);
  const main = path.resolve(server, config.main ?? ''); contained(server, main);
  assert.ok(fs.statSync(main).isFile(), 'Compiled Worker entry is missing.');
  const assets = path.resolve(server, config.assets?.directory ?? ''); contained(output, assets);
  assert.ok(fs.statSync(assets).isDirectory(), 'Client assets are missing.');
  const migrationDirectory = path.resolve(server, config.d1_databases[0].migrations_dir ?? ''); contained(output, migrationDirectory);
  const original = path.join(root, 'db/migrations');
  const files = fs.readdirSync(original).filter(name => name.endsWith('.sql')).sort();
  assert.ok(files.length, 'D1 migration files are missing.');
  assert.deepEqual(fs.readdirSync(migrationDirectory).filter(name => name.endsWith('.sql')).sort(), files, 'Packaged migration files differ.');
  for (const file of files) assert.ok(fs.readFileSync(path.join(original, file)).equals(fs.readFileSync(path.join(migrationDirectory, file))), `Packaged migration differs: ${file}`);
  assert.ok(!fs.existsSync(path.join(server, '.dev.vars')), 'Local .dev.vars must not be packaged for production.');
  return { name: config.name, accountId: config.account_id, databaseId: config.d1_databases[0].database_id, migrationCount: files.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node scripts/check-cloudflare-artifact.mjs');
    const result = checkCloudflareArtifact();
    console.log(`Production artifact ready for review: ${result.name}; ${result.migrationCount} migration(s), original Sites project, D1/R2 and Access configured. No resource creation, authentication or deployment performed.`);
  } catch (error) { console.error(error instanceof Error ? error.message : 'Artifact check failed.'); process.exitCode = 1; }
}
