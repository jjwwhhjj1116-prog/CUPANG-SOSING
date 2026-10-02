import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { getQuotationSchema } from '@/app/quotation-schema';
import { readAttributeRules, ATTRIBUTE_RULE_LIMIT } from '@/app/quotation-attribute-rules';
import { getAttributeRules, saveAttributeRules } from '@/db/quotation-attribute-rules';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {readProductAttributeSchema,AttributeRuleSchemaError} from '@/db/quotation-attribute-schema';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
function category(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error('카테고리를 확인해주세요.');
  return value;
}
function contextId(value:unknown):string|null{
  if(value===undefined||value===null)return null;
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value))throw new Error('상품·프로필 식별값을 확인해주세요.');
  return value;
}
export async function GET(request: Request) {
  const user=await getChatGPTUser();
  if (process.env.NODE_ENV === 'production' && !user?.verifiedAccess) return reply({ error: '운영 인증이 필요합니다.' }, 503);
  let id: string,productId:string|null,profileId:string|null;
  try { const query=new URL(request.url).searchParams;id = category(query.get('categoryId'));productId=contextId(query.get('productId'));profileId=contextId(query.get('profileId'));if(profileId&&!productId)throw Error('상품을 먼저 선택해주세요.'); } catch { return reply({ error: '카테고리·상품·프로필을 확인해주세요.' }, 400); }
  try {
    const owner=await getWorkspaceOwnerId();
    if(productId){const company=user?.verifiedAccess?approvedSupplierHubCompany(user.membership):null;if(!company)return reply({error:'승인된 회원 회사정보가 필요합니다.'},403);await readProductAttributeSchema(owner,productId,id,profileId,company);}
    return reply(await getAttributeRules(owner, id) ?? { rules: null, revision: 0, updatedAt: null });
  }catch(error){return reply({error:error instanceof AttributeRuleSchemaError?error.message:'카테고리 연결 규칙을 불러오지 못했습니다.'},error instanceof AttributeRuleSchemaError?error.status:503);}
}
export async function PUT(request: Request) {
  const user=await getChatGPTUser();
  if (process.env.NODE_ENV === 'production' && !user?.verifiedAccess) return reply({ error: '운영 인증이 필요합니다.' }, 503);
  let rules; let revision: number;let owner:string;
  try {
    if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)throw Error('같은 사이트에서 요청해주세요.');
    const body = await readBoundedJson(request, ATTRIBUTE_RULE_LIMIT + 1024) as { rules?: { categoryId?: unknown }; expectedRevision?: number;productId?:unknown;profileId?:unknown } | null;
    if (!body || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision! < 0) throw new Error('먼저 서버 규칙을 불러와 저장 버전을 확인해주세요.');
    revision = body.expectedRevision!;
    const id=category(body.rules?.categoryId),productId=contextId(body.productId),profileId=contextId(body.profileId);
    if(profileId&&!productId)throw Error('상품을 먼저 선택해주세요.');
    owner=await getWorkspaceOwnerId();let schema=getQuotationSchema(id);
    if(productId){const company=user?.verifiedAccess?approvedSupplierHubCompany(user.membership):null;if(!company)return reply({error:'승인된 회원 회사정보가 필요합니다.'},403);schema=await readProductAttributeSchema(owner,productId,id,profileId,company);}
    rules = readAttributeRules(JSON.stringify(body.rules), schema);
  } catch (cause) { return reply({ error: cause instanceof Error ? cause.message : '규칙 입력을 확인해주세요.' }, cause instanceof RequestBodyError||cause instanceof AttributeRuleSchemaError ? cause.status : 400); }
  try {
    const saved = await saveAttributeRules(owner, rules, revision);
    return saved ? reply(saved) : reply({ error: '다른 화면에서 규칙이 변경됐거나 카테고리 100개 한도입니다. 현재 선택은 유지한 채 서버 규칙을 다시 확인해주세요.' }, 409);
  } catch { return reply({ error: '규칙 저장 결과를 확인하지 못했습니다. 서버 규칙을 다시 불러와 확인해주세요.' }, 503); }
}
