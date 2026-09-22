import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { insertProduct, listProducts, type ProductRecord } from '@/db/queries';
import { NextResponse } from 'next/server';
import { initialStatuses, is1688ProductUrl } from '@/app/workflow';

function roundPrice(value: number, unit = 100) { return Math.ceil(value / unit) * unit; }
async function ownerId() { return await getWorkspaceOwnerId(); }

export async function GET() {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return NextResponse.json({error:'Cloudflare Access 로그인 또는 서버 인증 설정을 확인해주세요.'},{status:503});
  try { return NextResponse.json({ products: await listProducts(await ownerId()) }); }
  catch { return NextResponse.json({ error: '상품 목록을 읽지 못했습니다. 다시 시도해주세요.' }, { status: 503 }); }
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return NextResponse.json({error:'Cloudflare Access 로그인 또는 서버 인증 설정을 확인해주세요.'},{status:503});
  let body: Record<string, unknown>;
  try {
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    body = value as Record<string, unknown>;
  } catch { return NextResponse.json({ error: '올바른 JSON 객체가 필요합니다.' }, { status: 400 }); }
  const sourceUrl = String(body.sourceUrl ?? '').trim();
  if (!is1688ProductUrl(sourceUrl)) {
    return NextResponse.json({ error: '1688 상품 URL을 입력해주세요.' }, { status: 400 });
  }
  const sourcePriceCny = Number(body.sourcePriceCny);
  if (!Number.isFinite(sourcePriceCny) || sourcePriceCny <= 0) return NextResponse.json({ error: '확인한 상품 원가를 입력해주세요.' }, { status: 400 });
  const exchangeRate = Number(body.exchangeRate ?? 190);
  const supplyMargin = Number(body.supplyMargin ?? 40);
  const coupangMargin = Number(body.coupangMargin ?? 35);
  const minimumMargin = Number(body.minimumMargin ?? 3000);
  const msrpMultiple = Number(body.msrpMultiple ?? 1.3);
  const optionsCount = Number(body.optionsCount ?? 1);
  if (![exchangeRate, supplyMargin, coupangMargin, minimumMargin, msrpMultiple, optionsCount].every(Number.isFinite)
    || exchangeRate <= 0 || supplyMargin < 0 || supplyMargin >= 100 || coupangMargin < 0 || coupangMargin >= 100
    || minimumMargin < 0 || msrpMultiple <= 0 || !Number.isInteger(optionsCount) || optionsCount < 1) {
    return NextResponse.json({ error: '환율·마진·시장가격 배수·옵션 수를 확인해주세요.' }, { status: 400 });
  }
  const landedCost = sourcePriceCny * exchangeRate;
  const supplyPrice = roundPrice(Math.max(landedCost / (1 - supplyMargin / 100), landedCost + minimumMargin));
  const salePrice = roundPrice(supplyPrice / (1 - coupangMargin / 100));
  const msrp = roundPrice(salePrice * msrpMultiple);
  if (![supplyPrice, salePrice, msrp].every(Number.isSafeInteger)) return NextResponse.json({ error: '계산 가능한 가격 범위를 초과했습니다.' }, { status: 400 });
  const goalStage = String(body.goalStage ?? 'price');
  const now = new Date().toISOString();
  const product: ProductRecord = {
    id: crypto.randomUUID(), owner_id: await ownerId(), source_url: sourceUrl,
    title: String(body.title ?? '').trim() || `1688 소싱 상품 ${now.slice(5, 10).replace('-', '')}`,
    source_price_cny: sourcePriceCny, exchange_rate: exchangeRate, supply_margin: supplyMargin,
    coupang_margin: coupangMargin, supply_price: supplyPrice, sale_price: salePrice,
    msrp, options_count: optionsCount,
    ...initialStatuses, image_keys: '[]',
    goal_stage: goalStage, created_at: now, updated_at: now,
  };
  try { return NextResponse.json({ product: await insertProduct(product) }, { status: 201 }); }
  catch { return NextResponse.json({ error: '상품을 저장하지 못했습니다. 저장 여부를 목록에서 확인한 뒤 다시 시도해주세요.' }, { status: 503 }); }
}
