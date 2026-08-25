import { getChatGPTUser } from '@/app/chatgpt-auth';
import { updateProduct } from '@/db/queries';
import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  const ownerId = user?.userId ?? 'local-demo';
  const body = await request.json() as { productIds?: string[]; confirmed?: boolean };
  if (!body.confirmed || !body.productIds?.length) return NextResponse.json({ error: '전송 대상을 확인해주세요.' }, { status: 400 });
  if (!env.SUPPLIER_HUB_ENDPOINT || !env.SUPPLIER_HUB_API_KEY) {
    return NextResponse.json({ mode: 'preview', message: 'Supplier Hub 공식 연동 정보가 아직 설정되지 않아 전송 준비 상태로 저장했습니다.' }, { status: 202 });
  }
  const response = await fetch(env.SUPPLIER_HUB_ENDPOINT, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.SUPPLIER_HUB_API_KEY}` },
    body: JSON.stringify({ productIds: body.productIds, sender: user?.email ?? 'local-demo' }),
  });
  if (!response.ok) return NextResponse.json({ error: 'Supplier Hub 전송이 완료되지 않았습니다.' }, { status: 502 });
  await Promise.all(body.productIds.map((id) => updateProduct(ownerId, id, { supplier_hub_status: '전송완료', registration_status: '전송완료' })));
  return NextResponse.json({ mode: 'live', message: 'Supplier Hub로 전송했습니다.' });
}
