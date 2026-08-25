import { getChatGPTUser } from '@/app/chatgpt-auth';
import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const ownerId = (await getChatGPTUser())?.userId ?? 'local-demo';
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || !file.type.startsWith('image/')) return NextResponse.json({ error: '이미지 파일만 업로드할 수 있습니다.' }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: '이미지는 10MB 이하만 업로드할 수 있습니다.' }, { status: 413 });
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const key = `${ownerId}/${crypto.randomUUID()}-${safeName}`;
  await env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return NextResponse.json({ key, url: `/api/files/${encodeURIComponent(key)}` }, { status: 201 });
}
