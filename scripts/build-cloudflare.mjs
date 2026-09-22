import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { productionConfig, assertProductionArtifactConfig } from '../deployment/cloudflare-config.mjs';
import { checkCloudflareArtifact, repositoryRoot } from './check-cloudflare-artifact.mjs';

// This command only builds local files. It never logs in, provisions resources,
// applies migrations, deploys, or copies API tokens/secrets into Worker vars.
try {
  if (process.argv.length !== 2) throw new Error('Usage: node --env-file=.env.production.local scripts/build-cloudflare.mjs');
  const hosting = JSON.parse(fs.readFileSync(path.join(repositoryRoot, '.openai/hosting.json'), 'utf8'));
  productionConfig(process.env, hosting); // Fail before replacing dist when required settings are missing.
  const build = spawnSync(process.execPath, [path.join(repositoryRoot, 'node_modules/vinext/dist/cli.js'), 'build'], {
    cwd: repositoryRoot, stdio: 'inherit', env: { ...process.env, SOURCEFLOW_DEPLOY_TARGET: 'cloudflare' },
  });
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error(`운영 빌드 실패 (exit ${build.status ?? build.signal}). 기존 산출물을 배포하지 마세요.`);
  const configPath = path.join(repositoryRoot, 'dist/server/wrangler.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assertProductionArtifactConfig(config, hosting);
  const source = path.join(repositoryRoot, 'db/migrations');
  const target = path.join(repositoryRoot, 'dist/.openai/migrations');
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(source).filter(name => name.endsWith('.sql'))) fs.copyFileSync(path.join(source, name), path.join(target, name));
  // Cloudflare's output config preserves the input relative path. Package the
  // exact SQL with the build and make it relative to dist/server/wrangler.json.
  config.d1_databases[0].migrations_dir = '../.openai/migrations';
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  const verified = checkCloudflareArtifact();
  console.log(`운영 빌드 검사 통과: ${verified.name}. 배포는 실행하지 않았습니다. 검토 대상: dist/server/wrangler.json`);
} catch (error) { console.error(error instanceof Error ? error.message : 'Production build failed.'); process.exitCode = 1; }
