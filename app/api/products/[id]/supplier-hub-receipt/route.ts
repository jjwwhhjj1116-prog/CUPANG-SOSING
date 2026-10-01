import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct } from '@/db/queries';
import { readSupplierHubReceipt, saveSupplierHubReceipt } from '@/db/supplier-hub-receipts';
import { readMappedQuotationSource, resolveQuotationExport, quotationExportFingerprint, QuotationExportError } from '@/app/exports/quotation-source';
import { quotationStartRow } from '@/app/category-profiles';
import { quotationFilename } from '@/app/exports/quotation-filename';
import { publicDetailConfig } from '@/app/quotation-public-detail';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { validateSupplierHubReceiptResult, type SupplierHubReceipt } from '@/app/supplier-hub-receipt';

type Context={params:Promise<{id:string}>};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
export async function GET(request:Request,context:Context){
  if(process.env.NODE_ENV==='production'&&!(await getChatGPTUser())?.verifiedAccess)return json({error:'로그인을 확인해주세요.',code:'AUTH_REQUIRED'},503);
  const fingerprint=new URL(request.url).searchParams.get('fingerprint');
  if(!fingerprint||!/^[a-f0-9]{64}$/.test(fingerprint))return json({error:'견적서 확인값을 확인해주세요.'},400);
  try{
    const owner=await getWorkspaceOwnerId(),{id}=await context.params;
    if(!await findProduct(owner,id))return json({error:'상품을 찾을 수 없습니다.'},404);
    const receipt=await readSupplierHubReceipt(owner,id,fingerprint);
    return json({receipt});
  }catch{return json({error:'보관된 전송 결과를 읽지 못했습니다.'},503);}
}
export async function POST(request:Request,context:Context){
  if(process.env.NODE_ENV==='production'&&!(await getChatGPTUser())?.verifiedAccess)return json({error:'로그인을 확인해주세요.',code:'AUTH_REQUIRED'},503);
  try{
    const body=await readBoundedJson(request,1024*1024) as {profileId:string;categoryId:string;fingerprint:string;result:unknown};
    if(!body||typeof body.profileId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(body.profileId)
      ||typeof body.categoryId!=='string'||!body.categoryId||body.categoryId.length>100
      ||typeof body.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(body.fingerprint))return json({error:'견적서와 카테고리 확인값을 확인해주세요.'},400);
    const owner=await getWorkspaceOwnerId(),{id}=await context.params;
    const saved=await readMappedQuotationSource(owner,id,body.profileId);
    if(!saved.profile?.template||saved.profile.template.format!=='xlsx'||saved.categoryContext.categoryId!==body.categoryId||!saved.company)
      return json({error:'회원 회사와 카테고리 견적서 연결을 확인해주세요.'},409);
    const revision=await quotationExportFingerprint(saved,quotationStartRow(saved.profile.template),publicDetailConfig(env as Parameters<typeof publicDetailConfig>[0]));
    if(revision!==body.fingerprint)return json({error:'전송 이후 초안이 변경되었습니다. 기존 전송 결과는 Chrome 확장에 유지됩니다.'},409);
    const includedOptions=resolveQuotationExport(saved).rows.filter(row=>row.included).length;
    let result;
    try{result=validateSupplierHubReceiptResult(body.result,{filename:quotationFilename(revision,'xlsx'),company:saved.company,includedOptions});}
    catch(error){return json({error:error instanceof Error?error.message:'전송 결과를 확인해주세요.'},400);}
    const receipt:SupplierHubReceipt={schemaVersion:1,evidence:'chrome-observation',profileId:saved.profile.id,categoryId:body.categoryId,
      fingerprint:revision,productVersion:saved.product.updated_at,recordedAt:new Date().toISOString(),result};
    if(!await saveSupplierHubReceipt(owner,id,receipt,saved.source,saved.state.revision))return json({error:'견적서 저장본 또는 접수된 견적서 ID가 변경되었습니다.'},409);
    return json({saved:true,fingerprint:revision,registered:false});
  }catch(error){
    if(error instanceof RequestBodyError)return json({error:error.message},error.status);
    if(error instanceof QuotationExportError)return json({error:error.message},error.status);
    return json({error:'전송 결과를 보관하지 못했습니다. Supplier Hub에 파일을 다시 전송하지 말고 결과 조회를 다시 실행해주세요.'},503);
  }
}
