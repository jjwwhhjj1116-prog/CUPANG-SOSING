import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { ArchiveQueryError, parseArchiveQuery } from '@/app/product-archive';
import { listProductArchive } from '@/db/product-archive';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({ error: 'Cloudflare Access 로그인 또는 서버 인증 설정을 확인해주세요.' }, 503);
  try { return json(await listProductArchive(await getWorkspaceOwnerId(), await parseArchiveQuery(new URL(request.url).searchParams))); }
  catch (error) {
    if (error instanceof ArchiveQueryError) return json({ error: error.message }, 400);
    return json({ error: '상품 기록을 불러오지 못했습니다. 저장된 기록은 유지됩니다. 다시 조회해주세요.' }, 503);
  }
}
