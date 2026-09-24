import { getChatGPTUser } from '@/app/chatgpt-auth';
import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { translationConfiguration, type TranslationSecrets } from '@/app/automation/translation';
import { imageConfiguration, type ImageSecrets } from '@/app/automation/image-edit';
import { inspectDatabaseTables } from '@/app/database-readiness';

export async function GET() {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return NextResponse.json({error:'Cloudflare Access 로그인 또는 서버 인증 설정을 확인해주세요.'},{status:503});
  let database = 'unavailable';
  let databaseSchema: {status: string; missingTables: string[]} = {status: 'unavailable', missingTables: []};
  try {
    if (env.DB) {
      const result = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
      if (result?.ok === 1) database = 'query_ok';
      if (database === 'query_ok') databaseSchema = await inspectDatabaseTables(env.DB);
    }
  } catch { /* Report unavailable without exposing binding/account details. */ }
  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    runtime: 'cloudflare-workers',
    database,
    databaseSchema,
    files: env.FILES ? 'binding_present' : 'unavailable',
    authentication: process.env.NODE_ENV === 'production' ? 'cloudflare_access' : 'local_development',
    translation: { ...translationConfiguration(env as TranslationSecrets), executionVerified: false },
    imageProcessing: { ...imageConfiguration(env as ImageSecrets), executionVerified: false },
    collection: { configured: false, status: 'awaiting_connector' },
    extension: 'unverified', supplierHub: 'unverified', cli: 'unverified',
    submissionEnabled: false,
  }, { headers: { 'cache-control': 'no-store' } });
}
