import { getQuotationSchema } from '@/app/quotation-schema';
import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { CATEGORY_PROFILE_BODY_LIMIT, validateCategoryCodeForSave, validateCategoryProfile, validateQuotationChoiceFormats } from '@/app/category-profiles';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { createCategoryProfile, getCategoryProfile, listCategoryProfiles, updateCategoryProfile } from '@/db/category-profiles';
import { TemplateValidationError, validateStoredTemplate } from '@/db/category-templates';

const options = { headers: { 'cache-control': 'no-store' } };
const unavailable = () => NextResponse.json({ error: '운영 인증이 연결되기 전에는 카테고리 설정을 공개할 수 없습니다.' }, { status: 503, ...options });
const owner = async () => await getWorkspaceOwnerId();
const body = (request: Request) => readBoundedJson(request, CATEGORY_PROFILE_BODY_LIMIT);
const inputStatus = (error: unknown) => error instanceof RequestBodyError ? error.status : 400;
const errorText = (error: unknown) => error instanceof SyntaxError ? '올바른 JSON이 필요합니다.' : error instanceof Error ? error.message : '입력을 확인해주세요.';
export async function GET() {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return unavailable();
  try { return NextResponse.json({ profiles: await listCategoryProfiles(await owner()) }, options); }
  catch { return NextResponse.json({ error: '카테고리 설정을 읽지 못했습니다.' }, { status: 503, ...options }); }
}
export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return unavailable();
  let input;
  try { input = validateCategoryProfile(await body(request)); validateCategoryCodeForSave(input.categoryId); validateQuotationChoiceFormats(input, getQuotationSchema(input.categoryId).fields); }
  catch (error) { return NextResponse.json({ error: errorText(error) }, { status: inputStatus(error), ...options }); }
  try {
    const ownerId = await owner();
    try { await validateStoredTemplate(ownerId, input.template); } catch (error) { if (error instanceof TemplateValidationError) return NextResponse.json({ error: errorText(error) }, { status: 400, ...options }); throw error; }
    const profile = await createCategoryProfile(ownerId, input);
    if (!profile) return NextResponse.json({ error: '카테고리 설정은 최대 100개입니다. 기존 설정을 수정해주세요.' }, { status: 409, ...options });
    return NextResponse.json({ profile }, { status: 201, ...options });
  } catch { return NextResponse.json({ error: '카테고리 설정 저장을 확인하지 못했습니다. 다시 불러온 뒤 확인해주세요.' }, { status: 503, ...options }); }
}
export async function PUT(request: Request) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return unavailable();
  let id: string; let expectedRevision: number; let input;
  try {
    const raw = await body(request);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('설정 번호와 저장 버전을 확인해주세요.');
    const value = raw as Record<string, unknown>;
    if (typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id) || typeof value.expectedRevision !== 'number' || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1) throw new Error('설정 번호와 저장 버전을 확인해주세요.');
    id = value.id; expectedRevision = value.expectedRevision; input = validateCategoryProfile(value.profile); validateCategoryCodeForSave(input.categoryId); validateQuotationChoiceFormats(input, getQuotationSchema(input.categoryId).fields);
  } catch (error) { return NextResponse.json({ error: errorText(error) }, { status: inputStatus(error), ...options }); }
  try {
    const ownerId = await owner();
    if (!await getCategoryProfile(ownerId, id)) return NextResponse.json({ error: '카테고리 설정을 찾을 수 없습니다.' }, { status: 404, ...options });
    try { await validateStoredTemplate(ownerId, input.template); } catch (error) { if (error instanceof TemplateValidationError) return NextResponse.json({ error: errorText(error) }, { status: 400, ...options }); throw error; }
    const profile = await updateCategoryProfile(ownerId, id, expectedRevision, input);
    if (!profile) return NextResponse.json({ error: '다른 화면에서 설정이 변경되었습니다. 다시 불러온 뒤 수정해주세요.' }, { status: 409, ...options });
    return NextResponse.json({ profile }, options);
  } catch { return NextResponse.json({ error: '카테고리 설정 저장을 확인하지 못했습니다.' }, { status: 503, ...options }); }
}
