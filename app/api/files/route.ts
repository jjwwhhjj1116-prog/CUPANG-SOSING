import { imageDimensionMetadata } from '@/app/image-dimensions';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { imageFileType, imageObjectName, isOwnedImageKey, MAX_IMAGE_BYTES, MAX_IMAGE_MULTIPART_BYTES } from '@/app/image-files';
import { readBoundedBytes, RequestBodyError } from '@/app/request-body';
import { labelUploadDigest, labelUploadKey } from '@/app/label-upload-key';
import { parseProductLabelProofRequest, verifiedProductLabelMetadata } from '@/app/product-label-proof';
import type { ProductLabelsView } from '@/app/product-label';
import { parseQuotationLabelProofRequest, quotationLabelReceiptFromMetadata, verifiedQuotationLabelMetadata } from '@/app/quotation-label-proof';
import type { QuotationFieldsView } from '@/app/quotation-schema';

async function savedLabel(ownerId: string, uploadId: string) {
  const key = labelUploadKey(ownerId, uploadId);
  if (!isOwnedImageKey(ownerId, key)) throw new Error('Invalid label owner');
  const object = await env.FILES.head(key);
  if (!object) return null;
  if (object.size < 1 || object.size > MAX_IMAGE_BYTES || object.httpMetadata?.contentType !== 'image/png'
    || object.customMetadata?.labelUploadId !== uploadId || !/^[a-f0-9]{64}$/.test(object.customMetadata?.labelBlobSha256 ?? '')) throw new Error('Invalid saved label');
  const quotationLabelProof = quotationLabelReceiptFromMetadata(object.customMetadata);
  return { key, contentType: 'image/png', size: object.size, sha256: object.customMetadata!.labelBlobSha256,
    ...(quotationLabelProof ? { quotationLabelProof } : {}) };
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return NextResponse.json({ error: '운영 인증 연결 후 라벨 파일을 확인할 수 있습니다.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  try {
    const params = new URL(request.url).searchParams, uploadId = params.get('labelUploadId');
    if (params.getAll('labelUploadId').length !== 1 || [...params.keys()].some(key => key !== 'labelUploadId') || !/^[a-f0-9]{64}$/.test(uploadId ?? '')) return NextResponse.json({ error: '라벨 업로드 번호를 확인해주세요.' }, { status: 400, headers: { 'cache-control': 'no-store' } });
    const ownerId = await getWorkspaceOwnerId();
    if (!env.FILES) throw new Error('Missing storage');
    return NextResponse.json(await savedLabel(ownerId, uploadId!) ?? { key: null }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: '저장한 라벨 파일을 확인하지 못했습니다. 다시 확인한 뒤 연결해주세요.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return NextResponse.json({ error: 'Cloudflare Access 로그인 또는 서버 인증 설정을 확인해주세요.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  try {
    const ownerId = await getWorkspaceOwnerId();
    const contentType = request.headers.get('content-type') ?? '';
    if (!/^multipart\/form-data(?:\s*;|$)/i.test(contentType)) return NextResponse.json({ error: '이미지 파일을 multipart 형식으로 업로드해주세요.' }, { status: 400 });
    // Buffer at most 10 MB plus bounded multipart headers before parsing. This
    // avoids unbounded request.formData() allocation and distrusts Content-Length.
    const body = await readBoundedBytes(request, MAX_IMAGE_MULTIPART_BYTES);
    let form: FormData;
    try { form = await new Response(body.buffer as ArrayBuffer, { headers: { 'content-type': contentType } }).formData(); }
    catch { return NextResponse.json({ error: '파일 업로드 형식을 읽지 못했습니다.' }, { status: 400 }); }
    if (form.getAll('file').length !== 1 || form.getAll('labelUploadId').length > 1 || form.getAll('productLabelProof').length > 1 || form.getAll('quotationLabelProof').length > 1
      || form.has('productLabelProof') && form.has('quotationLabelProof')
      || [...form.keys()].some(key => !['file', 'labelUploadId','productLabelProof','quotationLabelProof'].includes(key))) return NextResponse.json({ error: '이미지 한 개만 업로드해주세요.' }, { status: 400 });
    const uploadId = form.get('labelUploadId');
    if (uploadId !== null && (typeof uploadId !== 'string' || !/^[a-f0-9]{64}$/.test(uploadId))) return NextResponse.json({ error: '라벨 업로드 번호를 확인해주세요.' }, { status: 400 });
    const rawProof=form.get('productLabelProof');
    let proof:ReturnType<typeof parseProductLabelProofRequest>|null=null;
    const rawQuotationProof=form.get('quotationLabelProof');
    let quotationProof:ReturnType<typeof parseQuotationLabelProofRequest>|null=null;
    try{
      if(rawProof!==null){if(uploadId===null||typeof rawProof!=='string'||rawProof.length>2000)throw Error('제품 표시사항 원천 정보가 올바르지 않습니다.');proof=parseProductLabelProofRequest(JSON.parse(rawProof));}
      if(rawQuotationProof!==null){if(uploadId===null||typeof rawQuotationProof!=='string'||rawQuotationProof.length>2000)throw Error('견적 표시사항 원천 정보가 올바르지 않습니다.');quotationProof=parseQuotationLabelProofRequest(JSON.parse(rawQuotationProof));}
    }catch{return NextResponse.json({error:'제품 표시사항 PNG의 상품·옵션·저장 원천을 확인해주세요.'},{status:400});}
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: '내용이 있는 이미지 파일을 선택해주세요.' }, { status: 400 });
    if (file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: '이미지는 10MB 이하만 업로드할 수 있습니다.' }, { status: 413 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    let actual;
    try { actual = imageFileType(bytes); }
    catch { return NextResponse.json({ error: 'PNG·JPEG·WebP·GIF·AVIF 이미지 파일만 업로드할 수 있습니다. SVG·HTML은 지원하지 않습니다.' }, { status: 415 }); }
    if (uploadId !== null && (actual.contentType !== 'image/png' || file.name !== 'sourceflow-quotation-label.png'
      || (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin))) return NextResponse.json({ error: '같은 사이트에서 생성한 라벨 PNG를 업로드해주세요.' }, { status: 400 });
    const key = uploadId === null ? `${ownerId}/${crypto.randomUUID()}-${imageObjectName(file.name, actual.extension)}` : labelUploadKey(ownerId, uploadId);
    if (!isOwnedImageKey(ownerId, key)) return NextResponse.json({ error: '업로드 소유자 정보를 확인해주세요.' }, { status: 400 });
    if (!env.FILES) return NextResponse.json({ error: '이미지 저장소가 연결되지 않았습니다.' }, { status: 503 });
    const verifyProof=async()=>{
      if(quotationProof){
        const {GET:quotationFieldsGET}=await import('@/app/api/products/[id]/quotation-fields/route');
        const response=await quotationFieldsGET(new Request(new URL(quotationProof.endpoint,request.url),{headers:request.headers}),{params:Promise.resolve({id:quotationProof.productId})});
        const view=await response.json() as QuotationFieldsView & {error?:string};
        if(!response.ok)throw Error(view.error||'견적 표시사항 저장 원천을 확인하지 못했습니다.');
        return verifiedQuotationLabelMetadata(quotationProof,view,uploadId as string);
      }
      if(!proof)return {} as Record<string,string>;
      const {GET:productLabelsGET}=await import('@/app/api/products/[id]/product-labels/route');
      const response=await productLabelsGET(new Request(new URL(proof.endpoint,request.url),{headers:request.headers}),{params:Promise.resolve({id:proof.productId})});
      const view=await response.json() as ProductLabelsView & {error?:string};
      if(!response.ok)throw Error(view.error||'제품 표시사항 저장 원천을 확인하지 못했습니다.');
      return verifiedProductLabelMetadata(proof,view,uploadId as string);
    };
    let proofMetadata:Record<string,string>;
    try{proofMetadata=await verifyProof();}catch(cause){return NextResponse.json({error:cause instanceof Error?cause.message:'제품 표시사항 원천이 변경되었습니다.'},{status:409});}
    const sha256 = uploadId === null ? null : await labelUploadDigest(bytes);
    const quotationLabelProof = quotationProof ? quotationLabelReceiptFromMetadata({...proofMetadata,labelUploadId:uploadId,labelBlobSha256:sha256}) : null;
    const reuse = async (saved: Awaited<ReturnType<typeof savedLabel>>) => {
      if (!saved || saved.sha256 !== sha256 || saved.size !== bytes.byteLength
        || quotationLabelProof && JSON.stringify(saved.quotationLabelProof) !== JSON.stringify(quotationLabelProof)) {
        return NextResponse.json({ error: '같은 라벨 번호에 다른 PNG가 저장되어 있습니다. 저장한 라벨을 다시 확인해주세요.' }, { status: 409, headers: { 'cache-control': 'no-store' } });
      }
      // The object lookup is another async step. Reusing its bytes does not
      // excuse a source change between the first proof read and the response.
      if(proof||quotationProof)try{await verifyProof();}catch(cause){return NextResponse.json({error:cause instanceof Error?cause.message:'표시사항 저장 원천이 변경되었습니다. 원본 파일은 보존됩니다.'},{status:409});}
      return NextResponse.json({ ...saved, reused: true }, { headers: { 'cache-control': 'no-store' } });
    };
    if (uploadId !== null) { const existing = await savedLabel(ownerId, uploadId); if (existing) return reuse(existing); }
    const object = await env.FILES.put(key, bytes, { httpMetadata: { contentType: actual.contentType }, customMetadata: { imageValidation: 'header-v1', ...imageDimensionMetadata(bytes),
      ...(uploadId === null ? {} : { labelUploadId: uploadId, labelBlobSha256: sha256! }),...proofMetadata },
      ...(uploadId === null ? {} : { onlyIf: new Headers({ 'if-none-match': '*' }) }) });
    if (!object && uploadId !== null) { const existing = await savedLabel(ownerId, uploadId); if (existing) return reuse(existing); }
    if (!object) throw new Error('R2 did not confirm the upload.');
    if(proof||quotationProof)try{await verifyProof();}catch(cause){return NextResponse.json({error:cause instanceof Error?cause.message:'이미지를 저장하는 동안 표시사항이 변경되었습니다. 원본 파일은 보존됩니다.'},{status:409});}
    return NextResponse.json({ key, url: `/api/files/${key.split('/').map(encodeURIComponent).join('/')}`, contentType: actual.contentType, size: bytes.byteLength,
      ...(quotationLabelProof ? {quotationLabelProof} : {}) }, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof RequestBodyError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: '이미지를 저장하지 못했습니다. 저장소 연결을 확인한 후 다시 시도해주세요.' }, { status: 503 });
  }
}
