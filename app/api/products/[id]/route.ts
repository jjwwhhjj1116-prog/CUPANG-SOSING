import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { updateProduct, findProduct } from '@/db/queries';
import { NextResponse } from 'next/server';
import { validateProductPatch } from '@/app/workflow';
import { env } from 'cloudflare:workers';
import { imageFileType, isOwnedImageKey, MAX_IMAGE_BYTES } from '@/app/image-files';
import { readBoundedJson, readBoundedStream, RequestBodyError } from '@/app/request-body';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if(process.env.NODE_ENV==='production' && !(await getChatGPTUser())?.verifiedAccess) return NextResponse.json({error:'운영 인증 연결 후 사용할 수 있습니다.'},{status:503});
  try {
    const ownerId=await getWorkspaceOwnerId();const {id}=await context.params;
    const product=await findProduct(ownerId,id);
    return product?NextResponse.json({product},{headers:{'cache-control':'no-store'}}):NextResponse.json({error:'상품을 찾을 수 없습니다.'},{status:404});
  } catch {return NextResponse.json({error:'상품을 읽지 못했습니다.'},{status:503});}
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if(process.env.NODE_ENV==='production' && !(await getChatGPTUser())?.verifiedAccess) return NextResponse.json({error:'운영 인증 연결 후 사용할 수 있습니다.'},{status:503});
  let ownerId: string;
  try { ownerId = await getWorkspaceOwnerId(); }
  catch { return NextResponse.json({error:'Cloudflare Access 로그인을 확인해주세요.'},{status:503}); }
  const { id } = await context.params;
  let body: unknown;
  try { body = await readBoundedJson(request, 64 * 1024); }
  catch (error) { return NextResponse.json({ error: error instanceof RequestBodyError ? error.message : '올바른 JSON 객체가 필요합니다.' }, { status: error instanceof RequestBodyError ? error.status : 400 }); }
  const fields = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  const { expectedVersion, ...patch } = fields ?? {};
  const updates = validateProductPatch(fields ? patch : body);
  if (!updates) return NextResponse.json({ error: '상품명·업로드 이미지 참조만 수정할 수 있습니다. 작업 완료 상태는 직접 지정할 수 없습니다.' }, { status: 400 });
  const imageChange = typeof updates.image_keys === 'string';
  if ((imageChange || expectedVersion !== undefined) && (typeof expectedVersion !== 'string' || expectedVersion.length > 30 || !Number.isFinite(Date.parse(expectedVersion)))) {
    return NextResponse.json({ error: '이미지 목록 변경에는 현재 상품의 expectedVersion이 필요합니다.' }, { status: 400 });
  }
  const version = typeof expectedVersion === 'string' ? expectedVersion : undefined;
  try {
    if (typeof updates.image_keys === 'string') {
      const keys = JSON.parse(updates.image_keys) as string[];
      if (new Set(keys).size !== keys.length || keys.some(key => !isOwnedImageKey(ownerId, key))) return NextResponse.json({ error: '중복 없는 본인 소유 이미지 참조만 저장할 수 있습니다.' }, { status: 400 });
      const current = await findProduct(ownerId, id);
      if (!current) return NextResponse.json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 });
      if (current.updated_at !== version) return NextResponse.json({ error: '상품이 변경되었습니다. 최신 상품을 다시 불러온 뒤 수정해주세요.' }, { status: 409 });
      const previous: unknown = JSON.parse(current.image_keys);
      if (!Array.isArray(previous)) throw new Error('Invalid saved image references.');
      // Existing unsupported originals remain referenced for recovery; only new
      // links require a validated raster image. The file route serves SVG/HTML as attachments.
      const additions = keys.filter(key => !previous.includes(key));
      if (additions.length && !env.FILES) return NextResponse.json({ error: '이미지 저장소가 연결되지 않았습니다.' }, { status: 503 });
      for (const key of additions) {
        const object = await env.FILES.get(key, { range: { offset: 0, length: 1024 } });
        if (!object || object.size === 0 || object.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: '이미지 파일이 없거나 크기가 올바르지 않습니다. 다시 업로드해주세요.' }, { status: 400 });
        try { imageFileType(await readBoundedStream(object.body, 1024)); }
        catch { return NextResponse.json({ error: '실제 PNG·JPEG·WebP·GIF·AVIF 이미지 참조만 추가할 수 있습니다.' }, { status: 400 }); }
      }
    }
    const product = await updateProduct(ownerId, id, updates, version);
    if (product) return NextResponse.json({ product });
    // A failed CAS is not a missing product; the owner-scoped lookup keeps that
    // distinction without revealing another workspace's records.
    if (version !== undefined && await findProduct(ownerId, id)) return NextResponse.json({ error: '저장 중 상품이 변경되었습니다. 최신 상품을 다시 불러온 뒤 수정해주세요.' }, { status: 409 });
    return NextResponse.json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 });
  } catch { return NextResponse.json({ error: '상품 변경을 저장하지 못했습니다.' }, { status: 503 }); }
}
