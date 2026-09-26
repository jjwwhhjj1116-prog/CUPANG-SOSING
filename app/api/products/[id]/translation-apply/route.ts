import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { readProductOptions } from '@/db/product-options';
import { getTranslationJob } from '@/db/translation-jobs';
import { saveIntegratedTranslation } from '@/db/translation-adoption';
import { integratedTranslationPlan, applyIntegratedOptions } from '@/app/translation-integrated-adoption';
import { applyContentPatch } from '@/app/product-content';
import { fingerprint } from '@/app/automation/model';
import { readBoundedJson } from '@/app/request-body';

type Context = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: Request, context: Context) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({ error: '운영 인증 연결이 필요합니다.' }, 503);
  let body: Record<string, unknown>;
  try {
    if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) throw Error('같은 사이트에서 요청해주세요.');
    const value = await readBoundedJson(request, 4096);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('요청 객체가 필요합니다.');
    body = value as Record<string, unknown>;
    if (Object.keys(body).some(key => !['action','jobId','expectedVersion','fingerprint'].includes(key)) || !['preview','apply'].includes(String(body.action))
      || typeof body.jobId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.jobId) || typeof body.expectedVersion !== 'string'
      || (body.action === 'apply' && (typeof body.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.fingerprint)))) throw Error('검토 요청과 저장 지문을 확인해주세요.');
  } catch (error) { return json({ error: error instanceof Error ? error.message : '잘못된 요청입니다.' }, 400); }
  try {
    const owner = await getWorkspaceOwnerId(), { id } = await context.params;
    const product = await findProduct(owner, id);
    if (!product) return json({ error: '상품을 찾을 수 없습니다.' }, 404);
    if (product.updated_at !== body.expectedVersion) return json({ error: '상품이 변경되었습니다. 최신 상품에서 다시 검토해주세요.' }, 409);
    const [content, options, job] = await Promise.all([readProductContent(owner, id), readProductOptions(owner, id), getTranslationJob(owner, id, body.jobId as string)]);
    if (!job) return json({ error: '번역 결과를 찾을 수 없습니다.' }, 404);
    let plan;
    try { plan = integratedTranslationPlan(content, options, job, product.updated_at); }
    catch (error) { return json({ error: error instanceof Error ? error.message : '번역 연결을 확인해주세요.' }, 409); }
    const digest = await fingerprint({ productId: id, productVersion: product.updated_at, imageKeys: product.image_keys, content, options, job, plan });
    const preview = { productId: id, productVersion: product.updated_at, contentRevision: content.revision, optionRevision: options.revision, fingerprint: digest, preview: plan.preview, skipped: plan.skipped };
    if (body.action === 'preview') return json(preview);
    if (body.fingerprint !== digest) return json({ error: '검토 이후 자료가 변경되었습니다. 통합 미리보기를 다시 확인해주세요.' }, 409);
    if (!plan.preview.length) return json({ error: '새로 적용할 번역 항목이 없습니다.' }, 409);
    const now = new Date(Math.max(Date.now(), Date.parse(product.updated_at) + 1)).toISOString();
    const nextContent = applyContentPatch(content, plan.patch ?? {}, now), nextOptions = applyIntegratedOptions(options, plan, now);
    const saved = await saveIntegratedTranslation(owner, nextContent, nextOptions, { productVersion: product.updated_at, imageKeys: product.image_keys,
      contentRevision: content.revision, optionRevision: options.revision, jobId: job.id });
    return saved ? json({ productId: id, productVersion: now, contentRevision: nextContent.revision, optionRevision: nextOptions.revision, applied: plan.preview.length })
      : json({ error: '저장 중 자료가 변경되었습니다. 아무 항목도 함께 저장하지 않았습니다. 다시 검토해주세요.' }, 409);
  } catch { return json({ error: '통합 저장 상태를 확인하지 못했습니다. 저장본을 조회한 뒤 다시 검토해주세요. 자동 재저장하지 않았습니다.' }, 503); }
}
