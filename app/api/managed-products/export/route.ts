import {NextResponse} from 'next/server';
import {managedProductAccess} from '@/app/managed-product-access';
import {managedProductAccountContext,type ManagedProductFilter} from '@/app/managed-products';
import {parseManagedTableQuery} from '@/app/managed-product-table';
import {readManagedProductsForExport} from '@/db/managed-products';
import {managedProductWorkbook} from '@/app/managed-product-export';
const headers={'cache-control':'no-store'},fail=(error:string,status:number)=>NextResponse.json({error},{status,headers});
export async function GET(request:Request){
 const access=await managedProductAccess();if(!access)return fail('로그인 회원의 승인 회사정보가 필요합니다.',403);
 const params=new URL(request.url).searchParams,expected=params.get('expectedAccountContext'),search=(params.get('search')??'').trim(),filter=params.get('filter')??'all';
 if(!expected||!/^[a-f0-9]{64}$/.test(expected)||search.length>200||!['all','unavailable','loser','no-purchase','no-import'].includes(filter))return fail('상품 DB 다운로드 조건과 계정을 확인해주세요.',400);
 let table;try{table=parseManagedTableQuery(params);}catch(error){return fail(error instanceof Error?error.message:'표 조건을 확인해주세요.',400);}
 try{
  const accountContext=await managedProductAccountContext(access.ownerId,access.company);if(accountContext!==expected)return fail('현재 계정 또는 회사가 변경되었습니다. 상품 목록을 다시 확인해주세요.',409);
  const products=await readManagedProductsForExport(access.ownerId,access.company,{page:1,pageSize:100,search,filter:filter as ManagedProductFilter,...table}),bytes=managedProductWorkbook(products,access.company),current=await managedProductAccess();
  if(!current||await managedProductAccountContext(current.ownerId,current.company)!==accountContext)return fail('다운로드 중 로그인 계정 또는 회사가 변경되었습니다. 목록을 다시 조회해주세요.',409);
  return new Response(bytes,{headers:{...headers,'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':`attachment; filename="YOOFAM-${access.company.code}-products.xlsx"`,'x-managed-account-context':accountContext}});
 }catch(error){return fail(error instanceof RangeError?error.message:'현재 회사의 상품 DB 다운로드를 확인하지 못했습니다.',error instanceof RangeError?413:503);}
}
