import {NextResponse} from 'next/server';
import {managedProductAccess} from '@/app/managed-product-access';
import {listManagedProducts} from '@/db/managed-products';
import {managedProductAccountContext,ManagedProductContextChanged,parseManagedOrderStatus,type ManagedProductFilter} from '@/app/managed-products';
import {parseManagedTableQuery} from '@/app/managed-product-table';
const headers={'cache-control':'no-store'};
export async function GET(request:Request){
 const access=await managedProductAccess();if(!access)return NextResponse.json({error:'로그인 회원의 승인된 회사정보가 필요합니다.'},{status:403,headers});
 const params=new URL(request.url).searchParams,page=Number(params.get('page')??1),pageSize=Number(params.get('pageSize')??10),search=(params.get('search')??'').trim(),filter=params.get('filter')??'all';
 if(!Number.isSafeInteger(page)||page<1||page>10000||![10,25,50,100].includes(pageSize)||search.length>200||!['all','unavailable','loser','no-purchase','no-import','product-id-changed','price-changed','other-sellers'].includes(filter))return NextResponse.json({error:'목록의 검색·페이지 조건을 확인해주세요.'},{status:400,headers});
 let table,orderStatus;try{table=parseManagedTableQuery(params);orderStatus=parseManagedOrderStatus(params);}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'표 조건을 확인해주세요.'},{status:400,headers});}
 try{
  const accountContext=await managedProductAccountContext(access.ownerId,access.company),data=await listManagedProducts(access.ownerId,access.company,{page,pageSize,search,filter:filter as ManagedProductFilter,...table,...(orderStatus===undefined?{}:{orderStatus})}),current=await managedProductAccess();
  if(!current||await managedProductAccountContext(current.ownerId,current.company)!==accountContext)return NextResponse.json({error:'로그인 계정 또는 회사정보가 변경되었습니다. 목록을 다시 조회해주세요.'},{status:409,headers});
  return NextResponse.json({...data,accountContext},{headers});
 }
 catch(error){return NextResponse.json({error:error instanceof ManagedProductContextChanged?error.message:error instanceof RangeError?error.message:'상품관리 목록을 읽지 못했습니다. 다시 조회해주세요.'},{status:error instanceof ManagedProductContextChanged?409:error instanceof RangeError?413:503,headers});}
}
