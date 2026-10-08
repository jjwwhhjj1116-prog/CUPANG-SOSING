import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct } from '@/db/queries';
import { readSupplierHubReceipt, readSupplierHubTransmissionHistory, saveHistoricalSupplierHubReceipt, saveSupplierHubReceipt } from '@/db/supplier-hub-receipts';
import { readMappedQuotationSource, resolveQuotationExport, quotationExportFingerprint, QuotationExportError } from '@/app/exports/quotation-source';
import { quotationStartRow } from '@/app/category-profiles';
import { quotationFilename } from '@/app/exports/quotation-filename';
import { publicDetailConfig } from '@/app/quotation-public-detail';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { validateSupplierHubReceiptResult, type SupplierHubReceipt } from '@/app/supplier-hub-receipt';
import { approvedSupplierHubCompany } from '@/app/supplier-hub-company';

type Context={params:Promise<{id:string}>};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
export async function GET(request:Request,context:Context){
  if(process.env.NODE_ENV==='production'&&!(await getChatGPTUser())?.verifiedAccess)return json({error:'로그인을 확인해주세요.',code:'AUTH_REQUIRED'},503);
  const query=new URL(request.url).searchParams,fingerprint=query.get('fingerprint'),history=query.get('mode')==='history';
  if(!history&&(!fingerprint||!/^[a-f0-9]{64}$/.test(fingerprint)))return json({error:'견적서 확인값을 확인해주세요.'},400);
  try{
    const owner=await getWorkspaceOwnerId(),{id}=await context.params;
    if(!await findProduct(owner,id))return json({error:'상품을 찾을 수 없습니다.'},404);
    if(history)return json({history:await readSupplierHubTransmissionHistory(owner,id)});
    const receipt=await readSupplierHubReceipt(owner,id,fingerprint!);
    return json({receipt});
  }catch{return json({error:'보관된 전송 결과를 읽지 못했습니다.'},503);}
}
export async function POST(request:Request,context:Context){
  if(process.env.NODE_ENV==='production'&&!(await getChatGPTUser())?.verifiedAccess)return json({error:'로그인을 확인해주세요.',code:'AUTH_REQUIRED'},503);
  try{
    const body=await readBoundedJson(request,1024*1024) as {action?:string;profileId:string;categoryId:string;fingerprint:string;result:unknown};
    if(!body||typeof body.profileId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(body.profileId)
      ||typeof body.categoryId!=='string'||!body.categoryId||body.categoryId.length>100
      ||typeof body.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(body.fingerprint))return json({error:'견적서와 카테고리 확인값을 확인해주세요.'},400);
    const owner=await getWorkspaceOwnerId(),{id}=await context.params;
    if(body.action==='observe-history'){
      const product=await findProduct(owner,id);
      if(!product)return json({error:'상품을 찾을 수 없습니다.'},404);
      const previous=await readSupplierHubReceipt(owner,id,body.fingerprint);
      if(!previous||previous.profileId!==body.profileId||previous.categoryId!==body.categoryId)return json({error:'원래 보관된 견적서 전송 기록을 확인해주세요.'},409);
      const user=await getChatGPTUser(),company=user?.verifiedAccess&&user.userId===owner?approvedSupplierHubCompany(user.membership):null;
      if(!company||company.code!==previous.result.company?.code||company.name!==previous.result.company?.name)return json({error:'원래 전송 기록의 회사가 현재 승인 회사와 다릅니다.'},409);
      let result;
      try{
        result=validateSupplierHubReceiptResult(body.result,{filename:quotationFilename(previous.fingerprint,'xlsx'),company,includedOptions:previous.result.includedOptions!});
        if(previous.result.quotationId&&result.quotationId!==previous.result.quotationId)throw Error('원래 접수된 견적서 ID가 다릅니다.');
        if(previous.result.registration){
          if(result.state!=='validation-complete')throw Error('이미 접수된 견적서의 결과를 이전 상태로 바꿀 수 없습니다.');
          if(!result.registration)result={...result,registration:previous.result.registration};
          const issuedSkuId=(value:string)=>{const id=value.trim();return id&&!/\.\.\.|…/.test(id)&&!/^(?:-|—|n\/a|미표시|해당사항없음)$/i.test(id)?id:null;};
          const currentIds=new Set(result.registration!.rows.map(row=>issuedSkuId(row.skuId)).filter(Boolean));
          if(previous.result.registration.rows.some(row=>{const id=issuedSkuId(row.skuId);return id&&!currentIds.has(id);}))throw Error('이미 확인된 SKU ID가 빠진 결과는 보관할 수 없습니다.');
        }
      }catch(error){return json({error:error instanceof Error?error.message:'전송 결과를 확인해주세요.'},400);}
      const receipt:SupplierHubReceipt={...previous,recordedAt:new Date().toISOString(),result};
      if(!await saveHistoricalSupplierHubReceipt(owner,id,receipt,previous,product.updated_at))return json({error:'기존 전송 기록 또는 상품이 변경되었습니다. 파일을 다시 보내지 말고 결과를 다시 조회해주세요.'},409);
      return json({saved:true,fingerprint:previous.fingerprint,registered:false,historical:true});
    }
    if(body.action!==undefined)return json({error:'전송 결과 동작을 확인해주세요.'},400);
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
