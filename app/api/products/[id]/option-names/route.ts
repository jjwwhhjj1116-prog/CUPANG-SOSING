import { NextResponse } from 'next/server';
import { getChatGPTUser,getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct,getSettings } from '@/db/queries';
import { readProductOptions,saveProductOptions } from '@/db/product-options';
import { readBoundedJson,RequestBodyError } from '@/app/request-body';
import { applyOptionNameChanges,validateOptionNamesInput } from '@/app/option-seo-names';
import { OPTIONS_BODY_LIMIT,calculateOptionPrices,resolveOptionPricePolicy } from '@/app/product-options';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}) {
  if(process.env.NODE_ENV==='production'&&!(await getChatGPTUser())?.verifiedAccess)return reply({error:'운영 인증 연결을 확인해주세요.'},503);
  let input;
  try{input=validateOptionNamesInput(await readBoundedJson(request,OPTIONS_BODY_LIMIT));}
  catch(cause){return reply({error:cause instanceof Error?cause.message:'옵션명을 확인해주세요.'},cause instanceof RequestBodyError?cause.status:400);}
  try{
    const owner=await getWorkspaceOwnerId(),{id}=await context.params,product=await findProduct(owner,id);
    if(!product)return reply({error:'상품을 찾을 수 없습니다.'},404);
    const current=await readProductOptions(owner,id);
    if(current.revision!==input.expectedRevision||product.updated_at!==input.expectedProductVersion)return reply({error:'상품 또는 옵션이 변경되었습니다. 입력을 유지하고 저장본을 확인해주세요.'},409);
    const version=new Date(Math.max(Date.now(),Date.parse(product.updated_at)+1)).toISOString();
    let next;try{next=applyOptionNameChanges(current,input.changes,version);}catch(cause){return reply({error:cause instanceof Error?cause.message:'옵션명 연결을 확인해주세요.'},400);}
    const settings=product.pricing_policy?null:await getSettings(owner),resolved=resolveOptionPricePolicy(product,settings?JSON.parse(settings.payload):undefined);
    const pricing={...resolved,rows:calculateOptionPrices(next.rows,resolved.policy)};
    // Unconfirmed prices and missing files remain quotation errors; a name-only
    // edit does not authorize replacing those facts or reopening their files.
    const saved=await saveProductOptions(owner,next,current.revision,product.updated_at);
    return saved?reply({options:saved,pricing,productVersion:version}):reply({error:'저장 중 상품 또는 옵션이 변경되었습니다. 입력을 유지하고 저장본을 확인해주세요.'},409);
  }catch{return reply({error:'옵션명을 저장하지 못했습니다. 입력을 유지하고 저장본을 확인해주세요.'},503);}
}
