import { isOwnedImageKey } from '@/app/image-files';
import { quotationWorkbookIssues } from '@/app/exports/quotation-workbook-issues';
import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { ownsTemplateKey } from '@/db/category-templates';
import { categoryProfileIssues, quotationStartRow } from '@/app/category-profiles';
import { createMappedQuotation } from '@/app/exports/mapped-quotation';
import { readMappedQuotationSource, resolveQuotationExport, quotationExportFingerprint, QuotationExportError } from '@/app/exports/quotation-source';
import { quotationMappingCoverage, quotationAttachmentKeys, resolvedQuotationRows, quotationFieldFiles } from '@/app/exports/quotation-fields';
import { loadAttachments, AttachmentError } from '@/app/exports/attachments';
import { createReviewBundle } from '@/app/exports/review-bundle';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { ExportSizeError } from '@/app/exports/zip';
import { quotationFilename } from '@/app/exports/quotation-filename';
import { publicDetailConfig, resolvePublicDetail, publishPublicDetail, publicDetailMediaIssues, PublicDetailError } from '@/app/quotation-public-detail';
import { productImageKeys } from '@/app/product-content';
import {loadLegalDocumentAttachments} from '@/app/exports/legal-documents';

const json = (body: unknown, status = 200) => NextResponse.json(body, {status, headers:{'cache-control':'no-store'}});
export async function POST(request: Request, context: {params: Promise<{id: string}>}) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({error:'운영 인증 연결 후 견적서 생성 기능을 사용할 수 있습니다.'},503);
  let input: {action:'preview'|'source'|'export'|'download'; profileId?:string; dataStartRow?:number; fingerprint?:string};
  try {
    input = await readBoundedJson(request,4096) as typeof input;
    if(!input || !['preview','source','export','download'].includes(input.action) || (input.profileId !== undefined && (typeof input.profileId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.profileId))) || (input.dataStartRow !== undefined && (!Number.isInteger(input.dataStartRow) || input.dataStartRow < 2 || input.dataStartRow > 10000))) throw new Error('카테고리 연결과 입력 시작 행을 확인해주세요.');
    if(!['preview','source'].includes(input.action) && (typeof input.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.fingerprint))) throw new Error('자료 검토를 먼저 실행해주세요.');
  } catch(error) {return json({error:error instanceof Error ? error.message : '입력을 확인해주세요.'},error instanceof RequestBodyError?error.status:400);}
  try {
    const owner = await getWorkspaceOwnerId(); const {id} = await context.params;
    const detailConfig = publicDetailConfig(env as Parameters<typeof publicDetailConfig>[0]);
    const saved = await readMappedQuotationSource(owner,id,input.profileId ?? null);
    const {product,content,options,profile} = saved;
    if(!profile) return json({error:'카테고리 연결을 찾을 수 없습니다.'},404);
    const template = profile.template;
    if(!template?.storageKey || !ownsTemplateKey(owner,template.storageKey)) return json({error:'카테고리 설정에서 실제 견적서 원본을 연결해주세요.'},409);
    const dataStartRow = input.dataStartRow ?? quotationStartRow(template);
    const revision = await quotationExportFingerprint(saved,dataStartRow,detailConfig);
    const filename = quotationFilename(revision,template.format);
    if(input.action === 'source'){
      // Polling compares saved inputs without rebuilding XLSX or downloading R2 assets.
      let current;
      try { current = await readMappedQuotationSource(owner,id,input.profileId ?? null); }
      catch(error) { if(error instanceof QuotationExportError && error.status === 404) return json({error:'자료 확인 중 상품 또는 카테고리가 변경됐습니다.'},409); throw error; }
      if(await quotationExportFingerprint(current,input.dataStartRow ?? quotationStartRow(current.profile?.template),detailConfig) !== revision)
        return json({error:'자료 확인 중 변경이 발생했습니다. 저장 완료 후 다시 검토해주세요.'},409);
      return json({fingerprint:revision,filename,report:{productId:id,categoryId:saved.categoryContext.categoryId,profileId:profile.id,company:saved.company,
        rowCount:resolveQuotationExport(saved).rows.filter(row=>row.included).length,submissionReady:false}});
    }
    if(input.action !== 'preview' && input.fingerprint !== revision) return json({error:'검토 후 상품·옵션·설정·카테고리 또는 견적 수정값이 변경됐습니다. 자료 검토를 다시 실행해주세요.'},409);
    const detail = await resolvePublicDetail(resolveQuotationExport(saved),content,owner,productImageKeys(product.image_keys),detailConfig);
    const resolved = detail.resolved;
    if(!resolved.rows.some(row => row.included)) return json({error:'견적서에 포함할 옵션을 한 개 이상 선택해주세요. 삭제·제외된 옵션은 출력하지 않습니다.'},400);
    if (quotationAttachmentKeys(saved,resolved).some(key => !isOwnedImageKey(owner,key))) return json({error:'상품의 첨부 이미지 소유자를 확인해주세요.'},409);
    const requestedKeys = quotationAttachmentKeys(saved,resolved,'quotation');
    const assets = await loadAttachments(owner,product.image_keys,requestedKeys);
    const legal=await loadLegalDocumentAttachments(content.legalDocuments,owner,id);
    const original = await env.FILES.get(template.storageKey);
    if(!original) return json({error:'견적서 원본 파일을 찾을 수 없습니다.'},409);
    if(original.size > 5_000_000) return json({error:'견적서 원본이 허용 크기를 초과했습니다.'},413);
    let generated, rows, fields;
    try {
      rows = resolvedQuotationRows(saved,resolved,assets);
      generated = await createMappedQuotation({originalBytes:await original.arrayBuffer(),profile,rows,dataStartRow});
      const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(generated.bytes));
      const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      fields = quotationFieldFiles(saved,resolved,assets,revision,{filename, byteLength: generated.bytes.byteLength, sha256},[
        ...quotationWorkbookIssues(generated.report,profile,resolved), ...publicDetailMediaIssues(resolved,detail.images,assets),
        ...(legal.applicability==='required'&&!legal.attachments.length?[{kind:'error' as const,code:'LEGAL_DOCUMENT_MISSING',optionId:null,optionLabel:'법적 필수서류',fieldId:null,message:'서류 해당함을 선택했습니다. 원본 서류를 첨부해주세요.'}]:[]),
      ],legal);
    }
    catch(error) {return json({error:error instanceof Error?error.message:'견적서 양식을 채우지 못했습니다.'},error instanceof ExportSizeError?413:400);}
    let latest;
    try { latest = await readMappedQuotationSource(owner,id,input.profileId ?? null); }
    catch(error) { if(error instanceof QuotationExportError && error.status === 404) return json({error:'자료 생성 중 상품 또는 카테고리가 변경됐습니다.'},409); throw error; }
    if(await quotationExportFingerprint(latest,input.dataStartRow ?? quotationStartRow(latest.profile?.template),detailConfig) !== revision) return json({error:'자료 생성 중 변경이 발생했습니다. 저장 완료 후 다시 검토해주세요.'},409);
    const mappingCoverage = quotationMappingCoverage(resolved, profile);
    const mappingWarnings = mappingCoverage.map(field => `${field.label}: ${field.required ? '카테고리 필수 항목' : field.manualOptions.length ? '수동 수정 항목' : '자동 작성 항목'}이 Excel 열에 연결되지 않았습니다. 최종값은 quotation-fields 파일에만 보존됩니다.`);
    const warnings = [...mappingWarnings,...categoryProfileIssues(profile),...generated.report.warnings,...fields.warnings,'Supplier Hub 공식 접수 검증 전인 검토용 파일입니다.','제조사·수입자·연락처 기본설정은 실제 상품과 일치하는지 확인해주세요.'];
    const publicDetailImageCount = profile.mappings.some(mapping => mapping.field === 'detailHtml') ? detail.images.length : 0;
    const report = {...generated.report,company:saved.company,mappingCoverage,warnings,productId:id,categoryId:saved.categoryContext.categoryId,productVersion:product.updated_at,contentRevision:content.revision,optionRevision:options.revision,quotationRevision:saved.state.revision,profileId:profile.id,profileRevision:profile.revision,templateSha256:template.sha256,
      legalDocuments:{applicability:legal.applicability,count:legal.attachments.length},
      ...(detailConfig ? { publicDetailImages: { count: publicDetailImageCount, publishedByThisRequest: input.action !== 'preview' && publicDetailImageCount > 0 } } : {}),submissionReady:false};
    if(input.action === 'preview') return json({fingerprint:revision,report,submissionReview:fields.review,filename,rows:generated.values,headers:template.headers});
    const bytes = input.action === 'download' ? new Uint8Array(generated.bytes) : createReviewBundle(product,content,assets,[
      {name:filename,data:generated.bytes},
      {name:'quotation-report.json',data:JSON.stringify(report,null,2)},
      {name:'options.json',data:JSON.stringify(options,null,2)},
      ...fields.files,
      ...legal.files,
    ], 'quotation');
    // A preview/source read never publishes. Only an explicit download/package
    // request creates capability copies needed by Supplier Hub's HTML reader.
    if (detail.images.length && profile.mappings.some(mapping => mapping.field === 'detailHtml')) {
      await publishPublicDetail(detail.images,assets,env.FILES);
      const afterPublication = await readMappedQuotationSource(owner,id,input.profileId ?? null);
      if(await quotationExportFingerprint(afterPublication,input.dataStartRow ?? quotationStartRow(afterPublication.profile?.template),detailConfig) !== revision)
        return json({error:'상세 이미지 준비 중 자료가 변경됐습니다. 저장 완료 후 견적서를 다시 준비해주세요.'},409);
    }
    if(input.action === 'download') return new Response(bytes.buffer as ArrayBuffer,{headers:{
      'content-type':generated.mimeType,'content-disposition':`attachment; filename="${filename}"`,
      'x-quotation-fingerprint':revision,'cache-control':'no-store','x-content-type-options':'nosniff',
    }});
    return new Response(bytes.buffer as ArrayBuffer,{headers:{'content-type':'application/zip','content-disposition':'attachment; filename="sourceflow-quotation-review.zip"','cache-control':'no-store','x-content-type-options':'nosniff'}});
  } catch(error) {
    if(error instanceof PublicDetailError) return json({error:error.message},error.status);
    if(error instanceof AttachmentError) return json({error:error.message},error.status);
    if(error instanceof QuotationExportError) return json({error:error.message},error.status);
    if(error instanceof ExportSizeError) return json({error:error.message},413);
    return json({error:'견적서와 첨부 자료를 읽거나 생성하지 못했습니다.'},503);
  }
}
