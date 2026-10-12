import {NextResponse} from 'next/server';
import {managedProductAccess} from '@/app/managed-product-access';
import {managedProductAccountContext} from '@/app/managed-products';
import {readManagedImportPricesForExport} from '@/db/managed-import-prices';
import {managedImportPricesWorkbook} from '@/app/managed-product-export';
const headers={'cache-control':'no-store'},fail=(error:string,status:number)=>NextResponse.json({error},{status,headers});
export async function GET(request:Request){
 const access=await managedProductAccess();if(!access)return fail('로그인 회원의 승인 회사정보가 필요합니다.',403);
 const params=new URL(request.url).searchParams,expected=params.get('expectedAccountContext'),skuId=params.get('skuId')??undefined,search=(params.get('search')??'').trim();
 if(!expected||!/^[a-f0-9]{64}$/.test(expected)||skuId!==undefined&&!/^\d{1,30}$/.test(skuId)||search.length>200)return fail('매입내역 다운로드 조건과 계정을 확인해주세요.',400);
 try{const accountContext=await managedProductAccountContext(access.ownerId,access.company);if(expected!==accountContext)return fail('현재 계정 또는 회사가 변경되었습니다. 다시 조회해주세요.',409);
  const records=await readManagedImportPricesForExport(access.ownerId,access.company,{skuId,search}),bytes=managedImportPricesWorkbook(records),current=await managedProductAccess();
  if(!current||await managedProductAccountContext(current.ownerId,current.company)!==accountContext)return fail('다운로드 중 로그인 계정 또는 회사가 변경되었습니다. 다시 조회해주세요.',409);
  return new Response(bytes,{headers:{...headers,'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':`attachment; filename="YOOFAM-${access.company.code}-import-prices.xlsx"`,'x-managed-account-context':accountContext}});
 }catch(error){return fail(error instanceof RangeError?error.message:'현재 회사의 매입내역 다운로드를 확인하지 못했습니다.',error instanceof RangeError?413:503);}
}
