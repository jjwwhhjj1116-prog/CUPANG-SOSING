import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct, applyProductPrice, readProductPriceQuotationSnapshot, type ProductPriceQuotationCommit } from '@/db/queries';
import { pricePolicy, calculatePrice } from '@/app/pricing';
import { readProductOptions } from '@/db/product-options';
import { calculateOptionPrices } from '@/app/product-options';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return NextResponse.json({ error: '운영 인증 연결 후 가격 변경을 사용할 수 있습니다.' }, { status: 503 });
  let policy; let expectedVersion: string;let recalculate=false;let profileId:string|undefined;
  try {
    if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) throw new Error('같은 사이트에서 가격을 저장해주세요.');
    const input: unknown = await readBoundedJson(request, 8 * 1024);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('가격 설정 객체가 필요합니다.');
    const body = input as Record<string, unknown>;
    if (Object.keys(body).some(key => !['policy', 'expectedVersion', 'recalculate', 'profileId'].includes(key))) throw new Error('가격 정책과 현재 상품 저장 버전을 확인해주세요.');
    if(body.recalculate!==undefined&&typeof body.recalculate!=='boolean')throw Error('일괄 재계산 선택 상태를 확인해주세요.');
    if(body.profileId!==undefined&&(typeof body.profileId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(body.profileId)))throw Error('견적서 카테고리 선택을 확인해주세요.');
    recalculate=body.recalculate===true;profileId=body.profileId as string|undefined;
    policy = pricePolicy(body.policy);
    if (typeof body.expectedVersion !== 'string' || !Number.isFinite(Date.parse(body.expectedVersion))) throw new Error('상품을 다시 불러와주세요.');
    expectedVersion = body.expectedVersion;
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '입력을 확인해주세요.' }, { status: error instanceof RequestBodyError ? error.status : 400 }); }
  let owner: string;
  try { owner = await getWorkspaceOwnerId(); } catch { return NextResponse.json({ error: '운영 인증 연결 후 가격 변경을 사용할 수 있습니다.' }, { status: 503 }); }
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
    let quotation:ProductPriceQuotationCommit|undefined;
    // Older API test doubles and documents without a quotation sidecar retain
    // the original two-statement save. No schema/field resolution is required.
    const raw=typeof readProductPriceQuotationSnapshot==='function'?await readProductPriceQuotationSnapshot(owner,id):null;
    const nonempty=(value:unknown)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length>0;
    const hasMarkers=!!raw&&(nonempty(raw.state.stageTwoMsrp)||raw.state.categoryStageTwoMsrp&&Object.values(raw.state.categoryStageTwoMsrp).some(nonempty));
    if(recalculate||hasMarkers){
      const {stableQuotationFieldsView,QuotationFieldsSnapshotError}=await import('@/app/quotation-fields-snapshot');
      let snapshot;
      try{snapshot=await stableQuotationFieldsView(owner,id,profileId??null);}
      catch(error){if(error instanceof QuotationFieldsSnapshotError)return NextResponse.json({error:error.message},{status:error.status});throw error;}
      const before=await readProductPriceQuotationSnapshot(owner,id);
      if(!before||before.state.revision!==snapshot.view.revision||snapshot.source.productVersion!==expectedVersion)
        return NextResponse.json({error:'견적서 저장 기준이 변경되었습니다. 다시 불러와주세요.'},{status:409});
      const {preparePolicyQuotationPrices}=await import('@/app/policy-quotation-prices');
      let plan;
      try{plan=preparePolicyQuotationPrices(snapshot.view,before.state,policy,recalculate);}
      catch(error){return NextResponse.json({error:error instanceof Error?error.message:'견적서 가격을 확인해주세요.'},{status:400});}
      quotation={source:snapshot.source,before,state:plan.state,writeQuote:plan.changed};
    }
    const saved = quotation?await applyProductPrice(owner, id, expectedVersion, { ...policy, ...calculation }, policy,quotation)
      :await applyProductPrice(owner, id, expectedVersion, { ...policy, ...calculation }, policy);
    return saved ? NextResponse.json({ product: saved, calculation }) : NextResponse.json({ error: '동시에 변경된 상품입니다. 목록을 새로고침해주세요.' }, { status: 409 });
  } catch { return NextResponse.json({ error: '가격을 저장하지 못했습니다. 목록에서 저장 여부를 확인해주세요.' }, { status: 503 }); }
}
