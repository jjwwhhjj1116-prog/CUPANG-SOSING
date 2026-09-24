import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { getQuotationSchema } from '@/app/quotation-schema';
import { readAttributeRules, ATTRIBUTE_RULE_LIMIT } from '@/app/quotation-attribute-rules';
import { getAttributeRules, saveAttributeRules } from '@/db/quotation-attribute-rules';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
function category(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error('카테고리를 확인해주세요.');
  return value;
}
export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return reply({ error: '운영 인증이 필요합니다.' }, 503);
  let id: string;
  try { id = category(new URL(request.url).searchParams.get('categoryId')); } catch { return reply({ error: '카테고리를 확인해주세요.' }, 400); }
  try { return reply(await getAttributeRules(await getWorkspaceOwnerId(), id) ?? { rules: null, revision: 0, updatedAt: null }); }
  catch { return reply({ error: '카테고리 연결 규칙을 불러오지 못했습니다.' }, 503); }
}
export async function PUT(request: Request) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return reply({ error: '운영 인증이 필요합니다.' }, 503);
  let rules; let revision: number;
  try {
    const body = await readBoundedJson(request, ATTRIBUTE_RULE_LIMIT + 1024) as { rules?: { categoryId?: unknown }; expectedRevision?: number } | null;
    if (!body || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision! < 0) throw new Error('먼저 서버 규칙을 불러와 저장 버전을 확인해주세요.');
    revision = body.expectedRevision!;
    rules = readAttributeRules(JSON.stringify(body.rules), getQuotationSchema(category(body.rules?.categoryId)));
  } catch (cause) { return reply({ error: cause instanceof Error ? cause.message : '규칙 입력을 확인해주세요.' }, cause instanceof RequestBodyError ? cause.status : 400); }
  try {
    const saved = await saveAttributeRules(await getWorkspaceOwnerId(), rules, revision);
    return saved ? reply(saved) : reply({ error: '다른 화면에서 규칙이 변경됐거나 카테고리 100개 한도입니다. 현재 선택은 유지한 채 서버 규칙을 다시 확인해주세요.' }, 409);
  } catch { return reply({ error: '규칙 저장 결과를 확인하지 못했습니다. 서버 규칙을 다시 불러와 확인해주세요.' }, 503); }
}
