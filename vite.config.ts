import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import hostingConfig from './.openai/hosting.json';
import { COMPATIBILITY_DATE, LOCAL_DATABASE_ID, SITES_PROJECT_ID, assertSitesProject, productionConfig } from './deployment/cloudflare-config.mjs';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/app-router-entry',
  compatibility_date: COMPATIBILITY_DATE,
  compatibility_flags: ['nodejs_compat'],
  workers_dev: false,
  preview_urls: false,
  vars: { SOURCEFLOW_DEPLOYMENT_MODE: 'local-preview', SOURCEFLOW_SITES_PROJECT_ID: SITES_PROJECT_ID },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: LOCAL_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async ({ command }) => {
  assertSitesProject(hostingConfig);
  const deploy = process.env.SOURCEFLOW_DEPLOY_TARGET === 'cloudflare';
  if (deploy && command !== 'build') throw new Error('운영 바인딩은 빌드에서만 사용합니다. 로컬 개발에서는 SOURCEFLOW_DEPLOY_TARGET을 해제해주세요.');
  if (process.env.SOURCEFLOW_DEPLOY_TARGET && !deploy) throw new Error('지원하지 않는 SOURCEFLOW_DEPLOY_TARGET입니다.');
  const bindingConfig = deploy ? productionConfig(process.env, hostingConfig) : localBindingConfig;
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: bindingConfig,
        // Never attach local dev/build to remote resources implicitly.
        remoteBindings: false,
      }),
    ],
  };
});
