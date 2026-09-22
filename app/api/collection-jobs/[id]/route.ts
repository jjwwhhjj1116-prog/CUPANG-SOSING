import { NextResponse } from 'next/server';
import { cancelCollection } from '@/db/collection-jobs';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return NextResponse.json({ error: '운영 인증을 먼저 연결해주세요.' }, { status: 503 });
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/.test(id)) return NextResponse.json({ error: '요청 번호를 확인해주세요.' }, { status: 400 });
  try {
    const owner=await getWorkspaceOwnerId();
    const job = await cancelCollection(owner, id);
    return job ? NextResponse.json({ job }) : NextResponse.json({ error: '해당 수집 요청을 찾지 못했습니다.' }, { status: 404 });
  } catch { return NextResponse.json({ error: '취소 결과를 확인하지 못했습니다. 대기열을 새로고침해주세요.' }, { status: 503 }); }
}
