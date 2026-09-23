import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findCollectionJob } from '@/db/collection-jobs';
import { readCollectionResult } from '@/db/collection-results';
import { findCollectionProduct } from '@/db/collection-products';
import { listCollectionImageIndices } from '@/db/collection-images';
import { findProduct } from '@/db/queries';
import { productImageKeys } from '@/app/product-content';
import { workspaceBannerAssignments } from '@/app/workspace-banners';
import { validateSettings } from '@/app/workspace-settings';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return reply({ error: '운영 인증이 필요합니다.' }, 503);
    const owner = await getWorkspaceOwnerId(); const { id } = await context.params;
    const job = await findCollectionJob(owner, id);
    if (!job) return reply({ error: '수집 요청을 찾을 수 없습니다.' }, 404);
    if (job.status === 'cancelled') return reply({ error: '취소된 수집 요청입니다.' }, 409);
    const receipt = await readCollectionResult(owner, id);
    if (!receipt) return reply({ error: '수신 결과가 아직 없습니다.' }, 409);
    const link = await findCollectionProduct(owner, id);
    let usedSlots: number; let reusableIndices: number[] = [];
    if (link) {
      const product = await findProduct(owner, link.product_id);
      if (!product) return reply({ error: '연결된 상품을 찾을 수 없습니다.' }, 409);
      usedSlots = new Set(productImageKeys(product.image_keys)).size;
      reusableIndices = await listCollectionImageIndices(owner, id, link.product_id);
    } else {
      if (!job.context) return reply({ error: '요청 당시 기본설정이 없습니다.' }, 409);
      usedSlots = workspaceBannerAssignments(validateSettings(job.context.settings), owner).length;
    }
    return reply({ capacity: { usedSlots, totalImages: receipt.result.images.length, reusableIndices } });
  } catch { return reply({ error: '이미지 저장 여유를 조회하지 못했습니다.' }, 503); }
}
