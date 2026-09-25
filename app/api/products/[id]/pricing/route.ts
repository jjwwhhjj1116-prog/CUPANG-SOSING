import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct, applyProductPrice } from '@/db/queries';
import { pricePolicy, calculatePrice } from '@/app/pricing';
import { readProductOptions } from '@/db/product-options';
import { calculateOptionPrices } from '@/app/product-options';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return NextResponse.json({ error: '운영 인증 연결 후 가격 변경을 사용할 수 있습니다.' }, { status: 503 });
  let policy; let expectedVersion: string;
  try {
    const input: unknown = await request.json();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('가격 설정 객체가 필요합니다.');
    const body = input as Record<string, unknown>;
    policy = pricePolicy(body.policy);
    if (typeof body.expectedVersion !== 'string' || !Number.isFinite(Date.parse(body.expectedVersion))) throw new Error('상품을 다시 불러와주세요.');
    expectedVersion = body.expectedVersion;
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '입력을 확인해주세요.' }, { status: 400 }); }
  const owner = await getWorkspaceOwnerId();
  const { id } = await context.params;
  try {
    const product = await findProduct(owner, id);
    if (!product) return NextResponse.json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 });
    if (product.updated_at !== expectedVersion) return NextResponse.json({ error: '다른 변경이 저장되었습니다. 목록을 새로고침하고 다시 적용해주세요.' }, { status: 409 });
    const options = await readProductOptions(owner, id);
    if (options.productId !== id) throw new Error('Invalid option product');
    const invalidOptions = calculateOptionPrices(options.rows, policy).filter(row => row.included && (row.error || !row.calculation));
    if (invalidOptions.length) return NextResponse.json({
      error: `옵션 ${invalidOptions.length}개의 가격을 계산할 수 없어 저장하지 않았습니다. 옵션 원가·구성 수량 또는 가격 정책을 수정해주세요.`,
      code: 'INVALID_OPTION_PRICE',
      options: invalidOptions.map(row => ({ optionId: row.optionId, error: row.error || '옵션 가격 계산 실패' })),
    }, { status: 400 });
    let calculation;
    try { calculation = calculatePrice(product.source_price_cny, policy); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '가격 계산 실패' }, { status: 400 }); }
    const saved = await applyProductPrice(owner, id, expectedVersion, { ...policy, ...calculation }, policy);
    return saved ? NextResponse.json({ product: saved, calculation }) : NextResponse.json({ error: '동시에 변경된 상품입니다. 목록을 새로고침해주세요.' }, { status: 409 });
  } catch { return NextResponse.json({ error: '가격을 저장하지 못했습니다. 목록에서 저장 여부를 확인해주세요.' }, { status: 503 }); }
}
