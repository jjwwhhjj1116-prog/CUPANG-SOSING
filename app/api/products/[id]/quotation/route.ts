import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { ownsTemplateKey } from '@/db/category-templates';
import { categoryProfileIssues, mapQuotationRow } from '@/app/category-profiles';
import { createMappedQuotation } from '@/app/exports/mapped-quotation';
import { readQuotationExportSource, resolveQuotationExport, quotationExportFingerprint, QuotationExportError } from '@/app/exports/quotation-source';
import { quotationAttachmentKeys, resolvedQuotationRows, quotationFieldFiles } from '@/app/exports/quotation-fields';
import { loadAttachments, AttachmentError } from '@/app/exports/attachments';
import { createReviewBundle } from '@/app/exports/review-bundle';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { ExportSizeError } from '@/app/exports/zip';

const json = (body: unknown, status = 200) => NextResponse.json(body, {status, headers:{'cache-control':'no-store'}});
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
    const saved = await readQuotationExportSource(owner,id,input.profileId);
    const {product,content,options,profile} = saved;
    if(!profile) return json({error:'카테고리 연결을 찾을 수 없습니다.'},404);
    const template = profile.template;
    if(!template?.storageKey || !ownsTemplateKey(owner,template.storageKey)) return json({error:'카테고리 설정에서 실제 견적서 원본을 연결해주세요.'},409);
    const revision = await quotationExportFingerprint(saved,input.dataStartRow);
    if(input.action === 'export' && input.fingerprint !== revision) return json({error:'검토 후 상품·옵션·설정·카테고리 또는 견적 수정값이 변경됐습니다. 자료 검토를 다시 실행해주세요.'},409);
    const resolved = resolveQuotationExport(saved);
    const requestedKeys = quotationAttachmentKeys(saved,resolved);
    const assets = await loadAttachments(owner,product.image_keys,requestedKeys);
    const original = await env.FILES.get(template.storageKey);
    if(!original) return json({error:'견적서 원본 파일을 찾을 수 없습니다.'},409);
    if(original.size > 5_000_000) return json({error:'견적서 원본이 허용 크기를 초과했습니다.'},413);
    let generated, rows, fields;
    try {
      rows = resolvedQuotationRows(saved,resolved,assets);
      fields = quotationFieldFiles(saved,resolved,assets,revision);
      generated = await createMappedQuotation({originalBytes:await original.arrayBuffer(),profile,rows,dataStartRow:input.dataStartRow});
    }
    catch(error) {return json({error:error instanceof Error?error.message:'견적서 양식을 채우지 못했습니다.'},error instanceof ExportSizeError?413:400);}
    let latest;
    try { latest = await readQuotationExportSource(owner,id,input.profileId); }
    catch(error) { if(error instanceof QuotationExportError && error.status === 404) return json({error:'자료 생성 중 상품 또는 카테고리가 변경됐습니다.'},409); throw error; }
    if(await quotationExportFingerprint(latest,input.dataStartRow) !== revision) return json({error:'자료 생성 중 변경이 발생했습니다. 저장 완료 후 다시 검토해주세요.'},409);
    const warnings = [...categoryProfileIssues(profile),...generated.report.warnings,...fields.warnings,'Supplier Hub 공식 접수 검증 전인 검토용 파일입니다.','제조사·수입자·연락처 기본설정은 실제 상품과 일치하는지 확인해주세요.'];
    const report = {...generated.report,warnings,productId:id,productVersion:product.updated_at,contentRevision:content.revision,optionRevision:options.revision,quotationRevision:saved.state.revision,profileId:profile.id,profileRevision:profile.revision,templateSha256:template.sha256,submissionReady:false};
    if(input.action === 'preview') return json({fingerprint:revision,report,filename:generated.filename,rows:rows.map(row=>mapQuotationRow(profile,row).values),headers:template.headers});
    const bytes = createReviewBundle(product,content,assets,[
      {name:`quotation-filled.${template.format}`,data:generated.bytes},
      {name:'quotation-report.json',data:JSON.stringify(report,null,2)},
      {name:'options.json',data:JSON.stringify(options,null,2)},
      ...fields.files,
    ]);
    return new Response(bytes.buffer as ArrayBuffer,{headers:{'content-type':'application/zip','content-disposition':'attachment; filename="sourceflow-quotation-review.zip"','cache-control':'no-store','x-content-type-options':'nosniff'}});
  } catch(error) {
    if(error instanceof AttachmentError) return json({error:error.message},error.status);
    if(error instanceof QuotationExportError) return json({error:error.message},error.status);
    if(error instanceof ExportSizeError) return json({error:error.message},413);
    return json({error:'견적서와 첨부 자료를 읽거나 생성하지 못했습니다.'},503);
  }
}
