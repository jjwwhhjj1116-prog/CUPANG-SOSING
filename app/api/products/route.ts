import { getChatGPTUser } from '@/app/chatgpt-auth';
import { insertProduct, listProducts, type ProductRecord } from '@/db/queries';
import { NextResponse } from 'next/server';

function roundPrice(value: number, unit = 100) { return Math.ceil(value / unit) * unit; }
function statuses(goal: string) {
  if (goal === 'transmit') return ['완료', '완료', '완료', '전송 가능'];
  if (goal === 'work') return ['완료', '완료', '완료', '검토 대기'];
  if (goal === 'price') return ['완료', '대기', '대기', '가격 완료'];
  return ['대기', '대기', '대기', '수집완료'];
}
async function ownerId() { return (await getChatGPTUser())?.userId ?? 'local-demo'; }

export async function GET() {
  try { return NextResponse.json({ products: await listProducts(await ownerId()) }); }
  catch (error) { return NextResponse.json({ products: [], warning: error instanceof Error ? error.message : 'storage unavailable' }); }
}

export async function POST(request: Request) {
  const body = await request.json() as Record<string, unknown>;
  const sourceUrl = String(body.sourceUrl ?? '').trim();
  if (!/^https:\/\/(?:detail\.)?1688\.com\//i.test(sourceUrl)) {
    return NextResponse.json({ error: '1688 상품 URL을 입력해주세요.' }, { status: 400 });
  }
  const sourcePriceCny = Math.max(Number(body.sourcePriceCny) || 1, 0.01);
  const exchangeRate = Math.max(Number(body.exchangeRate) || 190, 1);
  const supplyMargin = Math.min(Math.max(Number(body.supplyMargin) || 40, 1), 90);
  const coupangMargin = Math.min(Math.max(Number(body.coupangMargin) || 35, 1), 90);
  const minimumMargin = Math.max(Number(body.minimumMargin) || 3000, 0);
  const landedCost = sourcePriceCny * exchangeRate;
  const supplyPrice = roundPrice(Math.max(landedCost / (1 - supplyMargin / 100), landedCost + minimumMargin));
  const salePrice = roundPrice(supplyPrice / (1 - coupangMargin / 100));
  const goalStage = String(body.goalStage ?? 'price');
  const [seoStatus, imageStatus, quoteStatus, registrationStatus] = statuses(goalStage);
  const now = new Date().toISOString();
  const product: ProductRecord = {
    id: crypto.randomUUID(), owner_id: await ownerId(), source_url: sourceUrl,
    title: String(body.title ?? '').trim() || `1688 소싱 상품 ${now.slice(5, 10).replace('-', '')}`,
    source_price_cny: sourcePriceCny, exchange_rate: exchangeRate, supply_margin: supplyMargin,
    coupang_margin: coupangMargin, supply_price: supplyPrice, sale_price: salePrice,
    msrp: roundPrice(salePrice * 1.3), options_count: Math.max(Number(body.optionsCount) || 1, 1),
    seo_status: seoStatus, image_status: imageStatus, quote_status: quoteStatus,
    registration_status: registrationStatus, supplier_hub_status: '미전송', image_keys: '[]',
    goal_stage: goalStage, created_at: now, updated_at: now,
  };
  try { return NextResponse.json({ product: await insertProduct(product) }, { status: 201 }); }
  catch (error) { return NextResponse.json({ product, warning: error instanceof Error ? error.message : 'storage unavailable' }, { status: 201 }); }
}
