import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { getSettings, saveSettings } from '@/db/queries';
import { NextResponse } from 'next/server';
import { verifyWorkspaceBannerFiles } from '@/db/workspace-banners';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { savedRegistrationSettings, validateSettings, type WorkspaceSettings } from '@/app/workspace-settings';

async function ownerId() { return await getWorkspaceOwnerId(); }
export async function GET() {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return NextResponse.json({error:'Cloudflare Access 로그인 또는 서버 인증 설정을 확인해주세요.'},{status:503});
  try { const result = await getSettings(await ownerId()); return NextResponse.json({ settings: result ? savedRegistrationSettings(JSON.parse(result.payload)) : null }, { headers: { 'cache-control': 'no-store' } }); }
  catch { return NextResponse.json({ error: '기본 설정을 읽지 못했습니다.' }, { status: 503 }); }
}
export async function PUT(request: Request) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return NextResponse.json({error:'Cloudflare Access 로그인 또는 서버 인증 설정을 확인해주세요.'},{status:503});
  let settings: WorkspaceSettings;
  try {
    const input = await readBoundedJson(request, 32 * 1024);
    validateSettings(input);
    settings = savedRegistrationSettings(input);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '올바른 설정 객체가 필요합니다.' }, { status: error instanceof RequestBodyError ? error.status : 400 }); }
  try {
    const owner = await ownerId();
    await verifyWorkspaceBannerFiles(owner, settings);
    await saveSettings(owner, JSON.stringify(settings));
    return NextResponse.json({ settings });
  } catch (error) { return NextResponse.json({ error: error instanceof RequestBodyError ? error.message : '기본 설정을 저장하지 못했습니다.' }, { status: error instanceof RequestBodyError ? error.status : 503 }); }
}
