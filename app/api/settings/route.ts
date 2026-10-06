import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { getSettings, saveSettings } from '@/db/queries';
import { NextResponse } from 'next/server';
import { verifyWorkspaceBannerFiles } from '@/db/workspace-banners';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { savedRegistrationSettings, validateSettings, type WorkspaceSettings } from '@/app/workspace-settings';
import { env } from 'cloudflare:workers';
import { matchesWorkspaceAccount, workspaceAccount } from '@/app/workspace-members';
import { parseWorkspaceSettingsScope, type WorkspaceSettingsScope } from '@/app/workspace-settings-scope';

const AUTH_ERROR = 'Cloudflare Access 로그인 또는 서버 인증 설정을 확인해주세요.';
const SCOPE_ERROR = '로그인 계정이 변경되었습니다. 기본 설정을 다시 열고 저장해주세요.';
class SettingsScopeError extends Error {
  constructor(readonly status: 409 | 503, message: string) { super(message); }
}

async function currentSettingsScope(): Promise<WorkspaceSettingsScope> {
  // Older isolated development fixtures supply only the ownership resolver.
  // Real requests always resolve their user once and reuse that verified id.
  if (process.env.NODE_ENV !== 'production' && typeof getChatGPTUser !== 'function') {
    const scope = parseWorkspaceSettingsScope({ ownerId: await getWorkspaceOwnerId(), company: null });
    if (!scope) throw new SettingsScopeError(503, AUTH_ERROR);
    return scope;
  }
  const user = await getChatGPTUser();
  const nativeAuthentication = (env as { YOOFAM_AUTH_ENABLED?: string }).YOOFAM_AUTH_ENABLED === 'true';
  if ((process.env.NODE_ENV === 'production' || nativeAuthentication) && !user?.verifiedAccess) throw new SettingsScopeError(503, AUTH_ERROR);
  let company: WorkspaceSettingsScope['company'] = null;
  if (nativeAuthentication || user?.membership) {
    const member = user?.membership;
    if (!user?.verifiedAccess || !member || member.status !== 'approved' || member.id !== user.userId || member.email !== user.email || !matchesWorkspaceAccount(member)) throw new SettingsScopeError(503, AUTH_ERROR);
    const account = workspaceAccount(member.email)!;
    company = { code: account.companyCode, name: account.companyName };
  }
  const scope = parseWorkspaceSettingsScope({ ownerId: user?.userId ?? 'local-demo', company });
  if (!scope) throw new SettingsScopeError(503, AUTH_ERROR);
  return scope;
}

export async function GET() {
  try {
    const scope = await currentSettingsScope();
    const result = await getSettings(scope.ownerId);
    return NextResponse.json({ settings: result ? savedRegistrationSettings(JSON.parse(result.payload)) : null, scope }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return NextResponse.json({ error: error instanceof SettingsScopeError ? error.message : '기본 설정을 읽지 못했습니다.' }, { status: 503 }); }
}
export async function PUT(request: Request) {
  let scope: WorkspaceSettingsScope;
  try { scope = await currentSettingsScope(); }
  catch { return NextResponse.json({ error: AUTH_ERROR }, { status: 503 }); }
  let settings: WorkspaceSettings;
  try {
    const input = await readBoundedJson(request, 32 * 1024);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RequestBodyError(400, '설정 객체가 필요합니다.');
    const suppliedOwner = Object.hasOwn(input, 'expectedOwnerId');
    const expectedOwner = (input as Record<string, unknown>).expectedOwnerId;
    if (suppliedOwner && !parseWorkspaceSettingsScope({ ownerId: expectedOwner, company: null })) throw new RequestBodyError(400, '올바른 기본 설정 계정 정보가 필요합니다.');
    if ((suppliedOwner && expectedOwner !== scope.ownerId) || (scope.company && !suppliedOwner)) throw new SettingsScopeError(409, SCOPE_ERROR);
    validateSettings(input);
    settings = savedRegistrationSettings(input);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '올바른 설정 객체가 필요합니다.' }, { status: error instanceof RequestBodyError || error instanceof SettingsScopeError ? error.status : 400 }); }
  try {
    await verifyWorkspaceBannerFiles(scope.ownerId, settings);
    await saveSettings(scope.ownerId, JSON.stringify(settings));
    return NextResponse.json({ settings, scope }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return NextResponse.json({ error: error instanceof RequestBodyError ? error.message : '기본 설정을 저장하지 못했습니다.' }, { status: error instanceof RequestBodyError ? error.status : 503 }); }
}
