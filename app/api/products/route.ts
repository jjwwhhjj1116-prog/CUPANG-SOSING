import { readRegistrationSummaries } from '@/db/product-content';
import { readRegistrationSourceImages } from '@/db/collection-images';
import { readSupplierHubReceiptSummaries } from '@/db/supplier-hub-receipts';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { getSettings, insertProduct, listProducts, type ProductRecord } from '@/db/queries';
import { NextResponse } from 'next/server';
import { initialStatuses, is1688ProductUrl } from '@/app/workflow';

import { savedRegistrationSettings } from '@/app/workspace-settings';
import { calculatePrice, pricePolicy, type PricePolicy } from '@/app/pricing';
async function ownerId() { return await getWorkspaceOwnerId(); }

export async function GET(request?: Request) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return NextResponse.json({error:'Cloudflare Access 로그인 또는 서버 인증 설정을 확인해주세요.'},{status:503});
  try {
    const owner=await ownerId();const removed=request&&new URL(request.url).searchParams.get('removed')==='only'?'only':'exclude';const products=await listProducts(owner,removed);
    const [summaries,sourceImages,receipts]=await Promise.all([
      readRegistrationSummaries(owner,products).catch(()=>null),
      readRegistrationSourceImages(owner,products).catch(()=>null),
      readSupplierHubReceiptSummaries(owner,products).catch(()=>null),
    ]);
    return NextResponse.json({products:products.map(product=>({...product,content_summary:summaries?.[product.id]??null,source_image_key:sourceImages?.[product.id]??null,hub_receipt:receipts?.[product.id]??null}))},{headers:{'cache-control':'no-store'}});
  }
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
  const optionsCount = Number(body.optionsCount ?? 1);
  if (!Number.isSafeInteger(optionsCount) || optionsCount < 1 || optionsCount > 200) {
    return NextResponse.json({ error: '옵션 수는 1~200개여야 합니다.' }, { status: 400 });
  }
  let owner:string,settings:ReturnType<typeof savedRegistrationSettings>;
  try { owner=await ownerId();const stored=await getSettings(owner);settings=savedRegistrationSettings(stored?JSON.parse(stored.payload):null); }
  catch { return NextResponse.json({error:'저장된 기본설정을 읽지 못했습니다. 다시 시도해주세요.'},{status:503}); }
  let policy:PricePolicy,calculation:ReturnType<typeof calculatePrice>;
  try {
    const input:Record<string,unknown>={...settings};
    for(const key of ['exchangeRate','supplyMargin','coupangMargin','minimumMargin','msrpMultiple','roundingUnit','roundingMode','useIntegratedRate','integratedRate'] as const){
      if(Object.hasOwn(body,key))input[key]=body[key];
    }
    const enabled=Object.hasOwn(body,'minimumMarginEnabled')?body.minimumMarginEnabled:settings.minimumMarginEnabled;
    if(typeof enabled!=='boolean')throw Error('최소 마진 적용 여부를 확인해주세요.');
    policy=pricePolicy(input);
    if(!enabled)policy.minimumMargin=0;
    calculation=calculatePrice(sourcePriceCny,policy);
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'가격 설정을 확인해주세요.'},{status:400});}
  const {exchangeRate,supplyMargin,coupangMargin}=policy;
  const {supplyPrice,salePrice,msrp}=calculation;
  const goalStage = String(body.goalStage ?? 'price');
  const now = new Date().toISOString();
  const product: ProductRecord = {
    id: crypto.randomUUID(), owner_id: owner, source_url: sourceUrl,
    title: String(body.title ?? '').trim() || `1688 소싱 상품 ${now.slice(5, 10).replace('-', '')}`,
    source_price_cny: sourcePriceCny, exchange_rate: exchangeRate, supply_margin: supplyMargin,
    coupang_margin: coupangMargin, supply_price: supplyPrice, sale_price: salePrice,
    msrp, options_count: optionsCount,
    ...initialStatuses, image_keys: '[]',
    goal_stage: goalStage, created_at: now, updated_at: now,
  };
  try { return NextResponse.json({ product: await insertProduct(product,policy) }, { status: 201 }); }
  catch { return NextResponse.json({ error: '상품을 저장하지 못했습니다. 저장 여부를 목록에서 확인한 뒤 다시 시도해주세요.' }, { status: 503 }); }
}
