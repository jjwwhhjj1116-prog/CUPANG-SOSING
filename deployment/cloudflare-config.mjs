export const SITES_PROJECT_ID = 'appgprj_6a8d4a6c78908191acecd48b7e0d1620';
export const LOCAL_DATABASE_ID = '00000000-0000-4000-8000-000000000000';
export const COMPATIBILITY_DATE = '2026-05-15'; // Installed workerd / Cloudflare plugin baseline.
export const PRODUCTION_ENV_KEYS = ['SOURCEFLOW_WORKER_NAME', 'CLOUDFLARE_ACCOUNT_ID', 'SOURCEFLOW_D1_DATABASE_NAME', 'SOURCEFLOW_D1_DATABASE_ID', 'SOURCEFLOW_R2_BUCKET_NAME', 'CLOUDFLARE_ACCESS_TEAM_DOMAIN', 'CLOUDFLARE_ACCESS_AUD'];

export function assertSitesProject(hosting) {
  if (hosting?.project_id !== SITES_PROJECT_ID || hosting?.d1 !== 'DB' || hosting?.r2 !== 'FILES') throw new Error('기존 Sites project_id와 DB/FILES 바인딩을 보존해야 합니다.');
}
function required(environment, key, pattern) {
  const value = environment[key]?.trim();
  if (!value || !pattern.test(value)) throw new Error(`운영 설정 ${key} 값을 확인해주세요. 실제 계정의 확인된 식별자가 필요합니다.`);
  return value;
}

/** @returns {Partial<import('@cloudflare/vite-plugin').WorkerConfig>} */
export function productionConfig(environment, hosting) {
  assertSitesProject(hosting);
  const missing = PRODUCTION_ENV_KEYS.filter(key => !environment[key]?.trim());
  if (missing.length) throw new Error(`운영 빌드 설정 누락: ${missing.join(', ')}. 로컬 확인은 npm run build를 사용하세요.`);
  const name = required(environment, 'SOURCEFLOW_WORKER_NAME', /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/);
  const accountId = required(environment, 'CLOUDFLARE_ACCOUNT_ID', /^(?!0{32}$)[a-f0-9]{32}$/i);
  const databaseName = required(environment, 'SOURCEFLOW_D1_DATABASE_NAME', /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/);
  const databaseId = required(environment, 'SOURCEFLOW_D1_DATABASE_ID', /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
  if (databaseId === LOCAL_DATABASE_ID || databaseId === '00000000-0000-0000-0000-000000000000') throw new Error('로컬 placeholder D1 ID로 운영 빌드를 만들 수 없습니다.');
  const bucket = required(environment, 'SOURCEFLOW_R2_BUCKET_NAME', /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/);
  const team = required(environment, 'CLOUDFLARE_ACCESS_TEAM_DOMAIN', /^(?:https:\/\/)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com\/?$/);
  const audience = required(environment, 'CLOUDFLARE_ACCESS_AUD', /^[a-f0-9]{64}$/i);
  const domain = environment.SOURCEFLOW_CUSTOM_DOMAIN?.trim();
  if (domain && (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) || /(?:^|\.)workers\.dev$/.test(domain))) throw new Error('SOURCEFLOW_CUSTOM_DOMAIN은 직접 소유한 호스트 이름만 입력해주세요. workers.dev는 비워두면 사용됩니다.');
  return {
    name, account_id: accountId, main: 'vinext/server/app-router-entry',
    compatibility_date: COMPATIBILITY_DATE, compatibility_flags: ['nodejs_compat'],
    workers_dev: !domain, preview_urls: false,
    ...(domain ? { routes: [{ pattern: domain, custom_domain: true }] } : {}),
    d1_databases: [{ binding: 'DB', database_name: databaseName, database_id: databaseId, migrations_dir: 'db/migrations' }],
    r2_buckets: [{ binding: 'FILES', bucket_name: bucket }],
    vars: {
      NODE_ENV: 'production', SOURCEFLOW_DEPLOYMENT_MODE: 'production', SOURCEFLOW_SITES_PROJECT_ID: SITES_PROJECT_ID,
      CLOUDFLARE_ACCESS_TEAM_DOMAIN: team.replace(/\/$/, ''), CLOUDFLARE_ACCESS_AUD: audience,
    },
  };
}

export function assertProductionArtifactConfig(config, hosting) {
  assertSitesProject(hosting);
  const database = config.d1_databases?.find(value => value.binding === 'DB');
  const bucket = config.r2_buckets?.find(value => value.binding === 'FILES');
  if (config.vars?.SOURCEFLOW_DEPLOYMENT_MODE !== 'production' || config.vars?.SOURCEFLOW_SITES_PROJECT_ID !== SITES_PROJECT_ID || config.vars?.NODE_ENV !== 'production') throw new Error('배포할 수 없는 로컬 산출물입니다. 운영 설정으로 build-cloudflare.mjs를 실행해주세요.');
  if (config.d1_databases.length !== 1 || config.r2_buckets?.length !== 1 || database?.remote || bucket?.remote) throw new Error('운영 DB/FILES 바인딩이 예상 구성과 다릅니다.');
  const domain = config.routes?.[0]?.custom_domain ? config.routes[0].pattern : undefined;
  const expected = productionConfig({
    SOURCEFLOW_WORKER_NAME: config.name, CLOUDFLARE_ACCOUNT_ID: config.account_id,
    SOURCEFLOW_D1_DATABASE_NAME: database?.database_name, SOURCEFLOW_D1_DATABASE_ID: database?.database_id,
    SOURCEFLOW_R2_BUCKET_NAME: bucket?.bucket_name,
    CLOUDFLARE_ACCESS_TEAM_DOMAIN: config.vars.CLOUDFLARE_ACCESS_TEAM_DOMAIN, CLOUDFLARE_ACCESS_AUD: config.vars.CLOUDFLARE_ACCESS_AUD,
    SOURCEFLOW_CUSTOM_DOMAIN: domain,
  }, hosting);
  if (config.preview_urls !== false || config.workers_dev !== expected.workers_dev || JSON.stringify(config.routes ?? []) !== JSON.stringify(expected.routes ?? [])) throw new Error('공개 URL·미리보기 URL 설정이 검토된 운영 구성과 다릅니다.');
  if (!config.compatibility_flags?.includes('nodejs_compat') || config.compatibility_date !== COMPATIBILITY_DATE || config.no_bundle !== true) throw new Error('Worker 실행 호환성 또는 빌드 구성을 확인해주세요.');
  return expected;
}
