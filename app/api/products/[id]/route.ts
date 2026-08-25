import { getChatGPTUser } from '@/app/chatgpt-auth';
import { updateProduct } from '@/db/queries';
import { NextResponse } from 'next/server';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const ownerId = (await getChatGPTUser())?.userId ?? 'local-demo';
  const { id } = await context.params;
  const body = await request.json() as Record<string, string | number>;
  const product = await updateProduct(ownerId, id, body);
  return product ? NextResponse.json({ product }) : NextResponse.json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 });
}
