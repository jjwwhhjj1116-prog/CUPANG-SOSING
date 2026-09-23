import { env } from 'cloudflare:workers';
import { inspectQuotationImages } from '@/app/quotation-image-review';
import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { readQuotationExportSource, resolveQuotationExport, quotationExportFingerprint, QuotationExportError } from '@/app/exports/quotation-source';
import { readQuotationFields, quotationSourcesCurrent } from '@/db/quotation-fields';
import { productImageKeys } from '@/app/product-content';
import { isOwnedImageKey } from '@/app/image-files';
import { inspectSubmission } from '@/app/submission-review';

const json = (body: unknown, status=200) => NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
export async function GET(request: Request, context: {params:Promise<{id:string}>}) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({error:'운영 인증 연결 후 등록 자료를 검사할 수 있습니다.'},503);
  try {
    const profileId = new URL(request.url).searchParams.get('profileId');
    if (profileId !== null && !/^[a-zA-Z0-9_-]{1,100}$/.test(profileId)) return json({error:'카테고리 설정을 확인해주세요.'},400);
    const owner = await getWorkspaceOwnerId(); const {id} = await context.params;
    const saved = await readQuotationExportSource(owner,id,profileId);
    const resolved = resolveQuotationExport(saved);
    const keys = productImageKeys(saved.product.image_keys).filter(key=>isOwnedImageKey(owner,key));
    const checks = await inspectQuotationImages(resolved,keys,env.FILES ? key=>env.FILES.head(key) : undefined);
    const report = inspectSubmission(resolved,keys,checks);
    const fingerprint = await quotationExportFingerprint(saved,null);
    if (!await quotationSourcesCurrent(owner,id,saved.source) || (await readQuotationFields(owner,id)).revision !== saved.state.revision) {
      return json({error:'검사 중 자료가 변경되었습니다. 저장을 마친 뒤 다시 검사해주세요.'},409);
    }
    return json({...report,productId:id,title:saved.product.title,sourceUrl:saved.product.source_url,checkedAt:new Date().toISOString(),fingerprint});
  } catch (error) {
    if (error instanceof QuotationExportError) return json({error:error.message},error.status);
    return json({error:'등록 자료를 읽지 못했습니다. 잠시 후 다시 검사해주세요.'},503);
  }
}
