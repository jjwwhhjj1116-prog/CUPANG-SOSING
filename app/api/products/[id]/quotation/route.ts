import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { fingerprint } from '@/app/automation/model';
import { findProduct, getSettings } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { readProductOptions } from '@/db/product-options';
import { getCategoryProfile } from '@/db/category-profiles';
import { ownsTemplateKey } from '@/db/category-templates';
import { defaultSettings, validateSettings } from '@/app/workspace-settings';
import { categoryProfileIssues, mapQuotationRow } from '@/app/category-profiles';
import { createMappedQuotation } from '@/app/exports/mapped-quotation';
import { quotationData } from '@/app/exports/quotation-data';
import { loadAttachments, AttachmentError } from '@/app/exports/attachments';
import { createReviewBundle } from '@/app/exports/review-bundle';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';

const json = (body: unknown, status = 200) => NextResponse.json(body, {status, headers:{'cache-control':'no-store'}});
async function snapshot(owner: string, productId: string, profileId: string) {
  const product = await findProduct(owner, productId);
  if (!product) return null;
  const [content, options, profile, savedSettings] = await Promise.all([
    readProductContent(owner, productId), readProductOptions(owner, productId),
    getCategoryProfile(owner, profileId), getSettings(owner),
  ]);
  const settings = savedSettings ? validateSettings(JSON.parse(savedSettings.payload)) : defaultSettings;
  return {product, content, options, profile, settings};
}
export async function POST(request: Request, context: {params: Promise<{id: string}>}) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({error:'운영 인증 연결 후 견적서 생성 기능을 사용할 수 있습니다.'},503);
  let input: {action:'preview'|'export'; profileId:string; dataStartRow:number; fingerprint?:string};
  try {
    input = await readBoundedJson(request,4096) as typeof input;
    if(!input || !['preview','export'].includes(input.action) || typeof input.profileId !== 'string' || input.profileId.length > 100 || !Number.isInteger(input.dataStartRow) || input.dataStartRow < 2 || input.dataStartRow > 10000) throw new Error('카테고리 연결과 입력 시작 행을 확인해주세요.');
    if(input.action === 'export' && (typeof input.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.fingerprint))) throw new Error('자료 검토를 먼저 실행해주세요.');
  } catch(error) {return json({error:error instanceof Error ? error.message : '입력을 확인해주세요.'},error instanceof RequestBodyError?error.status:400);}
  try {
    const owner = await getWorkspaceOwnerId(); const {id} = await context.params;
    const saved = await snapshot(owner,id,input.profileId);
    if(!saved) return json({error:'상품을 찾을 수 없습니다.'},404);
    const {product,content,options,profile,settings} = saved;
    if(!profile) return json({error:'카테고리 연결을 찾을 수 없습니다.'},404);
    const template = profile.template;
    if(!template?.storageKey || !ownsTemplateKey(owner,template.storageKey)) return json({error:'카테고리 설정에서 실제 견적서 원본을 연결해주세요.'},409);
    const revision = await fingerprint({saved,dataStartRow:input.dataStartRow});
    if(input.action === 'export' && input.fingerprint !== revision) return json({error:'검토 후 상품·옵션·설정·카테고리가 변경됐습니다. 자료 검토를 다시 실행해주세요.'},409);
    const requestedKeys = [...Object.values(content.assets).flatMap(field=>field.value),...options.rows.filter(row=>row.included && row.imageKey).map(row=>row.imageKey!)];
    const assets = await loadAttachments(owner,product.image_keys,requestedKeys);
    const original = await env.FILES.get(template.storageKey);
    if(!original) return json({error:'견적서 원본 파일을 찾을 수 없습니다.'},409);
    if(original.size > 5_000_000) return json({error:'견적서 원본이 허용 크기를 초과했습니다.'},413);
    let generated;
    try {generated = await createMappedQuotation({originalBytes:await original.arrayBuffer(),profile,rows:quotationData(product,content,settings,options.rows,assets),dataStartRow:input.dataStartRow});}
    catch(error) {return json({error:error instanceof Error?error.message:'견적서 양식을 채우지 못했습니다.'},400);}
    const latest = await snapshot(owner,id,input.profileId);
    if(!latest || await fingerprint({saved:latest,dataStartRow:input.dataStartRow}) !== revision) return json({error:'자료 생성 중 변경이 발생했습니다. 저장 완료 후 다시 검토해주세요.'},409);
    const warnings = [...categoryProfileIssues(profile),...generated.report.warnings,'Supplier Hub 공식 접수 검증 전인 검토용 파일입니다.','제조사·수입자·연락처 기본설정은 실제 상품과 일치하는지 확인해주세요.'];
    const report = {...generated.report,warnings,productId:id,productVersion:product.updated_at,contentRevision:content.revision,optionRevision:options.revision,profileId:profile.id,profileRevision:profile.revision,templateSha256:template.sha256,submissionReady:false};
    if(input.action === 'preview') return json({fingerprint:revision,report,filename:generated.filename,rows:quotationData(product,content,settings,options.rows,assets).map(row=>mapQuotationRow(profile,row).values),headers:template.headers});
    const bytes = createReviewBundle(product,content,assets,[
      {name:`quotation-filled.${template.format}`,data:generated.bytes},
      {name:'quotation-report.json',data:JSON.stringify(report,null,2)},
      {name:'options.json',data:JSON.stringify(options,null,2)},
    ]);
    return new Response(bytes.buffer as ArrayBuffer,{headers:{'content-type':'application/zip','content-disposition':'attachment; filename="sourceflow-quotation-review.zip"','cache-control':'no-store','x-content-type-options':'nosniff'}});
  } catch(error) {
    if(error instanceof AttachmentError) return json({error:error.message},error.status);
    return json({error:'견적서와 첨부 자료를 읽거나 생성하지 못했습니다.'},503);
  }
}
